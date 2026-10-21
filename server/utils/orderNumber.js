import { istDateKey } from './dates.js';

// Customer-facing order numbers are digits only: YYYYMMDD + a 4-digit number
// for the day, e.g. 202610210001. Orders made before v22 were NX-20261021-0001;
// those are converted in the sheet and still found when typed the old way.
const LEGACY_RE = /^[A-Z0-9]{1,8}-(\d{8})-(\d{4,})$/;

/** NX-20261015-0001 -> 202610150001; '' if the value is not an old-style number. */
export function legacyOrderNumberDigits(value) {
  const m = LEGACY_RE.exec(String(value ?? '').trim().toUpperCase());
  return m ? `${m[1]}${m[2]}` : '';
}

export function formatOrderNumber(dateKey, seq) {
  return `${dateKey}${String(seq).padStart(4, '0')}`;
}

export function nextOrderNumber(existingOrders, now = new Date()) {
  const dateKey = istDateKey(now);
  const re = new RegExp(`^${dateKey}(\\d{4,})$`);
  let max = 0;
  const taken = new Set();
  for (const o of existingOrders) {
    const key = normalizeOrderNumber(o.order_number);
    taken.add(key);
    const m = re.exec(key);
    if (m) max = Math.max(max, Number(m[1]));
  }
  let seq = max + 1;
  let candidate = formatOrderNumber(dateKey, seq);
  while (taken.has(candidate)) {
    seq += 1;
    candidate = formatOrderNumber(dateKey, seq);
  }
  return candidate;
}

/** The form order numbers are compared in: old NX-… numbers become digits. */
export function normalizeOrderNumber(value) {
  const s = String(value ?? '').trim().toUpperCase();
  return legacyOrderNumberDigits(s) || s;
}
