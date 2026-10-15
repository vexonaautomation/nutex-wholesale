import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';
import { freshStore, createColorProduct, CUSTOMER } from './helpers/fixtures.js';
import {
  createSubAdmin, updateSubAdmin, listSubAdmins, setAdminStatus, login,
} from '../services/authService.js';
import { issueCustomerToken } from '../services/existingCustomerService.js';
import { createDraftOrder, listOrdersAdmin, getOrderAdmin } from '../services/orderService.js';
import { getDashboard } from '../services/dashboardService.js';
import { getSettings, updateSettings } from '../services/settingsService.js';
import { sheetsService } from '../services/sheetsService.js';
import { allowedFor } from '../utils/permissions.js';
import { subAdminSchema, subAdminUpdateSchema, draftOrderSchema } from '../utils/validation.js';

// Sub admins: the owner adds name + mobile; they sign in with the mobile, see
// the Orders tab (full) + pending orders / sale value, and whatever else the
// owner ticks. Orders made with their number show their name.

const RAVI = '9812345670';
const PASS = 'Ravi-pass-2026';
let n = 0;
const key = () => `sub-admin-${Date.now()}-${(n += 1)}`;
const req = (method, path, body) => ({ method, path, body });

async function setup() {
  const store = await freshStore();
  const ravi = await createSubAdmin(subAdminSchema.parse({ name: 'Ravi', mobile: `+91 ${RAVI}`, password: PASS }), store.adminCtx);
  const row = (await sheetsService.read('Admin_Users', { fresh: true })).find((a) => a.admin_id === ravi.admin_id);
  return { ...store, ravi, row };
}

test('owner adds a sub admin: signs in with the mobile, number orders for customers', async () => {
  const { adminCtx, ravi } = await setup();
  assert.equal(ravi.role, 'SUB_ADMIN');
  assert.equal(ravi.mobile, RAVI);
  assert.deepEqual(ravi.permissions, ['payments'], 'default: may also verify payments');
  assert.match((await getSettings({ fresh: true })).admin_order_mobiles, new RegExp(RAVI), 'became an admin order number');

  const signed = await login({ email: RAVI, password: PASS }, { ip: '1' });
  assert.equal(signed.admin.name, 'Ravi');
  await assert.rejects(login({ email: RAVI, password: 'wrong-pass-123' }, { ip: '1' }), /Invalid/);
  await assert.rejects(createSubAdmin(subAdminSchema.parse({ name: 'Copy', mobile: RAVI, password: PASS }), adminCtx), /already has this mobile/);

  const list = await listSubAdmins();
  assert.equal(list.items.length, 1);
  assert.ok(list.permission_options.some((o) => o.key === 'products'));
  assert.ok(!('password_hash' in list.items[0]));
});

test('sub admin access: orders always, the rest only when the owner ticks it', async () => {
  const { adminCtx, ravi, row } = await setup();
  for (const [m, p] of [['GET', '/orders'], ['GET', '/orders/ORD-1'], ['PUT', '/orders/ORD-1/items'], ['PUT', '/orders/ORD-1/status'], ['GET', '/orders/ORD-1/bill'], ['GET', '/dashboard'], ['PUT', '/payments/PAY-1/verify']]) {
    assert.equal(allowedFor(row, req(m, p)), true, `${m} ${p}`);
  }
  for (const [m, p] of [['GET', '/products'], ['GET', '/settings'], ['PUT', '/settings'], ['GET', '/users'], ['GET', '/sub-admins'], ['GET', '/audit-log'], ['GET', '/export/Orders'], ['GET', '/customers'], ['PUT', '/inventory']]) {
    assert.equal(allowedFor(row, req(m, p)), false, `${m} ${p}`);
  }
  // owner ticks products + pricing, unticks payments
  await updateSubAdmin(ravi.admin_id, subAdminUpdateSchema.parse({ name: 'Ravi', mobile: RAVI, permissions: ['products', 'pricing'] }), adminCtx);
  const after = (await sheetsService.read('Admin_Users', { fresh: true })).find((a) => a.admin_id === ravi.admin_id);
  assert.equal(allowedFor(after, req('PUT', '/products/PRD-1')), true);
  assert.equal(allowedFor(after, req('PUT', '/payments/PAY-1/verify')), false);
  assert.equal(allowedFor(after, req('PUT', '/settings', { discount_mode: 'SLAB' })), true, 'discount settings');
  assert.equal(allowedFor(after, req('PUT', '/settings', { discount_mode: 'SLAB', upi_id: 'x@y' })), false, 'nothing else in settings');
  assert.equal(allowedFor(adminCtx.admin, req('GET', '/settings')), true, 'owner: everything');
});

