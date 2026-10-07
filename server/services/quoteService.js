import { calculatePricing, buildPricingMessages } from './priceCalculator.js';
import {
  variantAvailability, lineIssue, availableOf, ISSUE,
} from '../utils/stockValidator.js';
import { INVENTORY_STATUS } from '../config/constants.js';
import {
  isBoxVariant, variantOffered, pcsAllowedFor, PCS_EXISTING_ONLY_MESSAGE,
} from '../utils/sellMode.js';
import { unitMrpForVariant, productOverridePercent, productImages } from './catalogService.js';

function mergeItems(items) {
  const merged = new Map();
  for (const it of items || []) {
    if (!it?.variant_id) continue;
    const qty = Math.floor(Number(it.qty) || 0);
    if (qty <= 0) continue;
    merged.set(it.variant_id, (merged.get(it.variant_id) || 0) + qty);
  }
  return merged;
}

export function describeVariant(catalog, product, variant) {
  const isBox = variant ? isBoxVariant(variant) : product?.inventory_mode === 'BOX_WISE';
  const size = variant?.size_id ? catalog.sizesById.get(variant.size_id) : null;
  const color = variant?.color_id ? catalog.colorsById.get(variant.color_id) : null;
  const category = product ? catalog.categoriesById.get(product.category_id) : null;
  const units = isBox ? Number(variant?.units_per_box) || 1 : 1;
  return {
    product_name: product?.product_name || 'Unavailable product',
    product_slug: product?.slug || '',
    product_sku: product?.sku || '',
    sku: variant?.sku || product?.sku || '',
    category_name: category?.category_name || '',
    inventory_mode: variant?.inventory_mode || product?.inventory_mode || '',
    size_id: variant?.size_id || '',
    size_name: size?.size_name || '',
    color_id: variant?.color_id || '',
    color_name: color?.color_name || '',
    hex_code: color?.hex_code || '',
    box_id: isBox ? variant?.box_id || '' : '',
    units_per_box: isBox ? units : null,
    mixed_color_description: isBox ? variant?.mixed_color_description || '' : '',
    box_label: isBox ? `Mix Color Box of ${units} pcs${size ? ` (Size ${size.size_name})` : ''}` : '',
    image: product ? productImages(catalog, product)[0]?.url || '' : '',
  };
}

function variantOptions(catalog, product, heldByOrder, customer) {
  const pcsAllowed = pcsAllowedFor(customer, catalog.settings, product);
  return (catalog.variantsByProduct.get(product.product_id) || [])
    .filter((v) => variantOffered(product, v) && (pcsAllowed || isBoxVariant(v)))
    .map((v) => {
      const av = variantAvailability(catalog, v, heldByOrder);
      const d = describeVariant(catalog, product, v);
      return {
        variant_id: v.variant_id,
        inventory_mode: v.inventory_mode,
        color_id: d.color_id,
        color_name: d.color_name,
        hex_code: d.hex_code,
        size_id: d.size_id,
        size_name: d.size_name,
        box_label: d.box_label,
        available: av.available,
        purchasable: av.purchasable,
      };
    })
    .filter((o) => o.purchasable || o.color_name || o.box_label);
}

/**
 * Builds an authoritative quote for a cart / order:
 * re-validates every line against current stock, then prices all valid
 * lines with the price calculator.
 *
 * @param {object} p
 * @param {Array<{variant_id, qty}>} p.items
 * @param {object} p.catalog             buildCatalog() result (fresh for checkout)
 * @param {object} [p.heldByOrder]       inventory variant_id -> pieces already reserved by the order being edited
 * @param {object} [p.customer]          { existing, minimum_order_value } for a verified existing customer
 */
