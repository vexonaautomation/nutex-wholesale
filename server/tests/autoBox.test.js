import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freshStore, masters, CUSTOMER, PNG_BYTES, inventoryOf,
} from './helpers/fixtures.js';
import { saveProduct, getProductAdmin } from '../services/productService.js';
import { getCatalog, serializeProduct } from '../services/catalogService.js';
import { buildQuote } from '../services/quoteService.js';
import {
  createDraftOrder, updateOrderItems, cancelOrderAdmin, reopenOrderAdmin, recalculateOrder,
} from '../services/orderService.js';
import { submitPayment } from '../services/paymentService.js';
import { applyStockUpdates } from '../services/inventoryService.js';
import { updateSettings } from '../services/settingsService.js';
import { getDashboard } from '../services/dashboardService.js';
import { sheetsService } from '../services/sheetsService.js';
import { productSchema, draftOrderSchema } from '../utils/validation.js';

// Nutex rule: no box stock entered -> boxes are packed from the loose stock,
// an equal number of pieces of every colour of that size.
// Example: box of 3, Pink 5 / Red 8 / Grey 15 -> 1 of each per box -> 5 boxes.

let key = 0;
const idem = () => `auto-box-${Date.now()}-${key += 1}`;
const pay = (o, utr, amount) => submitPayment(o.order_number, o.access_token, { amount, utr, customer_note: '', idempotency_key: idem() }, { buffer: PNG_BYTES });
const order = (items) => createDraftOrder(draftOrderSchema.parse({ customer: CUSTOMER, items, idempotency_key: idem() }));

async function autoBoxProduct(adminCtx, { units = 3, stock = [5, 8, 15], boxStock = null } = {}) {
  await updateSettings({ minimum_order_value: 0 }, adminCtx);
  const m = await masters();
  const s32 = m.size('32').size_id;
  const colours = ['Pink', 'Red', 'Grey'].map((c) => m.color(c).color_id);
  const saved = await saveProduct(productSchema.parse({
    sku: `AUTO${units}`, product_name: 'Auto Box Bra', category_id: m.cat('everyday-bra').category_id, mrp: 100,
    units_per_box: units, size_ids: [s32], color_ids: colours,
    stock: [
      ...colours.map((color_id, i) => ({ color_id, size_id: s32, stock_qty: stock[i] })),
      ...(boxStock === null ? [] : [{ box_key: `size:${s32}`, stock_qty: boxStock }]),
    ],
    status: 'ACTIVE',
  }), adminCtx);
  const box = saved.variants.find((v) => v.inventory_mode === 'BOX_WISE' && v.status === 'ACTIVE');
  const pcs = colours.map((c) => saved.variants.find((v) => v.inventory_mode === 'COLOR_WISE' && v.color_id === c).variant_id);
  return { saved, box: box.variant_id, pcs, pid: saved.product.product_id };
}

const reservedOf = async (ids) => Promise.all(ids.map(async (id) => (await inventoryOf(id)).reserved));
const stockOf = async (ids) => Promise.all(ids.map(async (id) => (await inventoryOf(id)).stock));

test('no box stock: the common loose stock becomes boxes (box of 3, colours 5/8/15 -> 5 boxes)', async () => {
  const { adminCtx } = await freshStore();
  const p = await autoBoxProduct(adminCtx);
  const catalog = await getCatalog({ fresh: true });

  const pub = serializeProduct(catalog, catalog.productsById.get(p.pid), { detail: true });
  const pubBox = pub.variants.find((v) => v.variant_id === p.box);
  assert.ok(pubBox, 'box is offered to customers');

  assert.equal(buildQuote({ items: [{ variant_id: p.box, qty: 5 }], catalog }).has_issues, false);
  const six = buildQuote({ items: [{ variant_id: p.box, qty: 6 }], catalog });
  assert.equal(six.lines[0].issue.code, 'INSUFFICIENT_STOCK');
  assert.equal(six.lines[0].available, 5);
  assert.deepEqual(six.lines[0].stock_components, Object.fromEntries(p.pcs.map((id) => [id, 1])));

  const admin = await getProductAdmin(p.pid);
  const adminBox = admin.variants.find((v) => v.variant_id === p.box);
  assert.deepEqual(adminBox.auto_box, {
    ok: true, per_colour: 1, extra: 0, colours: 3, boxes: 5, reason: null,
  });
  assert.equal(admin.summary.auto_boxes, 5);
  assert.equal(admin.summary.oos_variants, 0, 'auto box with stock is not out of stock');
  assert.equal(admin.summary.total_available, 28, 'loose pieces only - boxes are not counted twice');

  const dash = await getDashboard();
  assert.ok(Array.isArray(dash.out_of_stock));
  assert.ok(!dash.out_of_stock.some((r) => r.sku === adminBox.sku), 'auto box not listed as out of stock');
  assert.equal(dash.cards.out_of_stock_variants, 0);
});

