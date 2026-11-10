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
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

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
    const rows = lines.map((l) => {
      const item = byId.get(l.order_item_id);
      const pcs = pcsColumns({ ...item, qty: l.qty });
      const amount = round2((Number(item.line_total) || 0) * l.qty / (Number(item.qty) || 1));
      return {
        return_item_id: newId(ID_PREFIX.salesReturnItem),
        return_id: returnId,
        return_number: returnNumber,
        order_item_id: item.order_item_id,
        order_id: order.order_id,
        bill_no: order.order_number,
        sku: item.sku_snapshot,
        product_name: item.product_name_snapshot,
        size: item.size_snapshot,
        item_colour: pcs.item_colour,
        sold_in: pcs.sold_in,
        qty: l.qty,
        qty_pcs: pcs.qty_pcs,
        rate_per_pc: pcs.qty_pcs ? round2(amount / pcs.qty_pcs) : 0,
        amount,
        condition: l.condition,
        status: RETURN_STATUS.ACTIVE,
        created_at: now,
      };
    });

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
    const good = rows.filter((r) => r.condition === RETURN_CONDITION.GOOD).map((r) => ({ ...items.get(r.order_item_id), qty: r.qty }));
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
  const bundle = await loadOrderBundle(ret.order_id, { byId: true });
  const originals = new Map(bundle.items.map((i) => [i.order_item_id, i]));
  const rows = data.Sales_Return_Items.filter((r) => r.return_id === id);
  const items = rows.map((r) => ({ ...originals.get(r.order_item_id), qty: r.qty, line_total: r.amount }));
  const settings = await getSettings();
  const productSkus = Object.fromEntries(data.Products.map((p) => [p.product_id, p.sku]));
  const cancelled = !isActive(ret);
  const bill = {
    ...buildBill({
      order: bundle.order, items, settings, productSkus,
    }),
    title: cancelled ? 'CREDIT NOTE (CANCELLED)' : 'CREDIT NOTE',
    number: ret.return_number,
    against: bundle.order.order_number,
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
      ...(cancelled ? [`Cancelled: ${ret.cancel_reason}`] : []),
    ],
    made_by: ret.made_by_name,
  };
  return { bill, pdf: await renderBillPdf(bill), filename: billFileName(bill) };
}
