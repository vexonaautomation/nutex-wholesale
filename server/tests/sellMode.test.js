import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freshStore, masters, CUSTOMER, PNG_BYTES, inventoryOf, createBoxProduct,
} from './helpers/fixtures.js';
import { saveProduct, getProductAdmin, bulkSetSelling } from '../services/productService.js';
import { getCatalog, serializeProduct } from '../services/catalogService.js';
import { buildQuote } from '../services/quoteService.js';
import { createDraftOrder, getOrderAdmin, getCustomerOrder } from '../services/orderService.js';
import { submitPayment, verifyPayment } from '../services/paymentService.js';
import { updateSettings } from '../services/settingsService.js';
import { resolveExistingCustomer } from '../services/existingCustomerService.js';
import { sheetsService } from '../services/sheetsService.js';
import { productSchema, draftOrderSchema, bulkSellingSchema } from '../utils/validation.js';

let key = 0;
const idem = () => `sell-key-${Date.now()}-${key += 1}`;
const code = (c) => (err) => { assert.equal(err.code, c); return true; };
const EXISTING = { existing: true, minimum_order_value: 0 };

async function bothProduct(adminCtx, extra = {}) {
  const m = await masters();
  const s32 = m.size('32').size_id;
  const s34 = m.size('34').size_id;
  const black = m.color('Black').color_id;
  const white = m.color('White').color_id;
  const saved = await saveProduct(productSchema.parse({
    sku: 'BOTH100', product_name: 'Both Ways Bra', category_id: m.cat('everyday-bra').category_id, mrp: 100,
    sell_mode: 'BOTH', units_per_box: 6, size_ids: [s32, s34], color_ids: [black, white],
    size_mrps: [{ size_id: s34, mrp: 120 }],
    stock: [
      { color_id: black, size_id: s32, stock_qty: 50 }, { color_id: black, size_id: s34, stock_qty: 50 },
      { color_id: white, size_id: s32, stock_qty: 50 }, { color_id: white, size_id: s34, stock_qty: 50 },
      { box_key: `size:${s32}`, stock_qty: 10 }, { box_key: `size:${s34}`, stock_qty: 4 },
    ],
    status: 'ACTIVE',
    ...extra,
  }), adminCtx);
  const box = (sizeId) => saved.variants.find((v) => v.inventory_mode === 'BOX_WISE' && v.size_id === sizeId && v.status === 'ACTIVE');
  const pcs = (colorId, sizeId) => saved.variants.find((v) => v.inventory_mode === 'COLOR_WISE' && v.color_id === colorId && v.size_id === sizeId);
  return {
    saved, m, s32, s34, black, white, box, pcs,
  };
}

test('BOTH product: one box per size, box price = pieces x piece MRP (size-wise), no colour on boxes', async () => {
  const { adminCtx } = await freshStore({ pcsForAll: false });
  const p = await bothProduct(adminCtx);
  assert.equal(p.saved.product.sell_mode, 'BOTH');
  assert.equal(p.saved.product.units_per_box, 6);
  assert.equal(p.saved.variants.filter((v) => v.status === 'ACTIVE').length, 6, '4 piece variants + 2 boxes');
  const b32 = p.box(p.s32);
  const b34 = p.box(p.s34);
  assert.equal(b32.units_per_box, 6);
  assert.equal(b32.color_id, '');
  assert.equal(b32.unit_mrp, 600);
  assert.equal(b34.unit_mrp, 720, '6 x size MRP 120');
  // stock is entered in pieces only: the box stock sent (10) is ignored
  assert.deepEqual(await inventoryOf(b32.variant_id), { stock: 0, reserved: 0, available: 0 });
  const boxQuote = buildQuote({ items: [{ variant_id: b32.variant_id, qty: 1 }], catalog: await getCatalog({ fresh: true }) });
  assert.equal(boxQuote.lines[0].available, 16, '50 pcs each of 2 colours, 3 of each per box -> 16 boxes');

  const catalog = await getCatalog({ fresh: true });
  const pub = serializeProduct(catalog, catalog.productsById.get(p.saved.product.product_id), { detail: true });
  assert.equal(pub.can_box, true);
  assert.equal(pub.can_pcs, true);
  assert.equal(pub.mrp_min, 100);
  assert.equal(pub.mrp_max, 120);
  assert.equal(pub.box_min_units, 6);
  const pubBox = pub.variants.find((v) => v.variant_id === b34.variant_id);
  assert.equal(pubBox.kind, 'BOX');
  assert.equal(pubBox.piece_mrp, 120);
});

