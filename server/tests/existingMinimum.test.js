import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStore, createColorProduct, CUSTOMER } from './helpers/fixtures.js';
import { addExistingCustomers, issueCustomerToken } from '../services/existingCustomerService.js';
import { createDraftOrder } from '../services/orderService.js';
import { buildQuote } from '../services/quoteService.js';
import { getCatalog } from '../services/catalogService.js';
import { getSettings } from '../services/settingsService.js';
import { draftOrderSchema } from '../utils/validation.js';

// Owner's decision (migration v21): verified existing customers have a minimum
// order of Rs 1,000; a customer's own minimum still wins; new customers keep
// the normal minimum.

let n = 0;
const key = () => `existing-min-${Date.now()}-${(n += 1)}`;
const code = (c) => (err) => { assert.equal(err.code, c); return true; };

test('existing customers: minimum Rs 1,000 after deploy; own minimum wins; new customers unchanged', async () => {
  const { adminCtx } = await freshStore({ existingMinimum: null });
  assert.equal(Number((await getSettings({ fresh: true })).existing_customer_minimum_order_value), 1000, 'set by migration v21');
  const { variant } = await createColorProduct(adminCtx); // MRP 500, 60% off = 200 a piece
  const v = variant('Black', '32').variant_id;
  await addExistingCustomers([{ mobile: CUSTOMER.mobile }, { mobile: '9123456780', minimum_order_value: 0 }], adminCtx);
  const order = (items, mobile = CUSTOMER.mobile) => createDraftOrder(
    draftOrderSchema.parse({ customer: { ...CUSTOMER, mobile, whatsapp: '' }, items, idempotency_key: key() }),
    { customerToken: issueCustomerToken(mobile).token },
  );

  await assert.rejects(order([{ variant_id: v, qty: 1 }]), code('MIN_ORDER_NOT_MET'), 'Rs 200 < Rs 1,000');
  const ok = await order([{ variant_id: v, qty: 5 }]);
  assert.ok(ok.order_number, 'Rs 1,000 is enough');

  const own = await order([{ variant_id: v, qty: 1 }], '9123456780');
  assert.ok(own.order_number, 'own minimum 0 wins');

  const catalog = await getCatalog({ fresh: true });
  const quote = buildQuote({ items: [{ variant_id: v, qty: 1 }], catalog, customer: { existing: true, minimum_order_value: 1000 } });
  assert.ok(quote.messages.some((m) => /your minimum order is ₹1,000/.test(m.text)));
  const fresh = buildQuote({ items: [{ variant_id: v, qty: 1 }], catalog });
  assert.equal(fresh.minimum_order_value, 10000, 'new customers: normal minimum');
});
