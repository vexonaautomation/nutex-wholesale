import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { freshStore, masters, inventoryOf } from './helpers/fixtures.js';
import { saveProduct, getProductAdmin } from '../services/productService.js';
import { bulkEditWorkbook, bulkEditProducts, readBulkEditFile } from '../services/productBulkEditService.js';
import { sheetsService } from '../services/sheetsService.js';
import { getCatalog } from '../services/catalogService.js';
import { productSchema } from '../utils/validation.js';

// Bulk product edit with Excel: download, edit sizes / colours / MRP / SKU /
// stock in the workbook, upload -> preview -> apply. Nothing is deleted.

async function setup() {
  const { adminCtx } = await freshStore();
  const m = await masters();
  const s = (n) => m.size(n).size_id;
  const c = (n) => m.color(n).color_id;
  const make = (sku, name) => saveProduct(productSchema.parse({
    sku, product_name: name, category_id: m.cat('everyday-panty').category_id, mrp: 100,
    units_per_box: 6, size_ids: [s('32'), s('34')], color_ids: [c('Black'), c('White')],
    stock: [s('32'), s('34')].flatMap((size_id) => [{ color_id: c('Black'), size_id, stock_qty: 30 }, { color_id: c('White'), size_id, stock_qty: 30 }]),
    images: [{ drive_file_id: `IMG-${sku}`, image_type: 'MAIN', alt_text: name }],
    status: 'ACTIVE',
  }), adminCtx);
  const a = await make('PANTYA', 'Panty A');
  const b = await make('PANTYB', 'Panty B');
  return {
    adminCtx, a: a.product.product_id, b: b.product.product_id, s, c,
  };
}

// edit the workbook like a person in Excel would
async function edit(buffer, fn) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = (name) => {
    const ws = wb.getWorksheet(name);
    const cols = {};
    ws.getRow(1).eachCell((cell, n) => { cols[String(cell.value).split(' ')[0]] = n; });
    return {
      ws,
      set(where, values) {
        let hit = null;
        ws.eachRow((row, i) => {
          if (i === 1 || hit) return;
          if (Object.entries(where).every(([k, v]) => String(row.getCell(cols[k]).value) === String(v))) hit = row;
        });
        assert.ok(hit, `row ${JSON.stringify(where)}`);
        for (const [k, v] of Object.entries(values)) hit.getCell(cols[k]).value = v;
      },
      add(values) {
        const row = ws.addRow([]);
        for (const [k, v] of Object.entries(values)) row.getCell(cols[k]).value = v;
      },
    };
  };
  await fn(sheet);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('downloaded workbook comes back unchanged: nothing to do', async () => {
  await setup();
  const { buffer, products, stock_rows: stockRows } = await bulkEditWorkbook();
  assert.equal(products, 2);
  assert.equal(stockRows, 8, '2 products x 2 colours x 2 sizes, pieces only');
  const read = await readBulkEditFile(buffer);
  const a = read.products.find((r) => r.sku === 'PANTYA');
  assert.equal(a.sizes, '32, 34');
  assert.equal(a.colours, 'Black, White');
  assert.equal(a.pieces_per_box, '6');
  assert.equal(a.status, 'Active');
  const res = await bulkEditProducts(buffer);
  assert.equal(res.products.to_change, 0);
  assert.equal(res.products.unchanged, 2);
  assert.deepEqual(res.products.errors, []);
  assert.equal(res.stock.to_change, 0);
});

