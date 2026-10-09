// Bulk product edit with Excel (Admin > Products > "Bulk edit (Excel)").
//
//  1. Download a pre-filled .xlsx:
//       "Products" - one row per product: SKU, name, category, MRP, own
//                    discount %, pieces per box, loose pieces for new
//                    customers, sizes ("32, 34, 36"), colours ("Coral, Maroon"),
//                    size-wise MRP ("42=165, 44=170"), status, featured
//       "Stock"    - one row per colour + size (pieces) with current stock;
//                    fill new_stock / add_stock only where it changes
//       "Lists"    - the categories, sizes and colours that can be used
//  2. Edit in Excel: delete a size / colour from the text to remove it, type
//     one to add it; add Stock rows for new sizes in the same file.
//  3. Upload: preview of every change and problem; nothing is written until
//     Apply.
//
// Safety: products are located by their immutable product_id and only the
// cells that changed are written (images, description, slug, SEO untouched).
// Removed sizes / colours become INACTIVE variants - never deleted, stock and
// order history stay. Every product change gets an Audit_Log entry.
import ExcelJS from 'exceljs';
import { sheetsService } from './sheetsService.js';
import { auditOp } from './auditService.js';
import { buildCatalog, splitIds } from './catalogService.js';
import {
  planVariants, checkVariantSkus, applyVariantPlan, sizeMrpsOf, unitsPerBoxOf, hasLegacyBoxes,
} from './productService.js';
import { listInventory } from './inventoryService.js';
import { importStockRows } from './stockImportService.js';
import { CATALOG_SHEETS } from '../config/schema.js';
import { AUDIT_ACTION, PRODUCT_DISCOUNT_MODE, RECORD_STATUS } from '../config/constants.js';
import { deriveSellMode, primaryInventoryMode } from '../utils/sellMode.js';
import { withLock, COMMERCE_LOCK } from '../utils/lockManager.js';
import { badRequest } from '../utils/errors.js';
import { nowIso, istDate } from '../utils/dates.js';

const CHUNK = 25;
const SKU_RE = /^[A-Z0-9][A-Z0-9_./-]*$/;
const PRODUCT_COLUMNS = [
  ['product_id', 'product_id (do not change)', 26],
  ['sku', 'sku', 18],
  ['product_name', 'product_name', 26],
  ['category', 'category', 26],
  ['mrp', 'mrp', 9],
  ['own_discount_percent', 'own_discount_% (blank = default)', 14],
  ['pieces_per_box', 'pieces_per_box (blank = no box)', 14],
  ['pcs_for_new_customers', 'loose_pcs_for_new_customers', 14],
  ['sizes', 'sizes', 34],
  ['colours', 'colours', 34],
  ['size_mrp', 'size_mrp (e.g. 42=165, 44=170)', 24],
  ['status', 'status', 11],
  ['featured', 'featured', 10],
];
const STOCK_COLUMNS = [
  ['product_id', 'product_id', 26],
  ['product_sku', 'product_sku', 18],
  ['product_name', 'product_name', 26],
  ['colour', 'colour', 16],
  ['size', 'size', 9],
  ['current_stock', 'current_stock (do not change)', 14],
  ['reserved', 'reserved', 10],
  ['new_stock', 'new_stock', 11],
  ['add_stock', 'add_stock', 11],
];