test('box of 6 with 3 colours = 2 of each colour; ordering reserves and payment deducts the colours', async () => {
  const { adminCtx } = await freshStore();
  const p = await autoBoxProduct(adminCtx, { units: 6 });
  let catalog = await getCatalog({ fresh: true });
  assert.equal(buildQuote({ items: [{ variant_id: p.box, qty: 1 }], catalog }).lines[0].available, 2, 'min(5,8,15) / 2 = 2 boxes');

  const o = await order([{ variant_id: p.box, qty: 2 }]);
  assert.deepEqual(await reservedOf(p.pcs), [4, 4, 4]);
  assert.deepEqual(await inventoryOf(p.box), { stock: 0, reserved: 0, available: 0 }, 'box row untouched');
  const items = (await sheetsService.read('Order_Items', { fresh: true })).filter((i) => i.order_number === o.order_number);
  assert.deepEqual(JSON.parse(items[0].stock_components), Object.fromEntries(p.pcs.map((id) => [id, 2])));
  assert.equal(items[0].qty, 2);

  catalog = await getCatalog({ fresh: true });
  assert.equal(buildQuote({ items: [{ variant_id: p.box, qty: 1 }], catalog }).has_issues, true, '5-4 = 1 pink left, not enough for a box');

  const total = (await recalculateOrder(o.order_number, o.access_token)).quote.final_payable;
  await pay(o, 'UTRAUTO000001', total);
  assert.deepEqual(await stockOf(p.pcs), [1, 4, 11]);
  assert.deepEqual(await reservedOf(p.pcs), [0, 0, 0]);

  // reopen puts the same pieces back on hold, cancel releases them
  await reopenOrderAdmin(o.order_number, { reason: 'change', confirm: true }, adminCtx);
  assert.deepEqual(await stockOf(p.pcs), [5, 8, 15]);
  assert.deepEqual(await reservedOf(p.pcs), [4, 4, 4]);
  await cancelOrderAdmin(o.order_number, { reason: 'Customer cancelled' }, adminCtx);
  assert.deepEqual(await reservedOf(p.pcs), [0, 0, 0]);
  assert.deepEqual(await stockOf(p.pcs), [5, 8, 15]);
});

test('boxes and loose pieces of the same colours are checked together (no oversell)', async () => {
  const { adminCtx } = await freshStore();
  const p = await autoBoxProduct(adminCtx);
  const catalog = await getCatalog({ fresh: true });
  const pink = p.pcs[0];
  const tooMuch = buildQuote({ items: [{ variant_id: p.box, qty: 3 }, { variant_id: pink, qty: 3 }], catalog });
  assert.equal(tooMuch.has_issues, true, '3 boxes + 3 pink = 6 pink but only 5');
  assert.ok(tooMuch.lines.every((l) => l.issue?.code === 'INSUFFICIENT_STOCK'));
  const ok = buildQuote({ items: [{ variant_id: p.box, qty: 3 }, { variant_id: pink, qty: 2 }], catalog });
  assert.equal(ok.has_issues, false);

  await assert.rejects(order([{ variant_id: p.box, qty: 3 }, { variant_id: pink, qty: 3 }]), (err) => err.code === 'STOCK_CHANGED');
  await order([{ variant_id: p.box, qty: 3 }, { variant_id: pink, qty: 2 }]);
  assert.deepEqual(await reservedOf(p.pcs), [5, 3, 3]);
});

