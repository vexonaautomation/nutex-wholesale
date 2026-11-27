import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStore, createColorProduct } from './helpers/fixtures.js';
import { sheetsService } from '../services/sheetsService.js';
import { getCatalog } from '../services/catalogService.js';
import { MIGRATIONS, PHOTOS_2026_11_27 } from '../migrations/index.js';
import { readCatalogImage } from '../services/catalogImportService.js';

// Migration v40: Rupali, Sunita, Madhu, KC Bra get the catalogue photo with
// the new MRP, Ford Panty its first photo; the old main photo is switched off.

const logs = [];
const logger = { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) };

test('the five photos are in catalog-import', async () => {
  for (const rel of Object.values(PHOTOS_2026_11_27)) {
    const img = await readCatalogImage(rel);
    assert.ok(img.buffer.length > 50000, rel);
    assert.equal(img.mimeType, 'image/jpeg');
  }
});

test('v40: the article gets the new main photo, the old one is switched off', async () => {
  const { adminCtx } = await freshStore();
  await createColorProduct(adminCtx, { sku: '8006' });
  await createColorProduct(adminCtx, { sku: 'FORD1' });
  const products = await sheetsService.read('Products', { fresh: true });
  const madhu = products.find((p) => p.sku === '8006');
  const ford = products.find((p) => p.sku === 'FORD1');
  const productId = (p) => p.product_id;
  const images = async (id) => (await sheetsService.read('Product_Images', { fresh: true })).filter((i) => i.product_id === id);
  const before = await images(productId(madhu));

  await MIGRATIONS.find((m) => m.version === 40).up({ sheets: sheetsService, logger });
  const after = await images(productId(madhu));
  const active = after.filter((i) => i.status !== 'INACTIVE' && i.image_type === 'MAIN');
  assert.equal(active.length, 1, `one main photo (${logs.join(' / ')})`);
  assert.ok(!before.some((b) => b.image_id === active[0].image_id), 'it is the new one');
  assert.ok(before.every((b) => after.find((a) => a.image_id === b.image_id).status === 'INACTIVE' || b.image_type !== 'MAIN'));
  assert.equal((await images(productId(ford))).filter((i) => i.status !== 'INACTIVE' && i.image_type === 'MAIN').length, 1);
  const catalog = await getCatalog({ fresh: true });
  assert.ok(catalog.productsById.get(productId(madhu)), 'catalogue still loads');
});
