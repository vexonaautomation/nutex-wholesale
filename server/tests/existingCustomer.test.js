import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStore, createColorProduct, CUSTOMER, inventoryOf } from './helpers/fixtures.js';
import { addExistingCustomers, issueCustomerToken, listExistingCustomers, updateExistingCustomer } from '../services/existingCustomerService.js';
import {
  startVerification, confirmVerification, customerStatus, startAlternate, confirmAlternate, _resetChallenges,
} from '../services/customerVerificationService.js';
import { demoQrPng, DEMO_QR_TEXT } from '../services/demoQrService.js';
import { interpretProviderResponse, sendWhatsAppText } from '../services/whatsappService.js';
import { createDraftOrder, getCustomerOrder, updateOrderItems, getOrderAdmin, trackOrder } from '../services/orderService.js';
import { updateSettings } from '../services/settingsService.js';
import { buildQuote } from '../services/quoteService.js';
import { getCatalog } from '../services/catalogService.js';
import { customerFromToken } from '../services/existingCustomerService.js';
import { sheetsService } from '../services/sheetsService.js';
import { draftOrderSchema } from '../utils/validation.js';

let n = 0;
const key = () => `existing-test-${Date.now()}-${(n += 1)}`;
const order = (items, token, customer = CUSTOMER) => createDraftOrder(
  draftOrderSchema.parse({ customer, items, idempotency_key: key() }),
  { customerToken: token },
);
const code = (c) => (err) => { assert.equal(err.code, c); return true; };

test('existing customer (verified) can order a single piece; new customer cannot', async () => {
  const { adminCtx } = await freshStore();
  const { variant } = await createColorProduct(adminCtx);
  const v = variant('Black', '32').variant_id;
  await addExistingCustomers([{ mobile: CUSTOMER.mobile, customer_name: 'Riya' }], adminCtx);
  const { token } = issueCustomerToken(CUSTOMER.mobile);

  await assert.rejects(order([{ variant_id: v, qty: 1 }], ''), code('MIN_ORDER_NOT_MET'));
  const created = await order([{ variant_id: v, qty: 1 }], token);
  const view = await getCustomerOrder(created.order_number, created.access_token);
  assert.equal(view.totals.final_payable, 200);
  assert.equal(view.totals.minimum_order_value, 0);
  assert.equal(view.totals.customer_type, 'EXISTING');
  assert.deepEqual(await inventoryOf(v), { stock: 100, reserved: 1, available: 99 });

  // editing the unpaid order keeps the exemption
  const edited = await updateOrderItems(created.order_number, created.access_token, { items: [{ variant_id: v, qty: 2 }] });
  assert.equal(edited.totals.final_payable, 400);
});

test('exemption is tied to the verified number, and removed when the customer is deactivated', async () => {
  const { adminCtx } = await freshStore();
  const { variant } = await createColorProduct(adminCtx);
  const v = variant('Black', '32').variant_id;
  await addExistingCustomers([{ mobile: CUSTOMER.mobile }], adminCtx);
  const { token } = issueCustomerToken(CUSTOMER.mobile);

  // verified as 9876543210 but ordering with another mobile -> standard minimum
  await assert.rejects(order([{ variant_id: v, qty: 1 }], token, { ...CUSTOMER, mobile: '9123456789' }), (err) => {
    assert.equal(err.code, 'MIN_ORDER_NOT_MET');
    assert.match(err.message, /98XXXXX210/);
    return true;
  });

  // forged / tampered tokens are ignored
  await assert.rejects(order([{ variant_id: v, qty: 1 }], `${token}x`), code('MIN_ORDER_NOT_MET'));

  const list = await listExistingCustomers();
  await updateExistingCustomer(list.items[0].key, { mobile: list.items[0].key, status: 'INACTIVE' }, adminCtx);
  await assert.rejects(order([{ variant_id: v, qty: 1 }], token), code('MIN_ORDER_NOT_MET'));
  assert.equal((await customerStatus(token)).existing, false);
});

test('rows typed by hand in the sheet (any mobile format, blank status) are recognised', async () => {
  const { adminCtx } = await freshStore();
  await createColorProduct(adminCtx);
  await sheetsService.commit([{ op: 'append', sheet: 'Existing_Customers', rows: [{ mobile: '+91 98765 43210', customer_name: 'Typed by hand' }] }]);
  const catalog = await getCatalog({ fresh: true });
  const c = customerFromToken(catalog, issueCustomerToken('9876543210').token);
  assert.equal(c.existing, true);
  assert.equal(c.minimum_order_value, 0);
});

