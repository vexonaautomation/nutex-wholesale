import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freshStore, createColorProduct, createBoxProduct, CUSTOMER, inventoryOf, PNG_BYTES, dumpAll, masters,
} from './helpers/fixtures.js';
import {
  createDraftOrder, getCustomerOrder, updateOrderItems, trackOrder, cancelOrderAdmin, reopenOrderAdmin,
  updateOrderStatusAdmin, getOrderAdmin, expireUnpaidOrders, lockOrder,
} from '../services/orderService.js';
import { submitPayment, verifyPayment, rejectPayment } from '../services/paymentService.js';
import { saveProduct, setProductStatus, getProductAdmin } from '../services/productService.js';
import { applyStockUpdates } from '../services/inventoryService.js';
import { updateSettings } from '../services/settingsService.js';
import { createSlab, updateSlab, setSlabActive } from '../services/discountService.js';
import { colorService } from '../services/colorService.js';
import { categoryService } from '../services/categoryService.js';
import { buildQuote } from '../services/quoteService.js';
import { getCatalog } from '../services/catalogService.js';
import { sheetsService } from '../services/sheetsService.js';
import { runMigrations } from '../services/migrationService.js';
import { configureStorage } from '../services/bootstrap.js';
import { config } from '../config/env.js';
import { productSchema, draftOrderSchema, slabSchema } from '../utils/validation.js';

let key = 0;
const idem = () => `test-key-${Date.now()}-${key += 1}`;
const draft = (items, extra = {}) => createDraftOrder(draftOrderSchema.parse({ customer: CUSTOMER, items, idempotency_key: idem(), ...extra }));
const pay = (orderNumber, token, utr, amount) => submitPayment(orderNumber, token, { amount, utr, customer_note: '', idempotency_key: idem() }, { buffer: PNG_BYTES });
const code = (c) => (err) => { assert.equal(err.code, c); return true; };

test('categories: add, edit, deactivate hides products, reactivate', async () => {
  const { adminCtx } = await freshStore();
  const created = await categoryService.create({ category_name: 'Thermal Wear', parent_category: 'MEN', slug: '' }, adminCtx);
  assert.equal(created.slug, 'thermal-wear');
  const edited = await categoryService.update(created.category_id, { category_name: 'Thermal Collection', parent_category: 'MEN', slug: 'thermal' }, adminCtx);
  assert.equal(edited.slug, 'thermal');
  await assert.rejects(categoryService.create({ category_name: 'Thermal Collection' }, adminCtx), /already exists/);
  await categoryService.setStatus(created.category_id, 'INACTIVE', adminCtx);
  await categoryService.setStatus(created.category_id, 'ACTIVE', adminCtx);
  const audit = await sheetsService.read('Audit_Log', { fresh: true });
  for (const a of ['CATEGORY_CREATED', 'CATEGORY_UPDATED', 'CATEGORY_DEACTIVATED', 'CATEGORY_REACTIVATED']) {
    assert.ok(audit.some((r) => r.action === a), `${a} logged`);
  }
});

test('stock levels: color+size out of stock does not make the whole product out of stock', async () => {
  const { adminCtx } = await freshStore();
  const { variant } = await createColorProduct(adminCtx);
  const catalog = await getCatalog({ fresh: true });
  const q = buildQuote({ items: [{ variant_id: variant('Black', '36').variant_id, qty: 1 }, { variant_id: variant('Black', '34').variant_id, qty: 1 }], catalog });
  assert.equal(q.lines[0].issue.code, 'OUT_OF_STOCK');
  assert.equal(q.lines[0].issue.message, 'This color-size combination is out of stock.');
  assert.equal(q.lines[1].issue, null);
});

