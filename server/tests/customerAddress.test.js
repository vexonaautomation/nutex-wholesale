import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStore, createBoxProduct, CUSTOMER } from './helpers/fixtures.js';
import {
  addExistingCustomers, parseBulkText, lookupCustomersForAdmin, listExistingCustomers, issueCustomerToken, autoExistingOps,
} from '../services/existingCustomerService.js';
import { startVerification, confirmVerification, _resetChallenges } from '../services/customerVerificationService.js';
import { createDraftOrder } from '../services/orderService.js';
import { updateSettings, getSettings } from '../services/settingsService.js';
import { draftOrderSchema } from '../utils/validation.js';

// Existing customers with address / state / pincode (bulk upload), and the
// admin number finding a customer at checkout to fill the order details.

const ADMIN = '9811122233';
const code = (c) => (err) => { assert.equal(err.code, c); return true; };

test('bulk upload: address, state and pincode; already listed numbers get the new details', async () => {
  const { adminCtx } = await freshStore();
  await addExistingCustomers([{ mobile: '9876543210', customer_name: 'Riya', city: 'Pune' }], adminCtx);
  const csv = [
    'mobile,customer_name,business_name,city,address,state,pincode',
    '9876543210,,Riya Fashion,,"12 MG Road, Shop 4",Maharashtra,411001',
    '9811100001,Amit,Amit Hosiery,Surat,"45 Ring Road, Textile Market",Gujarat,395002',
    '9811100002,Bad Pin,,Delhi,Some street,Delhi,12345',
  ].join('\n');
  const res = await addExistingCustomers(parseBulkText(csv), adminCtx);
  assert.equal(res.added, 1);
  assert.equal(res.updated, 1, 'Riya: address filled in');
  assert.equal(res.skipped.length, 1);
  assert.match(res.skipped[0].reason, /Invalid pincode/);

  const { items } = await listExistingCustomers({});
  const riya = items.find((r) => r.mobile === '9876543210');
  assert.equal(riya.customer_name, 'Riya', 'empty column keeps the old value');
  assert.equal(riya.city, 'Pune');
  assert.equal(riya.business_name, 'Riya Fashion');
  assert.equal(riya.address, '12 MG Road, Shop 4');
  assert.equal(riya.state, 'Maharashtra');
  assert.equal(riya.pincode, '411001');
  assert.equal(items.find((r) => r.mobile === '9811100001').pincode, '395002');

  // the same upload again changes nothing
  const again = await addExistingCustomers(parseBulkText(csv), adminCtx);
  assert.equal(again.updated, 0);
  assert.match(again.skipped.map((s) => s.reason).join(), /no new details/);
});

test('admin number finds a customer by mobile or name; details from the list and the last order', async () => {
  const { adminCtx } = await freshStore();
  _resetChallenges();
  await updateSettings({ minimum_order_value: 0, admin_order_mobiles: ADMIN }, adminCtx);
  const { boxVariant } = await createBoxProduct(adminCtx);
  // a website customer (not in the list): details come from their order
  await createDraftOrder(draftOrderSchema.parse({ customer: { ...CUSTOMER, whatsapp: '9876500000' }, items: [{ variant_id: boxVariant.variant_id, qty: 1 }], idempotency_key: `addr-${Date.now()}` }));
  // a listed customer with an address
  await addExistingCustomers([{
    mobile: '9811100001', customer_name: 'Amit', business_name: 'Amit Hosiery', city: 'Surat', address: '45 Ring Road', state: 'Gujarat', pincode: '395002',
  }], adminCtx);

  const started = await startVerification(ADMIN);
  const login = await confirmVerification(ADMIN, started.dev_otp);

  let { results } = await lookupCustomersForAdmin(login.token, CUSTOMER.mobile);
  assert.equal(results.length, 1);
  assert.equal(results[0].billing_address, CUSTOMER.billing_address);
  assert.equal(results[0].pincode, CUSTOMER.pincode);
  assert.equal(results[0].whatsapp, '9876500000');

  ({ results } = await lookupCustomersForAdmin(login.token, 'amit'));
  assert.deepEqual(results.map((r) => [r.business_name, r.city, r.mobile, r.billing_address, r.pincode]), [['Amit Hosiery', 'Surat', '9811100001', '45 Ring Road', '395002']]);
  assert.equal((await lookupCustomersForAdmin(login.token, '98111')).results[0].mobile, '9811100001', 'part of a number');
  assert.deepEqual((await lookupCustomersForAdmin(login.token, 'a')).results, [], 'needs 2 letters');

  // only an admin number with the OTP login
  await assert.rejects(lookupCustomersForAdmin(issueCustomerToken(ADMIN).token, 'amit'), code('ADMIN_LOGIN_REQUIRED'));
  await assert.rejects(lookupCustomersForAdmin(issueCustomerToken('9811100001', { otp: true }).token, 'amit'), code('ADMIN_LOGIN_REQUIRED'));
  await assert.rejects(lookupCustomersForAdmin('', 'amit'), code('ADMIN_LOGIN_REQUIRED'));
});

test('first paid order adds the customer with their address', async () => {
  await freshStore();
  const ops = autoExistingOps({
    order: {
      mobile_snapshot: '9876543210', order_number: 'NX-1', customer_name_snapshot: 'Riya', city_snapshot: 'Pune',
      billing_address_snapshot: '12 MG Road', state_snapshot: 'Maharashtra', pincode_snapshot: '411001',
    },
    settings: await getSettings(),
  });
  const row = ops.find((o) => o.op === 'append').rows[0];
  assert.deepEqual([row.address, row.state, row.pincode], ['12 MG Road', 'Maharashtra', '411001']);
});
