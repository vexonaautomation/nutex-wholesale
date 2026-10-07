import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemorySheetsTransport } from '../services/storage/memorySheetsTransport.js';
import { sheetsService } from '../services/sheetsService.js';
import { runMigrations } from '../services/migrationService.js';
import { SCHEMA } from '../config/schema.js';
import { freshStore, createColorProduct, dumpAll } from './helpers/fixtures.js';
import { configureStorage } from '../services/bootstrap.js';
import { config } from '../config/env.js';

test('migration on an empty spreadsheet creates every sheet with headers', async () => {
  const t = new MemorySheetsTransport();
  configureStorage(config, { sheetsTransport: t });
  const report = await runMigrations();
  assert.equal(report.createdSheets.length, Object.keys(SCHEMA).length);
  for (const [name, def] of Object.entries(SCHEMA)) assert.deepEqual(t.dump(name)[0], def.columns);
  assert.ok(report.addedSettings.includes('minimum_order_value'));
});

test('redeploy: re-running migrations on populated data changes NOTHING', async () => {
  const { sheetsTransport, adminCtx } = await freshStore();
  await createColorProduct(adminCtx);
  const before = dumpAll(sheetsTransport);
  // simulate "deploy V2": brand new service state, same spreadsheet
  configureStorage(config, { sheetsTransport });
  const report = await runMigrations();
  assert.deepEqual(report.createdSheets, []);
  assert.deepEqual(report.addedColumns, {});
  assert.deepEqual(report.addedSettings, []);
  assert.deepEqual(dumpAll(sheetsTransport), before);
});

test('additive migration: a missing column is appended at the end; existing data is untouched', async () => {
  const { sheetsTransport, adminCtx } = await freshStore();
  await createColorProduct(adminCtx);
  const products = sheetsTransport.sheets.get('Products');
  // simulate an older deployment whose Products sheet had no seo_description column
  const col = products.rows[0].indexOf('seo_description');
  for (const r of products.rows) r.splice(col, 1);
  const oldRows = products.rows.map((r) => [...r]);

  configureStorage(config, { sheetsTransport });
  const report = await runMigrations();
  assert.deepEqual(report.addedColumns, { Products: ['seo_description'] });
  const after = sheetsTransport.dump('Products');
  assert.equal(after[0][after[0].length - 1], 'seo_description');
  // every previously existing cell is identical
  oldRows.forEach((r, i) => r.forEach((v, j) => assert.equal(after[i][j], v)));
  const rows = await sheetsService.read('Products', { fresh: true });
  assert.equal(rows[0].product_name, 'ABC Bra');
});

test('sheet with data but no header row is reported and NOT modified', async () => {
  const t = new MemorySheetsTransport();
  t.sheets.set('Customers', { sheetId: 42, title: 'Customers', columnCount: 26, rows: [[''], ['CUS-1', 'Someone']] });
  configureStorage(config, { sheetsTransport: t });
  const report = await runMigrations();
  assert.equal(report.errors.length, 1);
  assert.deepEqual(t.dump('Customers'), [[''], ['CUS-1', 'Someone']]);
});

test('admin-added extra columns and manual column reordering are preserved', async () => {
  const { sheetsTransport, adminCtx } = await freshStore();
  const { saved } = await createColorProduct(adminCtx);
  const sheet = sheetsTransport.sheets.get('Products');
  sheet.rows[0].push('my_private_notes');
  sheet.rows[1].push('keep me');
  sheetsService.invalidate();
  await sheetsService.commit([{ op: 'update', sheet: 'Products', id: saved.product.product_id, patch: { mrp: 650 } }]);
  const after = sheetsTransport.dump('Products');
  assert.equal(after[1][after[0].indexOf('my_private_notes')], 'keep me');
  assert.equal(after[1][after[0].indexOf('mrp')], 650);
});

test('update touches only the patched cells of the matching row', async () => {
  const { sheetsTransport, adminCtx } = await freshStore();
  await createColorProduct(adminCtx, { sku: 'A1', product_name: 'Product A' });
  const { saved: b } = await createColorProduct(adminCtx, { sku: 'B1', product_name: 'Product B' });
  const before = sheetsTransport.dump('Products');
  await sheetsService.commit([{ op: 'update', sheet: 'Products', id: b.product.product_id, patch: { product_name: 'Product B v2' } }]);
  const after = sheetsTransport.dump('Products');
  assert.deepEqual(after[1], before[1], 'Product A row unchanged');
  const nameCol = before[0].indexOf('product_name');
  before[2][nameCol] = 'Product B v2';
  assert.deepEqual(after[2], before[2], 'only product_name of B changed');
});

test('destructive Google Sheets operations are blocked at the transport', async () => {
  const t = new MemorySheetsTransport();
  await assert.rejects(t.batchUpdate([{ deleteSheet: { sheetId: 1 } }]), /Blocked non-additive/);
  await assert.rejects(t.batchUpdate([{ deleteDimension: { range: {} } }]), /Blocked non-additive/);
  await assert.rejects(t.batchUpdate([{ appendDimension: { sheetId: 1, dimension: 'ROWS', length: 1 } }]), /Blocked/);
});

test('commit is atomic: a failing operation writes nothing', async () => {
  const { sheetsTransport } = await freshStore();
  const before = dumpAll(sheetsTransport);
  await assert.rejects(sheetsService.commit([
    { op: 'append', sheet: 'Colors', rows: [{ color_id: 'CLR-NEW', color_name: 'Teal' }] },
    { op: 'update', sheet: 'Colors', id: 'does-not-exist', patch: { color_name: 'x' } },
  ]));
  assert.deepEqual(dumpAll(sheetsTransport), before);
});

test('IDs are immutable and duplicate IDs are refused', async () => {
  const { sheetsTransport } = await freshStore();
  const colors = await sheetsService.read('Colors', { fresh: true });
  await assert.rejects(sheetsService.commit([{ op: 'update', sheet: 'Colors', id: colors[0].color_id, patch: { color_id: 'HACK' } }]), /immutable/);
  const sheet = sheetsTransport.sheets.get('Colors');
  sheet.rows.push([...sheet.rows[1]]); // a human copy-pasted a row
  await assert.rejects(sheetsService.commit([{ op: 'update', sheet: 'Colors', id: colors[0].color_id, patch: { color_name: 'x' } }]), /Duplicate ID/);
});

test('formula-looking user input is stored as plain text', async () => {
  const { sheetsTransport } = await freshStore();
  await sheetsService.commit([{ op: 'append', sheet: 'Customers', rows: [{ customer_id: 'CUS-X', customer_name: '=IMPORTXML("http://evil")', mobile: '0987654321' }] }]);
  const rows = sheetsTransport.dump('Customers');
  const last = rows[rows.length - 1];
  assert.equal(last[1], '=IMPORTXML("http://evil")');
  assert.equal(last[3], '0987654321', 'leading zero kept');
});