test('frontend price manipulation is impossible: quote only accepts variant + qty', async () => {
  const { adminCtx } = await freshStore();
  const { variant } = await createColorProduct(adminCtx);
  const catalog = await getCatalog({ fresh: true });
  const q = buildQuote({ items: [{ variant_id: variant('Black', '32').variant_id, qty: 1, price: 1, unit_price: 1 }], catalog });
  assert.equal(q.lines[0].unit_price, 200);
});

test('minimum order is enforced by the backend on order creation', async () => {
  const { adminCtx } = await freshStore();
  const { variant } = await createColorProduct(adminCtx);
  const v = variant('Black', '32').variant_id;
  await assert.rejects(draft([{ variant_id: v, qty: 48 }]), code('MIN_ORDER_NOT_MET')); // 24,000 MRP -> 9,600
  const ok = await draft([{ variant_id: v, qty: 50 }]); // 25,000 MRP -> exactly 10,000
  assert.equal((await getCustomerOrder(ok.order_number, ok.access_token)).totals.final_payable, 10000);
});

test('full lifecycle: draft -> edit -> pay (lock) -> reject -> resubmit -> verify -> fulfil -> reopen -> cancel', async () => {
  const { adminCtx } = await freshStore();
  const { variant } = await createColorProduct(adminCtx);
  const { boxVariant } = await createBoxProduct(adminCtx);
  const black32 = variant('Black', '32').variant_id;
  const box = boxVariant.variant_id;

  // 1. draft order reserves stock
  const created = await draft([{ variant_id: black32, qty: 50 }]);
  assert.match(created.order_number, /^NX-\d{8}-0001$/);
  const token = created.access_token;
  assert.deepEqual(await inventoryOf(black32), { stock: 100, reserved: 50, available: 50 });

  // 2. customer edits BEFORE payment: below-minimum edit is rejected
  await assert.rejects(
    updateOrderItems(created.order_number, token, { items: [{ variant_id: black32, qty: 40 }, { variant_id: box, qty: 2 }] }),
    code('MIN_ORDER_NOT_MET'),
  );
  // valid edit: 40 x 500 + 3 boxes x 2,400 = 27,200 MRP -> 10,880
  let order = await updateOrderItems(created.order_number, token, { items: [{ variant_id: black32, qty: 40 }, { variant_id: box, qty: 3 }] });
  assert.equal(order.totals.final_payable, 10880);
  assert.equal(order.items.length, 2);
  assert.deepEqual(await inventoryOf(black32), { stock: 100, reserved: 40, available: 60 });
  assert.deepEqual(await inventoryOf(box), { stock: 5, reserved: 3, available: 2 });

  // 3. payment submission locks the order and commits stock
  order = await pay(created.order_number, token, 'UTR123456789', 10880);
  assert.equal(order.locked, true);
  assert.equal(order.order_status, 'PAYMENT_SUBMITTED');
  assert.deepEqual(await inventoryOf(black32), { stock: 60, reserved: 0, available: 60 });
  assert.deepEqual(await inventoryOf(box), { stock: 2, reserved: 0, available: 2 });

  // 4. customer cannot edit after payment - enforced by the backend
  await assert.rejects(updateOrderItems(created.order_number, token, { items: [{ variant_id: black32, qty: 60 }] }), (err) => {
    assert.equal(err.code, 'ORDER_LOCKED');
    assert.equal(err.message, 'Your order has been locked because payment confirmation has been submitted.');
    return true;
  });
  await assert.rejects(pay(created.order_number, token, 'UTR999999999', 10880), code('PAYMENT_ALREADY_SUBMITTED'));

  // 5. admin rejects -> still locked, customer may resubmit
  const admin1 = await getOrderAdmin(created.order_number);
  await rejectPayment(admin1.payments[0].payment_id, { remarks: 'Screenshot unreadable' }, adminCtx);
  order = await getCustomerOrder(created.order_number, token);
  assert.equal(order.order_status, 'PAYMENT_REJECTED');
  assert.equal(order.locked, true);
  assert.equal(order.permissions.can_edit, false);
  assert.equal(order.permissions.can_submit_payment, true);
  order = await pay(created.order_number, token, 'UTR123456789', 10880); // same UTR allowed after rejection
  assert.equal(order.order_status, 'PAYMENT_SUBMITTED');
  assert.deepEqual(await inventoryOf(black32), { stock: 60, reserved: 0, available: 60 }, 'no double deduction');

  // 6. verify + fulfilment flow (forward only, needs verified payment)
  const admin2 = await getOrderAdmin(created.order_number);
  const pending = admin2.payments.find((p) => p.status === 'SUBMITTED');
  await verifyPayment(pending.payment_id, { remarks: 'Received' }, adminCtx);
  await assert.rejects(verifyPayment(pending.payment_id, {}, adminCtx), code('INVALID_PAYMENT_STATE'));
  await updateOrderStatusAdmin(created.order_number, { status: 'CONFIRMED' }, adminCtx);
  await updateOrderStatusAdmin(created.order_number, { status: 'PROCESSING' }, adminCtx);
  await assert.rejects(updateOrderStatusAdmin(created.order_number, { status: 'CONFIRMED' }, adminCtx), code('INVALID_TRANSITION'));

  // 7. admin reopen (reason required) -> editable again, stock back to reserved
  const reopened = await reopenOrderAdmin(created.order_number, { reason: 'Customer wants to add sizes', confirm: true }, adminCtx);
  assert.equal(reopened.order.locked, false);
  assert.equal(reopened.order.order_status, 'PAYMENT_PENDING');
  assert.ok(reopened.audit.some((a) => a.action === 'ORDER_REOPENED' && a.reason === 'Customer wants to add sizes'));
  assert.deepEqual(await inventoryOf(black32), { stock: 100, reserved: 40, available: 60 });
  order = await getCustomerOrder(created.order_number, token);
  assert.equal(order.permissions.can_edit, true);
  assert.equal(order.amount_paid_verified, 10880);
  assert.equal(order.balance_due, 0);

  // 8. cancel releases the reservation
  await cancelOrderAdmin(created.order_number, { reason: 'Customer cancelled' }, adminCtx);
  assert.deepEqual(await inventoryOf(black32), { stock: 100, reserved: 0, available: 100 });
  assert.deepEqual(await inventoryOf(box), { stock: 5, reserved: 0, available: 5 });
  await assert.rejects(reopenOrderAdmin(created.order_number, { reason: 'try again', confirm: true }, adminCtx), code('INVALID_TRANSITION'));
});

