// All price arithmetic is done in integer paise to avoid floating point drift.

export const toPaise = (rupees) => Math.round((Number(rupees) || 0) * 100);
export const fromPaise = (paise) => Math.round(paise) / 100;
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

// ₹10,000 for whole rupees, ₹9,600.50 when paise are present
export function formatINR(amount) {
  const value = round2(amount);
  return `₹${Number.isInteger(value) ? inr.format(value) : inr2.format(value)}`;
}

export function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

export const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
