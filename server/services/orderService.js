import { sheetsService } from './sheetsService.js';
import { auditOp } from './auditService.js';
import { buildCatalog, getCatalog } from './catalogService.js';
import { buildQuote } from './quoteService.js';
import { inventoryDeltaOps } from './inventoryService.js';
import { customerUpsertOps } from './customerService.js';
import { getSettings, parseSettings } from './settingsService.js';
import { CATALOG_SHEETS } from '../config/schema.js';
import {
  ACTOR, AUDIT_ACTION, CUSTOMER_TYPE, ITEM_STATUS, ORDER_STATUS, PAYMENT_STATUS, STOCK_STATE, PAYMENT_MODE,
} from '../config/constants.js';
import {
  customerFromToken, resolveExistingCustomer, maskMobile, autoExistingOps,
} from './existingCustomerService.js';
import {
  withLock, COMMERCE_LOCK, assertOrderEditable, isOrderEditable, canSubmitPayment, isOfflineOrder,
} from '../utils/lockManager.js';
import {
  STATE_LABELS, canAdminTransition, canCancel, canReopen, allowedAdminTargets,
} from '../utils/orderStateMachine.js';
import { once } from '../utils/idempotency.js';
import { newId, ID_PREFIX } from '../utils/idGenerator.js';
import { nowIso, istDate, hoursSince } from '../utils/dates.js';
import { nextOrderNumber, normalizeOrderNumber } from '../utils/orderNumber.js';
import { orderAccessToken, verifyOrderAccessToken, normalizeMobile } from '../utils/orderToken.js';
import {
  AppError, badRequest, conflict, notFound, unprocessable, MESSAGES,
} from '../utils/errors.js';
import { formatINR, round2 } from '../utils/money.js';
import { piecesByInventory, encodeComponents } from '../utils/stockComponents.js';
import { logger } from '../utils/logger.js';

export const ORDER_SHEETS = ['Orders', 'Order_Items', 'Payments', 'Order_Status_History'];

// ------------------------------------------------------------------ helpers
export const activeItems = (items, orderId) => items.filter((i) => i.order_id === orderId && i.status === ITEM_STATUS.ACTIVE);

// pieces per inventory row (an auto box holds pieces of its colours' rows)
const qtyMap = (items) => piecesByInventory(items);

function historyRow(order, from, to, actorType, actorId, note) {
  return {
    history_id: newId(ID_PREFIX.history),
    order_id: order.order_id,
    order_number: order.order_number,
    from_status: from || '',
    to_status: to,
    actor_type: actorType,
    actor_id: actorId || '',
    note: note || '',
    created_at: nowIso(),
  };
}
export const historyOp = (...args) => ({ op: 'append', sheet: 'Order_Status_History', rows: [historyRow(...args)] });

function itemRows(order, revision, quote, now) {
  return quote.lines.map((l) => ({
    order_item_id: newId(ID_PREFIX.orderItem),
    order_id: order.order_id,
    order_number: order.order_number,
    revision,
    product_id: l.product_id,
    variant_id: l.variant_id,
    sku_snapshot: l.sku,
    product_name_snapshot: l.product_name,
    category_snapshot: l.category_name,
    inventory_mode_snapshot: l.inventory_mode,
    size_snapshot: l.size_name,
    color_snapshot: l.color_name,
    box_snapshot: l.box_label ? `${l.box_label}${l.mixed_color_description ? ` - ${l.mixed_color_description}` : ''}` : '',
    units_per_box_snapshot: l.units_per_box,
    stock_components: encodeComponents(l),
    qty: l.qty,
    mrp_unit_snapshot: l.unit_mrp,
    discount_percent_snapshot: l.discount_percent,
    wholesale_unit_snapshot: l.unit_price,
    line_mrp_total: l.line_mrp,
    line_total: l.line_total,
    status: ITEM_STATUS.ACTIVE,
    created_at: now,
  }));
}

// `deduction` = "Less: Packing charges" the admin set on the order (kept when
// the customer edits the order; the minimum order is checked before it)
function totalsFields(quote, deduction = 0) {
  return {
    mrp_subtotal: quote.gross_mrp_subtotal,
    discount_mode_snapshot: quote.discount_mode,
    discount_basis_snapshot: quote.discount_basis,
    discount_basis_amount: quote.discount_basis_amount,
    discount_percent: quote.discount_percent,
    slab_id_snapshot: quote.current_slab?.slab_id || '',
    discount_amount: quote.discount_amount,
    final_payable: round2(Math.max(0, quote.final_payable - (Number(deduction) || 0))),
    total_qty: quote.total_qty,
    minimum_order_value_snapshot: quote.minimum_order_value,
    minimum_order_met: quote.minimum_order_met,
    customer_type_snapshot: quote.customer_type,
  };
}

// An unpaid order placed by a verified existing customer keeps the exemption
// while it is edited - as long as the number is still in the list.
function existingCustomerForOrder(catalog, order) {
  if (order.customer_type_snapshot !== CUSTOMER_TYPE.EXISTING) return null;
  const status = resolveExistingCustomer(catalog.existingCustomers, catalog.settings, order.mobile_snapshot);
  return status.existing ? status : null;
}

