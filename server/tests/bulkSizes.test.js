import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freshStore, masters, inventoryOf, createBoxProduct,
} from './helpers/fixtures.js';
import { saveProduct, getProductAdmin, bulkSetSizes } from '../services/productService.js';
import { productSchema, bulkSizesSchema } from '../utils/validation.js';
import { getCatalog } from '../services/catalogService.js';

// Bulk sizes: change the sizes of many products at once; nothing is deleted.

async function product(adminCtx, sku) {
  const m = await masters();
  const s = (n) => m.size(n).size_id;
  const [black, white] = ['Black', 'White'].map((c) => m.color(c).color_id);
  const saved = await saveProduct(productSchema.parse({
    sku, product_name: `Bra ${sku}`, category_id: m.cat('everyday-bra').category_id, mrp: 100,
    units_per_box: 6, size_ids: [s('32'), s('34')], color_ids: [black, white],
    stock: [s('32'), s('34')].flatMap((size_id) => [{ color_id: black, size_id, stock_qty: 50 }, { color_id: white, size_id, stock_qty: 50 }]),
    status: 'ACTIVE',
  }), adminCtx);
  return { pid: saved.product.product_id, s, black };
}

const activeSizes = async (pid) => {
  const a = await getProductAdmin(pid);
  const names = new Map((await getCatalog({ fresh: true })).sizes.map((x) => [x.size_id, x.size_name]));
  return {
    sizes: a.product.size_ids.map((x) => names.get(x)),
    pcs: a.variants.filter((v) => v.status === 'ACTIVE' && v.inventory_mode === 'COLOR_WISE').length,
    boxes: a.variants.filter((v) => v.status === 'ACTIVE' && v.inventory_mode === 'BOX_WISE').length,
    variant: (colour, size) => a.variants.find((v) => v.inventory_mode === 'COLOR_WISE' && v.color_id === colour && names.get(v.size_id) === size),
  };
};

test('bulk sizes: set 28-40 style ranges on many products, keep stock, never delete', async () => {
  const { adminCtx } = await freshStore();
  const a = await product(adminCtx, 'SZA');
  const b = await product(adminCtx, 'SZB');
  const sizes28to34 = ['28', '30', '32', '34'].map(a.s);
  const keep32 = (await activeSizes(a.pid)).variant(a.black, '32').variant_id;

  const res = await bulkSetSizes(bulkSizesSchema.parse({ product_ids: [a.pid, b.pid], size_ids: sizes28to34 }), adminCtx);
  assert.deepEqual(res.updated.sort(), ['SZA', 'SZB']);
  let now = await activeSizes(a.pid);
  assert.deepEqual(now.sizes, ['28', '30', '32', '34']);
  assert.equal(now.pcs, 8, '2 colours x 4 sizes');
  assert.equal(now.boxes, 4, 'one box per size');
  assert.equal((await inventoryOf(keep32)).stock, 50, 'existing size keeps its stock');
  assert.equal((await inventoryOf(now.variant(a.black, '28').variant_id)).stock, 0, 'new size starts at 0');

  // remove 32: switched off, stock kept; add it back: the same variant comes back
  await bulkSetSizes(bulkSizesSchema.parse({ product_ids: [a.pid], size_ids: [a.s('32')], mode: 'remove' }), adminCtx);
  now = await activeSizes(a.pid);
  assert.deepEqual(now.sizes, ['28', '30', '34']);
  assert.equal(now.variant(a.black, '32').status, 'INACTIVE');
  assert.equal((await inventoryOf(keep32)).stock, 50);
  await bulkSetSizes(bulkSizesSchema.parse({ product_ids: [a.pid], size_ids: [a.s('32')], mode: 'add' }), adminCtx);
  now = await activeSizes(a.pid);
  assert.deepEqual(now.sizes, ['28', '30', '32', '34']);
  assert.equal(now.variant(a.black, '32').variant_id, keep32, 'same variant reactivated');

  const again = await bulkSetSizes(bulkSizesSchema.parse({ product_ids: [a.pid], size_ids: sizes28to34 }), adminCtx);
  assert.deepEqual(again.unchanged, ['SZA'], 'running it again changes nothing');
});

test('bulk sizes: never leaves a product without sizes; old-style box products are skipped', async () => {
  const { adminCtx } = await freshStore();
  const a = await product(adminCtx, 'SZC');
  const res = await bulkSetSizes(bulkSizesSchema.parse({ product_ids: [a.pid], size_ids: [a.s('32'), a.s('34')], mode: 'remove' }), adminCtx);
  assert.match(res.skipped[0].reason, /would have no sizes left/);
  const legacy = await createBoxProduct(adminCtx);
  const res2 = await bulkSetSizes(bulkSizesSchema.parse({ product_ids: [legacy.saved.product.product_id], size_ids: [a.s('32')] }), adminCtx);
  assert.match(res2.skipped[0].reason, /old-style boxes/);
  await assert.rejects(bulkSetSizes({ product_ids: [a.pid], size_ids: ['SIZ-NOPE'], mode: 'add' }, adminCtx), /Unknown size/);
  assert.equal(bulkSizesSchema.safeParse({ product_ids: [a.pid], size_ids: [] }).success, false);
});

test('a new number size is placed in number order (28 before 30), other sizes at the end', async () => {
  const { adminCtx } = await freshStore();
  const { sizeService } = await import('../services/sizeService.js');
  await sizeService.create({ size_name: '29' }, adminCtx);
  await sizeService.create({ size_name: '7XL' }, adminCtx);
  const names = (await getCatalog({ fresh: true })).sizes.map((s) => s.size_name);
  assert.ok(names.indexOf('29') === names.indexOf('30') - 1 && names.indexOf('29') === names.indexOf('28') + 1, `29 between 28 and 30: ${names.join(' ')}`);
  assert.equal(names[names.length - 1], '7XL', 'non-number sizes go to the end');
  await assert.rejects(sizeService.create({ size_name: '30' }, adminCtx), /already exists/);
});
