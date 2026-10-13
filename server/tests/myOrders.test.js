import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStore, createBoxProduct, CUSTOMER } from './helpers/fixtures.js';
import {
  createDraftOrder, activeOrderSummaries, customerOrderHistory, cancelOrderAdmin, updateOrderStatusAdmin, orderGroup,
} from '../services/orderService.js';
import { addExistingCustomers, issueCustomerToken, readCustomerToken } from '../services/existingCustomerService.js';
import { startVerification, confirmVerification, _resetChallenges } from '../services/customerVerificationService.js';
import { updateSettings } from '../services/settingsService.js';
import { draftOrderSchema, activeOrdersSchema } from '../utils/validation.js';

// "My orders": Pending / Confirmed / History tabs. Orders saved on the
// device, plus - after a WhatsApp OTP login - the customer's orders from any
// device.

let n = 0;
const idem = () => `my-orders-${Date.now()}-${(n += 1)}`;
const OTHER = { ...CUSTOMER, mobile: '9000000002', business_name: 'Other Shop' };

async function setup() {
  const { adminCtx } = await freshStore();
  await updateSettings({ minimum_order_value: 0, online_payment_enabled: false }, adminCtx);
  const { boxVariant } = await createBoxProduct(adminCtx, { boxes: 20 });
  const place = (customer = CUSTOMER) => createDraftOrder(draftOrderSchema.parse({
    customer, items: [{ variant_id: boxVariant.variant_id, qty: 1 }], idempotency_key: idem(),
  }));
  return { adminCtx, place, boxVariant };
}

test('orders are grouped: Pending, Confirmed, History', async () => {
  const { adminCtx, place } = await setup();
  const [a, b, c] = [await place(), await place(), await place()];
  await updateOrderStatusAdmin(b.order_number, { status: 'CONFIRMED' }, adminCtx);
  await cancelOrderAdmin(c.order_number, { reason: 'test' }, adminCtx);
  const cards = await activeOrderSummaries([a, b, c].map((o) => ({ order_number: o.order_number, token: o.access_token })));
  const group = Object.fromEntries(cards.map((o) => [o.order_number, o.group]));
  assert.deepEqual([group[a.order_number], group[b.order_number], group[c.order_number]], ['PENDING', 'CONFIRMED', 'HISTORY']);
  assert.equal(orderGroup({ order_status: 'PAYMENT_SUBMITTED' }), 'PENDING');
  assert.equal(orderGroup({ order_status: 'DISPATCHED' }), 'CONFIRMED');
  assert.equal(orderGroup({ order_status: 'COMPLETED' }), 'HISTORY');
  // the device may ask for up to 50 orders
  const many = Array.from({ length: 50 }, (_, i) => ({ order_number: `NX-${i}0000`, token: 'x'.repeat(20) }));
  assert.equal(activeOrdersSchema.parse({ orders: many }).orders.length, 50);
  assert.throws(() => activeOrdersSchema.parse({ orders: [...many, many[0]] }));
});

test('after the WhatsApp OTP login the customer sees their orders from any device; not without the OTP', async () => {
  const { adminCtx, place } = await setup();
  _resetChallenges();
  await addExistingCustomers([{ mobile: CUSTOMER.mobile }], adminCtx);
  const mine = [await place(), await place()];
  await place(OTHER); // someone else's order

  const started = await startVerification(CUSTOMER.mobile);
  const login = await confirmVerification(CUSTOMER.mobile, started.dev_otp);
  assert.equal(readCustomerToken(login.token).otp, true);
  const history = await customerOrderHistory(login.token);
  assert.equal(history.verified, true);
  assert.deepEqual(history.orders.map((o) => o.order_number).sort(), mine.map((o) => o.order_number).sort(), 'only their own orders');
  const cards = await activeOrderSummaries(history.orders);
  assert.equal(cards.length, 2, 'the tokens open the orders');

  // a token without the OTP (e.g. OTP switched off) lists nothing
  assert.deepEqual(await customerOrderHistory(issueCustomerToken(CUSTOMER.mobile).token), { verified: false, orders: [] });
  await updateSettings({ existing_customer_otp_enabled: false }, adminCtx);
  const noOtp = await startVerification(CUSTOMER.mobile);
  assert.equal(readCustomerToken(noOtp.token).otp, false);
  assert.deepEqual((await customerOrderHistory(noOtp.token)).orders, []);
  assert.deepEqual((await customerOrderHistory('')).orders, []);
});

test('an admin number sees the orders it placed for customers', async () => {
  const { adminCtx, place, boxVariant } = await setup();
  _resetChallenges();
  await updateSettings({ admin_order_mobiles: '9811122233' }, adminCtx);
  const started = await startVerification('9811122233');
  const login = await confirmVerification('9811122233', started.dev_otp);
  assert.equal(login.admin, true);
  const forCustomer = await createDraftOrder(
    draftOrderSchema.parse({ customer: OTHER, items: [{ variant_id: boxVariant.variant_id, qty: 1 }], idempotency_key: idem() }),
    { customerToken: login.token },
  );
  await place(); // a customer's own order - not placed by the admin number
  const history = await customerOrderHistory(login.token);
  assert.deepEqual(history.orders.map((o) => o.order_number), [forCustomer.order_number]);
});
