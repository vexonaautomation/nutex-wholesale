import { sheetsService } from './sheetsService.js';
import { auditOp } from './auditService.js';
import {
  buildCatalog, getCatalog, productImages, splitIds, unitMrpForVariant, productOverridePercent,
} from './catalogService.js';
import { CATALOG_SHEETS } from '../config/schema.js';
import {
  AUDIT_ACTION, INVENTORY_MODE, INVENTORY_STATUS, RECORD_STATUS, PRODUCT_DISCOUNT_MODE, IMAGE_TYPE,
} from '../config/constants.js';
import { withLock, COMMERCE_LOCK } from '../utils/lockManager.js';
import { newId, ID_PREFIX } from '../utils/idGenerator.js';
import { nowIso } from '../utils/dates.js';
import { slugify, uniqueSlug } from '../utils/slug.js';
import { badRequest, notFound, conflict } from '../utils/errors.js';
import { availableOf, autoBoxInfo } from '../utils/stockValidator.js';
import { calculatePricing } from './priceCalculator.js';
import {
  allowsBox, allowsPcs, isBoxVariant, primaryInventoryMode, sellModeOf, variantOffered, deriveSellMode,
} from '../utils/sellMode.js';

const n0 = (v) => Math.max(0, Math.floor(Number(v) || 0));
const driveViewUrl = (id) => (id ? `https://drive.google.com/file/d/${id}/view` : '');
const same = (a, b) => String(a ?? '') === String(b ?? '');

function diff(existing, fields) {
  const patch = {};
  const old = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!same(existing[k], v)) {
      patch[k] = v;
      old[k] = existing[k];
    }
  }
  return { patch, old };
}

function indicativePrice(catalog, product) {
  const q = calculatePricing({
    lines: [{ key: 'x', qty: 1, unit_mrp: product.mrp, override_percent: productOverridePercent(product) }],
    settings: { ...catalog.settings, minimum_order_value: 0 },
    slabs: catalog.slabs,
  });
  return { unit_price: q.final_payable, discount_percent: q.lines[0]?.discount_percent ?? 0 };
}

function adminSummary(catalog, p) {
  const variants = (catalog.variantsByProduct.get(p.product_id) || []).filter((v) => variantOffered(p, v));
  const boxes = variants.filter(isBoxVariant);
  let totalStock = 0;
  let totalAvailable = 0;
  let oos = 0;
  let autoBoxes = 0;
  for (const v of variants) {
    const inv = catalog.inventoryByVariant.get(v.variant_id);
    const auto = isBoxVariant(v) ? autoBoxInfo(catalog, p, v) : null;
    if (auto) {
      // packed from the loose pieces already counted above - not extra stock
      autoBoxes += auto.boxes;
      if (auto.boxes <= 0) oos += 1;
      continue;
    }
    const avail = availableOf(inv);
    totalStock += n0(inv?.stock_qty);
    totalAvailable += avail;
    if (avail <= 0 || inv?.status === INVENTORY_STATUS.OUT_OF_STOCK) oos += 1;
  }
  const cat = catalog.categoriesById.get(p.category_id);
  return {
    product_id: p.product_id,
    sku: p.sku,
    product_name: p.product_name,
    slug: p.slug,
    category_id: p.category_id,
    category_name: cat?.category_name || '(missing category)',
    mrp: p.mrp,
    discount_mode: p.discount_mode || PRODUCT_DISCOUNT_MODE.GLOBAL,
    fixed_discount_percent: p.fixed_discount_percent,
    inventory_mode: p.inventory_mode,
    sell_mode: sellModeOf(p),
    units_per_box: unitsPerBoxOf(p, catalog.variantsByProduct.get(p.product_id)),
    pcs_for_new_customers: p.pcs_for_new_customers === true,
    pcs_variants: variants.length - boxes.length,
    box_variants: boxes.length,
    status: p.status,
    out_of_stock: p.out_of_stock,
    featured: p.featured,
    sort_order: p.sort_order,
    image: productImages(catalog, p)[0]?.url || '',
    variant_count: variants.length,
    oos_variants: oos,
    total_stock: totalStock,
    total_available: totalAvailable,
    auto_boxes: autoBoxes,
    price_preview: indicativePrice(catalog, p),
    updated_at: p.updated_at,
  };
}

export async function listProductsAdmin({
  q, status, category_id, inventory_mode, sell_mode,
} = {}) {
  const catalog = await getCatalog({ fresh: true });
  const needle = String(q || '').trim().toLowerCase();
  return catalog.products
    .filter((p) => !status || p.status === status)
    .filter((p) => !category_id || p.category_id === category_id)
    .filter((p) => !inventory_mode || p.inventory_mode === inventory_mode)
    .filter((p) => !sell_mode || sellModeOf(p) === sell_mode)
    .filter((p) => !needle || [p.product_name, p.sku, p.product_id].some((v) => String(v).toLowerCase().includes(needle)))
    .map((p) => adminSummary(catalog, p));
}

