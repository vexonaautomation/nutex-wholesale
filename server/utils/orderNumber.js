import { istDateKey } from './dates.js';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function sanitizePrefix(prefix) {
  const clean = String(prefix || 'NX').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return clean || 'NX';
}

export function formatOrderNumber(prefix, dateKey, seq) {
  return `${sanitizePrefix(prefix)}-${dateKey}-${String(seq).padStart(4, '0')}`;
}

/**
 * Customer-friendly order number: PREFIX-YYYYMMDD-NNNN (IST date).
 * Computed from a FRESH read of Orders inside the commerce lock, so the daily
 * sequence is unique. The internal order_id (stable random ID) remains the
 * primary key; the order number is a unique, human-friendly reference.
 */
export function nextOrderNumber(existingOrders, prefix, now = new Date()) {
  const p = sanitizePrefix(prefix);
  const dateKey = istDateKey(now);
  const re = new RegExp(`^${escapeRe(p)}-${dateKey}-(\\d+)$`);
  let max = 0;
  const taken = new Set();
  for (const o of existingOrders) {
    taken.add(o.order_number);
    const m = re.exec(o.order_number || '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  let seq = max + 1;
  let candidate = formatOrderNumber(p, dateKey, seq);
  while (taken.has(candidate)) {
    seq += 1;
    candidate = formatOrderNumber(p, dateKey, seq);
  }
  return candidate;
}

export function normalizeOrderNumber(value) {
  return String(value || '').trim().toUpperCase();
}
