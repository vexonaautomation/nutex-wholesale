// DATA-SAFETY GUARD
// Every structural/batch write to the spreadsheet passes through here.
// Only additive or targeted-cell operations are allowed. Requests that can
// delete or clear data (deleteSheet, deleteDimension, deleteRange,
// updateSheetProperties, clear, ...) are rejected before reaching Google.
export const ALLOWED_SHEET_REQUESTS = Object.freeze(['addSheet', 'updateCells', 'appendCells', 'appendDimension']);

export function assertSafeRequests(requests) {
  if (!Array.isArray(requests)) throw new Error('Sheets batch must be an array of requests');
  for (const req of requests) {
    const keys = Object.keys(req || {});
    if (keys.length !== 1 || !ALLOWED_SHEET_REQUESTS.includes(keys[0])) {
      throw new Error(`Blocked non-additive Google Sheets operation: ${keys.join(', ') || '(empty)'}`);
    }
    if (keys[0] === 'appendDimension' && req.appendDimension.dimension !== 'COLUMNS') {
      throw new Error('Blocked appendDimension: only COLUMNS may be appended by migrations');
    }
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