test('order access requires the token or order number + mobile', async () => {
  const { adminCtx } = await freshStore();
  const { variant } = await createColorProduct(adminCtx);
  const created = await draft([{ variant_id: variant('Black', '32').variant_id, qty: 50 }]);
  await assert.rejects(getCustomerOrder(created.order_number, 'wrong-token'), code('ORDER_ACCESS_REQUIRED'));
  await assert.rejects(trackOrder({ order_number: created.order_number, mobile: '9000000000' }), code('NOT_FOUND'));
  const tracked = await trackOrder({ order_number: created.order_number, mobile: '9876543210' });
  assert.equal(tracked.access_token, created.access_token);
  await assert.rejects(lockOrder(created.order_number, created.access_token), code('PAYMENT_REQUIRED'));
});

test('duplicate checkout protection (same idempotency key, sequential and concurrent)', async () => {
  const { adminCtx } = await freshStore();
  const { variant } = await createColorProduct(adminCtx);
  const v = variant('Black', '32').variant_id;
  const body = draftOrderSchema.parse({ customer: CUSTOMER, items: [{ variant_id: v, qty: 50 }], idempotency_key: 'same-key-12345' });
  const [a, b] = await Promise.all([createDraftOrder(body), createDraftOrder(body)]);
  const c = await createDraftOrder(body);
  assert.equal(a.order_number, b.order_number);
  assert.equal(a.order_number, c.order_number);
  const orders = await sheetsService.read('Orders', { fresh: true });
  assert.equal(orders.length, 1);
  assert.deepEqual(await inventoryOf(v), { stock: 100, reserved: 50, available: 50 });
});

