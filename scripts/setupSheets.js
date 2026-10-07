#!/usr/bin/env node
// One-time / repeatable, SAFE setup of the Google Sheet database.
//
//   npm run setup:sheets                       -> create missing sheets/columns/settings
//   npm run setup:sheets -- --with-master-data -> also load Nutex's initial categories,
//                                                 sizes and colours INTO EMPTY SHEETS ONLY
//
// It never clears, deletes, reorders or overwrites existing data and can be
// run any number of times. (The server runs the same additive migration on
// every start, so this script is optional.)
import { config, validateConfig } from '../server/config/env.js';
import { configureStorage } from '../server/services/bootstrap.js';
import { runMigrations } from '../server/services/migrationService.js';
import { initializeMasterData } from '../server/services/setupService.js';
import { driveService } from '../server/services/driveService.js';

const withMaster = process.argv.includes('--with-master-data');

const { errors, warnings } = validateConfig(config);
warnings.forEach((w) => console.warn(`! ${w}`));
if (errors.filter((e) => !/JWT_SECRET|SESSION_SECRET/.test(e)).length) {
  errors.forEach((e) => console.error(`✗ ${e}`));
  process.exit(1);
}
if (config.dataBackend !== 'google') {
  console.error('✗ setup:sheets works against Google Sheets only (DATA_BACKEND=google).');
  process.exit(1);
}

configureStorage(config);
console.log(`Connecting to spreadsheet ${config.google.sheetId} as ${config.google.serviceAccountEmail} …`);
try {
  const report = await runMigrations();
  console.log('✓ Schema verified (additive migration).');
  console.log(`  Created sheets : ${report.createdSheets.join(', ') || 'none'}`);
  console.log(`  Added columns  : ${Object.entries(report.addedColumns).map(([s, c]) => `${s}(${c.join(',')})`).join('; ') || 'none'}`);
  console.log(`  Added settings : ${report.addedSettings.join(', ') || 'none'}`);
  report.warnings.forEach((w) => console.warn(`! ${w}`));
  report.errors.forEach((e) => console.error(`✗ ${e}`));

  if (withMaster) {
    const r = await initializeMasterData({ admin: { admin_id: 'SETUP_SCRIPT', email: 'setup-script' } });
    console.log(`✓ Master data: ${r.categories} categories, ${r.sizes} sizes, ${r.colors} colors added.`);
    r.skipped.forEach((s) => console.log(`  skipped: ${s}`));
  }

  if (driveService.enabled) {
    const folders = await driveService.ensureFolders();
    console.log('✓ Google Drive folders:', Object.keys(folders).join(', '));
  } else {
    console.warn('! Google Drive not configured (GOOGLE_DRIVE_FOLDER_ID) - uploads disabled.');
  }
  console.log('\nDone. Next: create the first admin with "npm run admin:create" (or ADMIN_BOOTSTRAP_* variables).');
} catch (err) {
  console.error('✗ Setup failed:', err.message);
  if (/permission|403/i.test(err.message)) console.error('  → Share the Google Sheet (Editor) with the service-account email.');
  process.exit(1);
}
