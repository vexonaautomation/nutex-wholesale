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
    ok: true, per_colour: 1, colours: 3, boxes: 5, reason: null,
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

test('box stock entered = pre-packed boxes: uses the box row, colours untouched', async () => {
  const { adminCtx } = await freshStore();
  const p = await autoBoxProduct(adminCtx, { boxStock: 2 });
  const catalog = await getCatalog({ fresh: true });
  assert.equal(buildQuote({ items: [{ variant_id: p.box, qty: 3 }], catalog }).lines[0].issue.code, 'INSUFFICIENT_STOCK');
  await order([{ variant_id: p.box, qty: 2 }]);
  assert.deepEqual(await inventoryOf(p.box), { stock: 2, reserved: 2, available: 0 });
  assert.deepEqual(await reservedOf(p.pcs), [0, 0, 0]);
  const items = await sheetsService.read('Order_Items', { fresh: true });
  assert.equal(items[0].stock_components, '', 'normal lines keep the column blank');
  assert.equal((await getProductAdmin(p.pid)).variants.find((v) => v.variant_id === p.box).auto_box, null);
});

test('pieces per box not divisible by the colours: no auto box, admin sees why', async () => {
  const { adminCtx } = await freshStore();
  const p = await autoBoxProduct(adminCtx, { units: 4 });
  const catalog = await getCatalog({ fresh: true });
  assert.equal(buildQuote({ items: [{ variant_id: p.box, qty: 1 }], catalog }).lines[0].issue.code, 'OUT_OF_STOCK');
  const auto = (await getProductAdmin(p.pid)).variants.find((v) => v.variant_id === p.box).auto_box;
  assert.equal(auto.ok, false);
  assert.match(auto.reason, /4 pcs cannot be split equally into 3 colours/);
});
