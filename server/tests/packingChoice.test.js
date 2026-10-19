import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStore, masters, CUSTOMER } from './helpers/fixtures.js';
import { saveProduct } from '../services/productService.js';
import { categoryService } from '../services/categoryService.js';
import {
  createDraftOrder, getCustomerOrder, getOrderAdmin, updateOrderItems, updateOrderItemsAdmin, listOrdersAdmin, setPackingDeduction,
} from '../services/orderService.js';
import { adminBill } from '../services/billService.js';
import { buildQuote } from '../services/quoteService.js';
import { getCatalog } from '../services/catalogService.js';
import { updateSettings } from '../services/settingsService.js';
import { autoPackingRate, packingRateOf } from '../utils/packing.js';
import {
  productSchema, draftOrderSchema, categorySchema, adminOrderItemsSchema,
} from '../utils/validation.js';

// "Do you wish to less packing charges?" at checkout: bra / panty ₹2 per
// piece, set ₹4 per set (rate per category), a box counts its pieces.
// Prices include GST 5%: only the line "5% GST included" is shown.

let n = 0;
const idem = () => `packing-${Date.now()}-${(n += 1)}`;

test('packing rate per category: own rate, else Set 4 / Bra 2 / Panty 2 / others 0', () => {
  assert.equal(autoPackingRate({ category_name: 'Set / Lingerie Set', slug: 'lingerie-set' }), 4);
  assert.equal(autoPackingRate({ category_name: 'Padded Bra', slug: 'padded-bra' }), 2);
  assert.equal(autoPackingRate({ category_name: 'Everyday Bra Collection' }), 2);
  assert.equal(autoPackingRate({ category_name: 'Everyday Panty Collection' }), 2);
  assert.equal(autoPackingRate({ category_name: 'Print Collection', slug: 'print-collection' }), 0);
  assert.equal(packingRateOf({ category_name: 'Print Collection', packing_charge: 3 }), 3, 'own rate wins');
  assert.equal(packingRateOf({ category_name: 'Padded Bra', packing_charge: 0 }), 0, '0 = no packing charge');
  assert.equal(packingRateOf({ category_name: 'Padded Bra', packing_charge: null }), 2, 'blank = automatic');
});

async function setup() {
  const { adminCtx } = await freshStore();
  await updateSettings({ minimum_order_value: 0 }, adminCtx);
  const m = await masters();
  const s32 = m.size('32').size_id;
  const s34 = m.size('34').size_id;
  const product = async (sku, slug, mrp, units, colourNames) => {
    const colours = colourNames.map((c) => m.color(c).color_id);
    const saved = await saveProduct(productSchema.parse({
      sku, product_name: sku, category_id: m.cat(slug).category_id, mrp,
      units_per_box: units, size_ids: [s32, s34], color_ids: colours,
      stock: colours.flatMap((color_id) => [{ color_id, size_id: s32, stock_qty: 50 }, { color_id, size_id: s34, stock_qty: 50 }]),
      status: 'ACTIVE',
    }), adminCtx);
    return {
      box: (sizeId) => saved.variants.find((v) => v.inventory_mode === 'BOX_WISE' && v.size_id === sizeId && v.status === 'ACTIVE').variant_id,
      pcs: (colour, sizeId) => saved.variants.find((v) => v.inventory_mode === 'COLOR_WISE' && v.color_id === m.color(colour).color_id && v.size_id === sizeId).variant_id,
    };
  };
  const bra = await product('BRA1', 'everyday-bra', 100, 6, ['Black', 'White']); // ₹2 / pc
  const set = await product('SET1', 'lingerie-set', 200, 4, ['Black', 'White']); // ₹4 / set
  const print = await product('PRINT1', 'print-collection', 100, 6, ['Black', 'White']); // ₹0 (auto)
  const place = (items, lessPacking) => createDraftOrder(draftOrderSchema.parse({
    customer: CUSTOMER, items, idempotency_key: idem(), less_packing: lessPacking,
  }));
  return {
    adminCtx, m, s32, s34, bra, set, print, place,
  };
}