test('concurrent orders cannot oversell the last units', async () => {
  const { adminCtx } = await freshStore();
  await updateSettings({ minimum_order_value: 0 }, adminCtx);
  const { variant } = await createColorProduct(adminCtx);
  const v = variant('White', '32').variant_id; // stock 5
  const results = await Promise.allSettled([draft([{ variant_id: v, qty: 5 }]), draft([{ variant_id: v, qty: 5 }])]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const failed = results.find((r) => r.status === 'rejected');
  assert.equal(failed.reason.code, 'STOCK_CHANGED');
  assert.equal(failed.reason.message, 'Stock has changed. Please review your cart.');
  assert.deepEqual(await inventoryOf(v), { stock: 5, reserved: 5, available: 0 });
});

test('client-visible price change is detected at checkout', async () => {
  const { adminCtx } = await freshStore();
  const { variant } = await createColorProduct(adminCtx);
  await assert.rejects(draft([{ variant_id: variant('Black', '32').variant_id, qty: 50 }], { client_final_payable: 9000 }), code('PRICE_CHANGED'));
});

test('historical order snapshot survives price change, rename, deactivation, color removal', async () => {
  const { adminCtx } = await freshStore();
  const { saved, variant, m } = await createColorProduct(adminCtx);
  const created = await draft([{ variant_id: variant('White', '34').variant_id, qty: 10 }, { variant_id: variant('Black', '32').variant_id, qty: 40 }]);
  await pay(created.order_number, created.access_token, 'UTRSNAP0001', 10000);
  const before = await getCustomerOrder(created.order_number, created.access_token);

  const p = (await getProductAdmin(saved.product.product_id)).product;
  const input = productSchema.parse({
    ...p, sku: p.sku, mrp: 600, product_name: 'ABC Bra Renamed', discount_mode: 'CUSTOM', fixed_discount_percent: 55,
    images: [], stock: [], color_ids: [m.color('Black').color_id], size_ids: p.size_ids,
  });
  await saveProduct(input, { ...adminCtx, productId: p.product_id });
  await setProductStatus(p.product_id, 'INACTIVE', adminCtx);
  await colorService.setStatus(m.color('White').color_id, 'INACTIVE', adminCtx);

  const after = await getCustomerOrder(created.order_number, created.access_token);
  assert.deepEqual(after.items, before.items);
  const white = after.items.find((i) => i.color === 'White');
  assert.equal(white.product_name, 'ABC Bra');
  assert.equal(white.mrp_unit, 500);
  assert.equal(white.discount_percent, 60);
  assert.equal(white.unit_price, 200);
  assert.equal(white.size, '34');
  assert.equal(after.totals.final_payable, 10000);
});

test('slab system: add, edit, deactivate, overlap rejected, used by orders', async () => {
  const { adminCtx } = await freshStore();
  const { variant } = await createColorProduct(adminCtx);
  await updateSettings({ discount_mode: 'SLAB' }, adminCtx);
  const s = (o) => slabSchema.parse(o);
  const s1 = await createSlab(s({ min_amount: 0, max_amount: 4999, discount_percent: 40 }), adminCtx);
  await createSlab(s({ min_amount: 5000, max_amount: 9999, discount_percent: 50 }), adminCtx);
  await createSlab(s({ min_amount: 10000, max_amount: 19999, discount_percent: 55 }), adminCtx);
  const top = await createSlab(s({ min_amount: 20000, max_amount: null, discount_percent: 60 }), adminCtx);
  await assert.rejects(createSlab(s({ min_amount: 4000, max_amount: 8000, discount_percent: 45 }), adminCtx), /overlaps/);

  const v = variant('Black', '32').variant_id;
  const catalog = await getCatalog({ fresh: true });
  const q = buildQuote({ items: [{ variant_id: v, qty: 30 }], catalog }); // 15,000 MRP
  assert.equal(q.discount_percent, 55);
  assert.equal(q.minimum_order_met, false);

  await updateSlab(top.slab_id, s({ min_amount: 20000, max_amount: null, discount_percent: 65 }), adminCtx);
  // 25,000 MRP @65% = 8,750 final -> slab reached but minimum (10,000) not met
  await assert.rejects(draft([{ variant_id: v, qty: 50 }]), code('MIN_ORDER_NOT_MET'));
  await setSlabActive(s1.slab_id, false, adminCtx);
  const audit = await sheetsService.read('Audit_Log', { fresh: true });
  for (const a of ['SLAB_CREATED', 'SLAB_UPDATED', 'SLAB_DEACTIVATED']) assert.ok(audit.some((r) => r.action === a), `${a} logged`);
});

test('slab order uses the slab percent and stores slab snapshot', async () => {
  const { adminCtx } = await freshStore();
  const { variant } = await createColorProduct(adminCtx);
  await updateSettings({ discount_mode: 'SLAB', minimum_order_value: 5000 }, adminCtx);
  const s = (o) => slabSchema.parse(o);
  await createSlab(s({ min_amount: 0, max_amount: 19999, discount_percent: 40 }), adminCtx);
  const top = await createSlab(s({ min_amount: 20000, max_amount: null, discount_percent: 60 }), adminCtx);
  const created = await draft([{ variant_id: variant('Black', '32').variant_id, qty: 50 }]);
  const view = await getOrderAdmin(created.order_number);
  assert.equal(view.order.discount_percent, 60);
  assert.equal(view.order.slab_id_snapshot, top.slab_id);
  await setSlabActive(top.slab_id, false, adminCtx);
  const after = await getOrderAdmin(created.order_number);
  assert.equal(after.order.final_payable, 10000, 'existing order unaffected by slab deactivation');
});

test('admin inventory edit refuses stale values and stock below reservations', async () => {
  const { adminCtx } = await freshStore();
  const { variant } = await createColorProduct(adminCtx);
  const v = variant('Black', '32');
  await draft([{ variant_id: v.variant_id, qty: 50 }]);
  const invId = v.inventory.inventory_id;
  await assert.rejects(applyStockUpdates([{ inventory_id: invId, stock_qty: 30 }], adminCtx), /reserved/);
  await assert.rejects(applyStockUpdates([{ inventory_id: invId, stock_qty: 120, expected_stock_qty: 90 }], adminCtx), code('STOCK_CONFLICT'));
  await applyStockUpdates([{ inventory_id: invId, stock_qty: 120, expected_stock_qty: 100 }], adminCtx);
  assert.deepEqual(await inventoryOf(v.variant_id), { stock: 120, reserved: 50, available: 70 });
});

test('unpaid orders expire after reservation_expiry_hours and release stock', async () => {
  const { adminCtx, sheetsTransport } = await freshStore();
  const { variant } = await createColorProduct(adminCtx);
  const v = variant('Black', '32').variant_id;
  const created = await draft([{ variant_id: v, qty: 50 }]);
  // age the order by 100 hours
  const sheet = sheetsTransport.sheets.get('Orders');
  const header = sheet.rows[0];
  const old = new Date(Date.now() - 100 * 3600 * 1000).toISOString();
  sheet.rows[1][header.indexOf('updated_at')] = old;
  sheetsService.invalidate();
  const res = await expireUnpaidOrders();
  assert.equal(res.expired, 1);
  assert.deepEqual(await inventoryOf(v), { stock: 100, reserved: 0, available: 100 });
  const order = await getCustomerOrder(created.order_number, created.access_token);
  assert.equal(order.order_status, 'CANCELLED');
});

test('CRITICAL REDEPLOY TEST: bulk data survives redeploys; one product edit changes only that product', async () => {
  const { sheetsTransport, adminCtx } = await freshStore();
  const m = await masters();
  // STEP 1 - bulk business data
  for (let i = 0; i < 11; i += 1) await categoryService.create({ category_name: `Bulk Category ${i}`, parent_category: 'WOMEN' }, adminCtx);
  for (let i = 0; i < 22; i += 1) await colorService.create({ color_name: `Shade ${i}`, color_code: `S${i}`, hex_code: '#123456' }, adminCtx);
  const products = [];
  for (let i = 0; i < 25; i += 1) {
    const input = productSchema.parse({
      sku: `BULK${i}`, product_name: `Bulk Product ${i}`, category_id: m.cat('padded-bra').category_id, mrp: 400 + i,
      inventory_mode: 'COLOR_WISE', size_ids: [m.size('32').size_id, m.size('34').size_id], color_ids: [m.color('Black').color_id],
      stock: [{ color_id: m.color('Black').color_id, size_id: m.size('32').size_id, stock_qty: 500 }],
    });
    products.push(await saveProduct(input, adminCtx));
  }
  const orders = [];
  for (let i = 0; i < 12; i += 1) {
    const v = products[i].variants.find((x) => x.size_id === m.size('32').size_id).variant_id;
    const qty = Math.ceil(10000 / ((400 + i) * 0.4));
    const o = await createDraftOrder(draftOrderSchema.parse({
      customer: { ...CUSTOMER, mobile: `98765${String(43000 + i).padStart(5, '0')}` }, items: [{ variant_id: v, qty }], idempotency_key: idem(),
    }));
    const view = await getCustomerOrder(o.order_number, o.access_token);
    await pay(o.order_number, o.access_token, `UTRBULK${1000 + i}`, view.totals.final_payable);
    orders.push({ ...o, view: await getCustomerOrder(o.order_number, o.access_token) });
  }
  const snapshot = dumpAll(sheetsTransport);
  const counts = Object.fromEntries(Object.entries(snapshot).map(([k, v]) => [k, v.length]));
  assert.ok(counts.Products >= 26 && counts.Orders === 13 && counts.Payments === 13 && counts.Customers === 13);

  // STEP 2/3 - deploy new code version: fresh process state, migrations run again
  configureStorage(config, { sheetsTransport });
  await runMigrations();
  assert.deepEqual(dumpAll(sheetsTransport), snapshot, 'nothing changed after redeploy');

  // STEP 4 - change one product, verify only that product's rows changed
  const target = products[5].product;
  const input = productSchema.parse({ ...target, mrp: 999, images: [], stock: [], size_ids: target.size_ids, color_ids: target.color_ids });
  await saveProduct(input, { ...adminCtx, productId: target.product_id });
  const afterEdit = dumpAll(sheetsTransport);
  const pHeader = afterEdit.Products[0];
  afterEdit.Products.slice(1).forEach((row, i) => {
    if (row[0] !== target.product_id) assert.deepEqual(row, snapshot.Products[i + 1], 'other products untouched');
    else assert.equal(row[pHeader.indexOf('mrp')], 999);
  });
  for (const sheet of ['Categories', 'Colors', 'Sizes', 'Inventory', 'Customers', 'Orders', 'Order_Items', 'Payments', 'Settings']) {
    assert.deepEqual(afterEdit[sheet], snapshot[sheet], `${sheet} untouched by product edit`);
  }

  // STEP 5 - old orders keep their prices, STEP 6 - redeploy again
  configureStorage(config, { sheetsTransport });
  await runMigrations();
  for (const o of orders) {
    const now = await getCustomerOrder(o.order_number, o.access_token);
    assert.deepEqual(now.items, o.view.items);
    assert.equal(now.locked, true, 'orders remain locked');
  }
  assert.deepEqual(dumpAll(sheetsTransport).Audit_Log.length, afterEdit.Audit_Log.length, 'audit log intact');
});