export function assertQuoteOrderable(quote, clientFinal) {
  if (!quote.lines.length) throw badRequest('Your cart is empty.');
  if (quote.has_issues) {
    throw conflict('STOCK_CHANGED', MESSAGES.STOCK_CHANGED, {
      lines: quote.lines.filter((l) => l.issue).map((l) => ({ variant_id: l.variant_id, product_name: l.product_name, issue: l.issue })),
    });
  }
  if (!quote.minimum_order_met) {
    throw unprocessable('MIN_ORDER_NOT_MET', `${MESSAGES.MIN_ORDER_NOT_MET} Add ${formatINR(quote.amount_to_minimum)} more to continue.`, {
      minimum_order_value: quote.minimum_order_value,
      final_payable: quote.final_payable,
      amount_to_minimum: quote.amount_to_minimum,
    });
  }
  if (clientFinal !== null && clientFinal !== undefined && Math.abs(Number(clientFinal) - quote.final_payable) > 0.009) {
    throw conflict('PRICE_CHANGED', MESSAGES.PRICE_CHANGED, { final_payable: quote.final_payable });
  }
}

/** The customer may download the bill once the payment is submitted (never for cancelled orders). */
export function billAvailable(order) {
  if (order.order_status === ORDER_STATUS.CANCELLED) return false;
  if (isOfflineOrder(order)) return ![ORDER_STATUS.DRAFT, ORDER_STATUS.PAYMENT_PENDING].includes(order.order_status);
  return [PAYMENT_STATUS.SUBMITTED, PAYMENT_STATUS.VERIFIED].includes(order.payment_status);
}

// what the customer sees for an order waiting for the team (no online payment)
const AWAITING_CONFIRMATION = 'Awaiting confirmation';
const customerStatusLabel = (order) => (isOfflineOrder(order) && order.order_status === ORDER_STATUS.PAYMENT_PENDING
  ? AWAITING_CONFIRMATION
  : STATE_LABELS[order.order_status] || order.order_status);

export function authorizeOrder(order, token) {
  if (!verifyOrderAccessToken(order.order_id, token)) {
    throw new AppError(403, 'ORDER_ACCESS_REQUIRED', 'Please verify this order with your order number and mobile number.');
  }
}

function paymentTotals(order, payments) {
  const verified = payments.filter((p) => p.status === PAYMENT_STATUS.VERIFIED).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const final = Number(order.final_payable) || 0;
  return { amount_paid_verified: round2(verified), balance_due: round2(Math.max(0, final - verified)) };
}

export async function loadOrderBundle(orderNumberOrId, { fresh = true, byId = false } = {}) {
  const data = await sheetsService.readMany(ORDER_SHEETS, { fresh });
  const key = byId ? orderNumberOrId : normalizeOrderNumber(orderNumberOrId);
  const order = data.Orders.find((o) => (byId ? o.order_id === key || o.order_number === normalizeOrderNumber(key) : o.order_number === key));
  if (!order) throw notFound('Order not found. Please check the order number.');
  return {
    order,
    items: data.Order_Items.filter((i) => i.order_id === order.order_id),
    payments: data.Payments.filter((p) => p.order_id === order.order_id).sort((a, b) => (a.submitted_at > b.submitted_at ? 1 : -1)),
    history: data.Order_Status_History.filter((h) => h.order_id === order.order_id).sort((a, b) => (a.created_at > b.created_at ? 1 : -1)),
  };
}

const itemView = (i) => ({
  order_item_id: i.order_item_id,
  product_id: i.product_id,
  variant_id: i.variant_id,
  sku: i.sku_snapshot,
  product_name: i.product_name_snapshot,
  category: i.category_snapshot,
  inventory_mode: i.inventory_mode_snapshot,
  size: i.size_snapshot,
  color: i.color_snapshot,
  box: i.box_snapshot,
  units_per_box: i.units_per_box_snapshot,
  qty: i.qty,
  mrp_unit: i.mrp_unit_snapshot,
  discount_percent: i.discount_percent_snapshot,
  unit_price: i.wholesale_unit_snapshot,
  line_mrp: i.line_mrp_total,
  line_total: i.line_total,
  revision: i.revision,
  status: i.status,
});

const totalsView = (o) => ({
  packing_deduction: Number(o.packing_deduction) || 0,
  mrp_subtotal: o.mrp_subtotal,
  discount_mode: o.discount_mode_snapshot,
  discount_basis: o.discount_basis_snapshot,
  discount_basis_amount: o.discount_basis_amount,
  discount_percent: o.discount_percent,
  effective_discount_percent: o.mrp_subtotal ? round2(((o.discount_amount || 0) / o.mrp_subtotal) * 100) : 0,
  discount_amount: o.discount_amount,
  final_payable: o.final_payable,
  total_qty: o.total_qty,
  minimum_order_value: o.minimum_order_value_snapshot,
  minimum_order_met: o.minimum_order_met,
  customer_type: o.customer_type_snapshot || CUSTOMER_TYPE.NEW,
});

