// =====================================================================
// PRICE CALCULATOR - the single authority for wholesale pricing.
// Pure function: no I/O, deterministic, unit tested.
// The browser NEVER supplies prices; it only sends variant IDs + quantities.
//
// DISCOUNT MODES
//   FIXED : every line gets settings.default_discount_percent
//   SLAB  : the cart lands in one active slab, whose % applies to every line
//   A product with discount_mode=CUSTOM always uses its own fixed %
//   (product-specific override) in both modes.
//
// SLAB BASIS (settings.discount_slab_basis)
//   MRP_SUBTOTAL                     : sum of MRP x qty                (default)
//   PRE_DISCOUNT_WHOLESALE_SUBTOTAL  : sum of MRP x qty x (1 - base%), where
//        base% = product override, else default_discount_percent. This is the
//        cart value at standard wholesale price BEFORE the slab is applied.
//   FINAL_PAYABLE                    : circular by nature, resolved with a
//        deterministic fixed-point rule: a slab qualifies when the final
//        payable computed WITH THAT SLAB'S OWN % is >= its min_amount.
//        The qualifying slab with the highest % wins (ties: lower priority
//        number). max_amount is not used for qualification in this basis.
//
// SLAB RANGES are whole rupees, inclusive: "0-4999" means 0 <= x < 5000,
// so fractional basis amounts (e.g. 4999.50) never fall into a gap.
//
// MINIMUM ORDER is independent of slabs and is always checked against the
// FINAL payable value: final_payable >= minimum_order_value.
// =====================================================================

import { DISCOUNT_MODE, SLAB_BASIS } from '../config/constants.js';
import { toPaise, fromPaise, clampPercent, formatINR, round2 } from '../utils/money.js';
import { istDate } from '../utils/dates.js';

const pctLabel = (p) => `${Number(round2(p))}%`;

export function normalizeSlab(s) {
  const max = s.max_amount;
  return {
    slab_id: s.slab_id,
    label: s.label || '',
    min_amount: Math.max(0, Number(s.min_amount) || 0),
    max_amount: max === null || max === undefined || max === '' ? null : Number(max),
    discount_percent: clampPercent(s.discount_percent),
    priority: Number.isFinite(Number(s.priority)) && s.priority !== null && s.priority !== '' ? Number(s.priority) : 1,
    active: s.active === true,
    deleted: s.deleted === true,
    start_date: s.start_date || '',
    end_date: s.end_date || '',
  };
}

export function isSlabLive(slab, today = istDate()) {
  return slab.active === true && slab.deleted !== true
    && (!slab.start_date || slab.start_date <= today)
    && (!slab.end_date || slab.end_date >= today);
}

export function getActiveSlabs(slabs, today = istDate()) {
  return (slabs || [])
    .map(normalizeSlab)
    .filter((s) => isSlabLive(s, today))
    .sort((a, b) => a.min_amount - b.min_amount || a.priority - b.priority);
}

// Whole-rupee inclusive range -> half-open interval in paise
export function slabContains(slab, amountPaise) {
  return amountPaise >= toPaise(slab.min_amount)
    && (slab.max_amount === null || amountPaise < toPaise(slab.max_amount + 1));
}

export function pickSlab(activeSlabs, amountPaise) {
  const matches = activeSlabs.filter((s) => slabContains(s, amountPaise));
  matches.sort((a, b) => a.priority - b.priority || b.discount_percent - a.discount_percent);
  return matches[0] || null;
}

const slabView = (s) => (s ? {
  slab_id: s.slab_id,
  label: s.label,
  min_amount: s.min_amount,
  max_amount: s.max_amount,
  discount_percent: s.discount_percent,
} : null);

/**
 * @param {object} input
 * @param {Array<{key:string, qty:number, unit_mrp:number, override_percent?:number|null, units_per_item?:number}>} input.lines
 * @param {object} input.settings  discount_mode, default_discount_percent, discount_slab_basis, minimum_order_value
 * @param {Array} input.slabs      Discount_Slabs rows
 * @param {string} [input.today]   'YYYY-MM-DD' (IST) for slab date windows
 */
