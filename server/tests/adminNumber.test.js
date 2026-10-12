import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStore, createColorProduct, CUSTOMER } from './helpers/fixtures.js';
import {
  addExistingCustomers, issueCustomerToken, customerFromToken, autoExistingOps,
} from '../services/existingCustomerService.js';
import {
  startVerification, confirmVerification, customerStatus, startAlternate, _resetChallenges,
} from '../services/customerVerificationService.js';
import {
  createDraftOrder, getCustomerOrder, updateOrderItems, getOrderAdmin, trackOrder,
} from '../services/orderService.js';
import { adminBill } from '../services/billService.js';
import { updateSettings, getSettings } from '../services/settingsService.js';
import { getCatalog } from '../services/catalogService.js';
import { draftOrderSchema } from '../utils/validation.js';

// Nutex: an admin number logs in like an existing customer and can place the
// order on the customer's mobile number - the bill then shows that number.

const ADMIN = '9811122233';
const SHOP = '9123456789'; // a customer who is not an existing customer
let n = 0;
const key = () => `admin-number-${Date.now()}-${(n += 1)}`;
const order = (items, token, customer = CUSTOMER) => createDraftOrder(
  draftOrderSchema.parse({ customer, items, idempotency_key: key() }),
  { customerToken: token },
);
const code = (c) => (err) => { assert.equal(err.code, c); return true; };

test('admin numbers are saved cleaned up; a wrong number is refused', async () => {
  const { adminCtx } = await freshStore();
  await updateSettings({ admin_order_mobiles: '98111 22233, +91 9811122244 , 09811122233' }, adminCtx);
  assert.equal((await getSettings()).admin_order_mobiles, '9811122233, 9811122244');
  await assert.rejects(updateSettings({ admin_order_mobiles: '12345' }, adminCtx), /not a valid 10-digit mobile number/);
  await updateSettings({ admin_order_mobiles: '' }, adminCtx);
  assert.equal((await getSettings()).admin_order_mobiles, '');
});

test('admin number logs in like an existing customer (OTP) without being in Existing Customers', async () => {
  const { adminCtx } = await freshStore();
  _resetChallenges();
  assert.equal((await startVerification(ADMIN)).existing, false, 'not an admin number yet');
  await updateSettings({ admin_order_mobiles: ADMIN }, adminCtx);
  const started = await startVerification(ADMIN);
  assert.equal(started.existing, true);
  const ok = await confirmVerification(ADMIN, started.dev_otp);
  assert.equal(ok.verified, true);
  assert.equal(ok.admin, true);
  assert.equal((await customerStatus(ok.token)).admin, true);
  await assert.rejects(startAlternate(ok.token, '9000000009'), /Admin numbers are set in Settings/);

  // removed from Settings -> the login stops working
  await updateSettings({ admin_order_mobiles: '' }, adminCtx);
  assert.equal(customerFromToken(await getCatalog({ fresh: true }), ok.token).existing, false);
});

test('admin orders on the customer number: existing-customer rules, bill shows the customer number', async () => {
  const { adminCtx } = await freshStore();
  const { variant } = await createColorProduct(adminCtx);
  const v = variant('Black', '32').variant_id;
  await updateSettings({ admin_order_mobiles: ADMIN }, adminCtx);
  const { token } = issueCustomerToken(ADMIN);

  // a single piece (below the minimum) is fine: the admin counts as an existing customer
  const created = await order([{ variant_id: v, qty: 1 }], token, { ...CUSTOMER, mobile: SHOP, whatsapp: '' });
  const view = await getCustomerOrder(created.order_number, created.access_token);
  assert.equal(view.totals.customer_type, 'EXISTING');
  const admin = await getOrderAdmin(created.order_number);
  assert.equal(admin.order.mobile_snapshot, SHOP, 'the order is on the customer number');
  assert.equal(admin.order.placed_by_mobile, ADMIN, 'and remembers which admin number placed it');

  const { bill } = await adminBill(admin.order.order_id);
  assert.equal(bill.party.phone, SHOP, 'bill shows the customer number');

  // editing the unpaid order keeps the existing-customer rules
  const edited = await updateOrderItems(created.order_number, created.access_token, { items: [{ variant_id: v, qty: 2 }] });
  assert.equal(edited.totals.final_payable, 400);

  // both the customer and the admin number can track it
  assert.ok((await trackOrder({ order_number: created.order_number, mobile: SHOP })).access_token);
  assert.ok((await trackOrder({ order_number: created.order_number, mobile: ADMIN })).access_token);

  // a normal existing customer still cannot order on someone else's number
  await addExistingCustomers([{ mobile: CUSTOMER.mobile }], adminCtx);
  await assert.rejects(order([{ variant_id: v, qty: 1 }], issueCustomerToken(CUSTOMER.mobile).token, { ...CUSTOMER, mobile: SHOP }), code('MIN_ORDER_NOT_MET'));
});

test('admin without a customer number: the order uses the admin number, and the admin is never auto-added as a customer', async () => {
  const { adminCtx } = await freshStore();
  const { variant } = await createColorProduct(adminCtx);
  const v = variant('Black', '32').variant_id;
  await updateSettings({ admin_order_mobiles: ADMIN }, adminCtx);
  const created = await order([{ variant_id: v, qty: 1 }], issueCustomerToken(ADMIN).token, { ...CUSTOMER, mobile: ADMIN, whatsapp: '' });
  const { order: o } = await getOrderAdmin(created.order_number);
  assert.equal(o.mobile_snapshot, ADMIN);
  assert.equal(o.placed_by_mobile, ADMIN);
  const settings = await getSettings();
  assert.deepEqual(autoExistingOps({ order: o, existingRows: [], settings }), [], 'admin number is not added to Existing Customers');
  assert.equal(autoExistingOps({ order: { ...o, mobile_snapshot: SHOP }, existingRows: [], settings }).length, 2, 'a customer number still is');
});