test('per-customer and default existing-customer minimums', async () => {
  const { adminCtx } = await freshStore();
  const { variant } = await createColorProduct(adminCtx);
  const v = variant('Black', '32').variant_id;
  await updateSettings({ existing_customer_minimum_order_value: 1000 }, adminCtx);
  await addExistingCustomers([{ mobile: '9876543210' }, { mobile: '9000000001', minimum_order_value: 0 }], adminCtx);
  const catalog = await getCatalog({ fresh: true });
  const a = buildQuote({ items: [{ variant_id: v, qty: 2 }], catalog, customer: customerFromToken(catalog, issueCustomerToken('9876543210').token) });
  assert.equal(a.minimum_order_value, 1000);
  assert.equal(a.minimum_order_met, false);
  const b = buildQuote({ items: [{ variant_id: v, qty: 2 }], catalog, customer: customerFromToken(catalog, issueCustomerToken('9000000001').token) });
  assert.equal(b.minimum_order_waived, true);
  assert.equal(b.can_checkout, true);
});

test('bulk add is additive: invalid and duplicate numbers are skipped', async () => {
  const { adminCtx } = await freshStore();
  const first = await addExistingCustomers([{ mobile: '9876543210' }], adminCtx);
  assert.equal(first.added, 1);
  const res = await addExistingCustomers([
    { mobile: '9876543210' }, { mobile: '98765' }, { mobile: '+91 91234 56789', customer_name: 'A' }, { mobile: '9123456789' },
  ], adminCtx);
  assert.equal(res.added, 1);
  assert.equal(res.skipped.length, 3);
  assert.equal((await listExistingCustomers()).items.length, 2);
});

test('WhatsApp OTP: unlisted numbers get no OTP; listed numbers verify with the code', async () => {
  _resetChallenges();
  const { adminCtx } = await freshStore();
  await addExistingCustomers([{ mobile: '9876543210' }], adminCtx);

  const unlisted = await startVerification('9123456789');
  assert.deepEqual(unlisted, { existing: false, mobile_masked: '91XXXXX789' });

  const started = await startVerification('+91 98765 43210');
  assert.equal(started.otp_sent, true);
  assert.match(started.dev_otp, /^\d{6}$/);
  await assert.rejects(startVerification('9876543210'), code('OTP_RESEND_WAIT'));

  const wrong = started.dev_otp === '000000' ? '111111' : '000000';
  await assert.rejects(confirmVerification('9876543210', wrong), (err) => {
    assert.equal(err.code, 'OTP_INVALID');
    assert.match(err.message, /4 attempt/);
    return true;
  });
  const ok = await confirmVerification('9876543210', started.dev_otp);
  assert.equal(ok.verified, true);
  assert.equal(ok.mobile_masked, '98XXXXX210');
  await assert.rejects(confirmVerification('9876543210', started.dev_otp), code('OTP_EXPIRED'), 'codes are single-use');

  const status = await customerStatus(ok.token);
  assert.equal(status.existing, true);
  const audit = await sheetsService.read('Audit_Log', { fresh: true });
  assert.ok(audit.some((a) => a.action === 'EXISTING_CUSTOMER_VERIFIED'));
});

test('OTP lockout after 5 wrong attempts', async () => {
  _resetChallenges();
  const { adminCtx } = await freshStore();
  await addExistingCustomers([{ mobile: '9876543210' }], adminCtx);
  const s = await startVerification('9876543210');
  const wrong = s.dev_otp === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i += 1) await assert.rejects(confirmVerification('9876543210', wrong));
  await assert.rejects(confirmVerification('9876543210', s.dev_otp), code('OTP_EXPIRED'));
});

test('OTP can be switched off: listed number is verified directly', async () => {
  _resetChallenges();
  const { adminCtx } = await freshStore();
  await addExistingCustomers([{ mobile: '9876543210' }], adminCtx);
  await updateSettings({ existing_customer_otp_enabled: false }, adminCtx);
  const res = await startVerification('9876543210');
  assert.equal(res.verified, true);
  assert.ok(res.token);
});

test('cloudwhatsapp provider: request format and response handling', async () => {
  assert.equal(interpretProviderResponse({ status: 'ERROR', errormsg: 'No valid Mobile Found', statuscode: 400 }).ok, false);
  assert.equal(interpretProviderResponse({ status: 'OK', statuscode: 200, requestid: 'r1' }).ok, true);
  const calls = [];
  const cfg = { isProd: false, whatsapp: { provider: 'cloudwhatsapp', apiUrl: 'https://example.test/wapp/api/send', apiKey: 'KEY', mobilePrefix: '91' } };
  const fakeFetch = async (url, init) => {
    calls.push({ url, body: Object.fromEntries(new URLSearchParams(init.body)) });
    return { ok: true, status: 200, json: async () => ({ status: 'OK', statuscode: 200, requestid: 'abc' }) };
  };
  const r = await sendWhatsAppText('9876543210', 'hello 123456', { cfg, fetchImpl: fakeFetch });
  assert.equal(r.requestId, 'abc');
  assert.deepEqual(calls[0].body, { apikey: 'KEY', mobile: '919876543210', msg: 'hello 123456' });
  const failing = async () => ({ ok: true, status: 200, json: async () => ({ status: 'ERROR', errormsg: 'Insufficient balance', statuscode: 400 }) });
  await assert.rejects(sendWhatsAppText('9876543210', 'x', { cfg, fetchImpl: failing }), code('OTP_SEND_FAILED'));
});

