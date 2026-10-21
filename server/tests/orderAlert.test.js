import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStore, createColorProduct, CUSTOMER } from './helpers/fixtures.js';
import { createDraftOrder, loadOrderBundle } from '../services/orderService.js';
import { updateSettings } from '../services/settingsService.js';
import {
  alertRecipients, sendNewOrderAlert, newOrderMessage, adminBillToken, adminBillByToken,
} from '../services/orderAlertService.js';
import { packingSlipToken } from '../services/packingService.js';
import { draftOrderSchema } from '../utils/validation.js';

// Every admin gets a WhatsApp with the order details + bill PDF link on each
// new website order (tests use the console WhatsApp provider - nothing is sent).

test('new order alert: who gets it', () => {
  const to = alertRecipients(
    { admin_order_mobiles: '9876500001, 9876500002', new_order_alert_mobiles: '+91 98765 00003, 9876500001' },
    [{ status: 'ACTIVE', mobile: '9876500004' }, { status: 'INACTIVE', mobile: '9876500005' }, { status: 'ACTIVE', mobile: '' }],
  );
  assert.deepEqual(to.sort(), ['9876500001', '9876500002', '9876500003', '9876500004']);
});

test('new order alert: details + bill PDF link that opens without a login', async () => {
  const { adminCtx } = await freshStore();
  await updateSettings({ admin_order_mobiles: '9876500001', new_order_alert_mobiles: '9876500002' }, adminCtx);
  const { variant } = await createColorProduct(adminCtx);
  const created = await createDraftOrder(
    draftOrderSchema.parse({ customer: CUSTOMER, items: [{ variant_id: variant('Black', '32').variant_id, qty: 50 }], idempotency_key: `alert-${Date.now()}` }),
    {},
  );
  const { order, items } = await loadOrderBundle(created.order_number);

  const res = await sendNewOrderAlert(order.order_id, { baseUrl: 'https://shop.example' });
  assert.deepEqual(res, { sent: 2, failed: 0 });

  const msg = newOrderMessage({ order, items, link: 'https://shop.example/api/admin-bill/x', adminLink: 'https://shop.example/admin/orders/1', placedBy: '' });
  assert.match(msg, new RegExp(`Order: ${order.order_number}`));
  assert.match(msg, /Party: Riya Fashion Store \(Riya Sharma\)/);
  assert.match(msg, /Items: 1 article, 50 pcs/);
  assert.match(msg, /Total: ₹10,000/);
  assert.match(msg, /Bill PDF: https:\/\/shop\.example\/api\/admin-bill\/x/);

  const bill = await adminBillByToken(adminBillToken(order.order_id));
  assert.equal(bill.pdf.subarray(0, 4).toString(), '%PDF');
  await assert.rejects(adminBillByToken(packingSlipToken(order.order_id)), /not valid/, 'a packing slip link never opens the bill');
  await assert.rejects(adminBillByToken(adminBillToken(order.order_id, { days: 1, now: Date.now() - 3 * 86400000 })), /not valid/, 'expired');

  await updateSettings({ new_order_alert_enabled: false }, adminCtx);
  assert.equal((await sendNewOrderAlert(order.order_id)).skipped, 'off');
});
