import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStore, createBoxProduct, CUSTOMER, PNG_BYTES } from './helpers/fixtures.js';
import { createDraftOrder, getCustomerOrder } from '../services/orderService.js';
import { submitPayment, listPayments } from '../services/paymentService.js';
import { updateSettings } from '../services/settingsService.js';
import { draftOrderSchema, paymentSubmitSchema } from '../utils/validation.js';

// The payment screenshot is the required proof; the UTR / transaction ID is optional.

let key = 0;
const idem = () => `utr-${Date.now()}-${key += 1}`;
const order = (items) => createDraftOrder(draftOrderSchema.parse({ customer: CUSTOMER, items, idempotency_key: idem() }));

test('payment can be submitted without a UTR; a UTR that is given must still be valid', async () => {
  const { adminCtx } = await freshStore();
  await updateSettings({ minimum_order_value: 0 }, adminCtx);
  const { boxVariant } = await createBoxProduct(adminCtx);
  const items = [{ variant_id: boxVariant.variant_id, qty: 1 }];

  // schema: blank or missing UTR is fine, a malformed one is not
  assert.equal(paymentSubmitSchema.parse({ amount: '100', idempotency_key: idem() }).utr, '');
  assert.equal(paymentSubmitSchema.parse({ amount: '100', utr: '  ', idempotency_key: idem() }).utr, '');
  assert.equal(paymentSubmitSchema.safeParse({ amount: '100', utr: '12', idempotency_key: idem() }).success, false);
  assert.equal(paymentSubmitSchema.safeParse({ amount: '100', utr: 'AB-12!', idempotency_key: idem() }).success, false);

  // two orders paid without a UTR do not clash as "UTR already used"
  for (const o of [await order(items), await order(items)]) {
    const amount = (await getCustomerOrder(o.order_number, o.access_token)).amount_to_pay;
    const fields = paymentSubmitSchema.parse({ amount: String(amount), utr: '', idempotency_key: idem() });
    const view = await submitPayment(o.order_number, o.access_token, fields, { buffer: PNG_BYTES });
    assert.equal(view.order_status, 'PAYMENT_SUBMITTED');
    assert.equal(view.payments[0].utr, '');
  }
  const { items: payments } = await listPayments({});
  assert.equal(payments.length, 2);

  // a real UTR is still checked for reuse
  const third = await order(items);
  const amount = (await getCustomerOrder(third.order_number, third.access_token)).amount_to_pay;
  await submitPayment(third.order_number, third.access_token, paymentSubmitSchema.parse({ amount: String(amount), utr: 'UTR123456789', idempotency_key: idem() }), { buffer: PNG_BYTES });
  const fourth = await order(items);
  await assert.rejects(
    submitPayment(fourth.order_number, fourth.access_token, paymentSubmitSchema.parse({ amount: String(amount), utr: 'utr123456789', idempotency_key: idem() }), { buffer: PNG_BYTES }),
    (err) => err.code === 'UTR_ALREADY_USED',
  );
});
