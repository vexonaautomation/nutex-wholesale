import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStore, createColorProduct, CUSTOMER } from './helpers/fixtures.js';
import { createDraftOrder, loadOrderBundle } from '../services/orderService.js';
import { getSettings, updateSettings } from '../services/settingsService.js';
import {
  customerOrderMessage, sendCustomerOrderMessage, customerBillToken, customerBillByToken,
} from '../services/customerOrderMessageService.js';
import { adminBillToken } from '../services/orderAlertService.js';
import { draftOrderSchema } from '../utils/validation.js';

// "Order received" WhatsApp to the customer (console provider in tests).

let n = 0;
const key = () => `custmsg-${Date.now()}-${(n += 1)}`;

async function setup(customer = CUSTOMER) {
  const store = await freshStore();
  await updateSettings({ minimum_order_value: 0, whatsapp_number: '919876500000' }, store.adminCtx);
  const { variant } = await createColorProduct(store.adminCtx);
  const created = await createDraftOrder(draftOrderSchema.parse({
    customer, items: [{ variant_id: variant('Black', '32').variant_id, qty: 50 }], idempotency_key: key(),
  }), { baseUrl: 'https://b2b.nutex.in' });
  return { ...store, created, bundle: await loadOrderBundle(created.order_number) };
}

test('customer message: online payment - pay link, order link, bill link, support number', async () => {
  const { bundle } = await setup();
  const msg = customerOrderMessage({
    order: bundle.order, items: bundle.items, settings: await getSettings(), orderLink: 'https://b2b.nutex.in/order/x?t=y', billLink: 'https://b2b.nutex.in/api/bill/z',
  });
  assert.match(msg, /Order received/);
  assert.match(msg, /Namaste Riya Sharma ji,/);
  assert.match(msg, new RegExp(`Order No: ${bundle.order.order_number}`));
  assert.match(msg, /Party: Riya Fashion Store, Pune/);
  assert.match(msg, /Items: 1 article, 50 pcs/);
  assert.match(msg, /Total: ₹10,000 \(5% GST included\)/);
  assert.match(msg, /Payment pending - neeche link se UPI QR/);
  assert.match(msg, /Bill PDF: https:\/\/b2b\.nutex\.in\/api\/bill\/z/);
  assert.match(msg, /WhatsApp karein: \+91 98765 00000/);
});

test('customer message: offline payment - the team will confirm', async () => {
  const { bundle } = await setup();
  const msg = customerOrderMessage({
    order: { ...bundle.order, payment_mode_snapshot: 'OFFLINE' }, items: bundle.items, settings: await getSettings(), orderLink: 'L', billLink: 'B',
  });
  assert.match(msg, /team jaldi aapse sampark karke order confirm karegi/);
  assert.doesNotMatch(msg, /UPI QR/);
});

test('customer message goes to the WhatsApp number (else mobile); bill link opens; can be switched off', async () => {
  const { bundle, adminCtx } = await setup({ ...CUSTOMER, whatsapp: '9123400000' });
  const res = await sendCustomerOrderMessage(bundle.order.order_id, { baseUrl: 'https://b2b.nutex.in' });
  assert.deepEqual(res, { sent: true, to: '9123400000' });

  const bill = await customerBillByToken(customerBillToken(bundle.order.order_id));
  assert.equal(bill.pdf.subarray(0, 4).toString(), '%PDF');
  await assert.rejects(customerBillByToken(adminBillToken(bundle.order.order_id)), /not valid/, 'other links never open it');

  await updateSettings({ customer_order_message_enabled: false }, adminCtx);
  assert.equal((await sendCustomerOrderMessage(bundle.order.order_id)).skipped, 'off');
});
