import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';
import { freshStore, createColorProduct, CUSTOMER, PNG_BYTES } from './helpers/fixtures.js';

async function startServer() {
  const app = createApp();
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base };
}

test('HTTP API: auth, CSRF header, order lock enforcement, payment upload', async (t) => {
  const { adminCtx } = await freshStore();
  const { variant } = await createColorProduct(adminCtx);
  const { server, base } = await startServer();
  t.after(() => server.close());
  const json = (method, path, body, headers = {}) => fetch(base + path, {
    method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined,
  });

  // public
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
  const store = await (await fetch(`${base}/api/store`)).json();
  assert.equal(store.settings.minimum_order_value, 10000);
  assert.equal(store.categories.length, 10);
  const products = await (await fetch(`${base}/api/products?category=padded-bra`)).json();
  assert.equal(products.total, 1);
  assert.equal(products.items[0].discount.display_percent, 60);

  // price sent by the browser is ignored
  const v = variant('Black', '32').variant_id;
  const quote = await (await json('POST', '/api/cart/quote', { items: [{ variant_id: v, qty: 50, price: 1 }] })).json();
  assert.equal(quote.final_payable, 10000);
  assert.equal(quote.can_checkout, true);

  // admin endpoints are protected
  assert.equal((await fetch(`${base}/api/admin/dashboard`)).status, 401);
  const login = await json('POST', '/api/admin/login', { email: 'owner@nutex.test', password: 'Password1234' });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.match(login.headers.get('set-cookie'), /HttpOnly/i);
  assert.equal((await json('GET', '/api/admin/dashboard', null, { cookie })).status, 200);
  assert.equal((await json('POST', '/api/admin/sizes', { size_name: '58' }, { cookie })).status, 403, 'missing CSRF header');
  assert.equal((await json('POST', '/api/admin/sizes', { size_name: '58' }, { cookie, 'x-requested-with': 'NutexAdmin' })).status, 201);
  assert.equal((await json('POST', '/api/admin/login', { email: 'owner@nutex.test', password: 'wrong-password1' })).status, 401);

  // checkout
  const created = await json('POST', '/api/orders/draft', { customer: CUSTOMER, items: [{ variant_id: v, qty: 50 }], idempotency_key: 'api-test-key-0001', client_final_payable: 10000 });
  assert.equal(created.status, 201);
  const { order_number: orderNumber, access_token: token } = await created.json();
  assert.equal((await json('GET', `/api/orders/${orderNumber}`)).status, 403, 'token required');
  assert.equal((await json('GET', `/api/orders/${orderNumber}`, null, { 'x-order-token': token })).status, 200);

  // payment with screenshot (multipart)
  const form = new FormData();
  form.set('amount', '10000');
  form.set('utr', 'UTRAPI123456');
  form.set('idempotency_key', 'api-pay-key-0001');
  form.set('screenshot', new Blob([PNG_BYTES], { type: 'image/png' }), 'proof.png');
  const paid = await fetch(`${base}/api/orders/${orderNumber}/payment`, { method: 'POST', headers: { 'x-order-token': token }, body: form });
  assert.equal(paid.status, 201);
  assert.equal((await paid.json()).order.locked, true);

  // API itself rejects modification of a locked order
  const edit = await json('PUT', `/api/orders/${orderNumber}`, { items: [{ variant_id: v, qty: 60 }] }, { 'x-order-token': token });
  assert.equal(edit.status, 409);
  assert.equal((await edit.json()).error.code, 'ORDER_LOCKED');

  // fake file type is rejected
  const bad = new FormData();
  bad.set('amount', '10000');
  bad.set('utr', 'UTRAPI999999');
  bad.set('idempotency_key', 'api-pay-key-0002');
  bad.set('screenshot', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'x.png');
  const badRes = await fetch(`${base}/api/orders/${orderNumber}/payment`, { method: 'POST', headers: { 'x-order-token': token }, body: bad });
  assert.equal(badRes.status, 400);

  // admin sees the proof; the public media route never serves payment proofs
  const adminOrder = await (await json('GET', `/api/admin/orders/${orderNumber}`, null, { cookie })).json();
  const proofId = adminOrder.payments[0].proof_file_id;
  assert.equal((await fetch(`${base}/media/${proofId}`)).status, 404);
  assert.equal((await fetch(`${base}${adminOrder.payments[0].proof_view_url}`, { headers: { cookie } })).status, 200);

  // SPA meta + robots
  assert.match(await (await fetch(`${base}/robots.txt`)).text(), /Disallow: \/admin/);
});
