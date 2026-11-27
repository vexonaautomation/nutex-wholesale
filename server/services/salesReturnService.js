// Sales returns (admins only: owner, admin, sub admin). A handed-over order's
// goods come back: the admin enters per item how many are Good (back in stock)
// and how many Damaged (record only). Each return gets a number and a credit
// note PDF; the money itself is settled outside the website.
//  - quantity is in the unit the item was sold in (boxes or pieces)
//  - an order can have several returns, never more than was sold
//  - the credit follows the order's own prices; "less packing" taken off the
//    order is taken off the credit in the same proportion
//  - a return entered by mistake is cancelled (its stock goes out again); its
//    rows stay in the sheets
import { sheetsService } from './sheetsService.js';
import { auditOp } from './auditService.js';
import { inventoryDeltaOps } from './inventoryService.js';
import { getSettings } from './settingsService.js';
import {
  activeItems, getOrderAdmin, loadOrderBundle,
} from './orderService.js';
import { buildBill, billFileName, istDate, renderBillPdf } from './billService.js';
import { AUDIT_ACTION, ORDER_STATUS } from '../config/constants.js';
import { COMMERCE_LOCK, withLock } from '../utils/lockManager.js';
import { newId, ID_PREFIX } from '../utils/idGenerator.js';
import { nowIso } from '../utils/dates.js';
import { round2 } from '../utils/money.js';
import { pcsColumns } from '../utils/itemPcs.js';
import { piecesByInventory } from '../utils/stockComponents.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { getCatalog } from './catalogService.js';
import { buildQuote } from './quoteService.js';
import { normalizeMobile } from '../utils/orderToken.js';
import { encodeComponents } from '../utils/stockComponents.js';

export const RETURN_STATUS = Object.freeze({ ACTIVE: 'ACTIVE', CANCELLED: 'CANCELLED' });
export const RETURN_CONDITION = Object.freeze({ GOOD: 'GOOD', DAMAGED: 'DAMAGED' });

const isActive = (r) => r.status === RETURN_STATUS.ACTIVE;
const sum = (list, fn) => list.reduce((s, x) => s + fn(x), 0);

function nextReturnNumber(returns) {
  const last = Math.max(0, ...returns.map((r) => Number(String(r.return_number).replace(/\D/g, '')) || 0));
  return `SR-${String(last + 1).padStart(4, '0')}`;
}

/** Units of each order item already returned (cancelled returns do not count). */
function returnedByItem(returnItems, orderId) {
  const out = new Map();
  for (const r of returnItems) {
    if (r.order_id === orderId && isActive(r)) out.set(r.order_item_id, (out.get(r.order_item_id) || 0) + (Number(r.qty) || 0));
  }
  return out;
}

const orderSubtotal = (items) => round2(sum(items, (i) => Number(i.line_total) || 0));

/** Part of the credit taken off because the order had "less packing" (0 to 1). */
const packingShare = (order, items) => {
  const subtotal = orderSubtotal(items);
  return subtotal > 0 ? Math.min(1, (Number(order.packing_deduction) || 0) / subtotal) : 0;
};

const view = (r) => ({
  return_id: r.return_id,
  return_number: r.return_number,
  order_id: r.order_id,
  order_number: r.order_number,
  party_name: r.party_name,
  city: r.city,
  reason: r.reason,
  total_pcs: r.total_pcs,
  good_pcs: r.good_pcs,
  damaged_pcs: r.damaged_pcs,
  credit_amount: r.credit_amount,
  status: r.status,
  made_by_name: r.made_by_name,
  created_at: r.created_at,
  cancel_reason: r.cancel_reason,
});

const newestFirst = (a, b) => String(b.created_at).localeCompare(String(a.created_at));

/**
 * One Sales_Return_Items row. item: the Order_Items row (or, for a "Not
 * given" item, an item built from today's catalogue); order: its order (null
 * for "Not given"). The credit is the item's own price for that quantity.
 */