/** What a customer (holding the access token) may see. No admin data. */
export function customerOrderView({ order, items, payments, history }, settings = {}) {
  const totals = paymentTotals(order, payments);
  const editable = isOrderEditable(order);
  const notices = [];
  if (order.locked && order.order_status !== ORDER_STATUS.CANCELLED) {
    notices.push({ type: 'info', code: 'ORDER_LOCKED', text: MESSAGES.ORDER_LOCKED_AFTER_PAYMENT });
  }
  if (order.order_status === ORDER_STATUS.PAYMENT_REJECTED) {
    notices.push({ type: 'error', code: 'PAYMENT_REJECTED', text: 'Your payment could not be verified. Please check the remarks and submit the correct payment details.' });
  }
  if (order.order_status === ORDER_STATUS.CANCELLED) {
    notices.push({ type: 'error', code: 'ORDER_CANCELLED', text: `This order has been cancelled.${order.cancel_reason ? ` Reason: ${order.cancel_reason}` : ''}` });
  }
  const expiryHours = Number(settings.reservation_expiry_hours) || 0;
  return {
    order_number: order.order_number,
    created_at: order.created_at,
    updated_at: order.updated_at,
    order_status: order.order_status,
    status_label: customerStatusLabel(order),
    payment_status: order.payment_status,
    payment_mode: isOfflineOrder(order) ? PAYMENT_MODE.OFFLINE : PAYMENT_MODE.ONLINE,
    locked: order.locked === true,
    locked_at: order.locked_at,
    payment_submitted_at: order.payment_submitted_at,
    verified_at: order.verified_at,
    customer: {
      customer_name: order.customer_name_snapshot,
      business_name: order.business_name_snapshot,
      mobile: order.mobile_snapshot,
      alternate_mobile: order.alternate_mobile_snapshot,
      whatsapp: order.whatsapp_snapshot,
      email: order.email_snapshot,
      billing_address: order.billing_address_snapshot,
      shipping_address: order.shipping_address_snapshot,
      city: order.city_snapshot,
      state: order.state_snapshot,
      pincode: order.pincode_snapshot,
      gstin: order.gstin_snapshot,
    },
    order_notes: order.order_notes,
    items: activeItems(items, order.order_id).map(itemView),
    totals: totalsView(order),
    payments: payments.map((p) => ({
      payment_id: p.payment_id,
      amount: p.amount,
      utr: p.utr,
      status: p.status,
      submitted_at: p.submitted_at,
      verified_at: p.verified_at,
      remarks: p.status === PAYMENT_STATUS.REJECTED ? p.remarks : '',
    })),
    ...totals,
    amount_to_pay: totals.balance_due,
    timeline: history.map((h) => ({
      status: h.to_status,
      label: STATE_LABELS[h.to_status] || h.to_status,
      at: h.created_at,
      note: h.note,
    })),
    dispatch: {
      courier_name: order.courier_name,
      tracking_number: order.tracking_number,
      dispatch_note: order.dispatch_note,
      dispatched_at: order.dispatched_at,
    },
    permissions: {
      can_edit: editable,
      can_submit_payment: canSubmitPayment(order) && totals.balance_due > 0,
      can_download_bill: billAvailable(order),
    },
    payment_window_hours: editable && expiryHours > 0 && !isOfflineOrder(order) ? expiryHours : null,
    notices,
  };
}

// ---------------------------------------------------------------- customer
export async function createDraftOrder(input, { ip, customerToken } = {}) {
  return once('draft', input.idempotency_key, () => withLock(COMMERCE_LOCK, async () => {
    const data = await sheetsService.readMany([...CATALOG_SHEETS, 'Orders', 'Customers'], { fresh: true });
    const duplicate = data.Orders.find((o) => o.idempotency_key === input.idempotency_key);
    if (duplicate) {
      return { duplicate: true, order_number: duplicate.order_number, access_token: orderAccessToken(duplicate.order_id) };
    }
    const catalog = buildCatalog(data);
    // Exemption only when the WhatsApp-verified number IS the order's mobile
    // and it is still in the Existing_Customers list (fresh data).
    const verified = customerFromToken(catalog, customerToken);
    // any of the customer's registered numbers (main or alternate) may be used on the order
    const sameNumber = verified.existing && (verified.numbers || [verified.mobile]).includes(input.customer.mobile);
    const quote = buildQuote({ items: input.items, catalog, customer: sameNumber ? verified : null });
    if (verified.existing && !sameNumber && !quote.minimum_order_met) {
      throw unprocessable('MIN_ORDER_NOT_MET', `The minimum order exemption applies only to your verified number ${maskMobile(verified.mobile)}. Use that mobile number to order without the minimum.`);
    }
    assertQuoteOrderable(quote, input.client_final_payable);

    const c = input.customer;
    const { customer_id: customerId, ops: customerOps } = customerUpsertOps(data.Customers, c);
    const now = nowIso();
    const order = {
      order_id: newId(ID_PREFIX.order),
      order_number: nextOrderNumber(data.Orders, catalog.settings.order_prefix),
      customer_id: customerId,
      customer_name_snapshot: c.customer_name,
      business_name_snapshot: c.business_name,
      mobile_snapshot: c.mobile,
      whatsapp_snapshot: c.whatsapp,
      email_snapshot: c.email,
      billing_address_snapshot: c.billing_address,
      shipping_address_snapshot: c.shipping_address,
      city_snapshot: c.city,
      state_snapshot: c.state,
      pincode_snapshot: c.pincode,
      gstin_snapshot: c.gstin,
      alternate_mobile_snapshot: c.alternate_mobile,
      order_notes: c.order_notes,
      ...totalsFields(quote),
      order_status: ORDER_STATUS.PAYMENT_PENDING,
      payment_status: PAYMENT_STATUS.PENDING,
      locked: false,
      stock_state: STOCK_STATE.RESERVED,
      revision: 1,
      idempotency_key: input.idempotency_key,
      // online payment switched off in Settings -> thank-you page, the team confirms the order
      payment_mode_snapshot: catalog.settings.online_payment_enabled === false ? PAYMENT_MODE.OFFLINE : PAYMENT_MODE.ONLINE,
      created_at: now,
      updated_at: now,
    };
    const deltas = new Map(Object.entries(qtyMap(quote.lines)).map(([v, n]) => [v, { reserved: n }]));
    const inventory = inventoryDeltaOps(data.Inventory, deltas, { by: ACTOR.CUSTOMER });

    await sheetsService.commit([
      ...inventory.ops,
      { op: 'append', sheet: 'Orders', rows: [order] },
      { op: 'append', sheet: 'Order_Items', rows: itemRows(order, 1, quote, now) },
      historyOp(order, '', ORDER_STATUS.PAYMENT_PENDING, ACTOR.CUSTOMER, customerId, 'Order placed - awaiting payment'),
      ...customerOps,
      auditOp({
        actorType: ACTOR.CUSTOMER, ip, action: AUDIT_ACTION.ORDER_CREATED, entity_type: 'Order', entity_id: order.order_id,
        new_value: { order_number: order.order_number, final_payable: order.final_payable, lines: quote.lines.length, mobile: c.mobile },
      }),
    ]);
    logger.info(`Order created ${order.order_number} (${formatINR(order.final_payable)})`);
    return { duplicate: false, order_number: order.order_number, access_token: orderAccessToken(order.order_id) };
  }));
}