const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const list = (v) => String(v ?? '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
const yes = (v) => /^(y|yes|true|1|haan|ha)$/i.test(String(v ?? '').trim());
const yesNoBlank = (v) => (String(v ?? '').trim() === '' ? null : yes(v));
const money = (v) => Math.round(Number(v) * 100) / 100;

// sheet values may be blank where the code means false / GLOBAL / null
const BOOLEAN_FIELDS = new Set(['pcs_for_new_customers', 'featured']);
const NUMBER_FIELDS = new Set(['mrp', 'fixed_discount_percent', 'units_per_box']);
const asNum = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
export function sameValue(key, a, b) {
  if (BOOLEAN_FIELDS.has(key)) return (a === true || String(a).toLowerCase() === 'true') === (b === true || String(b).toLowerCase() === 'true');
  if (key === 'discount_mode') return (a || PRODUCT_DISCOUNT_MODE.GLOBAL) === (b || PRODUCT_DISCOUNT_MODE.GLOBAL);
  if (NUMBER_FIELDS.has(key)) return asNum(a) === asNum(b);
  return String(a ?? '') === String(b ?? '');
}

// ------------------------------------------------------------------ download
export async function bulkEditWorkbook({ productIds = [] } = {}) {
  const [data, inventory] = await Promise.all([sheetsService.readMany(CATALOG_SHEETS, { fresh: true }), listInventory()]);
  const catalog = buildCatalog(data);
  const only = new Set(productIds);
  const products = catalog.products
    .filter((p) => p.status !== RECORD_STATUS.ARCHIVED && (!only.size || only.has(p.product_id)))
    .sort((a, b) => String(catalog.categoriesById.get(a.category_id)?.category_name).localeCompare(String(catalog.categoriesById.get(b.category_id)?.category_name))
      || a.product_name.localeCompare(b.product_name));
  const sizeName = (id) => catalog.sizesById.get(id)?.size_name;
  const colourName = (id) => catalog.colorsById.get(id)?.color_name;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Nutex Wholesale';
  wb.created = new Date();
  const header = (ws, cols) => {
    ws.columns = cols.map(([key, label, width]) => ({ key, header: label, width }));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5A1A3A' } };
    ws.getRow(1).alignment = { vertical: 'middle', wrapText: true };
    ws.getRow(1).height = 32;
    ws.views = [{ state: 'frozen', ySplit: 1, xSplit: 3 }];
  };

  // Products
  const ps = wb.addWorksheet('Products');
  header(ps, PRODUCT_COLUMNS);
  for (const p of products) {
    const variants = catalog.variantsByProduct.get(p.product_id) || [];
    const sizeMrp = sizeMrpsOf(variants);
    ps.addRow({
      product_id: p.product_id,
      sku: p.sku,
      product_name: p.product_name,
      category: catalog.categoriesById.get(p.category_id)?.category_name || '',
      mrp: Number(p.mrp) || 0,
      own_discount_percent: p.discount_mode === PRODUCT_DISCOUNT_MODE.CUSTOM ? Number(p.fixed_discount_percent) : '',
      pieces_per_box: unitsPerBoxOf(p, variants) || '',
      pcs_for_new_customers: p.pcs_for_new_customers === true ? 'Yes' : 'No',
      sizes: catalog.sizes.filter((s) => splitIds(p.size_ids).includes(s.size_id)).map((s) => s.size_name).join(', '),
      colours: catalog.colors.filter((c) => splitIds(p.color_ids).includes(c.color_id)).map((c) => c.color_name).join(', '),
      size_mrp: Object.entries(sizeMrp).filter(([, m]) => m !== Number(p.mrp)).map(([sid, m]) => `${sizeName(sid)}=${m}`).join(', '),
      status: p.status === RECORD_STATUS.ACTIVE ? 'Active' : 'Inactive',
      featured: p.featured === true ? 'Yes' : 'No',
    });
  }
  ps.getColumn('product_id').font = { color: { argb: 'FF8A7A84' } };

  // Lists (sources for the dropdowns)
  const ls = wb.addWorksheet('Lists');
  const cats = catalog.categories.filter((c) => c.status === RECORD_STATUS.ACTIVE).map((c) => c.category_name);
  const sizes = catalog.sizes.filter((s) => s.status === RECORD_STATUS.ACTIVE).map((s) => s.size_name);
  const colours = catalog.colors.filter((c) => c.status === RECORD_STATUS.ACTIVE).map((c) => c.color_name);
  ls.columns = [{ header: 'Categories', key: 'a', width: 30 }, { header: 'Sizes', key: 'b', width: 14 }, { header: 'Colours', key: 'c', width: 22 }];
  ls.getRow(1).font = { bold: true };
  for (let i = 0; i < Math.max(cats.length, sizes.length, colours.length); i += 1) ls.addRow({ a: cats[i] ?? '', b: sizes[i] ?? '', c: colours[i] ?? '' });

  const last = Math.max(products.length + 200, 400);
  const col = (key) => ps.getColumn(key).letter;
  ps.dataValidations.add(`${col('category')}2:${col('category')}${last}`, { type: 'list', allowBlank: false, formulae: [`Lists!$A$2:$A$${cats.length + 1}`] });
  for (const key of ['pcs_for_new_customers', 'featured']) ps.dataValidations.add(`${col(key)}2:${col(key)}${last}`, { type: 'list', allowBlank: true, formulae: ['"Yes,No"'] });
  ps.dataValidations.add(`${col('status')}2:${col('status')}${last}`, { type: 'list', allowBlank: true, formulae: ['"Active,Inactive"'] });

  // Stock (pieces only - boxes are packed from them)
  const ss = wb.addWorksheet('Stock');
  header(ss, STOCK_COLUMNS);
  const ids = new Set(products.map((p) => p.product_id));
  const rows = inventory.items
    .filter((r) => ids.has(r.product_id) && r.offered && !r.auto_box && r.inventory_mode !== 'BOX_WISE')
    .sort((a, b) => a.product_name.localeCompare(b.product_name) || String(a.color_name).localeCompare(String(b.color_name))
      || (parseFloat(a.size_name) || 0) - (parseFloat(b.size_name) || 0) || String(a.size_name).localeCompare(String(b.size_name)));
  for (const r of rows) {
    ss.addRow({
      product_id: r.product_id, product_sku: r.product_sku, product_name: r.product_name, colour: r.color_name, size: r.size_name,
      current_stock: r.stock_qty, reserved: r.reserved_qty, new_stock: null, add_stock: null,
    });
  }
  ss.getColumn('current_stock').font = { color: { argb: 'FF8A7A84' } };

  // How to use
  const hs = wb.addWorksheet('How to use');
  hs.getColumn(1).width = 120;
  [
    'BULK EDIT - Nutex Wholesale',
    '',
    'Products tab (one row per product):',
    '  - Do not change product_id. Change any other cell; leave a cell as it is to keep it.',
    '  - sizes / colours: comma separated. Delete a size or colour from the text to remove it, type one to add it.',
    '    Use the names from the Lists tab (add new sizes or colours in Admin first).',
    '  - pieces_per_box: blank = no box. Boxes are always packed from the loose pieces (stock is entered in pieces only).',
    '  - own_discount_%: blank = the default discount from Settings.',
    '  - size_mrp: only if bigger sizes cost more, e.g. 42=165, 44=170.',
    '  - status: Active / Inactive.  featured and loose_pcs_for_new_customers: Yes / No.',
    '',
    'Stock tab (optional - pieces):',
    '  - new_stock = the stock you counted (replaces it); add_stock = pieces received (added). Leave both blank to keep the stock.',
    '  - For a size or colour you add in the Products tab, add a Stock row (product_id, colour, size, new_stock) - it is set after the size is created.',
    '',
    'Upload the file in Admin > Products > Bulk edit (Excel). You will see every change first; nothing is saved until you click Apply.',
    'Removed sizes and colours are switched off, never deleted - their stock and old orders stay. Images and descriptions are not changed.',
  ].forEach((t, i) => { hs.getCell(i + 1, 1).value = t; if (i === 0) hs.getCell(1, 1).font = { bold: true, size: 14 }; });

  wb.views = [{ activeTab: 0 }];
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, filename: `nutex-products-${istDate()}.xlsx`, products: products.length, stock_rows: rows.length };
}

