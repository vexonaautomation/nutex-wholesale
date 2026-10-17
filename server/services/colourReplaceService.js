// Replace a colour in ONE article, with its stock (e.g. Sahin Set: "Lavender"
// is called "Pink"). Per size:
//  - the article has no piece of the new colour yet -> the same variant just
//    gets the new colour (its stock, reserved pieces and ID stay as they are)
//  - the new colour is already there -> the free pieces move onto it; pieces
//    held by pending orders stay on the old colour until those orders finish
// Old orders and bills keep the colour name they were placed with. Nothing is
// deleted: a merged old colour is switched off (inactive) for this article.
import { sheetsService } from './sheetsService.js';
import { auditOp } from './auditService.js';
import { buildCatalog, splitIds } from './catalogService.js';
import { colorWiseVariantSku, getProductAdmin } from './productService.js';
import { CATALOG_SHEETS } from '../config/schema.js';
import {
  AUDIT_ACTION, INVENTORY_MODE, INVENTORY_STATUS, RECORD_STATUS,
} from '../config/constants.js';
import { withLock, COMMERCE_LOCK } from '../utils/lockManager.js';
import { nowIso } from '../utils/dates.js';
import { badRequest, notFound } from '../utils/errors.js';

const n0 = (v) => Math.max(0, Number(v) || 0);

/** What replacing `fromId` with `toId` does to this product, size by size. */
export function planColourReplace(catalog, product, fromId, toId) {
  if (!product) throw notFound('Product not found.');
  if (!fromId || !toId || fromId === toId) throw badRequest('Choose the colour to replace and a different new colour.');
  const from = catalog.colorsById.get(fromId);
  const to = catalog.colorsById.get(toId);
  if (!from) throw badRequest('Unknown colour to replace.');
  if (!to) throw badRequest('Unknown new colour.');
  if (to.status !== RECORD_STATUS.ACTIVE) throw badRequest(`${to.color_name} is switched off in Colours - switch it on first.`);
  const variants = (catalog.variantsByProduct.get(product.product_id) || []).filter((v) => v.inventory_mode === INVENTORY_MODE.COLOR_WISE);
  const old = variants.filter((v) => v.color_id === fromId);
  if (!old.length && !splitIds(product.color_ids).includes(fromId)) throw badRequest(`${product.product_name} has no ${from.color_name}.`);

  const sizes = old.map((v) => {
    const size = catalog.sizesById.get(v.size_id);
    const inv = catalog.inventoryByVariant.get(v.variant_id);
    const target = variants.find((x) => x.color_id === toId && x.size_id === v.size_id) || null;
    const targetInv = target ? catalog.inventoryByVariant.get(target.variant_id) : null;
    const stock = n0(inv?.stock_qty);
    const reserved = n0(inv?.reserved_qty);
    return {
      size_id: v.size_id,
      size_name: size?.size_name || '',
      variant_id: v.variant_id,
      inventory_id: inv?.inventory_id || '',
      active: v.status === RECORD_STATUS.ACTIVE,
      // rename = the same variant becomes the new colour; merge = pieces move onto the existing one
      action: target ? 'merge' : 'rename',
      target_variant_id: target?.variant_id || '',
      target_inventory_id: targetInv?.inventory_id || '',
      stock,
      reserved,
      move: target ? Math.max(0, stock - reserved) : stock,
      new_stock: target ? n0(targetInv?.stock_qty) + Math.max(0, stock - reserved) : stock,
      new_sku: target ? target.sku : colorWiseVariantSku(product.sku, to, size || { size_name: '' }),
      sizeRef: size,
    };
  });
  const sku = new Set(sizes.filter((s) => s.action === 'rename').map((s) => s.new_sku));
  const clash = catalog.variants.find((v) => v.status === RECORD_STATUS.ACTIVE && sku.has(v.sku) && !old.some((o) => o.variant_id === v.variant_id));
  if (clash) throw badRequest(`Variant SKU ${clash.sku} is already used - change the colour code of ${to.color_name} in Colours.`);
  return {
    product_id: product.product_id,
    sku: product.sku,
    product_name: product.product_name,
    from: { color_id: from.color_id, color_name: from.color_name, hex_code: from.hex_code },
    to: { color_id: to.color_id, color_name: to.color_name, hex_code: to.hex_code },
    new_colour_already_there: splitIds(product.color_ids).includes(toId),
    sizes: sizes.map(({ sizeRef, ...s }) => s),
    pieces_moved: sizes.reduce((s, x) => s + x.move, 0),
    pieces_held: sizes.filter((x) => x.action === 'merge').reduce((s, x) => s + x.reserved, 0),
  };
}