export async function getCustomerOrder(orderNumber, token) {
  const [bundle, settings] = await Promise.all([loadOrderBundle(orderNumber), getSettings()]);
  authorizeOrder(bundle.order, token);
  return customerOrderView(bundle, settings);
}

/**
 * Short status cards for the orders saved on a customer's device (cart
 * "Your orders"). Read-only; every entry needs its own order access token -
 * entries with a wrong token or unknown number are left out silently.
 * `closed` = handed over (COMPLETED) or cancelled: the device stops showing it.
 */
export async function activeOrderSummaries(entries) {
  if (!entries.length) return [];
  const data = await sheetsService.readMany(['Orders', 'Order_Items', 'Payments'], { fresh: false });
  const out = [];
  for (const { order_number: n, token } of entries) {
    const order = data.Orders.find((o) => o.order_number === normalizeOrderNumber(n));
    if (!order || !verifyOrderAccessToken(order.order_id, token)) continue;
    const items = activeItems(data.Order_Items, order.order_id);
    const totals = paymentTotals(order, data.Payments.filter((p) => p.order_id === order.order_id));
    out.push({
      order_number: order.order_number,
      created_at: order.created_at,
      order_status: order.order_status,
      status_label: customerStatusLabel(order),
      payment_status: order.payment_status,
      payment_mode: isOfflineOrder(order) ? PAYMENT_MODE.OFFLINE : PAYMENT_MODE.ONLINE,
      final_payable: Number(order.final_payable) || 0,
      amount_to_pay: totals.balance_due,
      lines: items.length,
      total_qty: Number(order.total_qty) || 0,
      // pieces: a box line counts its pieces per box
      total_pcs: items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.units_per_box_snapshot) || 1), 0),
      can_submit_payment: canSubmitPayment(order) && totals.balance_due > 0,
      can_download_bill: billAvailable(order),
      closed: [ORDER_STATUS.COMPLETED, ORDER_STATUS.CANCELLED].includes(order.order_status),
    });
  }
  return out;
}

export async function trackOrder({ order_number: orderNumber, mobile }) {
  const generic = notFound('No order found with this order number and mobile number.');
  let bundle;
  try {
    bundle = await loadOrderBundle(orderNumber, { fresh: false });
  } catch (err) {
    if (err.status === 404) throw generic;
    throw err;
  }
  const m = normalizeMobile(mobile);
  const { order } = bundle;
  const orderNumbers = [order.mobile_snapshot, order.whatsapp_snapshot, order.alternate_mobile_snapshot].filter(Boolean).map(normalizeMobile);
  if (!orderNumbers.includes(m)) throw generic;
  const settings = await getSettings();
  return { access_token: orderAccessToken(order.order_id), order: customerOrderView(bundle, settings) };
}

