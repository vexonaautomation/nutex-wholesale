import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freshStore, createColorProduct, createBoxProduct, CUSTOMER,
} from './helpers/fixtures.js';
import { createDraftOrder, updateOrderStatusAdmin, cancelOrderAdmin, updateOrderItemsAdmin } from '../services/orderService.js';
import { updateSettings } from '../services/settingsService.js';
import { salesAnalytics } from '../services/analyticsService.js';
import { allowedFor } from '../utils/permissions.js';
import { draftOrderSchema, adminOrderItemsSchema } from '../utils/validation.js';

// Admin > Analytics: party / item / category / size / colour / team / day.

let n = 0;
const idem = () => `an-${Date.now()}-${(n += 1)}`;

async function setup() {
  const store = await freshStore();
  await updateSettings({ minimum_order_value: 0, online_payment_enabled: false }, store.adminCtx);
  const { variant } = await createColorProduct(store.adminCtx); // ABC Bra, 200 a piece
  const { boxVariant } = await createBoxProduct(store.adminCtx); // box of 12
  const place = (customer, items) => createDraftOrder(draftOrderSchema.parse({ customer: { ...CUSTOMER, ...customer }, items, idempotency_key: idem() }));
  const a = await place({}, [{ variant_id: variant('Black', '32').variant_id, qty: 24 }, { variant_id: boxVariant.variant_id, qty: 1 }]);
  const b = await place({ business_name: 'Jain Hosiery', customer_name: 'Amit Jain', mobile: '9123456780', city: 'Jaipur' }, [{ variant_id: variant('White', '34').variant_id, qty: 6 }]);
  const c = await place({ business_name: 'Gone Store', mobile: '9123456781' }, [{ variant_id: variant('Black', '34').variant_id, qty: 12 }]);
  for (const o of [a, b]) await updateOrderStatusAdmin(o.order_number, { status: 'CONFIRMED' }, store.adminCtx);
  await cancelOrderAdmin(c.order_number, { reason: 'Customer changed mind' }, store.adminCtx);
  return { ...store, a, b, variant, boxVariant };
}

test('analytics: confirmed orders by party and item, in pieces and dozens; cancelled apart', async () => {
  await setup();
  const res = await salesAnalytics({});
  assert.equal(res.kpi.orders, 2);
  assert.equal(res.kpi.pcs, 24 + 12 + 6);
  assert.equal(res.kpi.dzn, 3.5);
  assert.equal(res.kpi.boxes, 1);
  assert.equal(res.kpi.parties, 2);
  assert.equal(res.kpi.cancelled_orders, 1);

  const [riya, jain] = res.parties;
  assert.equal(riya.party, 'Riya Fashion Store');
  assert.deepEqual([riya.pcs, riya.dzn, riya.orders], [36, 3, 1]);
  assert.equal(jain.city, 'Jaipur');
  assert.equal(jain.amount, 1200, '6 x Rs 200');

  const bra = res.items.find((i) => i.product === 'ABC Bra');
  assert.deepEqual([bra.pcs, bra.dzn, bra.amount, bra.avg_rate, bra.orders, bra.parties], [30, 2.5, 6000, 200, 2, 2]);
  const box = res.items.find((i) => i.product === 'Everyday Panty Mix Box');
  assert.deepEqual([box.pcs, box.boxes], [12, 1]);
  assert.ok(res.colours.some((x) => x.colour === 'Mix Color' && x.pcs === 12));
  assert.ok(res.sizes.some((x) => x.size === '32' && x.pcs === 24));
  assert.equal(res.team[0].name, 'Customer (website)');
  assert.equal(res.days.length, 1);

  assert.equal((await salesAnalytics({ scope: 'handed_over' })).kpi.orders, 0, 'none handed over yet');
  assert.equal((await salesAnalytics({ from: '2020-01-01', to: '2020-01-31' })).kpi.orders, 0, 'date range');
});

test('analytics is never open to sub admins', () => {
  const sub = { role: 'SUB_ADMIN', permissions: 'payments,customers,products,inventory,pricing,reports' };
  assert.equal(allowedFor(sub, { method: 'GET', path: '/analytics' }), false);
});

test('ordered vs supplied: changes after the order went to packing are counted; edits before are not', async () => {
  const { a, b, adminCtx, variant } = await setup();
  const black32 = variant('Black', '32').variant_id;
  const white34 = variant('White', '34').variant_id;
  // before packing: the team changes order b - not a shortage
  await updateOrderItemsAdmin(b.order_number, adminOrderItemsSchema.parse({ items: [{ variant_id: white34, qty: 8 }] }), adminCtx);
  // order a goes to packing, then only 18 of 24 Black 32 can be given and the box is dropped
  await updateOrderStatusAdmin(a.order_number, { status: 'PROCESSING' }, adminCtx);
  await updateOrderItemsAdmin(a.order_number, adminOrderItemsSchema.parse({ items: [{ variant_id: black32, qty: 18 }] }), adminCtx);
  await updateOrderStatusAdmin(b.order_number, { status: 'PROCESSING' }, adminCtx);

  const res = await salesAnalytics({});
  const f = res.fulfilment;
  assert.equal(f.packed_orders, 2);
  assert.equal(f.changed_orders, 1);
  assert.deepEqual([f.ordered_pcs, f.supplied_pcs, f.short_pcs, f.extra_pcs], [24 + 12 + 8, 18 + 8, 6 + 12, 0]);
  assert.equal(f.short_amount, 6 * 200 + 12 * 80, '6 bras x Rs 200 + the box of 12 x Rs 80');

  const [changed] = res.changed;
  assert.equal(changed.bill, a.order_number);
  assert.deepEqual([changed.ordered_pcs, changed.supplied_pcs, changed.diff_pcs], [36, 18, -18]);
  assert.match(changed.changes, /ABC Bra Black 32: 24 → 18/);
  assert.match(changed.changes, /Everyday Panty Mix Box Mix Color: 12 → 0/);

  const bra = res.shortage.find((r) => r.product === 'ABC Bra');
  assert.deepEqual([bra.ordered_pcs, bra.supplied_pcs, bra.short_pcs, bra.fill_rate, bra.orders], [24, 18, 6, 75, 1]);
  assert.ok(res.shortage.some((r) => r.product === 'Everyday Panty Mix Box' && r.short_pcs === 12));
  assert.ok(!res.shortage.some((r) => r.colour === 'White'), 'the change before packing is not a shortage');
});
