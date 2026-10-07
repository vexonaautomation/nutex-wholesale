#!/usr/bin/env node
// Imports the Nutex PDF catalogue (catalog-import/catalog.json + images)
// into the Google Sheet + Google Drive configured in .env.
//
//   npm run import:catalog -- --dry-run          -> show what would be created
//   npm run import:catalog                       -> import, starting stock 0
//   npm run import:catalog -- --stock=50         -> starting stock 50 per colour+size (NEW variants only)
//   npm run import:catalog -- --inactive         -> create products as INACTIVE (publish later)
//   npm run import:catalog -- --box-all=6        -> every category: boxes of 6 pcs (one per size)
//   npm run import:catalog -- --box=everyday-panty:12,men-collection:5
//   npm run import:catalog -- --pcs-new=camisole-collection -> new customers may also buy pieces there
//   npm run import:catalog -- --box-stock=10     -> starting boxes per size (NEW boxes only)
// Existing customers can always buy boxes or loose pieces. New customers buy
// boxes only (unless --pcs-new), so give categories a box size; it can also be
// set later in Admin > Products > Box / pieces.
//
// ADDITIVE ONLY: existing SKUs are skipped (never overwritten), existing
// categories/colours/sizes are reused. Safe to run again - e.g. after an
// interruption it simply continues with the products that are missing.
// The same import is available in Admin > Catalogue import.
import { config, validateConfig } from '../server/config/env.js';
import { configureStorage } from '../server/services/bootstrap.js';
import { runMigrations } from '../server/services/migrationService.js';
import { driveService } from '../server/services/driveService.js';
import { sheetsService } from '../server/services/sheetsService.js';
import {
  loadCatalogFile, planImport, catalogSummary, startCatalogImport,
} from '../server/services/catalogImportService.js';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const dryRun = process.argv.includes('--dry-run');
const activate = !process.argv.includes('--inactive');
const stock = Math.max(0, Math.floor(Number(arg('stock') || 0)));
const boxStock = Math.max(0, Math.floor(Number(arg('box-stock') || 0)));
const pcsNew = new Set(String(arg('pcs-new') || '').split(',').filter(Boolean));
function sellingFor(catalog) {
  const all = Math.floor(Number(arg('box-all') || 0));
  const per = Object.fromEntries(String(arg('box') || '').split(',').filter(Boolean).map((x) => x.split(':')).map(([slug, n]) => [slug, Math.floor(Number(n) || 0)]));
  const out = {};
  for (const c of catalog.categories) {
    const units = per[c.slug] || all;
    out[c.slug] = { units_per_box: units >= 1 ? units : null, pcs_for_new_customers: pcsNew.has(c.slug) };
  }
  return out;
}

const { errors, warnings } = validateConfig(config);
warnings.forEach((w) => console.warn(`! ${w}`));
if (errors.filter((e) => !/JWT_SECRET|SESSION_SECRET/.test(e)).length) {
  errors.forEach((e) => console.error(`✗ ${e}`));
  process.exit(1);
}
if (config.dataBackend !== 'google') {
  console.error('✗ import:catalog works against Google Sheets only (DATA_BACKEND=google). For a local try-out use "npm run demo".');
  process.exit(1);
}

configureStorage(config);
try {
  const { catalog } = await loadCatalogFile();
  const s = catalogSummary(catalog);
  console.log(`Catalogue: ${s.products} products, ${s.variants} colour+size variants, ${s.categories.length} categories.`);
  const selling = sellingFor(catalog);
  for (const c of s.categories) {
    const x = selling[c.slug];
    console.log(`  ${c.name}: ${x.units_per_box ? `boxes of ${x.units_per_box} pcs` : 'no box'}; new customers: ${x.pcs_for_new_customers ? 'boxes + pieces' : x.units_per_box ? 'boxes only' : 'cannot buy (no box, pieces not opened)'}`);
  }
  await runMigrations();
  if (driveService.enabled) await driveService.ensureFolders();
  else console.warn('! GOOGLE_DRIVE_FOLDER_ID not set - products will be imported WITHOUT images.');

  const data = await sheetsService.readMany(['Categories', 'Sizes', 'Colors', 'Products', 'Product_Images'], { fresh: true });
  const plan = planImport(catalog, data);
  console.log(`Plan: ${plan.products_to_create} new products (${plan.variants_to_create} variants), ${plan.products_existing} already exist (skipped).`);
  console.log(`      new sizes: ${plan.sizes_to_create.join(', ') || 'none'}`);
  console.log(`      new colours: ${plan.colors_to_create.length ? plan.colors_to_create.join(', ') : 'none'}`);
  console.log(`      new categories: ${plan.categories_to_create.join(', ') || 'none'}`);
  if (plan.inactive_categories.length) console.warn(`! Inactive categories (products stay hidden until reactivated): ${plan.inactive_categories.join(', ')}`);
  s.to_check.forEach((c) => console.warn(`! check ${c.sku} ${c.name}: ${c.check}`));
  if (dryRun) {
    console.log('\nDry run - nothing was written.');
    process.exit(0);
  }

  const admins = await sheetsService.read('Admin_Users', { fresh: true });
  const admin = admins.find((a) => a.status === 'ACTIVE' && a.role === 'OWNER') || admins.find((a) => a.status === 'ACTIVE') || null;
  if (!admin) console.warn('! No admin user yet - audit entries are recorded as SYSTEM and the logo/size chart settings are not set.');

  let last = 0;
  const job = await startCatalogImport({
    admin, ip: 'cli', stockPerVariant: stock, boxStock, selling, activate, wait: true,
    onProgress: (st) => {
      if (st.done !== last) {
        last = st.done;
        process.stdout.write(`\r  ${st.phase}: ${st.done}/${st.total} (created ${st.created}, skipped ${st.skipped})   `);
      }
    },
  });
  console.log(`\n✓ Done: ${job.created} products created, ${job.skipped} already existed, ${job.images_added} images attached.`);
  job.errors.forEach((e) => console.warn(`! ${e}`));
} catch (err) {
  console.error(`\n✗ Import failed: ${err.message}`);
  console.error('  Products imported so far are saved. Run the command again to continue.');
  process.exit(1);
}
