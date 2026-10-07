import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { freshStore } from './helpers/fixtures.js';
import { addExistingCustomers, parseBulkText } from '../services/existingCustomerService.js';
import { sheetsService } from '../services/sheetsService.js';

const TEMPLATE = fileURLToPath(new URL('../../client/public/templates/existing-customers-template.csv', import.meta.url));

test('template file: header columns, example rows are never imported', () => {
  const text = fs.readFileSync(TEMPLATE, 'utf8');
  assert.match(text.replace(/^﻿/, ''), /^mobile,customer_name,business_name,city,alternate_mobiles,gstin,minimum_order_value,notes\r?\n/);
  assert.deepEqual(parseBulkText(text), [], 'untouched template adds nobody');
});

test('filled template (CSV, quotes) maps every column by name', () => {
  const text = [
    'mobile,customer_name,business_name,city,alternate_mobiles,gstin,minimum_order_value,notes',
    '+91 98765 43210,Riya Sharma,"Riya Fashion, Main Road","Pune, MH",9123456789 / 9988776655,27ABCDE1234F1Z5,2000,since 2019',
    '9000011111,,,,,,,',
    ',,,,,,,',
  ].join('\r\n');
  const rows = parseBulkText(text);
  assert.equal(rows.length, 2, 'blank row ignored');
  assert.deepEqual(rows[0], {
    mobile: '+91 98765 43210', customer_name: 'Riya Sharma', business_name: 'Riya Fashion, Main Road', city: 'Pune, MH',
    alternate_mobiles: '9123456789 / 9988776655', gstin: '27ABCDE1234F1Z5', minimum_order_value: '2000', notes: 'since 2019',
  });
});

test('Excel copy-paste (tab separated, any column order, extra columns) and ; CSV', () => {
  const excel = 'Name\tMobile Number\tCity\tGST No\tSales person\n'
    + 'Amit Kumar\t9811122233\tSurat\t24ABCDE1234F1Z5\tRahul\n';
  assert.deepEqual(parseBulkText(excel), [{
    customer_name: 'Amit Kumar', mobile: '9811122233', city: 'Surat', gstin: '24ABCDE1234F1Z5',
  }]);
  const semi = 'Mobile;Business;Minimum order\n9822233344;Shree Traders;0\n';
  assert.deepEqual(parseBulkText(semi), [{ mobile: '9822233344', business_name: 'Shree Traders', minimum_order_value: '0' }]);
});

test('old one-line format without header still works', () => {
  const rows = parseBulkText('9876543210, Riya Sharma, Riya Fashion, Pune, 9123456789\n9000011111\n# comment line\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].alternate_mobiles, '9123456789');
  assert.equal(rows[1].mobile, '9000011111');
});

test('importing the filled template adds customers with GSTIN, minimum order and alternates', async () => {
  const { adminCtx } = await freshStore();
  const text = fs.readFileSync(TEMPLATE, 'utf8')
    + '9876500001,Sunita Devi,Sunita Garments,Delhi,9876500002,07ABCDE1234F1Z5,1500,from Excel\r\n'
    + '9876500003,Ravi,Ravi Stores,Jaipur,,,,\r\n'
    + '12345,Bad Number,,,,,,\r\n';
  const res = await addExistingCustomers(parseBulkText(text), adminCtx);
  assert.equal(res.added, 2);
  assert.equal(res.skipped.length, 1, 'invalid mobile reported, not added');
  const rows = await sheetsService.read('Existing_Customers', { fresh: true });
  const sunita = rows.find((r) => r.mobile === '9876500001');
  assert.equal(sunita.gstin, '07ABCDE1234F1Z5');
  assert.equal(sunita.minimum_order_value, 1500);
  assert.equal(sunita.alternate_mobiles, '9876500002');
  assert.equal(rows.find((r) => r.mobile === '9876500003').minimum_order_value, null, 'blank = default minimum');
  assert.ok(!rows.some((r) => r.mobile === '9876543210'), 'example row not imported');
});
