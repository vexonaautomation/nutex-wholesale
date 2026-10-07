#!/usr/bin/env node
// DEVELOPMENT ONLY: fills an EMPTY development spreadsheet with demo products.
//   npm run seed:demo -- --dev-sheet
// Refuses to run when NODE_ENV=production, without --dev-sheet, or when the
// Products sheet already contains data. Never point this at the production sheet.
import { config } from '../server/config/env.js';
import { configureStorage } from '../server/services/bootstrap.js';
import { runMigrations } from '../server/services/migrationService.js';
import { sheetsService } from '../server/services/sheetsService.js';
import { seedDemoData, assertNotProduction } from '../server/dev/demoData.js';

try {
  assertNotProduction();
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exit(1);
}
if (!process.argv.includes('--dev-sheet')) {
  console.error('✗ Pass --dev-sheet to confirm GOOGLE_SHEET_ID points to a DEVELOPMENT spreadsheet.');
  process.exit(1);
}
configureStorage(config);
await runMigrations();
const admins = await sheetsService.read('Admin_Users', { fresh: true });
if (!admins.length) {
  console.error('✗ Create an admin first (npm run admin:create).');
  process.exit(1);
}
const result = await seedDemoData({ admin: admins[0] });
console.log(result.skipped ? `Skipped: ${result.reason}` : `✓ Seeded ${result.products} demo products.`);
