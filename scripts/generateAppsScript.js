#!/usr/bin/env node
// Generates google-sheets/setup.gs (Google Apps Script) from the app's schema,
// so the manual sheet setup always matches what the website expects.
//   npm run gs:generate
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA, SCHEMA_VERSION, TEXT_COLUMNS } from '../server/config/schema.js';
import { DATETIME_PATTERN } from '../server/utils/sheetDates.js';
import { DEFAULT_SETTINGS, INITIAL_MASTER_DATA } from '../server/config/defaults.js';
import { MIGRATIONS } from '../server/migrations/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUTPUT = path.join(ROOT, 'google-sheets', 'setup.gs');

// Dropdowns that make hand-editing safer (invalid values are allowed but flagged)
const DROPDOWNS = {
  Existing_Customers: { status: ['ACTIVE', 'INACTIVE'] },
  Categories: { status: ['ACTIVE', 'INACTIVE', 'ARCHIVED'] },
  Colors: { status: ['ACTIVE', 'INACTIVE', 'ARCHIVED'] },
  Sizes: { status: ['ACTIVE', 'INACTIVE', 'ARCHIVED'] },
  Products: { status: ['ACTIVE', 'INACTIVE', 'ARCHIVED'], inventory_mode: ['COLOR_WISE', 'BOX_WISE'], discount_mode: ['GLOBAL', 'CUSTOM'] },
  Inventory: { status: ['ACTIVE', 'OUT_OF_STOCK'] },
  Packers: { status: ['ACTIVE', 'INACTIVE'] },
};

// one entry per line - compact and easy to read in the Apps Script editor
function json(v) {
  if (Array.isArray(v)) return `[\n${v.map((x) => `  ${JSON.stringify(x)}`).join(',\n')}\n]`;
  return `{\n${Object.entries(v).map(([k, x]) => `  ${JSON.stringify(k)}: ${JSON.stringify(x)}`).join(',\n')}\n}`;
}

