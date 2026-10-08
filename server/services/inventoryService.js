import { sheetsService } from './sheetsService.js';
import { auditOp } from './auditService.js';
import { withLock, COMMERCE_LOCK } from '../utils/lockManager.js';
import { conflict, badRequest } from '../utils/errors.js';
import { nowIso } from '../utils/dates.js';
import { AUDIT_ACTION, INVENTORY_MODE, INVENTORY_STATUS } from '../config/constants.js';
import { getSettings } from './settingsService.js';
import { buildCatalog } from './catalogService.js';
import { CATALOG_SHEETS } from '../config/schema.js';
import { describeVariant } from './quoteService.js';
import { sellModeOf, variantOffered, isBoxVariant } from '../utils/sellMode.js';
import { autoBoxInfo } from '../utils/stockValidator.js';

const SHEET = 'Inventory';
const n0 = (v) => Math.max(0, Math.floor(Number(v) || 0));

/**
 * Builds Inventory update operations for stock movements caused by orders.
 * deltas: Map(variant_id -> { stock: +/-n, reserved: +/-n })
 * Never lets stock or reservations go negative. When `clamp` is false a
 * shortfall throws STOCK_CHANGED; when true it is clamped at 0 and reported.
 */
export function inventoryDeltaOps(inventoryRows, deltas, { by = 'SYSTEM', clamp = false } = {}) {
  const byVariant = new Map(inventoryRows.map((r) => [r.variant_id, r]));
  const now = nowIso();
  const ops = [];
  const shortfalls = [];
  for (const [variantId, d] of deltas) {
    if (!d.stock && !d.reserved) continue;
    const inv = byVariant.get(variantId);
    if (!inv) {
      shortfalls.push({ variant_id: variantId, reason: 'missing inventory row' });
      if (!clamp) throw conflict('STOCK_CHANGED', 'Stock has changed. Please review your cart.', { variant_id: variantId });
      continue;
    }
    let stock = n0(inv.stock_qty) + (d.stock || 0);
    let reserved = n0(inv.reserved_qty) + (d.reserved || 0);
    if (stock < 0 || reserved < 0 || reserved > stock) {
      shortfalls.push({ variant_id: variantId, stock, reserved });
      if (!clamp) throw conflict('STOCK_CHANGED', 'Stock has changed. Please review your cart.', { variant_id: variantId });
      stock = Math.max(0, stock);
      reserved = Math.min(Math.max(0, reserved), stock);
    }
    ops.push({
      op: 'update',
      sheet: SHEET,
      id: inv.inventory_id,
      patch: { stock_qty: stock, reserved_qty: reserved, available_qty: stock - reserved, updated_at: now, updated_by: by },
    });
  }
  return { ops, shortfalls };
}

export async function listInventory({ product_id, filter } = {}) {
  const data = await sheetsService.readMany(CATALOG_SHEETS, { fresh: true });
  const catalog = buildCatalog(data);
  const threshold = Number(catalog.settings.low_stock_threshold) || 0;
  const rows = [];
  for (const inv of catalog.inventory) {
    if (product_id && inv.product_id !== product_id) continue;
    const variant = catalog.variantsById.get(inv.variant_id);
    const product = catalog.productsById.get(inv.product_id);
    if (!variant || !product) continue;
    const d = describeVariant(catalog, product, variant);
    const stock = n0(inv.stock_qty);
    const reserved = n0(inv.reserved_qty);
    const available = Math.max(0, stock - reserved);
    // box with no box stock: packed from the colours' loose stock
    const auto = isBoxVariant(variant) ? autoBoxInfo(catalog, product, variant) : null;
    const row = {
      inventory_id: inv.inventory_id,
      variant_id: inv.variant_id,
      product_id: product.product_id,
      product_name: product.product_name,
      category_name: catalog.categoriesById.get(product.category_id)?.category_name || '',
      product_sku: product.sku,
      product_status: product.status,
      product_out_of_stock: product.out_of_stock,
      inventory_mode: variant.inventory_mode,
      product_sell_mode: sellModeOf(product),
      offered: variantOffered(product, variant),
      variant_status: variant.status,
      sku: variant.sku,
      color_id: variant.color_id,
      color_name: d.color_name,
      hex_code: d.hex_code,
      size_id: variant.size_id,
      size_name: d.size_name,
      box_id: variant.box_id,
      units_per_box: d.units_per_box,
      mixed_color_description: d.mixed_color_description,
      stock_qty: stock,
      reserved_qty: reserved,
      available_qty: available,
      status: inv.status || INVENTORY_STATUS.ACTIVE,
      auto_box: auto,
      // an auto box follows its colours, whose own rows carry the low / out signal
      low_stock: !auto?.ok && available > 0 && available <= threshold,
      out_of_stock: !auto?.ok && (available <= 0 || inv.status === INVENTORY_STATUS.OUT_OF_STOCK),
      updated_at: inv.updated_at,
    };
    if (filter === 'low' && !row.low_stock) continue;
    if (filter === 'out' && !row.out_of_stock) continue;
    rows.push(row);
  }
  rows.sort((a, b) => a.product_name.localeCompare(b.product_name) || a.color_name.localeCompare(b.color_name));
  return { threshold, items: rows };
}

