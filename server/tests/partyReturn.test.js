import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freshStore, createColorProduct, createBoxProduct, CUSTOMER, PNG_BYTES,
} from './helpers/fixtures.js';
import { createDraftOrder, getCustomerOrder, updateOrderStatusAdmin } from '../services/orderService.js';
import { submitPayment, verifyPayment, listPayments } from '../services/paymentService.js';
import { createPacker, assignPacker } from '../services/packingService.js';
import { updateSettings } from '../services/settingsService.js';
import { sheetsService } from '../services/sheetsService.js';
import {
  returnParties, partyReturnItems, createPartyReturn, cancelSalesReturn, creditNote, listSalesReturns,
} from '../services/salesReturnService.js';
import {
  draftOrderSchema, paymentSubmitSchema, orderStatusSchema, packerSchema, partyReturnSchema,
} from '../utils/validation.js';

// Item-wise credit notes: party -> item search. Supplied items return against
// their bill; an item never supplied is "Not given" and only the owner / main
// admin can return it anyway, at today's rate or their own.

let n = 0;
const idem = () => `party-return-${Date.now()}-${(n += 1)}`;
const SUB = { admin: { admin_id: 'ADM-SUB', role: 'SUB_ADMIN', name: 'Sub' }, ip: '' };

async function setup() {
  const store = await freshStore();
  await updateSettings({ minimum_order_value: 0 }, store.adminCtx);
  const { variant } = await createColorProduct(store.adminCtx);
  const { boxVariant } = await createBoxProduct(store.adminCtx);
  const raju = await createPacker(packerSchema.parse({ name: 'Raju', mobile: '9811122334' }), store.adminCtx);
  const handOver = async (items) => {
    const order = await createDraftOrder(draftOrderSchema.parse({ customer: CUSTOMER, items, idempotency_key: idem() }));
    const view = await getCustomerOrder(order.order_number, order.access_token);
    await submitPayment(order.order_number, order.access_token, paymentSubmitSchema.parse({ amount: String(view.amount_to_pay), idempotency_key: idem() }), { buffer: PNG_BYTES });
    const pending = (await listPayments({})).items.find((p) => p.order_number === order.order_number && p.status !== 'VERIFIED');
    await verifyPayment(pending.payment_id, { remarks: 'ok' }, store.adminCtx);
    for (const status of ['PROCESSING', 'PACKED', 'DISPATCHED', 'COMPLETED']) {
      if (status === 'COMPLETED') await assignPacker(order.order_number, { packer_id: raju.packer_id, send: false }, store.adminCtx);
      await updateOrderStatusAdmin(order.order_number, orderStatusSchema.parse({ status, courier_name: 'DTDC', tracking_number: 'D1' }), store.adminCtx);
    }
    return order;
  };
  const black = variant('Black', '32').variant_id;
  const white = variant('White', '34').variant_id;
  const first = await handOver([{ variant_id: black, qty: 12 }]);
  const second = await handOver([{ variant_id: boxVariant.variant_id, qty: 2 }]);
  const stockOf = async (v) => (await sheetsService.read('Inventory', { fresh: true })).find((r) => r.variant_id === v).stock_qty;
  return {
    ...store, first, second, black, white, box: boxVariant.variant_id, stockOf,
  };
}

const body = (items, reason = 'Customer sent goods back') => partyReturnSchema.parse({ mobile: CUSTOMER.mobile, reason, items });

