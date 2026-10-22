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

// Order_Items_Summary: items in pieces like the IMS, with bill number and
// party. Pieces = colour + pcs; boxes = "Mix Color", boxes x pieces per box.

const pick = (r) => [r.item_colour, r.size, r.qty_pcs, r.sold_in, r.boxes, r.pcs_per_box, r.item_status];

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
    ['Black', '32', 12, 'Pcs', null, null, 'ACTIVE'],
    ['White', '34', 6, 'Pcs', null, null, 'ACTIVE'],
    ['Mix Color', '', 24, 'Box', 2, 12, 'ACTIVE'],
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

test('summary: an edit marks the old rows REPLACED; a cancel marks them CANCELLED', async () => {
  const { created, items, adminCtx } = await setup();
  await updateOrderItems(created.order_number, created.access_token, { items: [items[0], { ...items[1], qty: 10 }] });
  let rows = await sheetsService.read('Order_Items_Summary', { fresh: true });
  assert.deepEqual(rows.map((r) => [r.qty_pcs, r.item_status]), [[12, 'REPLACED'], [6, 'REPLACED'], [24, 'REPLACED'], [12, 'ACTIVE'], [10, 'ACTIVE']]);
  await cancelOrderAdmin(created.order_number, { reason: 'Customer asked to cancel' }, adminCtx);
  rows = await sheetsService.read('Order_Items_Summary', { fresh: true });
  assert.deepEqual(rows.map((r) => r.item_status), ['REPLACED', 'REPLACED', 'REPLACED', 'CANCELLED', 'CANCELLED']);
});

test('migration v25 writes the summary for items already in the sheets (once)', async () => {
  const { sheetsTransport } = await setup();
  const sheet = sheetsTransport.sheets.get('Order_Items_Summary');
  sheet.rows.length = 1; // as before v25: only the header
  sheetsService.invalidate();
  const up = MIGRATIONS.find((m) => m.version === 25).up;
  await up({ sheets: sheetsService, logger });
  await up({ sheets: sheetsService, logger });
  const rows = await sheetsService.read('Order_Items_Summary', { fresh: true });
  assert.deepEqual(rows.map((r) => [r.item_colour, r.qty_pcs, r.sold_in]), [['Black', 12, 'Pcs'], ['White', 6, 'Pcs'], ['Mix Color', 24, 'Box']]);
});
