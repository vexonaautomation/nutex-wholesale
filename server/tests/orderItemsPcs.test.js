import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freshStore, createColorProduct, createBoxProduct, CUSTOMER, PNG_BYTES,
} from './helpers/fixtures.js';
import {
  createDraftOrder, updateOrderItems, getCustomerOrder, updateOrderStatusAdmin, updateOrderItemsAdmin,
} from '../services/orderService.js';
import { submitPayment, verifyPayment, listPayments } from '../services/paymentService.js';
import { updateSettings } from '../services/settingsService.js';
import { sheetsService } from '../services/sheetsService.js';
import { MIGRATIONS } from '../migrations/index.js';
import {
  draftOrderSchema, paymentSubmitSchema, orderStatusSchema, adminOrderItemsSchema,
} from '../utils/validation.js';
import { logger } from '../utils/logger.js';

// Order_Items_Summary: an order's active items in pieces like the IMS, with
// bill number and party - written only when the order is marked HANDED OVER.
// Pieces = colour + pcs; boxes = "Mix Color", boxes x pieces per box.

let n = 0;
const idem = () => `itempcs-${Date.now()}-${(n += 1)}`;
const pick = (r) => [r.item_colour, r.size, r.qty_pcs, r.sold_in, r.boxes, r.pcs_per_box];
const summary = () => sheetsService.read('Order_Items_Summary', { fresh: true });

async function setup() {
  const store = await freshStore();
  await updateSettings({ minimum_order_value: 0 }, store.adminCtx);
  const { variant } = await createColorProduct(store.adminCtx); // MRP 500, 60% off
  const { boxVariant } = await createBoxProduct(store.adminCtx); // 12 pcs per box
  const items = [
    { variant_id: variant('Black', '32').variant_id, qty: 12 },
    { variant_id: variant('White', '34').variant_id, qty: 6 },
    { variant_id: boxVariant.variant_id, qty: 2 },
  ];
  const created = await createDraftOrder(draftOrderSchema.parse({ customer: CUSTOMER, items, idempotency_key: idem() }));
  // paid + verified, so the team can take it to "Handed over"
  const pay = async (o) => {
    const view = await getCustomerOrder(o.order_number, o.access_token);
    await submitPayment(o.order_number, o.access_token, paymentSubmitSchema.parse({ amount: String(view.amount_to_pay), idempotency_key: idem() }), { buffer: PNG_BYTES });
    const pending = (await listPayments({})).items.find((p) => p.order_number === o.order_number && p.status !== 'VERIFIED');
    await verifyPayment(pending.payment_id, { remarks: 'ok' }, store.adminCtx);
  };
  const to = (o, status) => updateOrderStatusAdmin(o.order_number, orderStatusSchema.parse({ status, courier_name: 'DTDC', tracking_number: 'D123' }), store.adminCtx);
  const handOver = async (o) => { for (const s of ['PROCESSING', 'PACKED', 'DISPATCHED', 'COMPLETED']) await to(o, s); };
  return { ...store, created, items, variant, pay, to, handOver };
}

test('summary: nothing until the order is handed over; then its items in pieces with bill no., party, handover date', async () => {
  const { created, pay, to } = await setup();
  assert.deepEqual(await summary(), [], 'not on order placed');
  await pay(created);
  await to(created, 'PROCESSING');
  await to(created, 'PACKED');
  await to(created, 'DISPATCHED');
  assert.deepEqual(await summary(), [], 'not before handed over');

  await to(created, 'COMPLETED');
  const rows = await summary();
  assert.deepEqual(rows.map(pick), [
    ['Black', '32', 12, 'Pcs', null, null],
    ['White', '34', 6, 'Pcs', null, null],
    ['Mix Color', '', 24, 'Box', 2, 12],
  ]);
  const [black, , box] = rows;
  assert.equal(black.bill_no, created.order_number);
  assert.equal(black.party_name, 'Riya Fashion Store');
  assert.equal(black.customer_name, 'Riya Sharma');
  assert.equal(black.mobile, '9876543210');
  assert.equal(black.city, 'Pune');
  assert.equal(black.sku, 'ABC101-BLK-32');
  assert.match(black.order_date, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(black.handover_date, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual([black.mrp_per_pc, black.rate_per_pc, black.amount], [500, 200, 2400]);
  assert.deepEqual([box.mrp_per_pc, box.rate_per_pc], [box.mrp_total / 24, box.amount / 24]);
});

test('summary: items edited before the hand-over count as they are at hand-over time', async () => {
  const {
    created, items, adminCtx, pay, handOver,
  } = await setup();
  await updateOrderItems(created.order_number, created.access_token, { items: [items[0], { ...items[1], qty: 10 }] });
  await pay(created);
  await updateOrderItemsAdmin(created.order_number, adminOrderItemsSchema.parse({ items: [items[0], { ...items[1], qty: 8 }] }), adminCtx);
  assert.deepEqual(await summary(), []);
  await handOver(created);
  assert.deepEqual((await summary()).map((r) => [r.item_colour, r.qty_pcs]), [['Black', 12], ['White', 8]], 'only the final items');
  assert.equal((await sheetsService.read('Order_Items', { fresh: true })).length, 7, 'Order_Items keeps the history');
});

test('remove is only for derived sheets', async () => {
  await setup();
  const [item] = await sheetsService.read('Order_Items', { fresh: true });
  await assert.rejects(sheetsService.commit([{ op: 'remove', sheet: 'Order_Items', id: item.order_item_id }]), /derived sheet/);
});

test('migration v26: rows of orders not handed over leave; handed-over orders get rows and handover date', async () => {
  const {
    sheetsTransport, created, pay, handOver, items,
  } = await setup();
  const other = await createDraftOrder(draftOrderSchema.parse({ customer: CUSTOMER, items: [{ ...items[0], qty: 6 }], idempotency_key: idem() }));
  await pay(created);
  await handOver(created);
  // as v25 left it: every live order in the sheet, handed-over rows without a date
  const sheet = sheetsTransport.sheets.get('Order_Items_Summary');
  sheet.rows.length = 1;
  sheetsService.invalidate();
  await MIGRATIONS.find((m) => m.version === 25).up({ sheets: sheetsService, logger });
  assert.equal((await summary()).length, 4, 'v25: both orders');

  const up = MIGRATIONS.find((m) => m.version === 26).up;
  await up({ sheets: sheetsService, logger });
  await up({ sheets: sheetsService, logger });
  const rows = await summary();
  assert.deepEqual(rows.map((r) => r.bill_no), [created.order_number, created.order_number, created.order_number], 'only the handed-over order');
  assert.ok(rows.every((r) => r.handover_date), 'handover date filled');
  assert.ok(!rows.some((r) => r.bill_no === other.order_number));
});
