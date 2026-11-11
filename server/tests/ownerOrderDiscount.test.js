import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStore, createColorProduct, CUSTOMER } from './helpers/fixtures.js';
import { createSubAdmin } from '../services/authService.js';
import { issueCustomerToken, customerFromToken } from '../services/existingCustomerService.js';
import {
  createDraftOrder, updateOrderItems, recalculateOrder, previewOrderItemsAdmin,
} from '../services/orderService.js';
import { buildQuote } from '../services/quoteService.js';
import { getCatalog } from '../services/catalogService.js';
import { updateSettings } from '../services/settingsService.js';
import { sheetsService } from '../services/sheetsService.js';
import { subAdminSchema, draftOrderSchema } from '../utils/validation.js';

// The owner / main admin orders for customers from their own admin number:
// no minimum order, and the discount only when "Give discount" is ticked.
// Sub admins and customers are unchanged.

const OWNER = '9811122233';
const RAVI = '9812345670';
let n = 0;
const idem = () => `owner-order-${Date.now()}-${(n += 1)}`;

async function setup() {
  const store = await freshStore({ existingMinimum: 1000 });
  await updateSettings({ minimum_order_value: 5000, admin_order_mobiles: OWNER }, store.adminCtx);
  await createSubAdmin(subAdminSchema.parse({ name: 'Ravi', mobile: RAVI, password: 'Ravi-pass-2026' }), store.adminCtx);
  const { variant } = await createColorProduct(store.adminCtx); // MRP 500, 60% off
  const items = [{ variant_id: variant('Black', '32').variant_id, qty: 1 }]; // ₹200 after discount: below every minimum
  const quote = async (mobile, apply) => {
    const catalog = await getCatalog({ fresh: true });
    const customer = customerFromToken(catalog, issueCustomerToken(mobile).token);
    return buildQuote({
      items, catalog, customer, noDiscount: customer.main_admin === true && apply !== true,
    });
  };
  const place = (mobile, apply) => createDraftOrder(
    draftOrderSchema.parse({
      customer: { ...CUSTOMER, mobile: '9123456789' }, items, idempotency_key: idem(), ...(apply === undefined ? {} : { apply_discount: apply }),
    }),
    { customerToken: issueCustomerToken(mobile).token },
  );
  return {
    ...store, items, quote, place,
  };
}

test('owner number: discount only when ticked, never a minimum order', async () => {
  const { quote } = await setup();
  const off = await quote(OWNER, false);
  assert.equal(off.discount_choice, true);
  assert.equal(off.final_payable, 500, 'unticked: MRP');
  assert.equal(off.lines[0].discount_percent, 0);
  assert.equal(off.minimum_order_value, 0);
  assert.equal(off.can_checkout, true);
  const on = await quote(OWNER, true);
  assert.equal(on.final_payable, 200, 'ticked: wholesale discount');
  assert.equal(on.can_checkout, true, 'still no minimum');
});

test('sub admin and customers: unchanged (discount, ₹1,000 minimum)', async () => {
  const { quote } = await setup();
  const ravi = await quote(RAVI, false);
  assert.equal(ravi.discount_choice, false);
  assert.equal(ravi.final_payable, 200, 'sub admin keeps the discount');
  assert.equal(ravi.minimum_order_value, 1000);
  assert.equal(ravi.can_checkout, false);
  const catalog = await getCatalog({ fresh: true });
  const guest = buildQuote({ items: [], catalog, customer: customerFromToken(catalog, '') });
  assert.equal(guest.discount_choice, false);
});

test('order placed by the owner: no discount is saved and kept on every edit; no minimum', async () => {
  const { place, items, adminCtx } = await setup();
  const created = await place(OWNER, false);
  const order = (await sheetsService.read('Orders', { fresh: true })).find((o) => o.order_number === created.order_number);
  assert.equal(order.no_discount, true);
  assert.equal(order.final_payable, 500);
  assert.equal(order.placed_by_mobile, OWNER);
  assert.equal(order.minimum_order_value_snapshot, 0);

  const re = await recalculateOrder(created.order_number, created.access_token, { items: [{ ...items[0], qty: 2 }] });
  assert.equal(re.quote.final_payable, 1000, 'customer view of the edit: still MRP');
  const edited = await updateOrderItems(created.order_number, created.access_token, { items: [{ ...items[0], qty: 2 }] });
  assert.equal(edited.totals.final_payable, 1000);
  const admin = await previewOrderItemsAdmin(order.order_id, { items: [{ ...items[0], qty: 3 }] }, adminCtx);
  assert.equal(admin.quote.final_payable, 1500, 'admin edit: still MRP');

  const withDiscount = await place(OWNER, true);
  const o2 = (await sheetsService.read('Orders', { fresh: true })).find((o) => o.order_number === withDiscount.order_number);
  assert.equal(o2.no_discount, false);
  assert.equal(o2.final_payable, 200);
});

test('a sub admin or customer cannot switch the discount off', async () => {
  const { place, adminCtx } = await setup();
  await updateSettings({ existing_customer_minimum_order_value: 0 }, adminCtx);
  const created = await place(RAVI, false);
  const order = (await sheetsService.read('Orders', { fresh: true })).find((o) => o.order_number === created.order_number);
  assert.equal(order.no_discount, false);
  assert.equal(order.final_payable, 200);
});
