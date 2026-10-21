import { getCatalog } from '../services/catalogService.js';
import { buildQuote } from '../services/quoteService.js';
import { customerFromToken } from '../services/existingCustomerService.js';
import {
  createDraftOrder, cancelOrderCustomer, getCustomerOrder, trackOrder, activeOrderSummaries, updateOrderItems, recalculateOrder, lockOrder,
  listOrdersAdmin, getOrderAdmin, updateOrderStatusAdmin, reopenOrderAdmin, cancelOrderAdmin, setPackingDeduction,
  previewOrderItemsAdmin, orderProductOptionsAdmin, updateOrderItemsAdmin,
} from '../services/orderService.js';
import { customerBill, adminBill, packingSlip } from '../services/billService.js';
import { adminBillByToken } from '../services/orderAlertService.js';
import { customerBillByToken } from '../services/customerOrderMessageService.js';
import {
  listPackers, createPacker, updatePacker, assignPacker, packingSlipByToken,
} from '../services/packingService.js';
import { config } from '../config/env.js';
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
  const created = await createDraftOrder(req.body, {
    ip: req.ip, customerToken: req.customerToken, baseUrl: config.frontendUrl || `${req.protocol}://${req.get('host')}`,
  });
  const order = await getCustomerOrder(created.order_number, created.access_token);
  noStore(res);
  res.status(created.duplicate ? 200 : 201).json({ ...created, order });
}

export async function track(req, res) {
  noStore(res);
  res.json(await trackOrder(req.body));
}

export async function activeOrders(req, res) {
  noStore(res);
  res.json({ orders: await activeOrderSummaries(req.body.orders) });
}

function sendPdf(res, { pdf, filename }) {
  noStore(res);
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(pdf);
}

export async function bill(req, res) {
  sendPdf(res, await customerBill(req.params.orderNumber, req.orderToken));
}

export async function adminBillPdf(req, res) {
  sendPdf(res, await adminBill(req.params.id));
}

// ------------------------------------------------------------ packing team
export async function adminPackingSlip(req, res) {
  sendPdf(res, await packingSlip(req.params.id));
}

export async function adminBillPublic(req, res) {
  noStore(res);
  const { pdf, filename } = await adminBillByToken(req.params.token);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename}"`, 'X-Content-Type-Options': 'nosniff' });
  res.send(pdf);
}

export async function customerBillPublic(req, res) {
  noStore(res);
  const { pdf, filename } = await customerBillByToken(req.params.token);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename}"`, 'X-Content-Type-Options': 'nosniff' });
  res.send(pdf);
}

export async function packingSlipPublic(req, res) {
  noStore(res);
  const { pdf, filename } = await packingSlipByToken(req.params.token);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename}"`, 'X-Content-Type-Options': 'nosniff' });
  res.send(pdf);
}

export const adminPackers = async (req, res) => res.json({ items: await listPackers({ activeOnly: req.query.active === '1' }) });
export const adminPackerCreate = async (req, res) => res.status(201).json(await createPacker(req.body, ctx(req)));
export const adminPackerUpdate = async (req, res) => res.json(await updatePacker(req.params.id, req.body, ctx(req)));
export const adminAssignPacker = async (req, res) => res.json(await assignPacker(req.params.id, req.body, {
  ...ctx(req), baseUrl: config.frontendUrl || `${req.protocol}://${req.get('host')}`,
}));

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

export async function customerCancel(req, res) {
  noStore(res);
  res.json({
    order: await cancelOrderCustomer(req.params.orderNumber, req.orderToken, {
      reason: req.body.reason, ip: req.ip, baseUrl: config.frontendUrl || `${req.protocol}://${req.get('host')}`,
    }),
  });
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

export const adminPackingDeduction = async (req, res) => res.json(await setPackingDeduction(req.params.id, req.body, ctx(req)));
export const adminProductOptions = async (req, res) => res.json(await orderProductOptionsAdmin(req.params.id, { q: req.query.q }));
export const adminPreviewItems = async (req, res) => res.json(await previewOrderItemsAdmin(req.params.id, req.body));
export const adminUpdateItems = async (req, res) => res.json(await updateOrderItemsAdmin(req.params.id, req.body, ctx(req)));