/** Customer edit of an unpaid order. Backend re-validates everything. */
export async function updateOrderItems(orderNumber, token, { items, client_final_payable: clientFinal }, { ip } = {}) {
  return withLock(COMMERCE_LOCK, async () => {
    const data = await sheetsService.readMany([...CATALOG_SHEETS, ...ORDER_SHEETS], { fresh: true });
    const order = data.Orders.find((o) => o.order_number === normalizeOrderNumber(orderNumber));
    if (!order) throw notFound('Order not found.');
    authorizeOrder(order, token);
    assertOrderEditable(order);

    const current = activeItems(data.Order_Items, order.order_id);
    const held = order.stock_state === STOCK_STATE.RESERVED ? qtyMap(current) : {};
    const catalog = buildCatalog(data);
    const quote = buildQuote({ items, catalog, heldByOrder: held, customer: existingCustomerForOrder(catalog, order) });
    assertQuoteOrderable(quote, clientFinal);

    const now = nowIso();
    const revision = (Number(order.revision) || 1) + 1;
    const newQty = qtyMap(quote.lines);
    const deltas = new Map();
    for (const v of new Set([...Object.keys(held), ...Object.keys(newQty)])) {
      const d = (newQty[v] || 0) - (held[v] || 0);
      if (d) deltas.set(v, { reserved: d });
    }
    const inventory = inventoryDeltaOps(data.Inventory, deltas, { by: ACTOR.CUSTOMER });
    const before = totalsView(order);
    const ops = [
      ...inventory.ops,
      ...current.map((i) => ({ op: 'update', sheet: 'Order_Items', id: i.order_item_id, patch: { status: ITEM_STATUS.REPLACED } })),
      { op: 'append', sheet: 'Order_Items', rows: itemRows(order, revision, quote, now) },
      { op: 'update', sheet: 'Orders', id: order.order_id, patch: { ...totalsFields(quote, order.packing_deduction), revision, stock_state: STOCK_STATE.RESERVED, updated_at: now } },
      auditOp({
        actorType: ACTOR.CUSTOMER, ip, action: AUDIT_ACTION.ORDER_UPDATED_BY_CUSTOMER, entity_type: 'Order', entity_id: order.order_id,
        old_value: { revision: order.revision, final_payable: before.final_payable, items: current.length },
        new_value: { revision, final_payable: quote.final_payable, items: quote.lines.length },
      }),
    ];
    await sheetsService.commit(ops);
    return getCustomerOrder(order.order_number, token);
  });
}

/** Preview (no writes). Uses cached catalog; final validation happens on save. */
export async function recalculateOrder(orderNumber, token, { items } = {}) {
  const bundle = await loadOrderBundle(orderNumber);
  authorizeOrder(bundle.order, token);
  const current = activeItems(bundle.items, bundle.order.order_id);
  const editable = isOrderEditable(bundle.order);
  const held = editable && bundle.order.stock_state === STOCK_STATE.RESERVED ? qtyMap(current) : {};
  const catalog = await getCatalog();
  const quote = buildQuote({
    items: items ?? current.map((i) => ({ variant_id: i.variant_id, qty: i.qty })),
    catalog,
    heldByOrder: held,
    customer: existingCustomerForOrder(catalog, bundle.order),
  });
  return { editable, locked: bundle.order.locked === true, quote };
}

export async function lockOrder(orderNumber, token, { ip } = {}) {
  return withLock(COMMERCE_LOCK, async () => {
    const { order } = await loadOrderBundle(orderNumber);
    authorizeOrder(order, token);
    if (order.locked) return { locked: true, order_status: order.order_status, message: MESSAGES.ORDER_LOCKED_AFTER_PAYMENT };
    if ([PAYMENT_STATUS.SUBMITTED, PAYMENT_STATUS.VERIFIED].includes(order.payment_status)) {
      const now = nowIso();
      await sheetsService.commit([
        { op: 'update', sheet: 'Orders', id: order.order_id, patch: { locked: true, locked_at: now, updated_at: now } },
        auditOp({ actorType: ACTOR.CUSTOMER, ip, action: AUDIT_ACTION.ORDER_STATUS_UPDATED, entity_type: 'Order', entity_id: order.order_id, new_value: { locked: true } }),
      ]);
      return { locked: true, order_status: order.order_status, message: MESSAGES.ORDER_LOCKED_AFTER_PAYMENT };
    }
    throw conflict('PAYMENT_REQUIRED', 'Your order is locked automatically when you submit payment confirmation.');
  });
}

// ------------------------------------------------------------------- admin
const orderSummary = (o) => ({
  order_id: o.order_id,
  order_number: o.order_number,
  created_at: o.created_at,
  updated_at: o.updated_at,
  customer_name: o.customer_name_snapshot,
  business_name: o.business_name_snapshot,
  mobile: o.mobile_snapshot,
  city: o.city_snapshot,
  final_payable: o.final_payable,
  total_qty: o.total_qty,
  order_status: o.order_status,
  payment_status: o.payment_status,
  payment_mode_snapshot: isOfflineOrder(o) ? PAYMENT_MODE.OFFLINE : PAYMENT_MODE.ONLINE,
  locked: o.locked === true,
  customer_type: o.customer_type_snapshot || CUSTOMER_TYPE.NEW,
});

