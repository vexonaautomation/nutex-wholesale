import { randomBytes } from 'node:crypto';

// Stable, immutable, time-sortable IDs. NEVER derived from a sheet row number
// or array index. Format: PREFIX-<time base36><random hex>
export const ID_PREFIX = Object.freeze({
  product: 'PRD',
  category: 'CAT',
  color: 'CLR',
  size: 'SIZ',
  variant: 'VAR',
  inventory: 'INV',
  image: 'IMG',
  box: 'BOX',
  slab: 'SLB',
  customer: 'CUS',
  order: 'ORD',
  orderItem: 'OIT',
  payment: 'PAY',
  history: 'HIS',
  admin: 'ADM',
  audit: 'AUD',
});

export function newId(prefix) {
  const time = Date.now().toString(36).toUpperCase().padStart(9, '0');
  const rand = randomBytes(5).toString('hex').toUpperCase();
  return `${prefix}-${time}${rand}`;
}

export function newToken(bytes = 24) {
  return randomBytes(bytes).toString('base64url');
}
