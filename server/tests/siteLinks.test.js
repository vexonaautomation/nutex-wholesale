import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { publicSiteUrl, SITE_DOMAIN_URL } from '../config/env.js';
import { freshStore, createColorProduct, CUSTOMER } from './helpers/fixtures.js';
import { createDraftOrder, cancelOrderAdmin } from '../services/orderService.js';
import { updateSettings } from '../services/settingsService.js';
import { sheetsService } from '../services/sheetsService.js';
import { MIGRATIONS } from '../migrations/index.js';
import { readSignedOrderToken } from '../utils/signedLink.js';
import { draftOrderSchema } from '../utils/validation.js';

// Links in WhatsApp messages and the sheets use the site's own domain, never
// a Render address that changes when the service is created again.

const logger = { info() {}, warn() {}, error() {} };
const key = () => `sl-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

test('live site: a Render address or nothing becomes b2b.nutex.in', () => {
  assert.equal(SITE_DOMAIN_URL, 'https://b2b.nutex.in');
  assert.equal(publicSiteUrl('', { prod: true }), SITE_DOMAIN_URL);
  assert.equal(publicSiteUrl('https://nutex-wholesale.onrender.com', { prod: true }), SITE_DOMAIN_URL);
  assert.equal(publicSiteUrl('https://nutex-wholesale-gd20.onrender.com/', { prod: true }), SITE_DOMAIN_URL);
  assert.equal(publicSiteUrl('https://shop.nutex.in/', { prod: true }), 'https://shop.nutex.in', 'another own domain is kept');
  assert.equal(publicSiteUrl('http://localhost:5173', { prod: false }), 'http://localhost:5173', 'development unchanged');
});

test('migration v34: every bill link moves to the domain with a working token', async () => {
  const { adminCtx, sheetsTransport } = await freshStore();
  await updateSettings({ minimum_order_value: 0 }, adminCtx);
  const { variant } = await createColorProduct(adminCtx);
  const place = () => createDraftOrder(draftOrderSchema.parse({
    customer: CUSTOMER, items: [{ variant_id: variant('Black', '32').variant_id, qty: 12 }], idempotency_key: key(),
  }), { baseUrl: 'https://nutex-wholesale.onrender.com' });
  const live = await place();
  const cancelled = await place();
  await cancelOrderAdmin(cancelled.order_number, { reason: 'test' }, adminCtx);

  // links from the old service: old address, token signed with another secret
  const old = 'https://nutex-wholesale.onrender.com/api/admin-bill/old.token';
  for (const name of ['Orders', 'Cancelled_Orders']) {
    const sheet = sheetsTransport.sheets.get(name);
    for (const row of sheet.rows.slice(1)) row[sheet.rows[0].indexOf('bill_link')] = old;
  }
  sheetsService.invalidate();

  await MIGRATIONS.find((m) => m.version === 34).up({ sheets: sheetsService, logger, baseUrl: SITE_DOMAIN_URL });
  const orders = await sheetsService.read('Orders', { fresh: true });
  assert.equal(orders.length, 2);
  for (const o of orders) {
    assert.match(o.bill_link, /^https:\/\/b2b\.nutex\.in\/api\/admin-bill\//);
    const token = o.bill_link.split('/').pop();
    assert.equal(readSignedOrderToken('admin-bill', token), o.order_id, 'the new link opens');
  }
  assert.ok(orders.some((o) => o.order_number === live.order_number));
});
