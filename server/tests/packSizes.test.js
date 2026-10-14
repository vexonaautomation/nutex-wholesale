import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStore, createColorProduct, createBoxProduct } from './helpers/fixtures.js';
import { setPackSizes, listProductsAdmin } from '../services/productService.js';
import { sheetsService } from '../services/sheetsService.js';
import { packSizesSchema } from '../utils/validation.js';

// "Pack of": pieces in one box per article - a different number for each,
// saved in one go (blank = no box).

test('pack of: a different box size per article in one save; no box; skipped with a reason', async () => {
  const { adminCtx } = await freshStore();
  const a = await createColorProduct(adminCtx, { sku: 'PACKA', product_name: 'Pack A' });
  const b = await createColorProduct(adminCtx, { sku: 'PACKB', product_name: 'Pack B' });
  const legacy = await createBoxProduct(adminCtx, { sku: 'OLDBOX' }); // no sizes / colours
  const ids = { a: a.saved.product.product_id, b: b.saved.product.product_id, legacy: legacy.saved.product.product_id };

  let list = await listProductsAdmin({});
  const rowA = list.find((p) => p.product_id === ids.a);
  assert.equal(rowA.size_count, 3);
  assert.equal(rowA.colour_count, 2, 'shown on the page to explain how a box splits');

  const res = await setPackSizes(packSizesSchema.parse({
    items: [
      { product_id: ids.a, units_per_box: '6' },
      { product_id: ids.b, units_per_box: 4 },
      { product_id: ids.legacy, units_per_box: 6 },
    ],
  }), adminCtx);
  assert.deepEqual(res.updated.sort(), ['PACKA', 'PACKB']);
  assert.equal(res.skipped.length, 1);
  assert.match(res.skipped[0].reason, /OLDBOX/);

  list = await listProductsAdmin({});
  const units = Object.fromEntries(list.map((p) => [p.sku, p.units_per_box]));
  assert.equal(units.PACKA, 6);
  assert.equal(units.PACKB, 4);
  const audit = await sheetsService.read('Audit_Log', { fresh: true });
  assert.ok(audit.some((x) => x.entity_id === ids.a && /pack of/.test(JSON.stringify(x.new_value))));

  // same number again = unchanged; blank = no box
  const again = await setPackSizes(packSizesSchema.parse({ items: [{ product_id: ids.a, units_per_box: 6 }, { product_id: ids.b, units_per_box: null }] }), adminCtx);
  assert.deepEqual(again.unchanged, ['PACKA']);
  assert.deepEqual(again.updated, ['PACKB']);
  assert.equal((await listProductsAdmin({})).find((p) => p.sku === 'PACKB').units_per_box, null);

  assert.throws(() => packSizesSchema.parse({ items: [] }), /Change at least one article/);
  assert.throws(() => packSizesSchema.parse({ items: [{ product_id: ids.a, units_per_box: 2.5 }] }), /whole number/);
});
