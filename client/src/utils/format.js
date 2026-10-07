const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

export function formatINR(value, { decimals = 'auto' } = {}) {
  if (value === null || value === undefined || value === '' || Number.isNaN(Number(value))) return '—';
  const n = Math.round(Number(value) * 100) / 100;
  const body = decimals === 'always' || !Number.isInteger(n) ? inr2.format(n) : inr.format(n);
  return `₹${body}`;
}

export const pct = (v) => `${Number(Math.round(Number(v || 0) * 100) / 100)}%`;

const dateFmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
});

export function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : dateFmt.format(d);
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : dateTimeFmt.format(d);
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function initials(text) {
  return String(text || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}
