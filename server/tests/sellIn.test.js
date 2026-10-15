import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { freshStore, masters } from './helpers/fixtures.js';
import {
  saveProduct, getProductAdmin, bulkSetSelling, setPackSizes,
} from '../services/productService.js';
import { bulkEditWorkbook, bulkEditProducts } from '../services/productBulkEditService.js';
import { getCatalog, serializeProduct } from '../services/catalogService.js';
import { buildQuote, variantOptions } from '../services/quoteService.js';
import { productSchema, bulkSellingSchema, packSizesSchema } from '../utils/validation.js';
import { startCatalogImport } from '../services/catalogImportService.js';
import { sheetsService } from '../services/sheetsService.js';
import { MIGRATIONS } from '../migrations/index.js';
import { logger } from '../utils/logger.js';

// "Sell in" per article, ticked by the admin: Box + Pcs / Box only / Pcs only.
// Box only = nobody buys loose pieces (not even existing customers);
// Pcs only = no box. Stock is always entered in pieces per colour.

const EXISTING = { existing: true, minimum_order_value: 0 };

async function article(adminCtx, sku, extra = {}) {
  const m = await masters();
  const s32 = m.size('32').size_id;
  const s34 = m.size('34').size_id;
  const black = m.color('Black').color_id;
  const white = m.color('White').color_id;
  const saved = await saveProduct(productSchema.parse({
    sku, product_name: `Article ${sku}`, category_id: m.cat('lingerie-set').category_id, mrp: 100,
    sell_mode: 'BOTH', units_per_box: 6, size_ids: [s32, s34], color_ids: [black, white],
    stock: [s32, s34].flatMap((size_id) => [{ color_id: black, size_id, stock_qty: 30 }, { color_id: white, size_id, stock_qty: 30 }]),
    images: [{ drive_file_id: `IMG-${sku}`, image_type: 'MAIN' }],
    status: 'ACTIVE',
    ...extra,
  }), adminCtx);
  const id = saved.product.product_id;
  const pcs = saved.variants.find((v) => v.inventory_mode === 'COLOR_WISE' && v.color_id === black && v.size_id === s32);
  const box = (variants) => variants.find((v) => v.inventory_mode === 'BOX_WISE' && v.size_id === s32 && v.status === 'ACTIVE');
  return {
    id, saved, pcs, box, s32,
  };
}

const publicOf = async (id) => {
  const catalog = await getCatalog({ fresh: true });
  return { catalog, pub: serializeProduct(catalog, catalog.productsById.get(id), { detail: true }) };
};

test('Box only: boxes packed from the piece stock, loose pieces not sold - not even to existing customers', async () => {
  const { adminCtx } = await freshStore({ pcsForAll: false });
  const a = await article(adminCtx, 'BOXONLY', { sell_mode: 'BOX' });
  assert.equal(a.saved.product.sell_mode, 'BOX');
  assert.equal(a.pcs.status, 'ACTIVE', 'piece stock kept: the boxes are packed from it');

  const { catalog, pub } = await publicOf(a.id);
  assert.equal(pub.can_box, true);
  assert.equal(pub.can_pcs, false);
  assert.ok(pub.variants.every((v) => v.kind === 'BOX'), 'only boxes on sale');
  assert.equal(pub.colors.length, 2, 'box colours still listed (assorted)');
  const box = pub.variants.find((v) => v.size_id === a.s32);
  assert.equal(box.available_qty, 10, '6 pcs = 3 of each colour, 30 each -> 10 boxes');

  // an existing customer cannot buy loose pieces of it
  const pcsQuote = buildQuote({ items: [{ variant_id: a.pcs.variant_id, qty: 2 }], catalog, customer: EXISTING });
  assert.ok(pcsQuote.has_issues);
  const boxQuote = buildQuote({ items: [{ variant_id: box.variant_id, qty: 1 }], catalog, customer: EXISTING });
  assert.equal(boxQuote.lines[0].issue, null);
  // admin "Edit items" offers only the box too
  assert.ok(variantOptions(catalog, catalog.productsById.get(a.id), {}, EXISTING).every((o) => o.inventory_mode === 'BOX_WISE'));

  // tick Pcs again: same piece variants are sold again, stock untouched
  const cur = await getProductAdmin(a.id);
  const back = await saveProduct(productSchema.parse({ ...cur.product, sell_mode: 'BOTH', stock: [], boxes: [], images: [] }), { ...adminCtx, productId: a.id });
  assert.equal(back.variants.find((v) => v.variant_id === a.pcs.variant_id).inventory.stock_qty, 30);
  assert.equal((await publicOf(a.id)).pub.can_pcs, true);
});

test('Pcs only (e.g. Sanjana set): no box for anybody; Box + Pcs back keeps the stock', async () => {
  const { adminCtx } = await freshStore({ pcsForAll: false });
  const a = await article(adminCtx, 'SANJANA');
  const box6 = a.box(a.saved.variants);
  const res = await bulkSetSelling(bulkSellingSchema.parse({ product_ids: [a.id], sell_mode: 'PCS', pcs_for_new_customers: true }), adminCtx);
  assert.deepEqual(res.updated, ['SANJANA']);
  const after = await getProductAdmin(a.id);
  assert.equal(after.product.sell_mode, 'PCS');
  assert.equal(after.product.units_per_box, null);
  assert.equal(after.product.pcs_for_new_customers, true);
  const { catalog, pub } = await publicOf(a.id);
  assert.equal(pub.can_box, false);
  assert.equal(pub.can_pcs, true);
  assert.ok(buildQuote({ items: [{ variant_id: box6.variant_id, qty: 1 }], catalog, customer: EXISTING }).has_issues, 'box no longer sold');
  assert.equal(buildQuote({ items: [{ variant_id: a.pcs.variant_id, qty: 3 }], catalog }).lines[0].issue, null, 'new customers buy pcs (opened)');
});

