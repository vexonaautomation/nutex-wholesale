// =====================================================================
// NUTEX CATALOGUE IMPORT
//
// Imports catalog-import/catalog.json (built from the Nutex PDF catalogue:
// one catalogue page = one product = one image) into Google Sheets, with
// images uploaded to Google Drive.
//
// ADDITIVE ONLY - safe to run any number of times:
//  * sizes / colours / categories are matched by name / slug and only the
//    missing ones are created; existing rows are never modified (except a
//    BLANK category image or BLANK logo/size-chart setting being filled in).
//  * products are matched by SKU: an existing SKU is skipped (its price,
//    stock and status stay exactly as the admin left them). If an imported
//    product has no image at all, the catalogue image is attached.
//  * stock is written only for NEW variants (the starting stock chosen by
//    the admin, default 0).
// =====================================================================
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { sheetsService } from './sheetsService.js';
import { driveService } from './driveService.js';
import { auditOp } from './auditService.js';
import { getSettings, updateSettings } from './settingsService.js';
import { planVariants, inventoryRow } from './productService.js';
import {
  SELL_MODE, SELL_MODES, allowsBox, deriveSellMode, isBoxVariant, primaryInventoryMode,
} from '../utils/sellMode.js';
import {
  AUDIT_ACTION, DRIVE_FOLDERS, IMAGE_TYPE, INVENTORY_STATUS, PRODUCT_DISCOUNT_MODE, RECORD_STATUS,
} from '../config/constants.js';
import { withLock, COMMERCE_LOCK } from '../utils/lockManager.js';
import { newId, ID_PREFIX } from '../utils/idGenerator.js';
import { nowIso } from '../utils/dates.js';
import { uniqueSlug } from '../utils/slug.js';
import { badRequest, conflict, serviceUnavailable } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export const CATALOG_DIR = fileURLToPath(new URL('../../catalog-import/', import.meta.url));
const CHUNK = 10; // products per Google Sheets batch
const lower = (s) => String(s ?? '').trim().toLowerCase();
const driveViewUrl = (id) => (id ? `https://drive.google.com/file/d/${id}/view` : '');
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

const relPath = z.string().trim().regex(/^[a-z0-9][a-z0-9/_.-]*\.(jpg|jpeg|png|webp)$/i, 'Image path must be a relative jpg/png/webp path').refine((p) => !p.includes('..'), 'Invalid image path');
const productEntry = z.object({
  page: z.number().int().optional(),
  category: z.string().trim().min(1),
  name: z.string().trim().min(2).max(200),
  style_no: z.string().trim().max(64).optional().default(''),
  sku: z.string().trim().toUpperCase().min(1).max(64).regex(/^[A-Z0-9][A-Z0-9_./-]*$/, 'SKU may contain letters, numbers, - _ . /'),
  mrp: z.number().positive(),
  size_mrp: z.record(z.string(), z.number().positive()).optional(),
  sizes: z.array(z.string().trim().min(1)).min(1).max(60),
  colors: z.array(z.string().trim().min(1)).min(1).max(100),
  subcategory: z.string().trim().max(100).optional().default(''),
  description: z.string().trim().max(5000).optional().default(''),
  featured: z.boolean().optional().default(false),
  image: relPath.optional(),
  check: z.string().optional(),
  // optional: how this product is sold (otherwise the category choice in the import screen)
  sell_mode: z.enum(SELL_MODES).optional(),
  units_per_box: z.number().int().min(1).max(10000).optional(),
  pcs_for_new_customers: z.boolean().optional(),
});
const catalogSchema = z.object({
  version: z.number(),
  source: z.string().optional().default(''),
  brand: z.object({ logo: relPath.optional(), size_chart: relPath.optional() }).passthrough().optional().default({}),
  sizes: z.array(z.object({ name: z.string().trim().min(1), sort_order: z.number().optional() })).optional().default([]),
  colors: z.array(z.object({ name: z.string().trim().min(1), code: z.string().trim().max(10).optional().default(''), hex: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional() })).optional().default([]),
  categories: z.array(z.object({
    slug: z.string().trim().regex(/^[a-z0-9-]+$/),
    name: z.string().trim().min(2).max(100),
    parent: z.string().trim().max(60).optional().default(''),
    sort_order: z.number().optional(),
    description: z.string().trim().max(1000).optional().default(''),
    image: relPath.optional(),
  }).passthrough()),
  products: z.array(productEntry).min(1).max(2000),
}).superRefine((c, ctx) => {
  const cats = new Set(c.categories.map((x) => x.slug));
  const skus = new Set();
  c.products.forEach((p, i) => {
    if (!cats.has(p.category)) ctx.addIssue({ code: 'custom', path: ['products', i, 'category'], message: `Unknown category "${p.category}" (${p.name})` });
    if (skus.has(p.sku)) ctx.addIssue({ code: 'custom', path: ['products', i, 'sku'], message: `Duplicate SKU ${p.sku}` });
    skus.add(p.sku);
    for (const s of Object.keys(p.size_mrp || {})) {
      if (!p.sizes.includes(s)) ctx.addIssue({ code: 'custom', path: ['products', i, 'size_mrp'], message: `${p.name}: size_mrp size ${s} is not in sizes` });
    }
  });
});

