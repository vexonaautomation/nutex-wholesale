import { sheetsService } from './sheetsService.js';
import { driveService } from './driveService.js';
import { auditOp } from './auditService.js';
import { inventoryDeltaOps } from './inventoryService.js';
import { piecesByInventory } from '../utils/stockComponents.js';
import { autoExistingOps } from './existingCustomerService.js';
import { parseSettings } from './settingsService.js';
import {
  loadOrderBundle, authorizeOrder, activeItems, historyOp, getCustomerOrder, getOrderAdmin,
} from './orderService.js';
import {
  ACTOR, AUDIT_ACTION, DRIVE_FOLDERS, ORDER_STATUS, PAYMENT_STATUS, STOCK_STATE,
} from '../config/constants.js';
import { withLock, COMMERCE_LOCK, canSubmitPayment } from '../utils/lockManager.js';
import { once } from '../utils/idempotency.js';
import { newId, ID_PREFIX } from '../utils/idGenerator.js';
import { nowIso } from '../utils/dates.js';
import { normalizeOrderNumber } from '../utils/orderNumber.js';
import {
  badRequest, conflict, notFound, MESSAGES,
} from '../utils/errors.js';
import { detectFileType, PROOF_MIMES } from '../utils/fileType.js';
import { formatINR, round2 } from '../utils/money.js';

function refuseSubmission(order) {
  if (order.order_status === ORDER_STATUS.CANCELLED) throw conflict('ORDER_CANCELLED', 'This order has been cancelled.');
  if (order.locked && [PAYMENT_STATUS.SUBMITTED, PAYMENT_STATUS.VERIFIED].includes(order.payment_status)) {
    throw conflict('PAYMENT_ALREADY_SUBMITTED', MESSAGES.PAYMENT_ALREADY_SUBMITTED);
  }
  throw conflict('ORDER_LOCKED', MESSAGES.ORDER_LOCKED);
}

/**
 * Customer payment confirmation (UTR + screenshot).
 * 1. screenshot type verified by magic bytes, stored permanently in Drive
 * 2. inside the commerce lock, on FRESH data:
 *      payment row appended (SUBMITTED), order LOCKED,
 *      reserved stock converted into a committed deduction,
 *      status history + audit - all in ONE atomic Sheets batch.
 */
