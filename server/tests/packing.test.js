import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStore, createColorProduct, CUSTOMER } from './helpers/fixtures.js';
import {
  createPacker, updatePacker, listPackers, assignPacker, packingSlipToken, readPackingSlipToken, packingSlipByToken,
} from '../services/packingService.js';
import { packingSlip } from '../services/billService.js';
import { createDraftOrder, getOrderAdmin } from '../services/orderService.js';
import { updateSettings } from '../services/settingsService.js';
import { allowedFor } from '../utils/permissions.js';
import { draftOrderSchema, packerSchema } from '../utils/validation.js';

// Packing team: pick who packs an order; they get the packing slip (no
// amounts) on WhatsApp as a signed link.

let n = 0;
const key = () => `packing-${Date.now()}-${(n += 1)}`;

async function setup() {
  const store = await freshStore();
  await updateSettings({ minimum_order_value: 0 }, store.adminCtx);
  const { variant } = await createColorProduct(store.adminCtx);
  const order = await createDraftOrder(draftOrderSchema.parse({
    customer: { ...CUSTOMER, order_notes: 'Pack in 2 cartons' },
    items: [{ variant_id: variant('Black', '32').variant_id, qty: 12 }, { variant_id: variant('White', '34').variant_id, qty: 4 }],
    idempotency_key: key(),
  }));
  return { ...store, order };
}

test('packing team: add, no duplicate number, switch off', async () => {
  const { adminCtx } = await setup();
  const raju = await createPacker(packerSchema.parse({ name: 'Raju', mobile: '+91 98111 22334' }), adminCtx);
  assert.equal(raju.mobile, '9811122334');
  await assert.rejects(createPacker(packerSchema.parse({ name: 'Copy', mobile: '9811122334' }), adminCtx), /already has this number/);
  await createPacker(packerSchema.parse({ name: 'Amit', mobile: '9811122335' }), adminCtx);
  assert.deepEqual((await listPackers()).map((p) => p.name), ['Amit', 'Raju']);
  await updatePacker(raju.packer_id, packerSchema.parse({ name: 'Raju', mobile: '9811122334', status: 'INACTIVE' }), adminCtx);
  assert.deepEqual((await listPackers({ activeOnly: true })).map((p) => p.name), ['Amit']);
});

test('assigning a packer sends the slip link; the slip has quantities and address, no amounts', async () => {
  const { adminCtx, order } = await setup();
  const raju = await createPacker(packerSchema.parse({ name: 'Raju', mobile: '9811122334' }), adminCtx);
  const res = await assignPacker(order.order_number, { packer_id: raju.packer_id, send: true }, { ...adminCtx, baseUrl: 'https://b2b.nutex.in' });
  assert.equal(res.sent, true, 'WhatsApp sent (console in tests)');
  assert.match(res.link, /^https:\/\/b2b\.nutex\.in\/api\/packing-slip\/[\w-]+\.[\w-]+$/);
  assert.match(decodeURIComponent(res.wa_link), /Order: \d{12}.*\n.*Packing by: Raju/s, 'fallback link has the message');

  const detail = await getOrderAdmin(order.order_number);
  assert.equal(detail.order.packer_name, 'Raju');
  assert.ok(detail.order.packing_slip_sent_at);

  const { slip, pdf } = await packingSlip(order.order_number);
  assert.equal(slip.slip, true);
  assert.equal(slip.title, 'PACKING SLIP');
  assert.equal(slip.packer_name, 'Raju');
  assert.equal(slip.total_pcs, 16);
  assert.ok(slip.notes.some((t) => /Pack in 2 cartons/.test(t)));
  assert.equal(slip.party.name, CUSTOMER.business_name);
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');

  // the link opens the slip without login; a changed or expired link does not
  const token = res.link.split('/').pop();
  assert.equal((await packingSlipByToken(token)).pdf.subarray(0, 4).toString(), '%PDF');
  await assert.rejects(packingSlipByToken(`${token}x`), /not valid/);
  const old = packingSlipToken(detail.order.order_id, { days: 1, now: Date.now() - 3 * 86400000 });
  assert.equal(readPackingSlipToken(old), null, 'expired');

  // a switched-off packer cannot be picked
  await updatePacker(raju.packer_id, { name: 'Raju', mobile: '9811122334', status: 'INACTIVE' }, adminCtx);
  await assert.rejects(assignPacker(order.order_number, { packer_id: raju.packer_id }, adminCtx), /switched off/);
});

test('sub admins can pick a packer but not manage the team', () => {
  const sub = { role: 'SUB_ADMIN', permissions: '' };
  assert.equal(allowedFor(sub, { method: 'GET', path: '/packers' }), true);
  assert.equal(allowedFor(sub, { method: 'POST', path: '/orders/ORD-1/packer' }), true);
  assert.equal(allowedFor(sub, { method: 'GET', path: '/orders/ORD-1/packing-slip' }), true);
  assert.equal(allowedFor(sub, { method: 'POST', path: '/packers' }), false);
  assert.equal(allowedFor(sub, { method: 'PUT', path: '/packers/PKR-1' }), false);
});
