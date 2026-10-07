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

export function normalizeMobile(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}