export async function listOrdersAdmin({ q, order_status: orderStatus, payment_status: paymentStatus, customer_type: customerType, locked, from, to, page = 1, limit = 50 } = {}) {
  const orders = await sheetsService.read('Orders', { fresh: true });
  const counts = { total: orders.length, by_order_status: {}, by_payment_status: {} };
  for (const o of orders) {
    counts.by_order_status[o.order_status] = (counts.by_order_status[o.order_status] || 0) + 1;
    counts.by_payment_status[o.payment_status] = (counts.by_payment_status[o.payment_status] || 0) + 1;
  }
  const needle = String(q || '').trim().toLowerCase();
  const digits = needle.replace(/\D/g, '');
  const filtered = orders.filter((o) => {
    if (orderStatus && o.order_status !== orderStatus) return false;
    if (paymentStatus && o.payment_status !== paymentStatus) return false;
    if (customerType && (o.customer_type_snapshot || CUSTOMER_TYPE.NEW) !== customerType) return false;
    if (locked === 'true' && !o.locked) return false;
    if (locked === 'false' && o.locked) return false;
    const day = o.created_at ? istDate(new Date(o.created_at)) : '';
    if (from && day < from) return false;
    if (to && day > to) return false;
    if (!needle) return true;
    return [o.order_number, o.customer_name_snapshot, o.business_name_snapshot, o.city_snapshot, o.gstin_snapshot, o.email_snapshot]
      .some((v) => String(v).toLowerCase().includes(needle))
      || (digits.length >= 4 && [o.mobile_snapshot, o.whatsapp_snapshot].some((v) => String(v).includes(digits)));
  }).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const size = Math.min(200, Math.max(1, Number(limit) || 50));
  const p = Math.max(1, Number(page) || 1);
  return {
    counts,
    total: filtered.length,
    page: p,
    limit: size,
    items: filtered.slice((p - 1) * size, p * size).map(orderSummary),
  };
}

export async function getOrderAdmin(idOrNumber) {
  const data = await sheetsService.readMany([...ORDER_SHEETS, 'Audit_Log'], { fresh: true });
  const key = String(idOrNumber);
  const order = data.Orders.find((o) => o.order_id === key || o.order_number === normalizeOrderNumber(key));
  if (!order) throw notFound('Order not found.');
  const items = data.Order_Items.filter((i) => i.order_id === order.order_id);
  const payments = data.Payments.filter((p) => p.order_id === order.order_id).sort((a, b) => (a.submitted_at > b.submitted_at ? 1 : -1));
  const paymentIds = new Set(payments.map((p) => p.payment_id));
  const totals = paymentTotals(order, payments);
  const revisions = {};
  for (const i of items) (revisions[i.revision] ||= []).push(itemView(i));
  return {
    order: { ...order, idempotency_key: undefined },
    status_label: STATE_LABELS[order.order_status] || order.order_status,
    items: activeItems(items, order.order_id).map(itemView),
    item_revisions: revisions,
    totals: totalsView(order),
    ...totals,
    payments: payments.map((p) => ({ ...p, idempotency_key: undefined, proof_view_url: p.proof_file_id ? `/api/admin/payments/${p.payment_id}/proof` : '' })),
    history: data.Order_Status_History.filter((h) => h.order_id === order.order_id).sort((a, b) => (a.created_at > b.created_at ? 1 : -1)),
    audit: data.Audit_Log.filter((a) => a.entity_id === order.order_id || paymentIds.has(a.entity_id)).sort((a, b) => (a.timestamp > b.timestamp ? 1 : -1)),
    actions: {
      allowed_statuses: allowedAdminTargets(order, { balanceDue: totals.balance_due }),
      can_reopen: canReopen(order).ok,
      can_cancel: canCancel(order).ok,
    },
  };
}

export async function updateOrderStatusAdmin(id, body, { admin, ip }) {
  return withLock(COMMERCE_LOCK, async () => {
    const data = await sheetsService.readMany(['Orders', 'Payments', 'Order_Items', 'Inventory', 'Existing_Customers', 'Settings'], { fresh: true });
    const order = data.Orders.find((o) => o.order_id === id || o.order_number === normalizeOrderNumber(id));
    if (!order) throw notFound('Order not found.');
    const totals = paymentTotals(order, data.Payments.filter((p) => p.order_id === order.order_id));
    const check = canAdminTransition(order, body.status, { balanceDue: totals.balance_due });
    if (!check.ok) throw conflict('INVALID_TRANSITION', check.reason);
    const now = nowIso();
    const patch = { order_status: body.status, updated_at: now };
    const stockOps = [];
    if (body.status === ORDER_STATUS.PAYMENT_VERIFIED) {
      // Balance already covered by verified payments: lock and commit stock.
      Object.assign(patch, { payment_status: PAYMENT_STATUS.VERIFIED, verified_at: now, locked: true, locked_at: order.locked_at || now });
      if (order.stock_state === STOCK_STATE.RESERVED) {
        const deltas = new Map();
        for (const [v, n] of Object.entries(piecesByInventory(activeItems(data.Order_Items, order.order_id)))) {
          deltas.set(v, { stock: -n, reserved: -n });
        }
        stockOps.push(...inventoryDeltaOps(data.Inventory, deltas, { by: admin.admin_id, clamp: true }).ops);
        patch.stock_state = STOCK_STATE.DEDUCTED;
      }
      // first paid order: the customer becomes an existing customer
      stockOps.push(...autoExistingOps({ order, existingRows: data.Existing_Customers, settings: parseSettings(data.Settings), admin, ip, now }));
    }
    if (isOfflineOrder(order) && order.order_status === ORDER_STATUS.PAYMENT_PENDING) {
      // order without online payment confirmed by the team: lock it and commit the stock
      Object.assign(patch, { locked: true, locked_at: order.locked_at || now });
      if (order.stock_state === STOCK_STATE.RESERVED) {
        const deltas = new Map();
        for (const [v, n] of Object.entries(piecesByInventory(activeItems(data.Order_Items, order.order_id)))) {
          deltas.set(v, { stock: -n, reserved: -n });
        }
        stockOps.push(...inventoryDeltaOps(data.Inventory, deltas, { by: admin.admin_id, clamp: true }).ops);
        patch.stock_state = STOCK_STATE.DEDUCTED;
      }
      stockOps.push(...autoExistingOps({ order, existingRows: data.Existing_Customers, settings: parseSettings(data.Settings), admin, ip, now }));
    }
    if (body.status === ORDER_STATUS.DISPATCHED) {
      Object.assign(patch, {
        dispatched_at: now, courier_name: body.courier_name || order.courier_name,
        tracking_number: body.tracking_number || order.tracking_number, dispatch_note: body.dispatch_note || order.dispatch_note,
      });
    }
    if (body.status === ORDER_STATUS.COMPLETED) patch.completed_at = now;
    await sheetsService.commit([
      ...stockOps,
      { op: 'update', sheet: 'Orders', id: order.order_id, patch },
      historyOp(order, order.order_status, body.status, ACTOR.ADMIN, admin.admin_id, body.note),
      auditOp({
        admin, ip, action: AUDIT_ACTION.ORDER_STATUS_UPDATED, entity_type: 'Order', entity_id: order.order_id,
        old_value: { order_status: order.order_status }, new_value: patch, notes: body.note,
      }),
    ]);
    return getOrderAdmin(order.order_id);
  });
}