export async function getProductAdmin(id, catalogArg) {
  const catalog = catalogArg || await getCatalog({ fresh: true });
  const p = catalog.productsById.get(id);
  if (!p) throw notFound('Product not found.');
  const variants = (catalog.variantsByProduct.get(id) || []).map((v) => {
    const inv = catalog.inventoryByVariant.get(v.variant_id);
    return {
      ...v,
      unit_mrp: unitMrpForVariant(p, v),
      auto_box: isBoxVariant(v) ? autoBoxInfo(catalog, p, v) : null,
      inventory: inv ? {
        inventory_id: inv.inventory_id,
        stock_qty: n0(inv.stock_qty),
        reserved_qty: n0(inv.reserved_qty),
        available_qty: availableOf(inv),
        status: inv.status || INVENTORY_STATUS.ACTIVE,
      } : null,
    };
  });
  const images = catalog.images
    .filter((i) => i.product_id === id && i.status !== RECORD_STATUS.INACTIVE)
    .map((i) => ({ ...i, url: `/api/admin/media/${encodeURIComponent(i.drive_file_id)}` }));
  return {
    product: {
      ...p,
      sell_mode: sellModeOf(p),
      units_per_box: unitsPerBoxOf(p, variants),
      size_ids: splitIds(p.size_ids),
      color_ids: splitIds(p.color_ids),
      size_mrps: Object.entries(sizeMrpsOf(variants)).map(([size_id, mrp]) => ({ size_id, mrp })),
    },
    summary: adminSummary(catalog, p),
    variants,
    boxes: variants.filter(isBoxVariant),
    // boxes made before per-size boxes existed (own MRP, no size or mixed sizes)
    legacy_boxes: hasLegacyBoxes(p, variants),
    images,
  };
}

/**
 * Create or update ONE product (the "Publish" action).
 * Touches only this product's rows in Products / Product_Variants /
 * Inventory / Product_Images. Variants removed from the product are set
 * INACTIVE (never deleted) so historical orders keep resolving.
 */