function returnItemRow({
  item, order, qty, condition, returnId, returnNumber, now, notGiven = false,
}) {
  const pcs = pcsColumns({ ...item, qty });
  const amount = round2((Number(item.line_total) || 0) * qty / (Number(item.qty) || 1));
  return {
    return_item_id: newId(ID_PREFIX.salesReturnItem),
    return_id: returnId,
    return_number: returnNumber,
    order_item_id: notGiven ? '' : item.order_item_id,
    order_id: order?.order_id || '',
    bill_no: order?.order_number || '',
    sku: item.sku_snapshot,
    product_name: item.product_name_snapshot,
    size: item.size_snapshot,
    item_colour: pcs.item_colour,
    sold_in: pcs.sold_in,
    qty,
    qty_pcs: pcs.qty_pcs,
    rate_per_pc: pcs.qty_pcs ? round2(amount / pcs.qty_pcs) : 0,
    amount,
    condition,
    status: RETURN_STATUS.ACTIVE,
    created_at: now,
    variant_id: item.variant_id || '',
    product_id: item.product_id || '',
    stock_components: typeof item.stock_components === 'string' ? item.stock_components : encodeComponents(item),
    inventory_mode: item.inventory_mode_snapshot || '',
    units_per_box: Number(item.units_per_box_snapshot) || null,
    mrp_unit: Number(item.mrp_unit_snapshot) || null,
    discount_percent: Number(item.discount_percent_snapshot) || 0,
    not_given: notGiven,
  };
}

/** The returned unit as an order item (stock and credit note), from its own row when the order item is not there. */
const itemOfReturnRow = (r, original) => (original ? { ...original, qty: r.qty, line_total: r.amount } : {
  product_id: r.product_id,
  variant_id: r.variant_id,
  stock_components: r.stock_components,
  sku_snapshot: r.sku,
  product_name_snapshot: r.product_name,
  size_snapshot: r.size,
  color_snapshot: r.item_colour === 'Mix Color' ? '' : r.item_colour,
  inventory_mode_snapshot: r.inventory_mode,
  units_per_box_snapshot: r.units_per_box,
  mrp_unit_snapshot: r.mrp_unit,
  discount_percent_snapshot: r.discount_percent,
  qty: r.qty,
  line_total: r.amount,
});

/** Returns of an order and what can still come back. */
export async function orderReturns(id) {
  const bundle = await loadOrderBundle(id, { byId: true });
  const { order } = bundle;
  const data = await sheetsService.readMany(['Sales_Returns', 'Sales_Return_Items'], { fresh: true });
  const items = activeItems(bundle.items, order.order_id);
  const returned = returnedByItem(data.Sales_Return_Items, order.order_id);
  return {
    can_return: order.order_status === ORDER_STATUS.COMPLETED,
    packing_share: packingShare(order, items),
    returns: data.Sales_Returns.filter((r) => r.order_id === order.order_id).sort(newestFirst).map(view),
    items: items.map((i) => {
      const sold = Number(i.qty) || 0;
      const done = returned.get(i.order_item_id) || 0;
      const { item_colour: colour, sold_in: soldIn, pcs_per_box: perBox } = pcsColumns(i);
      return {
        order_item_id: i.order_item_id,
        sku: i.sku_snapshot,
        product_name: i.product_name_snapshot,
        size: i.size_snapshot,
        colour,
        sold_in: soldIn,
        pcs_per_box: perBox,
        sold,
        returned: done,
        returnable: Math.max(0, sold - done),
        unit_amount: sold ? (Number(i.line_total) || 0) / sold : 0,
      };
    }),
  };
}