function releaseDeltas(order, items) {
  const deltas = new Map();
  for (const [v, n] of Object.entries(qtyMap(items))) {
    const d = { stock: 0, reserved: 0 };
    if (order.stock_state === STOCK_STATE.RESERVED) d.reserved -= n;
    if (order.stock_state === STOCK_STATE.DEDUCTED) d.stock += n;
    deltas.set(v, d);
  }
  return deltas;
}

export async function cancelOrderAdmin(id, { reason }, { admin, ip, actorType = ACTOR.ADMIN } = {}) {
  return withLock(COMMERCE_LOCK, async () => {
    const data = await sheetsService.readMany(['Orders', 'Order_Items', 'Inventory'], { fresh: true });
    const order = data.Orders.find((o) => o.order_id === id || o.order_number === normalizeOrderNumber(id));
    if (!order) throw notFound('Order not found.');
    const check = canCancel(order);
    if (!check.ok) throw conflict('INVALID_TRANSITION', check.reason);
    const items = activeItems(data.Order_Items, order.order_id);
    const inventory = inventoryDeltaOps(data.Inventory, releaseDeltas(order, items), { by: admin?.admin_id || actorType, clamp: true });
    const now = nowIso();
    const patch = {
      order_status: ORDER_STATUS.CANCELLED, locked: true, locked_at: order.locked_at || now,
      stock_state: STOCK_STATE.RELEASED, cancel_reason: reason, cancelled_at: now, updated_at: now,
    };
    await sheetsService.commit([
      ...inventory.ops,
      { op: 'update', sheet: 'Orders', id: order.order_id, patch },
      historyOp(order, order.order_status, ORDER_STATUS.CANCELLED, actorType, admin?.admin_id, reason),
      auditOp({
        admin, ip, actorType, action: AUDIT_ACTION.ORDER_CANCELLED, entity_type: 'Order', entity_id: order.order_id, reason,
        old_value: { order_status: order.order_status, stock_state: order.stock_state }, new_value: patch,
        notes: inventory.shortfalls.length ? `Stock shortfall while releasing: ${JSON.stringify(inventory.shortfalls)}` : undefined,
      }),
    ]);
    return getOrderAdmin(order.order_id);
  });
}

/**
 * ADMIN REOPEN: the only way a locked order becomes editable again.
 * Requires authentication, explicit confirmation and a reason; the previous
 * and new state are written to Audit_Log in the same atomic batch.
 */
/**
 * "Less: Packing charges": a flat amount the admin takes off the order total
 * (e.g. the customer does not want boxes). 0 removes it. Not for cancelled or
 * handed-over orders, and the total never goes below payments already verified.
 */
export async function setPackingDeduction(id, { amount, note }, { admin, ip }) {
  return withLock(COMMERCE_LOCK, async () => {
    const data = await sheetsService.readMany(['Orders', 'Payments'], { fresh: true });
    const order = data.Orders.find((o) => o.order_id === id || o.order_number === normalizeOrderNumber(id));
    if (!order) throw notFound('Order not found.');
    if ([ORDER_STATUS.CANCELLED, ORDER_STATUS.COMPLETED].includes(order.order_status)) {
      throw conflict('INVALID_TRANSITION', `Packing charges cannot be changed on a ${STATE_LABELS[order.order_status]} order.`);
    }
    const current = Number(order.packing_deduction) || 0;
    const base = round2((Number(order.final_payable) || 0) + current); // total before the deduction
    const value = round2(Number(amount) || 0);
    if (value < 0) throw badRequest('Enter 0 or more.');
    if (value > base) throw badRequest(`Packing charges cannot be more than the order total ${formatINR(base)}.`);
    const { amount_paid_verified: verified } = paymentTotals(order, data.Payments.filter((p) => p.order_id === order.order_id));
    if (round2(base - value) < verified) {
      throw conflict('PAYMENT_ALREADY_VERIFIED', `${formatINR(verified)} is already verified for this order - the total cannot go below it.`);
    }
    if (value === current) return getOrderAdmin(order.order_id);
    const now = nowIso();
    const patch = { packing_deduction: value || null, final_payable: round2(base - value), updated_at: now };
    await sheetsService.commit([
      { op: 'update', sheet: 'Orders', id: order.order_id, patch },
      auditOp({
        admin, ip, action: AUDIT_ACTION.ORDER_PACKING_CHARGES_UPDATED, entity_type: 'Order', entity_id: order.order_id,
        old_value: { packing_deduction: current, final_payable: order.final_payable },
        new_value: { packing_deduction: value, final_payable: patch.final_payable },
        notes: `Less: packing charges ${formatINR(value)}${note ? ` - ${note}` : ''}`,
      }),
    ]);
    return getOrderAdmin(order.order_id);
  });
}