test('editing an order moves only the difference of the colour pieces', async () => {
  const { adminCtx } = await freshStore();
  const p = await autoBoxProduct(adminCtx);
  const o = await order([{ variant_id: p.box, qty: 2 }]);
  assert.deepEqual(await reservedOf(p.pcs), [2, 2, 2]);
  // all 5 boxes: the 2 already held by this order still count for it
  await updateOrderItems(o.order_number, o.access_token, { items: [{ variant_id: p.box, qty: 5 }] });
  assert.deepEqual(await reservedOf(p.pcs), [5, 5, 5]);
  await updateOrderItems(o.order_number, o.access_token, { items: [{ variant_id: p.box, qty: 1 }, { variant_id: p.pcs[2], qty: 4 }] });
  assert.deepEqual(await reservedOf(p.pcs), [1, 1, 5]);
});

test('stock is entered in pieces only: box stock is never taken, a box size can be stopped', async () => {
  const { adminCtx } = await freshStore();
  const p = await autoBoxProduct(adminCtx, { boxStock: 2 });
  assert.equal((await inventoryOf(p.box)).stock, 0, 'box stock from the product form is ignored');
  let catalog = await getCatalog({ fresh: true });
  assert.equal(buildQuote({ items: [{ variant_id: p.box, qty: 5 }], catalog }).has_issues, false, 'still 5 boxes from the pieces');

  // Inventory page / API: no box stock number, only the out-of-stock flag
  const inv = (await sheetsService.read('Inventory', { fresh: true })).find((r) => r.variant_id === p.box);
  await assert.rejects(applyStockUpdates([{ inventory_id: inv.inventory_id, stock_qty: 9 }], adminCtx), /packed from the loose pieces/);
  await applyStockUpdates([{ inventory_id: inv.inventory_id, status: 'OUT_OF_STOCK' }], adminCtx);
  catalog = await getCatalog({ fresh: true });
  assert.equal(buildQuote({ items: [{ variant_id: p.box, qty: 1 }], catalog }).lines[0].issue.code, 'OUT_OF_STOCK', 'box size stopped');
  const pcsQuote = buildQuote({ items: [{ variant_id: p.pcs[0], qty: 1 }], catalog, customer: { existing: true, minimum_order_value: 0 } });
  assert.equal(pcsQuote.has_issues, false, 'loose pieces still sell');
  await applyStockUpdates([{ inventory_id: inv.inventory_id, status: 'ACTIVE' }], adminCtx);
  assert.equal(buildQuote({ items: [{ variant_id: p.box, qty: 1 }], catalog: await getCatalog({ fresh: true }) }).has_issues, false);

  // a product with a box needs colours (boxes are packed from them)
  const m = await masters();
  await assert.rejects(saveProduct(productSchema.parse({
    sku: 'NOCOL', product_name: 'No Colour Box', category_id: m.cat('everyday-bra').category_id, mrp: 100,
    units_per_box: 6, size_ids: [m.size('32').size_id], color_ids: [], status: 'ACTIVE',
  }), adminCtx), /Select the colours too/);
});

test('mix box: pieces per box not divisible by the colours - extras come from the colours with most stock', async () => {
  const { adminCtx } = await freshStore();
  // box of 4, colours 5 / 8 / 15 -> 1 of each + 1 extra; at most 5 boxes (Pink has 5)
  const p = await autoBoxProduct(adminCtx, { units: 4 });
  const catalog = await getCatalog({ fresh: true });
  const q = buildQuote({ items: [{ variant_id: p.box, qty: 3 }], catalog });
  assert.equal(q.lines[0].issue, null);
  assert.equal(q.lines[0].available, 5);
  const auto = (await getProductAdmin(p.pid)).variants.find((v) => v.variant_id === p.box).auto_box;
  assert.deepEqual([auto.ok, auto.per_colour, auto.extra, auto.boxes], [true, 1, 1, 5]);
  await order([{ variant_id: p.box, qty: 3 }]);
  assert.deepEqual(await reservedOf(p.pcs), [3, 3, 6], '3 of each + the 3 extras from Grey (most stock)');
});