export async function createSalesReturn(id, { items: lines, reason }, { admin, ip }) {
  return withLock(COMMERCE_LOCK, async () => {
    const bundle = await loadOrderBundle(id, { byId: true });
    const { order } = bundle;
    if (order.order_status !== ORDER_STATUS.COMPLETED) {
      throw conflict('INVALID_TRANSITION', 'A sales return can be made only for a handed-over order.');
    }
    const data = await sheetsService.readMany(['Sales_Returns', 'Sales_Return_Items', 'Inventory'], { fresh: true });
    const items = activeItems(bundle.items, order.order_id);
    const byId = new Map(items.map((i) => [i.order_item_id, i]));
    const returned = returnedByItem(data.Sales_Return_Items, order.order_id);

    const asked = new Map();
    for (const l of lines) {
      const item = byId.get(l.order_item_id);
      if (!item) throw badRequest('This item is not on the order.');
      asked.set(l.order_item_id, (asked.get(l.order_item_id) || 0) + l.qty);
    }
    for (const [itemId, qty] of asked) {
      const item = byId.get(itemId);
      const left = (Number(item.qty) || 0) - (returned.get(itemId) || 0);
      if (qty > left) throw conflict('RETURN_TOO_MANY', `${item.product_name_snapshot}: only ${left} left to return.`, { order_item_id: itemId, returnable: left });
    }

    const now = nowIso();
    const returnId = newId(ID_PREFIX.salesReturn);
    const returnNumber = nextReturnNumber(data.Sales_Returns);
    const rows = lines.map((l) => returnItemRow({
      item: byId.get(l.order_item_id), order, qty: l.qty, condition: l.condition, returnId, returnNumber, now,
    }));

    const subtotal = round2(sum(rows, (r) => r.amount));
    const packingLess = round2(subtotal * packingShare(order, items));
    const pcsOf = (condition) => sum(rows.filter((r) => r.condition === condition), (r) => r.qty_pcs);
    const header = {
      return_id: returnId,
      return_number: returnNumber,
      order_id: order.order_id,
      order_number: order.order_number,
      party_name: order.business_name_snapshot || order.customer_name_snapshot,
      customer_name: order.customer_name_snapshot,
      mobile: order.mobile_snapshot,
      city: order.city_snapshot,
      reason,
      total_pcs: pcsOf(RETURN_CONDITION.GOOD) + pcsOf(RETURN_CONDITION.DAMAGED),
      good_pcs: pcsOf(RETURN_CONDITION.GOOD),
      damaged_pcs: pcsOf(RETURN_CONDITION.DAMAGED),
      subtotal,
      packing_less: packingLess,
      credit_amount: round2(subtotal - packingLess),
      status: RETURN_STATUS.ACTIVE,
      made_by_id: admin.admin_id,
      made_by_name: admin.name || admin.email || '',
      created_at: now,
    };

    // Good goods go back on the shelf; damaged ones are only recorded
    const good = lines.filter((l) => l.condition === RETURN_CONDITION.GOOD).map((l) => ({ ...byId.get(l.order_item_id), qty: l.qty }));
    const deltas = new Map(Object.entries(piecesByInventory(good)).map(([v, n]) => [v, { stock: n }]));
    const inventory = inventoryDeltaOps(data.Inventory, deltas, { by: admin.admin_id, clamp: true });
    if (inventory.shortfalls.length) logger.warn(`Sales return ${returnNumber}: no inventory row for some items`, inventory.shortfalls);

    await sheetsService.commit([
      ...inventory.ops,
      { op: 'append', sheet: 'Sales_Returns', rows: [header] },
      { op: 'append', sheet: 'Sales_Return_Items', rows },
      auditOp({
        admin, ip, action: AUDIT_ACTION.SALES_RETURN_CREATED, entity_type: 'Order', entity_id: order.order_id, reason,
        new_value: { return_number: returnNumber, total_pcs: header.total_pcs, credit_amount: header.credit_amount },
      }),
    ]);
    return { sales_return: view(header), order: await getOrderAdmin(order.order_id) };
  });
}

export async function listSalesReturns({ q = '' } = {}) {
  const rows = await sheetsService.read('Sales_Returns', { fresh: true });
  const term = String(q).trim().toLowerCase();
  const match = (r) => !term || [r.return_number, r.order_number, r.party_name, r.mobile].some((v) => String(v || '').toLowerCase().includes(term));
  const items = rows.filter(match).sort(newestFirst).map(view);
  return { items, total_credit: round2(sum(items.filter(isActive), (r) => Number(r.credit_amount) || 0)) };
}

