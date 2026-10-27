// GBNutex: the sales register (one row per item) written when an order is
// marked HANDED OVER, like Order_Items_Summary. The team fills MODE, PLATFORM
// (dropdowns) and PACKING COST; S NO, FINAL REVENUE, FINAL COST, GROSS PROFIT
// and GP PERCENTAGE are sheet formulas (config/schema.js), so they follow
// what the team types. Nothing of this is shown on the website.
//  - QTY: dozens (pieces / 12); PRICE: net rate per piece after discount
//  - REVENUE = PRICE x pieces; COST = Products.cost_price x pieces
//  - ONLINE PACKING: the order's "less packing charges" deduction, shared
//    over its items by their packing charge (rate x pieces)
import { pcsColumns } from '../utils/itemPcs.js';
import { packingRateOf } from '../utils/packing.js';
import { round2 } from '../utils/money.js';

export const GB_SHEET = 'GBNutex';
export const GB_PLATFORMS = Object.freeze(['Meesho NAL', 'Meesho NKF', 'Flipkart NAL', 'Flipkart NKF', 'Myntra NAL', 'Myntra NKF', 'Snapdeal', 'Amazon', 'Website']);
export const GB_MODES = Object.freeze(['Online', 'Offline', 'Ecom Client']);

/** Set / Bra / Panty / Underwear / Vest from the category (else its name). */
export function productUnit(categoryName) {
  const n = String(categoryName || '').toLowerCase();
  if (/\bsets?\b/.test(n)) return 'Set';
  if (/\bvests?\b/.test(n)) return 'Vest';
  if (/\bunderwears?\b|\btrunks?\b|\bboxers?\b/.test(n)) return 'Underwear';
  if (/\bbras?\b/.test(n)) return 'Bra';
  if (/\bpant(y|ies)\b|\bbriefs?\b/.test(n)) return 'Panty';
  return String(categoryName || '').trim();
}

/**
 * GBNutex rows of a handed-over order.
 * ctx: { products: Map(product_id -> product), categories: Map(category_id -> category) }
 */
export function gbNutexRows(order, items, { products, categories }) {
  const lines = items.map((item) => {
    const pcs = pcsColumns(item).qty_pcs;
    const product = products.get(item.product_id);
    const category = product ? categories.get(product.category_id) : null;
    return { item, pcs, product, packing: packingRateOf(category) * pcs };
  });
  const deduction = Number(order.packing_deduction) || 0;
  const weightOf = (l) => l.packing;
  const total = lines.reduce((s, l) => s + weightOf(l), 0);
  const totalPcs = lines.reduce((s, l) => s + l.pcs, 0);
  return lines.map((l) => {
    const share = total > 0 ? weightOf(l) / total : (totalPcs > 0 ? l.pcs / totalPcs : 0);
    const cost = Number(l.product?.cost_price);
    return {
      DATE: order.created_at,
      BILL: order.order_number,
      MODE: '',
      PLATFORM: 'Website',
      'CLIENT NAME': order.business_name_snapshot || order.customer_name_snapshot,
      PRODUCT: l.item.product_name_snapshot,
      'PRODUCT UNIT': productUnit(l.item.category_snapshot),
      Unit: 'Dzn',
      QTY: round2(l.pcs / 12),
      PRICE: l.pcs > 0 ? round2((Number(l.item.line_total) || 0) / l.pcs) : null,
      REVENUE: round2(Number(l.item.line_total) || 0),
      COST: l.product?.cost_price !== '' && l.product?.cost_price != null && Number.isFinite(cost) ? round2(cost * l.pcs) : '',
      'ONLINE PACKING': round2(deduction * share),
    };
  });
}
