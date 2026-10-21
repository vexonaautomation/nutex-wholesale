// Packing team: the people who pack orders. When an order goes to
// "Processing" the admin picks a packer; the packer gets a WhatsApp message
// with the order summary and a link to the packing slip PDF (articles,
// colours, sizes, quantities, address - no rates, no amounts).
import { sheetsService } from './sheetsService.js';
import { auditOp } from './auditService.js';
import { sendWhatsAppText } from './whatsappService.js';
import { packingSlip } from './billService.js';
import { config } from '../config/env.js';
import { AUDIT_ACTION, RECORD_STATUS } from '../config/constants.js';
import { newId, ID_PREFIX } from '../utils/idGenerator.js';
import { nowIso } from '../utils/dates.js';
import { normalizeOrderNumber } from '../utils/orderNumber.js';
import { signedOrderToken, readSignedOrderToken } from '../utils/signedLink.js';
import { normalizeMobile } from '../utils/orderToken.js';
import { badRequest, notFound } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const SHEET = 'Packers';
const MOBILE_RE = /^[6-9]\d{9}$/;
const LINK_DAYS = 30;

const view = (p) => ({
  packer_id: p.packer_id, name: p.name, mobile: p.mobile, status: p.status || RECORD_STATUS.ACTIVE, notes: p.notes || '',
});