export async function cancelSalesReturn(id, { reason }, { admin, ip }) {
  return withLock(COMMERCE_LOCK, async () => {
    const data = await sheetsService.readMany(['Sales_Returns', 'Sales_Return_Items', 'Order_Items', 'Inventory'], { fresh: true });
    const ret = data.Sales_Returns.find((r) => r.return_id === id);
    if (!ret) throw notFound('Sales return not found.');
    if (!isActive(ret)) throw conflict('INVALID_TRANSITION', 'This sales return is already cancelled.');
    const rows = data.Sales_Return_Items.filter((r) => r.return_id === id);
    const items = new Map(data.Order_Items.map((i) => [i.order_item_id, i]));
    const good = rows.filter((r) => r.condition === RETURN_CONDITION.GOOD).map((r) => itemOfReturnRow(r, items.get(r.order_item_id)));
    const deltas = new Map(Object.entries(piecesByInventory(good)).map(([v, n]) => [v, { stock: -n }]));
    const inventory = inventoryDeltaOps(data.Inventory, deltas, { by: admin.admin_id, clamp: true });
    // goods already sold again cannot leave the stock a second time
    if (inventory.shortfalls.some((s) => !s.reason)) {
      throw conflict('STOCK_CHANGED', 'This stock has already been sold or reserved, so the return cannot be cancelled.');
    }
    const now = nowIso();
    await sheetsService.commit([
      ...inventory.ops,
      {
        op: 'update', sheet: 'Sales_Returns', id,
        patch: { status: RETURN_STATUS.CANCELLED, cancelled_at: now, cancelled_by: admin.name || admin.email || '', cancel_reason: reason },
      },
      ...rows.map((r) => ({ op: 'update', sheet: 'Sales_Return_Items', id: r.return_item_id, patch: { status: RETURN_STATUS.CANCELLED } })),
      auditOp({
        admin, ip, action: AUDIT_ACTION.SALES_RETURN_CANCELLED, entity_type: 'Order', entity_id: ret.order_id, reason,
        old_value: { return_number: ret.return_number, credit_amount: ret.credit_amount },
      }),
    ]);
    return { ok: true };
  });
}

/** Credit note PDF: the bill layout with the returned items and the credit. */
export async function creditNote(id) {
  const data = await sheetsService.readMany(['Sales_Returns', 'Sales_Return_Items', 'Products'], { fresh: true });
  const ret = data.Sales_Returns.find((r) => r.return_id === id);
  if (!ret) throw notFound('Sales return not found.');
  // an item-wise credit note can cover several bills (or none, "Not given"):
  // the party comes from the return's order, else the party's latest order
  const orders = await sheetsService.readMany(['Orders', 'Order_Items'], { fresh: true });
  const party = orders.Orders.find((o) => o.order_id === ret.order_id)
    || orders.Orders.filter((o) => normalizeMobile(o.mobile_snapshot) === normalizeMobile(ret.mobile)).sort(newestFirst)[0];
  if (!party) throw notFound('The order of this sales return was not found.');
  const originals = new Map(orders.Order_Items.map((i) => [i.order_item_id, i]));
  const rows = data.Sales_Return_Items.filter((r) => r.return_id === id);
  const items = rows.map((r) => itemOfReturnRow(r, r.order_item_id ? originals.get(r.order_item_id) : null));
  const settings = await getSettings();
  const productSkus = Object.fromEntries(data.Products.map((p) => [p.product_id, p.sku]));
  const cancelled = !isActive(ret);
  const notGiven = rows.filter((r) => r.not_given === true).length;
  const bill = {
    ...buildBill({
      order: { ...party, business_name_snapshot: ret.party_name || party.business_name_snapshot }, items, settings, productSkus,
    }),
    title: cancelled ? 'CREDIT NOTE (CANCELLED)' : 'CREDIT NOTE',
    number: ret.return_number,
    against: ret.order_number || 'Not given',
    date: istDate(ret.created_at),
    packing_deduction: Number(ret.packing_less) || 0,
    less_packing: false,
    round_off: 0,
    grand_total: Number(ret.credit_amount) || 0,
    total_label: 'TOTAL CREDIT:',
    terms_label: 'Return details:',
    terms: [
      `Reason: ${ret.reason}`,
      `Good, back in stock: ${ret.good_pcs} pcs`,
      `Damaged: ${ret.damaged_pcs} pcs`,
      ...(notGiven ? [`${notGiven} item${notGiven === 1 ? '' : 's'} not supplied to the party - returned by the admin's decision`] : []),
      ...(cancelled ? [`Cancelled: ${ret.cancel_reason}`] : []),
    ],
    made_by: ret.made_by_name,
  };
  return { bill, pdf: await renderBillPdf(bill), filename: billFileName(bill) };
}