test('orders made with the sub admin number show who made them; dashboards', async () => {
  const { adminCtx, ravi, row } = await setup();
  const { variant } = await createColorProduct(adminCtx);
  const v = variant('Black', '32').variant_id;
  const created = await createDraftOrder(
    draftOrderSchema.parse({ customer: { ...CUSTOMER, mobile: '9123456789', whatsapp: '' }, items: [{ variant_id: v, qty: 2 }], idempotency_key: key() }),
    { customerToken: issueCustomerToken(RAVI).token },
  );
  const detail = await getOrderAdmin(created.order_number);
  assert.equal(detail.order.placed_by_mobile, RAVI);
  assert.equal(detail.order.placed_by_name, 'Ravi');
  const list = await listOrdersAdmin({});
  assert.equal(list.items[0].placed_by_name, 'Ravi');
  assert.equal((await listOrdersAdmin({ placed_by: RAVI })).total, 1);
  assert.equal((await listOrdersAdmin({ placed_by: 'customer' })).total, 0);

  // sub admin: only pending orders + sale value (all orders, and their own)
  const small = await getDashboard({ admin: row });
  assert.equal(small.limited, true);
  assert.equal(small.sales.pending_orders, 1);
  assert.equal(small.mine.orders, 1);
  assert.equal(small.recent_orders[0].placed_by_name, 'Ravi', 'recent orders show who made them');
  assert.ok(!('cards' in small) && !('low_stock' in small), 'no stock / catalogue numbers');
  // owner: full dashboard + orders per sub admin
  const full = await getDashboard({ admin: adminCtx.admin });
  assert.ok(full.cards);
  assert.deepEqual(full.team.map((t) => [t.name, t.orders]), [['Ravi', 1]]);
  assert.equal((await listSubAdmins()).items[0].orders, 1);
});

test('changing the number or switching a sub admin off updates the admin order numbers', async () => {
  const { adminCtx, ravi } = await setup();
  await updateSettings({ admin_order_mobiles: `9811122233, ${RAVI}` }, adminCtx);
  await updateSubAdmin(ravi.admin_id, subAdminUpdateSchema.parse({ name: 'Ravi K', mobile: '9812345671', permissions: [] }), adminCtx);
  assert.equal((await getSettings({ fresh: true })).admin_order_mobiles, '9811122233, 9812345671', 'old number out, new in, owner number kept');
  await setAdminStatus(ravi.admin_id, 'INACTIVE', adminCtx);
  assert.equal((await getSettings({ fresh: true })).admin_order_mobiles, '9811122233');
  await assert.rejects(login({ email: '9812345671', password: PASS }, { ip: '1' }), /Invalid/, 'inactive cannot sign in');
  await setAdminStatus(ravi.admin_id, 'ACTIVE', adminCtx);
  assert.equal((await getSettings({ fresh: true })).admin_order_mobiles, '9811122233, 9812345671');
});

test('HTTP: a sub admin signs in with the mobile and is refused outside the Orders tab', async (t) => {
  await setup();
  const app = createApp();
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, path, body, headers = {}) => fetch(base + path, {
    method, headers: { 'content-type': 'application/json', 'x-requested-with': 'NutexAdmin', ...headers }, body: body ? JSON.stringify(body) : undefined,
  });
  const signIn = await call('POST', '/api/admin/login', { email: RAVI, password: PASS });
  assert.equal(signIn.status, 200);
  const cookie = signIn.headers.get('set-cookie').split(';')[0];
  const me = await (await call('GET', '/api/admin/me', null, { cookie })).json();
  assert.deepEqual(me.admin.permissions, ['payments']);
  assert.equal((await call('GET', '/api/admin/orders', null, { cookie })).status, 200);
  assert.equal((await call('GET', '/api/admin/dashboard', null, { cookie })).status, 200);
  assert.equal((await call('GET', '/api/admin/products', null, { cookie })).status, 403);
  assert.equal((await call('GET', '/api/admin/settings', null, { cookie })).status, 403);
  assert.equal((await call('POST', '/api/admin/sub-admins', { name: 'X', mobile: '9811111111', password: PASS }, { cookie })).status, 403);
  // the owner manages sub admins
  const owner = await call('POST', '/api/admin/login', { email: 'owner@nutex.test', password: 'Password1234' });
  const ownerCookie = owner.headers.get('set-cookie').split(';')[0];
  const listed = await (await call('GET', '/api/admin/sub-admins', null, { cookie: ownerCookie })).json();
  assert.equal(listed.items[0].name, 'Ravi');
});