export function calculatePricing({ lines = [], settings = {}, slabs = [], today = istDate() }) {
  const mode = settings.discount_mode === DISCOUNT_MODE.SLAB ? DISCOUNT_MODE.SLAB : DISCOUNT_MODE.FIXED;
  const defaultPct = clampPercent(settings.default_discount_percent ?? 0);
  const basis = Object.values(SLAB_BASIS).includes(settings.discount_slab_basis)
    ? settings.discount_slab_basis
    : SLAB_BASIS.MRP_SUBTOTAL;
  const minimum = Math.max(0, Number(settings.minimum_order_value) || 0);

  const prepared = lines
    .filter((l) => Math.floor(Number(l.qty)) > 0)
    .map((l) => ({
      key: l.key,
      qty: Math.floor(Number(l.qty)),
      mrpP: toPaise(l.unit_mrp),
      override: l.override_percent === null || l.override_percent === undefined || l.override_percent === ''
        ? null
        : clampPercent(l.override_percent),
      pieces: Math.max(1, Math.floor(Number(l.units_per_item) || 1)),
    }));

  const priceAt = (globalPct) => prepared.map((l) => {
    const pct = l.override ?? globalPct;
    const unitP = Math.round((l.mrpP * (100 - pct)) / 100);
    return { ...l, pct, unitP, lineMrpP: l.mrpP * l.qty, lineP: unitP * l.qty };
  });
  const totalOf = (priced) => priced.reduce((sum, l) => sum + l.lineP, 0);
  const grossP = prepared.reduce((sum, l) => sum + l.mrpP * l.qty, 0);

  let globalPct = defaultPct;
  let current = null;
  let next = null;
  let basisP = grossP;
  let toNextP = 0;
  let mrpToNextP = 0;
  let active = [];

  if (mode === DISCOUNT_MODE.SLAB) {
    active = getActiveSlabs(slabs, today);
    if (basis === SLAB_BASIS.FINAL_PAYABLE) {
      const candidates = [...active].sort((a, b) => b.discount_percent - a.discount_percent || a.priority - b.priority);
      for (const s of candidates) {
        if (prepared.length && totalOf(priceAt(s.discount_percent)) >= toPaise(s.min_amount)) {
          current = s;
          break;
        }
      }
      globalPct = current ? current.discount_percent : 0;
      basisP = totalOf(priceAt(globalPct));
      const upgrades = active.filter((s) => s.discount_percent > globalPct).sort((a, b) => a.min_amount - b.min_amount);
      for (const s of upgrades) {
        const need = toPaise(s.min_amount) - totalOf(priceAt(s.discount_percent));
        if (need > 0) {
          next = s;
          toNextP = need;
          mrpToNextP = s.discount_percent < 100 ? Math.ceil((need * 100) / (100 - s.discount_percent)) : need;
          break;
        }
      }
    } else {
      basisP = basis === SLAB_BASIS.MRP_SUBTOTAL
        ? grossP
        : prepared.reduce((sum, l) => sum + Math.round((l.mrpP * l.qty * (100 - (l.override ?? defaultPct))) / 100), 0);
      current = prepared.length ? pickSlab(active, basisP) : null;
      globalPct = current ? current.discount_percent : 0;
      next = active
        .filter((s) => toPaise(s.min_amount) > basisP && s.discount_percent > globalPct)
        .sort((a, b) => a.min_amount - b.min_amount)[0] || null;
      if (next) {
        toNextP = toPaise(next.min_amount) - basisP;
        mrpToNextP = basis === SLAB_BASIS.MRP_SUBTOTAL || defaultPct >= 100
          ? toNextP
          : Math.ceil((toNextP * 100) / (100 - defaultPct));
      }
    }
  }

  const priced = priceAt(globalPct);
  const finalP = totalOf(priced);
  const discountP = grossP - finalP;
  const minP = toPaise(minimum);
  const sourceFor = (l) => (l.override !== null ? 'PRODUCT' : mode === DISCOUNT_MODE.SLAB ? 'SLAB' : 'FIXED');

  return {
    discount_mode: mode,
    discount_basis: basis,
    lines: priced.map((l) => ({
      key: l.key,
      qty: l.qty,
      pieces: l.qty * l.pieces,
      unit_mrp: fromPaise(l.mrpP),
      discount_percent: l.pct,
      unit_price: fromPaise(l.unitP),
      line_mrp: fromPaise(l.lineMrpP),
      line_total: fromPaise(l.lineP),
      line_discount: fromPaise(l.lineMrpP - l.lineP),
      discount_source: sourceFor(l),
    })),
    total_qty: priced.reduce((s, l) => s + l.qty, 0),
    total_pieces: priced.reduce((s, l) => s + l.qty * l.pieces, 0),
    gross_mrp_subtotal: fromPaise(grossP),
    discount_basis_amount: fromPaise(basisP),
    discount_percent: globalPct,
    effective_discount_percent: grossP ? round2((discountP / grossP) * 100) : 0,
    discount_amount: fromPaise(discountP),
    final_payable: fromPaise(finalP),
    minimum_order_value: minimum,
    minimum_order_met: prepared.length > 0 && finalP >= minP,
    amount_to_minimum: fromPaise(Math.max(0, minP - finalP)),
    current_slab: slabView(current),
    next_slab: slabView(next),
    amount_to_next_slab: fromPaise(toNextP),
    mrp_to_next_slab: fromPaise(mrpToNextP),
    slabs: active.map(slabView),
  };
}

