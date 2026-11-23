import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStore, createColorProduct, CUSTOMER } from './helpers/fixtures.js';
import { createDraftOrder, getOrderAdmin, updateOrderCustomerAdmin } from '../services/orderService.js';
import { updateSettings } from '../services/settingsService.js';
import { sheetsService } from '../services/sheetsService.js';
import { fullAddress } from '../services/billService.js';
import { formatMobile } from '../services/whatsappService.js';
import { normalizeMobile, isCustomerMobile } from '../utils/orderToken.js';
import { draftOrderSchema, adminOrderCustomerSchema, customerSchema } from '../utils/validation.js';

// Orders from abroad: country, its state, postal code, a mobile with its country code.

const key = () => `ww-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
const DUBAI = {
  ...CUSTOMER,
  mobile: '+971 50 123 4567',
  whatsapp: '',
  alternate_mobile: '',
  city: 'Dubai',
  state: 'Dubai',
  country: 'United Arab Emirates',
  pincode: '',
  gstin: '07FZKPM0882G1Z1',
  aadhaar: '234567890123',
};

test('mobile numbers: Indian stays 10 digits, abroad keeps +country code', () => {
  assert.equal(normalizeMobile('+91 98765 43210'), '9876543210');
  assert.equal(normalizeMobile('09876543210'), '9876543210');
  assert.equal(normalizeMobile('+971 50 123 4567'), '+971501234567');
  assert.equal(normalizeMobile('00971501234567'), '+971501234567');
  assert.equal(normalizeMobile('+65 9123 4567'), '+6591234567', 'Singapore never looks like an Indian number');
  assert.ok(isCustomerMobile('+6591234567'));
  assert.ok(!isCustomerMobile('6591234567') || /^[6-9]/.test('6591234567'), 'bare 10 digits = India');
  assert.equal(formatMobile('9876543210', { whatsapp: { mobilePrefix: '91' } }), '919876543210');
  assert.equal(formatMobile('+971501234567', { whatsapp: { mobilePrefix: '91' } }), '971501234567');
});

test('India keeps its rules; abroad: country code, optional postal code, no GST / Aadhaar', () => {
  // India: unchanged
  const india = customerSchema.parse(CUSTOMER);
  assert.equal(india.country, 'India');
  assert.throws(() => customerSchema.parse({ ...CUSTOMER, pincode: '' }), /6-digit pincode/);
  assert.throws(() => customerSchema.parse({ ...CUSTOMER, mobile: '+971501234567' }), /10-digit Indian mobile/);

  const dubai = customerSchema.parse(DUBAI);
  assert.equal(dubai.mobile, '+971501234567');
  assert.equal(dubai.whatsapp, '+971501234567');
  assert.equal(dubai.gstin, '');
  assert.equal(dubai.aadhaar_last4, '');
  assert.throws(() => customerSchema.parse({ ...DUBAI, mobile: '501234567' }), /country code/);
  assert.throws(() => customerSchema.parse({ ...DUBAI, pincode: '###' }), /postal/);
  assert.equal(customerSchema.parse({ ...DUBAI, country: 'United States', state: 'California', pincode: '94105-1234' }).pincode, '94105-1234');
});

test('an order from abroad keeps its country; the bill prints it', async () => {
  const { adminCtx } = await freshStore();
  await updateSettings({ minimum_order_value: 0 }, adminCtx);
  const { variant } = await createColorProduct(adminCtx);
  const o = await createDraftOrder(draftOrderSchema.parse({
    customer: DUBAI, items: [{ variant_id: variant('Black', '32').variant_id, qty: 12 }], idempotency_key: key(),
  }));
  const row = (await sheetsService.read('Orders', { fresh: true })).find((r) => r.order_number === o.order_number);
  assert.equal(row.country_snapshot, 'United Arab Emirates');
  assert.equal(row.mobile_snapshot, '+971501234567');
  const customer = (await sheetsService.read('Customers', { fresh: true }))[0];
  assert.equal(customer.country, 'United Arab Emirates');
  assert.equal(fullAddress(row.billing_address_snapshot, row.city_snapshot, row.state_snapshot, row.pincode_snapshot, row.country_snapshot),
    '12 MG Road, Shop 4, Dubai, United Arab Emirates');

  // an Indian order: country stays blank (= India), nothing extra on the bill
  const india = await createDraftOrder(draftOrderSchema.parse({
    customer: { ...CUSTOMER, mobile: '9811100000' }, items: [{ variant_id: variant('Black', '32').variant_id, qty: 12 }], idempotency_key: key(),
  }));
  const indiaRow = (await sheetsService.read('Orders', { fresh: true })).find((r) => r.order_number === india.order_number);
  assert.equal(indiaRow.country_snapshot, '');
  assert.equal(fullAddress('12 MG Road', 'Pune', 'Maharashtra', '411001', ''), '12 MG Road, Pune, Maharashtra - 411001');

  // admin moves the order abroad and back
  await updateOrderCustomerAdmin(india.order_number, adminOrderCustomerSchema.parse({
    ...CUSTOMER, country: 'Nepal', state: 'Bagmati', city: 'Kathmandu', pincode: '44600', note: 'shop in Nepal',
  }), adminCtx);
  assert.equal((await getOrderAdmin(india.order_number)).order.country_snapshot, 'Nepal');
  await updateOrderCustomerAdmin(india.order_number, adminOrderCustomerSchema.parse({ ...CUSTOMER, country: 'India' }), adminCtx);
  assert.equal((await getOrderAdmin(india.order_number)).order.country_snapshot, '');
});