test('new customers: boxes only; existing customers: boxes or pieces (enforced by the server)', async () => {
  const { adminCtx } = await freshStore({ pcsForAll: false });
  const p = await bothProduct(adminCtx);
  await updateSettings({ minimum_order_value: 0 }, adminCtx);
  const catalog = await getCatalog({ fresh: true });
  const pcsLine = { variant_id: p.pcs(p.black, p.s32).variant_id, qty: 2 };
  const boxLine = { variant_id: p.box(p.s32).variant_id, qty: 1 };

  const asNew = buildQuote({ items: [pcsLine, boxLine], catalog });
  assert.equal(asNew.pcs_allowed, false);
  assert.equal(asNew.lines.find((l) => l.variant_id === pcsLine.variant_id).issue.code, 'PCS_EXISTING_ONLY');
  assert.equal(asNew.lines.find((l) => l.variant_id === boxLine.variant_id).issue, null);
  assert.equal(asNew.can_checkout, false);
  assert.ok(asNew.messages.some((mm) => mm.code === 'PCS_EXISTING_ONLY'));
  const boxOnly = buildQuote({ items: [boxLine], catalog });
  assert.equal(boxOnly.can_checkout, true);
  assert.equal(boxOnly.lines[0].pieces, 6);
  assert.equal(boxOnly.lines[0].box_label, 'Mix Color Box of 6 pcs (Size 32)');
  // options offered in the cart for a new customer are boxes only
  assert.ok(boxOnly.variant_options[p.saved.product.product_id].every((o) => o.inventory_mode === 'BOX_WISE'));

  const asExisting = buildQuote({ items: [pcsLine, boxLine], catalog, customer: EXISTING });
  assert.equal(asExisting.pcs_allowed, true);
  assert.equal(asExisting.has_issues, false);

  // a new customer cannot place an order with loose pieces (API manipulation)
  await assert.rejects(createDraftOrder(draftOrderSchema.parse({ customer: CUSTOMER, items: [pcsLine], idempotency_key: idem() })), code('STOCK_CHANGED'));
  const order = await createDraftOrder(draftOrderSchema.parse({ customer: CUSTOMER, items: [boxLine], idempotency_key: idem() }));
  assert.equal((await getCustomerOrder(order.order_number, order.access_token)).totals.final_payable, 240, '1 box x 600 MRP at 60% off');
  // the box holds 3 Black + 3 White size 32 pieces; the box row itself has no stock
  assert.deepEqual(await inventoryOf(p.pcs(p.black, p.s32).variant_id), { stock: 50, reserved: 3, available: 47 });
  assert.deepEqual(await inventoryOf(p.pcs(p.white, p.s32).variant_id), { stock: 50, reserved: 3, available: 47 });
  assert.deepEqual(await inventoryOf(boxLine.variant_id), { stock: 0, reserved: 0, available: 0 });

  // setting off: everybody may buy pieces
  await updateSettings({ pcs_for_existing_customers_only: false }, adminCtx);
  const open = buildQuote({ items: [pcsLine], catalog: await getCatalog({ fresh: true }) });
  assert.equal(open.has_issues, false);
});

