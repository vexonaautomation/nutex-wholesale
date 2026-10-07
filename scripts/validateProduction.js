#!/usr/bin/env node
// READ-ONLY production readiness check. Writes nothing to Sheets or Drive.
//   NODE_ENV=production npm run validate:production
import { config, validateConfig } from '../server/config/env.js';
import { configureStorage } from '../server/services/bootstrap.js';
import { sheetsService } from '../server/services/sheetsService.js';
import { driveService } from '../server/services/driveService.js';
import { parseSettings } from '../server/services/settingsService.js';
import { DRIVE_FOLDERS } from '../server/config/constants.js';
import { runDataSafetyScan } from './dataSafetyCheck.js';

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const warn = (m) => console.log(`  ! ${m}`);
const fail = (m) => {
  failures += 1;
  console.log(`  ✗ ${m}`);
};

console.log('\n1. Environment');
const { errors, warnings } = validateConfig(config);
errors.forEach(fail);
warnings.forEach(warn);
if (!errors.length) ok(`NODE_ENV=${config.nodeEnv}, storage=${config.dataBackend}`);
if (!config.isProd) warn('NODE_ENV is not "production" - run this with NODE_ENV=production to check production rules.');

console.log('\n2. Code data-safety scan');
const scan = runDataSafetyScan();
if (scan.violations.length) scan.violations.forEach((v) => fail(`${v.file}:${v.line} ${v.rule}`));
else ok(`${scan.filesScanned} server files scanned - no destructive Sheets/Drive calls, no startup seeding`);

if (config.dataBackend === 'google' && !errors.some((e) => /GOOGLE/.test(e))) {
  configureStorage(config);
  console.log('\n3. Google Sheets');
  try {
    const status = await sheetsService.schemaStatus();
    ok(`Connected to "${status.spreadsheetTitle}"`);
    if (status.missingSheets.length) warn(`Missing sheets (created automatically on start): ${status.missingSheets.join(', ')}`);
    for (const [s, cols] of Object.entries(status.missingColumns)) warn(`${s}: missing columns (added automatically): ${cols.join(', ')}`);
    if (!status.missingSheets.length && !Object.keys(status.missingColumns).length) ok('Schema up to date');
    if (!status.missingSheets.includes('Admin_Users')) {
      const data = await sheetsService.readMany(['Admin_Users', 'Settings', 'Categories', 'Products', 'Orders']);
      const admins = data.Admin_Users.filter((a) => a.status === 'ACTIVE');
      if (admins.length) ok(`${admins.length} active admin user(s)`);
      else if (config.adminBootstrap.email) warn('No admin yet - ADMIN_BOOTSTRAP_* will create one on first start');
      else fail('No admin user. Run "npm run admin:create" or set ADMIN_BOOTSTRAP_EMAIL/PASSWORD.');
      const s = parseSettings(data.Settings);
      if (!s.payment_qr_file_id) warn('Payment QR not uploaded yet (Admin > Settings > Payment)');
      if (!s.whatsapp_number) warn('WhatsApp number not set (Admin > Settings > Company)');
      ok(`Records: ${data.Categories.length} categories, ${data.Products.length} products, ${data.Orders.length} orders`);
    }
  } catch (err) {
    fail(`Cannot read the spreadsheet: ${err.message}`);
  }

  console.log('\n4. Google Drive');
  if (!driveService.enabled) warn('Drive not configured - uploads disabled');
  else {
    try {
      const root = await driveService.transport.verifyRoot();
      ok(`Root folder "${root.name}" reachable (${config.google.driveAuth})`);
      const children = await driveService.transport.listChildFolders(config.google.driveFolderId);
      const names = new Set(children.map((c) => c.name));
      const missing = Object.values(DRIVE_FOLDERS).filter((f) => !names.has(f));
      if (missing.length) warn(`Sub-folders created on first start: ${missing.join(', ')}`);
      else ok('All sub-folders present');
    } catch (err) {
      fail(`Drive check failed: ${err.message}`);
    }
  }
}

console.log(failures ? `\n✗ ${failures} problem(s) found.\n` : '\n✓ Ready for production.\n');
process.exit(failures ? 1 : 0);