test('mix box of 6 with 5 colours: uneven pieces per box are reserved, deducted and released exactly', async () => {
  const { adminCtx } = await freshStore();
  await updateSettings({ minimum_order_value: 0 }, adminCtx);
  const m = await masters();
  const s32 = m.size('32').size_id;
  const colours = ['Black', 'White', 'Skin', 'Pink', 'Red'].map((c) => m.color(c).color_id);
  const saved = await saveProduct(productSchema.parse({
    sku: 'MIX6', product_name: 'Mix Six', category_id: m.cat('everyday-bra').category_id, mrp: 100,
    units_per_box: 6, size_ids: [s32], color_ids: colours,
    stock: colours.map((color_id) => ({ color_id, size_id: s32, stock_qty: 10 })), status: 'ACTIVE',
  }), adminCtx);
  const box = saved.variants.find((v) => v.inventory_mode === 'BOX_WISE').variant_id;
  const pcs = colours.map((c) => saved.variants.find((v) => v.color_id === c && v.inventory_mode === 'COLOR_WISE').variant_id);
  const catalog = await getCatalog({ fresh: true });
  assert.equal(buildQuote({ items: [{ variant_id: box, qty: 1 }], catalog }).lines[0].available, 8, '50 pcs / 6 = 8 boxes');
  assert.equal(buildQuote({ items: [{ variant_id: box, qty: 9 }], catalog }).lines[0].issue.code, 'INSUFFICIENT_STOCK');

  const o = await order([{ variant_id: box, qty: 2 }]);
  const reserved = await reservedOf(pcs);
  assert.equal(reserved.reduce((a, b) => a + b, 0), 12, '2 boxes x 6 pcs');
  assert.ok(reserved.every((n) => n === 2 || n === 3), `2 of each + 2 extras from different colours: ${reserved}`);

  const amount = (await recalculateOrder(o.order_number, o.access_token)).quote.final_payable;
  await pay(o, 'UTRMIX000001', amount);
  const stock = await stockOf(pcs);
  assert.equal(stock.reduce((a, b) => a + b, 0), 50 - 12);
  assert.deepEqual(await reservedOf(pcs), [0, 0, 0, 0, 0]);
  await reopenOrderAdmin(o.order_number, { reason: 'change', confirm: true }, adminCtx);
  await cancelOrderAdmin(o.order_number, { reason: 'cancel' }, adminCtx);
  assert.deepEqual(await stockOf(pcs), [10, 10, 10, 10, 10], 'exactly the same pieces come back');
  assert.deepEqual(await reservedOf(pcs), [0, 0, 0, 0, 0]);
});

test('mix box smaller than the colours (box of 3, 6 colours): pieces from different colours', async () => {
  const { adminCtx } = await freshStore();
  await updateSettings({ minimum_order_value: 0 }, adminCtx);
  const m = await masters();
  const s32 = m.size('32').size_id;
  const colours = ['Black', 'White', 'Skin', 'Pink', 'Red', 'Grey'].map((c) => m.color(c).color_id);
  const saved = await saveProduct(productSchema.parse({
    sku: 'MIX3', product_name: 'Mix Three', category_id: m.cat('everyday-bra').category_id, mrp: 100,
    units_per_box: 3, size_ids: [s32], color_ids: colours,
    stock: colours.map((color_id) => ({ color_id, size_id: s32, stock_qty: 10 })), status: 'ACTIVE',
  }), adminCtx);
  const box = saved.variants.find((v) => v.inventory_mode === 'BOX_WISE').variant_id;
  const catalog = await getCatalog({ fresh: true });
  assert.equal(buildQuote({ items: [{ variant_id: box, qty: 1 }], catalog }).lines[0].available, 20, '60 pcs / 3');
  const pcs = colours.map((c) => saved.variants.find((v) => v.color_id === c && v.inventory_mode === 'COLOR_WISE').variant_id);
  await order([{ variant_id: box, qty: 4 }]);
  const reserved = await reservedOf(pcs);
  assert.equal(reserved.reduce((a, b) => a + b, 0), 12);
  assert.ok(reserved.every((n) => n <= 4), 'never more than 1 of a colour per box');
});
