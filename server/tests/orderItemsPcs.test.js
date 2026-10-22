import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStore, createColorProduct, createBoxProduct, CUSTOMER } from './helpers/fixtures.js';
import { createDraftOrder, updateOrderItems, cancelOrderAdmin } from '../services/orderService.js';
import { updateSettings } from '../services/settingsService.js';
import { sheetsService } from '../services/sheetsService.js';
import { MIGRATIONS } from '../migrations/index.js';
import { draftOrderSchema } from '../utils/validation.js';
import { logger } from '../utils/logger.js';

// Order_Items_Summary: the ACTIVE items of live orders in pieces like the IMS,
// with bill number and party. Pieces = colour + pcs; boxes = "Mix Color",
// boxes x pieces per box. Edited / cancelled rows are removed.

const pick = (r) => [r.item_colour, r.size, r.qty_pcs, r.sold_in, r.boxes, r.pcs_per_box];

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
  const created = await createDraftOrder(draftOrderSchema.parse({ customer: CUSTOMER, items, idempotency_key: `itempcs-${Date.now()}` }));
  return { ...store, created, items, variant };
}

test('summary: one row per item in pieces, with bill number and party; rates per piece', async () => {
  const { created } = await setup();
  const rows = await sheetsService.read('Order_Items_Summary', { fresh: true });
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
  assert.deepEqual([black.mrp_per_pc, black.rate_per_pc, black.amount], [500, 200, 2400]);
  assert.deepEqual([box.mrp_per_pc, box.rate_per_pc], [box.mrp_total / 24, box.amount / 24]);
});

test('summary keeps only active items: an edit replaces the order rows, a cancel removes them', async () => {
  const { created, items, adminCtx } = await setup();
  const other = await createDraftOrder(draftOrderSchema.parse({ customer: CUSTOMER, items: [{ ...items[0], qty: 6 }], idempotency_key: `itempcs-other-${Date.now()}` }));
  const rowsOf = async () => (await sheetsService.read('Order_Items_Summary', { fresh: true })).map((r) => [r.bill_no, r.item_colour, r.qty_pcs]);

  await updateOrderItems(created.order_number, created.access_token, { items: [items[0], { ...items[1], qty: 10 }] });
  assert.deepEqual(await rowsOf(), [
    [other.order_number, 'Black', 6],
    [created.order_number, 'Black', 12],
    [created.order_number, 'White', 10],
  ], 'old rows of the edited order removed; the other order untouched');
  assert.equal((await sheetsService.read('Order_Items', { fresh: true })).length, 6, 'Order_Items keeps the history');

  await cancelOrderAdmin(created.order_number, { reason: 'Customer asked to cancel' }, adminCtx);
  assert.deepEqual(await rowsOf(), [[other.order_number, 'Black', 6]], 'cancelled order removed');
});

test('remove is only for derived sheets', async () => {
  await setup();
  const [item] = await sheetsService.read('Order_Items', { fresh: true });
  await assert.rejects(sheetsService.commit([{ op: 'remove', sheet: 'Order_Items', id: item.order_item_id }]), /derived sheet/);
});

test('migration v25 writes the summary for items already in the sheets (once)', async () => {
  const { sheetsTransport, created, adminCtx, items } = await setup();
  // an edited order and a cancelled order: only active items of live orders
  await updateOrderItems(created.order_number, created.access_token, { items });
  const gone = await createDraftOrder(draftOrderSchema.parse({ customer: CUSTOMER, items: [items[0]], idempotency_key: `itempcs-gone-${Date.now()}` }));
  await cancelOrderAdmin(gone.order_number, { reason: 'Cancelled before v25' }, adminCtx);
  const sheet = sheetsTransport.sheets.get('Order_Items_Summary');
  sheet.rows.length = 1; // as before v25: only the header
  sheetsService.invalidate();
  const up = MIGRATIONS.find((m) => m.version === 25).up;
  await up({ sheets: sheetsService, logger });
  await up({ sheets: sheetsService, logger });
  const rows = await sheetsService.read('Order_Items_Summary', { fresh: true });
  assert.deepEqual(rows.map((r) => [r.item_colour, r.qty_pcs, r.sold_in]), [['Black', 12, 'Pcs'], ['White', 6, 'Pcs'], ['Mix Color', 24, 'Box']]);
});
