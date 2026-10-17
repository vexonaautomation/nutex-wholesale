// Nutex size-wise MRP rule: bigger sizes cost a fixed amount more than the
// article's MRP (the MRP is the price of the smaller sizes).
//   Bras & sets (28-44)  28-40 = MRP, 42-44 = MRP + 6
//   Panties              32-38 = MRP, 40 = +12, 42-44 = +24, 46 = +36
//   Gents vests          S-L = MRP, XL-XXL = +16
//   Gents underwear      S-L = MRP, XL-2XL = +20, 3XL-4XL = +40
// Sizes the rule does not name keep their price. Box prices follow (pieces x
// piece MRP of that size). Articles that already have their own size-wise MRP
// are left alone unless `force` is set.
import { sheetsService } from './sheetsService.js';
import { auditOp } from './auditService.js';
import { buildCatalog } from './catalogService.js';
import { CATALOG_SHEETS } from '../config/schema.js';
import { AUDIT_ACTION, RECORD_STATUS } from '../config/constants.js';
import { withLock, COMMERCE_LOCK } from '../utils/lockManager.js';
import { nowIso } from '../utils/dates.js';

export const SIZE_MRP_RULES = Object.freeze({
  BRA: { label: 'Bras & sets', plus: { 28: 0, 30: 0, 32: 0, 34: 0, 36: 0, 38: 0, 40: 0, 42: 6, 44: 6 } },
  PANTY: { label: 'Panties', plus: { 32: 0, 34: 0, 36: 0, 38: 0, 40: 12, 42: 24, 44: 24, 46: 36 } },
  VEST: { label: 'Gents vests', plus: { S: 0, M: 0, L: 0, XL: 16, XXL: 16 } },
  UNDERWEAR: { label: 'Gents underwear', plus: { S: 0, M: 0, L: 0, XL: 20, XXL: 20, XXXL: 40, '4XL': 40 } },
});

// "2XL" = "XXL", "3XL" = "XXXL"
const sizeKey = (name) => {
  const s = String(name || '').trim().toUpperCase().replace(/\s+/g, '');
  return { '2XL': 'XXL', '3XL': 'XXXL', XXXXL: '4XL' }[s] || s;
};

/** Which rule an article follows (null = none): by category, subcategory and name. */
export function ruleTypeOf(product, category) {
  const cat = `${category?.slug || ''} ${category?.category_name || ''}`.toLowerCase();
  const text = `${product.subcategory || ''} ${product.product_name || ''}`.toLowerCase();
  if (/camisole|shapewear/.test(cat)) return null;
  if (/panty|panties/.test(cat)) return 'PANTY';
  if (/\bmen\b|gents|male/.test(cat) || /men-collection/.test(cat)) {
    if (/vest|baniyan|banian/.test(text)) return 'VEST';
    if (/trunk|brief|underwear|drawer|boxer/.test(text)) return 'UNDERWEAR';
    return null;
  }
  if (/bra|set|lingerie|cotton|print/.test(cat)) return 'BRA';
  return null;
}

/** The size-wise MRP an article gets: size_id -> MRP (null = the article MRP). */
export function planSizeMrp(catalog, product) {
  const type = ruleTypeOf(product, catalog.categoriesById.get(product.category_id));
  if (!type) return { type: null, changes: [] };
  const rule = SIZE_MRP_RULES[type].plus;
  const mrp = Number(product.mrp) || 0;
  const variants = catalog.variantsByProduct.get(product.product_id) || [];
  const changes = [];
  const sizesDone = new Set();
  for (const v of variants) {
    if (!v.size_id || sizesDone.has(v.size_id)) continue;
    const size = catalog.sizesById.get(v.size_id);
    const plus = rule[sizeKey(size?.size_name)];
    if (plus === undefined) continue; // size not in the rule: keeps its price
    sizesDone.add(v.size_id);
    const want = plus > 0 ? mrp + plus : null;
    const current = Number(v.variant_mrp) > 0 ? Number(v.variant_mrp) : null;
    changes.push({ size_id: v.size_id, size_name: size?.size_name || '', from: current ?? mrp, to: want ?? mrp, want, changed: current !== want && !(current === mrp && want === null) });
  }
  return { type, changes };
}

const hasOwnSizeMrp = (catalog, product) => (catalog.variantsByProduct.get(product.product_id) || [])
  .some((v) => v.status === RECORD_STATUS.ACTIVE && Number(v.variant_mrp) > 0 && Number(v.variant_mrp) !== Number(product.mrp));

/**
 * Applies the rule to all articles (or `productIds`). Returns what changed
 * and what was skipped (with the reason). `dryRun` writes nothing.
 */
export async function applySizeMrpRules({ productIds = null, force = false, dryRun = false } = {}, { admin, ip } = {}) {
  return withLock(COMMERCE_LOCK, async () => {
    const catalog = buildCatalog(await sheetsService.readMany(CATALOG_SHEETS, { fresh: true }));
    const only = productIds ? new Set(productIds) : null;
    const now = nowIso();
    const ops = [];
    const result = { updated: [], unchanged: [], skipped: [] };
    for (const p of catalog.products) {
      if (only ? !only.has(p.product_id) : p.status === RECORD_STATUS.ARCHIVED) continue;
      const label = `${p.sku} ${p.product_name}`;
      const plan = planSizeMrp(catalog, p);
      if (!plan.type) { if (only) result.skipped.push({ sku: p.sku, reason: `${label}: no size rule for this kind of article` }); continue; }
      if (!force && hasOwnSizeMrp(catalog, p)) { result.skipped.push({ sku: p.sku, reason: `${label}: already has its own size-wise MRP - not changed` }); continue; }
      const changed = plan.changes.filter((c) => c.changed);
      if (!changed.length) { result.unchanged.push(p.sku); continue; }
      const wanted = new Map(plan.changes.map((c) => [c.size_id, c.want]));
      for (const v of catalog.variantsByProduct.get(p.product_id) || []) {
        if (!wanted.has(v.size_id)) continue;
        const want = wanted.get(v.size_id);
        const current = Number(v.variant_mrp) > 0 ? Number(v.variant_mrp) : null;
        if (current !== want) ops.push({ op: 'update', sheet: 'Product_Variants', id: v.variant_id, patch: { variant_mrp: want, updated_at: now } });
      }
      result.updated.push({ sku: p.sku, name: p.product_name, rule: SIZE_MRP_RULES[plan.type].label, sizes: changed.map((c) => `${c.size_name}: ${c.from} -> ${c.to}`) });
    }
    if (!dryRun && ops.length) {
      ops.push(auditOp({
        admin, ip, action: AUDIT_ACTION.PRICE_UPDATED, entity_type: 'Product', entity_id: 'size-mrp-rule',
        new_value: { articles: result.updated.length, skipped: result.skipped.map((s) => s.sku) },
        notes: `Size-wise MRP rule applied to ${result.updated.length} article(s)`,
      }));
      await sheetsService.commit(ops);
    }
    return result;
  });
}