// ------------------------------------------------------------------ reading
function cellText(cell) {
  const v = cell?.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('').trim();
    if ('result' in v) return String(v.result ?? '').trim();
    if ('text' in v) return String(v.text ?? '').trim();
    if (v instanceof Date) return v.toISOString();
    return String(v).trim();
  }
  return String(v).trim().replace(/^'/, '');
}

function readSheet(ws, columns) {
  if (!ws) return [];
  const headerRow = ws.getRow(1);
  const byLabel = new Map(columns.map(([key, label]) => [norm(label), key]));
  const keys = {};
  headerRow.eachCell((cell, colNumber) => {
    const h = norm(cellText(cell));
    const key = byLabel.get(h) || columns.find(([k]) => norm(k) === h || h.startsWith(`${norm(k)} `) || h.startsWith(norm(k)))?.[0];
    if (key && !(key in keys)) keys[key] = colNumber;
  });
  const out = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const r = { line: rowNumber };
    for (const [key, colNumber] of Object.entries(keys)) r[key] = cellText(row.getCell(colNumber));
    if (Object.entries(r).some(([k, v]) => k !== 'line' && v !== '')) out.push(r);
  });
  return out;
}

export async function readBulkEditFile(buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw badRequest('Could not read the file. Upload the .xlsx file downloaded from "Bulk edit (Excel)" (saved in Excel as .xlsx).');
  }
  const products = readSheet(wb.getWorksheet('Products'), PRODUCT_COLUMNS);
  const stock = readSheet(wb.getWorksheet('Stock'), STOCK_COLUMNS);
  if (!products.length && !stock.length) throw badRequest('The file has no rows in the Products or Stock tab.');
  return { products, stock };
}

