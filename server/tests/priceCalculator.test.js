import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePricing, buildPricingMessages, getActiveSlabs } from '../services/priceCalculator.js';
import { findOverlaps } from '../services/discountService.js';

const FIXED = { discount_mode: 'FIXED', default_discount_percent: 60, minimum_order_value: 10000, discount_slab_basis: 'MRP_SUBTOTAL' };
const line = (mrpTotal, extra = {}) => ({ key: 'a', qty: 1, unit_mrp: mrpTotal, ...extra });
const slab = (id, min, max, pct, extra = {}) => ({ slab_id: id, min_amount: min, max_amount: max, discount_percent: pct, priority: 1, active: true, deleted: false, ...extra });
const SLABS = [slab('S1', 0, 4999, 40), slab('S2', 5000, 9999, 50), slab('S3', 10000, 19999, 55), slab('S4', 20000, null, 60)];
const SLAB = { ...FIXED, discount_mode: 'SLAB' };

test('fixed 60%: MRP 500 -> wholesale 200', () => {
  const q = calculatePricing({ lines: [{ key: 'x', qty: 1, unit_mrp: 500 }], settings: FIXED });
  assert.equal(q.lines[0].unit_price, 200);
  assert.equal(q.discount_percent, 60);
});

test('minimum order: exactly 10,000 final payable is allowed (MRP 25,000 @60%)', () => {
  const q = calculatePricing({ lines: [line(25000)], settings: FIXED });
  assert.equal(q.final_payable, 10000);
  assert.equal(q.minimum_order_met, true);
  assert.equal(q.amount_to_minimum, 0);
});

test('minimum order: 9,600 final payable is blocked and shows 400 remaining', () => {
  const q = calculatePricing({ lines: [line(24000)], settings: FIXED });
  assert.equal(q.final_payable, 9600);
  assert.equal(q.minimum_order_met, false);
  assert.equal(q.amount_to_minimum, 400);
  const msgs = buildPricingMessages(q).map((m) => m.text).join(' ');
  assert.match(msgs, /₹9,600/);
  assert.match(msgs, /₹10,000/);
  assert.match(msgs, /Add ₹400 more to continue/);
});

test('minimum order above threshold is allowed', () => {
  const q = calculatePricing({ lines: [line(30000)], settings: FIXED });
  assert.equal(q.final_payable, 12000);
  assert.equal(q.minimum_order_met, true);
});

test('minimum order value is configurable (not hard-coded)', () => {
  const q = calculatePricing({ lines: [line(15000)], settings: { ...FIXED, minimum_order_value: 5000 } });
  assert.equal(q.final_payable, 6000);
  assert.equal(q.minimum_order_met, true);
});

test('changing the fixed discount changes prices', () => {
  const q = calculatePricing({ lines: [{ key: 'x', qty: 2, unit_mrp: 500 }], settings: { ...FIXED, default_discount_percent: 45 } });
  assert.equal(q.lines[0].unit_price, 275);
  assert.equal(q.final_payable, 550);
});

test('slab mode: slab reached but minimum not met (spec example MRP 15,000 -> 55% -> 6,750)', () => {
  const q = calculatePricing({ lines: [line(15000)], settings: SLAB, slabs: SLABS });
  assert.equal(q.current_slab.slab_id, 'S3');
  assert.equal(q.discount_percent, 55);
  assert.equal(q.final_payable, 6750);
  assert.equal(q.minimum_order_met, false);
  assert.equal(q.amount_to_minimum, 3250);
  const text = buildPricingMessages(q).map((m) => m.text);
  assert.ok(text.includes('You have reached the 55% discount slab, but your final payable wholesale value is below the minimum order requirement of ₹10,000.'));
  assert.ok(text.includes('Add ₹3,250 more to continue.'));
});

test('slab mode: next slab + amount to next slab (MRP basis 7,800 -> 50%, 2,200 to 55%)', () => {
  const q = calculatePricing({ lines: [line(7800)], settings: SLAB, slabs: SLABS });
  assert.equal(q.discount_percent, 50);
  assert.equal(q.next_slab.slab_id, 'S3');
  assert.equal(q.amount_to_next_slab, 2200);
  assert.equal(q.mrp_to_next_slab, 2200);
});

test('slab boundaries are whole-rupee inclusive and leave no gaps for paise', () => {
  assert.equal(calculatePricing({ lines: [line(4999.5)], settings: SLAB, slabs: SLABS }).discount_percent, 40);
  assert.equal(calculatePricing({ lines: [line(5000)], settings: SLAB, slabs: SLABS }).discount_percent, 50);
  assert.equal(calculatePricing({ lines: [line(9999.99)], settings: SLAB, slabs: SLABS }).discount_percent, 50);
  assert.equal(calculatePricing({ lines: [line(1000000)], settings: SLAB, slabs: SLABS }).discount_percent, 60);
});

