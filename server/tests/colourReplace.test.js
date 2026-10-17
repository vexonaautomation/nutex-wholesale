import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStore, createColorProduct, CUSTOMER, inventoryOf } from './helpers/fixtures.js';
import { previewColourReplace, replaceProductColour } from '../services/colourReplaceService.js';
import { getProductAdmin } from '../services/productService.js';
import { getCatalog, serializeProduct } from '../services/catalogService.js';
import { createDraftOrder, getOrderAdmin } from '../services/orderService.js';
import { updateSettings } from '../services/settingsService.js';
import { draftOrderSchema, colourReplaceSchema } from '../utils/validation.js';

// Colour replacement per article: "Lavender" in Sahin Set is really "Pink" -
// pick the new colour, the stock goes with it. Old orders keep their colour name.

let n = 0;
const key = () => `colour-${Date.now()}-${(n += 1)}`;
const publicColours = async (id) => {
  const catalog = await getCatalog({ fresh: true });
  return serializeProduct(catalog, catalog.productsById.get(id), { detail: true }).colors.map((c) => c.color_name);
};

test('new colour not in the article yet: the same variants become the new colour, stock unchanged', async () => {
  const { adminCtx } = await freshStore();
  const { saved, variant, m } = await createColorProduct(adminCtx, { sku: 'SAHIN' });
  const id = saved.product.product_id;
  const white34 = variant('White', '34');
  const pink = m.color('Pink').color_id;

  const preview = await previewColourReplace(id, { from: m.color('White').color_id, to: pink });
  assert.equal(preview.from.color_name, 'White');
  assert.equal(preview.to.color_name, 'Pink');
  assert.ok(preview.sizes.every((s) => s.action === 'rename'));
  assert.equal(preview.pieces_moved, 25, 'White stock 5 + 10 + 10');

  await replaceProductColour(id, colourReplaceSchema.parse({ from_color_id: m.color('White').color_id, to_color_id: pink }), adminCtx);
  const after = await getProductAdmin(id);
  const moved = after.variants.find((v) => v.variant_id === white34.variant_id);
  assert.equal(moved.color_id, pink, 'same variant, now Pink');
  assert.equal(moved.sku, 'SAHIN-PNK-34');
  assert.deepEqual(await inventoryOf(white34.variant_id), { stock: 10, reserved: 0, available: 10 }, 'stock went with it');
  assert.deepEqual([].concat(after.product.color_ids), [m.color('Black').color_id, pink], 'Pink takes White\'s place');
  assert.deepEqual(await publicColours(id), ['Black', 'Pink']);
});

test('new colour already in the article: free pieces move onto it, pieces of pending orders stay, old orders keep the name', async () => {
  const { adminCtx } = await freshStore();
  await updateSettings({ minimum_order_value: 0 }, adminCtx);
  const { saved, variant, m } = await createColorProduct(adminCtx, { sku: 'LILLY' });
  const id = saved.product.product_id;
  const white34 = variant('White', '34');
  const black34 = variant('Black', '34');
  // a pending order holds 2 White 34
  const order = await createDraftOrder(draftOrderSchema.parse({ customer: CUSTOMER, items: [{ variant_id: white34.variant_id, qty: 2 }], idempotency_key: key() }));
  assert.deepEqual(await inventoryOf(white34.variant_id), { stock: 10, reserved: 2, available: 8 });

  const preview = await previewColourReplace(id, { from: m.color('White').color_id, to: m.color('Black').color_id });
  const s34 = preview.sizes.find((s) => s.size_name === '34');
  assert.equal(s34.action, 'merge');
  assert.equal(s34.move, 8);
  assert.equal(preview.pieces_held, 2);

  await replaceProductColour(id, { from_color_id: m.color('White').color_id, to_color_id: m.color('Black').color_id }, adminCtx);
  assert.deepEqual(await inventoryOf(black34.variant_id), { stock: 108, reserved: 0, available: 108 }, '8 free pieces moved');
  assert.deepEqual(await inventoryOf(white34.variant_id), { stock: 2, reserved: 2, available: 0 }, 'held pieces stay for the order');
  const after = await getProductAdmin(id);
  assert.equal(after.variants.find((v) => v.variant_id === white34.variant_id).status, 'INACTIVE', 'old colour switched off, not deleted');
  assert.deepEqual([].concat(after.product.color_ids), [m.color('Black').color_id]);
  assert.deepEqual(await publicColours(id), ['Black']);
  const { items } = await getOrderAdmin(order.order_number);
  assert.equal(items[0].color, 'White', 'the old order keeps its colour');
});

test('mistakes are refused with a clear message', async () => {
  const { adminCtx } = await freshStore();
  const { saved, m } = await createColorProduct(adminCtx);
  const id = saved.product.product_id;
  await assert.rejects(previewColourReplace(id, { from: m.color('Black').color_id, to: m.color('Black').color_id }), /different new colour/);
  await assert.rejects(previewColourReplace(id, { from: m.color('Red').color_id, to: m.color('Pink').color_id }), /has no Red/);
  await assert.rejects(previewColourReplace('PRD-NOPE', { from: m.color('Black').color_id, to: m.color('Pink').color_id }), /not found/);
});
