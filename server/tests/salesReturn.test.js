import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freshStore, createColorProduct, createBoxProduct, CUSTOMER, PNG_BYTES,
} from './helpers/fixtures.js';
import {
  createDraftOrder, getCustomerOrder, updateOrderStatusAdmin, updateOrderItemsAdmin,
} from '../services/orderService.js';
import { submitPayment, verifyPayment, listPayments } from '../services/paymentService.js';
import { createPacker, assignPacker } from '../services/packingService.js';
import { updateSettings } from '../services/settingsService.js';
import { sheetsService } from '../services/sheetsService.js';
import { createSubAdmin } from '../services/authService.js';
import {
  orderReturns, createSalesReturn, cancelSalesReturn, listSalesReturns, creditNote,
} from '../services/salesReturnService.js';
import { allowedFor } from '../utils/permissions.js';
import {
  draftOrderSchema, paymentSubmitSchema, orderStatusSchema, packerSchema, salesReturnSchema, subAdminSchema, adminOrderItemsSchema,
} from '../utils/validation.js';

// Sales returns: a handed-over order's goods come back. Good goes into stock,
// Damaged is only recorded; never more than was sold; a credit note PDF.

let n = 0;
const idem = () => `sales-return-${Date.now()}-${(n += 1)}`;
const code = (c) => (err) => err.code === c;

async function setup({ handOver = true, lessPacking = false } = {}) {
  const store = await freshStore();
  await updateSettings({ minimum_order_value: 0 }, store.adminCtx);
  const { variant } = await createColorProduct(store.adminCtx);
  const { boxVariant } = await createBoxProduct(store.adminCtx);
  const black = variant('Black', '32').variant_id;
  const items = [{ variant_id: black, qty: 12 }, { variant_id: boxVariant.variant_id, qty: 2 }];
  const order = await createDraftOrder(draftOrderSchema.parse({
    customer: CUSTOMER, items, less_packing: lessPacking, idempotency_key: idem(),
  }));
  if (handOver) {
    const view = await getCustomerOrder(order.order_number, order.access_token);
    await submitPayment(order.order_number, order.access_token, paymentSubmitSchema.parse({ amount: String(view.amount_to_pay), idempotency_key: idem() }), { buffer: PNG_BYTES });
    const pending = (await listPayments({})).items.find((p) => p.order_number === order.order_number);
    await verifyPayment(pending.payment_id, { remarks: 'ok' }, store.adminCtx);
    const raju = await createPacker(packerSchema.parse({ name: 'Raju', mobile: '9811122334' }), store.adminCtx);
    for (const status of ['PROCESSING', 'PACKED', 'DISPATCHED', 'COMPLETED']) {
      if (status === 'COMPLETED') await assignPacker(order.order_number, { packer_id: raju.packer_id, send: false }, store.adminCtx);
      await updateOrderStatusAdmin(order.order_number, orderStatusSchema.parse({ status, courier_name: 'DTDC', tracking_number: 'D1' }), store.adminCtx);
    }
  }
  const stockOf = async (v) => {
    const row = (await sheetsService.read('Inventory', { fresh: true })).find((r) => r.variant_id === v);
    return row.stock_qty;
  };
  const lines = (await orderReturns(order.order_number)).items;
  return {
    ...store, order, black, box: boxVariant.variant_id, stockOf, pcsItem: lines[0], boxItem: lines[1],
  };
}

const body = (items, reason = 'Wrong size sent') => salesReturnSchema.parse({ items, reason });

test('good goes back to stock, damaged does not; number, party and credit are saved', async () => {
  const {
    order, black, pcsItem, stockOf, adminCtx,
  } = await setup();
  const before = await stockOf(black);
  const { sales_return: r } = await createSalesReturn(order.order_number, body([
    { order_item_id: pcsItem.order_item_id, qty: 3, condition: 'GOOD' },
    { order_item_id: pcsItem.order_item_id, qty: 2, condition: 'DAMAGED' },
  ]), adminCtx);
  assert.equal(r.return_number, 'SR-0001');
  assert.equal(await stockOf(black), before + 3);
  assert.deepEqual([r.good_pcs, r.damaged_pcs, r.total_pcs], [3, 2, 5]);
  assert.equal(r.credit_amount, Math.round(pcsItem.unit_amount * 5 * 100) / 100);
  assert.equal(r.made_by_name, adminCtx.admin.name);
  assert.equal((await sheetsService.read('Sales_Return_Items', { fresh: true })).length, 2);

  const left = (await orderReturns(order.order_number)).items[0];
  assert.deepEqual([left.returned, left.returnable], [5, 7]);
});

test('a box returns in boxes; pieces on the record are boxes x pieces per box', async () => {
  const {
    order, box, boxItem, stockOf, adminCtx,
  } = await setup();
  const before = await stockOf(box);
  const { sales_return: r } = await createSalesReturn(order.order_number, body([{ order_item_id: boxItem.order_item_id, qty: 1, condition: 'GOOD' }]), adminCtx);
  assert.equal(await stockOf(box), before + 1);
  assert.equal(r.good_pcs, boxItem.pcs_per_box);
});

