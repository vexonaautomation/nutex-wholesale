import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStore, createColorProduct, CUSTOMER } from './helpers/fixtures.js';
import { createDraftOrder } from '../services/orderService.js';
import { adminBill, fullAddress, maskAadhaar } from '../services/billService.js';
import { createSubAdmin } from '../services/authService.js';
import { issueCustomerToken } from '../services/existingCustomerService.js';
import { updateSettings } from '../services/settingsService.js';
import { sheetsService } from '../services/sheetsService.js';
import { draftOrderSchema, customerSchema, subAdminSchema } from '../utils/validation.js';

// Bill party block: business name + customer name, full address, GSTIN or
// (no GST) the last 4 digits of the Aadhaar number; "Made by" at the end.

let n = 0;
const key = () => `bill-party-${Date.now()}-${(n += 1)}`;

test('helpers: full address without repeats, Aadhaar masked', () => {
  assert.equal(fullAddress('Shop 12, Main Bazaar', 'Jaipur', 'Rajasthan', '302001'), 'Shop 12, Main Bazaar, Jaipur, Rajasthan - 302001');
  assert.equal(fullAddress('12 MG Road\nNear Station, Jaipur', 'Jaipur', 'Rajasthan', '302001'), '12 MG Road, Near Station, Jaipur, Rajasthan - 302001');
  assert.equal(maskAadhaar('2345 6789 0123'), 'XXXX XXXX 0123');
  assert.equal(maskAadhaar('0123'), 'XXXX XXXX 0123');
  assert.equal(maskAadhaar(''), '');
  assert.throws(() => customerSchema.parse({ ...CUSTOMER, aadhaar: '1234' }), /12-digit Aadhaar/);
  assert.throws(() => customerSchema.parse({ ...CUSTOMER, aadhaar: '123456789012' }), /12-digit Aadhaar/, 'cannot start with 1');
  const c = customerSchema.parse({ ...CUSTOMER, aadhaar: '2345 6789 0123' });
  assert.equal(c.aadhaar_last4, '0123');
  assert.equal(c.aadhaar, undefined, 'the full number is dropped right away');
  assert.equal(customerSchema.parse({ ...CUSTOMER, gstin: '08ABCDE1234F1Z5', aadhaar: '2345 6789 0123' }).aadhaar_last4, '', 'GST given: no Aadhaar');
});

test('bill: business + customer name, full address, Aadhaar (last 4) when no GST, made by', async () => {
  const { adminCtx } = await freshStore();
  await updateSettings({ minimum_order_value: 0 }, adminCtx);
  const { variant } = await createColorProduct(adminCtx);
  const v = variant('Black', '32').variant_id;

  // the customer orders online, no GST, gives the Aadhaar number
  const own = await createDraftOrder(draftOrderSchema.parse({
    customer: { ...CUSTOMER, aadhaar: '2345-6789-0123', same_as_billing: false, shipping_address: 'Godown 3, Transport Nagar' },
    items: [{ variant_id: v, qty: 2 }],
    idempotency_key: key(),
  }));
  const row = (await sheetsService.read('Orders', { fresh: true })).find((o) => o.order_number === own.order_number);
  assert.equal(row.aadhaar_last4, '0123');
  assert.ok(!JSON.stringify(row).includes('234567890123'), 'full Aadhaar never stored');
  let { bill } = await adminBill(own.order_number);
  assert.equal(bill.party.name, CUSTOMER.business_name);
  assert.equal(bill.party.customer_name, CUSTOMER.customer_name);
  assert.equal(bill.party.address, '12 MG Road, Shop 4, Pune, Maharashtra - 411001');
  assert.equal(bill.party.ship_to, 'Godown 3, Transport Nagar, Pune, Maharashtra - 411001');
  assert.equal(bill.party.gstin, '');
  assert.equal(bill.party.aadhaar, 'XXXX XXXX 0123');
  assert.equal(bill.made_by, 'Online order (customer)');

  // a sub admin places the order for a GST customer
  await createSubAdmin(subAdminSchema.parse({ name: 'Ravi Kumar', mobile: '9812345670', password: 'Ravi-pass-2026' }), adminCtx);
  const team = await createDraftOrder(
    draftOrderSchema.parse({ customer: { ...CUSTOMER, mobile: '9123456789', whatsapp: '', gstin: '27ABCDE1234F1Z5' }, items: [{ variant_id: v, qty: 1 }], idempotency_key: key() }),
    { customerToken: issueCustomerToken('9812345670').token },
  );
  ({ bill } = await adminBill(team.order_number));
  assert.equal(bill.party.gstin, '27ABCDE1234F1Z5');
  assert.equal(bill.party.aadhaar, '');
  assert.equal(bill.party.ship_to, '', 'same as billing: no ship-to line');
  assert.equal(bill.made_by, 'Ravi Kumar');
  const { pdf } = await adminBill(team.order_number);
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
});