// Dynamically generated customer messages (never hard-coded amounts).
export function buildPricingMessages(q) {
  const messages = [];
  const hasItems = q.total_qty > 0;
  const slabMode = q.discount_mode === DISCOUNT_MODE.SLAB;
  const minFailed = hasItems && !q.minimum_order_met;

  if (slabMode && hasItems) {
    if (q.current_slab && !minFailed) {
      messages.push({ type: 'success', code: 'SLAB_REACHED', text: `You have reached the ${pctLabel(q.current_slab.discount_percent)} discount slab.` });
    } else if (!q.current_slab && q.slabs.length) {
      messages.push({ type: 'info', code: 'NO_SLAB', text: 'Your cart has not reached a discount slab yet.' });
    }
    if (q.next_slab) {
      messages.push({
        type: 'info',
        code: 'NEXT_SLAB',
        text: `Add products worth ${formatINR(q.mrp_to_next_slab)} (MRP) more to unlock ${pctLabel(q.next_slab.discount_percent)} discount.`,
      });
    }
  }
  if (minFailed) {
    const text = slabMode && q.current_slab
      ? `You have reached the ${pctLabel(q.current_slab.discount_percent)} discount slab, but your final payable wholesale value is below the minimum order requirement of ${formatINR(q.minimum_order_value)}.`
      : `Your final payable wholesale value of ${formatINR(q.final_payable)} is below the minimum order requirement of ${formatINR(q.minimum_order_value)}.`;
    messages.push({ type: 'warning', code: 'MIN_ORDER_NOT_MET', text });
    messages.push({ type: 'warning', code: 'AMOUNT_TO_MINIMUM', text: `Add ${formatINR(q.amount_to_minimum)} more to continue.` });
  }
  return messages;
}

// Indicative unit price for product cards (display only - never trusted).
export function displayDiscountPercent(product, settings, slabs, today = istDate()) {
  if (product.discount_mode === 'CUSTOM' && product.fixed_discount_percent !== null) {
    return clampPercent(product.fixed_discount_percent);
  }
  if (settings.discount_mode !== DISCOUNT_MODE.SLAB) return clampPercent(settings.default_discount_percent);
  const active = getActiveSlabs(slabs, today);
  const entry = pickSlab(active, 0) || active[0];
  return entry ? entry.discount_percent : 0;
}