// ------------------------------------------------------------------ planning
/** Works out the new state of one product from its row (no writes). */
function planProduct(catalog, row, skuOwners) {
  const errors = [];
  const p = catalog.productsById.get(row.product_id);
  if (!p) return { errors: [`Unknown product_id "${row.product_id || '(blank)'}" - new products are added with "Add product".`] };
  if (p.status === RECORD_STATUS.ARCHIVED) return { errors: ['This product is archived - restore it first.'] };
  const variants = catalog.variantsByProduct.get(p.product_id) || [];
  const legacy = hasLegacyBoxes(p, variants);

  const sku = String(row.sku ?? p.sku).trim().toUpperCase() || p.sku;
  if (!SKU_RE.test(sku) || sku.length > 64) errors.push(`SKU "${sku}" may contain only letters, numbers, - _ . /`);
  const owner = skuOwners.get(sku);
  if (owner && owner !== p.product_id) errors.push(`SKU ${sku} is already used by another product.`);

  const name = String(row.product_name ?? '').trim() || p.product_name;
  if (name.length < 2 || name.length > 150) errors.push('Product name must be 2-150 characters.');

  let categoryId = p.category_id;
  if (row.category !== undefined && row.category !== '') {
    const c = catalog.categories.find((x) => norm(x.category_name) === norm(row.category) && x.status !== RECORD_STATUS.ARCHIVED);
    if (!c) errors.push(`Unknown category "${row.category}".`);
    else categoryId = c.category_id;
  }

  const mrp = row.mrp === undefined || row.mrp === '' ? Number(p.mrp) : money(row.mrp);
  if (!(mrp > 0)) errors.push('MRP must be a number greater than 0.');

  let discountMode = p.discount_mode || PRODUCT_DISCOUNT_MODE.GLOBAL;
  let discount = p.fixed_discount_percent ?? null;
  if (row.own_discount_percent !== undefined) {
    if (row.own_discount_percent === '') { discountMode = PRODUCT_DISCOUNT_MODE.GLOBAL; discount = null; } else {
      const d = Number(String(row.own_discount_percent).replace('%', ''));
      if (!(d >= 0 && d < 100)) errors.push('own_discount_% must be between 0 and 99.99 (or blank).');
      else { discountMode = PRODUCT_DISCOUNT_MODE.CUSTOM; discount = money(d); }
    }
  }

  let units = unitsPerBoxOf(p, variants);
  if (row.pieces_per_box !== undefined) {
    if (row.pieces_per_box === '') units = null;
    else {
      const u = Number(row.pieces_per_box);
      if (!(Number.isInteger(u) && u >= 1 && u <= 10000)) errors.push('pieces_per_box must be a whole number (or blank for no box).');
      else units = u;
    }
  }

  const resolve = (names, items, nameKey, label) => {
    const ids = [];
    for (const n of names) {
      const hit = items.find((x) => norm(x[nameKey]) === norm(n));
      if (!hit) errors.push(`${label} "${n}" is not in the ${label.toLowerCase()} list - add it in Admin first.`);
      else if (hit.status !== RECORD_STATUS.ACTIVE) errors.push(`${label} "${n}" is switched off.`);
      else if (!ids.includes(hit[`${nameKey.split('_')[0]}_id`])) ids.push(hit[`${nameKey.split('_')[0]}_id`]);
    }
    return ids;
  };
  const currentSizes = splitIds(p.size_ids).filter((x) => catalog.sizesById.has(x));
  const currentColours = splitIds(p.color_ids).filter((x) => catalog.colorsById.has(x));
  const sizeIds = row.sizes === undefined ? currentSizes : resolve(list(row.sizes), catalog.sizes, 'size_name', 'Size');
  const colourIds = row.colours === undefined ? currentColours : resolve(list(row.colours), catalog.colors, 'color_name', 'Colour');
  const orderedSizes = catalog.sizes.filter((s) => sizeIds.includes(s.size_id)).map((s) => s.size_id);
  const orderedColours = catalog.colors.filter((c) => colourIds.includes(c.color_id)).map((c) => c.color_id);

  const sizeMrp = new Map();
  if (row.size_mrp === undefined) {
    for (const [sid, m] of Object.entries(sizeMrpsOf(variants))) if (orderedSizes.includes(sid) && m !== mrp) sizeMrp.set(sid, m);
  } else {
    for (const part of list(row.size_mrp)) {
      const [n, price] = part.split(/[=:]/).map((x) => x.trim());
      const s = catalog.sizes.find((x) => norm(x.size_name) === norm(n));
      if (!s || !(Number(price) > 0)) { errors.push(`size_mrp "${part}" - write it like 42=165`); continue; }
      if (!orderedSizes.includes(s.size_id)) { errors.push(`size_mrp: size ${n} is not one of this product's sizes.`); continue; }
      if (money(price) !== mrp) sizeMrp.set(s.size_id, money(price));
    }
  }

  const pcsNew = yesNoBlank(row.pcs_for_new_customers) ?? (p.pcs_for_new_customers === true);
  const statusText = norm(row.status);
  const status = !statusText ? p.status : statusText === 'active' ? RECORD_STATUS.ACTIVE : statusText === 'inactive' ? RECORD_STATUS.INACTIVE : null;
  if (!status) errors.push('status must be Active or Inactive.');
  const featured = yesNoBlank(row.featured) ?? (p.featured === true);

  const structureChanged = orderedSizes.join(',') !== currentSizes.join(',') || orderedColours.join(',') !== currentColours.join(',')
    || (units || null) !== (unitsPerBoxOf(p, variants) || null) || sku !== p.sku
    || [...sizeMrp.entries()].sort().join() !== Object.entries(sizeMrpsOf(variants)).filter(([sid, m]) => orderedSizes.includes(sid) && m !== mrp).sort().join();
  if (legacy && structureChanged) errors.push('This product has old-style box settings - change its sizes / colours / box in the product form.');
  if (!legacy) {
    if (!orderedSizes.length) errors.push('Give the product at least one size.');
    if (!orderedColours.length) errors.push('Give the product at least one colour (stock is entered in pieces).');
  }

  const sellMode = legacy ? p.sell_mode : deriveSellMode({ hasBox: units >= 1, hasPcs: orderedColours.length > 0 });
  const fields = {
    sku,
    product_name: name,
    category_id: categoryId,
    mrp,
    discount_mode: discountMode,
    fixed_discount_percent: discountMode === PRODUCT_DISCOUNT_MODE.CUSTOM ? discount : null,
    pcs_for_new_customers: pcsNew,
    status,
    featured,
    ...(legacy ? {} : {
      units_per_box: units >= 1 ? units : null,
      sell_mode: sellMode,
      inventory_mode: primaryInventoryMode(sellMode),
      size_ids: orderedSizes.join(','),
      color_ids: orderedColours.join(','),
    }),
  };
  const warnings = [];
  if (!legacy && units >= 1 && orderedColours.length && units % orderedColours.length) {
    warnings.push(`Box of ${units} cannot be split equally into ${orderedColours.length} colours - boxes cannot be sold until this is fixed.`);
  }
  return {
    p, variants, legacy, errors, warnings, fields, sizeIds: orderedSizes, colourIds: orderedColours, sizeMrp, units, sellMode, structureChanged,
  };
}