test('switching PCS / BOX / BOTH and pieces per box keeps IDs and stock, never deletes', async () => {
  const { adminCtx } = await freshStore({ pcsForAll: false });
  const p = await bothProduct(adminCtx);
  const pid = p.saved.product.product_id;
  const pcsId = p.pcs(p.black, p.s32).variant_id;
  const box6 = p.box(p.s32).variant_id;
  const edit = async (fields) => {
    const cur = await getProductAdmin(pid);
    return saveProduct(productSchema.parse({ ...cur.product, stock: [], boxes: [], images: [], ...fields }), { ...adminCtx, productId: pid });
  };

  let saved = await edit({ sell_mode: 'BOX', units_per_box: 6 });
  let catalog = await getCatalog({ fresh: true });
  let pub = serializeProduct(catalog, catalog.productsById.get(pid), { detail: true });
  assert.equal(pub.can_pcs, false);
  assert.equal(pub.colors.length, 0, 'no colour choice on box-only products');
  assert.equal(saved.variants.find((v) => v.variant_id === pcsId).status, 'INACTIVE');

  saved = await edit({ sell_mode: 'BOTH', units_per_box: 6 });
  assert.equal(saved.variants.find((v) => v.variant_id === pcsId).status, 'ACTIVE', 'same piece variant reactivated');
  assert.deepEqual(await inventoryOf(pcsId), { stock: 50, reserved: 0, available: 50 }, 'stock kept');

  saved = await edit({ sell_mode: 'BOTH', units_per_box: 12 });
  assert.equal(saved.variants.find((v) => v.variant_id === box6).status, 'INACTIVE', 'old 6-pc box kept inactive');
  const box12 = saved.variants.find((v) => v.inventory_mode === 'BOX_WISE' && v.size_id === p.s32 && v.status === 'ACTIVE');
  assert.equal(box12.units_per_box, 12);
  assert.equal(box12.unit_mrp, 1200);

  saved = await edit({ sell_mode: 'PCS' });
  catalog = await getCatalog({ fresh: true });
  pub = serializeProduct(catalog, catalog.productsById.get(pid), { detail: true });
  assert.equal(pub.can_box, false);
  assert.equal(saved.product.units_per_box, null);
  const all = await sheetsService.read('Product_Variants', { fresh: true });
  assert.equal(all.filter((v) => v.product_id === pid).length, 8, '4 pcs + 2 boxes of 6 + 2 boxes of 12 - nothing deleted');
});

test('bulk selling options for many products at once', async () => {
  const { adminCtx } = await freshStore({ pcsForAll: false });
  const a = await bothProduct(adminCtx, { sku: 'BULKA', product_name: 'Bulk A', sell_mode: 'PCS', units_per_box: null });
  const b = await bothProduct(adminCtx, { sku: 'BULKB', product_name: 'Bulk B', sell_mode: 'PCS', units_per_box: null });
  const input = bulkSellingSchema.parse({ product_ids: [a.saved.product.product_id, b.saved.product.product_id], sell_mode: 'BOTH', units_per_box: 10 });
  const res = await bulkSetSelling(input, adminCtx);
  assert.deepEqual(res.updated.sort(), ['BULKA', 'BULKB']);
  const after = await getProductAdmin(a.saved.product.product_id);
  assert.equal(after.product.sell_mode, 'BOTH');
  const boxes = after.variants.filter((v) => v.inventory_mode === 'BOX_WISE' && v.status === 'ACTIVE');
  assert.equal(boxes.length, 2);
  assert.ok(boxes.every((v) => v.units_per_box === 10 && v.inventory.stock_qty === 0), 'boxes take no stock');
  assert.ok(boxes.every((v) => v.auto_box.ok && v.auto_box.per_colour === 5 && v.auto_box.boxes === 10), '10 pcs = 5 of each colour, 50 pcs each -> 10 boxes');
  assert.equal(after.variants.find((v) => v.inventory_mode === 'BOX_WISE' && v.size_id === a.s34).unit_mrp, 1200, '10 x size MRP 120');
  const again = await bulkSetSelling(input, adminCtx);
  assert.deepEqual(again.unchanged.sort(), ['BULKA', 'BULKB'], 'running it again changes nothing');
  assert.throws(() => bulkSellingSchema.parse({ product_ids: ['PRD-X'], sell_mode: 'BOX' }), /pieces are in one box/);
});