export function generateAppsScript() {
  const schema = Object.fromEntries(Object.entries(SCHEMA).map(([name, def]) => [name, def.columns]));
  const settings = DEFAULT_SETTINGS.map((s) => [s.key, s.value, s.type, s.description]);
  const migrations = MIGRATIONS.filter((m) => m.version <= SCHEMA_VERSION).map((m) => [m.version, m.description]);

  return `/**
 * =====================================================================
 *  NUTEX WHOLESALE - Google Sheets database setup (Google Apps Script)
 * =====================================================================
 *  GENERATED from server/config/schema.js (schema v${SCHEMA_VERSION}).
 *  Do not edit by hand - run "npm run gs:generate" after schema changes.
 *
 *  HOW TO USE
 *   1. Open your Google Sheet -> Extensions -> Apps Script.
 *   2. Delete any code in Code.gs, paste this whole file, click Save.
 *   3. Select the function "setupNutexSheets" and click Run.
 *      (First time: Review permissions -> choose your account -> Allow.)
 *   4. Reload the spreadsheet: a "Nutex Setup" menu appears for next time.
 *
 *  SAFE TO RUN ANY NUMBER OF TIMES - NOTHING IS EVER DELETED
 *   - creates only MISSING sheets, adds only MISSING columns,
 *     adds only MISSING settings, records schema versions;
 *   - puts the columns of every sheet in the standard order: a column
 *     that is in another place moves WITH ALL ITS VALUES (e.g. names in
 *     column B -> column C keep every name, row by row). Columns you added
 *     yourself are kept at the end. Before a sheet is changed, a copy of
 *     it is saved as "<sheet> backup <date time>" (delete it yourself later);
 *   - never deletes rows, columns, sheets or values.
 *  Best run when nobody is ordering (e.g. at night). The website itself only
 *  adds missing sheets / columns when it starts - it reads every column by
 *  its header name, so the column order never breaks the app.
 * =====================================================================
 */

var NUTEX_SCHEMA_VERSION = ${SCHEMA_VERSION};
var NUTEX_SPREADSHEET_NAME = 'NUTEX WHOLESALE DATABASE';

/** Sheet name -> header row (column A is always the record's stable ID). */
var NUTEX_SCHEMA = ${json(schema)};

var NUTEX_TEXT_COLUMNS = ${json(TEXT_COLUMNS)};

/** *_at columns and Audit_Log.timestamp hold real date-times (India time). */
var NUTEX_DATETIME_FORMAT = '${DATETIME_PATTERN}';
function nutexIsDateTimeColumn_(col) { return /_at$/.test(col) || col === 'timestamp'; }
/** "Now" as a sheet date-time value in India time (same as the website writes). */
function nutexNow_() { return (Date.now() + 330 * 60000) / 86400000 + 25569; }

var NUTEX_DROPDOWNS = ${json(DROPDOWNS)};

/** [setting_key, default value, data_type, description] - added only if missing. */
var NUTEX_DEFAULT_SETTINGS = ${json(settings)};

var NUTEX_MIGRATIONS = ${json(migrations)};

var NUTEX_MASTER_DATA = ${json(INITIAL_MASTER_DATA)};

/* ------------------------------------------------------------------ menu */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Nutex Setup')
    .addItem('1. Create / update all sheets', 'setupNutexSheets')
    .addItem('2. Load initial categories, sizes and colours', 'loadNutexMasterData')
    .addItem('3. Check setup', 'checkNutexSetup')
    .addItem('4. Arrange columns only (keeps all data)', 'arrangeNutexColumns')
    .addToUi();
}

/* ------------------------------------------------------- 1. setup sheets */
function setupNutexSheets() {
  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var report = { created: [], columns: [], settings: 0, versions: [], arranged: [], backups: [], warnings: [] };

    if (/^Untitled/i.test(ss.getName())) {
      ss.rename(NUTEX_SPREADSHEET_NAME);
      report.renamed = NUTEX_SPREADSHEET_NAME;
    }

    Object.keys(NUTEX_SCHEMA).forEach(function (name) {
      nutexEnsureSheet_(ss, name, NUTEX_SCHEMA[name], report);
      nutexArrangeSheet_(ss, name, NUTEX_SCHEMA[name], report);
    });

    report.settings = nutexEnsureSettings_(ss);
    report.versions = nutexEnsureVersions_(ss);

    var unused = ss.getSheets().filter(function (s) {
      return s.getName() === 'Sheet1' && s.getLastRow() === 0 && s.getLastColumn() === 0;
    });
    if (unused.length) report.warnings.push('The empty default tab "Sheet1" is not used by the app - you may delete it yourself.');

    var lines = [];
    if (report.renamed) lines.push('Spreadsheet renamed to "' + report.renamed + '".');
    lines.push('Sheets created: ' + (report.created.length ? report.created.join(', ') : 'none (all present)'));
    lines.push('Columns added: ' + (report.columns.length ? report.columns.join('; ') : 'none'));
    lines.push('Columns moved to their place (with all data): ' + (report.arranged.length ? report.arranged.join('; ') : 'none (all in order)'));
    if (report.backups.length) lines.push('Backup copies made: ' + report.backups.join(', '));
    lines.push('Settings added: ' + report.settings);
    lines.push('Schema versions recorded: ' + (report.versions.length ? report.versions.join(', ') : 'already up to date (v' + NUTEX_SCHEMA_VERSION + ')'));
    report.warnings.forEach(function (w) { lines.push('WARNING: ' + w); });
    lines.push('');
    lines.push('Next: share this sheet (Editor) with the service-account email, then run "Check setup".');
    nutexNotify_('Nutex sheets ready', lines);
    return report;
  } finally {
    lock.releaseLock();
  }
}

function nutexEnsureSheet_(ss, name, columns, report) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (sheet.getMaxColumns() < columns.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), columns.length - sheet.getMaxColumns());
    sheet.getRange(1, 1, 1, columns.length).setValues([columns]);
    nutexStyleHeader_(sheet, 1, columns.length);
    nutexFormatColumns_(sheet, name, columns, 1);
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, columns.length);
    report.created.push(name);
    return sheet;
  }

  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  while (header.length && !header[header.length - 1]) header.pop();

  if (!header.length) {
    if (sheet.getLastRow() > 1) {
      report.warnings.push('Sheet "' + name + '" has data but no header row - NOT modified. Add the header row manually.');
      return sheet;
    }
    if (sheet.getMaxColumns() < columns.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), columns.length - sheet.getMaxColumns());
    sheet.getRange(1, 1, 1, columns.length).setValues([columns]);
    nutexStyleHeader_(sheet, 1, columns.length);
    nutexFormatColumns_(sheet, name, columns, 1);
    sheet.setFrozenRows(1);
    report.columns.push(name + ': header row written');
    return sheet;
  }

  var missing = columns.filter(function (c) { return header.indexOf(c) === -1; });
  if (missing.length) {
    var start = header.length + 1;
    var needed = start + missing.length - 1;
    if (sheet.getMaxColumns() < needed) sheet.insertColumnsAfter(sheet.getMaxColumns(), needed - sheet.getMaxColumns());
    sheet.getRange(1, start, 1, missing.length).setValues([missing]);
    nutexStyleHeader_(sheet, start, missing.length);
    nutexFormatColumns_(sheet, name, missing, start);
    report.columns.push(name + ': ' + missing.join(', '));
  }
  if (sheet.getFrozenRows() < 1) sheet.setFrozenRows(1);
  return sheet;
}

/* ------------------------------------- 4. arrange columns (moves data) */
/** Menu item: only puts the columns in order (adds missing columns first). */
function arrangeNutexColumns() {
  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var report = { created: [], columns: [], arranged: [], backups: [], warnings: [] };
    Object.keys(NUTEX_SCHEMA).forEach(function (name) {
      nutexEnsureSheet_(ss, name, NUTEX_SCHEMA[name], report);
      nutexArrangeSheet_(ss, name, NUTEX_SCHEMA[name], report);
    });
    var lines = [];
    lines.push('Columns moved to their place (with all data): ' + (report.arranged.length ? report.arranged.join('; ') : 'none (all in order)'));
    if (report.backups.length) lines.push('Backup copies made: ' + report.backups.join(', '));
    if (report.columns.length) lines.push('Columns added: ' + report.columns.join('; '));
    report.warnings.forEach(function (w) { lines.push('WARNING: ' + w); });
    nutexNotify_('Nutex columns arranged', lines);
    return report;
  } finally {
    lock.releaseLock();
  }
}

/** Standard order: the schema columns, then any column you added yourself (never dropped). */
function nutexTargetOrder_(header, columns) {
  var known = columns.filter(function (c) { return header.indexOf(c) !== -1; });
  var extra = header.filter(function (h) { return columns.indexOf(h) === -1; });
  return known.concat(extra);
}

/**
 * Puts the columns of one sheet in the standard order. Every column moves
 * with all its cells (values, formulas, number formats, dropdowns), row by
 * row - nothing is deleted. A copy of the sheet is saved first.
 */
function nutexArrangeSheet_(ss, name, columns, report) {
  var sheet = ss.getSheetByName(name);
  if (!sheet || sheet.getLastColumn() < 1) return;
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  while (header.length && !header[header.length - 1]) header.pop();
  if (!header.length) return;
  if (header.some(function (h) { return !h; })) {
    report.warnings.push(name + ': a column has no header name - columns NOT arranged. Give it a name in row 1 and run again.');
    return;
  }
  var dupes = header.filter(function (h, i) { return header.indexOf(h) !== i; });
  if (dupes.length) {
    report.warnings.push(name + ': the column "' + dupes[0] + '" is there twice - columns NOT arranged. Keep one of them and run again.');
    return;
  }
  var target = nutexTargetOrder_(header, columns);
  if (JSON.stringify(target) === JSON.stringify(header)) return; // already in order

  var width = header.length;
  var rowsBefore = sheet.getLastRow();
  var lastRow = Math.max(rowsBefore, 1);
  var range = sheet.getRange(1, 1, lastRow, width);
  var values = range.getValues();
  var formulas = range.getFormulas();
  var formats = range.getNumberFormats();
  var from = target.map(function (h) { return header.indexOf(h); });
  var moved = target.filter(function (h, i) { return from[i] !== i; }).length;

  // 1. a copy of the sheet, exactly as it is now
  var backup = sheet.copyTo(ss);
  backup.setName(nutexBackupName_(ss, name + ' backup ' + Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm')));
  report.backups.push(backup.getName());

  // 2. the website may have added a row meanwhile: then change nothing
  if (sheet.getLastRow() !== rowsBefore || sheet.getLastColumn() !== lastCol) {
    report.warnings.push(name + ': changed while arranging - NOT arranged. Run again when nobody is ordering.');
    return;
  }

  // 3. write every row back with the columns in their new places
  var newValues = values.map(function (row, i) {
    return from.map(function (j) { return formulas[i][j] ? formulas[i][j] : row[j]; });
  });
  var newFormats = formats.map(function (row) { return from.map(function (j) { return row[j]; }); });
  range.setNumberFormats(newFormats);
  range.setValues(newValues);

  // dropdowns / text format follow the columns
  var rows = Math.max(sheet.getMaxRows() - 1, 1);
  var body = sheet.getRange(2, 1, rows, width);
  var rules = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, width).getDataValidations() : [];
  body.clearDataValidations();
  if (rules.length) sheet.getRange(2, 1, lastRow - 1, width).setDataValidations(rules.map(function (row) { return from.map(function (j) { return row[j]; }); }));
  nutexFormatColumns_(sheet, name, target, 1);
  nutexStyleHeader_(sheet, 1, width);
  report.arranged.push(name + ' (' + moved + ' columns moved)');
}

function nutexBackupName_(ss, base) {
  var name = base.slice(0, 90);
  var n = 1;
  while (ss.getSheetByName(name)) { n += 1; name = base.slice(0, 86) + ' (' + n + ')'; }
  return name;
}

function nutexStyleHeader_(sheet, startCol, count) {
  sheet.getRange(1, startCol, 1, count)
    .setFontWeight('bold')
    .setBackground('#5b1638')
    .setFontColor('#ffffff');
}

/** Text format + dropdowns for NEW columns only (existing values are never changed). */
function nutexFormatColumns_(sheet, name, columns, startCol) {
  var rows = Math.max(sheet.getMaxRows() - 1, 1);
  var textCols = NUTEX_TEXT_COLUMNS[name] || [];
  var dropdowns = NUTEX_DROPDOWNS[name] || {};
  columns.forEach(function (col, i) {
    var range = sheet.getRange(2, startCol + i, rows, 1);
    if (textCols.indexOf(col) !== -1) range.setNumberFormat('@');
    else if (nutexIsDateTimeColumn_(col)) range.setNumberFormat(NUTEX_DATETIME_FORMAT);
    if (dropdowns[col]) {
      range.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(dropdowns[col], true).setAllowInvalid(true).build());
    }
  });
}

function nutexHeaderMap_(sheet) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  return header;
}

/** Appends objects AFTER the last row, mapped by header name. Never overwrites. */
function nutexAppendObjects_(sheet, objects) {
  if (!objects.length) return;
  var header = nutexHeaderMap_(sheet);
  var rows = objects.map(function (o) {
    return header.map(function (h) { return Object.prototype.hasOwnProperty.call(o, h) ? o[h] : ''; });
  });
  var first = sheet.getLastRow() + 1;
  sheet.getRange(first, 1, rows.length, header.length).setValues(rows);
  header.forEach(function (h, i) {
    if (nutexIsDateTimeColumn_(h)) sheet.getRange(first, i + 1, rows.length, 1).setNumberFormat(NUTEX_DATETIME_FORMAT);
  });
}

function nutexColumnValues_(sheet, columnName) {
  var header = nutexHeaderMap_(sheet);
  var idx = header.indexOf(columnName);
  if (idx === -1 || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, idx + 1, sheet.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]).trim(); });
}

function nutexEnsureSettings_(ss) {
  var sheet = ss.getSheetByName('Settings');
  var present = nutexColumnValues_(sheet, 'setting_key');
  var now = nutexNow_();
  var rows = NUTEX_DEFAULT_SETTINGS
    .filter(function (s) { return present.indexOf(s[0]) === -1; })
    .map(function (s) {
      return { setting_key: s[0], setting_value: s[1], data_type: s[2], description: s[3], updated_at: now, updated_by: 'SETUP_SCRIPT' };
    });
  nutexAppendObjects_(sheet, rows);
  return rows.length;
}

function nutexEnsureVersions_(ss) {
  var sheet = ss.getSheetByName('Schema_Version');
  var present = nutexColumnValues_(sheet, 'version').map(Number);
  var now = nutexNow_();
  var added = [];
  var rows = NUTEX_MIGRATIONS
    .filter(function (m) { return present.indexOf(m[0]) === -1; })
    .map(function (m) {
      added.push('v' + m[0]);
      return { version: m[0], applied_at: now, description: m[1], app_version: 'apps-script' };
    });
  nutexAppendObjects_(sheet, rows);
  return added;
}

/* ---------------------------------------------- 2. initial master data */
function loadNutexMasterData() {
  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    setupNutexSheetsQuiet_(ss);
    var now = nutexNow_();
    var lines = [];

    var cats = ss.getSheetByName('Categories');
    if (cats.getLastRow() < 2) {
      nutexAppendObjects_(cats, NUTEX_MASTER_DATA.categories.map(function (c, i) {
        return {
          category_id: nutexNewId_('CAT'), category_name: c.category_name, parent_category: c.parent_category, slug: c.slug,
          status: 'ACTIVE', sort_order: (i + 1) * 10, created_at: now, updated_at: now,
        };
      }));
      lines.push('Categories: ' + NUTEX_MASTER_DATA.categories.length + ' added');
    } else lines.push('Categories: skipped (sheet already has data)');

    var sizes = ss.getSheetByName('Sizes');
    if (sizes.getLastRow() < 2) {
      nutexAppendObjects_(sizes, NUTEX_MASTER_DATA.sizes.map(function (s, i) {
        return { size_id: nutexNewId_('SIZ'), size_name: s, sort_order: (i + 1) * 10, status: 'ACTIVE', created_at: now, updated_at: now };
      }));
      lines.push('Sizes: ' + NUTEX_MASTER_DATA.sizes.length + ' added');
    } else lines.push('Sizes: skipped (sheet already has data)');

    var colors = ss.getSheetByName('Colors');
    if (colors.getLastRow() < 2) {
      nutexAppendObjects_(colors, NUTEX_MASTER_DATA.colors.map(function (c, i) {
        return {
          color_id: nutexNewId_('CLR'), color_name: c.color_name, color_code: c.color_code, hex_code: c.hex_code,
          status: 'ACTIVE', sort_order: (i + 1) * 10, created_at: now, updated_at: now,
        };
      }));
      lines.push('Colours: ' + NUTEX_MASTER_DATA.colors.length + ' added');
    } else lines.push('Colours: skipped (sheet already has data)');

    nutexNotify_('Initial master data', lines);
  } finally {
    lock.releaseLock();
  }
}

function setupNutexSheetsQuiet_(ss) {
  var report = { created: [], columns: [], warnings: [] };
  Object.keys(NUTEX_SCHEMA).forEach(function (name) { nutexEnsureSheet_(ss, name, NUTEX_SCHEMA[name], report); });
  nutexEnsureSettings_(ss);
  nutexEnsureVersions_(ss);
}

/** Stable, immutable IDs in the same format the website uses: PREFIX-<time36><random hex>. */
function nutexNewId_(prefix) {
  var time = Date.now().toString(36).toUpperCase();
  while (time.length < 9) time = '0' + time;
  var rand = Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase();
  Utilities.sleep(2);
  return prefix + '-' + time + rand;
}

/* ------------------------------------------------------- 3. check setup */
function checkNutexSetup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lines = [];
  var ok = true;
  Object.keys(NUTEX_SCHEMA).forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      ok = false;
      lines.push('MISSING sheet: ' + name);
      return;
    }
    var header = nutexHeaderMap_(sheet);
    while (header.length && !header[header.length - 1]) header.pop();
    var missing = NUTEX_SCHEMA[name].filter(function (c) { return header.indexOf(c) === -1; });
    if (missing.length) {
      ok = false;
      lines.push(name + ': missing columns ' + missing.join(', '));
    } else if (JSON.stringify(nutexTargetOrder_(header, NUTEX_SCHEMA[name])) !== JSON.stringify(header)) {
      ok = false;
      lines.push(name + ': all columns present, but some are in another place (run "1. Create / update all sheets" - data moves with them)');
    } else {
      lines.push(name + ': OK (' + Math.max(sheet.getLastRow() - 1, 0) + ' rows)');
    }
  });
  var editors = ss.getEditors().map(function (u) { return u.getEmail(); });
  var sa = editors.filter(function (e) { return /gserviceaccount\\.com$/i.test(e); });
  lines.push('');
  lines.push(sa.length ? 'Service account has Editor access: ' + sa.join(', ') : 'WARNING: no service account is an Editor yet - share the sheet with the GOOGLE_SERVICE_ACCOUNT_EMAIL.');
  lines.push(ok ? 'All sheets and columns are present.' : 'Run "1. Create / update all sheets" to add what is missing.');
  nutexNotify_('Nutex setup check', lines);
}

/* ---------------------------------------------------------------- utils */
function nutexNotify_(title, lines) {
  Logger.log(title + '\\n' + lines.join('\\n'));
  try {
    SpreadsheetApp.getUi().alert(title, lines.join('\\n'), SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    // Run from the script editor without a UI - see Execution log.
  }
}
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  fs.writeFileSync(OUTPUT, generateAppsScript(), 'utf8');
  console.log(`✓ Wrote ${path.relative(ROOT, OUTPUT)} (schema v${SCHEMA_VERSION}, ${Object.keys(SCHEMA).length} sheets)`);
}