test('alternate numbers: any registered number can log in; conflicts are refused', async () => {
  _resetChallenges();
  const { adminCtx } = await freshStore();
  const res = await addExistingCustomers([{ mobile: '9876543210', customer_name: 'Riya', alternate_mobiles: '+91 91234 56789 / 9988776655' }], adminCtx);
  assert.equal(res.added, 1);
  const list = await listExistingCustomers();
  assert.deepEqual(list.items[0].alternate_mobiles, ['9123456789', '9988776655']);

  // log in with the ALTERNATE number
  const s = await startVerification('9123456789');
  assert.equal(s.otp_sent, true);
  const ok = await confirmVerification('9123456789', s.dev_otp);
  assert.equal(ok.verified, true);
  assert.deepEqual(ok.numbers_masked, ['98XXXXX210', '91XXXXX789', '99XXXXX655']);

  // another customer cannot claim an already-registered number
  const clash = await addExistingCustomers([{ mobile: '9000000001', alternate_mobiles: '9988776655' }], adminCtx);
  assert.equal(clash.added, 0);
  assert.match(clash.skipped[0].reason, /already registered/);
  await assert.rejects(updateExistingCustomer(list.items[0].key, { mobile: list.items[0].key, alternate_mobiles: 'abc' }, adminCtx), /Invalid alternate/);
});

test('verified customer can link another number with an OTP on that number', async () => {
  _resetChallenges();
  const { adminCtx } = await freshStore();
  await addExistingCustomers([{ mobile: '9876543210' }, { mobile: '9000000001' }], adminCtx);
  const { token } = issueCustomerToken('9876543210');
  await assert.rejects(startAlternate(token, '9000000001'), code('NUMBER_IN_USE'));
  await assert.rejects(startAlternate(token, '9876543210'), /already linked/);
  await assert.rejects(startAlternate('', '9123456789'), code('CUSTOMER_LOGIN_REQUIRED'));
  const sent = await startAlternate(token, '9123456789');
  await assert.rejects(confirmAlternate(token, '9123456789', sent.dev_otp === '000000' ? '111111' : '000000'), code('OTP_INVALID'));
  const done = await confirmAlternate(token, '9123456789', sent.dev_otp);
  assert.deepEqual(done.numbers_masked, ['98XXXXX210', '91XXXXX789']);
  // the new number now logs in to the same customer
  const s = await startVerification('9123456789');
  const ok = await confirmVerification('9123456789', s.dev_otp);
  assert.equal(ok.numbers_masked.length, 2);
});

test('order placed with an alternate number keeps the exemption; checkout stores the alternate number', async () => {
  const { adminCtx } = await freshStore();
  const { variant } = await createColorProduct(adminCtx);
  await addExistingCustomers([{ mobile: '9876543210', alternate_mobiles: '9123456789' }], adminCtx);
  const token = issueCustomerToken('9876543210').token;
  // verified with main number, ordering with the registered alternate number
  const created = await order([{ variant_id: variant('Black', '32').variant_id, qty: 1 }], token, { ...CUSTOMER, mobile: '9123456789', alternate_mobile: '9876543210' });
  const view = await getCustomerOrder(created.order_number, created.access_token);
  assert.equal(view.totals.customer_type, 'EXISTING');
  assert.equal(view.customer.alternate_mobile, '9876543210');
  const customers = await sheetsService.read('Customers', { fresh: true });
  assert.equal(customers[0].alternate_mobile, '9876543210');
  // tracking works with the alternate number too
  const tracked = await trackOrder({ order_number: created.order_number, mobile: '9876543210' });
  assert.equal(tracked.order.order_number, created.order_number);
});

test('demo payment QR is a real QR image containing only text', async () => {
  const png = await demoQrPng();
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
  assert.ok(png.length > 500);
  assert.doesNotMatch(DEMO_QR_TEXT, /upi:\/\//i, 'demo QR must not be payable');
});

test('admin order view records the customer type', async () => {
  const { adminCtx } = await freshStore();
  const { variant } = await createColorProduct(adminCtx);
  await addExistingCustomers([{ mobile: CUSTOMER.mobile }], adminCtx);
  const created = await order([{ variant_id: variant('Black', '34').variant_id, qty: 3 }], issueCustomerToken(CUSTOMER.mobile).token);
  const admin = await getOrderAdmin(created.order_number);
  assert.equal(admin.order.customer_type_snapshot, 'EXISTING');
  assert.equal(admin.order.minimum_order_value_snapshot, 0);
});