const LABELS = {
  sku: 'SKU', product_name: 'Name', category_id: 'Category', mrp: 'MRP', discount_mode: 'Discount', fixed_discount_percent: 'Own discount %',
  pcs_for_new_customers: 'Loose pcs for new customers', status: 'Status', featured: 'Featured', units_per_box: 'Pieces per box',
};

function describe(catalog, plan) {
  const { p } = plan;
  const changes = [];
  for (const [k, label] of Object.entries(LABELS)) {
    if (!(k in plan.fields)) continue;
    const from = p[k] ?? '';
    const to = plan.fields[k] ?? '';
    if (k === 'units_per_box' ? sameValue(k, unitsPerBoxOf(p, plan.variants), to) : sameValue(k, from, to)) continue;
    const show = (v) => (k === 'category_id' ? catalog.categoriesById.get(v)?.category_name || v : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v === '' || v === null ? '—' : String(v));
    changes.push({ field: label, from: show(k === 'units_per_box' ? unitsPerBoxOf(p, plan.variants) : from), to: show(to) });
  }
  const before = new Set(splitIds(p.size_ids));
  const after = new Set(plan.sizeIds);
  const sName = (id) => catalog.sizesById.get(id)?.size_name;
  const cName = (id) => catalog.colorsById.get(id)?.color_name;
  const beforeC = new Set(splitIds(p.color_ids));
  const afterC = new Set(plan.colourIds);
  const sizesAdded = plan.sizeIds.filter((x) => !before.has(x)).map(sName);
  const sizesRemoved = [...before].filter((x) => !after.has(x)).map(sName).filter(Boolean);
  const coloursAdded = plan.colourIds.filter((x) => !beforeC.has(x)).map(cName);
  const coloursRemoved = [...beforeC].filter((x) => !afterC.has(x)).map(cName).filter(Boolean);
  if (!plan.legacy) {
    const oldMrp = Object.entries(sizeMrpsOf(plan.variants)).filter(([sid, m]) => plan.sizeIds.includes(sid) && m !== plan.fields.mrp).map(([sid, m]) => `${sName(sid)}=${m}`).sort().join(', ');
    const newMrp = [...plan.sizeMrp.entries()].map(([sid, m]) => `${sName(sid)}=${m}`).sort().join(', ');
    if (oldMrp !== newMrp) changes.push({ field: 'Size-wise MRP', from: oldMrp || '—', to: newMrp || '—' });
  }
  return {
    product_id: p.product_id,
    sku: plan.fields.sku,
    name: plan.fields.product_name,
    changes,
    sizes_added: sizesAdded,
    sizes_removed: sizesRemoved,
    colours_added: coloursAdded,
    colours_removed: coloursRemoved,
    warnings: plan.warnings,
  };
}