export async function saveProduct(input, { admin, ip, productId = null, extraAudit = [] }) {
  return withLock(COMMERCE_LOCK, async () => {
    const data = await sheetsService.readMany(CATALOG_SHEETS, { fresh: true });
    const catalog = buildCatalog(data);
    const existing = productId ? catalog.productsById.get(productId) : null;
    if (productId && !existing) throw notFound('Product not found.');

    const category = catalog.categoriesById.get(input.category_id);
    if (!category || category.status === RECORD_STATUS.ARCHIVED) throw badRequest('Select a valid category.');
    if (catalog.products.some((p) => p.sku.toUpperCase() === input.sku && p.product_id !== productId)) {
      throw badRequest(`SKU ${input.sku} is already used by another product.`);
    }
    const sellMode = sellModeOf(input);
    const sizeIds = [...new Set(input.size_ids)];
    const colorIds = [...new Set(input.color_ids)];
    for (const s of sizeIds) if (!catalog.sizesById.has(s)) throw badRequest(`Unknown size ${s}`);
    // size-wise MRP: only for selected sizes and only when it differs from the product MRP
    const sizeMrp = new Map((input.size_mrps || [])
      .filter((m) => sizeIds.includes(m.size_id) && Number(m.mrp) > 0 && Number(m.mrp) !== Number(input.mrp))
      .map((m) => [m.size_id, Number(m.mrp)]));
    for (const c of colorIds) if (!catalog.colorsById.has(c)) throw badRequest(`Unknown color ${c}`);
    for (const b of input.boxes) if (b.size_id && !catalog.sizesById.has(b.size_id)) throw badRequest(`Unknown size ${b.size_id} in box configuration`);

    const legacyBoxes = input.boxes.length > 0;
    const unitsPerBox = allowsBox(input) && !legacyBoxes ? Math.floor(Number(input.units_per_box) || 0) : null;
    if (allowsBox(input) && !legacyBoxes) {
      if (!(unitsPerBox >= 1)) throw badRequest('Enter how many pieces are in one box.');
      if (!sizeIds.length) throw badRequest('Select at least one size - one box is made for each size.');
      if (!colorIds.length) throw badRequest('Select the colours too - boxes are packed from the loose pieces of these colours (stock is entered in pieces only).');
    }
    if (allowsPcs(input) && (!sizeIds.length || !colorIds.length)) throw badRequest('Select sizes and colours for selling in pieces.');

    const takenSlugs = new Set(catalog.products.filter((p) => p.product_id !== productId).map((p) => p.slug));
    let slug = slugify(input.slug);
    if (slug && takenSlugs.has(slug)) throw badRequest('This URL slug is already used by another product.');
    if (!slug) slug = existing?.slug || uniqueSlug(input.product_name, takenSlugs);

    const now = nowIso();
    const by = admin.admin_id;
    const pid = existing?.product_id || newId(ID_PREFIX.product);
    const productFields = {
      sku: input.sku,
      product_name: input.product_name,
      slug,
      category_id: input.category_id,
      subcategory: input.subcategory,
      description: input.description,
      mrp: input.mrp,
      discount_mode: input.discount_mode,
      fixed_discount_percent: input.discount_mode === PRODUCT_DISCOUNT_MODE.CUSTOM ? input.fixed_discount_percent : null,
      inventory_mode: primaryInventoryMode(sellMode),
      sell_mode: sellMode,
      units_per_box: unitsPerBox,
      pcs_for_new_customers: input.pcs_for_new_customers === true,
      size_ids: sizeIds.join(','),
      color_ids: colorIds.join(','),
      status: input.status,
      out_of_stock: input.out_of_stock,
      featured: input.featured,
      sort_order: input.sort_order,
      seo_title: input.seo_title,
      seo_description: input.seo_description,
    };

    const ops = [];
    const audits = [];
    let productDiff = { patch: {}, old: {} };
    if (!existing) {
      ops.push({ op: 'append', sheet: 'Products', rows: [{ product_id: pid, ...productFields, created_at: now, updated_at: now, created_by: by, updated_by: by }] });
    } else {
      productDiff = diff(existing, productFields);
      if (Object.keys(productDiff.patch).length) {
        ops.push({ op: 'update', sheet: 'Products', id: pid, patch: { ...productDiff.patch, updated_at: now, updated_by: by } });
      }
    }

    // ------------------------- variants + inventory -------------------------
    const existingVariants = catalog.variantsByProduct.get(pid) || [];
    const desired = planVariants({
      catalog, existingVariants, sku: input.sku, sellMode, sizeIds, colorIds, sizeMrp, unitsPerBox, boxes: input.boxes, stock: input.stock,
    });
    checkVariantSkus(catalog, pid, desired);
    const { ops: variantOps, newVariants, stockChanges } = applyVariantPlan({ catalog, pid, existingVariants, desired, now, by });
    ops.push(...variantOps);

    // ------------------------------- images ---------------------------------
    const existingImages = data.Product_Images.filter((i) => i.product_id === pid);
    const wanted = normalizeImageTypes(input.images);
    const keptImages = new Set();
    const newImages = [];
    wanted.forEach((img, idx) => {
      const match = img.image_id
        ? existingImages.find((e) => e.image_id === img.image_id)
        : existingImages.find((e) => e.drive_file_id === img.drive_file_id && !keptImages.has(e.image_id));
      const fields = {
        drive_file_id: img.drive_file_id,
        file_url: img.file_url && !img.file_url.startsWith('/') ? img.file_url : driveViewUrl(img.drive_file_id),
        image_type: img.image_type,
        alt_text: img.alt_text || input.product_name,
        sort_order: idx + 1,
        status: RECORD_STATUS.ACTIVE,
      };
      if (match) {
        keptImages.add(match.image_id);
        const d = diff(match, fields);
        if (Object.keys(d.patch).length) ops.push({ op: 'update', sheet: 'Product_Images', id: match.image_id, patch: { ...d.patch, updated_at: now } });
      } else {
        newImages.push({ image_id: newId(ID_PREFIX.image), product_id: pid, ...fields, created_at: now, updated_at: now });
      }
    });
    for (const e of existingImages) {
      if (!keptImages.has(e.image_id) && e.status !== RECORD_STATUS.INACTIVE) {
        ops.push({ op: 'update', sheet: 'Product_Images', id: e.image_id, patch: { status: RECORD_STATUS.INACTIVE, updated_at: now } });
      }
    }
    if (newImages.length) ops.push({ op: 'append', sheet: 'Product_Images', rows: newImages });

    // ------------------------------- audit ----------------------------------
    if (!existing) {
      audits.push({ action: AUDIT_ACTION.PRODUCT_CREATED, new_value: { product_id: pid, ...productFields, variants: newVariants.length, images: newImages.length } });
    } else {
      const changed = productDiff.patch;
      if (Object.keys(changed).length || newVariants.length || newImages.length || ops.length) {
        audits.push({ action: AUDIT_ACTION.PRODUCT_UPDATED, old_value: productDiff.old, new_value: changed });
      }
      if ('mrp' in changed) audits.push({ action: AUDIT_ACTION.PRICE_UPDATED, old_value: { mrp: existing.mrp }, new_value: { mrp: changed.mrp } });
      if ('discount_mode' in changed || 'fixed_discount_percent' in changed) {
        audits.push({
          action: AUDIT_ACTION.DISCOUNT_UPDATED,
          old_value: { discount_mode: existing.discount_mode, fixed_discount_percent: existing.fixed_discount_percent },
          new_value: { discount_mode: productFields.discount_mode, fixed_discount_percent: productFields.fixed_discount_percent },
        });
      }
      if ('status' in changed) audits.push({ action: statusAction(changed.status), old_value: { status: existing.status }, new_value: { status: changed.status } });
    }
    if (stockChanges.length && (existing || stockChanges.some((s) => s.to > 0))) {
      audits.push({ action: AUDIT_ACTION.INVENTORY_UPDATED, new_value: stockChanges.slice(0, 200) });
    }
    for (const a of [...audits, ...extraAudit]) {
      ops.push(auditOp({ admin, ip, entity_type: 'Product', entity_id: pid, ...a }));
    }

    if (ops.length) await sheetsService.commit(ops);
    return getProductAdmin(pid);
  });
}

