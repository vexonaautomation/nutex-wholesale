import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freshStore, createBoxProduct, CUSTOMER, PNG_BYTES, inventoryOf,
} from './helpers/fixtures.js';
import {
  createDraftOrder, getCustomerOrder, updateOrderStatusAdmin, getOrderAdmin, expireUnpaidOrders,
  activeOrderSummaries,
} from '../services/orderService.js';
import { submitPayment } from '../services/paymentService.js';
import { updateSettings } from '../services/settingsService.js';
import { customerBill } from '../services/billService.js';
import { sheetsService } from '../services/sheetsService.js';
import { draftOrderSchema, paymentSubmitSchema } from '../utils/validation.js';

// Settings > "Online payment (UPI QR)" OFF: checkout ends on a thank-you page,
// the team confirms the order; nothing is paid on the website.

let key = 0;
const idem = () => `toggle-${Date.now()}-${key += 1}`;
const order = (items, customer = CUSTOMER) => createDraftOrder(draftOrderSchema.parse({ customer, items, idempotency_key: idem() }));

test('online payment OFF: order awaits confirmation, no QR payment, never auto-cancelled', async () => {
  const { adminCtx } = await freshStore();
  await updateSettings({ minimum_order_value: 0, online_payment_enabled: false, reservation_expiry_hours: 1 }, adminCtx);
  const { boxVariant } = await createBoxProduct(adminCtx);
  const o = await order([{ variant_id: boxVariant.variant_id, qty: 2 }]);

  const view = await getCustomerOrder(o.order_number, o.access_token);
  assert.equal(view.payment_mode, 'OFFLINE');
  assert.equal(view.order_status, 'PAYMENT_PENDING');
  assert.equal(view.status_label, 'Awaiting confirmation');
  assert.equal(view.permissions.can_submit_payment, false, 'no QR payment step');
  assert.equal(view.permissions.can_edit, true, 'customer may still edit until the team confirms');
  assert.equal(view.permissions.can_download_bill, false);
  assert.equal(view.payment_window_hours, null);
  const [card] = await activeOrderSummaries([{ order_number: o.order_number, token: o.access_token }]);
  assert.equal(card.payment_mode, 'OFFLINE');
  assert.equal(card.can_submit_payment, false);
  assert.equal(card.status_label, 'Awaiting confirmation');

  await assert.rejects(
    submitPayment(o.order_number, o.access_token, paymentSubmitSchema.parse({ amount: '100', idempotency_key: idem() }), { buffer: PNG_BYTES }),
  );

  // an old unpaid order is not auto-cancelled when it has no online payment
  const rows = await sheetsService.read('Orders', { fresh: true });
  const row = rows.find((r) => r.order_number === o.order_number);
  await sheetsService.commit([{ op: 'update', sheet: 'Orders', id: row.order_id, patch: { created_at: '2020-01-01T00:00:00.000Z', updated_at: '2020-01-01T00:00:00.000Z' } }]);
  assert.equal((await expireUnpaidOrders()).expired, 0);
  assert.deepEqual(await inventoryOf(boxVariant.variant_id), { stock: 5, reserved: 2, available: 3 });
});

test('online payment OFF: the team confirms the order -> locked, stock taken, bill available', async () => {
  const { adminCtx } = await freshStore();
  await updateSettings({ minimum_order_value: 0, online_payment_enabled: false }, adminCtx);
  const { boxVariant } = await createBoxProduct(adminCtx);
  const o = await order([{ variant_id: boxVariant.variant_id, qty: 2 }]);

  const admin = await getOrderAdmin(o.order_number);
  assert.ok(admin.actions.allowed_statuses.includes('CONFIRMED'), 'admin can confirm it directly');
  assert.ok(!admin.actions.allowed_statuses.includes('PAYMENT_VERIFIED'));
  await assert.rejects(updateOrderStatusAdmin(o.order_number, { status: 'PAYMENT_VERIFIED' }, adminCtx), /no online payment/);

  await updateOrderStatusAdmin(o.order_number, { status: 'CONFIRMED' }, adminCtx);
  const after = await getCustomerOrder(o.order_number, o.access_token);
  assert.equal(after.order_status, 'CONFIRMED');
  assert.equal(after.locked, true);
  assert.equal(after.permissions.can_edit, false);
  assert.equal(after.permissions.can_download_bill, true);
  assert.deepEqual(await inventoryOf(boxVariant.variant_id), { stock: 3, reserved: 0, available: 3 }, 'stock taken on confirmation');
  const { pdf } = await customerBill(o.order_number, o.access_token);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.equal((await sheetsService.read('Existing_Customers', { fresh: true })).length, 1, 'first confirmed order makes them an existing customer');

  await updateOrderStatusAdmin(o.order_number, { status: 'DISPATCHED' }, adminCtx);
  assert.equal((await getCustomerOrder(o.order_number, o.access_token)).order_status, 'DISPATCHED');
});

test('switching online payment back ON: new orders use the QR again, older OFF orders keep their mode', async () => {
  const { adminCtx } = await freshStore();
  await updateSettings({ minimum_order_value: 0, online_payment_enabled: false }, adminCtx);
  const { boxVariant } = await createBoxProduct(adminCtx);
  const off = await order([{ variant_id: boxVariant.variant_id, qty: 1 }]);
  await updateSettings({ online_payment_enabled: true }, adminCtx);
  const on = await order([{ variant_id: boxVariant.variant_id, qty: 1 }], { ...CUSTOMER, mobile: '9876500222' });
  assert.equal((await getCustomerOrder(on.order_number, on.access_token)).payment_mode, 'ONLINE');
  assert.equal((await getCustomerOrder(on.order_number, on.access_token)).permissions.can_submit_payment, true);
  assert.equal((await getCustomerOrder(off.order_number, off.access_token)).payment_mode, 'OFFLINE');
  // ONLINE orders still need a verified payment before fulfilment
  await assert.rejects(updateOrderStatusAdmin(on.order_number, { status: 'CONFIRMED' }, adminCtx));
});
