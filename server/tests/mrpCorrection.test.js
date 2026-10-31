import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStore, masters, CUSTOMER } from './helpers/fixtures.js';
import { saveProduct } from '../services/productService.js';
import {
  createDraftOrder, getOrderAdmin, previewOrderItemsAdmin, updateOrderItemsAdmin,
} from '../services/orderService.js';
import { updateSettings } from '../services/settingsService.js';
import { sheetsService } from '../services/sheetsService.js';
import { productSchema, draftOrderSchema, adminOrderItemsSchema } from '../utils/validation.js';

// A wrong MRP is corrected: bigger sizes keep their difference, and an order
// can take today's product MRP ("Update prices from products").

async function setup() {
  const { adminCtx } = await freshStore();
  await updateSettings({ minimum_order_value: 0 }, adminCtx);
  const m = await masters();
  const s34 = m.size('34').size_id;
  const s36 = m.size('36').size_id;
  const black = m.color('Black').color_id;
  const input = (mrp, sizeMrps) => productSchema.parse({
    sku: 'SARITA', product_name: 'Sarita (C-Cup)', category_id: m.cat('padded-bra').category_id, mrp,
    inventory_mode: 'COLOR_WISE', size_ids: [s34, s36], color_ids: [black],
    size_mrps: sizeMrps,
    stock: [{ color_id: black, size_id: s34, stock_qty: 100 }, { color_id: black, size_id: s36, stock_qty: 100 }],
    status: 'ACTIVE',
  });
  const saved = await saveProduct(input(167, [{ size_id: s36, mrp: 173 }]), adminCtx);
  const variantOf = async (sizeId) => (await sheetsService.read('Product_Variants', { fresh: true }))
    .find((v) => v.product_id === saved.product.product_id && v.size_id === sizeId && v.inventory_mode === 'COLOR_WISE');
  return {
    adminCtx, saved, input, s34, s36, variantOf,
  };
}

test('MRP corrected 167 -> 179: a size-wise MRP left as it was moves too (173 -> 185); one typed in the same save is kept', async () => {
  const {
    adminCtx, saved, input, s36, variantOf,
  } = await setup();
  await saveProduct(input(179, [{ size_id: s36, mrp: 173 }]), { ...adminCtx, productId: saved.product.product_id });
  assert.equal(Number((await variantOf(s36)).variant_mrp), 185, 'keeps the +6');

  await saveProduct(input(180, [{ size_id: s36, mrp: 200 }]), { ...adminCtx, productId: saved.product.product_id });
  assert.equal(Number((await variantOf(s36)).variant_mrp), 200, 'typed in the same save: kept as typed');
});

test('"Update prices from products": the order takes today\'s MRP; a normal edit keeps the old rate', async () => {
  const {
    adminCtx, saved, input, s34, s36, variantOf,
  } = await setup();
  const v34 = (await variantOf(s34)).variant_id;
  const v36 = (await variantOf(s36)).variant_id;
  const o = await createDraftOrder(draftOrderSchema.parse({ customer: CUSTOMER, items: [{ variant_id: v34, qty: 6 }, { variant_id: v36, qty: 6 }], idempotency_key: `mrp-${Date.now()}` }));
  // the wrong MRP is corrected after the order was placed
  await saveProduct(input(179, [{ size_id: s36, mrp: 173 }]), { ...adminCtx, productId: saved.product.product_id });
  const items = [{ variant_id: v34, qty: 6 }, { variant_id: v36, qty: 6 }];

  const keep = await previewOrderItemsAdmin(o.order_number, { items });
  assert.deepEqual(keep.quote.lines.map((l) => l.unit_mrp), [167, 173], 'without the tick: old rates');

  const fresh = await previewOrderItemsAdmin(o.order_number, { items, reprice: true });
  assert.deepEqual(fresh.quote.lines.map((l) => l.unit_mrp), [179, 185], 'with the tick: today\'s MRP');

  await updateOrderItemsAdmin(o.order_number, adminOrderItemsSchema.parse({ items, reprice: true, note: 'MRP corrected' }), adminCtx);
  const after = await getOrderAdmin(o.order_number);
  assert.deepEqual(after.items.filter((i) => i.status === 'ACTIVE').map((i) => Number(i.mrp_unit)).sort(), [179, 185]);
  assert.equal(after.totals.mrp_subtotal, (179 + 185) * 6);
});
