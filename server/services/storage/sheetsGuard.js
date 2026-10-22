// DATA-SAFETY GUARD
// Every structural/batch write to the spreadsheet passes through here.
// Only additive or targeted-cell operations are allowed. Requests that can
// delete or clear data (deleteSheet, deleteRange, updateSheetProperties,
// clear, ...) are rejected before reaching Google.
// Rows are removed (deleteDimension, exactly one data row each) only:
//  - when MOVING a row (a cancelled order to Cancelled_Orders): only in the
//    same atomic batch that appends at least as many rows elsewhere - the
//    copy is written first, and Google applies both or neither;
//  - from a DERIVED report sheet (Order_Items_Summary), whose rows are copies
//    of data kept elsewhere: `removableSheetIds` lists those sheets.
export const ALLOWED_SHEET_REQUESTS = Object.freeze(['addSheet', 'updateCells', 'appendCells', 'appendDimension', 'deleteDimension']);

export function assertSafeRequests(requests, { removableSheetIds = [] } = {}) {
  if (!Array.isArray(requests)) throw new Error('Sheets batch must be an array of requests');
  for (const req of requests) {
    const keys = Object.keys(req || {});
    if (keys.length !== 1 || !ALLOWED_SHEET_REQUESTS.includes(keys[0])) {
      throw new Error(`Blocked non-additive Google Sheets operation: ${keys.join(', ') || '(empty)'}`);
    }
    if (keys[0] === 'appendDimension' && req.appendDimension.dimension !== 'COLUMNS') {
      throw new Error('Blocked appendDimension: only COLUMNS may be appended by migrations');
    }
    if (keys[0] === 'deleteDimension') {
      const r = req.deleteDimension.range || {};
      if (r.dimension !== 'ROWS' || !(r.startIndex >= 1) || r.endIndex !== r.startIndex + 1) {
        throw new Error('Blocked deleteDimension: only one data row may be removed at a time');
      }
    }
  }
  const deletes = requests.filter((r) => r.deleteDimension && !removableSheetIds.includes(r.deleteDimension.range.sheetId)).length;
  if (deletes) {
    const appended = requests.reduce((s, r) => s + (r.appendCells ? r.appendCells.rows.length : 0), 0);
    if (appended < deletes) throw new Error('Blocked deleteDimension: a row may only be removed when its copy is appended in the same batch');
  }
}

export function quoteSheet(title) {
  return `'${String(title).replace(/'/g, "''")}'`;
}

// Converts a JS value into a Sheets CellData. Strings are written as literal
// strings (stringValue), so user input like "=HYPERLINK(...)" is NEVER
// evaluated as a formula, and phone numbers / pincodes keep leading zeros.
const MAX_CELL = 49000;
export function toCellData(value) {
  if (value === undefined || value === null || value === '') return {};
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { userEnteredValue: { numberValue: value } } : {};
  }
  if (typeof value === 'boolean') return { userEnteredValue: { boolValue: value } };
  let s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (s.length > MAX_CELL) s = `${s.slice(0, MAX_CELL)}…[truncated]`;
  return { userEnteredValue: { stringValue: s } };
}

export function fromCellData(cell) {
  const v = cell?.userEnteredValue;
  if (!v) return '';
  if ('numberValue' in v) return v.numberValue;
  if ('boolValue' in v) return v.boolValue;
  if ('stringValue' in v) return v.stringValue;
  return '';
}