/**
 * Admin stock edits. Only rows listed in `updates` are touched, and only the
 * stock/status cells of those rows. `expected_stock_qty` (value shown to the
 * admin when the page loaded) protects against overwriting a change made by a
 * concurrent order in the meantime.
 */
export async function applyStockUpdates(updates, { admin, ip }) {
  return withLock(COMMERCE_LOCK, async () => {
    const rows = await sheetsService.read(SHEET, { fresh: true });
    const byId = new Map(rows.map((r) => [r.inventory_id, r]));
    const now = nowIso();
    const ops = [];
    const conflicts = [];
    const changes = [];
    for (const u of updates) {
      const inv = byId.get(u.inventory_id);
      if (!inv) throw badRequest(`Inventory record ${u.inventory_id} not found`);
      const patch = {};
      const reserved = n0(inv.reserved_qty);
      if (u.stock_qty !== undefined && u.stock_qty !== n0(inv.stock_qty)) {
        if (u.expected_stock_qty !== null && u.expected_stock_qty !== undefined && u.expected_stock_qty !== n0(inv.stock_qty)) {
          conflicts.push({ inventory_id: inv.inventory_id, expected: u.expected_stock_qty, actual: n0(inv.stock_qty) });
          continue;
        }
        if (u.stock_qty < reserved) {
          throw badRequest(`Stock cannot be lower than ${reserved} unit(s) reserved by pending orders (${inv.variant_id}).`);
        }
        patch.stock_qty = u.stock_qty;
        patch.available_qty = u.stock_qty - reserved;
      }
      if (u.status && u.status !== (inv.status || INVENTORY_STATUS.ACTIVE)) patch.status = u.status;
      if (!Object.keys(patch).length) continue;
      patch.updated_at = now;
      patch.updated_by = admin.admin_id;
      ops.push({ op: 'update', sheet: SHEET, id: inv.inventory_id, patch });
      changes.push({ inventory_id: inv.inventory_id, variant_id: inv.variant_id, from: { stock_qty: n0(inv.stock_qty), status: inv.status }, to: patch });
    }
    if (conflicts.length) {
      throw conflict('STOCK_CONFLICT', 'Stock was changed by another order or user since you loaded this page. Please refresh and re-enter.', { conflicts });
    }
    if (!ops.length) return { updated: 0 };
    ops.push(auditOp({
      admin, ip, action: AUDIT_ACTION.INVENTORY_UPDATED, entity_type: 'Inventory',
      entity_id: [...new Set(changes.map((c) => c.variant_id))].slice(0, 20).join(','),
      old_value: changes.map((c) => ({ id: c.inventory_id, ...c.from })),
      new_value: changes.map((c) => ({ id: c.inventory_id, stock_qty: c.to.stock_qty, status: c.to.status })),
    }));
    await sheetsService.commit(ops);
    return { updated: changes.length };
  });
}

export async function inventorySummary() {
  const settings = await getSettings();
  const { items } = await listInventory();
  const live = items.filter((i) => i.offered && i.product_status === 'ACTIVE');
  return {
    threshold: settings.low_stock_threshold,
    low_stock: live.filter((i) => i.low_stock),
    out_of_stock: live.filter((i) => i.out_of_stock),
    color_wise: live.filter((i) => i.inventory_mode === INVENTORY_MODE.COLOR_WISE).length,
    box_wise: live.filter((i) => i.inventory_mode === INVENTORY_MODE.BOX_WISE).length,
  };
}