/** Reads and validates catalog.json. Throws a readable 400 error if invalid. */
export async function loadCatalogFile(dir = CATALOG_DIR) {
  let raw;
  try {
    raw = await fs.readFile(path.join(dir, 'catalog.json'), 'utf8');
  } catch {
    throw badRequest(`Catalogue file not found: ${path.join(dir, 'catalog.json')}`);
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw badRequest(`catalog.json is not valid JSON: ${err.message}`);
  }
  const parsed = catalogSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw badRequest(`catalog.json is invalid - ${first}`);
  }
  return { catalog: parsed.data, dir };
}

function imageFile(dir, rel) {
  const base = path.resolve(dir, 'images');
  const full = path.resolve(base, rel);
  if (!full.startsWith(base + path.sep)) throw badRequest(`Invalid image path ${rel}`);
  return full;
}

export async function readCatalogImage(rel, dir = CATALOG_DIR) {
  const full = imageFile(dir, rel);
  const buffer = await fs.readFile(full);
  const ext = path.extname(full).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return { buffer, mimeType, name: path.basename(full) };
}

// ------------------------------------------------------------------
// Plan: what an import would create against the CURRENT sheets.
// ------------------------------------------------------------------
const PLAN_SHEETS = ['Categories', 'Sizes', 'Colors', 'Products', 'Product_Images'];

export function planImport(catalog, data) {
  const sizeNames = new Set(data.Sizes.map((s) => lower(s.size_name)));
  const colorNames = new Set(data.Colors.map((c) => lower(c.color_name)));
  const catSlugs = new Map(data.Categories.map((c) => [c.slug, c]));
  const productBySku = new Map(data.Products.map((p) => [String(p.sku).toUpperCase(), p]));
  const imagesByProduct = new Set(data.Product_Images.filter((i) => i.status !== RECORD_STATUS.INACTIVE).map((i) => i.product_id));

  const usedSizes = [...new Set(catalog.products.flatMap((p) => p.sizes))];
  const usedColors = [...new Set(catalog.products.flatMap((p) => p.colors))];
  const usedCats = catalog.categories.filter((c) => catalog.products.some((p) => p.category === c.slug));
  const create = catalog.products.filter((p) => !productBySku.has(p.sku));
  const existing = catalog.products.filter((p) => productBySku.has(p.sku));
  return {
    sizes_to_create: usedSizes.filter((s) => !sizeNames.has(lower(s))),
    colors_to_create: usedColors.filter((c) => !colorNames.has(lower(c))),
    categories_to_create: usedCats.filter((c) => !catSlugs.has(c.slug)).map((c) => c.name),
    category_images_to_add: usedCats.filter((c) => c.image && !catSlugs.get(c.slug)?.image_file_id).map((c) => c.name),
    inactive_categories: usedCats.filter((c) => catSlugs.has(c.slug) && catSlugs.get(c.slug).status !== RECORD_STATUS.ACTIVE).map((c) => c.name),
    products_to_create: create.length,
    variants_to_create: create.reduce((s, p) => s + p.sizes.length * p.colors.length, 0),
    products_existing: existing.length,
    existing_without_image: existing.filter((p) => p.image && !imagesByProduct.has(productBySku.get(p.sku).product_id)).length,
    existing_skus: existing.map((p) => p.sku),
  };
}