test('unlimited / custom slabs (two-tier configuration)', () => {
  const two = [slab('A', 0, 9999, 40), slab('B', 10000, null, 60)];
  assert.equal(calculatePricing({ lines: [line(9000)], settings: SLAB, slabs: two }).discount_percent, 40);
  assert.equal(calculatePricing({ lines: [line(30000)], settings: SLAB, slabs: two }).discount_percent, 60);
});

test('inactive, deleted and out-of-date slabs are ignored', () => {
  const slabs = [slab('A', 0, null, 40), slab('B', 0, null, 70, { active: false }), slab('C', 0, null, 80, { deleted: true }),
    slab('D', 0, null, 90, { start_date: '2099-01-01' })];
  assert.equal(getActiveSlabs(slabs, '2026-10-03').length, 1);
  assert.equal(calculatePricing({ lines: [line(1000)], settings: SLAB, slabs, today: '2026-10-03' }).discount_percent, 40);
});

test('PRE_DISCOUNT_WHOLESALE_SUBTOTAL basis uses MRP x (1 - default%)', () => {
  const settings = { ...SLAB, discount_slab_basis: 'PRE_DISCOUNT_WHOLESALE_SUBTOTAL' };
  // MRP 30,000 @ default 60% = 12,000 basis -> S3 (55%)
  const q = calculatePricing({ lines: [line(30000)], settings, slabs: SLABS });
  assert.equal(q.discount_basis_amount, 12000);
  assert.equal(q.discount_percent, 55);
  assert.equal(q.final_payable, 13500);
});

test('FINAL_PAYABLE basis resolves deterministically (no circular pricing)', () => {
  const settings = { ...SLAB, discount_slab_basis: 'FINAL_PAYABLE' };
  // MRP 25,000: at 60% final = 10,000 < 20,000 (S4 min) -> no; at 55% = 11,250 >= 10,000 -> S3
  const q = calculatePricing({ lines: [line(25000)], settings, slabs: SLABS });
  assert.equal(q.discount_percent, 55);
  assert.equal(q.final_payable, 11250);
  assert.equal(q.discount_basis_amount, 11250);
  // repeatable
  assert.deepEqual(calculatePricing({ lines: [line(25000)], settings, slabs: SLABS }), q);
  // MRP 50,000 @60% = 20,000 >= 20,000 -> S4
  assert.equal(calculatePricing({ lines: [line(50000)], settings, slabs: SLABS }).discount_percent, 60);
});

test('product-specific discount override wins over global discount', () => {
  const q = calculatePricing({
    lines: [{ key: 'a', qty: 1, unit_mrp: 1000 }, { key: 'b', qty: 1, unit_mrp: 1000, override_percent: 30 }],
    settings: FIXED,
  });
  assert.equal(q.lines[0].unit_price, 400);
  assert.equal(q.lines[1].unit_price, 700);
  assert.equal(q.lines[1].discount_source, 'PRODUCT');
  assert.equal(q.final_payable, 1100);
});

test('paise rounding: unit price x qty always equals line total', () => {
  const q = calculatePricing({ lines: [{ key: 'a', qty: 7, unit_mrp: 499 }], settings: { ...FIXED, default_discount_percent: 55.5 } });
  const l = q.lines[0];
  assert.equal(Math.round(l.unit_price * 100) * 7, Math.round(l.line_total * 100));
});

test('box items count pieces = boxes x units per box', () => {
  const q = calculatePricing({ lines: [{ key: 'b', qty: 3, unit_mrp: 2400, units_per_item: 12 }], settings: FIXED });
  assert.equal(q.total_qty, 3);
  assert.equal(q.total_pieces, 36);
});

test('empty cart never meets the minimum', () => {
  const q = calculatePricing({ lines: [], settings: { ...FIXED, minimum_order_value: 0 } });
  assert.equal(q.minimum_order_met, false);
});

test('slab overlap validation', () => {
  const others = [slab('A', 0, 5000, 40)];
  assert.equal(findOverlaps(slab('B', 4000, 8000, 50), others).length, 1, '0-5000 vs 4000-8000 overlap');
  assert.equal(findOverlaps(slab('B', 5001, 8000, 50), others).length, 0);
  assert.equal(findOverlaps(slab('B', 5000, 8000, 50), others).length, 1, 'shared boundary 5000 overlaps');
  assert.equal(findOverlaps(slab('B', 0, 100, 50, { active: false }), others).length, 0, 'inactive slab never conflicts');
  const dated = [slab('A', 0, null, 40, { start_date: '2026-01-01', end_date: '2026-06-30' })];
  assert.equal(findOverlaps(slab('B', 0, null, 50, { start_date: '2026-07-01' }), dated).length, 0, 'non-overlapping dates are fine');
});
