import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStore, createColorProduct, CUSTOMER } from './helpers/fixtures.js';
import { createDraftOrder, getCustomerOrder } from '../services/orderService.js';
import { sheetsService } from '../services/sheetsService.js';
import { draftOrderSchema } from '../utils/validation.js';
import { toSheetSerial, fromSheetSerial, serialToDateString } from '../utils/sheetDates.js';
import { nextOrderNumber, normalizeOrderNumber } from '../utils/orderNumber.js';

// v22: dates are real date-time cells (India time) and order numbers are
// digits only; old ISO text and NX-… numbers are converted once.

test('sheet date-time serials: India time, millisecond exact round trip', () => {
  const iso = '2026-10-15T05:39:08.131Z'; // 11:09:08 IST
  const serial = toSheetSerial(iso);
  assert.equal(Math.floor(serial), 46310, '15 Oct 2026');
  assert.equal(Math.round((serial % 1) * 86400), 11 * 3600 + 9 * 60 + 8, '11:09:08 in India');
  assert.equal(fromSheetSerial(serial), iso);
  assert.equal(serialToDateString(46310), '2026-10-15');
  assert.equal(toSheetSerial('not a date'), null);
  assert.equal(toSheetSerial(''), null);
});

test('order numbers: digits only, continue after old NX numbers of the same day', () => {
  const now = new Date('2026-10-21T06:00:00Z');
  assert.equal(nextOrderNumber([], now), '202610210001');
  assert.equal(nextOrderNumber([{ order_number: 'NX-20261021-0003' }, { order_number: '202610200009' }], now), '202610210004');
  assert.equal(normalizeOrderNumber(' nx-20261021-0003 '), '202610210003');
  assert.equal(normalizeOrderNumber('202610210003'), '202610210003');
});

test('orders are written with date-time cells; old text dates and NX numbers are converted', async () => {
  const { adminCtx, sheetsTransport } = await freshStore();
  const { variant } = await createColorProduct(adminCtx);
  const sent = [];
  const batch = sheetsTransport.batchUpdate.bind(sheetsTransport);
  sheetsTransport.batchUpdate = async (requests) => { sent.push(...requests); return batch(requests); };

  const created = await createDraftOrder(
    draftOrderSchema.parse({ customer: CUSTOMER, items: [{ variant_id: variant('Black', '32').variant_id, qty: 50 }], idempotency_key: `dates-${Date.now()}` }),
    {},
  );
  assert.match(created.order_number, /^\d{12}$/);

  const sheet = sheetsTransport.sheets.get('Orders');
  const header = sheet.rows[0];
  const row = sheet.rows[1];
  assert.equal(typeof row[header.indexOf('created_at')], 'number', 'created_at is a date-time value, not text');
  assert.equal(row[header.indexOf('order_number')], created.order_number);
  const append = sent.find((r) => r.appendCells && r.appendCells.rows[0].values.length === header.length);
  const createdCell = append.appendCells.rows[0].values[header.indexOf('created_at')];
  assert.deepEqual(createdCell.userEnteredFormat.numberFormat, { type: 'DATE_TIME', pattern: 'dd/mm/yyyy hh:mm:ss' });
  assert.deepEqual(append.appendCells.rows[0].values[header.indexOf('order_number')].userEnteredFormat.numberFormat, { type: 'TEXT' });
  const read = (await sheetsService.read('Orders', { fresh: true }))[0];
  assert.match(read.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'the website still sees ISO timestamps');

  // make the row look like it was written before v22
  const legacy = `NX-${created.order_number.slice(0, 8)}-${created.order_number.slice(8)}`;
  row[header.indexOf('created_at')] = '2026-10-15T05:39:08.131Z';
  row[header.indexOf('order_number')] = legacy;
  const items = sheetsTransport.sheets.get('Order_Items');
  items.rows.slice(1).forEach((r) => { r[items.rows[0].indexOf('order_number')] = legacy; });
  sheetsService.invalidate();

  const old = await getCustomerOrder(legacy, created.access_token);
  assert.equal(old.order_number, legacy, 'not converted yet - still found');

  const changed = await sheetsService.upgradeLegacyCells();
  assert.ok(changed.Orders >= 2 && changed.Order_Items >= 1);
  assert.equal(row[header.indexOf('created_at')], toSheetSerial('2026-10-15T05:39:08.131Z'));
  assert.equal(row[header.indexOf('order_number')], created.order_number);
  assert.equal(items.rows[1][items.rows[0].indexOf('order_number')], created.order_number);

  const again = await getCustomerOrder(legacy, created.access_token);
  assert.equal(again.order_number, created.order_number, 'the old number typed by a customer still finds the order');
  assert.equal(again.created_at, '2026-10-15T05:39:08.131Z');
  assert.deepEqual(await sheetsService.upgradeLegacyCells(), {}, 'second run changes nothing');
});
