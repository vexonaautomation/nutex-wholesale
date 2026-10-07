import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { sheetsService } from './sheetsService.js';
import { getSettings } from './settingsService.js';
import { auditOp } from './auditService.js';
import { sendWhatsAppText } from './whatsappService.js';
import {
  resolveExistingCustomer, issueCustomerToken, readCustomerToken, maskMobile, appendAlternateNumber,
} from './existingCustomerService.js';
import { config } from '../config/env.js';
import { ACTOR, AUDIT_ACTION } from '../config/constants.js';
import { AppError, badRequest } from '../utils/errors.js';
import { normalizeMobile } from '../utils/orderToken.js';
import { logger } from '../utils/logger.js';

/**
 * Existing-customer verification with a WhatsApp OTP.
 *
 *  LOGIN
 *  1. start(mobile): the number (primary OR alternate) must be in
 *     Existing_Customers - no OTP is sent (no money spent) for unlisted numbers.
 *     A 6-digit code is sent on WhatsApp; only its HMAC is kept, for 5 minutes.
 *  2. confirm(mobile, otp): max 5 attempts; on success the customer receives a
 *     signed token valid for 90 days (stored in their browser).
 *
 *  ADD ANOTHER NUMBER (verified customers)
 *  3. startAlternate(token, newMobile) -> OTP to the NEW number
 *  4. confirmAlternate(token, newMobile, otp) -> number appended to their
 *     alternate_mobiles; from then on it can be used to log in.
 *
 * OTP challenges are short-lived security state (not business data), so they
 * live in memory; a restart simply means "request a new code".
 */
export const OTP_TTL_MS = 5 * 60 * 1000;
export const RESEND_AFTER_MS = 60 * 1000;
export const MAX_SENDS_PER_WINDOW = 3;
export const SEND_WINDOW_MS = 15 * 60 * 1000;
export const MAX_ATTEMPTS = 5;

const challenges = new Map(); // `${purpose}:${mobile}` -> { hash, expiresAt, attempts, sends: [ts] }

const hashOtp = (key, otp) => createHmac('sha256', config.sessionSecret).update(`otp:${key}:${otp}`).digest();

function sweep() {
  const now = Date.now();
  for (const [k, c] of challenges) {
    if (c.expiresAt < now && (!c.sends.length || now - c.sends[c.sends.length - 1] > SEND_WINDOW_MS)) challenges.delete(k);
  }
}

function validMobile(mobile) {
  const m = normalizeMobile(mobile);
  if (!/^[6-9]\d{9}$/.test(m)) throw badRequest('Enter a valid 10-digit mobile number.');
  return m;
}

async function listed(mobile, { fresh = true } = {}) {
  const [rows, settings] = await Promise.all([sheetsService.read('Existing_Customers', { fresh }), getSettings()]);
  return { rows, settings, status: resolveExistingCustomer(rows, settings, mobile) };
}

function verifiedResponse(mobile, status) {
  const { token, expires_at: expiresAt } = issueCustomerToken(mobile);
  return {
    existing: true,
    verified: true,
    token,
    expires_at: expiresAt,
    mobile,
    mobile_masked: maskMobile(mobile),
    numbers_masked: (status.numbers || [mobile]).map(maskMobile),
    minimum_order_value: status.minimum_order_value,
  };
}

async function auditVerified(mobile, ip, method) {
  try {
    await sheetsService.commit([auditOp({
      actorType: ACTOR.CUSTOMER, ip, action: AUDIT_ACTION.EXISTING_CUSTOMER_VERIFIED,
      entity_type: 'Existing_Customer', entity_id: mobile, notes: `Verified by ${method}`,
    })]);
  } catch (err) {
    logger.warn('Could not write verification audit entry', { error: err.message });
  }
}

async function sendOtp(purpose, mobile, settings) {
  const key = `${purpose}:${mobile}`;
  const now = Date.now();
  const c = challenges.get(key) || { sends: [], attempts: 0, expiresAt: 0, hash: null };
  c.sends = c.sends.filter((t) => now - t < SEND_WINDOW_MS);
  const last = c.sends[c.sends.length - 1];
  if (last && now - last < RESEND_AFTER_MS) {
    const wait = Math.ceil((RESEND_AFTER_MS - (now - last)) / 1000);
    throw new AppError(429, 'OTP_RESEND_WAIT', `Please wait ${wait} seconds before requesting a new code.`, { retry_after: wait });
  }
  if (c.sends.length >= MAX_SENDS_PER_WINDOW) {
    throw new AppError(429, 'OTP_LIMIT', 'Too many codes requested for this number. Please try again after 15 minutes.');
  }
  const otp = String(randomInt(0, 1000000)).padStart(6, '0');
  const message = String(settings.otp_message_template || '{{otp}} is your verification code.')
    .replace(/\{\{otp\}\}/g, otp)
    .replace(/\{\{company_name\}\}/g, settings.company_name || 'Nutex');
  await sendWhatsAppText(mobile, message);
  c.hash = hashOtp(key, otp);
  c.expiresAt = now + OTP_TTL_MS;
  c.attempts = 0;
  c.sends.push(now);
  challenges.set(key, c);
  const response = {
    otp_sent: true,
    channel: 'whatsapp',
    mobile_masked: maskMobile(mobile),
    expires_in: OTP_TTL_MS / 1000,
    resend_after: RESEND_AFTER_MS / 1000,
  };
  // Local development without a WhatsApp account: show the code on screen.
  if (config.whatsapp.provider === 'console' && !config.isProd) response.dev_otp = otp;
  return response;
}

