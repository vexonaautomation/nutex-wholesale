import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freshStore, createBoxProduct, CUSTOMER, PNG_BYTES,
} from './helpers/fixtures.js';
import {
  createDraftOrder, activeOrderSummaries, updateOrderStatusAdmin, cancelOrderAdmin, getCustomerOrder,
} from '../services/orderService.js';
import { submitPayment, verifyPayment, listPayments } from '../services/paymentService.js';
import { updateSettings } from '../services/settingsService.js';
import { draftOrderSchema, activeOrdersSchema } from '../utils/validation.js';

// Cart "Your orders": every order placed on the device stays visible until
// it is handed over (COMPLETED) or cancelled.

let key = 0;
const idem = () => `active-${Date.now()}-${key += 1}`;
const order = (items) => createDraftOrder(draftOrderSchema.parse({ customer: CUSTOMER, items, idempotency_key: idem() }));
const entry = (o) => ({ order_number: o.order_number, token: o.access_token });

test('your orders: pay first, then visible until handed over', async () => {
  const { adminCtx } = await freshStore();
  await updateSettings({ minimum_order_value: 0 }, adminCtx);
  const { boxVariant } = await createBoxProduct(adminCtx);
  const o = await order([{ variant_id: boxVariant.variant_id, qty: 1 }]);

  let [card] = await activeOrderSummaries([entry(o)]);
  assert.equal(card.order_number, o.order_number);
  assert.equal(card.order_status, 'PAYMENT_PENDING');
  assert.equal(card.can_submit_payment, true, 'card leads to the QR payment page');
  assert.equal(card.amount_to_pay, card.final_payable);
  assert.equal(card.lines, 1);
  assert.equal(card.total_pcs, 12, '1 box of 12 pieces');
  assert.equal(card.closed, false);

  // a wrong token or unknown number never reveals an order
  assert.deepEqual(await activeOrderSummaries([{ order_number: o.order_number, token: 'x'.repeat(40) }]), []);
  assert.deepEqual(await activeOrderSummaries([{ order_number: 'NUT-0000-0000', token: o.access_token }]), []);

  const amount = (await getCustomerOrder(o.order_number, o.access_token)).amount_to_pay;
  await submitPayment(o.order_number, o.access_token, { amount, utr: 'UTRACTIVE0001', customer_note: '', idempotency_key: idem() }, { buffer: PNG_BYTES });
  [card] = await activeOrderSummaries([entry(o)]);
  assert.equal(card.order_status, 'PAYMENT_SUBMITTED');
  assert.equal(card.can_submit_payment, false);
  assert.equal(card.closed, false, 'still shown after payment');

  const { items: payments } = await listPayments({});
  await verifyPayment(payments[0].payment_id, { remarks: 'ok' }, adminCtx);
  await updateOrderStatusAdmin(o.order_number, { status: 'DISPATCHED' }, adminCtx);
  [card] = await activeOrderSummaries([entry(o)]);
  assert.equal(card.closed, false, 'dispatched is not handed over yet');

  await updateOrderStatusAdmin(o.order_number, { status: 'COMPLETED' }, adminCtx);
  [card] = await activeOrderSummaries([entry(o)]);
  assert.equal(card.status_label, 'Handed over');
  assert.equal(card.closed, true, 'handed over: the device stops showing it');
});

test('your orders: cancelled orders close; at most 10 per request', async () => {
  const { adminCtx } = await freshStore();
  await updateSettings({ minimum_order_value: 0 }, adminCtx);
  const { boxVariant } = await createBoxProduct(adminCtx);
  const o = await order([{ variant_id: boxVariant.variant_id, qty: 1 }]);
  await cancelOrderAdmin(o.order_number, { reason: 'test' }, adminCtx);
  const [card] = await activeOrderSummaries([entry(o)]);
  assert.equal(card.closed, true);

  const many = Array.from({ length: 11 }, () => entry(o));
  assert.equal(activeOrdersSchema.safeParse({ orders: many }).success, false);
  assert.equal(activeOrdersSchema.safeParse({ orders: many.slice(0, 10) }).success, true);
});