test('first paid order makes the customer an existing customer (pieces + no minimum)', async () => {
  const { adminCtx } = await freshStore({ pcsForAll: false });
  const p = await bothProduct(adminCtx);
  await updateSettings({ minimum_order_value: 0 }, adminCtx);
  const boxLine = { variant_id: p.box(p.s32).variant_id, qty: 1 };
  const created = await createDraftOrder(draftOrderSchema.parse({ customer: CUSTOMER, items: [boxLine], idempotency_key: idem() }));
  await submitPayment(created.order_number, created.access_token, {
    amount: 240, utr: 'UTRFIRST0001', customer_note: '', idempotency_key: idem(),
  }, { buffer: PNG_BYTES });
  let rows = await sheetsService.read('Existing_Customers', { fresh: true });
  assert.equal(rows.length, 0, 'not existing until the payment is verified');
  const pending = (await getOrderAdmin(created.order_number)).payments.find((x) => x.status === 'SUBMITTED');
  await verifyPayment(pending.payment_id, { remarks: 'ok' }, adminCtx);
  rows = await sheetsService.read('Existing_Customers', { fresh: true });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].mobile, CUSTOMER.mobile);
  assert.equal(rows[0].added_by, 'AUTO_FIRST_ORDER');
  const catalog = await getCatalog({ fresh: true });
  assert.equal(resolveExistingCustomer(catalog.existingCustomers, catalog.settings, CUSTOMER.mobile).existing, true);

  // setting off -> a second new customer is not added
  await updateSettings({ auto_existing_after_first_order: false }, adminCtx);
  const other = { ...CUSTOMER, mobile: '9123456780', customer_name: 'Second Shop' };
  const o2 = await createDraftOrder(draftOrderSchema.parse({ customer: other, items: [boxLine], idempotency_key: idem() }));
  await submitPayment(o2.order_number, o2.access_token, {
    amount: 240, utr: 'UTRSECOND001', customer_note: '', idempotency_key: idem(),
  }, { buffer: PNG_BYTES });
  const pending2 = (await getOrderAdmin(o2.order_number)).payments.find((x) => x.status === 'SUBMITTED');
  await verifyPayment(pending2.payment_id, { remarks: 'ok' }, adminCtx);
  assert.equal((await sheetsService.read('Existing_Customers', { fresh: true })).length, 1);
});

test('older box-wise products (own box configs) keep working', async () => {
  const { adminCtx } = await freshStore({ pcsForAll: false });
  const { saved, boxVariant } = await createBoxProduct(adminCtx);
  assert.equal(saved.product.sell_mode, 'BOX');
  assert.equal(saved.legacy_boxes, true);
  const catalog = await getCatalog({ fresh: true });
  const q = buildQuote({ items: [{ variant_id: boxVariant.variant_id, qty: 1 }], catalog });
  assert.equal(q.lines[0].issue, null, 'new customers may buy boxes');
  assert.equal(q.lines[0].unit_mrp, 2400, '12 x 200');
});