export async function submitPayment(orderNumber, token, fields, file, { ip } = {}) {
  if (!file?.buffer?.length) throw badRequest('Please attach the payment screenshot.');
  const type = detectFileType(file.buffer);
  if (!type || !PROOF_MIMES.includes(type.mime)) throw badRequest('Upload the payment screenshot as JPG, PNG, WEBP or PDF.');

  const pre = await loadOrderBundle(orderNumber);
  authorizeOrder(pre.order, token);
  if (pre.payments.some((p) => p.idempotency_key === fields.idempotency_key)) {
    return getCustomerOrder(pre.order.order_number, token);
  }
  if (!canSubmitPayment(pre.order)) refuseSubmission(pre.order);

  await once('payment', fields.idempotency_key, async () => {
    const stored = await driveService.upload({
      buffer: file.buffer,
      mimeType: type.mime,
      filename: `${pre.order.order_number}_${Date.now()}_payment.${type.ext}`,
      folder: DRIVE_FOLDERS.PAYMENT_PROOFS,
    });

    return withLock(COMMERCE_LOCK, async () => {
      const data = await sheetsService.readMany(['Orders', 'Order_Items', 'Payments', 'Inventory'], { fresh: true });
      const order = data.Orders.find((o) => o.order_number === normalizeOrderNumber(orderNumber));
      if (!order) throw notFound('Order not found.');
      if (data.Payments.some((p) => p.order_id === order.order_id && p.idempotency_key === fields.idempotency_key)) return null;
      if (!canSubmitPayment(order)) refuseSubmission(order);

      const utr = fields.utr.toUpperCase();
      const reused = utr && data.Payments.find((p) => String(p.utr).toUpperCase() === utr && p.status !== PAYMENT_STATUS.REJECTED);
      if (reused) {
        throw conflict('UTR_ALREADY_USED', 'This UTR / Transaction ID has already been submitted. Please check the number and try again.');
      }

      const orderPayments = data.Payments.filter((p) => p.order_id === order.order_id);
      const verified = orderPayments.filter((p) => p.status === PAYMENT_STATUS.VERIFIED).reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const expected = round2(Math.max(0, (Number(order.final_payable) || 0) - verified));
      const amount = round2(fields.amount);
      const now = nowIso();
      const payment = {
        payment_id: newId(ID_PREFIX.payment),
        order_id: order.order_id,
        order_number: order.order_number,
        amount,
        expected_amount: expected,
        payment_method: 'UPI_QR',
        utr,
        proof_file_id: stored.file_id,
        proof_url: stored.file_url,
        status: PAYMENT_STATUS.SUBMITTED,
        idempotency_key: fields.idempotency_key,
        customer_note: fields.customer_note,
        submitted_at: now,
        verified_at: '',
        verified_by: '',
        remarks: Math.abs(amount - expected) > 0.009 ? `Amount ${formatINR(amount)} differs from amount due ${formatINR(expected)}` : '',
      };

      const orderPatch = {
        payment_status: PAYMENT_STATUS.SUBMITTED,
        order_status: ORDER_STATUS.PAYMENT_SUBMITTED,
        locked: true,
        locked_at: order.locked ? order.locked_at : now,
        payment_submitted_at: now,
        updated_at: now,
      };
      let inventory = { ops: [], shortfalls: [] };
      if (order.stock_state === STOCK_STATE.RESERVED) {
        const deltas = new Map();
        for (const [v, n] of Object.entries(piecesByInventory(activeItems(data.Order_Items, order.order_id)))) {
          deltas.set(v, { stock: -n, reserved: -n });
        }
        inventory = inventoryDeltaOps(data.Inventory, deltas, { by: ACTOR.CUSTOMER, clamp: true });
        orderPatch.stock_state = STOCK_STATE.DEDUCTED;
      }

      await sheetsService.commit([
        { op: 'append', sheet: 'Payments', rows: [payment] },
        { op: 'update', sheet: 'Orders', id: order.order_id, patch: orderPatch },
        ...inventory.ops,
        historyOp(order, order.order_status, ORDER_STATUS.PAYMENT_SUBMITTED, ACTOR.CUSTOMER, order.customer_id, `Payment details submitted (${utr ? `UTR ${utr}` : 'no UTR given'})`),
        auditOp({
          actorType: ACTOR.CUSTOMER, ip, action: AUDIT_ACTION.PAYMENT_SUBMITTED, entity_type: 'Payment', entity_id: payment.payment_id,
          new_value: { order_number: order.order_number, amount, utr, expected_amount: expected },
          notes: inventory.shortfalls.length ? `STOCK SHORTFALL on deduction: ${JSON.stringify(inventory.shortfalls)}` : `Order ${order.order_number} locked`,
        }),
      ]);
      return payment.payment_id;
    });
  });
  return getCustomerOrder(pre.order.order_number, token);
}

export async function listPayments({ status, q, page = 1, limit = 50 } = {}) {
  const data = await sheetsService.readMany(['Payments', 'Orders'], { fresh: true });
  const orders = new Map(data.Orders.map((o) => [o.order_id, o]));
  const needle = String(q || '').trim().toLowerCase();
  const counts = {};
  for (const p of data.Payments) counts[p.status] = (counts[p.status] || 0) + 1;
  const rows = data.Payments
    .filter((p) => !status || p.status === status)
    .map((p) => {
      const o = orders.get(p.order_id) || {};
      return {
        ...p,
        idempotency_key: undefined,
        customer_name: o.customer_name_snapshot || '',
        business_name: o.business_name_snapshot || '',
        mobile: o.mobile_snapshot || '',
        order_final_payable: o.final_payable ?? null,
        order_status: o.order_status || '',
        proof_view_url: p.proof_file_id ? `/api/admin/payments/${p.payment_id}/proof` : '',
      };
    })
    .filter((p) => !needle || [p.order_number, p.utr, p.customer_name, p.business_name, p.mobile].some((v) => String(v).toLowerCase().includes(needle)))
    .sort((a, b) => (a.submitted_at < b.submitted_at ? 1 : -1));
  const size = Math.min(200, Math.max(1, Number(limit) || 50));
  const pg = Math.max(1, Number(page) || 1);
  return { counts, total: rows.length, page: pg, limit: size, items: rows.slice((pg - 1) * size, pg * size) };
}

