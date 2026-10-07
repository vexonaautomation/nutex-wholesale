import { SCHEMA, CATALOG_SHEETS, SCHEMA_VERSION } from '../config/schema.js';
import { logger } from '../utils/logger.js';
import { notFound, AppError } from '../utils/errors.js';
import { quoteSheet, toCellData } from './storage/sheetsGuard.js';

const CATALOG = new Set(CATALOG_SHEETS);
const MICRO_TTL_MS = 3000; // non-catalog sheets: absorb request bursts only

const TRUE_VALUES = new Set(['true', 'yes', '1', 'y']);
export const parseBool = (v) => v === true || TRUE_VALUES.has(String(v ?? '').trim().toLowerCase());

function coerce(sheetSchema, column, raw) {
  const type = sheetSchema?.types?.[column];
  if (type === 'number') {
    if (raw === '' || raw === null || raw === undefined) return null;
    if (typeof raw === 'number') return raw;
    const n = Number(String(raw).replace(/[,₹\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  if (type === 'boolean') return parseBool(raw);
  if (raw === null || raw === undefined) return '';
  return typeof raw === 'string' ? raw.trim() : String(raw);
}

/**
 * The ONLY gateway to the business database.
 *
 *  - Rows are mapped by HEADER NAME, never by position or row number.
 *  - `commit()` writes a list of operations in ONE atomic Google batch:
 *      { op: 'append', sheet, rows: [obj, ...] }
 *      { op: 'update', sheet, id, patch: { column: value } }   (only listed cells change)
 *  - There is deliberately NO delete / clear / replace capability.
 */
export class SheetsService {
  constructor() {
    this.transport = null;
    this.meta = new Map();
    this.cache = new Map();
    this.versions = new Map();
    this.inflight = new Map();
    this.ttlMs = 60000;
  }

  configure({ transport, ttlMs }) {
    this.transport = transport;
    if (ttlMs) this.ttlMs = ttlMs;
    this.meta = new Map();
    this.cache.clear();
    this.inflight.clear();
  }

  get configured() {
    return Boolean(this.transport);
  }

  #requireTransport() {
    if (!this.transport) throw new AppError(503, 'SERVICE_STARTING', 'Service is starting. Please try again in a moment.');
  }

  async loadMeta() {
    this.#requireTransport();
    const meta = await this.transport.getMeta();
    this.meta = new Map(meta.sheets.map((s) => [s.title, s]));
    return meta;
  }

  async #ensureMeta(names) {
    if (names.every((n) => this.meta.has(n))) return;
    await this.loadMeta();
    const missing = names.filter((n) => !this.meta.has(n));
    if (missing.length) {
      throw new AppError(503, 'SCHEMA_NOT_READY', `Database sheet(s) missing: ${missing.join(', ')}. Schema migration has not completed.`);
    }
  }

  #ttl(name) {
    return CATALOG.has(name) ? this.ttlMs : MICRO_TTL_MS;
  }

  parse(name, values) {
    const schema = SCHEMA[name];
    const headers = (values[0] || []).map((h) => String(h ?? '').trim());
    const rows = [];
    for (let i = 1; i < values.length; i += 1) {
      const raw = values[i] || [];
      if (!raw.some((v) => v !== '' && v !== null && v !== undefined)) continue;
      const obj = {};
      headers.forEach((h, j) => {
        if (h) obj[h] = coerce(schema, h, raw[j]);
      });
      for (const col of schema.columns) if (!(col in obj)) obj[col] = coerce(schema, col, undefined);
      if (schema.idField && (obj[schema.idField] === '' || obj[schema.idField] === null)) continue;
      Object.defineProperty(obj, '_row', { value: i + 1, enumerable: false });
      rows.push(obj);
    }
    return { headers, rows };
  }

  /**
   * Read several sheets in ONE API request.
   * fresh=true bypasses the cache (checkout, payment, inventory writes).
   */
  async readMany(names, { fresh = false } = {}) {
    this.#requireTransport();
    for (const n of names) if (!SCHEMA[n]) throw new Error(`Unknown sheet ${n}`);
    const now = Date.now();
    const result = {};
    const toFetch = [];
    for (const n of names) {
      const c = this.cache.get(n);
      if (!fresh && c && now - c.at < this.#ttl(n)) result[n] = c.rows;
      else toFetch.push(n);
    }
    if (!toFetch.length) return result;

    const key = toFetch.slice().sort().join('|');
    let promise = !fresh ? this.inflight.get(key) : null;
    if (!promise) {
      promise = this.#fetch(toFetch);
      if (!fresh) {
        this.inflight.set(key, promise);
        promise.finally(() => this.inflight.delete(key)).catch(() => {});
      }
    }
    try {
      Object.assign(result, await promise);
    } catch (err) {
      // Catalog pages may fall back to the last good copy if Google is briefly
      // unavailable. Critical (fresh) reads never use stale data.
      const stale = !fresh && toFetch.every((n) => this.cache.has(n));
      if (!stale) throw err;
      logger.warn('Sheets read failed; serving last cached copy', { sheets: toFetch, error: err.message });
      for (const n of toFetch) result[n] = this.cache.get(n).rows;
    }
    return result;
  }

  async #fetch(names) {
    await this.#ensureMeta(names);
    const values = await this.transport.readRanges(names.map((n) => quoteSheet(n)));
    const out = {};
    names.forEach((n, i) => {
      const parsed = this.parse(n, values[i]);
      this.cache.set(n, { at: Date.now(), rows: parsed.rows, headers: parsed.headers });
      this.versions.set(n, (this.versions.get(n) || 0) + 1);
      out[n] = parsed.rows;
    });
    return out;
  }

  async read(name, opts) {
    return (await this.readMany([name], opts))[name];
  }

  versionKey(names) {
    return names.map((n) => `${n}:${this.versions.get(n) || 0}`).join('|');
  }

  invalidate(names) {
    for (const n of names || [...this.cache.keys()]) {
      this.cache.delete(n);
      this.versions.set(n, (this.versions.get(n) || 0) + 1);
    }
  }

  /**
   * Apply append/update operations atomically.
   * Rows to update are located by their immutable ID immediately before the
   * write (never by a remembered row number). Only the patched cells change -
   * unrelated rows and columns (including admin-added columns) are untouched.
   */
  async commit(operations) {
    this.#requireTransport();
    const ops = operations.flat().filter(Boolean);
    if (!ops.length) return { requests: 0 };
    for (const op of ops) {
      if (!SCHEMA[op.sheet]) throw new Error(`Unknown sheet ${op.sheet}`);
      if (op.op === 'append' && (!Array.isArray(op.rows) || !op.rows.length)) throw new Error('append requires rows');
      if (op.op === 'update' && (!op.id || !op.patch)) throw new Error('update requires id and patch');
      if (!['append', 'update'].includes(op.op)) throw new Error(`Unsupported operation ${op.op}`);
    }
    const sheetNames = [...new Set(ops.map((o) => o.sheet))];
    await this.#ensureMeta(sheetNames);

    const updateSheets = new Set(ops.filter((o) => o.op === 'update').map((o) => o.sheet));
    const ranges = [];
    const index = {};
    for (const s of sheetNames) {
      index[s] = { header: ranges.push(`${quoteSheet(s)}!1:1`) - 1 };
      if (updateSheets.has(s)) index[s].ids = ranges.push(`${quoteSheet(s)}!A:A`) - 1;
    }
    const values = await this.transport.readRanges(ranges);

    const ctx = {};
    for (const s of sheetNames) {
      const headers = (values[index[s].header][0] || []).map((h) => String(h ?? '').trim());
      if (!headers.length) throw new AppError(503, 'SCHEMA_NOT_READY', `Sheet ${s} has no header row.`);
      let idRows = null;
      if (updateSheets.has(s)) {
        const idField = SCHEMA[s].idField;
        let column;
        if (headers[0] === idField) {
          column = values[index[s].ids].map((r) => r?.[0]);
        } else {
          // Columns were reordered manually - fall back to a full read.
          const col = headers.indexOf(idField);
          if (col < 0) throw new AppError(503, 'SCHEMA_NOT_READY', `Sheet ${s} is missing ID column ${idField}.`);
          const [full] = await this.transport.readRanges([quoteSheet(s)]);
          column = full.map((r) => r?.[col]);
        }
        idRows = new Map();
        column.forEach((v, i) => {
          if (i === 0 || v === '' || v === null || v === undefined) return;
          const k = String(v).trim();
          if (!idRows.has(k)) idRows.set(k, []);
          idRows.get(k).push(i + 1);
        });
      }
      ctx[s] = { headers, idRows, sheetId: this.meta.get(s).sheetId };
    }

    const requests = [];
    for (const op of ops) {
      const c = ctx[op.sheet];
      if (op.op === 'append') {
        for (const obj of op.rows) {
          for (const k of Object.keys(obj)) {
            if (!c.headers.includes(k)) throw new Error(`Column "${k}" missing in sheet ${op.sheet}; run migrations`);
          }
        }
        requests.push({
          appendCells: {
            sheetId: c.sheetId,
            rows: op.rows.map((obj) => ({ values: c.headers.map((h) => toCellData(h ? obj[h] : undefined)) })),
            fields: 'userEnteredValue',
          },
        });
        continue;
      }
      const idField = SCHEMA[op.sheet].idField;
      const found = c.idRows.get(String(op.id));
      if (!found) throw notFound(`${op.sheet} record ${op.id} was not found.`);
      if (found.length > 1) {
        throw new AppError(500, 'DATA_INTEGRITY', `Duplicate ID ${op.id} in ${op.sheet}. Refusing to write; please fix the sheet.`);
      }
      const rowIndex = found[0] - 1;
      const cells = Object.entries(op.patch)
        .map(([k, v]) => {
          if (k === idField) throw new Error(`Refusing to modify immutable ID column ${idField}`);
          const col = c.headers.indexOf(k);
          if (col < 0) throw new Error(`Column "${k}" missing in sheet ${op.sheet}; run migrations`);
          return { col, v };
        })
        .sort((a, b) => a.col - b.col);
      // merge contiguous cells into a single request
      let run = null;
      for (const cell of cells) {
        if (run && cell.col === run.start + run.values.length) {
          run.values.push(toCellData(cell.v));
        } else {
          if (run) requests.push(cellRun(c.sheetId, rowIndex, run));
          run = { start: cell.col, values: [toCellData(cell.v)] };
        }
      }
      if (run) requests.push(cellRun(c.sheetId, rowIndex, run));
    }

    await this.transport.batchUpdate(requests);
    this.invalidate(sheetNames);
    return { requests: requests.length };
  }

  /** READ-ONLY schema check (used by scripts/validateProduction.js). Writes nothing. */
  async schemaStatus() {
    this.#requireTransport();
    const meta = await this.transport.getMeta();
    const titles = new Set(meta.sheets.map((s) => s.title));
    const present = Object.keys(SCHEMA).filter((n) => titles.has(n));
    const heads = present.length ? await this.transport.readRanges(present.map((n) => `${quoteSheet(n)}!1:1`)) : [];
    const status = { spreadsheetTitle: meta.title, missingSheets: [], missingColumns: {}, extraSheets: [] };
    for (const name of Object.keys(SCHEMA)) {
      if (!titles.has(name)) {
        status.missingSheets.push(name);
        continue;
      }
      const header = (heads[present.indexOf(name)][0] || []).map((h) => String(h ?? '').trim());
      const missing = SCHEMA[name].columns.filter((c) => !header.includes(c));
      if (missing.length) status.missingColumns[name] = missing;
    }
    status.extraSheets = meta.sheets.map((s) => s.title).filter((t) => !SCHEMA[t]);
    return status;
  }

  // ------------------------------------------------------------------
  // SCHEMA MIGRATION (additive only)
  // ------------------------------------------------------------------
  async ensureSchema() {
    this.#requireTransport();
    const report = { createdSheets: [], addedColumns: {}, warnings: [], errors: [] };
    const meta = await this.loadMeta();
    const existing = new Map(meta.sheets.map((s) => [s.title, s]));
    const usedIds = new Set(meta.sheets.map((s) => s.sheetId));
    const requests = [];

    const present = Object.keys(SCHEMA).filter((n) => existing.has(n));
    const heads = present.length ? await this.transport.readRanges(present.map((n) => `${quoteSheet(n)}!1:2`)) : [];

    for (const [name, def] of Object.entries(SCHEMA)) {
      if (!existing.has(name)) {
        let sheetId;
        do sheetId = Math.floor(100000 + Math.random() * 2000000000); while (usedIds.has(sheetId));
        usedIds.add(sheetId);
        requests.push({
          addSheet: {
            properties: {
              sheetId,
              title: name,
              gridProperties: { rowCount: 1000, columnCount: Math.max(26, def.columns.length + 6), frozenRowCount: 1 },
            },
          },
        });
        requests.push(headerCells(sheetId, 0, def.columns));
        report.createdSheets.push(name);
        continue;
      }
      const sheet = existing.get(name);
      const block = heads[present.indexOf(name)] || [];
      const header = (block[0] || []).map((h) => String(h ?? '').trim());
      const hasData = (block[1] || []).some((v) => v !== '' && v != null);
      if (!header.some(Boolean)) {
        if (hasData) {
          report.errors.push(`Sheet "${name}" has data but no header row. Not modified - add the header row manually (see google-sheets/schema.md).`);
          continue;
        }
        requests.push(...widen(sheet, def.columns.length));
        requests.push(headerCells(sheet.sheetId, 0, def.columns));
        report.addedColumns[name] = [...def.columns];
        continue;
      }
      const dupes = header.filter((h, i) => h && header.indexOf(h) !== i);
      if (dupes.length) report.warnings.push(`Sheet "${name}" has duplicate headers: ${[...new Set(dupes)].join(', ')}`);
      const missing = def.columns.filter((c) => !header.includes(c));
      if (missing.length) {
        const start = header.length;
        requests.push(...widen(sheet, start + missing.length));
        requests.push(headerCells(sheet.sheetId, start, missing));
        report.addedColumns[name] = missing;
      }
    }

    if (requests.length) await this.transport.batchUpdate(requests);
    await this.loadMeta();
    this.invalidate();
    report.schemaVersion = SCHEMA_VERSION;
    return report;
  }
}

function cellRun(sheetId, rowIndex, run) {
  return {
    updateCells: {
      start: { sheetId, rowIndex, columnIndex: run.start },
      rows: [{ values: run.values }],
      fields: 'userEnteredValue',
    },
  };
}

function headerCells(sheetId, startColumn, names) {
  return {
    updateCells: {
      start: { sheetId, rowIndex: 0, columnIndex: startColumn },
      rows: [{ values: names.map((n) => ({ userEnteredValue: { stringValue: n } })) }],
      fields: 'userEnteredValue',
    },
  };
}

function widen(sheet, neededColumns) {
  if (sheet.columnCount >= neededColumns) return [];
  const length = neededColumns - sheet.columnCount + 4;
  sheet.columnCount += length;
  return [{ appendDimension: { sheetId: sheet.sheetId, dimension: 'COLUMNS', length } }];
}

export const sheetsService = new SheetsService();