test('Nutex rule: existing customers always box or pieces; new customers boxes unless pieces are opened for that product', async () => {
  const { adminCtx } = await freshStore({ pcsForAll: false });
  const m = await masters();
  const s32 = m.size('32').size_id;
  const black = m.color('Black').color_id;
  // wizard-style payload: pieces per box + colours, no sell_mode -> BOTH
  const saved = await saveProduct(productSchema.parse({
    sku: 'RULE1', product_name: 'Rule Bra', category_id: m.cat('everyday-bra').category_id, mrp: 100,
    units_per_box: 6, size_ids: [s32], color_ids: [black],
    stock: [{ color_id: black, size_id: s32, stock_qty: 12 }, { box_key: `size:${s32}`, stock_qty: 3 }], status: 'ACTIVE',
  }), adminCtx);
  assert.equal(saved.product.sell_mode, 'BOTH');
  assert.equal(saved.product.pcs_for_new_customers, false);
  const pid = saved.product.product_id;
  const pcs = saved.variants.find((v) => v.inventory_mode === 'COLOR_WISE').variant_id;
  const box = saved.variants.find((v) => v.inventory_mode === 'BOX_WISE').variant_id;
  assert.equal((await inventoryOf(box)).stock, 0, 'box stock is never entered (3 ignored); 12 black pcs = 2 boxes');

  let catalog = await getCatalog({ fresh: true });
  assert.equal(buildQuote({ items: [{ variant_id: pcs, qty: 2 }], catalog }).lines[0].issue.code, 'PCS_EXISTING_ONLY', 'new customer: no pieces');
  assert.equal(buildQuote({ items: [{ variant_id: box, qty: 1 }], catalog }).has_issues, false, 'new customer: boxes');
  assert.equal(buildQuote({ items: [{ variant_id: pcs, qty: 2 }, { variant_id: box, qty: 1 }], catalog, customer: EXISTING }).has_issues, false, 'existing: both');

  // admin opens loose pieces for new customers on THIS product (e.g. stock cannot make a full box)
  const cur = await getProductAdmin(pid);
  const opened = await saveProduct(productSchema.parse({ ...cur.product, stock: [], boxes: [], images: [], pcs_for_new_customers: true }), { ...adminCtx, productId: pid });
  assert.equal(opened.product.pcs_for_new_customers, true);
  catalog = await getCatalog({ fresh: true });
  assert.equal(buildQuote({ items: [{ variant_id: pcs, qty: 2 }], catalog }).has_issues, false, 'new customer may now buy pieces of this product');
  assert.equal(serializeProduct(catalog, catalog.productsById.get(pid)).pcs_for_new_customers, true);

  // no box at all: existing customers buy pieces, new customers cannot buy unless opened
  const noBox = await saveProduct(productSchema.parse({ ...cur.product, sell_mode: undefined, units_per_box: null, stock: [], boxes: [], images: [], pcs_for_new_customers: false }), { ...adminCtx, productId: pid });
  assert.equal(noBox.product.sell_mode, 'PCS');
  catalog = await getCatalog({ fresh: true });
  assert.equal(buildQuote({ items: [{ variant_id: pcs, qty: 1 }], catalog, customer: EXISTING }).has_issues, false);
  assert.equal(buildQuote({ items: [{ variant_id: pcs, qty: 1 }], catalog }).lines[0].issue.code, 'PCS_EXISTING_ONLY');
  assert.throws(() => productSchema.parse({ sku: 'X1', product_name: 'Nothing', category_id: m.cat('everyday-bra').category_id, mrp: 10, size_ids: [s32] }), /pieces per box/);
});

test('bulk box / pieces: pieces per box + open pieces for new customers, keeps the choice when not sent', async () => {
  const { adminCtx } = await freshStore({ pcsForAll: false });
  const a = await bothProduct(adminCtx, { sku: 'BULKN', product_name: 'Bulk New', sell_mode: 'PCS', units_per_box: null });
  const pid = a.saved.product.product_id;
  let res = await bulkSetSelling(bulkSellingSchema.parse({ product_ids: [pid], units_per_box: 6, pcs_for_new_customers: true }), adminCtx);
  assert.deepEqual(res.updated, ['BULKN']);
  let after = await getProductAdmin(pid);
  assert.equal(after.product.sell_mode, 'BOTH');
  assert.equal(after.product.pcs_for_new_customers, true);
  res = await bulkSetSelling(bulkSellingSchema.parse({ product_ids: [pid], units_per_box: 12 }), adminCtx);
  after = await getProductAdmin(pid);
  assert.equal(after.product.units_per_box, 12);
  assert.equal(after.product.pcs_for_new_customers, true, 'not sent = unchanged');
  res = await bulkSetSelling(bulkSellingSchema.parse({ product_ids: [pid], units_per_box: null, pcs_for_new_customers: false }), adminCtx);
  after = await getProductAdmin(pid);
  assert.equal(after.product.sell_mode, 'PCS', 'no box');
  assert.equal(after.variants.filter((v) => v.inventory_mode === 'BOX_WISE' && v.status === 'ACTIVE').length, 0);
});
