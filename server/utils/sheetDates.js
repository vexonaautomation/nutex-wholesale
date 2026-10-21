// Date-time cells in Google Sheets are numbers ("serial numbers": days since
// 30 Dec 1899) shown through a number format. The website keeps ISO strings
// in memory; only the sheet cell is a real date-time, written as India time
// (IST has no daylight saving, so a fixed +5:30 is exact).
const DAY_MS = 86400000;
const EPOCH_OFFSET_DAYS = 25569; // 1970-01-01 as a Sheets serial number
const IST_OFFSET_MS = 330 * 60000;

export const DATETIME_PATTERN = 'dd/mm/yyyy hh:mm:ss';
export const DATETIME_FORMAT = Object.freeze({ type: 'DATE_TIME', pattern: DATETIME_PATTERN });

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

/** ISO timestamp (or Date) -> Sheets serial number in IST; null if not a timestamp. */
export function toSheetSerial(value) {
  let ms;
  if (value instanceof Date) ms = value.getTime();
  else if (typeof value === 'string' && ISO_RE.test(value.trim())) ms = Date.parse(value.trim());
  else return null;
  if (!Number.isFinite(ms)) return null;
  return (ms + IST_OFFSET_MS) / DAY_MS + EPOCH_OFFSET_DAYS;
}

/** Sheets serial number (IST) -> ISO timestamp (UTC), millisecond exact. */
export function fromSheetSerial(serial) {
  const ms = Math.round((serial - EPOCH_OFFSET_DAYS) * DAY_MS - IST_OFFSET_MS);
  return new Date(ms).toISOString();
}

/** Sheets serial number -> 'YYYY-MM-DD' (date-only cells typed in the sheet). */
export function serialToDateString(serial) {
  return new Date(Math.round((Math.floor(serial) - EPOCH_OFFSET_DAYS) * DAY_MS)).toISOString().slice(0, 10);
}
