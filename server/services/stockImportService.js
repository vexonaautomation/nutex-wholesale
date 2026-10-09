// Bulk stock update with Excel (Admin > Inventory > "Bulk update (Excel)").
//
//  1. Download the stock sheet: one row per colour + size (stock is entered in
//     pieces only - boxes are packed from these pieces automatically).
//  2. In Excel fill   new_stock  = the counted stock (replaces it), or
//                     add_stock  = pieces/boxes received (added to it).
//     Leave both blank for rows that do not change.
//  3. Upload the CSV: a preview lists every change and every problem; nothing
//     is written until "Apply".
//
// Only the stock cells of the listed rows change (by immutable inventory_id),
// with an Audit_Log entry. Rows whose stock changed after the sheet was
// downloaded (e.g. a paid order) are skipped for new_stock, so a count never
// overwrites a later sale; add_stock is always added to the live stock.
import { sheetsService } from './sheetsService.js';
import { auditOp } from './auditService.js';
import { listInventory } from './inventoryService.js';
import { withLock, COMMERCE_LOCK } from '../utils/lockManager.js';
import { AUDIT_ACTION, INVENTORY_MODE, RECORD_STATUS } from '../config/constants.js';
import { toCsv, detectDelimiter, parseCsvLine } from '../utils/csv.js';
import { badRequest } from '../utils/errors.js';
import { nowIso, istDate } from '../utils/dates.js';

export const STOCK_SHEET_COLUMNS = [
  'inventory_id', 'category', 'product_sku', 'product_name', 'type', 'colour', 'size', 'pcs_per_box',
  'current_stock', 'reserved', 'new_stock', 'add_stock', 'note',
];
const MAX_ROWS = 20000;
const CHUNK = 400;

const n0 = (v) => Math.max(0, Math.floor(Number(v) || 0));
const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const typeOf = (row) => (row.inventory_mode === INVENTORY_MODE.BOX_WISE ? 'BOX' : 'PCS');
// product SKU + PCS/BOX + colour (none for boxes) + size identifies an item
const itemKey = (sku, type, colour, size) => {
  const t = norm(type) === 'box' ? 'box' : 'pcs';
  return [norm(sku), t, t === 'box' ? '' : norm(colour), norm(size)].join('|');
};

// rows that take a stock number: loose pieces (+ old-style boxes with own stock)
const takesStock = (r) => !r.auto_box;

async function stockRows() {
  const { items } = await listInventory();
  return items
    .filter((r) => r.offered && r.product_status !== RECORD_STATUS.ARCHIVED)
    .sort((a, b) => String(a.category_name).localeCompare(String(b.category_name))
      || a.product_name.localeCompare(b.product_name)
      || typeOf(b).localeCompare(typeOf(a)) // loose pieces first, then boxes
      || String(a.color_name).localeCompare(String(b.color_name))
      || (parseFloat(a.size_name) || 0) - (parseFloat(b.size_name) || 0));
}

/** The sheet the admin downloads, fills in Excel and uploads again. */
export async function stockSheetCsv() {
  const rows = (await stockRows()).filter(takesStock).map((r) => ({
    inventory_id: r.inventory_id,
    category: r.category_name,
    product_sku: r.product_sku,
    product_name: r.product_name,
    type: typeOf(r),
    colour: typeOf(r) === 'BOX' ? 'Mix' : r.color_name,
    size: r.size_name,
    pcs_per_box: typeOf(r) === 'BOX' ? r.units_per_box : '',
    current_stock: r.stock_qty,
    reserved: r.reserved_qty,
    new_stock: '',
    add_stock: '',
    note: typeOf(r) === 'BOX' ? 'Old-style box (own box stock)' : '',
  }));
  return { csv: toCsv(STOCK_SHEET_COLUMNS, rows), filename: `nutex-stock-${istDate()}.csv`, rows: rows.length };
}

