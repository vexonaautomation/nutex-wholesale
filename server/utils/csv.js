// CSV export helper. Cells that start with = + - @ are prefixed with an
// apostrophe so exported data cannot execute as spreadsheet formulas.
function cell(value) {
  if (value === null || value === undefined) return '';
  let s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(columns, rows) {
  const lines = [columns.map(cell).join(',')];
  for (const r of rows) lines.push(columns.map((c) => cell(r[c])).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

// ------------------------------------------------------------------
// CSV / spreadsheet paste reading (bulk imports)
// ------------------------------------------------------------------

/** Delimiter of a pasted/exported table line: tab (Excel copy), ; (some Excel locales) or comma. */
export function detectDelimiter(line) {
  if (line.includes('\t')) return '\t';
  const semis = (line.match(/;/g) || []).length;
  const commas = (line.match(/,/g) || []).length;
  return semis > commas ? ';' : ',';
}

/** Splits one line into cells; "quoted, values" and "" escapes are supported. */
export function parseCsvLine(line, delimiter = ',') {
  const cells = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && cur.trim() === '') {
      quoted = true;
      cur = '';
    } else if (ch === delimiter) {
      cells.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}
