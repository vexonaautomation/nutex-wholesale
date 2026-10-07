import { TIMEZONE } from '../config/constants.js';

export const nowIso = () => new Date().toISOString();

function istParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { y: get('year'), m: get('month'), d: get('day') };
}

// 'YYYY-MM-DD' in India Standard Time (used for slab date windows)
export function istDate(date = new Date()) {
  const { y, m, d } = istParts(date);
  return `${y}-${m}-${d}`;
}

// 'YYYYMMDD' in IST (used inside order numbers)
export function istDateKey(date = new Date()) {
  const { y, m, d } = istParts(date);
  return `${y}${m}${d}`;
}

export function isValidDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// Accepts 'YYYY-MM-DD', ISO timestamps, or common manual entries; returns 'YYYY-MM-DD' or ''.
export function normalizeDate(value) {
  if (!value) return '';
  const s = String(value).trim();
  if (isValidDateString(s)) return s;
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (iso) return iso[1];
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const out = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    return isValidDateString(out) ? out : '';
  }
  return '';
}

export function hoursSince(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return (Date.now() - t) / 3600000;
}
