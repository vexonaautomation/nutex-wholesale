import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStore, createColorProduct, CUSTOMER } from './helpers/fixtures.js';
import {
  createDraftOrder, updateOrderStatusAdmin, updateOrderCustomerAdmin, getOrderAdmin, cancelOrderAdmin,
} from '../services/orderService.js';
import { createPacker, assignPacker } from '../services/packingService.js';
import { updateSettings } from '../services/settingsService.js';
import { sheetsService } from '../services/sheetsService.js';
import { draftOrderSchema, adminOrderCustomerSchema, packerSchema } from '../utils/validation.js';

// The admin can correct the customer's name / address on an order.

const SUB = { admin: { admin_id: 'ADM-SUB', role: 'SUB_ADMIN' }, ip: '' };
const EDIT = {
  customer_name: 'Riya S. Sharma',
  business_name: 'Riya Fashion House',
  email: 'riya@example.com',
  billing_address: '45 FC Road, Shop 9',
  shipping_address: '',
  city: 'Mumbai',
  state: 'Maharashtra',
  pincode: '400001',
  gstin: '',
  note: 'Customer moved shop',
};

async function orderAt(statuses) {
  const store = await freshStore();
  await updateSettings({ minimum_order_value: 0, online_payment_enabled: false }, store.adminCtx);
  const { variant } = await createColorProduct(store.adminCtx);
  const o = await createDraftOrder(draftOrderSchema.parse({ customer: CUSTOMER, items: [{ variant_id: variant('Black', '32').variant_id, qty: 12 }], idempotency_key: `eoc-${Date.now()}-${Math.floor(Math.random() * 1e9)}` }));
  if (statuses.includes('PACKED')) {
    const raju = await createPacker(packerSchema.parse({ name: 'Raju', mobile: '9811122334' }), store.adminCtx);
    await assignPacker(o.order_number, { packer_id: raju.packer_id, send: false }, store.adminCtx);
  }
  for (const status of statuses) {
    await updateOrderStatusAdmin(o.order_number, { status, courier_name: 'DTDC', tracking_number: 'D1' }, store.adminCtx);
  }
  return { ...store, o };
}

test('confirmed order: sub admin edits the customer; blank shipping = billing', async () => {
  const { o } = await orderAt(['CONFIRMED']);
  const view = await updateOrderCustomerAdmin(o.order_number, adminOrderCustomerSchema.parse(EDIT), SUB);
  assert.equal(view.order.customer_name_snapshot, 'Riya S. Sharma');
  assert.equal(view.order.business_name_snapshot, 'Riya Fashion House');
  assert.equal(view.order.billing_address_snapshot, '45 FC Road, Shop 9');
  assert.equal(view.order.shipping_address_snapshot, '45 FC Road, Shop 9');
  assert.equal(view.order.city_snapshot, 'Mumbai');
  assert.equal(view.order.pincode_snapshot, '400001');
  assert.equal(view.actions.can_edit_customer, true);
});

test('a separate shipping address is kept', async () => {
  const { o, adminCtx } = await orderAt(['CONFIRMED']);
  const view = await updateOrderCustomerAdmin(o.order_number, adminOrderCustomerSchema.parse({ ...EDIT, shipping_address: 'Godown 3, Bhiwandi' }), adminCtx);
  assert.equal(view.order.shipping_address_snapshot, 'Godown 3, Bhiwandi');
});

test('a bad pincode is rejected', () => {
  assert.throws(() => adminOrderCustomerSchema.parse({ ...EDIT, pincode: '12' }));
});

test('handed over: only the main admin can edit; GBNutex and the summary follow', async () => {
  const { o, adminCtx } = await orderAt(['CONFIRMED', 'PROCESSING', 'PACKED', 'DISPATCHED', 'COMPLETED']);
  await assert.rejects(updateOrderCustomerAdmin(o.order_number, adminOrderCustomerSchema.parse(EDIT), SUB), (e) => e.code === 'ORDER_LOCKED' && /main admin/.test(e.message));
  const before = await getOrderAdmin(o.order_number);
  assert.equal(before.actions.can_edit_customer, false);
  assert.equal(before.actions.can_edit_customer_manager, true);

  await updateOrderCustomerAdmin(o.order_number, adminOrderCustomerSchema.parse(EDIT), adminCtx);
  const gb = await sheetsService.read('GBNutex', { fresh: true });
  assert.ok(gb.length > 0);
  assert.ok(gb.every((r) => r['CLIENT NAME'] === 'Riya Fashion House' || r['CLIENT NAME'] === 'Riya S. Sharma'), 'GBNutex client name patched');
  const summary = await sheetsService.read('Order_Items_Summary', { fresh: true });
  assert.ok(summary.length > 0);
  assert.ok(summary.every((r) => r.city === 'Mumbai'), 'summary city patched');
  assert.equal((await getOrderAdmin(o.order_number)).order.order_status, 'COMPLETED');
});

test('cancelled order cannot be edited', async () => {
  const { o, adminCtx } = await orderAt([]);
  await cancelOrderAdmin(o.order_number, { reason: 'test' }, adminCtx);
  assert.equal((await getOrderAdmin(o.order_number)).order.order_status, 'CANCELLED');
  await assert.rejects(updateOrderCustomerAdmin(o.order_number, adminOrderCustomerSchema.parse(EDIT), adminCtx), (e) => e.code === 'ORDER_LOCKED');
});