test('party search; item search shows what was given (all bills) and Not given', async () => {
  const { first, second, white } = await setup();
  const parties = (await returnParties({ q: 'riya' })).items;
  assert.equal(parties.length, 1);
  assert.equal(parties[0].mobile, CUSTOMER.mobile);
  assert.equal(parties[0].handed_over_orders, 2);

  const all = await partyReturnItems({ mobile: CUSTOMER.mobile, q: '' });
  assert.deepEqual(all.given.map((i) => i.bill_no).sort(), [first.order_number, second.order_number].sort());
  assert.equal(all.not_given.length, 0, 'catalogue only with a search');

  const search = await partyReturnItems({ mobile: CUSTOMER.mobile, q: (await sheetsService.read('Order_Items', { fresh: true }))[0].sku_snapshot.slice(0, 4) });
  assert.ok(search.not_given.some((v) => v.variant_id === white), 'White 34 was never given');
  assert.ok(!search.not_given.some((v) => search.given.some((g) => g.variant_id === v.variant_id)), 'a given item is not "not given"');
  assert.ok(search.not_given.find((v) => v.variant_id === white).unit_rate > 0, "today's rate");
});

test('one credit note over two bills; stock back; cancel takes it out again', async () => {
  const {
    first, second, black, box, stockOf, adminCtx,
  } = await setup();
  const { given } = await partyReturnItems({ mobile: CUSTOMER.mobile });
  const pcs = given.find((i) => i.bill_no === first.order_number);
  const boxes = given.find((i) => i.bill_no === second.order_number);
  const blackBefore = await stockOf(black);
  const { sales_return: r } = await createPartyReturn(body([
    { order_item_id: pcs.order_item_id, qty: 3, condition: 'GOOD' },
    { order_item_id: boxes.order_item_id, qty: 1, condition: 'DAMAGED' },
  ]), adminCtx);
  assert.equal(r.return_number, 'SR-0001');
  assert.equal(r.order_number, [first.order_number, second.order_number].join(', '));
  assert.equal(await stockOf(black), blackBefore + 3);
  assert.equal(r.credit_amount, Math.round((pcs.unit_amount * 3 + boxes.unit_amount) * 100) / 100);
  assert.equal((await listSalesReturns()).items.length, 1);
  const pdf = await creditNote(r.return_id);
  assert.equal(pdf.pdf.subarray(0, 4).toString(), '%PDF');

  // never more than was supplied
  await assert.rejects(createPartyReturn(body([{ order_item_id: pcs.order_item_id, qty: 10, condition: 'GOOD' }]), adminCtx), (e) => e.code === 'RETURN_TOO_MANY');
  await cancelSalesReturn(r.return_id, { reason: 'made by mistake' }, adminCtx);
  assert.equal(await stockOf(black), blackBefore);
  assert.ok(box);
});

test('Not given: sub admin is refused; owner / main admin overwrites at today\'s rate or their own', async () => {
  const { white, stockOf, adminCtx } = await setup();
  await assert.rejects(createPartyReturn(body([{ variant_id: white, qty: 2, condition: 'GOOD' }]), SUB), (e) => e.code === 'FORBIDDEN');

  const before = await stockOf(white);
  const { sales_return: r } = await createPartyReturn(body([
    { variant_id: white, qty: 2, condition: 'GOOD', unit_rate: 150 },
  ]), adminCtx);
  assert.equal(r.credit_amount, 300);
  assert.equal(r.order_number, '', 'no bill');
  assert.equal(await stockOf(white), before + 2);
  const row = (await sheetsService.read('Sales_Return_Items', { fresh: true })).find((x) => x.return_id === r.return_id);
  assert.equal(row.not_given, true);
  assert.equal(row.order_item_id, '');
  const pdf = await creditNote(r.return_id);
  assert.ok(pdf.bill.terms.some((t) => /not supplied/.test(t)));
  assert.equal(pdf.bill.grand_total, 300);

  // today's rate when no rate is given
  const { sales_return: today } = await createPartyReturn(body([{ variant_id: white, qty: 1, condition: 'DAMAGED' }]), adminCtx);
  const rate = (await partyReturnItems({ mobile: CUSTOMER.mobile, q: row.sku.slice(0, 4) })).not_given.find((v) => v.variant_id === white).unit_rate;
  assert.equal(today.credit_amount, rate);

  // cancelling a Not given return takes its stock out again
  await cancelSalesReturn(r.return_id, { reason: 'mistake' }, adminCtx);
  assert.equal(await stockOf(white), before);
});
