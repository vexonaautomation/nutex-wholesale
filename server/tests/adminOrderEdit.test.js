import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freshStore, masters, CUSTOMER, PNG_BYTES, inventoryOf,
} from './helpers/fixtures.js';
import { saveProduct } from '../services/productService.js';
import {
  createDraftOrder, getCustomerOrder, getOrderAdmin, cancelOrderAdmin,
  previewOrderItemsAdmin, orderProductOptionsAdmin, updateOrderItemsAdmin,
} from '../services/orderService.js';
import { submitPayment, verifyPayment, listPayments } from '../services/paymentService.js';
import { updateSettings } from '../services/settingsService.js';
import { sheetsService } from '../services/sheetsService.js';
import { productSchema, draftOrderSchema, paymentSubmitSchema, adminOrderItemsSchema } from '../utils/validation.js';

// Admin > Orders > "Edit items": the admin changes quantities, removes items
// and adds new articles to an order - also after payment.

let n = 0;
const idem = () => `admin-edit-${Date.now()}-${(n += 1)}`;
const code = (c) => (err) => { assert.equal(err.code, c); return true; };

async function setup() {
  // pieces only for existing customers (the Nutex rule)
  const { adminCtx } = await freshStore({ pcsForAll: false });
  await updateSettings({ minimum_order_value: 0 }, adminCtx);
  const m = await masters();
  const s32 = m.size('32').size_id;
  const s34 = m.size('34').size_id;
  const product = async (sku, name, mrp, units, colourNames) => {
    const colours = colourNames.map((c) => m.color(c).color_id);
    const saved = await saveProduct(productSchema.parse({
      sku, product_name: name, category_id: m.cat('everyday-bra').category_id, mrp,
      units_per_box: units, size_ids: [s32, s34], color_ids: colours,
      stock: colours.flatMap((color_id) => [{ color_id, size_id: s32, stock_qty: 50 }, { color_id, size_id: s34, stock_qty: 50 }]),
      status: 'ACTIVE',
    }), adminCtx);
    return {
      product_id: saved.product.product_id,
      box: (sizeId) => saved.variants.find((v) => v.inventory_mode === 'BOX_WISE' && v.size_id === sizeId && v.status === 'ACTIVE').variant_id,
      pcs: (colour, sizeId) => saved.variants.find((v) => v.inventory_mode === 'COLOR_WISE' && v.color_id === m.color(colour).color_id && v.size_id === sizeId).variant_id,
    };
  };
  // box of 6 with 3 colours = 2 of each; box of 4 with 2 colours = 2 of each
  const yashika = await product('YASHIKA', 'Yashika Set', 62.5, 6, ['Pink', 'Red', 'Grey']);
  const comfort = await product('COMFORT', 'Comfort Bra', 80, 4, ['Black', 'White']);
  const place = async (items) => {
    const o = await createDraftOrder(draftOrderSchema.parse({ customer: CUSTOMER, items, idempotency_key: idem() }));
    return { ...o, order_id: (await getOrderAdmin(o.order_number)).order.order_id };
  };
  const save = (o, items, note = '') => updateOrderItemsAdmin(o.order_number, adminOrderItemsSchema.parse({ items, note }), adminCtx);
  return {
    adminCtx, m, s32, s34, yashika, comfort, place, save,
  };
}

test('unpaid order: admin changes a quantity and adds a new article; reservation and totals follow', async () => {
  const {
    s32, s34, yashika, comfort, place, save,
  } = await setup();
  const o = await place([{ variant_id: yashika.box(s32), qty: 2 }]);
  const pink32 = yashika.pcs('Pink', s32);
  assert.equal((await inventoryOf(pink32)).reserved, 4, '2 boxes x 2 pink');

  const preview = await previewOrderItemsAdmin(o.order_number, { items: [{ variant_id: yashika.box(s32), qty: 3 }, { variant_id: comfort.box(s34), qty: 1 }] });
  assert.equal(preview.quote.has_issues, false);
  assert.equal(preview.current_final_payable, 300, '2 x 375 x 40%');
  assert.equal(preview.new_final_payable, 578, '3 x 375 x 40% + 320 x 40%');

  const res = await save(o, [{ variant_id: yashika.box(s32), qty: 3 }, { variant_id: comfort.box(s34), qty: 1 }], 'customer called');
  assert.equal(res.order.revision, 2);
  assert.equal(res.order.order_status, 'PAYMENT_PENDING');
  assert.equal(res.totals.final_payable, 578);
  assert.deepEqual(res.items.map((i) => [i.sku.split('-')[0], i.qty]).sort(), [['COMFORT', 1], ['YASHIKA', 3]]);
  assert.equal((await inventoryOf(pink32)).reserved, 6, 'reservation follows the new quantity');
  assert.equal((await inventoryOf(pink32)).stock, 50, 'stock untouched for an unpaid order');
  assert.equal((await inventoryOf(comfort.pcs('Black', s34))).reserved, 2);
  const audit = res.audit.find((a) => a.action === 'ORDER_UPDATED_BY_ADMIN');
  assert.match(audit.notes, /customer called/);

  // the customer sees the new items and amount
  const view = await getCustomerOrder(o.order_number, o.access_token);
  assert.equal(view.items.length, 2);
  assert.equal(view.amount_to_pay, 578);

  // remove the new article again -> its reservation is released
  await save(o, [{ variant_id: yashika.box(s32), qty: 3 }]);
  assert.equal((await inventoryOf(comfort.pcs('Black', s34))).reserved, 0);
});