export function catalogSummary(catalog) {
  const byCat = new Map(catalog.categories.map((c) => [c.slug, { slug: c.slug, name: c.name, products: 0 }]));
  for (const p of catalog.products) byCat.get(p.category).products += 1;
  return {
    source: catalog.source,
    products: catalog.products.length,
    variants: catalog.products.reduce((s, p) => s + p.sizes.length * p.colors.length, 0),
    categories: [...byCat.values()].filter((c) => c.products > 0),
    colors: new Set(catalog.products.flatMap((p) => p.colors)).size,
    sizes: new Set(catalog.products.flatMap((p) => p.sizes)).size,
    with_size_mrp: catalog.products.filter((p) => p.size_mrp).length,
    to_check: catalog.products.filter((p) => p.check).map((p) => ({ sku: p.sku, name: p.name, check: p.check })),
  };
}

/** Admin preview: catalogue summary + plan + current job + product list. */
export async function catalogPreview() {
  const { catalog } = await loadCatalogFile();
  const data = await sheetsService.readMany(PLAN_SHEETS, { fresh: true });
  const plan = planImport(catalog, data);
  const existing = new Set(plan.existing_skus);
  return {
    summary: catalogSummary(catalog),
    plan: { ...plan, existing_skus: undefined },
    drive_enabled: driveService.enabled,
    job: importStatus(),
    color_hex: Object.fromEntries(catalog.colors.filter((c) => c.hex).map((c) => [c.name, c.hex])),
    categories: catalog.categories.map((c) => ({ slug: c.slug, name: c.name })),
    products: catalog.products.map((p) => ({
      sku: p.sku, name: p.name, category: p.category, mrp: p.mrp, size_mrp: p.size_mrp || null,
      sizes: p.sizes, colors: p.colors, image: p.image || null, exists: existing.has(p.sku), check: p.check || null,
    })),
  };
}

// ------------------------------------------------------------------
// Background job (one at a time, in this process)
// ------------------------------------------------------------------
const job = {
  status: 'idle', phase: '', total: 0, done: 0, created: 0, skipped: 0, images_added: 0,
  errors: [], log: [], started_at: null, finished_at: null, options: null,
};

export function importStatus() {
  return { ...job, errors: job.errors.slice(-20), log: job.log.slice(-40) };
}

function note(msg) {
  job.log.push(`${new Date().toISOString().slice(11, 19)} ${msg}`);
  if (job.log.length > 400) job.log.splice(0, job.log.length - 400);
}

/**
 * Starts an import. Resolves immediately with the job status unless
 * `wait` is true (CLI / tests / memory demo).
 */