// ------------------------------------------------------------ reading the file
const HEADER_ALIASES = {
  inventory_id: ['inventory_id', 'inventory id', 'id'],
  product_sku: ['product_sku', 'product sku', 'sku', 'style', 'style no', 'article'],
  type: ['type', 'pcs/box', 'unit'],
  colour: ['colour', 'color'],
  size: ['size'],
  current_stock: ['current_stock', 'current stock', 'current'],
  new_stock: ['new_stock', 'new stock', 'stock', 'count', 'closing stock'],
  add_stock: ['add_stock', 'add stock', 'add', 'received', 'inward'],
};
const fieldOf = (header) => {
  const h = norm(header).replace(/^'/, '');
  return Object.keys(HEADER_ALIASES).find((k) => HEADER_ALIASES[k].includes(h)) || null;
};
const clean = (v) => String(v ?? '').trim().replace(/^'/, '');

export function parseStockSheet(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw badRequest('The file is empty.');
  if (lines.length > MAX_ROWS + 1) throw badRequest(`Too many rows (max ${MAX_ROWS}).`);
  const delimiter = detectDelimiter(lines[0]);
  const fields = parseCsvLine(lines[0], delimiter).map(fieldOf);
  if (!fields.includes('new_stock') && !fields.includes('add_stock')) {
    throw badRequest('Column "new_stock" or "add_stock" not found. Please use the downloaded stock sheet and keep its first row (headings).');
  }
  if (!fields.includes('inventory_id') && !(fields.includes('product_sku') && fields.includes('size'))) {
    throw badRequest('Keep the "inventory_id" column (or product_sku + colour + size) so each row can be matched.');
  }
  return lines.slice(1).map((line, i) => {
    const cells = parseCsvLine(line, delimiter);
    const row = { line: i + 2 };
    fields.forEach((f, k) => { if (f && row[f] === undefined) row[f] = clean(cells[k]); });
    return row;
  });
}

const parseQty = (v) => {
  const s = String(v ?? '').replace(/,/g, '').trim();
  if (s === '') return null;
  if (!/^\d+(\.0+)?$/.test(s)) return NaN;
  return Math.round(Number(s));
};

/**
 * Works out every change from the uploaded sheet against the LIVE stock.
 * Returns { changes, unchanged, errors, skipped_blank } - nothing is written.
 */
function planImport(parsed, invRows, catalogRows, { isPending = null } = {}) {
  const byId = new Map(invRows.map((r) => [r.inventory_id, r]));
  const byItem = new Map();
  const byProduct = new Map(); // product_id + type + colour + size (SKU may change in the same upload)
  for (const r of catalogRows) {
    const k = itemKey(r.product_sku, typeOf(r), r.color_name, r.size_name);
    byItem.set(k, byItem.has(k) ? 'AMBIGUOUS' : r.inventory_id);
    byProduct.set(`${r.product_id}|${itemKey('', typeOf(r), r.color_name, r.size_name)}`, r.inventory_id);
  }
  const pending = [];
  const info = new Map(catalogRows.map((r) => [r.inventory_id, r]));
  const seen = new Set();
  const changes = [];
  const errors = [];
  let unchanged = 0;
  let blank = 0;

  for (const row of parsed) {
    const setQty = parseQty(row.new_stock);
    const addQty = parseQty(row.add_stock);
    if (setQty === null && addQty === null) { blank += 1; continue; }
    const err = (message) => errors.push({ line: row.line, item: [row.product_sku, row.colour, row.size].filter(Boolean).join(' · '), message });
    let id = row.inventory_id && byId.has(row.inventory_id) ? row.inventory_id : null;
    if (!id && row.product_id) id = byProduct.get(`${row.product_id}|${itemKey('', row.type || 'PCS', row.colour, row.size)}`) || null;
    if (!id && row.product_sku) {
      const found = byItem.get(itemKey(row.product_sku, row.type || 'PCS', row.colour, row.size));
      if (found === 'AMBIGUOUS') { err('More than one item matches - keep the inventory_id column.'); continue; }
      id = found || null;
    }
    if (!id && isPending?.(row)) { pending.push({ line: row.line, item: [row.product_sku, row.colour, row.size].filter(Boolean).join(' · ') }); continue; }
    if (!id) { err('Item not found. Use a freshly downloaded stock sheet.'); continue; }
    if (seen.has(id)) { err('This item appears twice in the file.'); continue; }
    seen.add(id);
    if (Number.isNaN(setQty) || Number.isNaN(addQty)) { err('Enter whole numbers only (0, 1, 2 ...).'); continue; }
    if (setQty !== null && addQty !== null) { err('Fill either new_stock or add_stock, not both.'); continue; }

    if (!takesStock(info.get(id) || {})) { err('Box stock is not entered - boxes are packed from the loose pieces. Enter pieces (colour + size) only.'); continue; }
    const inv = byId.get(id);
    const live = n0(inv.stock_qty);
    const reserved = n0(inv.reserved_qty);
    const meta = info.get(id) || {};
    if (setQty !== null) {
      const seenStock = parseQty(row.current_stock);
      if (seenStock !== null && !Number.isNaN(seenStock) && seenStock !== live) {
        err(`Stock changed after you downloaded the sheet (${seenStock} → ${live}, e.g. a paid order). Download the sheet again for this item.`);
        continue;
      }
    }
    const target = setQty !== null ? setQty : live + addQty;
    if (target > 10000000) { err('Quantity is too large.'); continue; }
    if (target < reserved) { err(`Cannot be lower than ${reserved} reserved by unpaid orders.`); continue; }
    if (target === live) { unchanged += 1; continue; }
    changes.push({
      line: row.line,
      inventory_id: id,
      variant_id: inv.variant_id,
      product_name: meta.product_name,
      product_sku: meta.product_sku,
      type: meta.inventory_mode ? typeOf(meta) : '',
      colour: meta.inventory_mode && typeOf(meta) === 'BOX' ? 'Mix' : meta.color_name,
      size: meta.size_name,
      from: live,
      to: target,
      mode: setQty !== null ? 'set' : 'add',
    });
  }
  return {
    changes, unchanged, errors, pending, skipped_blank: blank,
  };
}

/** Preview (apply = false) or apply the uploaded stock sheet. */
export async function importStockSheet(text, opts = {}) {
  return importStockRows(parseStockSheet(text), opts);
}

/**
 * Preview / apply already-read stock rows ({ line, inventory_id?, product_id?,
 * product_sku?, type?, colour, size, current_stock?, new_stock?, add_stock? }).
 * `isPending(row)` marks rows for items that are about to be created (e.g.
 * a size added in the same bulk edit) instead of reporting them as unknown.
 */
export async function importStockRows(parsed, {
  apply = false, admin, ip, isPending = null,
} = {}) {
  const run = async () => {
    const [invRows, catalogRows] = await Promise.all([sheetsService.read('Inventory', { fresh: true }), stockRows()]);
    const plan = planImport(parsed, invRows, catalogRows, { isPending });
    const summary = {
      rows: parsed.length,
      to_change: plan.changes.length,
      unchanged: plan.unchanged,
      blank: plan.skipped_blank,
      pending: plan.pending,
      errors: plan.errors,
      changes: plan.changes.map(({ variant_id: _v, ...c }) => c),
    };
    if (!apply || !plan.changes.length) return { ...summary, applied: 0 };

    const now = nowIso();
    const byId = new Map(invRows.map((r) => [r.inventory_id, r]));
    for (let i = 0; i < plan.changes.length; i += CHUNK) {
      const part = plan.changes.slice(i, i + CHUNK);
      const ops = part.map((c) => ({
        op: 'update',
        sheet: 'Inventory',
        id: c.inventory_id,
        patch: { stock_qty: c.to, available_qty: c.to - n0(byId.get(c.inventory_id).reserved_qty), updated_at: now, updated_by: admin.admin_id },
      }));
      ops.push(auditOp({
        admin, ip, action: AUDIT_ACTION.INVENTORY_UPDATED, entity_type: 'Inventory',
        entity_id: `bulk:${part.length}`,
        old_value: part.map((c) => ({ id: c.inventory_id, stock_qty: c.from })),
        new_value: part.map((c) => ({ id: c.inventory_id, stock_qty: c.to })),
        notes: `Bulk stock upload (Excel), rows ${i + 1}-${i + part.length} of ${plan.changes.length}`,
      }));
      await sheetsService.commit(ops);
    }
    return { ...summary, applied: plan.changes.length };
  };
  // applying holds the commerce lock so no order changes stock in between
  return apply ? withLock(COMMERCE_LOCK, run) : run();
}