// ------------------------------------------------ item-wise credit notes
// Admin > Sales Returns > Create CN: pick the party, search an item. An item
// supplied to the party (on a handed-over order) is returned against its bill;
// an item never supplied shows "Not given" - only the owner / main admin can
// return it anyway, at today's rate (or the rate they enter).

const isManager = (admin) => ['OWNER', 'ADMIN'].includes(admin?.role);
const handedOver = (o) => o.order_status === ORDER_STATUS.COMPLETED;
const has = (text, q) => String(text || '').toLowerCase().includes(q);

/** Parties (by mobile) with at least one order, newest first. */
export async function returnParties({ q = '' } = {}) {
  const orders = await sheetsService.read('Orders', { fresh: true });
  const term = String(q).trim().toLowerCase();
  const byMobile = new Map();
  for (const o of [...orders].sort(newestFirst)) {
    if (o.order_status === ORDER_STATUS.CANCELLED) continue;
    const mobile = normalizeMobile(o.mobile_snapshot);
    if (!mobile) continue;
    const p = byMobile.get(mobile) || {
      mobile,
      party_name: o.business_name_snapshot || o.customer_name_snapshot,
      customer_name: o.customer_name_snapshot,
      city: o.city_snapshot,
      handed_over_orders: 0,
      last_order_at: o.created_at,
    };
    if (handedOver(o)) p.handed_over_orders += 1;
    byMobile.set(mobile, p);
  }
  const items = [...byMobile.values()]
    .filter((p) => !term || [p.party_name, p.customer_name, p.mobile, p.city].some((v) => has(v, term)))
    .slice(0, 30);
  return { items };
}

function partyOf(orders, mobile) {
  const mine = orders.filter((o) => normalizeMobile(o.mobile_snapshot) === mobile && o.order_status !== ORDER_STATUS.CANCELLED);
  if (!mine.length) throw notFound('No order of this party was found.');
  const latest = [...mine].sort(newestFirst)[0];
  return { mine, latest };
}

/** Today's price of one unit of a catalogue item, as an order item (for a "Not given" return). */
function catalogueItem(catalog, variantId, unitRate) {
  const quote = buildQuote({
    items: [{ variant_id: variantId, qty: 1 }], catalog, keep: { [variantId]: { qty: 1e9, unit_mrp: null } },
  });
  const l = quote.lines[0];
  if (!l || !catalog.variantsById.get(variantId)) return null;
  const rate = unitRate === null || unitRate === undefined ? Number(l.unit_price) || 0 : unitRate;
  const mrp = Number(l.unit_mrp) || 0;
  return {
    product_id: l.product_id,
    variant_id: l.variant_id,
    sku_snapshot: l.sku,
    product_name_snapshot: l.product_name,
    size_snapshot: l.size_name,
    color_snapshot: l.color_name,
    inventory_mode_snapshot: l.inventory_mode,
    units_per_box_snapshot: l.units_per_box,
    stock_components: l.stock_components,
    mrp_unit_snapshot: mrp,
    discount_percent_snapshot: mrp > 0 ? round2((1 - rate / mrp) * 100) : 0,
    qty: 1,
    line_total: round2(rate),
  };
}

/**
 * Search an item for the party's credit note:
 *  - given: the matching items of the party's handed-over orders, with what can still come back
 *  - not_given: catalogue items matching the search that were never supplied to the party
 */