test('bulk "Sell in": box only keeps each box size, needs a size when there is none; Pack of keeps box only', async () => {
  const { adminCtx } = await freshStore({ pcsForAll: false });
  const a = await article(adminCtx, 'BULK6');
  const b = await article(adminCtx, 'BULK12', { units_per_box: 12 });
  const c = await article(adminCtx, 'NOBOX', { sell_mode: 'PCS', units_per_box: null });

  // blank pieces per box = keep each article's own box
  const input = bulkSellingSchema.parse({ product_ids: [a.id, b.id, c.id], sell_mode: 'BOX' });
  const res = await bulkSetSelling(input, adminCtx);
  assert.deepEqual(res.updated.sort(), ['BULK12', 'BULK6']);
  assert.equal(res.skipped.length, 1);
  assert.match(res.skipped[0].reason, /NOBOX.*no box yet/);
  assert.equal((await getProductAdmin(a.id)).product.units_per_box, 6);
  assert.equal((await getProductAdmin(b.id)).product.units_per_box, 12);
  assert.equal((await getProductAdmin(b.id)).product.sell_mode, 'BOX');

  // "Pack of" changes only the box size: still box only
  await setPackSizes(packSizesSchema.parse({ items: [{ product_id: a.id, units_per_box: 4 }] }), adminCtx);
  let p = (await getProductAdmin(a.id)).product;
  assert.equal(p.units_per_box, 4);
  assert.equal(p.sell_mode, 'BOX');
  // removing the box of a box-only article there is refused (choose Pcs only instead)
  const removed = await setPackSizes(packSizesSchema.parse({ items: [{ product_id: a.id, units_per_box: null }] }), adminCtx);
  assert.match(removed.skipped[0].reason, /boxes only/);
  p = (await getProductAdmin(a.id)).product;
  assert.equal(p.sell_mode, 'BOX');

  // Box + Pcs with a new size for all of them
  const both = await bulkSetSelling(bulkSellingSchema.parse({ product_ids: [a.id, c.id], sell_mode: 'BOTH', units_per_box: 6 }), adminCtx);
  assert.deepEqual(both.updated.sort(), ['BULK6', 'NOBOX']);
  assert.equal((await getProductAdmin(c.id)).product.sell_mode, 'BOTH');
});

test('Excel bulk edit keeps a box-only article box only', async () => {
  const { adminCtx } = await freshStore({ pcsForAll: false });
  const a = await article(adminCtx, 'XLBOX', { sell_mode: 'BOX' });
  const { buffer } = await bulkEditWorkbook({ productIds: [a.id] });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet('Products');
  const cols = {};
  ws.getRow(1).eachCell((cell, n) => { cols[String(cell.value).split(' ')[0]] = n; });
  ws.getRow(2).getCell(cols.mrp).value = 120;
  ws.getRow(2).getCell(cols.pieces_per_box).value = 4;
  const res = await bulkEditProducts(Buffer.from(await wb.xlsx.writeBuffer()), { apply: true, ...adminCtx });
  assert.deepEqual(res.products.errors, []);
  const p = (await getProductAdmin(a.id)).product;
  assert.equal(p.mrp, 120);
  assert.equal(p.units_per_box, 4);
  assert.equal(p.sell_mode, 'BOX');
});

test('deploy: migration v16 makes Sanjana Set + Sanjana bra pcs only, nothing else', async () => {
  const { adminCtx } = await freshStore({ pcsForAll: false });
  await startCatalogImport({ ...adminCtx, stockPerVariant: 12, wait: true });
  const bySku = async () => new Map((await sheetsService.read('Products', { fresh: true })).map((p) => [p.sku, p]));
  let products = await bySku();
  // like the live site: both have a box today
  await bulkSetSelling(bulkSellingSchema.parse({ product_ids: [products.get('1007').product_id, products.get('1005').product_id], sell_mode: 'BOTH', units_per_box: 6 }), adminCtx);
  products = await bySku();
  const before = [...products.values()].filter((p) => p.sell_mode === 'BOTH').length;
  assert.equal(products.get('1007').sell_mode, 'BOTH');
  assert.equal(products.get('1005').sell_mode, 'BOTH');

  await MIGRATIONS.find((m) => m.version === 16).up({ sheets: sheetsService, logger });
  products = await bySku();
  for (const sku of ['1007', '1005']) {
    const p = products.get(sku);
    assert.equal(p.sell_mode, 'PCS', `${p.product_name} pcs only`);
    assert.equal(p.units_per_box, null);
    const { pub } = await publicOf(p.product_id);
    assert.equal(pub.can_box, false);
    assert.equal(pub.can_pcs, true);
  }
  assert.equal([...products.values()].filter((p) => p.sell_mode === 'BOTH').length, before - 2, 'other articles untouched');
  const stock = (await getProductAdmin(products.get('1007').product_id)).variants.filter((v) => v.inventory_mode === 'COLOR_WISE' && v.status === 'ACTIVE');
  assert.ok(stock.length && stock.every((v) => v.inventory.stock_qty === 12), 'piece stock untouched');
});