export async function listPackers({ activeOnly = false } = {}) {
  const [rows, orders] = await Promise.all([sheetsService.read(SHEET, { fresh: true }), sheetsService.read('Orders')]);
  const open = new Set(['PROCESSING', 'CONFIRMED', 'PAYMENT_VERIFIED']);
  return rows
    .filter((p) => !activeOnly || (p.status || RECORD_STATUS.ACTIVE) === RECORD_STATUS.ACTIVE)
    .map((p) => ({
      ...view(p),
      orders: orders.filter((o) => o.packer_id === p.packer_id).length,
      packing_now: orders.filter((o) => o.packer_id === p.packer_id && open.has(o.order_status)).length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function clean(input, rows, exceptId = null) {
  const name = String(input.name || '').trim();
  const mobile = normalizeMobile(input.mobile);
  if (name.length < 2) throw badRequest('Enter the packer\'s name.');
  if (!MOBILE_RE.test(mobile)) throw badRequest('Enter a valid 10-digit WhatsApp number.');
  if (rows.some((r) => r.packer_id !== exceptId && normalizeMobile(r.mobile) === mobile)) throw badRequest('Another packer already has this number.');
  return { name: name.slice(0, 100), mobile, notes: String(input.notes || '').trim().slice(0, 300) };
}

export async function createPacker(input, { admin, ip }) {
  const rows = await sheetsService.read(SHEET, { fresh: true });
  const now = nowIso();
  const row = {
    packer_id: newId(ID_PREFIX.packer), ...clean(input, rows), status: RECORD_STATUS.ACTIVE, created_at: now, updated_at: now,
  };
  await sheetsService.commit([
    { op: 'append', sheet: SHEET, rows: [row] },
    auditOp({ admin, ip, action: AUDIT_ACTION.ADMIN_UPDATED, entity_type: 'Packer', entity_id: row.packer_id, new_value: view(row), notes: `Packer added: ${row.name}` }),
  ]);
  return view(row);
}

export async function updatePacker(id, input, { admin, ip }) {
  const rows = await sheetsService.read(SHEET, { fresh: true });
  const row = rows.find((r) => r.packer_id === id);
  if (!row) throw notFound('Packer not found.');
  const patch = { ...clean(input, rows, id), updated_at: nowIso() };
  if (input.status) {
    if (![RECORD_STATUS.ACTIVE, RECORD_STATUS.INACTIVE].includes(input.status)) throw badRequest('Invalid status');
    patch.status = input.status;
  }
  await sheetsService.commit([
    { op: 'update', sheet: SHEET, id, patch },
    auditOp({ admin, ip, action: AUDIT_ACTION.ADMIN_UPDATED, entity_type: 'Packer', entity_id: id, old_value: view(row), new_value: view({ ...row, ...patch }) }),
  ]);
  return view({ ...row, ...patch });
}

// ---------------------------------------------------------- slip link
/** Signed link token: order id + expiry (no login needed, cannot be guessed). */
export const packingSlipToken = (orderId, opts = {}) => signedOrderToken('packing-slip', orderId, { days: LINK_DAYS, ...opts });
export const readPackingSlipToken = (token, opts) => readSignedOrderToken('packing-slip', token, opts);

export async function packingSlipByToken(token) {
  const orderId = readPackingSlipToken(token);
  if (!orderId) throw notFound('This packing slip link is not valid any more. Ask the office for a new one.');
  return packingSlip(orderId);
}

// ---------------------------------------------------------- assign + send
const slipMessage = ({ order, packer, slip, link }) => [
  `*Nutex - packing slip*`,
  `Order: ${order.order_number}`,
  `Packing by: ${packer.name}`,
  `Party: ${order.business_name_snapshot || order.customer_name_snapshot}${order.city_snapshot ? `, ${order.city_snapshot}` : ''}`,
  `Total: ${slip.total_pcs} pcs (${slip.total_dzn})${slip.total_boxes ? `, ${slip.total_boxes} box` : ''}`,
  '',
  `Packing slip PDF: ${link}`,
].join('\n');

/**
 * Sets the packer of an order (any status) and, with `send`, WhatsApps the
 * packing slip link to them. Sending never blocks the assignment: a failure
 * is returned with a wa.me link the admin can use instead.
 */
export async function assignPacker(idOrNumber, { packer_id: packerId, send = true }, { admin, ip, baseUrl = config.frontendUrl }) {
  const [orders, packers] = await Promise.all([sheetsService.read('Orders', { fresh: true }), sheetsService.read(SHEET, { fresh: true })]);
  const key = String(idOrNumber);
  const order = orders.find((o) => o.order_id === key || normalizeOrderNumber(o.order_number) === normalizeOrderNumber(key));
  if (!order) throw notFound('Order not found.');
  const packer = packers.find((p) => p.packer_id === packerId);
  if (!packer) throw badRequest('Choose a packer from the packing team.');
  if ((packer.status || RECORD_STATUS.ACTIVE) !== RECORD_STATUS.ACTIVE) throw badRequest(`${packer.name} is switched off in the packing team.`);

  const now = nowIso();
  const patch = { packer_id: packer.packer_id, packer_name: packer.name, packing_assigned_at: now, updated_at: now };
  const link = `${String(baseUrl || '').replace(/\/+$/, '')}/api/packing-slip/${packingSlipToken(order.order_id)}`;
  const { slip } = await packingSlip(order.order_id, { packerName: packer.name });
  const message = slipMessage({ order, packer, slip, link });
  const result = {
    order_id: order.order_id, order_number: order.order_number, packer: view(packer), link, sent: false, error: '',
    // fallback: the admin sends it from their own WhatsApp
    wa_link: `https://wa.me/91${normalizeMobile(packer.mobile)}?text=${encodeURIComponent(message)}`,
  };
  if (send) {
    try {
      await sendWhatsAppText(normalizeMobile(packer.mobile), message);
      result.sent = true;
      patch.packing_slip_sent_at = now;
    } catch (err) {
      logger.warn('Packing slip WhatsApp not sent', { order: order.order_number, error: err.message });
      result.error = 'WhatsApp could not be sent automatically - use "Send from my WhatsApp".';
    }
  }
  await sheetsService.commit([
    { op: 'update', sheet: 'Orders', id: order.order_id, patch },
    auditOp({
      admin, ip, action: AUDIT_ACTION.ORDER_UPDATED_BY_ADMIN, entity_type: 'Order', entity_id: order.order_id,
      old_value: { packer: order.packer_name || '' }, new_value: { packer: packer.name, slip_sent: result.sent },
      notes: `Packing by ${packer.name}${result.sent ? ' - slip sent on WhatsApp' : ''}`,
    }),
  ]);
  return result;
}