function checkOtp(purpose, mobile, rawOtp) {
  const otp = String(rawOtp || '').replace(/\D/g, '');
  if (otp.length !== 6) throw badRequest('Enter the 6-digit code sent on WhatsApp.');
  const key = `${purpose}:${mobile}`;
  const c = challenges.get(key);
  if (!c || !c.hash || c.expiresAt < Date.now()) {
    throw new AppError(400, 'OTP_EXPIRED', 'This code has expired. Please request a new code.');
  }
  if (c.attempts >= MAX_ATTEMPTS) {
    c.hash = null;
    throw new AppError(429, 'OTP_LOCKED', 'Too many incorrect attempts. Please request a new code.');
  }
  if (!timingSafeEqual(hashOtp(key, otp), c.hash)) {
    c.attempts += 1;
    const left = MAX_ATTEMPTS - c.attempts;
    if (left <= 0) c.hash = null;
    throw new AppError(400, 'OTP_INVALID', left > 0 ? `Incorrect code. ${left} attempt(s) left.` : 'Too many incorrect attempts. Please request a new code.');
  }
  c.hash = null; // one-time use
}

// ------------------------------------------------------------------ login
export async function startVerification(rawMobile, { ip } = {}) {
  sweep();
  const mobile = validMobile(rawMobile);
  const { status, settings } = await listed(mobile);
  if (!status.existing) return { existing: false, mobile_masked: maskMobile(mobile) };
  if (settings.existing_customer_otp_enabled !== true) {
    await auditVerified(mobile, ip, 'mobile number (OTP switched off)');
    return verifiedResponse(mobile, status);
  }
  return { existing: true, ...(await sendOtp('login', mobile, settings)) };
}

export async function confirmVerification(rawMobile, rawOtp, { ip } = {}) {
  sweep();
  const mobile = validMobile(rawMobile);
  checkOtp('login', mobile, rawOtp);
  const { status } = await listed(mobile);
  if (!status.existing) throw new AppError(403, 'NOT_EXISTING_CUSTOMER', 'This number is no longer registered as an existing customer.');
  await auditVerified(mobile, ip, mobile === status.primary ? 'WhatsApp OTP' : 'WhatsApp OTP (alternate number)');
  return verifiedResponse(mobile, status);
}

/** Lets the browser confirm its stored token is still valid and listed. */
export async function customerStatus(token) {
  const t = readCustomerToken(token);
  if (!t) return { existing: false, verified: false };
  const { status } = await listed(t.mobile, { fresh: false });
  if (!status.existing) return { existing: false, verified: false, revoked: true };
  return {
    existing: true,
    verified: true,
    mobile: t.mobile,
    mobile_masked: maskMobile(t.mobile),
    numbers_masked: status.numbers.map(maskMobile),
    expires_at: new Date(t.exp).toISOString(),
    minimum_order_value: status.minimum_order_value,
  };
}

// ------------------------------------------------------- add another number
async function verifiedCustomer(token) {
  const t = readCustomerToken(token);
  if (!t) throw new AppError(401, 'CUSTOMER_LOGIN_REQUIRED', 'Please verify as an existing customer first.');
  const data = await listed(t.mobile);
  if (!data.status.existing) throw new AppError(403, 'NOT_EXISTING_CUSTOMER', 'Your number is no longer registered as an existing customer.');
  return { mobile: t.mobile, ...data };
}

export async function startAlternate(token, rawNewMobile, { ip } = {}) {
  sweep();
  const me = await verifiedCustomer(token);
  const newMobile = validMobile(rawNewMobile);
  if (me.status.numbers.includes(newMobile)) throw badRequest('This number is already linked to your account.');
  const other = resolveExistingCustomer(me.rows, me.settings, newMobile);
  if (other.existing) throw new AppError(409, 'NUMBER_IN_USE', 'This number is already registered with another customer. Please contact us on WhatsApp.');
  if (me.settings.existing_customer_otp_enabled !== true) {
    const res = await appendAlternateNumber(me.mobile, newMobile, { ip });
    return { added: true, numbers_masked: res.numbers.map(maskMobile) };
  }
  return sendOtp('alt', newMobile, me.settings);
}

export async function confirmAlternate(token, rawNewMobile, rawOtp, { ip } = {}) {
  sweep();
  const me = await verifiedCustomer(token);
  const newMobile = validMobile(rawNewMobile);
  checkOtp('alt', newMobile, rawOtp);
  const res = await appendAlternateNumber(me.mobile, newMobile, { ip });
  return { added: true, numbers_masked: res.numbers.map(maskMobile) };
}

// test helper
export function _resetChallenges() {
  challenges.clear();
}