export async function partyReturnItems({ mobile, q = '' }) {
  const m = normalizeMobile(mobile);
  const term = String(q).trim().toLowerCase();
  const data = await sheetsService.readMany(['Orders', 'Order_Items', 'Sales_Return_Items'], { fresh: true });
  const { mine } = partyOf(data.Orders, m);
  const orders = new Map(mine.filter(handedOver).map((o) => [o.order_id, o]));
  const returned = new Map();
  for (const r of data.Sales_Return_Items) {
    if (isActive(r) && r.order_item_id) returned.set(r.order_item_id, (returned.get(r.order_item_id) || 0) + (Number(r.qty) || 0));
  }
  const matches = (i) => !term || [i.sku_snapshot, i.product_name_snapshot].some((v) => has(v, term));
  const supplied = data.Order_Items.filter((i) => orders.has(i.order_id) && (i.status || 'ACTIVE') === 'ACTIVE');
  const given = supplied.filter(matches).map((i) => {
    const o = orders.get(i.order_id);
    const sold = Number(i.qty) || 0;
    const done = returned.get(i.order_item_id) || 0;
    const { item_colour: colour, sold_in: soldIn, pcs_per_box: perBox } = pcsColumns(i);
    return {
      order_item_id: i.order_item_id,
      order_id: o.order_id,
      bill_no: o.order_number,
      bill_date: o.completed_at || o.created_at,
      variant_id: i.variant_id,
      sku: i.sku_snapshot,
      product_name: i.product_name_snapshot,
      size: i.size_snapshot,
      colour,
      sold_in: soldIn,
      pcs_per_box: perBox,
      sold,
      returned: done,
      returnable: Math.max(0, sold - done),
      unit_amount: sold ? (Number(i.line_total) || 0) / sold : 0,
    };
  }).sort((a, b) => String(b.bill_date).localeCompare(String(a.bill_date))).slice(0, 60);

  let notGiven = [];
  if (term.length >= 2) {
    const catalog = await getCatalog();
    const suppliedVariants = new Set(supplied.map((i) => i.variant_id));
    const products = [...catalog.productsById.values()].filter((p) => p.status !== 'ARCHIVED' && (has(p.sku, term) || has(p.product_name, term)));
    const ids = new Set(products.map((p) => p.product_id));
    const candidates = [...catalog.variantsById.values()]
      .filter((v) => ids.has(v.product_id) && !suppliedVariants.has(v.variant_id))
      .slice(0, 60);
    for (const v of candidates) {
      const item = catalogueItem(catalog, v.variant_id);
      if (!item) continue;
      const { item_colour: colour, sold_in: soldIn, pcs_per_box: perBox } = pcsColumns(item);
      notGiven.push({
        variant_id: v.variant_id,
        sku: catalog.productsById.get(v.product_id)?.sku || item.sku_snapshot,
        product_name: item.product_name_snapshot,
        size: item.size_snapshot,
        colour,
        sold_in: soldIn,
        pcs_per_box: perBox,
        unit_rate: item.line_total,
      });
    }
  }
  return { given, not_given: notGiven };
}