export async function startCatalogImport({
  admin = null, ip = '', stockPerVariant = 0, selling = {}, activate = true, wait = false, dir = CATALOG_DIR, throttleMs = null, onProgress = null,
} = {}) {
  if (job.status === 'running') throw conflict('IMPORT_RUNNING', 'A catalogue import is already running. Please wait for it to finish.');
  const stock = Math.max(0, Math.min(100000, Math.floor(Number(stockPerVariant) || 0)));
  const { catalog } = await loadCatalogFile(dir);
  for (const [slug, s] of Object.entries(selling || {})) {
    if (s.sell_mode && s.sell_mode !== SELL_MODE.PCS && !(Number(s.units_per_box) >= 1)) {
      const name = catalog.categories.find((c) => c.slug === slug)?.name || slug;
      throw badRequest(`${name}: enter how many pieces are in one box, or choose "Pieces only".`);
    }
  }
  Object.assign(job, {
    status: 'running', phase: 'Preparing', total: catalog.products.length, done: 0, created: 0, skipped: 0, images_added: 0,
    errors: [], log: [], started_at: nowIso(), finished_at: null, options: { stock_per_variant: stock, selling, activate },
  });
  note(`Import started: ${catalog.products.length} products, starting stock ${stock} pcs per colour+size (boxes are packed from these pieces).`);
  if (!driveService.enabled) note('Google Drive is not configured - products are imported WITHOUT images (run the import again after connecting Drive to attach them).');
  const pause = throttleMs ?? (sheetsService.transport?.constructor?.name === 'MemorySheetsTransport' ? 0 : 1500);
  const run = runImport({ catalog, dir, admin, ip, stock, selling: selling || {}, activate, pause, onProgress })
    .then(() => {
      job.status = 'done';
      job.phase = 'Finished';
      note(`Finished: ${job.created} created, ${job.skipped} already existed, ${job.images_added} images attached to existing products, ${job.errors.length} problem(s).`);
    })
    .catch((err) => {
      job.status = 'error';
      job.phase = 'Stopped';
      job.errors.push(err.message);
      note(`Stopped: ${err.message}. Products already imported are saved; run the import again to continue.`);
      logger.error('Catalogue import failed', err);
    })
    .finally(() => { job.finished_at = nowIso(); });
  if (wait) {
    await run;
    if (job.status === 'error') throw serviceUnavailable(job.errors.at(-1) || 'Catalogue import failed.', 'IMPORT_FAILED');
  }
  return importStatus();
}

async function upload(dir, rel, folder, filename) {
  if (!driveService.enabled || !rel) return null;
  const img = await readCatalogImage(rel, dir);
  const res = await driveService.upload({ buffer: img.buffer, mimeType: img.mimeType, filename, folder });
  return res.file_id;
}

