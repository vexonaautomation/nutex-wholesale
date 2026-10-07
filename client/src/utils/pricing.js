// DISPLAY ONLY. The server (priceCalculator) is the only authority on prices;
// these helpers just decide what to show on product cards/pages.

export function displayDiscountPercent(product, settings, cartQuote) {
  if (!product || !settings) return 0;
  if (product.discount?.mode === 'CUSTOM' && product.discount.percent !== null) return product.discount.percent;
  if (settings.discount_mode === 'SLAB') {
    if (cartQuote && cartQuote.total_qty > 0 && cartQuote.current_slab) return cartQuote.discount_percent;
    return product.discount?.display_percent ?? 0;
  }
  return Number(settings.default_discount_percent) || 0;
}

export function wholesaleOf(mrp, percent) {
  return Math.round(Number(mrp) * (100 - Number(percent))) / 100;
}

export function maxSlabPercent(slabs = []) {
  return slabs.reduce((m, s) => Math.max(m, Number(s.discount_percent) || 0), 0);
}

export function discountHeadline(settings, slabs) {
  if (!settings) return '';
  if (settings.discount_mode === 'SLAB') {
    const max = maxSlabPercent(slabs);
    return max ? `Up to ${max}% off MRP with slab pricing` : 'Slab-based wholesale pricing';
  }
  return `${settings.default_discount_percent}% off MRP on wholesale orders`;
}
