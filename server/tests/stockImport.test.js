import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freshStore, masters, CUSTOMER, PNG_BYTES, inventoryOf,
} from './helpers/fixtures.js';
import { saveProduct } from '../services/productService.js';
import { createDraftOrder, getCustomerOrder } from '../services/orderService.js';
import { submitPayment } from '../services/paymentService.js';
import { updateSettings } from '../services/settingsService.js';
import { sheetsService } from '../services/sheetsService.js';
import { stockSheetCsv, importStockSheet } from '../services/stockImportService.js';
import { parseCsvLine } from '../utils/csv.js';
import { productSchema, draftOrderSchema, paymentSubmitSchema } from '../utils/validation.js';

// Bulk stock update with Excel: download the sheet, fill new_stock / add_stock, upload.

let key = 0;
const idem = () => `stock-${Date.now()}-${key += 1}`;

async function setup() {
  const { adminCtx } = await freshStore();
  await updateSettings({ minimum_order_value: 0 }, adminCtx);
  const m = await masters();
  const s32 = m.size('32').size_id;
  const s34 = m.size('34').size_id;
  const [pink, red] = ['Pink', 'Red'].map((c) => m.color(c).color_id);
  const saved = await saveProduct(productSchema.parse({
    sku: 'KOMAL', product_name: 'Komal Bra', category_id: m.cat('everyday-bra').category_id, mrp: 165,
    units_per_box: 6, size_ids: [s32, s34], color_ids: [pink, red],
    stock: [
      { color_id: pink, size_id: s32, stock_qty: 10 }, { color_id: pink, size_id: s34, stock_qty: 10 },
      { color_id: red, size_id: s32, stock_qty: 10 }, { color_id: red, size_id: s34, stock_qty: 10 },
    ],
    status: 'ACTIVE',
  }), adminCtx);
  const v = (colour, sizeId) => saved.variants.find((x) => x.inventory_mode === 'COLOR_WISE' && x.color_id === colour && x.size_id === sizeId).variant_id;
  return { adminCtx, ids: { pink32: v(pink, s32), pink34: v(pink, s34), red32: v(red, s32), red34: v(red, s34) } };
}

// edit the downloaded sheet like Excel would: find rows, fill cells
function editSheet(csv, edits, { delimiter = ',' } = {}) {
  const lines = csv.replace(/^﻿/, '').trim().split(/\r\n/);
  const head = parseCsvLine(lines[0]);
  const col = (name) => head.indexOf(name);
  const rows = lines.slice(1).map((l) => parseCsvLine(l));
  for (const e of edits) {
    const row = rows.find((r) => r[col('colour')] === e.colour && r[col('size')] === e.size && r[col('type')] === (e.type || 'PCS'));
    assert.ok(row, `row ${e.colour} ${e.size}`);
    for (const [k, val] of Object.entries(e.set)) row[col(k)] = String(val);
  }
  return [head, ...rows].map((r) => r.map((c) => (c.includes(delimiter) ? `"${c}"` : c)).join(delimiter)).join('\r\n');
}

test('stock sheet lists every item with its current stock; boxes say 0 = from loose stock', async () => {
  await setup();
  const { csv, filename, rows } = await stockSheetCsv();
  assert.match(filename, /^nutex-stock-\d{4}-\d{2}-\d{2}\.csv$/);
  assert.equal(rows, 6, '4 colour/size rows + 2 box rows');
  const lines = csv.replace(/^﻿/, '').trim().split(/\r\n/);
  assert.equal(lines[0], 'inventory_id,category,product_sku,product_name,type,colour,size,pcs_per_box,current_stock,reserved,new_stock,add_stock,note');
  assert.ok(lines.some((l) => l.includes(',KOMAL,Komal Bra,PCS,Pink,32,,10,0,,,')));
  assert.ok(lines.some((l) => l.includes(',BOX,Mix,32,6,0,0,,,Boxes. Leave 0')));
});

