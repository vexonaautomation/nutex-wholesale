import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStore, createColorProduct, CUSTOMER, inventoryOf } from './helpers/fixtures.js';
import {
  createDraftOrder, cancelOrderAdmin, cancelOrderCustomer, getCustomerOrder, getOrderAdmin, expireUnpaidOrders,
} from '../services/orderService.js';
import { updateSettings } from '../services/settingsService.js';
import { sheetsService } from '../services/sheetsService.js';
import { assertSafeRequests } from '../services/storage/sheetsGuard.js';
import { MIGRATIONS } from '../migrations/index.js';
import { sendOrderCancelledAlert } from '../services/orderAlertService.js';
import { draftOrderSchema } from '../utils/validation.js';
import { logger } from '../utils/logger.js';

// A cancelled order MOVES from the Orders sheet to Cancelled_Orders (whole
// row, one atomic batch). The website still finds it everywhere.

let n = 0;
const key = () => `cancelmove-${Date.now()}-${(n += 1)}`;
const code = (c) => (err) => { assert.equal(err.code, c); return true; };

async function setup() {
  const store = await freshStore();
  await updateSettings({ minimum_order_value: 0 }, store.adminCtx);
  const { variant } = await createColorProduct(store.adminCtx);
  const v = variant('Black', '32').variant_id;
  const place = (qty = 10) => createDraftOrder(draftOrderSchema.parse({ customer: CUSTOMER, items: [{ variant_id: v, qty }], idempotency_key: key() }));
  return { ...store, v, place };
}

const ids = (transport, sheet) => {
  const rows = transport.dump(sheet);
  const col = rows[0].indexOf('order_number');
  return rows.slice(1).map((r) => r[col]);
};

test('admin cancel: the row leaves Orders, lands in Cancelled_Orders with every value; still found', async () => {
  const { adminCtx, sheetsTransport, place, v } = await setup();
  const a = await place(10);
  const b = await place(5);
  const c = await place(3);
  const header = sheetsTransport.dump('Orders')[0];
  const before = sheetsTransport.dump('Orders')[2];

  await cancelOrderAdmin(b.order_number, { reason: 'Customer called to cancel' }, adminCtx);
  assert.deepEqual(ids(sheetsTransport, 'Orders'), [a.order_number, c.order_number], 'row removed, others untouched');
  assert.deepEqual(ids(sheetsTransport, 'Cancelled_Orders'), [b.order_number]);
  const moved = sheetsTransport.dump('Cancelled_Orders')[1];
  const cHeader = sheetsTransport.dump('Cancelled_Orders')[0];
  for (const col of ['order_id', 'customer_name_snapshot', 'final_payable', 'created_at', 'doer', 'customer_type']) {
    assert.deepEqual(moved[cHeader.indexOf(col)], before[header.indexOf(col)], `${col} copied as it was`);
  }
  assert.equal(moved[cHeader.indexOf('order_status')], 'CANCELLED');
  assert.equal(typeof moved[cHeader.indexOf('cancelled_at')], 'number', 'date-time cell');

  const order = await getCustomerOrder(b.order_number, b.access_token);
  assert.equal(order.order_status, 'CANCELLED');
  assert.equal(order.cancel_reason ?? 'Customer called to cancel', 'Customer called to cancel');
  assert.equal((await getOrderAdmin(b.order_number)).order.order_status, 'CANCELLED');
  assert.equal((await sheetsService.read('Orders', { fresh: true })).length, 3, 'Orders = live + cancelled for the website');
  assert.deepEqual(await inventoryOf(v), { stock: 100, reserved: 13, available: 87 }, 'stock of b released');

  // later updates of a cancelled order are written in Cancelled_Orders
  await sheetsService.commit([{ op: 'update', sheet: 'Orders', id: order.order_id ?? (await sheetsService.read('Orders')).find((o) => o.order_number === b.order_number).order_id, patch: { dispatch_note: 'note' } }]);
  assert.equal(sheetsTransport.dump('Cancelled_Orders')[1][cHeader.indexOf('dispatch_note')], 'note');

  // order numbers keep counting after cancelled ones
  const d = await place(1);
  assert.ok(![a, b, c].map((x) => x.order_number).includes(d.order_number));
});