test('never more than was sold, over several returns; only handed-over orders', async () => {
  const {
    order, pcsItem, adminCtx,
  } = await setup();
  const line = (qty) => [{ order_item_id: pcsItem.order_item_id, qty, condition: 'GOOD' }];
  await assert.rejects(createSalesReturn(order.order_number, body(line(13)), adminCtx), code('RETURN_TOO_MANY'));
  await createSalesReturn(order.order_number, body(line(10)), adminCtx);
  await assert.rejects(createSalesReturn(order.order_number, body(line(3)), adminCtx), code('RETURN_TOO_MANY'));
  const second = await createSalesReturn(order.order_number, body(line(2)), adminCtx);
  assert.equal(second.sales_return.return_number, 'SR-0002');

  const open = await setup({ handOver: false });
  await assert.rejects(createSalesReturn(open.order.order_number, body([{ order_item_id: open.pcsItem.order_item_id, qty: 1, condition: 'GOOD' }]), open.adminCtx), code('INVALID_TRANSITION'));
});

test('less packing on the order comes off the credit in proportion', async () => {
  const {
    order, pcsItem, boxItem, adminCtx,
  } = await setup({ lessPacking: true });
  const { packing_share: share } = await orderReturns(order.order_number);
  assert.ok(share > 0);
  const { sales_return: r } = await createSalesReturn(order.order_number, body([
    { order_item_id: pcsItem.order_item_id, qty: 12, condition: 'GOOD' },
    { order_item_id: boxItem.order_item_id, qty: 2, condition: 'GOOD' },
  ]), adminCtx);
  const row = (await sheetsService.read('Sales_Returns', { fresh: true }))[0];
  const placed = (await sheetsService.read('Orders', { fresh: true }))[0];
  assert.equal(row.packing_less, placed.packing_deduction, 'a full return takes off all of it');
  assert.ok(Math.abs(r.credit_amount - placed.final_payable) < 1);
});

test('cancelling a return takes the good stock out again and frees the quantity', async () => {
  const {
    order, black, pcsItem, stockOf, adminCtx,
  } = await setup();
  const before = await stockOf(black);
  const { sales_return: r } = await createSalesReturn(order.order_number, body([{ order_item_id: pcsItem.order_item_id, qty: 4, condition: 'GOOD' }]), adminCtx);
  await cancelSalesReturn(r.return_id, { reason: 'typed wrong' }, adminCtx);
  assert.equal(await stockOf(black), before);
  assert.equal((await orderReturns(order.order_number)).items[0].returnable, 12);
  assert.equal((await listSalesReturns()).total_credit, 0);
  await assert.rejects(cancelSalesReturn(r.return_id, { reason: 'again' }, adminCtx), code('INVALID_TRANSITION'));
});

test('a return cannot be cancelled once its stock is gone', async () => {
  const {
    order, black, pcsItem, adminCtx, sheetsTransport,
  } = await setup();
  const { sales_return: r } = await createSalesReturn(order.order_number, body([{ order_item_id: pcsItem.order_item_id, qty: 4, condition: 'GOOD' }]), adminCtx);
  const sheet = sheetsTransport.sheets.get('Inventory');
  const [head] = sheet.rows;
  const row = sheet.rows.find((x) => x[head.indexOf('variant_id')] === black);
  row[head.indexOf('stock_qty')] = 1;
  row[head.indexOf('reserved_qty')] = 0;
  sheetsService.invalidate();
  await assert.rejects(cancelSalesReturn(r.return_id, { reason: 'typed wrong' }, adminCtx), code('STOCK_CHANGED'));
});

test('items of an order with a return cannot be edited', async () => {
  const {
    order, black, box, pcsItem, adminCtx,
  } = await setup();
  await createSalesReturn(order.order_number, body([{ order_item_id: pcsItem.order_item_id, qty: 1, condition: 'GOOD' }]), adminCtx);
  await assert.rejects(updateOrderItemsAdmin(order.order_number, adminOrderItemsSchema.parse({ items: [{ variant_id: black, qty: 10 }, { variant_id: box, qty: 2 }] }), adminCtx), code('HAS_SALES_RETURN'));
});

test('credit note: PDF with return number, bill number and credit total', async () => {
  const {
    order, pcsItem, adminCtx,
  } = await setup();
  const { sales_return: r } = await createSalesReturn(order.order_number, body([{ order_item_id: pcsItem.order_item_id, qty: 2, condition: 'DAMAGED' }]), adminCtx);
  const { bill, pdf, filename } = await creditNote(r.return_id);
  assert.equal(bill.title, 'CREDIT NOTE');
  assert.equal(bill.number, 'SR-0001');
  assert.equal(bill.against, order.order_number);
  assert.equal(bill.grand_total, r.credit_amount);
  assert.equal(bill.total_pcs, 2);
  assert.equal(bill.made_by, adminCtx.admin.name);
  assert.match(filename, /CREDIT_NOTE_SR-0001/);
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
});

test('a sub admin may use sales returns', async () => {
  const { adminCtx } = await setup({ handOver: false });
  const ravi = await createSubAdmin(subAdminSchema.parse({ name: 'Ravi', mobile: '9812345670', password: 'Ravi-pass-2026' }), adminCtx);
  const row = (await sheetsService.read('Admin_Users', { fresh: true })).find((a) => a.admin_id === ravi.admin_id);
  for (const [method, path] of [['GET', '/sales-returns'], ['GET', '/sales-returns/SRN-1/pdf'], ['POST', '/sales-returns/SRN-1/cancel'], ['POST', '/orders/ORD-1/returns']]) {
    assert.equal(allowedFor(row, { method, path }), true, `${method} ${path}`);
  }
});