async function decide(paymentId, { status, remarks }, { admin, ip }) {
  return withLock(COMMERCE_LOCK, async () => {
    const data = await sheetsService.readMany(['Payments', 'Orders', 'Existing_Customers', 'Settings'], { fresh: true });
    const payment = data.Payments.find((p) => p.payment_id === paymentId);
    if (!payment) throw notFound('Payment not found.');
    if (payment.status !== PAYMENT_STATUS.SUBMITTED) {
      throw conflict('INVALID_PAYMENT_STATE', `Only submitted payments can be ${status === PAYMENT_STATUS.VERIFIED ? 'verified' : 'rejected'} (current status: ${payment.status}).`);
    }
    const order = data.Orders.find((o) => o.order_id === payment.order_id);
    if (!order) throw notFound('Order for this payment was not found.');
    const now = nowIso();
    const ops = [{
      op: 'update', sheet: 'Payments', id: paymentId,
      patch: { status, verified_at: now, verified_by: admin.email || admin.admin_id, remarks: remarks || payment.remarks },
    }];
    const awaiting = [ORDER_STATUS.PAYMENT_SUBMITTED, ORDER_STATUS.PAYMENT_REJECTED].includes(order.order_status);
    if (status === PAYMENT_STATUS.VERIFIED && awaiting) {
      ops.push(
        { op: 'update', sheet: 'Orders', id: order.order_id, patch: { order_status: ORDER_STATUS.PAYMENT_VERIFIED, payment_status: PAYMENT_STATUS.VERIFIED, verified_at: now, updated_at: now } },
        historyOp(order, order.order_status, ORDER_STATUS.PAYMENT_VERIFIED, ACTOR.ADMIN, admin.admin_id, 'Payment verified by Nutex team'),
        // first paid order: the customer becomes an existing customer
        ...autoExistingOps({ order, existingRows: data.Existing_Customers, settings: parseSettings(data.Settings), admin, ip, now }),
      );
    }
    const otherPending = data.Payments.some((p) => p.order_id === order.order_id && p.payment_id !== paymentId && p.status === PAYMENT_STATUS.SUBMITTED);
    if (status === PAYMENT_STATUS.REJECTED && order.order_status === ORDER_STATUS.PAYMENT_SUBMITTED && !otherPending) {
      ops.push(
        { op: 'update', sheet: 'Orders', id: order.order_id, patch: { order_status: ORDER_STATUS.PAYMENT_REJECTED, payment_status: PAYMENT_STATUS.REJECTED, updated_at: now } },
        historyOp(order, order.order_status, ORDER_STATUS.PAYMENT_REJECTED, ACTOR.ADMIN, admin.admin_id, `Payment rejected: ${remarks}`),
      );
    }
    ops.push(auditOp({
      admin, ip,
      action: status === PAYMENT_STATUS.VERIFIED ? AUDIT_ACTION.PAYMENT_VERIFIED : AUDIT_ACTION.PAYMENT_REJECTED,
      entity_type: 'Payment', entity_id: paymentId, reason: remarks,
      old_value: { status: payment.status, order_status: order.order_status },
      new_value: { status, order_number: order.order_number, amount: payment.amount },
    }));
    await sheetsService.commit(ops);
    return getOrderAdmin(order.order_id);
  });
}

export const verifyPayment = (id, body, ctx) => decide(id, { status: PAYMENT_STATUS.VERIFIED, remarks: body.remarks }, ctx);
export const rejectPayment = (id, body, ctx) => decide(id, { status: PAYMENT_STATUS.REJECTED, remarks: body.remarks }, ctx);

export async function getPaymentProof(paymentId) {
  const payments = await sheetsService.read('Payments');
  const payment = payments.find((p) => p.payment_id === paymentId);
  if (!payment || !payment.proof_file_id) throw notFound('Payment proof not found.');
  return driveService.download(payment.proof_file_id);
}