test('preview shows changes and problems and writes nothing; apply writes with audit', async () => {
  const { ids } = await setup();
  const { csv } = await stockSheetCsv();
  const edited = editSheet(csv, [
    { colour: 'Pink', size: '32', set: { new_stock: 25 } },
    { colour: 'Pink', size: '34', set: { add_stock: 5 } },
    { colour: 'Red', size: '32', set: { new_stock: '1.5' } },
    { colour: 'Red', size: '34', set: { new_stock: 3, add_stock: 2 } },
    { type: 'BOX', colour: 'Mix', size: '32', set: { new_stock: 4 } },
  ]);
  const preview = await importStockSheet(edited);
  assert.equal(preview.applied, 0);
  assert.equal(preview.to_change, 3);
  assert.deepEqual(preview.changes.map((c) => [c.colour, c.size, c.from, c.to, c.mode]), [
    ['Pink', '32', 10, 25, 'set'], ['Pink', '34', 10, 15, 'add'], ['Mix', '32', 0, 4, 'set'],
  ]);
  assert.deepEqual(preview.errors.map((e) => e.message), ['Enter whole numbers only (0, 1, 2 ...).', 'Fill either new_stock or add_stock, not both.']);
  assert.equal(preview.blank, 1);
  assert.equal((await inventoryOf(ids.pink32)).stock, 10, 'preview never writes');

  const before = (await sheetsService.read('Audit_Log', { fresh: true })).length;
  const { adminCtx } = { adminCtx: { admin: { admin_id: 'ADM-TEST', email: 't@x' }, ip: '' } };
  const done = await importStockSheet(edited, { apply: true, ...adminCtx });
  assert.equal(done.applied, 3);
  assert.deepEqual(await inventoryOf(ids.pink32), { stock: 25, reserved: 0, available: 25 });
  assert.equal((await inventoryOf(ids.pink34)).stock, 15);
  assert.equal((await inventoryOf(ids.red32)).stock, 10, 'rows with errors are left alone');
  const audit = (await sheetsService.read('Audit_Log', { fresh: true })).slice(before);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, 'INVENTORY_UPDATED');
  assert.match(audit[0].notes, /Bulk stock upload/);
});

test('a count never overwrites a sale made after download, and never goes below reserved', async () => {
  const { ids } = await setup();
  const { csv } = await stockSheetCsv();
  // after the download: one order pays for 4 Pink 32 (stock 10 -> 6), another reserves 3 Red 32
  const paid = await createDraftOrder(draftOrderSchema.parse({ customer: CUSTOMER, items: [{ variant_id: ids.pink32, qty: 4 }], idempotency_key: idem() }));
  const amount = (await getCustomerOrder(paid.order_number, paid.access_token)).amount_to_pay;
  await submitPayment(paid.order_number, paid.access_token, paymentSubmitSchema.parse({ amount: String(amount), idempotency_key: idem() }), { buffer: PNG_BYTES });
  await createDraftOrder(draftOrderSchema.parse({ customer: { ...CUSTOMER, mobile: '9876500111' }, items: [{ variant_id: ids.red32, qty: 3 }], idempotency_key: idem() }));
  assert.equal((await inventoryOf(ids.pink32)).stock, 6);

  const edited = editSheet(csv, [
    { colour: 'Pink', size: '32', set: { new_stock: 30 } },
    { colour: 'Pink', size: '34', set: { add_stock: 2 } },
    { colour: 'Red', size: '32', set: { new_stock: 2 } },
  ]);
  const res = await importStockSheet(edited, { apply: true, admin: { admin_id: 'ADM-TEST' } });
  assert.equal(res.applied, 1, 'only the add_stock row');
  assert.match(res.errors[0].message, /Stock changed after you downloaded the sheet \(10 → 6/);
  assert.match(res.errors[1].message, /Cannot be lower than 3 reserved/);
  assert.equal((await inventoryOf(ids.pink32)).stock, 6, 'the sale is not overwritten');
  assert.equal((await inventoryOf(ids.pink34)).stock, 12);
});

test('works with Excel files: ; delimiter, BOM, no inventory_id (SKU + colour + size), extra columns', async () => {
  const { ids } = await setup();
  const text = '﻿product_sku;Colour;Size;Type;My notes;New Stock\r\nKOMAL;pink;32;PCS;counted;40\r\nkomal;Red;34;;x;7\r\nNOPE;Red;34;PCS;;1\r\n';
  const res = await importStockSheet(text, { apply: true, admin: { admin_id: 'ADM-TEST' } });
  assert.equal(res.applied, 2);
  assert.equal((await inventoryOf(ids.pink32)).stock, 40);
  assert.equal((await inventoryOf(ids.red34)).stock, 7);
  assert.equal(res.errors[0].message, 'Item not found. Use a freshly downloaded stock sheet.');
  await assert.rejects(importStockSheet('a,b\r\n1,2'), /new_stock/);
});
