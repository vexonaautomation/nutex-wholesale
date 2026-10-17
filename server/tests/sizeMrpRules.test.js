import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStore } from './helpers/fixtures.js';
import { startCatalogImport } from '../services/catalogImportService.js';
import { applySizeMrpRules, ruleTypeOf } from '../services/sizeMrpRuleService.js';
import { getCatalog, serializeProduct } from '../services/catalogService.js';
import { MIGRATIONS } from '../migrations/index.js';
import { sheetsService } from '../services/sheetsService.js';
import { logger } from '../utils/logger.js';
import { sizeService } from '../services/sizeService.js';
import { bulkSetSizes } from '../services/productService.js';

// Owner's rule: bras & sets 42-44 +6; panties 40 +12, 42-44 +24, 46 +36;
// vests XL-XXL +16; underwear XL-2XL +20, 3XL-4XL +40. Applied on deploy.

const pieceMrps = (catalog, p) => {
  const pub = serializeProduct(catalog, p, { detail: true });
  return Object.fromEntries(pub.variants.filter((v) => v.kind === 'PCS').map((v) => [v.size_name, v.piece_mrp]));
};
const sizesOf = (catalog, p) => new Set((catalog.variantsByProduct.get(p.product_id) || []).map((v) => catalog.sizesById.get(v.size_id)?.size_name));

// the catalogue import, then sizes like on the live site (bras 28-44, panties 32-46, trunks S-4XL)
async function liveLikeStore() {
  const store = await freshStore();
  await startCatalogImport({ ...store.adminCtx, stockPerVariant: 5, wait: true });
  for (const name of ['XXXL', '4XL']) await sizeService.create({ size_name: name }, store.adminCtx);
  const catalog = await getCatalog({ fresh: true });
  const sizeIds = (names) => names.map((n) => catalog.sizes.find((s) => s.size_name === n).size_id);
  const ids = (pred) => catalog.products.filter(pred).map((p) => p.product_id);
  const cat = (p) => catalog.categoriesById.get(p.category_id)?.slug;
  await bulkSetSizes({ product_ids: ids((p) => cat(p) === 'everyday-bra' || cat(p) === 'lingerie-set'), size_ids: sizeIds(['28', '30', '32', '34', '36', '38', '40', '42', '44']) }, store.adminCtx);
  await bulkSetSizes({ product_ids: ids((p) => cat(p) === 'everyday-panty'), size_ids: sizeIds(['32', '34', '36', '38', '40', '42', '44', '46']) }, store.adminCtx);
  await bulkSetSizes({ product_ids: ids((p) => /^(CELLO|BASIC|BOSS-MM)$/.test(p.sku)), size_ids: sizeIds(['S', 'M', 'L', 'XL', 'XXL', 'XXXL', '4XL']) }, store.adminCtx);
  return store;
}

test('deploy (migration v19): size-wise MRP by kind of article; own size prices kept; boxes follow', async () => {
  const { adminCtx } = await liveLikeStore();
  let catalog = await getCatalog({ fresh: true });
  const typeOf = (p) => ruleTypeOf(p, catalog.categoriesById.get(p.category_id));
  const bra = catalog.products.find((p) => typeOf(p) === 'BRA' && sizesOf(catalog, p).has('42') && sizesOf(catalog, p).has('40') && new Set(Object.values(pieceMrps(catalog, p))).size === 1);
  const panty = catalog.products.find((p) => typeOf(p) === 'PANTY' && sizesOf(catalog, p).has('40') && sizesOf(catalog, p).has('42'));
  const trunk = catalog.products.find((p) => p.sku === 'CELLO');
  const parker = catalog.products.find((p) => p.sku === 'RAMBO-PARKER');
  assert.ok(bra && panty && trunk && parker);
  const parkerBefore = pieceMrps(catalog, parker);

  await MIGRATIONS.find((m) => m.version === 19).up({ sheets: sheetsService, logger });
  catalog = await getCatalog({ fresh: true });
  const m = Number(bra.mrp);
  let got = pieceMrps(catalog, catalog.productsById.get(bra.product_id));
  assert.equal(got['40'], m, 'bra 28-40 = MRP');
  assert.equal(got['42'], m + 6, 'bra 42 = MRP + 6');
  if (got['44'] !== undefined) assert.equal(got['44'], m + 6);

  got = pieceMrps(catalog, catalog.productsById.get(panty.product_id));
  const pm = Number(panty.mrp);
  assert.equal(got['38'] ?? pm, pm);
  assert.equal(got['40'], pm + 12);
  assert.equal(got['42'], pm + 24);
  assert.equal(got['46'], pm + 36);

  got = pieceMrps(catalog, catalog.productsById.get(trunk.product_id));
  const tm = Number(trunk.mrp);
  assert.deepEqual([got.S, got.L, got.XL, got.XXL, got.XXXL, got['4XL']], [tm, tm, tm + 20, tm + 20, tm + 40, tm + 40]);

  assert.deepEqual(pieceMrps(catalog, catalog.productsById.get(parker.product_id)), parkerBefore, 'own size-wise MRP kept');

  // a box of size 42 is priced from the new piece MRP
  const pub = serializeProduct(catalog, catalog.productsById.get(bra.product_id), { detail: true });
  const box42 = pub.variants.find((v) => v.kind === 'BOX' && v.size_name === '42');
  if (box42) assert.equal(box42.unit_mrp, box42.units_per_box * (m + 6));

  // running again changes nothing
  const again = await applySizeMrpRules({}, adminCtx);
  assert.equal(again.updated.length, 0);
});

test('admin: the rule on ticked articles; "force" also replaces their own size prices', async () => {
  const { adminCtx } = await liveLikeStore();
  let catalog = await getCatalog({ fresh: true });
  const parker = catalog.products.find((p) => p.sku === 'RAMBO-PARKER');
  const cami = catalog.products.find((p) => ruleTypeOf(p, catalog.categoriesById.get(p.category_id)) === null);
  const res = await applySizeMrpRules({ productIds: [parker.product_id, cami.product_id], dryRun: true }, adminCtx);
  assert.match(res.skipped.find((s) => s.sku === parker.sku).reason, /own size-wise MRP/);
  assert.match(res.skipped.find((s) => s.sku === cami.sku).reason, /no size rule/);

  const forced = await applySizeMrpRules({ productIds: [parker.product_id], force: true }, adminCtx);
  assert.equal(forced.updated.length, 1);
  catalog = await getCatalog({ fresh: true });
  const got = pieceMrps(catalog, catalog.productsById.get(parker.product_id));
  assert.equal(got.XL, Number(parker.mrp) + 16, 'vest XL = MRP + 16');
  assert.equal(got.L, Number(parker.mrp));
});