export function buildQuote({ items, catalog, heldByOrder = {}, today, customer = null }) {
  const existing = customer?.existing === true;
  const pcsAllowed = pcsAllowedFor(customer, catalog.settings);
  // Existing customers get their own (usually zero) minimum. Discounts are unchanged.
  const settings = existing
    ? { ...catalog.settings, minimum_order_value: Number(customer.minimum_order_value) || 0 }
    : catalog.settings;
  const merged = mergeItems(items);
  const resolved = [];
  for (const [variantId, qty] of merged) {
    const variant = catalog.variantsById.get(variantId) || null;
    const product = variant ? catalog.productsById.get(variant.product_id) || null : null;
    const availability = variantAvailability(catalog, variant, heldByOrder);
    // new customers: full boxes, loose pieces only where the product allows them
    const issue = variant && !isBoxVariant(variant) && !pcsAllowedFor(customer, catalog.settings, product) && availability.purchasable
      ? { code: 'PCS_EXISTING_ONLY', message: PCS_EXISTING_ONLY_MESSAGE, available: 0 }
      : lineIssue(availability, qty);
    resolved.push({
      key: variantId,
      variant_id: variantId,
      product_id: product?.product_id || variant?.product_id || '',
      qty,
      product,
      variant,
      available: availability.available,
      issue,
      unit_mrp: product && variant ? unitMrpForVariant(product, variant) : 0,
      override_percent: product ? productOverridePercent(product) : null,
      units_per_item: isBoxVariant(variant) ? Number(variant?.units_per_box) || 1 : 1,
      // pieces taken from each inventory row per unit (auto boxes use the colours' loose stock)
      stock_components: availability.components || { [variantId]: 1 },
    });
  }

  // Boxes made from loose stock and loose pieces of the same colours share
  // one stock: check what the whole cart needs per inventory row together.
  const need = {};
  for (const l of resolved.filter((x) => !x.issue)) {
    for (const [v, per] of Object.entries(l.stock_components)) need[v] = (need[v] || 0) + l.qty * per;
  }
  const short = new Set(Object.entries(need).filter(([v, n]) => {
    const inv = catalog.inventoryByVariant.get(v);
    const supply = (inv && inv.status !== INVENTORY_STATUS.OUT_OF_STOCK ? availableOf(inv) : 0) + (Number(heldByOrder[v]) || 0);
    return n > supply;
  }).map(([v]) => v));
  if (short.size) {
    for (const l of resolved) {
      if (!l.issue && Object.keys(l.stock_components).some((v) => short.has(v))) {
        l.issue = { code: ISSUE.INSUFFICIENT_STOCK, message: 'Not enough stock for these boxes and loose pieces together. Please reduce the quantity.', available: l.available };
      }
    }
  }

  const valid = resolved.filter((l) => !l.issue);
  const pricing = calculatePricing({
    lines: valid.map(({ key, qty, unit_mrp, override_percent, units_per_item }) => ({ key, qty, unit_mrp, override_percent, units_per_item })),
    settings,
    slabs: catalog.slabs,
    today,
  });
  const priceByKey = new Map(pricing.lines.map((l) => [l.key, l]));

  const lines = resolved.map((l) => {
    const price = priceByKey.get(l.key);
    return {
      key: l.key,
      variant_id: l.variant_id,
      product_id: l.product_id,
      qty: l.qty,
      stock_components: l.stock_components,
      ...describeVariant(catalog, l.product, l.variant),
      available: l.available,
      issue: l.issue,
      unit_mrp: l.unit_mrp,
      discount_percent: price?.discount_percent ?? null,
      discount_source: price?.discount_source ?? null,
      unit_price: price?.unit_price ?? null,
      line_mrp: price?.line_mrp ?? null,
      line_total: price?.line_total ?? null,
      line_discount: price?.line_discount ?? null,
      pieces: price?.pieces ?? l.qty * l.units_per_item,
    };
  });

  const variant_options = {};
  for (const l of resolved) {
    if (l.product && !variant_options[l.product.product_id]) {
      variant_options[l.product.product_id] = variantOptions(catalog, l.product, heldByOrder, customer);
    }
  }

  const hasIssues = resolved.some((l) => l.issue);
  const messages = buildPricingMessages(pricing);
  if (hasIssues) {
    messages.unshift({ type: 'error', code: 'STOCK_ISSUES', text: 'Some items are unavailable or exceed available stock. Please review the highlighted items.' });
  }
  if (resolved.some((l) => l.issue?.code === 'PCS_EXISTING_ONLY')) {
    messages.unshift({ type: 'warning', code: 'PCS_EXISTING_ONLY', text: PCS_EXISTING_ONLY_MESSAGE });
  }
  const waived = existing && pricing.minimum_order_value === 0;
  if (existing && valid.length) {
    messages.push({
      type: 'success',
      code: 'EXISTING_CUSTOMER',
      text: waived ? 'Existing customer verified - no minimum order value applies to you.' : 'Existing customer verified - your special minimum order value applies.',
    });
  }
  const { lines: _priced, ...totals } = pricing;
  return {
    ...totals,
    lines,
    variant_options,
    customer_type: existing ? 'EXISTING' : 'NEW',
    pcs_allowed: pcsAllowed,
    minimum_order_waived: waived,
    standard_minimum_order_value: Number(catalog.settings.minimum_order_value) || 0,
    has_issues: hasIssues,
    can_checkout: valid.length > 0 && !hasIssues && pricing.minimum_order_met,
    messages,
  };
}