const hasChange = (d) => d.changes.length || d.sizes_added.length || d.sizes_removed.length || d.colours_added.length || d.colours_removed.length;

function planAll(catalog, rows) {
  const skuOwners = new Map(catalog.products.map((p) => [p.sku.toUpperCase(), p.product_id]));
  // SKUs changed inside the file: the new owner wins, the old one frees up
  for (const r of rows) {
    const p = catalog.productsById.get(r.product_id);
    const sku = String(r.sku ?? '').trim().toUpperCase();
    if (p && sku && sku !== p.sku.toUpperCase()) {
      if (skuOwners.get(p.sku.toUpperCase()) === p.product_id) skuOwners.delete(p.sku.toUpperCase());
    }
  }
  const seen = new Map();
  const result = [];
  for (const r of rows) {
    if (seen.has(r.product_id)) { result.push({ row: r, error: `This product appears twice (row ${seen.get(r.product_id)}).` }); continue; }
    seen.set(r.product_id, r.line);
    const plan = planProduct(catalog, r, skuOwners);
    if (plan.errors.length) { result.push({ row: r, error: plan.errors.join(' ') }); continue; }
    const sku = plan.fields.sku.toUpperCase();
    if (skuOwners.has(sku) && skuOwners.get(sku) !== plan.p.product_id) { result.push({ row: r, error: `SKU ${sku} is used twice.` }); continue; }
    skuOwners.set(sku, plan.p.product_id);
    result.push({ row: r, plan, summary: describe(catalog, plan) });
  }
  return result;
}