/** Item-wise credit note for a party (several bills, and "Not given" items by the owner / main admin). */
export async function createPartyReturn({ mobile, reason, items: lines }, { admin, ip }) {
  if (lines.some((l) => !l.order_item_id) && !isManager(admin)) {
    throw forbidden('Only the owner or main admin can return an item that was not given to the party.');
  }
  return withLock(COMMERCE_LOCK, async () => {
    const m = normalizeMobile(mobile);
    const data = await sheetsService.readMany(['Orders', 'Order_Items', 'Sales_Returns', 'Sales_Return_Items', 'Inventory'], { fresh: true });
    const { mine, latest } = partyOf(data.Orders, m);
    const orders = new Map(mine.filter(handedOver).map((o) => [o.order_id, o]));
    const itemsById = new Map(data.Order_Items
      .filter((i) => orders.has(i.order_id) && (i.status || 'ACTIVE') === 'ACTIVE')
      .map((i) => [i.order_item_id, i]));

    // supplied items: never more than what is left of each line
    const asked = new Map();
    for (const l of lines.filter((x) => x.order_item_id)) {
      if (!itemsById.has(l.order_item_id)) throw badRequest('This item was not supplied to the party on a handed-over order.');
      asked.set(l.order_item_id, (asked.get(l.order_item_id) || 0) + l.qty);
    }
    const returned = new Map();
    for (const r of data.Sales_Return_Items) {
      if (isActive(r) && r.order_item_id) returned.set(r.order_item_id, (returned.get(r.order_item_id) || 0) + (Number(r.qty) || 0));
    }
    for (const [itemId, qty] of asked) {
      const item = itemsById.get(itemId);
      const left = (Number(item.qty) || 0) - (returned.get(itemId) || 0);
      if (qty > left) throw conflict('RETURN_TOO_MANY', `${item.product_name_snapshot} (bill ${item.order_number}): only ${left} left to return.`, { order_item_id: itemId, returnable: left });
    }

    const catalog = lines.some((l) => !l.order_item_id) ? await getCatalog({ fresh: true }) : null;
    const now = nowIso();
    const returnId = newId(ID_PREFIX.salesReturn);
    const returnNumber = nextReturnNumber(data.Sales_Returns);
    const units = [];
    const rows = lines.map((l) => {
      if (l.order_item_id) {
        const item = itemsById.get(l.order_item_id);
        const order = orders.get(item.order_id);
        units.push({ item: { ...item, qty: l.qty }, order, condition: l.condition });
        return returnItemRow({ item, order, qty: l.qty, condition: l.condition, returnId, returnNumber, now });
      }
      const item = catalogueItem(catalog, l.variant_id, l.unit_rate);
      if (!item) throw badRequest('This item is not in the catalogue.');
      units.push({ item: { ...item, qty: l.qty }, order: null, condition: l.condition });
      return returnItemRow({
        item, order: null, qty: l.qty, condition: l.condition, returnId, returnNumber, now, notGiven: true,
      });
    });

    // "less packing" of a bill comes off its own items in the same proportion
    const shareByOrder = new Map([...orders.values()].map((o) => [o.order_id,
      packingShare(o, data.Order_Items.filter((i) => i.order_id === o.order_id && (i.status || 'ACTIVE') === 'ACTIVE'))]));
    const subtotal = round2(sum(rows, (r) => r.amount));
    const packingLess = round2(sum(rows, (r) => (r.order_id ? r.amount * (shareByOrder.get(r.order_id) || 0) : 0)));
    const pcsOf = (condition) => sum(rows.filter((r) => r.condition === condition), (r) => r.qty_pcs);
    const bills = [...new Set(rows.map((r) => r.bill_no).filter(Boolean))];
    const billIds = [...new Set(rows.map((r) => r.order_id).filter(Boolean))];
    const header = {
      return_id: returnId,
      return_number: returnNumber,
      order_id: billIds.length === 1 ? billIds[0] : '',
      order_number: bills.join(', '),
      party_name: latest.business_name_snapshot || latest.customer_name_snapshot,
      customer_name: latest.customer_name_snapshot,
      mobile: m,
      city: latest.city_snapshot,
      reason,
      total_pcs: pcsOf(RETURN_CONDITION.GOOD) + pcsOf(RETURN_CONDITION.DAMAGED),
      good_pcs: pcsOf(RETURN_CONDITION.GOOD),
      damaged_pcs: pcsOf(RETURN_CONDITION.DAMAGED),
      subtotal,
      packing_less: packingLess,
      credit_amount: round2(subtotal - packingLess),
      status: RETURN_STATUS.ACTIVE,
      made_by_id: admin.admin_id,
      made_by_name: admin.name || admin.email || '',
      created_at: now,
    };

    const good = units.filter((u) => u.condition === RETURN_CONDITION.GOOD).map((u) => u.item);
    const deltas = new Map(Object.entries(piecesByInventory(good)).map(([v, n]) => [v, { stock: n }]));
    const inventory = inventoryDeltaOps(data.Inventory, deltas, { by: admin.admin_id, clamp: true });
    if (inventory.shortfalls.length) logger.warn(`Sales return ${returnNumber}: no inventory row for some items`, inventory.shortfalls);

    const notGiven = rows.filter((r) => r.not_given).length;
    await sheetsService.commit([
      ...inventory.ops,
      { op: 'append', sheet: 'Sales_Returns', rows: [header] },
      { op: 'append', sheet: 'Sales_Return_Items', rows },
      auditOp({
        admin, ip, action: AUDIT_ACTION.SALES_RETURN_CREATED, entity_type: 'Party', entity_id: m, reason,
        new_value: {
          return_number: returnNumber, bills, total_pcs: header.total_pcs, credit_amount: header.credit_amount,
          ...(notGiven ? { not_given_items: notGiven } : {}),
        },
      }),
    ]);
    logger.info(`Sales return ${returnNumber} for ${header.party_name}: ${header.total_pcs} pcs, credit ${header.credit_amount}${notGiven ? `, ${notGiven} not given (overwritten)` : ''}`);
    return { sales_return: view(header) };
  });
}