test('edit sizes, colours, MRP, SKU and stock in Excel; preview first, apply keeps images and old stock', async () => {
  const { adminCtx, a, b } = await setup();
  const { buffer } = await bulkEditWorkbook();
  const edited = await edit(buffer, (sheet) => {
    const ps = sheet('Products');
    ps.set({ product_id: a }, {
      sku: 'PANTYA-NEW', mrp: 120, sizes: '32, 36', colours: 'Black, White, Red', size_mrp: '36=130', 'own_discount_%': 50, featured: 'Yes',
    });
    const st = sheet('Stock');
    st.set({ product_id: a, colour: 'Black', size: '32' }, { new_stock: 45 });
    st.add({ product_id: a, colour: 'Red', size: '36', new_stock: 12 }); // a size + colour this file adds
  });

  const preview = await bulkEditProducts(edited);
  assert.equal(preview.products.to_change, 1);
  const change = preview.products.changes[0];
  assert.equal(change.sku, 'PANTYA-NEW');
  assert.deepEqual(change.sizes_added, ['36']);
  assert.deepEqual(change.sizes_removed, ['34']);
  assert.deepEqual(change.colours_added, ['Red']);
  assert.ok(change.changes.some((x) => x.field === 'MRP' && x.from === '100' && x.to === '120'));
  assert.ok(change.changes.some((x) => x.field === 'Own discount %' && x.to === '50'));
  assert.ok(change.changes.some((x) => x.field === 'Size-wise MRP' && x.to === '36=130'));
  assert.equal(preview.stock.to_change, 1, 'existing variant');
  assert.equal(preview.stock.pending.length, 1, 'Red 36 is set after it is created');
  assert.equal((await getProductAdmin(a)).product.sku, 'PANTYA', 'preview writes nothing');

  const res = await bulkEditProducts(edited, { apply: true, ...adminCtx });
  assert.equal(res.products.applied, 1);
  assert.equal(res.stock.applied, 2);
  const after = await getProductAdmin(a);
  assert.equal(after.product.sku, 'PANTYA-NEW');
  assert.equal(Number(after.product.mrp), 120);
  assert.equal(after.product.discount_mode, 'CUSTOM');
  assert.equal(after.product.featured, true);
  const names = new Map((await getCatalog({ fresh: true })).sizes.map((x) => [x.size_id, x.size_name]));
  assert.deepEqual(after.product.size_ids.map((x) => names.get(x)), ['32', '36']);
  const v = (colour, size, mode = 'COLOR_WISE') => after.variants.find((x) => x.inventory_mode === mode && (mode === 'BOX_WISE' || x.color_id === colour) && names.get(x.size_id) === size && x.status === 'ACTIVE');
  const m = await masters();
  assert.equal(v(m.color('Black').color_id, '32').inventory.stock_qty, 45);
  assert.equal(v(m.color('Red').color_id, '36').inventory.stock_qty, 12, 'stock for the new size from the same file');
  assert.equal(v(m.color('Red').color_id, '36').unit_mrp, 130, 'size-wise MRP');
  assert.ok(v(null, '36', 'BOX_WISE'), 'one box per size');
  const old34 = after.variants.find((x) => x.inventory_mode === 'COLOR_WISE' && x.color_id === m.color('Black').color_id && names.get(x.size_id) === '34');
  assert.equal(old34.status, 'INACTIVE', 'removed size switched off');
  assert.equal((await inventoryOf(old34.variant_id)).stock, 30, 'its stock is kept');
  const images = (await sheetsService.read('Product_Images', { fresh: true })).filter((i) => i.product_id === a);
  assert.equal(images.length, 1);
  assert.equal(images[0].status, 'ACTIVE', 'images untouched');
  assert.equal((await getProductAdmin(b)).product.sku, 'PANTYB', 'other products untouched');
});

test('mistakes are reported per row and nothing is written for them', async () => {
  const { adminCtx, a, b } = await setup();
  const { buffer } = await bulkEditWorkbook();
  const edited = await edit(buffer, (sheet) => {
    const ps = sheet('Products');
    ps.set({ product_id: a }, { sizes: '32, 99', category: 'No Such Category' });
    ps.set({ product_id: b }, { sku: 'PANTYA' }); // already used by A
  });
  const res = await bulkEditProducts(edited, { apply: true, ...adminCtx });
  assert.equal(res.products.applied, 0);
  const msgs = res.products.errors.map((e) => e.message).join(' | ');
  assert.match(msgs, /Size "99" is not in the size list/);
  assert.match(msgs, /Unknown category "No Such Category"/);
  assert.match(msgs, /SKU PANTYA is already used/);
  assert.equal((await getProductAdmin(b)).product.sku, 'PANTYB');
  await assert.rejects(bulkEditProducts(Buffer.from('not an excel file')), /Could not read the file/);
});