async function runImport({
  catalog, dir, admin, ip, stock, selling, activate, pause, onProgress,
}) {
  const by = admin?.admin_id || 'CATALOG_IMPORT';
  const progress = () => onProgress?.(importStatus());

  // ---------------- 1. master data (sizes, colours, categories) ----------------
  job.phase = 'Sizes, colours and categories';
  await withLock(COMMERCE_LOCK, async () => {
    const data = await sheetsService.readMany(['Categories', 'Sizes', 'Colors'], { fresh: true });
    const now = nowIso();
    const ops = [];
    const created = { sizes: [], colors: [], categories: [] };

    const haveSize = new Set(data.Sizes.map((s) => lower(s.size_name)));
    const sizeHint = new Map(catalog.sizes.map((s) => [lower(s.name), s.sort_order]));
    let nextSort = Math.max(0, ...data.Sizes.map((s) => Number(s.sort_order) || 0)) + 10;
    const sizeRows = [...new Set(catalog.products.flatMap((p) => p.sizes))].filter((s) => !haveSize.has(lower(s))).map((s) => {
      const hint = sizeHint.get(lower(s));
      const numeric = /^\d+$/.test(s) ? Number(s) * 10 / 2 - 140 + 10 : null; // 28 -> 10, 30 -> 20 ... (matches initial master data)
      return {
        size_id: newId(ID_PREFIX.size), size_name: s, sort_order: hint ?? numeric ?? (nextSort += 10),
        status: RECORD_STATUS.ACTIVE, created_at: now, updated_at: now,
      };
    });
    if (sizeRows.length) { ops.push({ op: 'append', sheet: 'Sizes', rows: sizeRows }); created.sizes = sizeRows.map((r) => r.size_name); }

    const haveColor = new Set(data.Colors.map((c) => lower(c.color_name)));
    const takenCodes = new Set(data.Colors.map((c) => String(c.color_code || '').toUpperCase()));
    const colorHint = new Map(catalog.colors.map((c) => [lower(c.name), c]));
    let colorSort = Math.max(0, ...data.Colors.map((c) => Number(c.sort_order) || 0));
    const colorRows = [...new Set(catalog.products.flatMap((p) => p.colors))].filter((c) => !haveColor.has(lower(c))).map((name) => {
      const hint = colorHint.get(lower(name)) || {};
      let code = (hint.code || name.replace(/[^A-Za-z]/g, '').slice(0, 3)).toUpperCase() || 'CLR';
      for (let i = 2; takenCodes.has(code); i += 1) code = `${(hint.code || name).replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()}${i}`;
      takenCodes.add(code);
      return {
        color_id: newId(ID_PREFIX.color), color_name: name, color_code: code, hex_code: hint.hex || '#CCCCCC',
        swatch_image: '', status: RECORD_STATUS.ACTIVE, sort_order: (colorSort += 10), created_at: now, updated_at: now,
      };
    });
    if (colorRows.length) { ops.push({ op: 'append', sheet: 'Colors', rows: colorRows }); created.colors = colorRows.map((r) => r.color_name); }

    const haveCat = new Set(data.Categories.map((c) => c.slug));
    const catRows = catalog.categories
      .filter((c) => !haveCat.has(c.slug) && catalog.products.some((p) => p.category === c.slug))
      .map((c) => ({
        category_id: newId(ID_PREFIX.category), category_name: c.name, parent_category: c.parent || '', slug: c.slug,
        description: c.description || '', image_file_id: '', image_url: '', status: RECORD_STATUS.ACTIVE,
        sort_order: c.sort_order ?? 1000, seo_title: '', seo_description: '', created_at: now, updated_at: now,
      }));
    if (catRows.length) { ops.push({ op: 'append', sheet: 'Categories', rows: catRows }); created.categories = catRows.map((r) => r.category_name); }

    if (ops.length) {
      ops.push(auditOp({ admin, ip, action: AUDIT_ACTION.CATALOG_IMPORTED, entity_type: 'MasterData', entity_id: 'catalog-import', new_value: created }));
      await sheetsService.commit(ops);
    }
    note(`Master data: ${created.sizes.length} sizes, ${created.colors.length} colours, ${created.categories.length} categories created.`);
  });
  progress();

  // ---------------- 2. category images, logo, size chart (blank ones only) ----------------
  if (driveService.enabled) {
    job.phase = 'Category images and brand';
    const cats = await sheetsService.read('Categories', { fresh: true });
    const wanted = catalog.categories.filter((c) => c.image && cats.some((x) => x.slug === c.slug && !x.image_file_id));
    const patches = [];
    for (const c of wanted) {
      try {
        const id = await upload(dir, c.image, DRIVE_FOLDERS.CATEGORIES, `catalog-category-${c.slug}${path.extname(c.image)}`);
        if (id) patches.push({ slug: c.slug, id });
      } catch (err) {
        job.errors.push(`Category image ${c.slug}: ${err.message}`);
      }
    }
    if (patches.length) {
      await withLock(COMMERCE_LOCK, async () => {
        const fresh = await sheetsService.read('Categories', { fresh: true });
        const now = nowIso();
        const ops = [];
        for (const p of patches) {
          const row = fresh.find((x) => x.slug === p.slug);
          if (row && !row.image_file_id) {
            ops.push({ op: 'update', sheet: 'Categories', id: row.category_id, patch: { image_file_id: p.id, image_url: driveViewUrl(p.id), updated_at: now } });
          }
        }
        if (ops.length) {
          ops.push(auditOp({ admin, ip, action: AUDIT_ACTION.CATALOG_IMPORTED, entity_type: 'Category', entity_id: 'images', new_value: { category_images: patches.map((p) => p.slug) } }));
          await sheetsService.commit(ops);
        }
      });
      note(`Category images added: ${patches.length}.`);
    }

    const settings = await getSettings({ fresh: true });
    const brandPatch = {};
    try {
      if (!settings.company_logo_file_id && catalog.brand?.logo) brandPatch.company_logo_file_id = await upload(dir, catalog.brand.logo, DRIVE_FOLDERS.BRAND, `catalog-logo${path.extname(catalog.brand.logo)}`);
      if (!settings.size_chart_file_id && catalog.brand?.size_chart) brandPatch.size_chart_file_id = await upload(dir, catalog.brand.size_chart, DRIVE_FOLDERS.BRAND, `catalog-size-chart${path.extname(catalog.brand.size_chart)}`);
    } catch (err) {
      job.errors.push(`Brand images: ${err.message}`);
    }
    if (Object.keys(brandPatch).length && admin) {
      await updateSettings(brandPatch, { admin, ip });
      note(`Brand: ${Object.keys(brandPatch).map((k) => (k === 'company_logo_file_id' ? 'logo' : 'size chart')).join(' and ')} set.`);
    }
    progress();
  }

  // ---------------- 3. products in chunks ----------------
  job.phase = 'Products';
  const products = catalog.products;
  for (let start = 0; start < products.length; start += CHUNK) {
    const chunk = products.slice(start, start + CHUNK);
    const snapshot = await sheetsService.readMany(['Products', 'Product_Images'], { fresh: true });
    const bySku = new Map(snapshot.Products.map((p) => [String(p.sku).toUpperCase(), p]));
    const withImage = new Set(snapshot.Product_Images.filter((i) => i.status !== RECORD_STATUS.INACTIVE).map((i) => i.product_id));

    // Upload images OUTSIDE the lock (slow network calls must not block orders).
    const uploaded = new Map();
    for (const p of chunk) {
      const existing = bySku.get(p.sku);
      if (!p.image || (existing && withImage.has(existing.product_id))) continue;
      try {
        const id = await upload(dir, p.image, DRIVE_FOLDERS.PRODUCTS, `catalog-${p.sku}${path.extname(p.image)}`);
        if (id) uploaded.set(p.sku, id);
      } catch (err) {
        job.errors.push(`${p.sku} ${p.name}: image upload failed - ${err.message}`);
      }
    }

    await withLock(COMMERCE_LOCK, async () => {
      const data = await sheetsService.readMany(['Products', 'Product_Images', 'Product_Variants', 'Categories', 'Sizes', 'Colors'], { fresh: true });
      const now = nowIso();
      const skuNow = new Map(data.Products.map((p) => [String(p.sku).toUpperCase(), p]));
      const imagesNow = new Set(data.Product_Images.filter((i) => i.status !== RECORD_STATUS.INACTIVE).map((i) => i.product_id));
      const takenSlugs = new Set(data.Products.map((p) => p.slug));
      const activeVariantSkus = new Set(data.Product_Variants.filter((v) => v.status === RECORD_STATUS.ACTIVE).map((v) => String(v.sku).toUpperCase()));
      const catBySlug = new Map(data.Categories.map((c) => [c.slug, c]));
      const sizeByName = new Map(data.Sizes.map((s) => [lower(s.size_name), s]));
      const colorByName = new Map(data.Colors.map((c) => [lower(c.color_name), c]));

      const rows = { Products: [], Product_Variants: [], Inventory: [], Product_Images: [] };
      const createdSkus = [];
      const imageOnly = [];
      for (const p of chunk) {
        const existing = skuNow.get(p.sku);
        const fileId = uploaded.get(p.sku);
        if (existing) {
          job.skipped += 1;
          if (fileId && !imagesNow.has(existing.product_id)) {
            rows.Product_Images.push(imageRow(existing.product_id, fileId, p.name, now));
            imageOnly.push(p.sku);
          }
          continue;
        }
        const category = catBySlug.get(p.category);
        const sizes = p.sizes.map((s) => sizeByName.get(lower(s)));
        const colors = p.colors.map((c) => colorByName.get(lower(c)));
        if (!category || sizes.some((s) => !s) || colors.some((c) => !c)) {
          job.errors.push(`${p.sku} ${p.name}: category/size/colour missing - skipped`);
          continue;
        }
        // box if a pieces-per-box is given; loose pieces always (the product has colours)
        const choice = selling[p.category] || {};
        const wantedUnits = Number(p.units_per_box || choice.units_per_box) || null;
        const sellMode = p.sell_mode || choice.sell_mode || deriveSellMode({ hasBox: wantedUnits >= 1, hasPcs: colors.length > 0 });
        const unitsPerBox = allowsBox({ sell_mode: sellMode }) ? wantedUnits : null;
        const pcsForNew = p.pcs_for_new_customers ?? choice.pcs_for_new_customers === true;
        const sizeMrp = new Map(sizes.map((s) => [s.size_id, Number(p.size_mrp?.[s.size_name])]).filter(([, m]) => m > 0 && m !== p.mrp));
        const plan = planVariants({
          catalog: { sizes, colors, sizesById: new Map(sizes.map((s) => [s.size_id, s])) },
          sku: p.sku,
          sellMode,
          sizeIds: sizes.map((s) => s.size_id),
          colorIds: colors.map((c) => c.color_id),
          sizeMrp,
          unitsPerBox,
        });
        const clash = plan.map((d) => d.fields.sku).find((v) => activeVariantSkus.has(v));
        if (clash) {
          job.errors.push(`${p.sku} ${p.name}: variant SKU ${clash} already used by another product - skipped`);
          continue;
        }
        const pid = newId(ID_PREFIX.product);
        const slug = uniqueSlug(p.name, takenSlugs);
        takenSlugs.add(slug);
        rows.Products.push({
          product_id: pid, sku: p.sku, product_name: p.name, slug, category_id: category.category_id,
          subcategory: p.subcategory || '', description: p.description || '', mrp: p.mrp,
          discount_mode: PRODUCT_DISCOUNT_MODE.GLOBAL, fixed_discount_percent: null, inventory_mode: primaryInventoryMode(sellMode),
          sell_mode: sellMode, units_per_box: unitsPerBox, pcs_for_new_customers: pcsForNew,
          size_ids: sizes.map((s) => s.size_id).join(','), color_ids: colors.map((c) => c.color_id).join(','),
          status: activate ? RECORD_STATUS.ACTIVE : RECORD_STATUS.INACTIVE, out_of_stock: false, featured: !!p.featured,
          sort_order: p.page ? p.page * 10 : 1000, seo_title: '', seo_description: '',
          created_at: now, updated_at: now, created_by: by, updated_by: by,
        });
        for (const { fields } of plan) {
          const variantId = newId(ID_PREFIX.variant);
          rows.Product_Variants.push({ variant_id: variantId, product_id: pid, ...fields, created_at: now, updated_at: now });
          rows.Inventory.push(inventoryRow(pid, variantId, fields, isBoxVariant(fields) ? 0 : stock, INVENTORY_STATUS.ACTIVE, now, by));
          activeVariantSkus.add(fields.sku);
        }
        if (fileId) rows.Product_Images.push(imageRow(pid, fileId, p.name, now));
        skuNow.set(p.sku, { product_id: pid });
        createdSkus.push(p.sku);
      }

      const ops = Object.entries(rows).filter(([, r]) => r.length).map(([sheet, r]) => ({ op: 'append', sheet, rows: r }));
      if (ops.length) {
        ops.push(auditOp({
          admin, ip, action: AUDIT_ACTION.CATALOG_IMPORTED, entity_type: 'Product', entity_id: createdSkus.length ? 'catalog-products' : 'catalog-images',
          new_value: { created: createdSkus, variants: rows.Product_Variants.length, starting_stock: stock, images_attached: imageOnly },
        }));
        await sheetsService.commit(ops);
      }
      job.created += createdSkus.length;
      job.images_added += imageOnly.length;
      if (createdSkus.length) note(`Created ${createdSkus.length}: ${createdSkus.join(', ')}`);
      if (imageOnly.length) note(`Image attached to existing: ${imageOnly.join(', ')}`);
    });
    job.done = Math.min(products.length, start + chunk.length);
    progress();
    if (pause && start + CHUNK < products.length) await sleep(pause);
  }
}

function imageRow(productId, fileId, name, now) {
  return {
    image_id: newId(ID_PREFIX.image), product_id: productId, drive_file_id: fileId, file_url: driveViewUrl(fileId),
    image_type: IMAGE_TYPE.MAIN, alt_text: name, sort_order: 1, status: RECORD_STATUS.ACTIVE, created_at: now, updated_at: now,
  };
}
