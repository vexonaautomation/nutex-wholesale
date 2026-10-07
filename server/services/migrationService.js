import { sheetsService } from './sheetsService.js';
import { ensureDefaultSettings } from './settingsService.js';
import { SCHEMA_VERSION } from '../config/schema.js';
import { MIGRATIONS } from '../migrations/index.js';
import { config } from '../config/env.js';
import { nowIso } from '../utils/dates.js';
import { logger } from '../utils/logger.js';

/**
 * Production-safe startup migration. ADDITIVE ONLY:
 *   1. create any missing sheet
 *   2. add any missing column (at the end of the header row)
 *   3. add any missing Settings key with its default value
 *   4. run registered migrations whose version is not yet recorded
 *   5. record the schema version in Schema_Version
 * It never clears, deletes, reorders, re-IDs or overwrites business data,
 * and it never seeds demo data.
 */
export async function runMigrations() {
  const report = await sheetsService.ensureSchema();
  if (report.createdSheets.length) logger.info(`Migration: created sheets ${report.createdSheets.join(', ')}`);
  for (const [sheet, cols] of Object.entries(report.addedColumns)) logger.info(`Migration: added columns to ${sheet}: ${cols.join(', ')}`);
  for (const w of report.warnings) logger.warn(`Migration warning: ${w}`);
  for (const e of report.errors) logger.error(`Migration error: ${e}`);

  report.addedSettings = await ensureDefaultSettings();
  if (report.addedSettings.length) logger.info(`Migration: added default settings ${report.addedSettings.join(', ')}`);

  const applied = new Set((await sheetsService.read('Schema_Version', { fresh: true })).map((r) => Number(r.version)));
  report.appliedMigrations = [];
  for (const migration of MIGRATIONS.filter((m) => m.version <= SCHEMA_VERSION).sort((a, b) => a.version - b.version)) {
    if (applied.has(migration.version)) continue;
    if (migration.up) await migration.up({ sheets: sheetsService, logger });
    await sheetsService.commit([{
      op: 'append',
      sheet: 'Schema_Version',
      rows: [{ version: migration.version, applied_at: nowIso(), description: migration.description, app_version: config.appVersion }],
    }]);
    report.appliedMigrations.push(migration.version);
    logger.info(`Migration v${migration.version} recorded: ${migration.description}`);
  }
  return report;
}