export async function reopenOrderAdmin(id, { reason }, { admin, ip }) {
  return withLock(COMMERCE_LOCK, async () => {
    const data = await sheetsService.readMany(['Orders', 'Order_Items', 'Inventory'], { fresh: true });
    const order = data.Orders.find((o) => o.order_id === id || o.order_number === normalizeOrderNumber(id));
    if (!order) throw notFound('Order not found.');
    const check = canReopen(order);
    if (!check.ok) throw conflict('INVALID_TRANSITION', check.reason);
    const items = activeItems(data.Order_Items, order.order_id);
    const deltas = new Map();
    if (order.stock_state === STOCK_STATE.DEDUCTED) {
      // committed stock goes back to being a reservation held by this order
      for (const [v, n] of Object.entries(qtyMap(items))) deltas.set(v, { stock: n, reserved: n });
    }
    const inventory = inventoryDeltaOps(data.Inventory, deltas, { by: admin.admin_id, clamp: true });
    const now = nowIso();
    const previous = { order_status: order.order_status, payment_status: order.payment_status, locked: order.locked, stock_state: order.stock_state };
    const patch = {
      locked: false, order_status: ORDER_STATUS.PAYMENT_PENDING, payment_status: PAYMENT_STATUS.PENDING,
      stock_state: STOCK_STATE.RESERVED, updated_at: now,
    };
    await sheetsService.commit([
      ...inventory.ops,
      { op: 'update', sheet: 'Orders', id: order.order_id, patch },
      historyOp(order, order.order_status, ORDER_STATUS.PAYMENT_PENDING, ACTOR.ADMIN, admin.admin_id, `Order reopened for changes: ${reason}`),
      auditOp({
        admin, ip, action: AUDIT_ACTION.ORDER_REOPENED, entity_type: 'Order', entity_id: order.order_id, reason,
        old_value: previous, new_value: { order_status: patch.order_status, payment_status: patch.payment_status, locked: false, stock_state: patch.stock_state },
      }),
    ]);
    return getOrderAdmin(order.order_id);
  });
}

/**
 * Releases stock held by unpaid orders older than reservation_expiry_hours.
 * Only orders with NO payment record at all are touched (status -> CANCELLED,
 * never deleted). Disabled when the setting is 0.
 */
export async function expireUnpaidOrders() {
  const settings = await getSettings({ fresh: true });
  const hours = Number(settings.reservation_expiry_hours) || 0;
  if (hours <= 0) return { expired: 0 };
  return withLock(COMMERCE_LOCK, async () => {
    const data = await sheetsService.readMany(['Orders', 'Order_Items', 'Inventory', 'Payments'], { fresh: true });
    const withPayments = new Set(data.Payments.map((p) => p.order_id));
    const candidates = data.Orders.filter((o) => o.order_status === ORDER_STATUS.PAYMENT_PENDING
      && !isOfflineOrder(o) && !o.locked && o.stock_state === STOCK_STATE.RESERVED && !withPayments.has(o.order_id)
      && hoursSince(o.updated_at || o.created_at) >= hours).slice(0, 25);
    if (!candidates.length) return { expired: 0 };
    const deltas = new Map();
    const ops = [];
    const now = nowIso();
    const reason = `Payment not received within ${hours} hours - reserved stock released.`;
    for (const order of candidates) {
      for (const [v, d] of releaseDeltas(order, activeItems(data.Order_Items, order.order_id))) {
        const prev = deltas.get(v) || { stock: 0, reserved: 0 };
        prev.reserved += d.reserved;
        deltas.set(v, prev);
      }
      ops.push(
        { op: 'update', sheet: 'Orders', id: order.order_id, patch: { order_status: ORDER_STATUS.CANCELLED, locked: true, locked_at: now, stock_state: STOCK_STATE.RELEASED, cancel_reason: reason, cancelled_at: now, updated_at: now } },
        historyOp(order, order.order_status, ORDER_STATUS.CANCELLED, ACTOR.SYSTEM, '', reason),
        auditOp({ actorType: ACTOR.SYSTEM, action: AUDIT_ACTION.ORDER_AUTO_CANCELLED, entity_type: 'Order', entity_id: order.order_id, reason }),
      );
    }
    const inventory = inventoryDeltaOps(data.Inventory, deltas, { by: ACTOR.SYSTEM, clamp: true });
    await sheetsService.commit([...inventory.ops, ...ops]);
    logger.info(`Auto-cancelled ${candidates.length} unpaid order(s) older than ${hours}h`);
    return { expired: candidates.length };
  });
}
