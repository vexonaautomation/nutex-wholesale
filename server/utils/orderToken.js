import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config/env.js';

// Customer order-access token = HMAC(SESSION_SECRET, order_id).
// Order numbers are human-readable and guessable, so viewing/editing/paying an
// order requires this token (returned at checkout) or order number + mobile.
export function orderAccessToken(orderId, secret = config.sessionSecret) {
  return createHmac('sha256', secret).update(`order-access:${orderId}`).digest('base64url');
}

export function verifyOrderAccessToken(orderId, token, secret = config.sessionSecret) {
  if (!token || typeof token !== 'string') return false;
  const expected = Buffer.from(orderAccessToken(orderId, secret));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// Indian numbers: 10 digits (+91 / 0 dropped). A number from abroad keeps
// its country code behind a "+" (+971501234567), so it never looks like an
// Indian 10-digit number.
export function normalizeMobile(value) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  if (/^(\+|00)/.test(raw) && !/^(00)?91/.test(digits)) return `+${digits.replace(/^00/, '')}`;
  return digits;
}

export const INDIAN_MOBILE_RE = /^[6-9]\d{9}$/;
export const INTL_MOBILE_RE = /^\+[1-9]\d{6,14}$/;

/** A number the website can WhatsApp: Indian 10-digit or +country code. */
export const isCustomerMobile = (m) => INDIAN_MOBILE_RE.test(m) || INTL_MOBILE_RE.test(m);
