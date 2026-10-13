// "Do you wish to less packing charges?" - the customer can choose at
// checkout to have the packing charges taken off the order.
//
// Rate = ₹ per piece (per set for sets), set per category in Admin >
// Categories. Blank on the category = from its name: Set ₹4, Bra / Panty ₹2,
// anything else ₹0. A box counts its pieces (box of 6 bras = 6 x ₹2).

export const AUTO_PACKING_RATES = Object.freeze({ SET: 4, BRA: 2, PANTY: 2 });

/** Rate from the category name / slug (used when the category has no own rate). */
export function autoPackingRate(category) {
  const name = `${category?.category_name || ''} ${category?.slug || ''}`.toLowerCase();
  if (/\bsets?\b/.test(name)) return AUTO_PACKING_RATES.SET;
  if (/\bbras?\b/.test(name)) return AUTO_PACKING_RATES.BRA;
  if (/\bpant(y|ies)\b|\bbriefs?\b/.test(name)) return AUTO_PACKING_RATES.PANTY;
  return 0;
}

export function packingRateOf(category) {
  const own = category?.packing_charge;
  if (own !== '' && own !== null && own !== undefined && Number.isFinite(Number(own))) return Math.max(0, Number(own));
  return autoPackingRate(category);
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Packing charges of priced quote lines: { amount, breakdown } where
 * breakdown = [{ category_name, rate, pieces, amount }] per category.
 * Each line: { product, pieces } (pieces = qty x pieces per box).
 */
export function packingCharges(catalog, lines) {
  const byCategory = new Map();
  for (const l of lines) {
    const category = l.product ? catalog.categoriesById.get(l.product.category_id) : null;
    const rate = packingRateOf(category);
    const pieces = Number(l.pieces) || 0;
    if (!rate || !pieces) continue;
    const key = `${category?.category_id || ''}|${rate}`;
    if (!byCategory.has(key)) byCategory.set(key, { category_name: category?.category_name || 'Other', rate, pieces: 0, amount: 0 });
    const row = byCategory.get(key);
    row.pieces += pieces;
    row.amount = round2(row.amount + pieces * rate);
  }
  const breakdown = [...byCategory.values()];
  return { amount: round2(breakdown.reduce((s, r) => s + r.amount, 0)), breakdown };
}
