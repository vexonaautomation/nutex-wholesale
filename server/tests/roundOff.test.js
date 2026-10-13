import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStore, createColorProduct, CUSTOMER } from './helpers/fixtures.js';
import {
  createDraftOrder, getCustomerOrder, getOrderAdmin, updateOrderItems, setPackingDeduction, previewOrderItemsAdmin,
} from '../services/orderService.js';
import { adminBill } from '../services/billService.js';
import { updateSettings } from '../services/settingsService.js';
import { roundRupee } from '../utils/money.js';
import { sheetsService } from '../services/sheetsService.js';
import { draftOrderSchema, packingDeductionSchema } from '../utils/validation.js';

// The amount to pay is a round figure (nearest rupee); the difference is
// shown as "Round off". Prices, discounts and the minimum stay exact.

let n = 0;
const idem = () => `round-${Date.now()}-${(n += 1)}`;

test('roundRupee: nearest rupee', () => {
  assert.equal(roundRupee(11620.8), 11621);
  assert.equal(roundRupee(11620.4), 11620);
  assert.equal(roundRupee(50.5), 51);
  assert.equal(roundRupee(0), 0);
});

test('order total is a round figure; round off shown in totals and on the bill', async () => {
  const { adminCtx } = await freshStore();
  await updateSettings({ minimum_order_value: 0 }, adminCtx);
  const { variant } = await createColorProduct(adminCtx, { mrp: 63.25 });
  const black32 = variant('Black', '32').variant_id;
  // 2 x 63.25 x 40% = 50.60 -> 51
  const o = await createDraftOrder(draftOrderSchema.parse({ customer: CUSTOMER, items: [{ variant_id: black32, qty: 2 }], idempotency_key: idem() }));
  let view = await getCustomerOrder(o.order_number, o.access_token);
  assert.equal(view.totals.final_payable, 51);
  assert.equal(view.totals.round_off, 0.4);
  assert.equal(view.amount_to_pay, 51, 'the customer pays the round figure');

  const { bill } = await adminBill(o.order_number);
  assert.equal(bill.subtotal, 50.6);
  assert.equal(bill.round_off, 0.4);
  assert.equal(bill.grand_total, 51);

  // customer edit: 3 x 63.25 x 40% = 75.90 -> 76
  view = await updateOrderItems(o.order_number, o.access_token, { items: [{ variant_id: black32, qty: 3 }] });
  assert.equal(view.totals.final_payable, 76);
  assert.equal(view.totals.round_off, 0.1);

  // packing charges 10.30: 75.90 - 10.30 = 65.60 -> 66
  let admin = await setPackingDeduction(o.order_number, packingDeductionSchema.parse({ amount: 10.3 }), adminCtx);
  assert.equal(admin.totals.final_payable, 66);
  assert.equal(admin.totals.round_off, 0.4);
  // changed again - worked out from the exact total, not the rounded one
  admin = await setPackingDeduction(o.order_number, packingDeductionSchema.parse({ amount: 0.7 }), adminCtx);
  assert.equal(admin.totals.final_payable, 75, '75.90 - 0.70 = 75.20 -> 75');
  assert.equal(admin.totals.round_off, -0.2);

  const preview = await previewOrderItemsAdmin(o.order_number, { items: [{ variant_id: black32, qty: 5 }] });
  assert.equal(preview.new_final_payable, 126, '5 x 25.30 = 126.50 - 0.70 = 125.80 -> 126');

  // an order saved before rounding (paise total) keeps its amount, no round off line
  await sheetsService.commit([{ op: 'update', sheet: 'Orders', id: admin.order.order_id, patch: { final_payable: 75.2 } }]);
  const old = await getOrderAdmin(o.order_number);
  assert.equal(old.totals.final_payable, 75.2);
  assert.equal(old.totals.round_off, 0);
});