/**
 * The variants a product must have for its sell mode:
 *  - PCS / BOTH: one per colour x size
 *  - BOX / BOTH: explicit box configs (older box products) or, normally, one
 *    box per size holding `unitsPerBox` pieces in assorted colours. The box
 *    price is calculated from the piece MRP of that size.
 * Existing variants are matched so their IDs and stock are kept.
 */
export function planVariants({
  catalog, existingVariants = [], sku, sellMode, sizeIds = [], colorIds = [], sizeMrp = new Map(), unitsPerBox = null, boxes = [], stock = [],
}) {
  const mode = { sell_mode: sellMode };
  const desired = [];
  const sizes = catalog.sizes.filter((s) => sizeIds.includes(s.size_id));
  if (allowsPcs(mode)) {
    const colors = catalog.colors.filter((c) => colorIds.includes(c.color_id));
    let order = 0;
    for (const color of colors) {
      for (const size of sizes) {
        desired.push({
          match: existingVariants.find((v) => v.inventory_mode === INVENTORY_MODE.COLOR_WISE && v.color_id === color.color_id && v.size_id === size.size_id),
          fields: {
            sku: colorWiseVariantSku(sku, color, size),
            size_id: size.size_id,
            color_id: color.color_id,
            box_id: '',
            inventory_mode: INVENTORY_MODE.COLOR_WISE,
            units_per_box: null,
            box_mrp: null,
            mixed_color_description: '',
            status: RECORD_STATUS.ACTIVE,
            sort_order: order += 1,
            variant_mrp: sizeMrp.get(size.size_id) ?? null,
          },
          stock: stock.find((s) => s.color_id === color.color_id && s.size_id === size.size_id),
        });
      }
    }
  }
  if (allowsBox(mode) && boxes.length) {
    boxes.forEach((box, i) => {
      const match = box.box_id ? existingVariants.find((v) => isBoxVariant(v) && v.box_id === box.box_id) : null;
      if (box.box_id && !match) throw badRequest(`Box ${box.box_id} does not belong to this product.`);
      const size = box.size_id ? catalog.sizesById.get(box.size_id) : null;
      desired.push({
        match,
        fields: {
          sku: (box.sku || `${sku}-BOX${box.units_per_box}${size ? `-${size.size_name}` : ''}${i ? `-${i + 1}` : ''}`).toUpperCase().replace(/\s+/g, ''),
          size_id: box.size_id || '',
          color_id: '',
          box_id: match?.box_id || newId(ID_PREFIX.box),
          inventory_mode: INVENTORY_MODE.BOX_WISE,
          units_per_box: box.units_per_box,
          box_mrp: box.box_mrp ?? null,
          mixed_color_description: box.mixed_color_description,
          status: box.status,
          sort_order: i + 1,
          variant_mrp: null,
        },
        stock: stock.find((s) => s.box_key && (s.box_key === box.box_id || (box.key && s.box_key === box.key))),
      });
    });
  } else if (allowsBox(mode) && unitsPerBox >= 1) {
    sizes.forEach((size, i) => {
      const same = existingVariants.filter((v) => isBoxVariant(v) && v.size_id === size.size_id && Number(v.units_per_box) === unitsPerBox);
      const match = same.find((v) => v.status === RECORD_STATUS.ACTIVE) || same[0] || null;
      desired.push({
        match,
        fields: {
          sku: boxVariantSku(sku, unitsPerBox, size),
          size_id: size.size_id,
          color_id: '',
          box_id: match?.box_id || newId(ID_PREFIX.box),
          inventory_mode: INVENTORY_MODE.BOX_WISE,
          units_per_box: unitsPerBox,
          box_mrp: null, // calculated: pieces x piece MRP of this size
          mixed_color_description: match?.mixed_color_description || 'Assorted colours',
          status: RECORD_STATUS.ACTIVE,
          sort_order: 1000 + i,
          variant_mrp: sizeMrp.get(size.size_id) ?? null,
        },
        // stock is entered in pieces only: a box keeps just its "out of stock" flag
        stock: statusOnly(stock.find((s) => s.box_key && ((match && s.box_key === match.box_id) || s.box_key === `size:${size.size_id}`))),
      });
    });
  }
  return desired;
}

const statusOnly = (entry) => (entry?.status ? { status: entry.status } : undefined);

