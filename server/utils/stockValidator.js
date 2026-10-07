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
export function variantAvailability(catalog, variant, heldByThisOrder = 0) {
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
  const held = Math.max(0, Number(heldByThisOrder) || 0);
  const inv = catalog.inventoryByVariant.get(variant.variant_id);
  const flaggedOut = product.out_of_stock === true || !inv || inv.status === INVENTORY_STATUS.OUT_OF_STOCK;
  const available = flaggedOut ? held : availableOf(inv) + held;
  if (available <= 0) {
    return {
      purchasable: false,
      available: 0,
      code: ISSUE.OUT_OF_STOCK,
      message: product.out_of_stock ? 'This product is currently out of stock.' : oosMessage,
    };
  }
  return { purchasable: true, available, code: null, message: null };
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
