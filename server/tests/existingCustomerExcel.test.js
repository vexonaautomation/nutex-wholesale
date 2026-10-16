import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { freshStore } from './helpers/fixtures.js';
import { addExistingCustomers } from '../services/existingCustomerService.js';
import { existingCustomersWorkbook, importExistingCustomersFile, cellText } from '../services/existingCustomerExcelService.js';
import { sheetsService } from '../services/sheetsService.js';

// Existing customers with Excel: template -> fill -> upload -> preview -> apply.

async function filled(rows, { header } = {}) {
  const { buffer } = await existingCustomersWorkbook();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet('Customers');
  if (header) ws.getRow(1).values = header;
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('template: Customers sheet with the columns, numbers kept as text, state list; can include the current list', async () => {
  const { adminCtx } = await freshStore();
  await addExistingCustomers([{ mobile: '9876543210', customer_name: 'Riya', business_name: 'Riya Fashion', city: 'Pune', pincode: '411001' }], adminCtx);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await existingCustomersWorkbook()).buffer);
  const ws = wb.getWorksheet('Customers');
  assert.deepEqual(ws.getRow(1).values.slice(1, 4), ['mobile (required)', 'customer_name', 'business_name']);
  assert.equal(ws.getColumn(1).numFmt, '@', 'mobile typed as text');
  assert.equal(ws.rowCount, 1, 'blank template');
  assert.ok(wb.getWorksheet('How to fill'));
  assert.equal(wb.getWorksheet('Lists').getCell('A2').value, 'Andhra Pradesh');

  const full = new ExcelJS.Workbook();
  await full.xlsx.load((await existingCustomersWorkbook({ withCustomers: true })).buffer);
  assert.equal(cellText(full.getWorksheet('Customers').getCell('A2').value), '9876543210');
  assert.equal(full.getWorksheet('Customers').getCell('C2').value, 'Riya Fashion');
});

test('upload: Excel number formats are cleaned, every bad row is shown with its row number, preview writes nothing', async () => {
  const { adminCtx } = await freshStore();
  await addExistingCustomers([{ mobile: '9876543210', customer_name: 'Riya', business_name: 'Riya Fashion', city: 'Pune' }], adminCtx);
  const file = await filled([
    // [mobile, name, business, alternates, address, city, state, pincode, gstin, min, notes]
    [9876543210, '', '', '', '12 MG Road, Shop 4', 'Pune', 'Maharashtra', 411001, '', '', ''], // row 2: existing -> address added
    ['+91 91234 56789', 'Sunita Devi', 'Sunita Garments', '9988776655, 9988776656', 'Main Bazaar, Shop 12', 'Jaipur', 'Rajasthan', '302001', '08abcde1234f1z5', 5000, ''], // row 3: new
    [], // empty row skipped
    ['12345', 'Bad Number', '', '', '', '', '', '', '', '', ''], // row 5
    [9123456789, 'Twice', '', '', '', '', '', '', '', '', ''], // row 6: same number as row 3
    [9811112222, 'Pin wrong', '', '', '', '', '', '3020', '', '', ''], // row 7
    [9811113333, 'Raju', 'Raju Stores', '', '', 'Delhi', 'Delhi', 110031, 'NOTAGST', '', ''], // row 8
    [9811114444, 'Meena', 'Meena Hosiery', '', '', 'Agra', 'Uttar Pradesh', 282001, '', '', ''], // row 9: new
  ]);
  const preview = await importExistingCustomersFile(file, { apply: false, ...adminCtx });
  assert.equal(preview.applied, false);
  assert.equal(preview.rows, 7, 'empty row ignored');
  assert.deepEqual(preview.add.map((r) => [r.row, r.mobile]), [[3, '9123456789'], [9, '9811114444']]);
  assert.deepEqual(preview.update.map((r) => [r.row, r.mobile, r.fields.sort().join()]), [[2, '9876543210', 'address,pincode,state']]);
  assert.deepEqual(preview.errors.map((e) => e.row), [5, 6, 7, 8]);
  assert.match(preview.errors[0].reason, /Invalid mobile number: 12345/);
  assert.match(preview.errors[1].reason, /twice in the file/);
  assert.match(preview.errors[2].reason, /pincode/i);
  assert.match(preview.errors[3].reason, /GSTIN/);
  assert.equal((await sheetsService.read('Existing_Customers', { fresh: true })).length, 1, 'preview writes nothing');

  const done = await importExistingCustomersFile(file, { apply: true, ...adminCtx });
  assert.equal(done.applied, true);
  const rows = await sheetsService.read('Existing_Customers', { fresh: true });
  assert.equal(rows.length, 3);
  const sunita = rows.find((r) => r.mobile === '9123456789');
  assert.equal(sunita.gstin, '08ABCDE1234F1Z5');
  assert.equal(sunita.alternate_mobiles, '9988776655, 9988776656');
  assert.equal(String(sunita.pincode), '302001');
  assert.equal(sunita.minimum_order_value, 5000);
  assert.equal(rows.find((r) => r.mobile === '9876543210').address, '12 MG Road, Shop 4');

  // upload again: nothing new
  const again = await importExistingCustomersFile(file, { apply: false, ...adminCtx });
  assert.equal(again.add.length, 0);
  assert.equal(again.unchanged.length, 3);
});

test('upload: a file in another layout (own headers, any order) or a wrong file', async () => {
  const { adminCtx } = await freshStore();
  const own = await filled([['Shop One', 9800011111, 'Indore']], { header: ['Shop Name', 'Mobile Number', 'City'] });
  const res = await importExistingCustomersFile(own, { apply: true, ...adminCtx });
  assert.equal(res.add.length, 1);
  assert.equal((await sheetsService.read('Existing_Customers', { fresh: true }))[0].business_name, 'Shop One');
  await assert.rejects(importExistingCustomersFile(Buffer.from('not excel'), { apply: false, ...adminCtx }), /not an Excel/);
  const noMobile = await filled([['x']], { header: ['Name'] });
  await assert.rejects(importExistingCustomersFile(noMobile, { apply: false, ...adminCtx }), /No "mobile" column/);
});