export function checkVariantSkus(catalog, pid, desired) {
  const skus = desired.map((d) => d.fields.sku);
  const dupSku = skus.find((s, i) => skus.indexOf(s) !== i);
  if (dupSku) throw badRequest(`Duplicate variant SKU ${dupSku}. Give each box a unique SKU.`);
  const foreign = catalog.variants.find((v) => v.product_id !== pid && v.status === RECORD_STATUS.ACTIVE && skus.includes(v.sku));
  if (foreign) throw badRequest(`Variant SKU ${foreign.sku} is already used by another product.`);
}

/**
 * Turns a variant plan into Sheets operations: updates matched variants,
 * appends new ones (+ inventory rows), sets variants no longer wanted to
 * INACTIVE (never deleted - old orders keep resolving).
 * New variants without a stock entry start at 0.
 */
export function applyVariantPlan({
  catalog, pid, existingVariants, desired, now, by,
}) {
  const ops = [];
  const newVariants = [];
  const newInventory = [];
  const stockConflicts = [];
  const stockChanges = [];
  const keptIds = new Set();
  const startQty = (d) => n0(d.stock?.stock_qty);
  for (const d of desired) {
    const stockEntry = d.stock;
    if (d.match) {
      keptIds.add(d.match.variant_id);
      const vd = diff(d.match, d.fields);
      if (Object.keys(vd.patch).length) ops.push({ op: 'update', sheet: 'Product_Variants', id: d.match.variant_id, patch: { ...vd.patch, updated_at: now } });
      const inv = catalog.inventoryByVariant.get(d.match.variant_id);
      if (!inv) {
        const qty = startQty(d);
        newInventory.push(inventoryRow(pid, d.match.variant_id, d.fields, qty, stockEntry?.status, now, by));
        stockChanges.push({ variant_id: d.match.variant_id, from: null, to: qty });
      } else if (stockEntry) {
        const patch = {};
        const current = n0(inv.stock_qty);
        if (stockEntry.stock_qty !== undefined && stockEntry.stock_qty !== current) {
          if (stockEntry.expected_stock_qty !== null && stockEntry.expected_stock_qty !== undefined && stockEntry.expected_stock_qty !== current) {
            stockConflicts.push({ variant_id: inv.variant_id, expected: stockEntry.expected_stock_qty, actual: current });
            continue;
          }
          if (stockEntry.stock_qty < n0(inv.reserved_qty)) {
            throw badRequest(`Stock for ${d.fields.sku} cannot be below ${n0(inv.reserved_qty)} reserved unit(s).`);
          }
          patch.stock_qty = stockEntry.stock_qty;
          patch.available_qty = stockEntry.stock_qty - n0(inv.reserved_qty);
          stockChanges.push({ variant_id: inv.variant_id, from: current, to: stockEntry.stock_qty });
        }
        if (stockEntry.status && stockEntry.status !== (inv.status || INVENTORY_STATUS.ACTIVE)) patch.status = stockEntry.status;
        if (Object.keys(patch).length) ops.push({ op: 'update', sheet: 'Inventory', id: inv.inventory_id, patch: { ...patch, updated_at: now, updated_by: by } });
      }
    } else {
      const variantId = newId(ID_PREFIX.variant);
      newVariants.push({ variant_id: variantId, product_id: pid, ...d.fields, created_at: now, updated_at: now });
      const qty = startQty(d);
      newInventory.push(inventoryRow(pid, variantId, d.fields, qty, stockEntry?.status, now, by));
      stockChanges.push({ variant_id: variantId, from: null, to: qty });
    }
  }
  if (stockConflicts.length) {
    throw conflict('STOCK_CONFLICT', 'Stock changed since you opened this product (an order may have been placed). Reload the product and re-enter stock.', { conflicts: stockConflicts });
  }
  for (const v of existingVariants) {
    if (!keptIds.has(v.variant_id) && v.status === RECORD_STATUS.ACTIVE) {
      ops.push({ op: 'update', sheet: 'Product_Variants', id: v.variant_id, patch: { status: RECORD_STATUS.INACTIVE, updated_at: now } });
    }
  }
  if (newVariants.length) ops.push({ op: 'append', sheet: 'Product_Variants', rows: newVariants });
  if (newInventory.length) ops.push({ op: 'append', sheet: 'Inventory', rows: newInventory });
  return { ops, newVariants, newInventory, stockChanges };
}

export const boxVariantSku = (productSku, units, size) => `${productSku}-BOX${units}-${size.size_name}`.toUpperCase().replace(/\s+/g, '');

export function colorWiseVariantSku(productSku, color, size) {
  const code = (color.color_code || slugify(color.color_name)).toUpperCase();
  return `${productSku}-${code}-${size.size_name}`.toUpperCase().replace(/\s+/g, '');
}

/** Pieces per box: the product setting, else the box variants' common value. */
export function unitsPerBoxOf(product, variants = []) {
  if (Number(product.units_per_box) >= 1) return Number(product.units_per_box);
  const units = [...new Set(variants.filter((v) => isBoxVariant(v) && v.status === RECORD_STATUS.ACTIVE).map((v) => Number(v.units_per_box) || 1))];
  return units.length === 1 ? units[0] : null;
}

