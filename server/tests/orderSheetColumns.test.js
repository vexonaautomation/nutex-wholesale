import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStore, createColorProduct, CUSTOMER } from './helpers/fixtures.js';
import { createDraftOrder } from '../services/orderService.js';
import { createPacker, assignPacker } from '../services/packingService.js';
import { addExistingCustomers } from '../services/existingCustomerService.js';
import { updateSettings } from '../services/settingsService.js';
import { adminBillByToken } from '../services/orderAlertService.js';
import { sheetsService } from '../services/sheetsService.js';
import { MIGRATIONS } from '../migrations/index.js';
import { SCHEMA } from '../config/schema.js';
import { draftOrderSchema, packerSchema } from '../utils/validation.js';
import { logger } from '../utils/logger.js';

// Orders sheet BD..BG: doer (Ramesh existing / Mayank inbound), bill link,
// packing person, customer type.

let n = 0;
const key = () => `sheetcols-${Date.now()}-${(n += 1)}`;
const letter = (i) => { let s = ''; for (let x = i + 1; x; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };

test('the four new Orders columns are BD, BE, BF, BG', () => {
  const cols = SCHEMA.Orders.columns;
  assert.deepEqual(['doer', 'bill_link', 'packing_person', 'customer_type'].map((c) => letter(cols.indexOf(c))), ['BD', 'BE', 'BF', 'BG']);
});

test('new orders: doer + customer type by the Existing list, bill link, packing person', async () => {
  const { adminCtx } = await freshStore();
  await updateSettings({ minimum_order_value: 0 }, adminCtx);
  const { variant } = await createColorProduct(adminCtx);
  await addExistingCustomers([{ mobile: '9123456780' }], adminCtx);
  const place = (mobile) => createDraftOrder(draftOrderSchema.parse({
    customer: { ...CUSTOMER, mobile }, items: [{ variant_id: variant('Black', '32').variant_id, qty: 12 }], idempotency_key: key(),
  }), { baseUrl: 'https://b2b.nutex.in' });

  const inbound = await place(CUSTOMER.mobile);
  const existing = await place('9123456780');
  const orders = await sheetsService.read('Orders', { fresh: true });
  const a = orders.find((o) => o.order_number === inbound.order_number);
  const b = orders.find((o) => o.order_number === existing.order_number);
  assert.equal(a.customer_type, 'Inbound Customer');
  assert.equal(a.doer, 'Mayank');
  assert.equal(b.customer_type, 'Existing Customer', 'mobile is in Existing Customers (not OTP verified)');
  assert.equal(b.doer, 'Ramesh');
  assert.match(a.bill_link, /^https:\/\/b2b\.nutex\.in\/api\/admin-bill\/[\w-]+\.[\w-]+$/);
  const bill = await adminBillByToken(a.bill_link.split('/').pop());
  assert.equal(bill.pdf.subarray(0, 4).toString(), '%PDF');

  const raju = await createPacker(packerSchema.parse({ name: 'Raju', mobile: '9811122334' }), adminCtx);
  await assignPacker(a.order_id, { packer_id: raju.packer_id, send: false }, adminCtx);
  assert.equal((await sheetsService.read('Orders', { fresh: true })).find((o) => o.order_id === a.order_id).packing_person, 'Raju');

  await updateSettings({ doer_inbound_customer: 'Suresh' }, adminCtx);
  const c = await place('9000011111');
  assert.equal((await sheetsService.read('Orders', { fresh: true })).find((o) => o.order_number === c.order_number).doer, 'Suresh', 'name from Settings');
});

test('migration v23 fills the columns of orders already in the sheet (blank cells only)', async () => {
  const { adminCtx, sheetsTransport } = await freshStore();
  await updateSettings({ minimum_order_value: 0 }, adminCtx);
  const { variant } = await createColorProduct(adminCtx);
  const created = await createDraftOrder(draftOrderSchema.parse({
    customer: CUSTOMER, items: [{ variant_id: variant('Black', '32').variant_id, qty: 12 }], idempotency_key: key(),
  }), { baseUrl: 'https://b2b.nutex.in' });
  const raju = await createPacker(packerSchema.parse({ name: 'Raju', mobile: '9811122334' }), adminCtx);
  await assignPacker(created.order_number, { packer_id: raju.packer_id, send: false }, adminCtx);

  // looks like an order from before v23
  const sheet = sheetsTransport.sheets.get('Orders');
  const header = sheet.rows[0];
  for (const c of ['doer', 'bill_link', 'packing_person', 'customer_type']) sheet.rows[1][header.indexOf(c)] = '';
  sheet.rows[1][header.indexOf('doer')] = 'Kept by hand';
  sheetsService.invalidate();

  // the live site knows its address (FRONTEND_URL / Render's own URL)
  await MIGRATIONS.find((m) => m.version === 23).up({ sheets: sheetsService, logger, baseUrl: 'https://b2b.nutex.in' });
  const o = (await sheetsService.read('Orders', { fresh: true }))[0];
  assert.equal(o.doer, 'Kept by hand', 'a value already there is never overwritten');
  assert.equal(o.customer_type, 'Inbound Customer');
  assert.equal(o.packing_person, 'Raju');
  assert.match(o.bill_link, /^https:\/\/b2b\.nutex\.in\/api\/admin-bill\//);
});
