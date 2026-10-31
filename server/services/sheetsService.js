import { SCHEMA, CATALOG_SHEETS, SCHEMA_VERSION, TEXT_COLUMNS, ARCHIVES } from '../config/schema.js';
import { logger } from '../utils/logger.js';
import { notFound, AppError } from '../utils/errors.js';
import { quoteSheet, toCellData } from './storage/sheetsGuard.js';
import { toSheetSerial, fromSheetSerial, serialToDateString, DATETIME_FORMAT } from '../utils/sheetDates.js';
import { legacyOrderNumberDigits } from '../utils/orderNumber.js';

const CATALOG = new Set(CATALOG_SHEETS);
const MICRO_TTL_MS = 3000; // non-catalog sheets: absorb request bursts only

const APPEND_FIELDS = 'userEnteredValue,userEnteredFormat.numberFormat';
const TEXT_FORMAT = Object.freeze({ type: 'TEXT' });
const LEGACY_ORDER_NUMBER_SHEETS = ['Orders', 'Cancelled_Orders', 'Order_Items', 'Payments', 'Order_Status_History'];

// main sheet <-> archive sheet (Orders <-> Cancelled_Orders)
const FAMILY = {};
for (const [main, a] of Object.entries(ARCHIVES)) {
  FAMILY[main] = { main, ...a };
  FAMILY[a.archive] = FAMILY[main];
}

/**
 * CellData for one column. Date-time columns get a real date-time value
 * (shown as 21/10/2026 15:45:08); `withFormat` (appends) also keeps hand-typed
 * text columns in text format.
 */
function cellFor(sheet, column, value, { withFormat = false } = {}) {
  const def = SCHEMA[sheet];
  // fixed sheet formulas from the schema (never user input)
  const formula = def?.formulas?.[column];
  if (formula) return { userEnteredValue: { formulaValue: formula } };
  const options = withFormat && def?.dropdowns?.[column];
  if (options) {
    return {
      ...toCellData(value),
      dataValidation: { condition: { type: 'ONE_OF_LIST', values: options.map((v) => ({ userEnteredValue: v })) }, showCustomUi: true, strict: false },
    };
  }
  const type = def?.types?.[column];
  if (type === 'datetime') {
    // a number is a date-time read from the sheet (a row being moved)
    const serial = typeof value === 'number' ? value : toSheetSerial(value);
    if (serial !== null) return { userEnteredValue: { numberValue: serial }, userEnteredFormat: { numberFormat: DATETIME_FORMAT } };
  }
  const cell = toCellData(value);
  if (withFormat && TEXT_COLUMNS[sheet]?.includes(column)) cell.userEnteredFormat = { numberFormat: TEXT_FORMAT };
  return cell;
}

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
  // date-time cells come back as serial numbers; older rows may still be ISO text
  if (type === 'datetime' && typeof raw === 'number') return fromSheetSerial(raw);
  if (type === 'date' && typeof raw === 'number') return serialToDateString(raw);
  return typeof raw === 'string' ? raw.trim() : String(raw);
}