test('paid order: stock is deducted / returned directly and the balance shows what is still due', async () => {
  const {
    adminCtx, s32, s34, yashika, place, save,
  } = await setup();
  const o = await place([{ variant_id: yashika.box(s32), qty: 2 }]);
  const view = await getCustomerOrder(o.order_number, o.access_token);
  await submitPayment(o.order_number, o.access_token, paymentSubmitSchema.parse({ amount: String(view.amount_to_pay), idempotency_key: idem() }), { buffer: PNG_BYTES });
  const { items: payments } = await listPayments({});
  await verifyPayment(payments[0].payment_id, { remarks: 'ok' }, adminCtx);
  let admin = await getOrderAdmin(o.order_number);
  assert.equal(admin.order.stock_state, 'DEDUCTED');
  assert.equal(admin.actions.can_edit_items, true, 'admin can still change a paid order');
  const pink34 = yashika.pcs('Pink', s34);

  admin = await save(o, [{ variant_id: yashika.box(s32), qty: 2 }, { variant_id: yashika.box(s34), qty: 1 }]);
  assert.equal(admin.order.locked, true, 'stays locked for the customer');
  assert.deepEqual(await inventoryOf(pink34), { stock: 48, reserved: 0, available: 48 }, 'taken straight from stock');
  assert.equal(admin.amount_paid_verified, 300);
  assert.equal(admin.balance_due, 150, 'the extra box is still to be paid');

  admin = await save(o, [{ variant_id: yashika.box(s32), qty: 1 }]);
  assert.equal((await inventoryOf(pink34)).stock, 50, 'removed box goes back to stock');
  assert.equal((await inventoryOf(yashika.pcs('Pink', s32))).stock, 48, 'one of the two paid boxes returned');
  assert.equal(admin.totals.final_payable, 150);
  assert.equal(admin.balance_due, 0);
});

test('items already in the order keep their rate and stay even if the article was stopped', async () => {
  const {
    s32, s34, yashika, comfort, place, save,
  } = await setup();
  const o = await place([{ variant_id: yashika.box(s32), qty: 2 }]);
  // later: price raised and the article switched off
  await sheetsService.commit([{ op: 'update', sheet: 'Products', id: yashika.product_id, patch: { mrp: 100, status: 'INACTIVE' } }]);

  const res = await save(o, [{ variant_id: yashika.box(s32), qty: 2 }, { variant_id: comfort.box(s34), qty: 1 }]);
  const kept = res.items.find((i) => i.sku.startsWith('YASHIKA'));
  assert.equal(kept.mrp_unit, 375, 'order rate kept (6 x 62.50)');
  assert.equal(kept.qty, 2);
  assert.equal((await inventoryOf(yashika.pcs('Pink', s32))).reserved, 4, 'same pieces stay reserved');
  // reducing is fine, more of a stopped article is not
  await save(o, [{ variant_id: yashika.box(s32), qty: 1 }, { variant_id: comfort.box(s34), qty: 1 }]);
  await assert.rejects(save(o, [{ variant_id: yashika.box(s32), qty: 3 }]), code('STOCK_CHANGED'));
});

test('box by default: loose pieces only on an existing customer order', async () => {
  const {
    s32, yashika, place, save,
  } = await setup();
  const o = await place([{ variant_id: yashika.box(s32), qty: 1 }]);
  let found = await orderProductOptionsAdmin(o.order_number, { q: 'yash' });
  assert.equal(found.products.length, 1);
  assert.equal(found.products[0].sku, 'YASHIKA');
  assert.equal(found.products[0].pcs_allowed, false, 'new customer: boxes only');
  assert.ok(found.products[0].options.every((opt) => opt.box_label), 'only box options');
  assert.deepEqual((await orderProductOptionsAdmin(o.order_number, { q: 'y' })).products, [], 'needs 2 letters');

  const loose = [{ variant_id: yashika.box(s32), qty: 1 }, { variant_id: yashika.pcs('Pink', s32), qty: 3 }];
  const preview = await previewOrderItemsAdmin(o.order_number, { items: loose });
  assert.equal(preview.quote.lines.find((l) => l.issue)?.issue.code, 'PCS_EXISTING_ONLY');
  await assert.rejects(save(o, loose), code('STOCK_CHANGED'));

  // existing customer order: loose pieces can be added
  await sheetsService.commit([{ op: 'update', sheet: 'Orders', id: o.order_id, patch: { customer_type_snapshot: 'EXISTING', minimum_order_value_snapshot: 0 } }]);
  found = await orderProductOptionsAdmin(o.order_number, { q: 'YASHIKA' });
  assert.equal(found.products[0].pcs_allowed, true);
  assert.ok(found.products[0].options.some((opt) => opt.color_name === 'Pink' && !opt.box_label));
  const res = await save(o, loose);
  assert.equal(res.items.length, 2);
  assert.equal(res.order.customer_type_snapshot, 'EXISTING', 'customer type kept');
});

test('minimum order is not checked for the admin; closed orders cannot be changed', async () => {
  const {
    adminCtx, s32, yashika, place, save,
  } = await setup();
  const o = await place([{ variant_id: yashika.box(s32), qty: 4 }]);
  await updateSettings({ minimum_order_value: 100000 }, adminCtx);
  const res = await save(o, [{ variant_id: yashika.box(s32), qty: 1 }]);
  assert.equal(res.totals.final_payable, 150);
  assert.equal(res.totals.minimum_order_met, false);

  await cancelOrderAdmin(o.order_number, { reason: 'test' }, adminCtx);
  assert.equal((await getOrderAdmin(o.order_number)).actions.can_edit_items, false);
  await assert.rejects(save(o, [{ variant_id: yashika.box(s32), qty: 2 }]), code('ORDER_LOCKED'));
  await assert.rejects(previewOrderItemsAdmin(o.order_number, {}), code('ORDER_LOCKED'));
});
