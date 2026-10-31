import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStore, createColorProduct, CUSTOMER, inventoryOf } from './helpers/fixtures.js';
import {
  createDraftOrder, updateOrderStatusAdmin, updateOrderItemsAdmin, previewOrderItemsAdmin, getOrderAdmin,
} from '../services/orderService.js';
import { createPacker, assignPacker } from '../services/packingService.js';
import { updateSettings } from '../services/settingsService.js';
import { sheetsService } from '../services/sheetsService.js';
import { draftOrderSchema, adminOrderItemsSchema, packerSchema } from '../utils/validation.js';

// The main admin (owner / admin) may still change the items of a dispatched
// or handed-over order; Order_Items_Summary and GBNutex follow.

async function handedOverOrder() {
  const store = await freshStore();
  await updateSettings({ minimum_order_value: 0, online_payment_enabled: false }, store.adminCtx);
  const { variant } = await createColorProduct(store.adminCtx); // ABC Bra, Rs 200 a piece
  const b32 = variant('Black', '32').variant_id;
  const w34 = variant('White', '34').variant_id;
  const b34 = variant('Black', '34').variant_id;
  const o = await createDraftOrder(draftOrderSchema.parse({ customer: CUSTOMER, items: [{ variant_id: b32, qty: 12 }, { variant_id: w34, qty: 6 }], idempotency_key: `eah-${Date.now()}` }));
  const raju = await createPacker(packerSchema.parse({ name: 'Raju', mobile: '9811122334' }), store.adminCtx);
  await assignPacker(o.order_number, { packer_id: raju.packer_id, send: false }, store.adminCtx);
  for (const status of ['CONFIRMED', 'PROCESSING', 'PACKED', 'DISPATCHED', 'COMPLETED']) {
    await updateOrderStatusAdmin(o.order_number, { status, courier_name: 'DTDC', tracking_number: 'D1' }, store.adminCtx);
  }
  return { ...store, o, b32, w34, b34 };
}

test('handed over: a sub admin cannot change items, the main admin can', async () => {
  const { o, b32, adminCtx } = await handedOverOrder();
  const sub = { admin: { admin_id: 'ADM-SUB', role: 'SUB_ADMIN' }, ip: '' };
  const items = [{ variant_id: b32, qty: 6 }];
  await assert.rejects(previewOrderItemsAdmin(o.order_number, { items }, sub), (e) => e.code === 'ORDER_LOCKED' && /main admin/.test(e.message));
  await assert.rejects(updateOrderItemsAdmin(o.order_number, adminOrderItemsSchema.parse({ items }), sub), (e) => e.code === 'ORDER_LOCKED');
  const view = await getOrderAdmin(o.order_number);
  assert.equal(view.actions.can_edit_items, false);
  assert.equal(view.actions.can_edit_items_manager, true);
  const res = await previewOrderItemsAdmin(o.order_number, { items }, adminCtx);
  assert.equal(res.quote.lines[0].qty, 6);
});

test('main admin edits a handed-over order: stock, Order_Items_Summary and GBNutex follow; team columns are kept', async () => {
  const {
    o, b32, w34, b34, adminCtx, sheetsTransport,
  } = await handedOverOrder();
  // the team set MODE and PACKING COST by hand
  const gb = sheetsTransport.sheets.get('GBNutex');
  const h = gb.rows[0];
  gb.rows[1][h.indexOf('MODE')] = 'Ecom Client';
  gb.rows[1][h.indexOf('PACKING COST')] = 15;
  sheetsService.invalidate();

  // Black 32: 12 -> 6, White 34 taken out, Black 34 x 12 added
  await updateOrderItemsAdmin(o.order_number, adminOrderItemsSchema.parse({ items: [{ variant_id: b32, qty: 6 }, { variant_id: b34, qty: 12 }], note: 'Correction after hand-over' }), adminCtx);

  assert.deepEqual(await inventoryOf(b32), { stock: 94, reserved: 0, available: 94 }, '100 - 6');
  assert.equal((await inventoryOf(w34)).stock, 10, 'White 34 back in stock');

  const summary = await sheetsService.read('Order_Items_Summary', { fresh: true });
  assert.deepEqual(summary.map((r) => [r.item_colour, r.size, r.qty_pcs]), [['Black', '32', 6], ['Black', '34', 12]]);

  const rows = await sheetsService.read('GBNutex', { fresh: true });
  assert.deepEqual(rows.map((r) => [r.QTY, r.REVENUE]), [[0.5, 1200], [0, 0], [1, 2400]], 'patched, zeroed, added');
  assert.equal(rows[0].MODE, 'Ecom Client', 'team MODE kept');
  assert.equal(rows[0]['PACKING COST'], 15, 'team PACKING COST kept');
  assert.equal((await getOrderAdmin(o.order_number)).order.order_status, 'COMPLETED');
});
