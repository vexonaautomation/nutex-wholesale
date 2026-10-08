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

/** Orders handed over or cancelled stop being shown in "Your orders". */
export function markOrderClosed(orderNumber) {
  try {
    const all = readAll();
    if (!all[orderNumber] || all[orderNumber].closed) return;
    all[orderNumber].closed = true;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

/** Open orders saved on this device (newest first, max 10). */
export function openSavedOrders() {
  return listSavedOrders().filter((o) => o.token && !o.closed).slice(0, 10);
}

const tokenHeader = (orderNumber) => ({ 'X-Order-Token': getOrderToken(orderNumber) });

export const orderApi = {
  quote: (items, opts) => api.post('/api/cart/quote', { items }, { ...opts, headers: customerHeader() }),
  createDraft: (payload) => api.post('/api/orders/draft', payload, { headers: customerHeader() }),
  active: (orders) => api.post('/api/orders/active', { orders: orders.map(({ order_number, token }) => ({ order_number, token })) }),
  track: (order_number, mobile) => api.post('/api/orders/track', { order_number, mobile }),
  get: (n) => api.get(`/api/orders/${encodeURIComponent(n)}`, { headers: tokenHeader(n) }),
  update: (n, items, client_final_payable) => api.put(`/api/orders/${encodeURIComponent(n)}`, { items, client_final_payable }, { headers: tokenHeader(n) }),
  recalculate: (n, items, opts) => api.post(`/api/orders/${encodeURIComponent(n)}/recalculate`, items ? { items } : {}, { ...opts, headers: tokenHeader(n) }),
  lock: (n) => api.post(`/api/orders/${encodeURIComponent(n)}/lock`, {}, { headers: tokenHeader(n) }),
  // order bill PDF (after the payment is submitted)
  bill: async (n) => {
    const res = await fetch(`/api/orders/${encodeURIComponent(n)}/bill`, { headers: tokenHeader(n), credentials: 'same-origin' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw Object.assign(new Error(body?.error?.message || 'Could not download the bill.'), { code: body?.error?.code, status: res.status });
    }
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1];
    return { blob: await res.blob(), filename: name || `Bill_${n}.pdf` };
  },
  submitPayment: (n, form) => api.upload(`/api/orders/${encodeURIComponent(n)}/payment`, form, { headers: tokenHeader(n) }),
};

export function newIdempotencyKey(prefix = 'k') {
  const rand = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9-]/g, '');
  return `${prefix}-${rand}`.slice(0, 90);
}