/** Active boxes that are not plain "one box per size, N pieces, calculated price". */
export function hasLegacyBoxes(product, variants = []) {
  const boxes = variants.filter((v) => isBoxVariant(v) && v.status === RECORD_STATUS.ACTIVE);
  if (!boxes.length) return false;
  const units = unitsPerBoxOf(product, variants);
  const sizes = boxes.map((b) => b.size_id);
  return boxes.some((b) => !b.size_id || Number(b.box_mrp) > 0 || Number(b.units_per_box) !== units) || new Set(sizes).size !== sizes.length;
}

/**
 * Bulk "Box / pieces": for a group of products set the pieces per box (one
 * box per size, price = pieces x piece MRP; null = no box) and whether NEW
 * customers may also buy loose pieces. Existing customers can always buy
 * loose pieces of products that have colours.
 * Only these rows are written; prices, stock of existing variants, images and
 * everything else stay untouched. Boxes are packed from the loose pieces, so a
 * product needs colours to get a box (stock is entered in pieces only).
 */
export async function bulkSetSelling({
  product_ids: productIds, units_per_box: units = null, pcs_for_new_customers: pcsNew, sell_mode: requested,
}, { admin, ip }) {
  const ids = [...new Set(productIds)];
  const result = { updated: [], unchanged: [], skipped: [] };
  for (let start = 0; start < ids.length; start += 25) {
    const chunk = ids.slice(start, start + 25);
    await withLock(COMMERCE_LOCK, async () => {
      const catalog = buildCatalog(await sheetsService.readMany(CATALOG_SHEETS, { fresh: true }));
      const now = nowIso();
      const ops = [];
      for (const id of chunk) {
        const p = catalog.productsById.get(id);
        if (!p) { result.skipped.push({ product_id: id, reason: 'Product not found' }); continue; }
        const sizeIds = splitIds(p.size_ids).filter((x) => catalog.sizesById.has(x));
        const colorIds = splitIds(p.color_ids).filter((c) => catalog.colorsById.has(c));
        const label = `${p.sku} ${p.product_name}`;
        const sellMode = requested || deriveSellMode({ hasBox: units >= 1, hasPcs: colorIds.length > 0 });
        if (allowsPcs({ sell_mode: sellMode }) && (!sizeIds.length || !colorIds.length)) {
          result.skipped.push({ product_id: id, sku: p.sku, reason: units >= 1 ? `${label}: add sizes first` : `${label}: has no colours - give it a box size` });
          continue;
        }
        if (allowsBox({ sell_mode: sellMode }) && !sizeIds.length) { result.skipped.push({ product_id: id, sku: p.sku, reason: `${label}: add sizes first (one box per size)` }); continue; }
        if (allowsBox({ sell_mode: sellMode }) && !colorIds.length) { result.skipped.push({ product_id: id, sku: p.sku, reason: `${label}: add colours first - boxes are packed from the loose pieces` }); continue; }
        const existingVariants = catalog.variantsByProduct.get(id) || [];
        const sizeMrp = new Map(Object.entries(sizeMrpsOf(existingVariants)).filter(([, m]) => m !== Number(p.mrp)));
        const unitsPerBox = allowsBox({ sell_mode: sellMode }) ? units : null;
        const desired = planVariants({
          catalog, existingVariants, sku: p.sku, sellMode, sizeIds, colorIds, sizeMrp, unitsPerBox,
        });
        try {
          checkVariantSkus(catalog, id, desired);
        } catch (err) {
          result.skipped.push({ product_id: id, sku: p.sku, reason: `${label}: ${err.message}` });
          continue;
        }
        const applied = applyVariantPlan({
          catalog, pid: id, existingVariants, desired, now, by: admin.admin_id,
        });
        const fields = { sell_mode: sellMode, units_per_box: unitsPerBox, inventory_mode: primaryInventoryMode(sellMode) };
        if (typeof pcsNew === 'boolean') fields.pcs_for_new_customers = pcsNew;
        const pd = diff(p, fields);
        if (!applied.ops.length && !Object.keys(pd.patch).length) { result.unchanged.push(p.sku); continue; }
        if (Object.keys(pd.patch).length) ops.push({ op: 'update', sheet: 'Products', id, patch: { ...pd.patch, updated_at: now, updated_by: admin.admin_id } });
        ops.push(...applied.ops);
        ops.push(auditOp({
          admin, ip, action: AUDIT_ACTION.PRODUCT_UPDATED, entity_type: 'Product', entity_id: id,
          old_value: { units_per_box: unitsPerBoxOf(p, existingVariants), pcs_for_new_customers: p.pcs_for_new_customers === true },
          new_value: {
            units_per_box: unitsPerBox, pcs_for_new_customers: fields.pcs_for_new_customers ?? (p.pcs_for_new_customers === true), new_boxes: applied.newVariants.filter(isBoxVariant).length, via: 'bulk box / pieces',
          },
        }));
        result.updated.push(p.sku);
      }
      if (ops.length) await sheetsService.commit(ops);
    });
  }
  return result;
}