test('quote: what "less packing charges" would take off - boxes count their pieces', async () => {
  const { s32, bra, set, print } = await setup();
  const quote = buildQuote({
    catalog: await getCatalog({ fresh: true }),
    items: [
      { variant_id: bra.box(s32), qty: 2 }, // 12 bras x 2 = 24
      { variant_id: bra.pcs('Black', s32), qty: 3 }, // 3 bras x 2 = 6
      { variant_id: set.box(s32), qty: 1 }, // 4 sets x 4 = 16
      { variant_id: print.box(s32), qty: 1 }, // print collection: 0
    ],
  });
  assert.equal(quote.packing_charges, 46);
  assert.equal(quote.packing_choice, true);
  assert.equal(quote.gst_percent, 5);
  assert.deepEqual(quote.packing_breakdown.map((b) => [b.rate, b.pieces, b.amount]).sort(), [[2, 15, 30], [4, 4, 16]]);
});

test('customer ticks it: packing charges taken off, admin sees it, bill shows it with GST 5% included', async () => {
  const { s32, bra, set, place } = await setup();
  const items = [{ variant_id: bra.box(s32), qty: 2 }, { variant_id: set.box(s32), qty: 1 }];
  const o = await place(items, true);
  const view = await getCustomerOrder(o.order_number, o.access_token);
  // 12 x 100 x 40% + 4 x 200 x 40% = 480 + 320 = 800; packing 24 + 16 = 40
  assert.equal(view.totals.packing_deduction, 40);
  assert.equal(view.totals.less_packing, true);
  assert.equal(view.totals.final_payable, 760);
  assert.equal(view.amount_to_pay, 760);
  assert.equal(view.totals.gst_percent, 5);
  assert.equal(view.totals.gst_amount, undefined, 'no GST amount shown');

  const admin = await getOrderAdmin(o.order_number);
  assert.equal(admin.order.less_packing, true, 'highlighted for the admin');
  const listed = (await listOrdersAdmin({})).items.find((x) => x.order_number === o.order_number);
  assert.equal(listed.less_packing, true);
  assert.equal(listed.packing_deduction, 40);
  assert.ok(admin.audit.some((a) => a.action === 'ORDER_CREATED' && /less_packing/.test(JSON.stringify(a.new_value))));

  const { bill, pdf } = await adminBill(o.order_number);
  assert.equal(bill.subtotal, 800);
  assert.equal(bill.packing_deduction, 40);
  assert.equal(bill.less_packing, true);
  assert.equal(bill.grand_total, 760);
  assert.equal(bill.gst_percent, 5);
  assert.equal(bill.gst, undefined, 'only the line "5% GST included"');
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');

  // not ticked: nothing taken off
  const plain = await place(items, false);
  const plainView = await getCustomerOrder(plain.order_number, plain.access_token);
  assert.equal(plainView.totals.packing_deduction, 0);
  assert.equal(plainView.totals.less_packing, false);
  assert.equal(plainView.totals.final_payable, 800);
});

test('the deduction follows the items when the customer or the admin edits the order', async () => {
  const {
    adminCtx, s32, s34, bra, place,
  } = await setup();
  const o = await place([{ variant_id: bra.box(s32), qty: 2 }], true);
  assert.equal((await getCustomerOrder(o.order_number, o.access_token)).totals.packing_deduction, 24);

  let view = await updateOrderItems(o.order_number, o.access_token, { items: [{ variant_id: bra.box(s32), qty: 3 }] });
  assert.equal(view.totals.packing_deduction, 36, '18 bras x 2');
  assert.equal(view.totals.final_payable, 720 - 36);

  const admin = await updateOrderItemsAdmin(o.order_number, adminOrderItemsSchema.parse({ items: [{ variant_id: bra.box(s32), qty: 3 }, { variant_id: bra.pcs('White', s34), qty: 5 }] }), adminCtx);
  assert.equal(admin.totals.packing_deduction, 46, '23 bras x 2');
  view = await getCustomerOrder(o.order_number, o.access_token);
  assert.equal(view.totals.final_payable, 720 + 200 - 46);
});

