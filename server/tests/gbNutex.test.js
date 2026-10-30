import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freshStore, createColorProduct, CUSTOMER, PNG_BYTES,
} from './helpers/fixtures.js';
import { createDraftOrder, getCustomerOrder, updateOrderStatusAdmin } from '../services/orderService.js';
import { submitPayment, verifyPayment, listPayments } from '../services/paymentService.js';
import { createPacker, assignPacker } from '../services/packingService.js';
import { updateSettings } from '../services/settingsService.js';
import { sheetsService } from '../services/sheetsService.js';
import { productUnit, gbMode } from '../services/gbNutexService.js';
import { MIGRATIONS } from '../migrations/index.js';
import { draftOrderSchema, paymentSubmitSchema, packerSchema } from '../utils/validation.js';
import { logger } from '../utils/logger.js';

// GBNutex sales register: one row per item when an order is handed over.

let n = 0;
const idem = () => `gb-${Date.now()}-${(n += 1)}`;

async function setup({ lessPacking = true } = {}) {
  const store = await freshStore();
  await updateSettings({ minimum_order_value: 0 }, store.adminCtx);
  const { variant, saved } = await createColorProduct(store.adminCtx); // ABC Bra, MRP 500, 60% off = 200 a piece
  // cost price typed in the Products sheet by the team
  await sheetsService.commit([{ op: 'update', sheet: 'Products', id: saved.product.product_id, patch: { cost_price: 120 } }]);
  const created = await createDraftOrder(draftOrderSchema.parse({
    customer: CUSTOMER, items: [{ variant_id: variant('Black', '32').variant_id, qty: 24 }], less_packing: lessPacking, idempotency_key: idem(),
  }));
  const view = await getCustomerOrder(created.order_number, created.access_token);
  await submitPayment(created.order_number, created.access_token, paymentSubmitSchema.parse({ amount: String(view.amount_to_pay), idempotency_key: idem() }), { buffer: PNG_BYTES });
  await verifyPayment((await listPayments({})).items[0].payment_id, { remarks: 'ok' }, store.adminCtx);
  const raju = await createPacker(packerSchema.parse({ name: 'Raju', mobile: '9811122334' }), store.adminCtx);
  await assignPacker(created.order_number, { packer_id: raju.packer_id, send: false }, store.adminCtx);
  const to = (status) => updateOrderStatusAdmin(created.order_number, { status, courier_name: 'DTDC', tracking_number: 'D1' }, store.adminCtx);
  return { ...store, created, to };
}

test('product unit from the category', () => {
  assert.equal(productUnit('Set / Lingerie Set'), 'Set');
  assert.equal(productUnit('Padded Bra'), 'Bra');
  assert.equal(productUnit('Everyday Panty'), 'Panty');
  assert.equal(productUnit('Gents Vest'), 'Vest');
  assert.equal(productUnit('Gents Underwear'), 'Underwear');
});

test('GBNutex: rows only on Handed over; dozens, net rate, revenue, cost, online packing; formulas + dropdowns', async () => {
  const { created, to, sheetsTransport } = await setup();
  for (const s of ['PROCESSING', 'PACKED', 'DISPATCHED']) await to(s);
  assert.deepEqual(await sheetsService.read('GBNutex', { fresh: true }), [], 'nothing before the hand-over');

  const sent = [];
  const batch = sheetsTransport.batchUpdate.bind(sheetsTransport);
  sheetsTransport.batchUpdate = async (requests, guard) => { sent.push(...requests); return batch(requests, guard); };
  await to('COMPLETED');

  const [row] = await sheetsService.read('GBNutex', { fresh: true });
  assert.equal(row.BILL, created.order_number);
  assert.equal(row.PLATFORM, 'Website');
  assert.equal(row.MODE, 'Online', 'packing charges taken off');
  assert.equal(row['CLIENT NAME'], 'Riya Fashion Store');
  assert.equal(row.PRODUCT, 'ABC Bra');
  assert.equal(row['PRODUCT UNIT'], 'Bra');
  assert.equal(row.Unit, 'Dzn');
  assert.equal(row.QTY, 2, '24 pcs = 2 Dzn');
  assert.equal(row.PRICE, 200, 'net rate per piece');
  assert.equal(row.REVENUE, 4800, '200 x 24 pcs');
  assert.equal(row.COST, 2880, '120 x 24 pcs');
  assert.equal(row['ONLINE PACKING'], 48, 'less packing: Rs 2 x 24 bras');
  assert.match(row.DATE, /^\d{4}-\d{2}-\d{2}T/);

  const header = sheetsTransport.dump('GBNutex')[0];
  const append = sent.find((r) => r.appendCells && r.appendCells.rows[0].values.length === header.length);
  const cell = (name) => append.appendCells.rows[0].values[header.indexOf(name)];
  assert.deepEqual(cell('GROSS PROFIT').userEnteredValue, { formulaValue: '=IF(OR(INDIRECT("P"&ROW())="",INDIRECT("Q"&ROW())=""),"",INDIRECT("P"&ROW())-INDIRECT("Q"&ROW()))' });
  assert.equal(cell('S NO').userEnteredValue.formulaValue, '=ROW()-1');
  assert.deepEqual(cell('MODE').dataValidation.condition.values.map((v) => v.userEnteredValue), ['Online', 'Offline', 'Ecom Client']);
  assert.ok(cell('PLATFORM').dataValidation.condition.values.some((v) => v.userEnteredValue === 'Meesho NAL'));
  assert.match(append.appendCells.fields, /dataValidation/);
});

test('migration v27 writes orders handed over before it (once)', async () => {
  const { to, sheetsTransport } = await setup();
  for (const s of ['PROCESSING', 'PACKED', 'DISPATCHED', 'COMPLETED']) await to(s);
  sheetsTransport.sheets.get('GBNutex').rows.length = 1; // as before v27
  sheetsService.invalidate();
  const up = MIGRATIONS.find((m) => m.version === 27).up;
  await up({ sheets: sheetsService, logger });
  await up({ sheets: sheetsService, logger });
  assert.equal((await sheetsService.read('GBNutex', { fresh: true })).length, 1);
});

test('MODE: with the boxes (no less packing) = Offline; v28 fills only blank MODE cells', async () => {
  assert.equal(gbMode({ less_packing: false, packing_deduction: 0 }), 'Offline');
  assert.equal(gbMode({ less_packing: false, packing_deduction: 50 }), 'Online', 'the team took packing charges off');
  const { to, sheetsTransport } = await setup({ lessPacking: false });
  for (const s of ['PROCESSING', 'PACKED', 'DISPATCHED', 'COMPLETED']) await to(s);
  assert.equal((await sheetsService.read('GBNutex', { fresh: true }))[0].MODE, 'Offline');

  // a row from before v28 (MODE blank) and one the team typed
  const sheet = sheetsTransport.sheets.get('GBNutex');
  const col = sheet.rows[0].indexOf('MODE');
  sheet.rows.push([...sheet.rows[1]]);
  sheet.rows[1][col] = '';
  sheet.rows[2][col] = 'Ecom Client';
  sheetsService.invalidate();
  await MIGRATIONS.find((m) => m.version === 28).up({ sheets: sheetsService, logger });
  assert.deepEqual(sheet.rows.slice(1).map((r) => r[col]), ['Offline', 'Ecom Client']);
});