/**
 * Bulk sizes for many products at once: `replace` (exactly these sizes),
 * `add` or `remove`. New sizes get new piece variants (+ one box per size
 * if the product has boxes) starting at stock 0; variants of removed sizes
 * become INACTIVE - never deleted, their stock and order history stay.
 * Prices, colours, images and everything else are untouched.
 */
export async function bulkSetSizes({ product_ids: productIds, size_ids: picked, mode = 'replace' }, { admin, ip }) {
  const ids = [...new Set(productIds)];
  const result = { updated: [], unchanged: [], skipped: [] };
  for (let start = 0; start < ids.length; start += 25) {
    const chunk = ids.slice(start, start + 25);
    await withLock(COMMERCE_LOCK, async () => {
      const catalog = buildCatalog(await sheetsService.readMany(CATALOG_SHEETS, { fresh: true }));
      for (const sid of picked) if (!catalog.sizesById.has(sid)) throw badRequest(`Unknown size ${sid}`);
      const now = nowIso();
      const ops = [];
      for (const id of chunk) {
        const p = catalog.productsById.get(id);
        if (!p) { result.skipped.push({ product_id: id, reason: 'Product not found' }); continue; }
        const label = `${p.sku} ${p.product_name}`;
        const existingVariants = catalog.variantsByProduct.get(id) || [];
        if (hasLegacyBoxes(p, existingVariants)) { result.skipped.push({ product_id: id, sku: p.sku, reason: `${label}: old-style boxes - change its sizes in the product form` }); continue; }
        const current = splitIds(p.size_ids).filter((x) => catalog.sizesById.has(x));
        const wanted = new Set(mode === 'replace' ? picked : mode === 'add' ? [...current, ...picked] : current.filter((x) => !picked.includes(x)));
        const sizeIds = catalog.sizes.filter((x) => wanted.has(x.size_id)).map((x) => x.size_id); // master order
        if (!sizeIds.length) { result.skipped.push({ product_id: id, sku: p.sku, reason: `${label}: would have no sizes left` }); continue; }
        if (sizeIds.join(',') === current.join(',')) { result.unchanged.push(p.sku); continue; }
        const sellMode = sellModeOf(p);
        const colorIds = splitIds(p.color_ids).filter((c) => catalog.colorsById.has(c));
        const unitsPerBox = allowsBox({ sell_mode: sellMode }) ? unitsPerBoxOf(p, existingVariants) : null;
        const sizeMrp = new Map(Object.entries(sizeMrpsOf(existingVariants)).filter(([sid, m]) => sizeIds.includes(sid) && m !== Number(p.mrp)));
        const desired = planVariants({
          catalog, existingVariants, sku: p.sku, sellMode, sizeIds, colorIds, sizeMrp, unitsPerBox,
        });
        try {
          checkVariantSkus(catalog, id, desired);
        } catch (err) {
          result.skipped.push({ product_id: id, sku: p.sku, reason: `${label}: ${err.message}` });
          continue;
        }
        const applied = applyVariantPlan({
          catalog, pid: id, existingVariants, desired, now, by: admin.admin_id,
        });
        const sizeName = (sid) => catalog.sizesById.get(sid)?.size_name;
        ops.push({ op: 'update', sheet: 'Products', id, patch: { size_ids: sizeIds.join(','), updated_at: now, updated_by: admin.admin_id } });
        ops.push(...applied.ops);
        ops.push(auditOp({
          admin, ip, action: AUDIT_ACTION.PRODUCT_UPDATED, entity_type: 'Product', entity_id: id,
          old_value: { sizes: current.map(sizeName) },
          new_value: { sizes: sizeIds.map(sizeName), new_variants: applied.newVariants.length, via: `bulk sizes (${mode})` },
        }));
        result.updated.push(p.sku);
      }
      if (ops.length) await sheetsService.commit(ops);
    });
  }
  return result;
}

/** size_id -> MRP for colour-wise variants that have their own (size-wise) MRP. */
export function sizeMrpsOf(variants = []) {
  const out = {};
  for (const v of variants) {
    if (v.status !== RECORD_STATUS.ACTIVE || !v.size_id) continue;
    if (Number(v.variant_mrp) > 0 && out[v.size_id] === undefined) out[v.size_id] = Number(v.variant_mrp);
  }
  return out;
}

export function inventoryRow(productId, variantId, fields, qty, status, now, by) {
  return {
    inventory_id: newId(ID_PREFIX.inventory),
    variant_id: variantId,
    product_id: productId,
    color_id: fields.color_id || '',
    size_id: fields.size_id || '',
    box_id: fields.box_id || '',
    stock_qty: qty,
    reserved_qty: 0,
    available_qty: qty,
    status: status || INVENTORY_STATUS.ACTIVE,
    updated_at: now,
    updated_by: by,
  };
}

