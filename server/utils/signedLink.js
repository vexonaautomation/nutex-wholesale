import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config/env.js';

// Signed link tokens for WhatsApp links that open without a login: an order
// id + expiry, signed per purpose ('packing-slip', 'admin-bill'), so a link
// for one purpose never opens another and cannot be guessed.
export function signedOrderToken(purpose, orderId, { days = 30, now = Date.now(), secret = config.sessionSecret } = {}) {
  const exp = Math.floor(now / 1000) + days * 86400;
  const body = `${orderId}.${exp}`;
  const sig = createHmac('sha256', secret).update(`${purpose}:${body}`).digest('base64url');
  return `${Buffer.from(body).toString('base64url')}.${sig}`;
}

/** The order id of a valid, unexpired token for this purpose, else null. */
export function readSignedOrderToken(purpose, token, { now = Date.now(), secret = config.sessionSecret } = {}) {
  const [b, sig] = String(token || '').split('.');
  if (!b || !sig) return null;
  const body = Buffer.from(b, 'base64url').toString();
  const expected = Buffer.from(createHmac('sha256', secret).update(`${purpose}:${body}`).digest('base64url'));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const [orderId, exp] = body.split('.');
  if (!orderId || !(Number(exp) * 1000 > now)) return null;
  return orderId;
}
