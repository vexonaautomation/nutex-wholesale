import { sheetsService } from './sheetsService.js';
import { CATALOG_SHEETS } from '../config/schema.js';
import { parseSettings } from './settingsService.js';
import {
  RECORD_STATUS, IMAGE_TYPE, PRODUCT_DISCOUNT_MODE,
} from '../config/constants.js';
import { variantAvailability } from '../utils/stockValidator.js';
import {
  SELL_MODE, sellModeOf, isBoxVariant, variantOffered,
} from '../utils/sellMode.js';
import { displayDiscountPercent, getActiveSlabs } from './priceCalculator.js';
import { round2 } from '../utils/money.js';

const bySort = (nameKey) => (a, b) => (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9) || String(a[nameKey]).localeCompare(String(b[nameKey]));
const splitIds = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
export const mediaUrl = (fileId) => (fileId ? `/media/${encodeURIComponent(fileId)}` : '');

export function buildCatalog(data) {
  const settings = parseSettings(data.Settings);
  const categories = [...data.Categories].sort(bySort('category_name'));
  const colors = [...data.Colors].sort(bySort('color_name'));
  const sizes = [...data.Sizes].sort(bySort('size_name'));
  const products = [...data.Products].sort(bySort('product_name'));
  const variants = data.Product_Variants;
  const inventory = data.Inventory;
  const images = [...data.Product_Images].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const index = (rows, key) => new Map(rows.map((r) => [r[key], r]));
  const group = (rows, key) => {
    const m = new Map();
    for (const r of rows) {
      if (!m.has(r[key])) m.set(r[key], []);
      m.get(r[key]).push(r);
    }
    return m;
  };
  const sizeOrder = new Map(sizes.map((s, i) => [s.size_id, i]));
  const colorOrder = new Map(colors.map((c, i) => [c.color_id, i]));
  const variantsByProduct = group(variants, 'product_id');
  for (const list of variantsByProduct.values()) {
    list.sort((a, b) => (colorOrder.get(a.color_id) ?? 999) - (colorOrder.get(b.color_id) ?? 999)
      || (sizeOrder.get(a.size_id) ?? 999) - (sizeOrder.get(b.size_id) ?? 999)
      || (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }
  const imagesByProduct = group(images.filter((i) => i.status !== RECORD_STATUS.INACTIVE), 'product_id');

  return {
    settings,
    categories,
    categoriesById: index(categories, 'category_id'),
    categoriesBySlug: index(categories, 'slug'),
    colors,
    colorsById: index(colors, 'color_id'),
    sizes,
    sizesById: index(sizes, 'size_id'),
    products,
    productsById: index(products, 'product_id'),
    productsBySlug: index(products, 'slug'),
    variants,
    variantsById: index(variants, 'variant_id'),
    variantsByProduct,
    inventory,
    inventoryByVariant: index(inventory, 'variant_id'),
    images,
    imagesByProduct,
    slabs: data.Discount_Slabs,
    existingCustomers: data.Existing_Customers || [],
  };
}

let memo = { key: null, catalog: null };

export async function getCatalog({ fresh = false } = {}) {
  const data = await sheetsService.readMany(CATALOG_SHEETS, { fresh });
  if (fresh) return buildCatalog(data);
  const key = sheetsService.versionKey(CATALOG_SHEETS);
  if (memo.key !== key) memo = { key, catalog: buildCatalog(data) };
  return memo.catalog;
}

// ------------------------------------------------------------------
// Public visibility & serializers
// ------------------------------------------------------------------
export function isProductVisible(catalog, product) {
  if (!product || product.status !== RECORD_STATUS.ACTIVE) return false;
  const cat = catalog.categoriesById.get(product.category_id);
  return Boolean(cat && cat.status === RECORD_STATUS.ACTIVE);
}

export function productImages(catalog, product) {
  const list = catalog.imagesByProduct.get(product.product_id) || [];
  const main = list.filter((i) => i.image_type === IMAGE_TYPE.MAIN);
  const rest = list.filter((i) => i.image_type !== IMAGE_TYPE.MAIN);
  return [...main, ...rest].map((i) => ({
    image_id: i.image_id,
    file_id: i.drive_file_id,
    url: mediaUrl(i.drive_file_id),
    type: i.image_type,
    alt: i.alt_text || product.product_name,
  }));
}

/** MRP of ONE piece of this variant (size-wise MRP, else product MRP). */
export function pieceMrpForVariant(product, variant) {
  // v4 size-wise MRP; blank = product MRP
  if (variant?.variant_mrp !== null && variant?.variant_mrp !== undefined && Number(variant.variant_mrp) > 0) return Number(variant.variant_mrp);
  return Number(product?.mrp) || 0;
}

/** MRP of one sellable unit: a piece, or a whole box (pieces x piece MRP). */
export function unitMrpForVariant(product, variant) {
  if (isBoxVariant(variant)) {
    // an explicit box MRP (older box products) wins; otherwise calculated from the piece price
    if (variant.box_mrp !== null && variant.box_mrp !== undefined && Number(variant.box_mrp) > 0) return Number(variant.box_mrp);
    return round2(pieceMrpForVariant(product, variant) * (Number(variant.units_per_box) || 1));
  }
  return pieceMrpForVariant(product, variant);
}

export function productOverridePercent(product) {
  return product.discount_mode === PRODUCT_DISCOUNT_MODE.CUSTOM && product.fixed_discount_percent !== null
    ? Number(product.fixed_discount_percent)
    : null;
}

function publicVariants(catalog, product) {
  return (catalog.variantsByProduct.get(product.product_id) || [])
    .filter((v) => variantOffered(product, v))
    .filter((v) => {
      const s = v.size_id ? catalog.sizesById.get(v.size_id) : null;
      if (isBoxVariant(v)) return !v.size_id || (s && s.status === RECORD_STATUS.ACTIVE);
      const c = catalog.colorsById.get(v.color_id);
      return c && s && c.status === RECORD_STATUS.ACTIVE && s.status === RECORD_STATUS.ACTIVE;
    })
    .map((v) => {
      const av = variantAvailability(catalog, v);
      const size = catalog.sizesById.get(v.size_id);
      const box = isBoxVariant(v);
      return {
        variant_id: v.variant_id,
        sku: v.sku,
        kind: box ? SELL_MODE.BOX : SELL_MODE.PCS,
        inventory_mode: v.inventory_mode,
        color_id: v.color_id || null,
        size_id: v.size_id || null,
        size_name: size?.size_name || '',
        box_id: v.box_id || null,
        units_per_box: box ? Number(v.units_per_box) || 1 : null,
        unit_mrp: unitMrpForVariant(product, v),
        piece_mrp: box ? round2(unitMrpForVariant(product, v) / (Number(v.units_per_box) || 1)) : unitMrpForVariant(product, v),
        mixed_color_description: box ? v.mixed_color_description || '' : '',
        available_qty: av.available,
        purchasable: av.purchasable,
      };
    });
}

export function serializeProduct(catalog, product, { detail = false } = {}) {
  const category = catalog.categoriesById.get(product.category_id);
  const variants = publicVariants(catalog, product);
  const pcs = variants.filter((v) => v.kind === SELL_MODE.PCS);
  const boxes = variants.filter((v) => v.kind === SELL_MODE.BOX);
  const sizeIds = new Set(variants.map((v) => v.size_id).filter(Boolean));
  const colorIds = new Set(pcs.map((v) => v.color_id).filter(Boolean));
  const inStock = !product.out_of_stock && variants.some((v) => v.purchasable);
  const override = productOverridePercent(product);
  const images = productImages(catalog, product);
  // prices are shown PER PIECE everywhere (a box is pieces x piece price)
  const pieceMrps = variants.map((v) => v.piece_mrp).filter((m) => m > 0);
  const boxUnits = boxes.map((v) => v.units_per_box || 1);
  const base = {
    product_id: product.product_id,
    slug: product.slug,
    sku: product.sku,
    name: product.product_name,
    category_id: product.category_id,
    category_name: category?.category_name || '',
    category_slug: category?.slug || '',
    parent_category: category?.parent_category || '',
    subcategory: product.subcategory,
    mrp: Number(product.mrp) || 0,
    // size-wise MRP range per piece (equal to mrp when every size has the same MRP)
    mrp_min: pieceMrps.length ? Math.min(...pieceMrps) : Number(product.mrp) || 0,
    mrp_max: pieceMrps.length ? Math.max(...pieceMrps) : Number(product.mrp) || 0,
    inventory_mode: product.inventory_mode,
    sell_mode: sellModeOf(product),
    can_pcs: pcs.length > 0,
    can_box: boxes.length > 0,
    // new customers may also buy loose pieces of this article
    pcs_for_new_customers: product.pcs_for_new_customers === true,
    discount: {
      mode: override !== null ? PRODUCT_DISCOUNT_MODE.CUSTOM : PRODUCT_DISCOUNT_MODE.GLOBAL,
      percent: override,
      display_percent: displayDiscountPercent(product, catalog.settings, catalog.slabs),
    },
    featured: product.featured === true,
    in_stock: inStock,
    image: images[0] || null,
    images: detail ? images : images.slice(0, 2),
    sizes: catalog.sizes.filter((s) => sizeIds.has(s.size_id)).map((s) => ({ size_id: s.size_id, size_name: s.size_name })),
    colors: catalog.colors.filter((c) => colorIds.has(c.color_id)).map((c) => ({
      color_id: c.color_id, color_name: c.color_name, hex_code: c.hex_code, swatch_url: mediaUrl(c.swatch_image),
    })),
    box_min_units: boxUnits.length ? Math.min(...boxUnits) : null,
    box_max_units: boxUnits.length ? Math.max(...boxUnits) : null,
    created_at: product.created_at,
    sort_order: product.sort_order,
  };
  if (!detail) return base;
  return {
    ...base,
    description: product.description,
    seo_title: product.seo_title,
    seo_description: product.seo_description,
    variants,
  };
}

export function serializeCategory(c, productCount) {
  return {
    category_id: c.category_id,
    name: c.category_name,
    parent_category: c.parent_category,
    slug: c.slug,
    description: c.description,
    image_url: mediaUrl(c.image_file_id),
    sort_order: c.sort_order,
    product_count: productCount,
    seo_title: c.seo_title,
    seo_description: c.seo_description,
  };
}

export function listPublicCategories(catalog) {
  const counts = new Map();
  for (const p of catalog.products) {
    if (isProductVisible(catalog, p)) counts.set(p.category_id, (counts.get(p.category_id) || 0) + 1);
  }
  return catalog.categories
    .filter((c) => c.status === RECORD_STATUS.ACTIVE)
    .map((c) => serializeCategory(c, counts.get(c.category_id) || 0));
}

export function listPublicColors(catalog) {
  return catalog.colors.filter((c) => c.status === RECORD_STATUS.ACTIVE).map((c) => ({
    color_id: c.color_id, color_name: c.color_name, color_code: c.color_code, hex_code: c.hex_code, swatch_url: mediaUrl(c.swatch_image),
  }));
}

export function listPublicSizes(catalog) {
  return catalog.sizes.filter((s) => s.status === RECORD_STATUS.ACTIVE).map((s) => ({ size_id: s.size_id, size_name: s.size_name }));
}

export function publicSlabs(catalog) {
  return getActiveSlabs(catalog.slabs).map((s) => ({
    slab_id: s.slab_id, label: s.label, min_amount: s.min_amount, max_amount: s.max_amount, discount_percent: s.discount_percent,
  }));
}

export function findProduct(catalog, idOrSlug) {
  return catalog.productsById.get(idOrSlug) || catalog.productsBySlug.get(idOrSlug) || null;
}

export function queryProducts(catalog, params = {}) {
  const {
    category, q, featured, size, color, in_stock: inStockOnly, sort = 'featured', page = 1, limit = 24, parent,
  } = params;
  const cat = category ? catalog.categoriesBySlug.get(category) || catalog.categoriesById.get(category) : null;
  if (category && !cat) return { items: [], total: 0, page: 1, limit: Number(limit) || 24 };
  const needle = String(q || '').trim().toLowerCase();
  let items = catalog.products
    .filter((p) => isProductVisible(catalog, p))
    .filter((p) => !cat || p.category_id === cat.category_id)
    .filter((p) => !parent || (catalog.categoriesById.get(p.category_id)?.parent_category || '') === String(parent).toUpperCase())
    .filter((p) => !featured || p.featured === true)
    .filter((p) => !needle || [p.product_name, p.sku, p.subcategory, p.description].some((v) => String(v).toLowerCase().includes(needle)))
    .map((p) => serializeProduct(catalog, p));
  if (size) items = items.filter((p) => p.sizes.some((s) => s.size_id === size));
  if (color) items = items.filter((p) => p.colors.some((c) => c.color_id === color));
  if (String(inStockOnly) === 'true') items = items.filter((p) => p.in_stock);
  const sorters = {
    featured: (a, b) => Number(b.featured) - Number(a.featured) || Number(b.in_stock) - Number(a.in_stock) || (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9),
    newest: (a, b) => String(b.created_at).localeCompare(String(a.created_at)),
    price_asc: (a, b) => a.mrp_min - b.mrp_min,
    price_desc: (a, b) => b.mrp_max - a.mrp_max,
    name: (a, b) => a.name.localeCompare(b.name),
  };
  items.sort(sorters[sort] || sorters.featured);
  const size_ = Math.min(100, Math.max(1, Number(limit) || 24));
  const p = Math.max(1, Number(page) || 1);
  return { items: items.slice((p - 1) * size_, p * size_), total: items.length, page: p, limit: size_ };
}

// Every Drive file ID that may be served publicly through /media/:id.
// Payment proofs are deliberately NOT included.
export function publicFileIds(catalog) {
  const ids = new Set();
  for (const i of catalog.images) if (i.drive_file_id) ids.add(i.drive_file_id);
  for (const c of catalog.categories) if (c.image_file_id) ids.add(c.image_file_id);
  for (const c of catalog.colors) if (c.swatch_image) ids.add(c.swatch_image);
  if (catalog.settings.company_logo_file_id) ids.add(catalog.settings.company_logo_file_id);
  if (catalog.settings.size_chart_file_id) ids.add(catalog.settings.size_chart_file_id);
  if (catalog.settings.payment_qr_file_id) ids.add(catalog.settings.payment_qr_file_id);
  return ids;
}

export { splitIds };