function normalizeImageTypes(images) {
  const list = [...images].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).map((i) => ({ ...i }));
  let mainSeen = false;
  for (const img of list) {
    if (img.image_type === IMAGE_TYPE.MAIN) {
      if (mainSeen) img.image_type = IMAGE_TYPE.GALLERY;
      mainSeen = true;
    }
  }
  if (!mainSeen && list.length) list[0].image_type = IMAGE_TYPE.MAIN;
  return list;
}

function statusAction(status) {
  if (status === RECORD_STATUS.ACTIVE) return AUDIT_ACTION.PRODUCT_REACTIVATED;
  if (status === RECORD_STATUS.ARCHIVED) return AUDIT_ACTION.PRODUCT_ARCHIVED;
  return AUDIT_ACTION.PRODUCT_DEACTIVATED;
}

export async function setProductStatus(id, status, { admin, ip }) {
  const products = await sheetsService.read('Products', { fresh: true });
  const p = products.find((x) => x.product_id === id);
  if (!p) throw notFound('Product not found.');
  if (p.status === status) return p;
  const patch = { status, updated_at: nowIso(), updated_by: admin.admin_id };
  await sheetsService.commit([
    { op: 'update', sheet: 'Products', id, patch },
    auditOp({ admin, ip, action: statusAction(status), entity_type: 'Product', entity_id: id, old_value: { status: p.status }, new_value: { status } }),
  ]);
  return { ...p, ...patch };
}

export async function setProductOutOfStock(id, outOfStock, { admin, ip }) {
  const products = await sheetsService.read('Products', { fresh: true });
  const p = products.find((x) => x.product_id === id);
  if (!p) throw notFound('Product not found.');
  if (p.out_of_stock === outOfStock) return p;
  const patch = { out_of_stock: outOfStock, updated_at: nowIso(), updated_by: admin.admin_id };
  await sheetsService.commit([
    { op: 'update', sheet: 'Products', id, patch },
    auditOp({
      admin, ip,
      action: outOfStock ? AUDIT_ACTION.PRODUCT_OUT_OF_STOCK : AUDIT_ACTION.PRODUCT_STOCK_RESTORED,
      entity_type: 'Product', entity_id: id, old_value: { out_of_stock: p.out_of_stock }, new_value: { out_of_stock: outOfStock },
    }),
  ]);
  return { ...p, ...patch };
}

export async function duplicateProduct(id, { admin, ip }) {
  const catalog = await getCatalog({ fresh: true });
  const src = catalog.productsById.get(id);
  if (!src) throw notFound('Product not found.');
  const skus = new Set(catalog.products.map((p) => p.sku.toUpperCase()));
  let sku = `${src.sku}-COPY`.toUpperCase();
  for (let i = 2; skus.has(sku); i += 1) sku = `${src.sku}-COPY${i}`.toUpperCase();
  const all = catalog.variantsByProduct.get(id) || [];
  const variants = all.filter((v) => variantOffered(src, v));
  const legacy = hasLegacyBoxes(src, all);
  const input = {
    sku,
    product_name: `${src.product_name} (Copy)`,
    slug: '',
    category_id: src.category_id,
    subcategory: src.subcategory,
    description: src.description,
    mrp: src.mrp,
    discount_mode: src.discount_mode || PRODUCT_DISCOUNT_MODE.GLOBAL,
    fixed_discount_percent: src.fixed_discount_percent,
    sell_mode: sellModeOf(src),
    units_per_box: legacy ? null : unitsPerBoxOf(src, all),
    pcs_for_new_customers: src.pcs_for_new_customers === true,
    size_ids: splitIds(src.size_ids),
    size_mrps: Object.entries(sizeMrpsOf(variants)).map(([size_id, mrp]) => ({ size_id, mrp })),
    color_ids: splitIds(src.color_ids),
    boxes: legacy ? variants.filter(isBoxVariant).map((v, i) => ({
      box_id: '', key: `copy-${i}`, sku: '', size_id: v.size_id, units_per_box: v.units_per_box || 1,
      box_mrp: v.box_mrp, mixed_color_description: v.mixed_color_description, status: RECORD_STATUS.ACTIVE,
    })) : [],
    stock: [],
    images: catalog.images.filter((i) => i.product_id === id && i.status !== RECORD_STATUS.INACTIVE).map((i, idx) => ({
      image_id: '', drive_file_id: i.drive_file_id, file_url: i.file_url, image_type: i.image_type, alt_text: i.alt_text, sort_order: idx,
    })),
    status: RECORD_STATUS.INACTIVE,
    out_of_stock: false,
    featured: false,
    sort_order: src.sort_order ?? 1000,
    seo_title: '',
    seo_description: '',
  };
  return saveProduct(input, {
    admin, ip, extraAudit: [{ action: AUDIT_ACTION.PRODUCT_DUPLICATED, new_value: { source_product_id: id } }],
  });
}
