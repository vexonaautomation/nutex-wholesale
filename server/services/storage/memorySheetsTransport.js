import { assertSafeRequests, fromCellData } from './sheetsGuard.js';

// In-memory imitation of the Google Sheets API used by automated tests and
// optional local experiments. It is REFUSED in production (see config/env.js).
// It mirrors Google behaviour that matters for data safety: atomic batches,
// append-after-last-row, trimmed trailing cells, and the same request guard.
export class MemorySheetsTransport {
  constructor({ title = 'Memory Spreadsheet' } = {}) {
    this.kind = 'memory';
    this.title = title;
    this.sheets = new Map(); // title -> { sheetId, title, columnCount, rows: any[][] }
    this.stats = { reads: 0, writes: 0 };
  }

  async getMeta() {
    return {
      title: this.title,
      sheets: [...this.sheets.values()].map((s) => ({
        sheetId: s.sheetId, title: s.title, rowCount: Math.max(1000, s.rows.length), columnCount: s.columnCount,
      })),
    };
  }

  async readRanges(ranges) {
    this.stats.reads += 1;
    return ranges.map((r) => this.#read(r));
  }

  async batchUpdate(requests) {
    if (!requests.length) return null;
    assertSafeRequests(requests);
    this.stats.writes += 1;
    const snapshot = this.#snapshot();
    try {
      for (const req of requests) this.#apply(req);
    } catch (err) {
      this.#restore(snapshot); // atomic like Google
      throw err;
    }
    return { replies: [] };
  }

  // ---- test helpers (not part of the transport contract) ----
  dump(title) {
    const s = this.sheets.get(title);
    return s ? s.rows.map((r) => [...r]) : null;
  }

  // ---- internals ----
  #parseRange(range) {
    const m = String(range).match(/^'((?:[^']|'')+)'(?:!(.+))?$/) || String(range).match(/^([^!]+)(?:!(.+))?$/);
    if (!m) throw Object.assign(new Error(`Unable to parse range: ${range}`), { status: 400 });
    return { title: m[1].replace(/''/g, "'"), a1: m[2] || null };
  }

  #sheet(title) {
    const s = this.sheets.get(title);
    if (!s) throw Object.assign(new Error(`Unable to parse range: ${title}`), { status: 400 });
    return s;
  }

  #read(range) {
    const { title, a1 } = this.#parseRange(range);
    const sheet = this.#sheet(title);
    const rows = trimRows(sheet.rows);
    if (!a1) return rows.map(trimRow);
    const rowRange = a1.match(/^(\d+):(\d+)$/);
    if (rowRange) {
      const from = Number(rowRange[1]) - 1;
      const to = Number(rowRange[2]);
      return trimRows(rows.slice(from, to)).map(trimRow);
    }
    const colRange = a1.match(/^([A-Z]+):([A-Z]+)$/);
    if (colRange) {
      const c1 = colIndex(colRange[1]);
      const c2 = colIndex(colRange[2]);
      return trimRows(rows.map((r) => trimRow(r.slice(c1, c2 + 1)))).map(trimRow);
    }
    throw Object.assign(new Error(`Unsupported range in memory transport: ${range}`), { status: 400 });
  }

  #apply(req) {
    const [type] = Object.keys(req);
    const body = req[type];
    if (type === 'addSheet') {
      const { sheetId, title, gridProperties } = body.properties;
      if (this.sheets.has(title)) throw Object.assign(new Error(`Sheet ${title} already exists`), { status: 400 });
      this.sheets.set(title, { sheetId, title, columnCount: gridProperties?.columnCount || 26, rows: [] });
      return;
    }
    const sheet = this.#byId(type === 'updateCells' ? body.start.sheetId : body.sheetId);
    if (type === 'appendDimension') {
      sheet.columnCount += body.length;
      return;
    }
    if (type === 'updateCells') {
      const { rowIndex, columnIndex } = body.start;
      body.rows.forEach((row, ri) => {
        const r = rowIndex + ri;
        while (sheet.rows.length <= r) sheet.rows.push([]);
        (row.values || []).forEach((cell, ci) => {
          const c = columnIndex + ci;
          if (c >= sheet.columnCount) throw Object.assign(new Error('Range exceeds grid limits'), { status: 400 });
          const target = sheet.rows[r];
          while (target.length <= c) target.push('');
          target[c] = fromCellData(cell);
        });
      });
      return;
    }
    if (type === 'appendCells') {
      let last = sheet.rows.length - 1;
      while (last >= 0 && !sheet.rows[last].some((v) => v !== '' && v != null)) last -= 1;
      sheet.rows.length = last + 1;
      for (const row of body.rows) sheet.rows.push((row.values || []).map(fromCellData));
    }
  }

  #byId(sheetId) {
    for (const s of this.sheets.values()) if (s.sheetId === sheetId) return s;
    throw Object.assign(new Error(`No sheet with id ${sheetId}`), { status: 400 });
  }

  #snapshot() {
    return new Map([...this.sheets].map(([k, s]) => [k, { ...s, rows: s.rows.map((r) => [...r]) }]));
  }

  #restore(snapshot) {
    this.sheets = snapshot;
  }
}

function trimRow(row) {
  const out = [...row];
  while (out.length && (out[out.length - 1] === '' || out[out.length - 1] == null)) out.pop();
  return out;
}

function trimRows(rows) {
  const out = [...rows];
  while (out.length && !out[out.length - 1].some((v) => v !== '' && v != null)) out.pop();
  return out;
}

export function colIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
