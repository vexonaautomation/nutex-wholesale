import { RECORD_STATUS, INVENTORY_STATUS } from '../config/constants.js';
import { MESSAGES } from './errors.js';
import { isBoxVariant, variantOffered } from './sellMode.js';

export const ISSUE = Object.freeze({
  UNAVAILABLE: 'UNAVAILABLE',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
});

export const availableOf = (inv) => Math.max(0, (Number(inv?.stock_qty) || 0) - (Number(inv?.reserved_qty) || 0));

/**
 * Authoritative availability of one variant, evaluated on catalog data.
 * Supports all out-of-stock levels:
 *   1. whole product out of stock (product.out_of_stock / inactive)
 *   2. specific color (color master inactive)
 *   3. specific color + size (inventory row = 0 or OUT_OF_STOCK)
 *   4. specific box variant (inventory row = 0 or OUT_OF_STOCK)
 * `heldByThisOrder` = units already reserved by the order being edited, which
 * remain available to that same order.
 */
export function variantAvailability(catalog, variant, held = 0) {
  const unavailable = (message = MESSAGES.PRODUCT_UNAVAILABLE) => ({ purchasable: false, available: 0, code: ISSUE.UNAVAILABLE, message });
  if (!variant) return unavailable();
  const product = catalog.productsById.get(variant.product_id);
  if (!product) return unavailable();
  const category = catalog.categoriesById.get(product.category_id);
  if (product.status !== RECORD_STATUS.ACTIVE || !category || category.status !== RECORD_STATUS.ACTIVE) return unavailable();
  // the variant must be active AND of a kind (box / pieces) the product is sold as
  if (!variantOffered(product, variant)) return unavailable();

  const isBox = isBoxVariant(variant);
  if (!isBox) {
    const color = catalog.colorsById.get(variant.color_id);
    const size = catalog.sizesById.get(variant.size_id);
    if (!color || color.status !== RECORD_STATUS.ACTIVE || !size || size.status !== RECORD_STATUS.ACTIVE) {
      return unavailable(MESSAGES.COMBINATION_OUT_OF_STOCK);
    }
  } else if (variant.size_id) {
    const size = catalog.sizesById.get(variant.size_id);
    if (!size || size.status !== RECORD_STATUS.ACTIVE) return unavailable(MESSAGES.BOX_OUT_OF_STOCK);
  }

  const oosMessage = isBox ? MESSAGES.BOX_OUT_OF_STOCK : MESSAGES.COMBINATION_OUT_OF_STOCK;
  // `held` = pieces this order already reserved: a number for this variant
  // (older callers) or { inventoryVariantId: pieces }
  const heldOf = (vid) => (held && typeof held === 'object'
    ? Math.max(0, Number(held[vid]) || 0)
    : (vid === variant.variant_id ? Math.max(0, Number(held) || 0) : 0));

  // Box without its own box stock -> made from the loose stock of the colours
  if (isBox) {
    const plan = autoBoxPlan(catalog, product, variant);
    if (plan?.ok) {
      let boxes = Infinity;
      for (const part of plan.parts) {
        const inv = catalog.inventoryByVariant.get(part.variant_id);
        const out = product.out_of_stock === true || !inv || inv.status === INVENTORY_STATUS.OUT_OF_STOCK;
        const pieces = (out ? 0 : availableOf(inv)) + heldOf(part.variant_id);
        boxes = Math.min(boxes, Math.floor(pieces / plan.perColour));
      }
      const components = Object.fromEntries(plan.parts.map((p) => [p.variant_id, plan.perColour]));
      if (!(boxes > 0)) {
        return {
          purchasable: false, available: 0, code: ISSUE.OUT_OF_STOCK,
          message: product.out_of_stock ? 'This product is currently out of stock.' : oosMessage, components, auto: true,
        };
      }
      return { purchasable: true, available: boxes, code: null, message: null, components, auto: true };
    }
  }

  const own = heldOf(variant.variant_id);
  const inv = catalog.inventoryByVariant.get(variant.variant_id);
  const flaggedOut = product.out_of_stock === true || !inv || inv.status === INVENTORY_STATUS.OUT_OF_STOCK;
  const available = flaggedOut ? own : availableOf(inv) + own;
  const components = { [variant.variant_id]: 1 };
  if (available <= 0) {
    return {
      purchasable: false,
      available: 0,
      code: ISSUE.OUT_OF_STOCK,
      message: product.out_of_stock ? 'This product is currently out of stock.' : oosMessage,
      components,
      auto: false,
    };
  }
  return { purchasable: true, available, code: null, message: null, components, auto: false };
}

/**
 * Auto box: when NO box stock is entered (box row stock 0, nothing reserved)
 * a box is packed from the loose stock - an equal number of pieces of every
 * active colour of that size (box of 6 with 3 colours = 2 of each). Boxes
 * available = the colour with the least pieces / pieces per colour.
 * Needs pieces-per-box divisible by the number of colours.
 * Returns null when the box has its own stock (pre-packed boxes).
 */
export function autoBoxPlan(catalog, product, variant) {
  if (!isBoxVariant(variant) || !variant.size_id || !product) return null;
  const own = catalog.inventoryByVariant.get(variant.variant_id);
  if ((Number(own?.stock_qty) || 0) > 0 || (Number(own?.reserved_qty) || 0) > 0) return null;
  const units = Number(variant.units_per_box) || 0;
  const parts = (catalog.variantsByProduct.get(product.product_id) || []).filter((v) => !isBoxVariant(v)
    && v.status === RECORD_STATUS.ACTIVE && v.size_id === variant.size_id
    && catalog.colorsById.get(v.color_id)?.status === RECORD_STATUS.ACTIVE);
  if (!parts.length) return { ok: false, reason: 'no loose colours for this size' };
  if (units < parts.length || units % parts.length) {
    return { ok: false, reason: `${units} pcs cannot be split equally into ${parts.length} colours` };
  }
  return { ok: true, perColour: units / parts.length, parts };
}

export function lineIssue(availability, qty) {
  if (!availability.purchasable) return { code: availability.code, message: availability.message, available: 0 };
  if (qty > availability.available) {
    return {
      code: ISSUE.INSUFFICIENT_STOCK,
      message: `Only ${availability.available} available. Please reduce the quantity.`,
      available: availability.available,
    };
  }
  return null;
}

/**
 * Admin view of an auto box: null when the box has its own stock, else
 * { ok, per_colour, colours, boxes, reason } - boxes that can be packed now.
 */
export function autoBoxInfo(catalog, product, variant) {
  const plan = autoBoxPlan(catalog, product, variant);
  if (!plan) return null;
  if (!plan.ok) return { ok: false, per_colour: 0, colours: 0, boxes: 0, reason: plan.reason };
  const av = variantAvailability(catalog, variant);
  return {
    ok: true, per_colour: plan.perColour, colours: plan.parts.length, boxes: av.purchasable ? av.available : 0, reason: null,
  };
}
