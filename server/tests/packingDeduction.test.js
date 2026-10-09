import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freshStore, createBoxProduct, CUSTOMER, PNG_BYTES,
} from './helpers/fixtures.js';
import {
  createDraftOrder, getCustomerOrder, setPackingDeduction, updateOrderItems, cancelOrderAdmin, getOrderAdmin,
} from '../services/orderService.js';
import { submitPayment, verifyPayment, listPayments } from '../services/paymentService.js';
import { updateSettings } from '../services/settingsService.js';
import { adminBill } from '../services/billService.js';
import { sheetsService } from '../services/sheetsService.js';
import { draftOrderSchema, paymentSubmitSchema, packingDeductionSchema } from '../utils/validation.js';

// "Less: Packing charges": a flat amount the admin takes off an order.

let key = 0;
const idem = () => `pack-${Date.now()}-${key += 1}`;

async function setup() {
  const { adminCtx } = await freshStore();
  await updateSettings({ minimum_order_value: 0 }, adminCtx);
  const { boxVariant } = await createBoxProduct(adminCtx);
  const o = await createDraftOrder(draftOrderSchema.parse({ customer: CUSTOMER, items: [{ variant_id: boxVariant.variant_id, qty: 2 }], idempotency_key: idem() }));
  return { adminCtx, o, boxVariant };
}

test('admin deducts packing charges: total, amount to pay and bill show it; it stays when the order is edited', async () => {
  const { adminCtx, o, boxVariant } = await setup();
  const before = await getCustomerOrder(o.order_number, o.access_token);
  const total = before.totals.final_payable; // 2 boxes x 12 x 200 x 40% = 1920

  await setPackingDeduction(o.order_number, packingDeductionSchema.parse({ amount: 120, note: 'no boxes' }), adminCtx);
  let view = await getCustomerOrder(o.order_number, o.access_token);
  assert.equal(view.totals.packing_deduction, 120);
  assert.equal(view.totals.final_payable, total - 120);
  assert.equal(view.amount_to_pay, total - 120);

  const { bill, pdf } = await adminBill(o.order_number);
  assert.equal(bill.packing_deduction, 120);
  assert.equal(bill.subtotal, total, 'rows still add up to the full amount');
  assert.equal(bill.grand_total, total - 120);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');

  // customer edits the order: the deduction is kept on the new total
  await updateOrderItems(o.order_number, o.access_token, { items: [{ variant_id: boxVariant.variant_id, qty: 1 }] });
  view = await getCustomerOrder(o.order_number, o.access_token);
  assert.equal(view.totals.packing_deduction, 120);
  assert.equal(view.totals.final_payable, total / 2 - 120);

  // 0 removes it
  await setPackingDeduction(o.order_number, { amount: 0 }, adminCtx);
  view = await getCustomerOrder(o.order_number, o.access_token);
  assert.equal(view.totals.packing_deduction, 0);
  assert.equal(view.totals.final_payable, total / 2);
  const audit = (await sheetsService.read('Audit_Log', { fresh: true })).filter((a) => a.action === 'ORDER_PACKING_CHARGES_UPDATED');
  assert.equal(audit.length, 2);
  assert.match(audit[0].notes, /Less: packing charges/);
});

test('packing charges: never more than the total, never below verified payments, not on cancelled orders', async () => {
  const { adminCtx, o } = await setup();
  const total = (await getCustomerOrder(o.order_number, o.access_token)).totals.final_payable;
  await assert.rejects(setPackingDeduction(o.order_number, { amount: total + 1 }, adminCtx), /cannot be more than the order total/);
  assert.equal(packingDeductionSchema.safeParse({ amount: -5 }).success, false);

  // paid and verified in full -> the total cannot drop below what was paid
  await submitPayment(o.order_number, o.access_token, paymentSubmitSchema.parse({ amount: String(total), idempotency_key: idem() }), { buffer: PNG_BYTES });
  const { items } = await listPayments({});
  await verifyPayment(items[0].payment_id, { remarks: 'ok' }, adminCtx);
  await assert.rejects(setPackingDeduction(o.order_number, { amount: 50 }, adminCtx), /already verified/);

  const o2 = await createDraftOrder(draftOrderSchema.parse({ customer: { ...CUSTOMER, mobile: '9876500333' }, items: (await getOrderAdmin(o.order_number)).items.map((i) => ({ variant_id: i.variant_id, qty: 1 })), idempotency_key: idem() }));
  await cancelOrderAdmin(o2.order_number, { reason: 'test' }, adminCtx);
  await assert.rejects(setPackingDeduction(o2.order_number, { amount: 10 }, adminCtx), /cannot be changed on a Cancelled order/);
});
