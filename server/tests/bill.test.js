import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freshStore, masters, CUSTOMER, PNG_BYTES,
} from './helpers/fixtures.js';
import { saveProduct } from '../services/productService.js';
import { createDraftOrder, getCustomerOrder, cancelOrderAdmin } from '../services/orderService.js';
import { submitPayment } from '../services/paymentService.js';
import { updateSettings, getSettings } from '../services/settingsService.js';
import {
  sizeColumn, buildBill, formatDzn, customerBill, adminBill,
} from '../services/billService.js';
import { productSchema, draftOrderSchema, paymentSubmitSchema } from '../utils/validation.js';

// Order bill in the Nutex estimate format; customers get it after payment.

let key = 0;
const idem = () => `bill-${Date.now()}-${key += 1}`;
const code = (c) => (err) => { assert.equal(err.code, c); return true; };

test('size columns: S starts at 32 (S/32, M/34, L/36, XL/38), letters share the column', () => {
  assert.deepEqual(['32', '34', '36', '38'].map((s) => [sizeColumn(s).label, sizeColumn(s).sub]), [['S', '32'], ['M', '34'], ['L', '36'], ['XL', '38']]);
  assert.equal(sizeColumn('S').key, sizeColumn('32').key, 'camisole S and bra 32 share a column');
  assert.equal(sizeColumn('xl').key, 'XL');
  assert.equal(sizeColumn('2XL').key, 'XXL');
  assert.equal(sizeColumn('40').label, 'XXL');
  assert.equal(sizeColumn('30').label, 'XS');
  assert.equal(sizeColumn('Free Size').key, 'FREE');
  assert.equal(sizeColumn('').key, 'FREE');
  assert.equal(sizeColumn('80-90').label, '80-90', 'other sizes get their own column');
  assert.equal(formatDzn(48), '4 Dzn');
  assert.equal(formatDzn(6), '0.5 Dzn');
  assert.equal(formatDzn(18), '1.5 Dzn');
});

async function setup() {
  const { adminCtx } = await freshStore();
  await updateSettings({
    minimum_order_value: 0, company_gstin: '07AAECN5863B1ZK', company_phone: '011-42473822',
    company_address: 'A-94/1, Wazirpur Industrial Area, Delhi-110052',
  }, adminCtx);
  const m = await masters();
  const s32 = m.size('32').size_id;
  const s34 = m.size('34').size_id;
  const colours = ['Pink', 'Red', 'Grey'].map((c) => m.color(c).color_id);
  const saved = await saveProduct(productSchema.parse({
    sku: 'YASHIKA', product_name: 'Yashika Set', category_id: m.cat('everyday-bra').category_id, mrp: 62.5,
    units_per_box: 6, size_ids: [s32, s34], color_ids: colours,
    stock: [
      ...colours.flatMap((color_id) => [{ color_id, size_id: s32, stock_qty: 50 }, { color_id, size_id: s34, stock_qty: 50 }]),
      { box_key: `size:${s32}`, stock_qty: 10 }, { box_key: `size:${s34}`, stock_qty: 10 },
    ],
    status: 'ACTIVE',
  }), adminCtx);
  const box = (sizeId) => saved.variants.find((v) => v.inventory_mode === 'BOX_WISE' && v.size_id === sizeId && v.status === 'ACTIVE').variant_id;
  const pink34 = saved.variants.find((v) => v.inventory_mode === 'COLOR_WISE' && v.color_id === colours[0] && v.size_id === s34).variant_id;
  const order = await createDraftOrder(draftOrderSchema.parse({
    customer: CUSTOMER,
    items: [{ variant_id: box(s32), qty: 2 }, { variant_id: box(s34), qty: 2 }, { variant_id: pink34, qty: 3 }],
    idempotency_key: idem(),
  }));
  return { adminCtx, order };
}

test('bill rows follow the estimate: boxes as "Mix" with pieces per size, loose pieces per colour', async () => {
  const { order } = await setup();
  const view = await getCustomerOrder(order.order_number, order.access_token);
  const { bill } = await adminBill(order.order_number);
  assert.equal(bill.title, 'ESTIMATE');
  assert.equal(bill.number, order.order_number);
  assert.equal(bill.company.gstin, '07AAECN5863B1ZK');
  assert.equal(bill.party.name, CUSTOMER.business_name);
  assert.deepEqual(bill.columns.map((c) => c.key), ['S', 'M', 'L', 'XL', 'FREE']);
  const mix = bill.rows.find((r) => r.colour === 'Mix');
  assert.deepEqual(mix.sizes, { S: 12, M: 12 }, '2 boxes of 6 in size 32 and in 34');
  assert.equal(mix.rate, 62.5, 'rate is the per-piece MRP');
  assert.equal(mix.sku, 'YASHIKA', 'article SKU, not the size-specific box SKU');
  assert.equal(mix.disc, 60);
  assert.equal(mix.amount, 600, '24 pcs x 62.50 x 40%');
  const pink = bill.rows.find((r) => r.colour === 'Pink');
  assert.deepEqual(pink.sizes, { M: 3 });
  assert.equal(bill.total_pcs, 27);
  assert.equal(bill.total_dzn, '2.25 Dzn');
  assert.equal(bill.subtotal, view.totals.final_payable);
  assert.equal(bill.grand_total, view.totals.final_payable);
  assert.equal(bill.terms.length, 4);

  // pure builder works on the same data
  assert.equal(buildBill({ order: { order_number: 'X', final_payable: 0 }, items: [], settings: await getSettings() }).rows.length, 0);
});

test('customer downloads the bill only after submitting payment; admin any time', async () => {
  const { adminCtx, order } = await setup();
  let view = await getCustomerOrder(order.order_number, order.access_token);
  assert.equal(view.permissions.can_download_bill, false);
  await assert.rejects(customerBill(order.order_number, order.access_token), code('BILL_NOT_READY'));
  await assert.rejects(customerBill(order.order_number, 'x'.repeat(40)), code('ORDER_ACCESS_REQUIRED'));

  const admin = await adminBill(order.order_number);
  assert.equal(admin.pdf.subarray(0, 5).toString(), '%PDF-');

  await submitPayment(order.order_number, order.access_token, paymentSubmitSchema.parse({ amount: String(view.amount_to_pay), idempotency_key: idem() }), { buffer: PNG_BYTES });
  view = await getCustomerOrder(order.order_number, order.access_token);
  assert.equal(view.permissions.can_download_bill, true);
  const { pdf, filename } = await customerBill(order.order_number, order.access_token);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 5000);
  assert.equal(filename, `ESTIMATE_${order.order_number}.pdf`);

  await cancelOrderAdmin(order.order_number, { reason: 'test' }, adminCtx);
  await assert.rejects(customerBill(order.order_number, order.access_token), code('BILL_NOT_READY'), 'no bill for cancelled orders');
});
