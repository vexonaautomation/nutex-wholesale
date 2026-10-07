import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { generateAppsScript, OUTPUT } from '../../scripts/generateAppsScript.js';
import { SCHEMA } from '../config/schema.js';
import { DEFAULT_SETTINGS } from '../config/defaults.js';
import { MIGRATIONS } from '../migrations/index.js';
import { MemorySheetsTransport } from '../services/storage/memorySheetsTransport.js';
import { configureStorage } from '../services/bootstrap.js';
import { runMigrations } from '../services/migrationService.js';
import { config } from '../config/env.js';

// ---- minimal fake of the Apps Script SpreadsheetApp API ----
class FakeSheet {
  constructor(name) { this.name = name; this.rows = []; this.maxCols = 26; this.maxRows = 1000; this.frozen = 0; }
  getName() { return this.name; }
  getMaxColumns() { return this.maxCols; }
  getMaxRows() { return this.maxRows; }
  insertColumnsAfter(_after, n) { this.maxCols += n; }
  setFrozenRows(n) { this.frozen = n; }
  getFrozenRows() { return this.frozen; }
  autoResizeColumns() {}
  getLastRow() {
    for (let i = this.rows.length - 1; i >= 0; i -= 1) if ((this.rows[i] || []).some((v) => v !== '' && v != null)) return i + 1;
    return 0;
  }
  getLastColumn() {
    let max = 0;
    for (const r of this.rows) for (let c = (r || []).length - 1; c >= 0; c -= 1) if (r[c] !== '' && r[c] != null) { max = Math.max(max, c + 1); break; }
    return max;
  }
  getRange(row, col, numRows = 1, numCols = 1) {
    const sheet = this;
    const range = {
      setValues(values) {
        if (col + numCols - 1 > sheet.maxCols) throw new Error('out of columns');
        values.forEach((vals, i) => {
          const r = row - 1 + i;
          while (sheet.rows.length <= r) sheet.rows.push([]);
          vals.forEach((v, j) => {
            const target = sheet.rows[r];
            while (target.length < col - 1 + j) target.push('');
            target[col - 1 + j] = v;
          });
        });
        return range;
      },
      getValues() {
        return Array.from({ length: numRows }, (_, i) => Array.from({ length: numCols }, (_, j) => sheet.rows[row - 1 + i]?.[col - 1 + j] ?? ''));
      },
    };
    for (const m of ['setFontWeight', 'setBackground', 'setFontColor', 'setNumberFormat', 'setDataValidation']) range[m] = () => range;
    return range;
  }
}

class FakeSpreadsheet {
  constructor(name) { this.name = name; this.sheets = [new FakeSheet('Sheet1')]; }
  getName() { return this.name; }
  rename(n) { this.name = n; }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  insertSheet(n) { const s = new FakeSheet(n); this.sheets.push(s); return s; }
  getSheets() { return this.sheets; }
  getEditors() { return [{ getEmail: () => 'owner@gmail.com' }, { getEmail: () => 'app@nutex.iam.gserviceaccount.com' }]; }
}

function runScript(ss) {
  const validation = { requireValueInList: () => validation, setAllowInvalid: () => validation, build: () => ({}) };
  const ctx = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      getUi: () => { throw new Error('no ui in tests'); },
      newDataValidation: () => validation,
    },
    LockService: { getDocumentLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { getUuid: () => crypto.randomUUID(), sleep() {} },
    Logger: { log() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(OUTPUT, 'utf8'), ctx);
  return ctx;
}

const snapshot = (ss) => JSON.stringify(ss.sheets.map((s) => [s.name, s.rows]));

test('google-sheets/setup.gs is up to date with the schema (run "npm run gs:generate")', () => {
  assert.equal(fs.readFileSync(OUTPUT, 'utf8'), generateAppsScript());
});

test('setup.gs creates every sheet with the exact headers, settings and versions', () => {
  const ss = new FakeSpreadsheet('Untitled spreadsheet');
  const gs = runScript(ss);
  gs.setupNutexSheets();
  assert.equal(ss.getName(), 'NUTEX WHOLESALE DATABASE');
  for (const [name, def] of Object.entries(SCHEMA)) {
    assert.deepEqual(ss.getSheetByName(name).rows[0], def.columns, `${name} header`);
    assert.equal(ss.getSheetByName(name).frozen, 1);
  }
  assert.equal(ss.getSheetByName('Settings').getLastRow() - 1, DEFAULT_SETTINGS.length);
  assert.equal(ss.getSheetByName('Schema_Version').getLastRow() - 1, MIGRATIONS.length);
});

test('setup.gs is additive: re-running changes nothing; data and extra columns are kept', () => {
  const ss = new FakeSpreadsheet('My sheet');
  const gs = runScript(ss);
  gs.setupNutexSheets();
  const before = snapshot(ss);
  gs.setupNutexSheets();
  assert.equal(snapshot(ss), before, 'second run must not change anything');

  // an older sheet without some columns + a business row + an admin's own column
  const ec = ss.getSheetByName('Existing_Customers');
  ec.rows = [['mobile', 'customer_name', 'my_notes'], ['9876543210', 'Riya', 'VIP']];
  gs.setupNutexSheets();
  assert.deepEqual(ec.rows[1].slice(0, 3), ['9876543210', 'Riya', 'VIP'], 'existing data untouched');
  assert.equal(ec.rows[0][2], 'my_notes', 'admin column kept in place');
  for (const col of SCHEMA.Existing_Customers.columns) assert.ok(ec.rows[0].includes(col), `${col} added`);
});

test('setup.gs master data: only into empty sheets, with app-style IDs', () => {
  const ss = new FakeSpreadsheet('x');
  const gs = runScript(ss);
  gs.loadNutexMasterData();
  const cats = ss.getSheetByName('Categories');
  assert.equal(cats.getLastRow() - 1, 10);
  assert.match(cats.rows[1][0], /^CAT-[0-9A-Z]{19}$/);
  gs.loadNutexMasterData();
  assert.equal(cats.getLastRow() - 1, 10, 'not loaded twice');
});

test('a spreadsheet prepared by setup.gs is accepted by the website without any change', async () => {
  const ss = new FakeSpreadsheet('x');
  const gs = runScript(ss);
  gs.setupNutexSheets();
  gs.loadNutexMasterData();
  const t = new MemorySheetsTransport();
  let id = 1;
  for (const s of ss.sheets) t.sheets.set(s.name, { sheetId: (id += 1), title: s.name, columnCount: s.maxCols, rows: s.rows.map((r) => [...r]) });
  configureStorage(config, { sheetsTransport: t });
  const report = await runMigrations();
  assert.deepEqual(report.createdSheets, []);
  assert.deepEqual(report.addedColumns, {});
  assert.deepEqual(report.addedSettings, []);
  assert.deepEqual(report.appliedMigrations, []);
});
