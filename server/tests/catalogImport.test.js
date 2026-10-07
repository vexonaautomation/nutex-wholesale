import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStore, masters } from './helpers/fixtures.js';
import {
  loadCatalogFile, planImport, startCatalogImport, catalogSummary,
} from '../services/catalogImportService.js';
import { saveProduct, getProductAdmin } from '../services/productService.js';
import { getCatalog, serializeProduct } from '../services/catalogService.js';
import { buildQuote } from '../services/quoteService.js';
import { getSettings } from '../services/settingsService.js';
import { sheetsService } from '../services/sheetsService.js';
import { productSchema } from '../utils/validation.js';

test('catalog.json is valid: one product per catalogue page, unique SKUs, known colours', async () => {
  const { catalog } = await loadCatalogFile();
  const s = catalogSummary(catalog);
  assert.equal(s.products, 150);
  const pages = catalog.products.map((p) => p.page);
  assert.equal(new Set(pages).size, pages.length, 'each catalogue page is its own product');
  const images = catalog.products.map((p) => p.image);
  assert.equal(new Set(images).size, images.length, 'each product has its own image');
  const colorNames = new Set(catalog.colors.map((c) => c.name));
  for (const p of catalog.products) {
    assert.ok(p.colors.length >= 1, `${p.name} has colours`);
    for (const c of p.colors) assert.ok(colorNames.has(c), `${p.name}: colour ${c} defined`);
  }
  assert.ok(catalog.products.some((p) => p.sku === '1010-AAKRITI-SET') && catalog.products.some((p) => p.sku === '1010-CLARA-PANTY'), 'duplicate style numbers made unique');
});

test('catalogue import: creates everything once, re-run is additive and never overwrites', async () => {
  const { adminCtx } = await freshStore();
  const { catalog } = await loadCatalogFile();
  const before = await sheetsService.readMany(['Categories', 'Sizes', 'Colors', 'Products', 'Product_Images'], { fresh: true });
  const plan = planImport(catalog, before);
  assert.equal(plan.products_to_create, 150);
  assert.ok(plan.categories_to_create.includes('T-Shirt Bra') === false, 'initial master data already has T-Shirt Bra');

  const job = await startCatalogImport({ ...adminCtx, stockPerVariant: 7, wait: true });
  assert.equal(job.status, 'done');
  assert.equal(job.created, 150);
  assert.deepEqual(job.errors, []);

  const data = await sheetsService.readMany(['Products', 'Product_Variants', 'Inventory', 'Product_Images', 'Categories'], { fresh: true });
  assert.equal(data.Products.length, 150);
  assert.equal(data.Product_Variants.length, catalogSummary(catalog).variants);
  assert.ok(data.Inventory.every((i) => i.stock_qty === 7 && i.available_qty === 7));
  assert.equal(data.Product_Images.length, 150, 'one image per product');
  assert.equal(new Set(data.Product_Images.map((i) => i.drive_file_id)).size, 150);
  assert.ok(data.Categories.filter((c) => c.image_file_id).length >= 10, 'category covers attached');
  const settings = await getSettings({ fresh: true });
  assert.ok(settings.company_logo_file_id && settings.size_chart_file_id, 'logo and size chart set');

  // colours from the catalogue page are the product's colours
  const m = await masters();
  const sahin = data.Products.find((p) => p.sku === '2042');
  const sahinColors = sahin.color_ids.split(',').map((id) => m.data.Colors.find((c) => c.color_id === id).color_name);
  assert.deepEqual(sahinColors, ['Olive Green', 'Orange', 'Lavender']);

  // size-wise MRP is priced per size
  const catalogView = await getCatalog({ fresh: true });
  const bloomer = data.Products.find((p) => p.sku === 'BLOOMER');
  const pub = serializeProduct(catalogView, bloomer, { detail: true });
  assert.equal(pub.mrp_min, 62);
  assert.equal(pub.mrp_max, 86);
  const big = pub.variants.find((v) => v.size_name === '95-100');
  const small = pub.variants.find((v) => v.size_name === '45-55');
  assert.equal(big.unit_mrp, 86);
  assert.equal(small.unit_mrp, 62);
  const q = buildQuote({ items: [{ variant_id: big.variant_id, qty: 2 }], catalog: catalogView });
  assert.equal(q.lines[0].unit_mrp, 86);
  assert.equal(q.gross_mrp_subtotal, 172);

  // admin edits a product, then the import runs again: nothing is overwritten
  const edited = await getProductAdmin(sahin.product_id);
  await saveProduct(productSchema.parse({
    ...edited.product, mrp: 999, stock: [], boxes: [], images: edited.images.map((i) => ({ image_id: i.image_id, drive_file_id: i.drive_file_id, image_type: i.image_type })),
    size_mrps: [],
  }), { ...adminCtx, productId: sahin.product_id });
  const again = await startCatalogImport({ ...adminCtx, stockPerVariant: 50, wait: true });
  assert.equal(again.created, 0);
  assert.equal(again.skipped, 150);
  const after = await sheetsService.readMany(['Products', 'Product_Variants', 'Inventory', 'Product_Images', 'Categories', 'Colors', 'Sizes'], { fresh: true });
  assert.equal(after.Products.length, 150);
  assert.equal(after.Products.find((p) => p.sku === '2042').mrp, 999, 'admin price kept');
  assert.equal(after.Product_Variants.length, data.Product_Variants.length);
  assert.ok(after.Inventory.every((i) => i.stock_qty === 7), 'existing stock untouched');
  assert.equal(after.Product_Images.length, 150);
  assert.equal(after.Categories.length, data.Categories.length);
});

test('size-wise MRP in the product wizard: saved per variant, blank = product MRP', async () => {
  const { adminCtx } = await freshStore();
  const m = await masters();
  const saved = await saveProduct(productSchema.parse({
    sku: 'TRUNK1', product_name: 'Test Trunk', category_id: m.cat('men-collection').category_id, mrp: 120,
    inventory_mode: 'COLOR_WISE', size_ids: [m.size('36').size_id, m.size('38').size_id], color_ids: [m.color('Black').color_id],
    size_mrps: [{ size_id: m.size('38').size_id, mrp: 140 }, { size_id: m.size('36').size_id, mrp: 120 }],
    stock: [], status: 'ACTIVE',
  }), adminCtx);
  const v36 = saved.variants.find((v) => v.size_id === m.size('36').size_id);
  const v38 = saved.variants.find((v) => v.size_id === m.size('38').size_id);
  assert.equal(v36.variant_mrp, null, 'same as product MRP is not stored');
  assert.equal(v38.variant_mrp, 140);
  assert.equal(v38.unit_mrp, 140);
  assert.deepEqual(saved.product.size_mrps, [{ size_id: m.size('38').size_id, mrp: 140 }]);
  // the admin "get" shape round-trips through the save schema
  assert.deepEqual(productSchema.parse({ ...saved.product, stock: [], boxes: [], images: [] }).size_mrps, [{ size_id: m.size('38').size_id, mrp: 140 }]);
});
