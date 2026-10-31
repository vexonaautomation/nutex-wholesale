import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStore, createColorProduct, createBoxProduct, CUSTOMER } from './helpers/fixtures.js';
import {
  createDraftOrder, updateOrderStatusAdmin, updateOrderItemsAdmin, getOrderAdmin,
} from '../services/orderService.js';
import { packingSlip } from '../services/billService.js';
import { updateSettings } from '../services/settingsService.js';
import { sheetsService } from '../services/sheetsService.js';
import { MIGRATIONS } from '../migrations/index.js';
import { draftOrderSchema, adminOrderItemsSchema } from '../utils/validation.js';
import { logger } from '../utils/logger.js';

// Edited after processing: the admin page, the Orders sheet and the packing
// slip all count the same pieces (a box counts its pieces).

test('edit after processing: admin totals and Orders sheet show the pieces of the packing slip', async () => {
  const { adminCtx, sheetsTransport } = await freshStore();
  await updateSettings({ minimum_order_value: 0, online_payment_enabled: false }, adminCtx);
  const { variant } = await createColorProduct(adminCtx);
  const { boxVariant } = await createBoxProduct(adminCtx); // box of 12
  const b32 = variant('Black', '32').variant_id;
  const o = await createDraftOrder(draftOrderSchema.parse({ customer: CUSTOMER, items: [{ variant_id: b32, qty: 12 }, { variant_id: boxVariant.variant_id, qty: 2 }], idempotency_key: `pcs-${Date.now()}` }));
  for (const s of ['CONFIRMED', 'PROCESSING']) await updateOrderStatusAdmin(o.order_number, { status: s }, adminCtx);
  await updateOrderItemsAdmin(o.order_number, adminOrderItemsSchema.parse({ items: [{ variant_id: b32, qty: 8 }, { variant_id: boxVariant.variant_id, qty: 1 }] }), adminCtx);

  const admin = await getOrderAdmin(o.order_number);
  const slip = await packingSlip(admin.order.order_id);
  assert.equal(slip.slip.total_pcs, 20, '8 pcs + a box of 12');
  assert.deepEqual([admin.totals.total_pcs, admin.totals.total_boxes], [20, 1], 'same as the packing slip');
  assert.deepEqual(admin.items.map((i) => Number(i.qty)), [8, 1], 'only the current items');
  const row = (await sheetsService.read('Orders', { fresh: true }))[0];
  assert.deepEqual([row.total_pcs, row.total_boxes], [20, 1], 'Orders sheet');

  // an order from before v29: filled by the migration
  const sheet = sheetsTransport.sheets.get('Orders');
  sheet.rows[1][sheet.rows[0].indexOf('total_pcs')] = '';
  sheet.rows[1][sheet.rows[0].indexOf('total_boxes')] = '';
  sheetsService.invalidate();
  await MIGRATIONS.find((m) => m.version === 29).up({ sheets: sheetsService, logger });
  const again = (await sheetsService.read('Orders', { fresh: true }))[0];
  assert.deepEqual([again.total_pcs, again.total_boxes], [20, 1]);
});