export async function previewColourReplace(productId, { from, to }) {
  const catalog = buildCatalog(await sheetsService.readMany(CATALOG_SHEETS, { fresh: true }));
  return planColourReplace(catalog, catalog.productsById.get(productId), from, to);
}

export async function replaceProductColour(productId, { from_color_id: fromId, to_color_id: toId }, { admin, ip }) {
  return withLock(COMMERCE_LOCK, async () => {
    const catalog = buildCatalog(await sheetsService.readMany(CATALOG_SHEETS, { fresh: true }));
    const product = catalog.productsById.get(productId);
    const plan = planColourReplace(catalog, product, fromId, toId);
    const now = nowIso();
    const by = admin.admin_id;
    const ops = [];
    for (const s of plan.sizes) {
      if (s.action === 'rename') {
        ops.push({ op: 'update', sheet: 'Product_Variants', id: s.variant_id, patch: { color_id: toId, sku: s.new_sku, updated_at: now } });
        if (s.inventory_id) ops.push({ op: 'update', sheet: 'Inventory', id: s.inventory_id, patch: { color_id: toId, updated_at: now, updated_by: by } });
        continue;
      }
      // merge: free pieces onto the new colour; held pieces stay for their orders
      const target = catalog.inventoryByVariant.get(s.target_variant_id);
      const targetVariant = catalog.variants.find((v) => v.variant_id === s.target_variant_id);
      if (s.move > 0 && target) {
        const stock = n0(target.stock_qty) + s.move;
        ops.push({
          op: 'update', sheet: 'Inventory', id: target.inventory_id,
          patch: { stock_qty: stock, available_qty: stock - n0(target.reserved_qty), status: INVENTORY_STATUS.ACTIVE, updated_at: now, updated_by: by },
        });
      }
      if (s.inventory_id) {
        ops.push({ op: 'update', sheet: 'Inventory', id: s.inventory_id, patch: { stock_qty: s.reserved, available_qty: 0, updated_at: now, updated_by: by } });
      }
      if (s.active && targetVariant?.status !== RECORD_STATUS.ACTIVE) {
        ops.push({ op: 'update', sheet: 'Product_Variants', id: s.target_variant_id, patch: { status: RECORD_STATUS.ACTIVE, updated_at: now } });
      }
      ops.push({ op: 'update', sheet: 'Product_Variants', id: s.variant_id, patch: { status: RECORD_STATUS.INACTIVE, updated_at: now } });
    }
    // the article's colour list: the new colour takes the old one's place
    const colours = splitIds(product.color_ids);
    const next = colours.includes(toId) ? colours.filter((c) => c !== fromId) : colours.map((c) => (c === fromId ? toId : c));
    const patch = { color_ids: next.join(','), updated_at: now, updated_by: by };
    if (product.box_extra_color === fromId) patch.box_extra_color = toId;
    ops.push({ op: 'update', sheet: 'Products', id: productId, patch });
    ops.push(auditOp({
      admin, ip, action: AUDIT_ACTION.PRODUCT_UPDATED, entity_type: 'Product', entity_id: productId,
      old_value: { colour: plan.from.color_name },
      new_value: {
        colour: plan.to.color_name, pieces_moved: plan.pieces_moved, pieces_held: plan.pieces_held,
        sizes: plan.sizes.map((s) => `${s.size_name}: ${s.action} ${s.move}`),
      },
      notes: `Colour replaced in ${product.sku}: ${plan.from.color_name} -> ${plan.to.color_name}`,
    }));
    await sheetsService.commit(ops);
    return { ...plan, product: await getProductAdmin(productId) };
  });
}
