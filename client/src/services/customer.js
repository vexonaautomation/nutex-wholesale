import { api } from './api.js';

// Verified existing-customer session (after WhatsApp OTP), kept on this
// device for 90 days. The server re-checks the token AND the
// Existing_Customers list on every quote and order.
const KEY = 'nutex_customer_auth_v1';

export function loadCustomerAuth() {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!a?.token || !a.expires_at || new Date(a.expires_at) <= new Date()) return null;
    return a;
  } catch {
    return null;
  }
}

export function saveCustomerAuth(auth) {
  try {
    localStorage.setItem(KEY, JSON.stringify(auth));
  } catch {
    /* storage unavailable */
  }
}

export function clearCustomerAuth() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function customerHeader() {
  const a = loadCustomerAuth();
  return a ? { 'X-Customer-Token': a.token } : {};
}

export const customerApi = {
  start: (mobile) => api.post('/api/customer/verify/start', { mobile }),
  confirm: (mobile, otp) => api.post('/api/customer/verify/confirm', { mobile, otp }),
  status: (token) => api.get('/api/customer/status', { headers: { 'X-Customer-Token': token } }),
  // verified customers: link another WhatsApp number (OTP goes to the new number)
  alternateStart: (mobile) => api.post('/api/customer/alternate/start', { mobile }, { headers: customerHeader() }),
  alternateConfirm: (mobile, otp) => api.post('/api/customer/alternate/confirm', { mobile, otp }, { headers: customerHeader() }),
};