test('category own rate is used; switched off in Settings = not offered', async () => {
  const {
    adminCtx, m, s32, print, place,
  } = await setup();
  const cat = m.cat('print-collection');
  let catalog = await getCatalog({ fresh: true });
  assert.equal(buildQuote({ catalog, items: [{ variant_id: print.box(s32), qty: 1 }] }).packing_choice, false, 'no charge = no option');

  await categoryService.update(cat.category_id, categorySchema.parse({ category_name: cat.category_name, parent_category: cat.parent_category, slug: cat.slug, packing_charge: '3' }), adminCtx);
  catalog = await getCatalog({ fresh: true });
  assert.equal(buildQuote({ catalog, items: [{ variant_id: print.box(s32), qty: 1 }] }).packing_charges, 18, '6 pcs x 3');
  // saving the category without the field keeps the rate
  await categoryService.update(cat.category_id, categorySchema.parse({ category_name: cat.category_name, parent_category: cat.parent_category, slug: cat.slug, description: 'x' }), adminCtx);
  catalog = await getCatalog({ fresh: true });
  assert.equal(catalog.categoriesById.get(cat.category_id).packing_charge, 3);

  await updateSettings({ packing_choice_enabled: false }, adminCtx);
  catalog = await getCatalog({ fresh: true });
  assert.equal(buildQuote({ catalog, items: [{ variant_id: print.box(s32), qty: 1 }] }).packing_choice, false);
  const o = await place([{ variant_id: print.box(s32), qty: 1 }], true);
  assert.equal((await getCustomerOrder(o.order_number, o.access_token)).totals.packing_deduction, 0, 'ignored while switched off');
});

test('the choice can be ticked / unticked while editing the order (customer and admin); a hand-set amount stays', async () => {
  const {
    adminCtx, s32, bra, place,
  } = await setup();
  const created = await place([{ variant_id: bra.box(s32), qty: 2 }]); // 12 bras: packing 24, not chosen at checkout
  let view = await getCustomerOrder(created.order_number, created.access_token);
  assert.equal(view.totals.less_packing, false);
  const fullTotal = view.totals.final_payable;

  // customer edits the order and ticks it
  view = await updateOrderItems(created.order_number, created.access_token, { items: [{ variant_id: bra.box(s32), qty: 2 }], less_packing: true });
  assert.equal(view.totals.less_packing, true);
  assert.equal(view.totals.packing_deduction, 24);
  assert.equal(view.totals.final_payable, fullTotal - 24);

  // not sent = keeps the choice; unticked = taken back
  view = await updateOrderItems(created.order_number, created.access_token, { items: [{ variant_id: bra.box(s32), qty: 1 }] });
  assert.equal(view.totals.packing_deduction, 12, 'still chosen, follows the items');
  view = await updateOrderItems(created.order_number, created.access_token, { items: [{ variant_id: bra.box(s32), qty: 1 }], less_packing: false });
  assert.equal(view.totals.less_packing, false);
  assert.equal(view.totals.packing_deduction, 0);

  // admin "Edit items" ticks it
  const admin = await updateOrderItemsAdmin(created.order_number, adminOrderItemsSchema.parse({ items: [{ variant_id: bra.box(s32), qty: 2 }], less_packing: true }), adminCtx);
  assert.equal(admin.order.less_packing, true);
  assert.equal(admin.totals.packing_deduction, 24);
  const off = await updateOrderItemsAdmin(created.order_number, adminOrderItemsSchema.parse({ items: [{ variant_id: bra.box(s32), qty: 2 }], less_packing: false }), adminCtx);
  assert.equal(off.order.less_packing, false);
  assert.equal(off.totals.packing_deduction, 0);

  // a flat amount the admin set by hand is kept when editing
  await setPackingDeduction(created.order_number, { amount: 50, note: '' }, adminCtx);
  const kept = await updateOrderItemsAdmin(created.order_number, adminOrderItemsSchema.parse({ items: [{ variant_id: bra.box(s32), qty: 3 }] }), adminCtx);
  assert.equal(kept.totals.packing_deduction, 50);
});