test('customer cancels their own order before payment; not after it is locked', async () => {
  const { sheetsTransport, place, v, adminCtx } = await setup();
  const a = await place(10);
  const b = await place(5);
  const order = await cancelOrderCustomer(a.order_number, a.access_token, { reason: 'ordered by mistake' });
  assert.equal(order.order_status, 'CANCELLED');
  assert.equal(order.permissions.can_cancel, false);
  assert.deepEqual(ids(sheetsTransport, 'Orders'), [b.order_number]);
  assert.deepEqual(ids(sheetsTransport, 'Cancelled_Orders'), [a.order_number]);
  assert.deepEqual(await inventoryOf(v), { stock: 100, reserved: 5, available: 95 });

  await updateSettings({ admin_order_mobiles: '9876500001' }, adminCtx);
  const cancelledId = (await sheetsService.read('Orders', { fresh: true })).find((o) => o.order_number === a.order_number).order_id;
  assert.deepEqual(await sendOrderCancelledAlert(cancelledId), { sent: 1 }, 'admins get a WhatsApp');
  await assert.rejects(cancelOrderCustomer(b.order_number, 'wrong-token'), code('ORDER_ACCESS_REQUIRED'));
  // payment submitted -> locked
  await sheetsService.commit([{ op: 'update', sheet: 'Orders', id: (await sheetsService.read('Orders', { fresh: true })).find((o) => o.order_number === b.order_number).order_id, patch: { order_status: 'PAYMENT_SUBMITTED', locked: true } }]);
  await assert.rejects(cancelOrderCustomer(b.order_number, b.access_token), code('ORDER_LOCKED'));
  assert.deepEqual(ids(sheetsTransport, 'Orders'), [b.order_number], 'still a live order');
});

test('unpaid orders cancelled automatically move too', async () => {
  const { sheetsTransport, place } = await setup();
  const a = await place(10);
  const sheet = sheetsTransport.sheets.get('Orders');
  sheet.rows[1][sheet.rows[0].indexOf('updated_at')] = new Date(Date.now() - 100 * 3600 * 1000).toISOString();
  sheetsService.invalidate();
  assert.equal((await expireUnpaidOrders()).expired, 1);
  assert.deepEqual(ids(sheetsTransport, 'Orders'), []);
  assert.deepEqual(ids(sheetsTransport, 'Cancelled_Orders'), [a.order_number]);
});

test('migration v24 moves orders already cancelled in the Orders sheet', async () => {
  const { sheetsTransport, place } = await setup();
  const a = await place(10);
  const b = await place(5);
  // an order cancelled before v24: still in Orders
  const sheet = sheetsTransport.sheets.get('Orders');
  sheet.rows[1][sheet.rows[0].indexOf('order_status')] = 'CANCELLED';
  sheetsService.invalidate();
  await MIGRATIONS.find((m) => m.version === 24).up({ sheets: sheetsService, logger });
  assert.deepEqual(ids(sheetsTransport, 'Orders'), [b.order_number]);
  assert.deepEqual(ids(sheetsTransport, 'Cancelled_Orders'), [a.order_number]);
});

test('guard: a row may only be removed together with its copy, one data row at a time', () => {
  const del = (start) => ({ deleteDimension: { range: { sheetId: 1, dimension: 'ROWS', startIndex: start, endIndex: start + 1 } } });
  const append = { appendCells: { sheetId: 2, rows: [{ values: [] }], fields: 'userEnteredValue' } };
  assert.throws(() => assertSafeRequests([del(3)]), /copy is appended/);
  assert.throws(() => assertSafeRequests([append, del(0)]), /one data row/, 'never the header');
  assert.throws(() => assertSafeRequests([append, { deleteDimension: { range: { sheetId: 1, dimension: 'ROWS', startIndex: 2, endIndex: 9 } } }]), /one data row/);
  assert.throws(() => assertSafeRequests([append, { deleteDimension: { range: { sheetId: 1, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 } } }]), /one data row/);
  assert.doesNotThrow(() => assertSafeRequests([append, del(3)]));
});