/**
 * The ONLY gateway to the business database.
 *
 *  - Rows are mapped by HEADER NAME, never by position or row number.
 *  - `commit()` writes a list of operations in ONE atomic Google batch:
 *      { op: 'append', sheet, rows: [obj, ...] }
 *      { op: 'update', sheet, id, patch: { column: value } }   (only listed cells change)
 *      { op: 'remove', sheet, id }  (DERIVED report sheets only, e.g. Order_Items_Summary)
 *  - There is deliberately NO delete / clear / replace capability for
 *    business data. The only row that ever leaves a sheet is a MOVED one
 *    (or a row of a derived report sheet): an order whose status
 *    becomes CANCELLED goes to Cancelled_Orders (and back when reopened) -
 *    the copy and the removal are one atomic batch. Reading 'Orders'
 *    returns the orders of both sheets.
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
      Object.defineProperty(obj, '_sheet', { value: name, enumerable: false });
      rows.push(obj);
    }
    return { headers, rows };
  }

  /**
   * Read several sheets in ONE API request.
   * fresh=true bypasses the cache (checkout, payment, inventory writes).
   */
  async readMany(names, opts) {
    // 'Orders' = live orders + cancelled orders (moved to Cancelled_Orders)
    const archives = names.map((n) => ARCHIVES[n]?.archive).filter(Boolean);
    if (!archives.length) return this.#readMany(names, opts);
    const result = await this.#readMany([...new Set([...names, ...archives])], opts);
    for (const [main, a] of Object.entries(ARCHIVES)) {
      if (!names.includes(main)) continue;
      result[main] = [...result[main], ...result[a.archive]];
      if (!names.includes(a.archive)) delete result[a.archive];
    }
    return result;
  }

  async #readMany(names, { fresh = false } = {}) {
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
    const all = names.flatMap((n) => (ARCHIVES[n] ? [n, ARCHIVES[n].archive] : [n]));
    return all.map((n) => `${n}:${this.versions.get(n) || 0}`).join('|');
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
   * An update of an order (sheet 'Orders') is applied wherever the order is;
   * when its order_status becomes / stops being CANCELLED the whole row moves
   * to / from Cancelled_Orders in the same batch.
   */
  async commit(operations) {
    this.#requireTransport();
    const ops = operations.flat().filter(Boolean).map((op) => ({ ...op }));
    if (!ops.length) return { requests: 0 };
    for (const op of ops) {
      if (!SCHEMA[op.sheet]) throw new Error(`Unknown sheet ${op.sheet}`);
      if (op.op === 'append' && (!Array.isArray(op.rows) || !op.rows.length)) throw new Error('append requires rows');
      if (op.op === 'update' && (!op.id || !op.patch)) throw new Error('update requires id and patch');
      if (op.op === 'remove' && (!op.id || !SCHEMA[op.sheet].derived)) throw new Error(`remove is only for rows of a derived sheet (not ${op.sheet})`);
      if (!['append', 'update', 'remove'].includes(op.op)) throw new Error(`Unsupported operation ${op.op}`);
    }
    const updateSheets = new Set();
    for (const op of ops) {
      if (op.op === 'remove') { updateSheets.add(op.sheet); continue; }
      if (op.op !== 'update') continue;
      updateSheets.add(op.sheet);
      const f = FAMILY[op.sheet];
      if (f) { updateSheets.add(f.main); updateSheets.add(f.archive); }
    }
    const sheetNames = [...new Set([...ops.map((o) => o.sheet), ...updateSheets])];
    await this.#ensureMeta(sheetNames);

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

    // updates of a moving family (Orders): apply where the row is now, and
    // collect rows whose status moves them to the other sheet
    const moves = new Map();
    for (const op of ops) {
      const f = op.op === 'update' && FAMILY[op.sheet];
      if (!f) continue;
      const id = String(op.id);
      const inMain = ctx[f.main].idRows.has(id);
      const inArchive = ctx[f.archive].idRows.has(id);
      if (inMain && inArchive) throw new AppError(500, 'DATA_INTEGRITY', `ID ${id} is in both ${f.main} and ${f.archive}. Refusing to write; please fix the sheet.`);
      if (inArchive) op.sheet = f.archive;
      else if (inMain) op.sheet = f.main;
      // every patch of the row in this batch (a move writes them all)
      const m = moves.get(id) || { f, from: op.sheet, patch: {} };
      Object.assign(m.patch, op.patch);
      moves.set(id, m);
    }
    for (const [id, m] of moves) {
      if (!(m.f.column in m.patch)) { moves.delete(id); continue; }
      m.to = String(m.patch[m.f.column]) === m.f.value ? m.f.archive : m.f.main;
      if (m.to === m.from) moves.delete(id);
    }

    const requests = [];
    const deletions = [];
    if (moves.size) {
      const sources = [...new Set([...moves.values()].map((m) => m.from))];
      const full = await this.transport.readRanges(sources.map((s) => quoteSheet(s)));
      for (const [id, m] of moves) {
        const src = ctx[m.from];
        const dst = ctx[m.to];
        const rows = full[sources.indexOf(m.from)];
        const idCol = src.headers.indexOf(SCHEMA[m.from].idField);
        const at = [];
        rows.forEach((r, i) => { if (i > 0 && String(r?.[idCol] ?? '').trim() === id) at.push(i); });
        if (!at.length) throw notFound(`${m.from} record ${id} was not found.`);
        if (at.length > 1) throw new AppError(500, 'DATA_INTEGRITY', `Duplicate ID ${id} in ${m.from}. Refusing to write; please fix the sheet.`);
        const obj = {};
        src.headers.forEach((h, j) => { if (h) obj[h] = rows[at[0]][j]; });
        Object.assign(obj, m.patch);
        // columns added by hand in the source sheet come along
        const extra = src.headers.filter((h) => h && !dst.headers.includes(h));
        if (extra.length) {
          requests.push(...widen(this.meta.get(m.to), dst.headers.length + extra.length));
          requests.push(headerCells(dst.sheetId, dst.headers.length, extra));
          dst.headers.push(...extra);
        }
        requests.push({
          appendCells: {
            sheetId: dst.sheetId,
            rows: [{ values: dst.headers.map((h) => (h ? cellFor(m.to, h, obj[h], { withFormat: true }) : {})) }],
            fields: APPEND_FIELDS,
          },
        });
        deletions.push({ sheetId: src.sheetId, rowIndex: at[0] });
      }
    }

    for (const op of ops) {
      if (op.op === 'update' && FAMILY[op.sheet] && moves.has(String(op.id))) continue; // written by the move
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
            rows: op.rows.map((obj) => ({ values: c.headers.map((h) => (h ? cellFor(op.sheet, h, obj[h], { withFormat: true }) : {})) })),
            fields: SCHEMA[op.sheet].dropdowns ? `${APPEND_FIELDS},dataValidation` : APPEND_FIELDS,
          },
        });
        continue;
      }
      const idField = SCHEMA[op.sheet].idField;
      const found = c.idRows.get(String(op.id));
      if (!found) {
        if (op.optional) continue; // e.g. a summary row older than the summary sheet
        throw notFound(`${op.sheet} record ${op.id} was not found.`);
      }
      if (found.length > 1) {
        throw new AppError(500, 'DATA_INTEGRITY', `Duplicate ID ${op.id} in ${op.sheet}. Refusing to write; please fix the sheet.`);
      }
      const rowIndex = found[0] - 1;
      if (op.op === 'remove') {
        deletions.push({ sheetId: c.sheetId, rowIndex });
        continue;
      }
      const cells = Object.entries(op.patch)
        .map(([k, v]) => {
          if (k === idField) throw new Error(`Refusing to modify immutable ID column ${idField}`);
          const col = c.headers.indexOf(k);
          if (col < 0) throw new Error(`Column "${k}" missing in sheet ${op.sheet}; run migrations`);
          return { col, cell: cellFor(op.sheet, k, v) };
        })
        .sort((a, b) => a.col - b.col);
      // merge contiguous cells into a single request (date-time cells also
      // set their format, so they only merge with each other)
      let run = null;
      for (const { col, cell } of cells) {
        const formatted = Boolean(cell.userEnteredFormat);
        if (run && col === run.start + run.values.length && formatted === run.formatted) {
          run.values.push(cell);
        } else {
          if (run) requests.push(cellRun(c.sheetId, rowIndex, run));
          run = { start: col, values: [cell], formatted };
        }
      }
      if (run) requests.push(cellRun(c.sheetId, rowIndex, run));
    }

    // moved / removed rows go last, bottom row first, so every row number
    // used above is still right
    deletions.sort((a, b) => b.rowIndex - a.rowIndex);
    for (const d of deletions) {
      requests.push({ deleteDimension: { range: { sheetId: d.sheetId, dimension: 'ROWS', startIndex: d.rowIndex, endIndex: d.rowIndex + 1 } } }); // ROW-MOVE
    }

    const removableSheetIds = sheetNames.filter((s) => SCHEMA[s].derived).map((s) => ctx[s].sheetId);
    await this.transport.batchUpdate(requests, { removableSheetIds });
    this.invalidate(sheetNames);
    return { requests: requests.length };
  }

  /**
   * One-time tidy-up of rows written before v22 (also run again a few minutes
   * after every start, for rows an old server copy wrote during a deploy):
   *  - ISO text in date-time columns -> real date-time values;
   *  - old order numbers NX-20261015-0001 -> 202610150001.
   * Only those cells are written (same value, new form); nothing else changes.
   * Each sheet is read just before it is written.
   */
  async upgradeLegacyCells() {
    this.#requireTransport();
    await this.loadMeta();
    const changed = {};
    const orderKeys = new Set();
    for (const name of Object.keys(SCHEMA)) {
      if (!this.meta.has(name)) continue;
      const types = SCHEMA[name].types;
      const dateCols = Object.keys(types).filter((k) => types[k] === 'datetime');
      const numberCol = LEGACY_ORDER_NUMBER_SHEETS.includes(name);
      if (!dateCols.length && !numberCol) continue;
      const [values] = await this.transport.readRanges([quoteSheet(name)]);
      const headers = (values[0] || []).map((h) => String(h ?? '').trim());
      const sheetId = this.meta.get(name).sheetId;
      const requests = [];
      let count = 0;
      const columnRuns = (col, convert, fields) => {
        let run = null;
        const flush = () => {
          if (run) requests.push({ updateCells: { start: { sheetId, rowIndex: run.row, columnIndex: col }, rows: run.cells.map((cell) => ({ values: [cell] })), fields } });
          run = null;
        };
        for (let r = 1; r < values.length; r += 1) {
          const cell = convert(values[r]?.[col]);
          if (!cell) { flush(); continue; }
          count += 1;
          if (run && r === run.row + run.cells.length) run.cells.push(cell);
          else { flush(); run = { row: r, cells: [cell] }; }
        }
        flush();
      };
      for (const colName of dateCols) {
        const col = headers.indexOf(colName);
        if (col < 0) continue;
        columnRuns(col, (raw) => {
          const serial = typeof raw === 'string' ? toSheetSerial(raw) : null;
          return serial === null ? null : { userEnteredValue: { numberValue: serial }, userEnteredFormat: { numberFormat: DATETIME_FORMAT } };
        }, APPEND_FIELDS);
      }
      const col = numberCol ? headers.indexOf('order_number') : -1;
      if (col >= 0) {
        if (name === 'Orders' || name === 'Cancelled_Orders') {
          for (let r = 1; r < values.length; r += 1) {
            const raw = String(values[r]?.[col] ?? '').trim();
            if (/^\d+$/.test(raw)) orderKeys.add(raw);
          }
        }
        columnRuns(col, (raw) => {
          const digits = legacyOrderNumberDigits(raw);
          if (!digits) return null;
          // never create a duplicate order number (Orders sheet decides)
          if (name === 'Orders' || name === 'Cancelled_Orders') {
            if (orderKeys.has(digits)) return null;
            orderKeys.add(digits);
          }
          return { userEnteredValue: { stringValue: digits } };
        }, 'userEnteredValue');
      }
      for (let i = 0; i < requests.length; i += 200) await this.transport.batchUpdate(requests.slice(i, i + 200));
      if (count) changed[name] = count;
    }
    this.invalidate();
    return changed;
  }

  /**
   * Fill one column where it is still blank: valueOf(row) for each data row
   * (parsed by header name). Only those cells are written; a value someone
   * typed is never changed. For sheets whose rows have no unique ID.
   */
  async fillBlanks(name, column, valueOf) {
    this.#requireTransport();
    await this.#ensureMeta([name]);
    const [values] = await this.transport.readRanges([quoteSheet(name)]);
    const { headers, rows } = this.parse(name, values);
    const col = headers.indexOf(column);
    if (col < 0) return 0;
    const sheetId = this.meta.get(name).sheetId;
    const requests = [];
    for (const row of rows) {
      if (String(values[row._row - 1]?.[col] ?? '').trim() !== '') continue;
      const v = valueOf(row);
      if (v === '' || v === null || v === undefined) continue;
      requests.push({ updateCells: { start: { sheetId, rowIndex: row._row - 1, columnIndex: col }, rows: [{ values: [toCellData(v)] }], fields: 'userEnteredValue' } });
    }
    for (let i = 0; i < requests.length; i += 200) await this.transport.batchUpdate(requests.slice(i, i + 200));
    this.invalidate([name]);
    return requests.length;
  }

  /**
   * Change cells of rows given by their row number (rows read just before -
   * `_row` of read()). For sheets whose rows have no unique ID (GBNutex).
   * Only the listed columns change; formulas / other columns are untouched.
   */
  async patchRows(name, patches) {
    this.#requireTransport();
    if (!patches.length) return 0;
    await this.#ensureMeta([name]);
    const [head] = await this.transport.readRanges([`${quoteSheet(name)}!1:1`]);
    const headers = (head[0] || []).map((h) => String(h ?? '').trim());
    const sheetId = this.meta.get(name).sheetId;
    const requests = [];
    for (const { row, patch } of patches) {
      for (const [k, v] of Object.entries(patch)) {
        const col = headers.indexOf(k);
        if (col < 0) throw new Error(`Column "${k}" missing in sheet ${name}; run migrations`);
        const cell = cellFor(name, k, v);
        requests.push({ updateCells: { start: { sheetId, rowIndex: row - 1, columnIndex: col }, rows: [{ values: [cell] }], fields: cell.userEnteredFormat ? APPEND_FIELDS : 'userEnteredValue' } });
      }
    }
    for (let i = 0; i < requests.length; i += 300) await this.transport.batchUpdate(requests.slice(i, i + 300));
    this.invalidate([name]);
    return patches.length;
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
      fields: run.formatted ? APPEND_FIELDS : 'userEnteredValue',
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