// ------------------------------------------------------------------ preview / apply
export async function bulkEditProducts(buffer, { apply = false, admin, ip } = {}) {
  const file = await readBulkEditFile(buffer);
  const catalog = buildCatalog(await sheetsService.readMany(CATALOG_SHEETS, { fresh: true }));
  const planned = planAll(catalog, file.products);
  const toChange = planned.filter((x) => x.plan && hasChange(x.summary));
  const errors = planned.filter((x) => x.error).map((x) => ({ line: x.row.line, sku: x.row.sku || '', message: x.error }));

  // stock rows for sizes / colours this file adds are set after they exist
  const adds = new Map(toChange.map((x) => [x.plan.p.product_id, x.plan]));
  const isPending = (row) => {
    const plan = adds.get(row.product_id);
    if (!plan) return false;
    const s = catalog.sizes.find((x) => norm(x.size_name) === norm(row.size));
    const c = catalog.colors.find((x) => norm(x.color_name) === norm(row.colour));
    return Boolean(s && c && plan.sizeIds.includes(s.size_id) && plan.colourIds.includes(c.color_id));
  };
  const stockRows = file.stock.map((r) => ({ ...r, type: 'PCS' }));

  const products = {
    rows: file.products.length,
    to_change: toChange.length,
    unchanged: planned.filter((x) => x.plan && !hasChange(x.summary)).length,
    errors,
    changes: toChange.map((x) => x.summary),
    applied: 0,
  };
  if (!apply) {
    const stock = stockRows.length ? await importStockRows(stockRows, { isPending }) : null;
    return { products, stock };
  }

  // products first (in chunks, each under the commerce lock, fresh data)
  const ids = toChange.map((x) => x.row.product_id);
  const rowsById = new Map(file.products.map((r) => [r.product_id, r]));
  const failed = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    await withLock(COMMERCE_LOCK, async () => {
      const fresh = buildCatalog(await sheetsService.readMany(CATALOG_SHEETS, { fresh: true }));
      const now = nowIso();
      const ops = [];
      for (const x of planAll(fresh, chunk.map((id) => rowsById.get(id)))) {
        if (x.error) { failed.push({ line: x.row.line, sku: x.row.sku || '', message: x.error }); continue; }
        const { plan } = x;
        const { p } = plan;
        const patch = {};
        const old = {};
        for (const [k, v] of Object.entries(plan.fields)) {
          if (!sameValue(k, p[k], v)) { patch[k] = v; old[k] = p[k]; }
        }
        let variantOps = [];
        let newVariants = 0;
        if (!plan.legacy) {
          const desired = planVariants({
            catalog: fresh, existingVariants: plan.variants, sku: plan.fields.sku, sellMode: plan.sellMode,
            sizeIds: plan.sizeIds, colorIds: plan.colourIds, sizeMrp: plan.sizeMrp, unitsPerBox: plan.units >= 1 ? plan.units : null,
          });
          try {
            checkVariantSkus(fresh, p.product_id, desired);
          } catch (err) {
            failed.push({ line: x.row.line, sku: plan.fields.sku, message: err.message });
            continue;
          }
          const applied = applyVariantPlan({
            catalog: fresh, pid: p.product_id, existingVariants: plan.variants, desired, now, by: admin.admin_id,
          });
          variantOps = applied.ops;
          newVariants = applied.newVariants.length;
        }
        if (!Object.keys(patch).length && !variantOps.length) continue;
        if (Object.keys(patch).length) ops.push({ op: 'update', sheet: 'Products', id: p.product_id, patch: { ...patch, updated_at: now, updated_by: admin.admin_id } });
        ops.push(...variantOps);
        ops.push(auditOp({
          admin, ip, action: AUDIT_ACTION.PRODUCT_UPDATED, entity_type: 'Product', entity_id: p.product_id,
          old_value: old, new_value: { ...patch, new_variants: newVariants }, notes: 'Bulk edit (Excel)',
        }));
        products.applied += 1;
      }
      if (ops.length) await sheetsService.commit(ops);
    });
  }
  products.errors = [...errors, ...failed];

  // then stock (new sizes now exist)
  const stock = stockRows.length ? await importStockRows(stockRows, { apply: true, admin, ip }) : null;
  return { products, stock };
}

