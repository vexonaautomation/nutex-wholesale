import { api } from './api.js';
import { customerHeader } from './customer.js';

// Order access tokens issued by the server are remembered on this device so
// the customer can come back to "My orders" without re-verifying.
const KEY = 'nutex_orders_v1';

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {
    return {};
  }
}

export function saveOrderAccess(orderNumber, token, meta = {}) {
  try {
    const all = readAll();
    all[orderNumber] = { token, saved_at: new Date().toISOString(), ...meta };
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

export function getOrderToken(orderNumber) {
  return readAll()[orderNumber]?.token || '';
}

export function listSavedOrders() {
  return Object.entries(readAll())
    .map(([order_number, v]) => ({ order_number, ...v }))
    .sort((a, b) => (a.saved_at < b.saved_at ? 1 : -1));
}

const tokenHeader = (orderNumber) => ({ 'X-Order-Token': getOrderToken(orderNumber) });

export const orderApi = {
  quote: (items, opts) => api.post('/api/cart/quote', { items }, { ...opts, headers: customerHeader() }),
  createDraft: (payload) => api.post('/api/orders/draft', payload, { headers: customerHeader() }),
  track: (order_number, mobile) => api.post('/api/orders/track', { order_number, mobile }),
  get: (n) => api.get(`/api/orders/${encodeURIComponent(n)}`, { headers: tokenHeader(n) }),
  update: (n, items, client_final_payable) => api.put(`/api/orders/${encodeURIComponent(n)}`, { items, client_final_payable }, { headers: tokenHeader(n) }),
  recalculate: (n, items, opts) => api.post(`/api/orders/${encodeURIComponent(n)}/recalculate`, items ? { items } : {}, { ...opts, headers: tokenHeader(n) }),
  lock: (n) => api.post(`/api/orders/${encodeURIComponent(n)}/lock`, {}, { headers: tokenHeader(n) }),
  submitPayment: (n, form) => api.upload(`/api/orders/${encodeURIComponent(n)}/payment`, form, { headers: tokenHeader(n) }),
};

export function newIdempotencyKey(prefix = 'k') {
  const rand = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9-]/g, '');
  return `${prefix}-${rand}`.slice(0, 90);
}
