import { getCatalog } from '../services/catalogService.js';
import { buildQuote } from '../services/quoteService.js';
import { customerFromToken } from '../services/existingCustomerService.js';
import {
  createDraftOrder, getCustomerOrder, trackOrder, updateOrderItems, recalculateOrder, lockOrder,
  listOrdersAdmin, getOrderAdmin, updateOrderStatusAdmin, reopenOrderAdmin, cancelOrderAdmin,
} from '../services/orderService.js';
import { ctx, noStore } from './helpers.js';

// ------------------------------ public ------------------------------
// Cart quote: authoritative totals for whatever is in the browser cart.
export async function quoteCart(req, res) {
  const catalog = await getCatalog();
  const customer = customerFromToken(catalog, req.customerToken);
  noStore(res);
  res.json(buildQuote({ items: req.body.items, catalog, customer }));
}

export async function createDraft(req, res) {
  const created = await createDraftOrder(req.body, { ip: req.ip, customerToken: req.customerToken });
  const order = await getCustomerOrder(created.order_number, created.access_token);
  noStore(res);
  res.status(created.duplicate ? 200 : 201).json({ ...created, order });
}

export async function track(req, res) {
  noStore(res);
  res.json(await trackOrder(req.body));
}

export async function getOrder(req, res) {
  noStore(res);
  res.json({ order: await getCustomerOrder(req.params.orderNumber, req.orderToken) });
}

export async function updateOrder(req, res) {
  noStore(res);
  res.json({ order: await updateOrderItems(req.params.orderNumber, req.orderToken, req.body, { ip: req.ip }) });
}

export async function recalculate(req, res) {
  noStore(res);
  res.json(await recalculateOrder(req.params.orderNumber, req.orderToken, req.body));
}

export async function lock(req, res) {
  noStore(res);
  res.json(await lockOrder(req.params.orderNumber, req.orderToken, { ip: req.ip }));
}

// ------------------------------ admin -------------------------------
export const adminList = async (req, res) => res.json(await listOrdersAdmin(req.query));
export const adminGet = async (req, res) => res.json(await getOrderAdmin(req.params.id));
export const adminStatus = async (req, res) => res.json(await updateOrderStatusAdmin(req.params.id, req.body, ctx(req)));
export const adminReopen = async (req, res) => res.json(await reopenOrderAdmin(req.params.id, req.body, ctx(req)));
export const adminCancel = async (req, res) => res.json(await cancelOrderAdmin(req.params.id, req.body, ctx(req)));
