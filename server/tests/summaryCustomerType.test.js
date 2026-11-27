import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStore, createColorProduct, CUSTOMER } from './helpers/fixtures.js';
import { createDraftOrder } from '../services/orderService.js';
import { updateSettings } from '../services/settingsService.js';
import { sheetsService } from '../services/sheetsService.js';
import { MIGRATIONS } from '../migrations/index.js';
import { draftOrderSchema } from '../utils/validation.js';

// Order_Items_Summary, last column: Existing Customer when the customer's
// mobile is in the Existing_Customers sheet, else Calling Customer.

const logger = { info() {}, warn() {}, error() {} };
const key = () => `sct-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
const typeOf = async (orderId) => [...new Set((await sheetsService.read('Order_Items_Summary', { fresh: true }))
  .filter((r) => r.order_id === orderId).map((r) => `${r.customer_type} / ${r.doer}`))];

async function setup() {
  const store = await freshStore();
  await updateSettings({ minimum_order_value: 0 }, store.adminCtx);
  const { variant } = await createColorProduct(store.adminCtx);
  const place = async (mobile) => {
    const o = await createDraftOrder(draftOrderSchema.parse({
      customer: { ...CUSTOMER, mobile }, items: [{ variant_id: variant('Black', '32').variant_id, qty: 12 }], idempotency_key: key(),
    }));
    return (await sheetsService.read('Orders', { fresh: true })).find((r) => r.order_number === o.order_number);
  };
  const addExisting = (mobile, addedAt = '') => sheetsService.commit([{
    op: 'append', sheet: 'Existing_Customers', rows: [{ mobile, customer_name: 'Old Party', status: 'ACTIVE', added_at: addedAt }],
  }]);
  return { ...store, place, addExisting };
}

test('new orders: Existing Customer if the mobile is in the Existing sheet, else Calling Customer', async () => {
  const { place, addExisting } = await setup();
  await addExisting('9822200000');
  const existing = await place('9822200000');
  const calling = await place('9833300000');
  assert.deepEqual(await typeOf(existing.order_id), ['Existing Customer / Mayank']);
  assert.deepEqual(await typeOf(calling.order_id), ['Calling Customer / Mayank']);
  const header = (await sheetsService.read('Order_Items_Summary', { fresh: true }))[0];
  assert.deepEqual(Object.keys(header).slice(-2), ['customer_type', 'doer'], 'the last columns');
});

test('migration v36 fills the rows already in the sheet from the Existing sheet', async () => {
  const { place, addExisting, sheetsTransport } = await setup();
  const a = await place('9844400000');
  const b = await place('9855500000');
  // rows from before v36: blank; customer a is in the Existing sheet now
  const sheet = sheetsTransport.sheets.get('Order_Items_Summary');
  for (const c of ['customer_type', 'doer']) {
    const col = sheet.rows[0].indexOf(c);
    for (const row of sheet.rows.slice(1)) row[col] = '';
  }
  sheetsService.invalidate();
  await addExisting('9844400000');

  await MIGRATIONS.find((m) => m.version === 36).up({ sheets: sheetsService, logger });
  // in the Existing sheet without a date = from the start; doer as in the Orders sheet
  assert.deepEqual(await typeOf(a.order_id), [`Existing Customer / ${a.doer}`]);
  assert.deepEqual(await typeOf(b.order_id), ['Calling Customer / Mayank']);
});

test('first order of a new customer stays Calling Customer after they become existing (v37)', async () => {
  const { place, addExisting } = await setup();
  const first = await place('9866600000');
  await new Promise((r) => { setTimeout(r, 5); });
  // e.g. made an existing customer after the first paid order
  await addExisting('9866600000', new Date().toISOString());
  await new Promise((r) => { setTimeout(r, 5); });
  const second = await place('9866600000');

  await MIGRATIONS.find((m) => m.version === 37).up({ sheets: sheetsService, logger });
  assert.deepEqual(await typeOf(first.order_id), ['Calling Customer / Mayank']);
  assert.deepEqual(await typeOf(second.order_id), ['Existing Customer / Mayank']);
});
