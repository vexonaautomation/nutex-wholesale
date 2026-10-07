import { INVENTORY_MODE, RECORD_STATUS } from '../config/constants.js';

// What a product offers (set automatically when it is saved):
//   PCS  - loose pieces only: customer picks colour + size + quantity
//   BOX  - full boxes only: one box per size, `units_per_box` pieces in
//          assorted colours (no colour choice); price = pcs MRP x pieces
//   BOTH - boxes and loose pieces
// Who may buy what (Nutex rule):
//   * existing customers: box OR loose pieces, on every product
//   * new customers: full boxes; loose pieces only where the admin opened
//     them for that product (pcs_for_new_customers, e.g. when the stock
//     left cannot make a full box)
// Variants carry their own kind (Product_Variants.inventory_mode), so a BOTH
// product simply has active COLOR_WISE and BOX_WISE variants side by side.
export const SELL_MODE = Object.freeze({ PCS: 'PCS', BOX: 'BOX', BOTH: 'BOTH' });
export const SELL_MODES = Object.values(SELL_MODE);

/** Resolved sell mode; rows from before schema v5 fall back to inventory_mode. */
export function sellModeOf(product) {
  const m = String(product?.sell_mode || '').trim().toUpperCase();
  if (SELL_MODES.includes(m)) return m;
  return product?.inventory_mode === INVENTORY_MODE.BOX_WISE ? SELL_MODE.BOX : SELL_MODE.PCS;
}

export const allowsPcs = (product) => sellModeOf(product) !== SELL_MODE.BOX;
export const allowsBox = (product) => sellModeOf(product) !== SELL_MODE.PCS;
export const isBoxVariant = (variant) => variant?.inventory_mode === INVENTORY_MODE.BOX_WISE;

/** BOX / PCS / BOTH from what the product has. */
export function deriveSellMode({ hasBox, hasPcs }) {
  if (hasBox && hasPcs) return SELL_MODE.BOTH;
  return hasBox ? SELL_MODE.BOX : SELL_MODE.PCS;
}

/** inventory_mode stored on the product row (kept for older code/reports). */
export const primaryInventoryMode = (mode) => (mode === SELL_MODE.BOX ? INVENTORY_MODE.BOX_WISE : INVENTORY_MODE.COLOR_WISE);

/** Is this variant currently offered for sale by its product's sell mode? */
export function variantOffered(product, variant) {
  if (!product || !variant || variant.status !== RECORD_STATUS.ACTIVE) return false;
  if (isBoxVariant(variant)) return allowsBox(product);
  return variant.inventory_mode === INVENTORY_MODE.COLOR_WISE && allowsPcs(product);
}

/**
 * May this customer buy loose pieces (of this product)?
 *  - existing customers: always
 *  - setting pcs_for_existing_customers_only = FALSE: everybody
 *  - new customers: only where the product has pcs_for_new_customers
 */
export function pcsAllowedFor(customer, settings, product = null) {
  if (customer?.existing === true) return true;
  if (settings?.pcs_for_existing_customers_only === false) return true;
  return product?.pcs_for_new_customers === true;
}

export const PCS_EXISTING_ONLY_MESSAGE = 'Loose pieces of this article are only for existing customers. New customers can order full boxes - or verify as an existing customer on WhatsApp.';
