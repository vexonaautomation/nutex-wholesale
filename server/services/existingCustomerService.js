import { createHmac, timingSafeEqual } from 'node:crypto';
import { sheetsService } from './sheetsService.js';
import { auditOp } from './auditService.js';
import { getSettings } from './settingsService.js';
import { config } from '../config/env.js';
import { ACTOR, AUDIT_ACTION, CUSTOMER_TYPE, RECORD_STATUS } from '../config/constants.js';
import { normalizeMobile } from '../utils/orderToken.js';
import { nowIso } from '../utils/dates.js';
import { AppError, badRequest, notFound } from '../utils/errors.js';
import { GSTIN_RE } from '../utils/validation.js';
import { detectDelimiter, parseCsvLine } from '../utils/csv.js';

const SHEET = 'Existing_Customers';
const MOBILE_RE = /^[6-9]\d{9}$/;
const VERIFIED_DAYS = 90;
const MAX_ALTERNATES = 5;

export const maskMobile = (m) => (m && m.length === 10 ? `${m.slice(0, 2)}XXXXX${m.slice(7)}` : '');
const isActive = (row) => String(row.status || RECORD_STATUS.ACTIVE).trim().toUpperCase() !== RECORD_STATUS.INACTIVE;

/** "98765 43210, +91 91234 56789 / 099887…" -> ['9876543210', '9123456789', …] (valid, unique) */
export function splitMobiles(value) {
  const parts = Array.isArray(value) ? value : String(value || '').split(/[,;/|\n]+/);
  const out = [];
  for (const p of parts) {
    const m = normalizeMobile(p);
    if (MOBILE_RE.test(m) && !out.includes(m)) out.push(m);
  }
  return out;
}

/** All numbers of one customer record: primary (column A) + alternates. */
export function numbersOf(row) {
  const primary = normalizeMobile(row.mobile);
  const list = MOBILE_RE.test(primary) ? [primary] : [];
  for (const m of splitMobiles(row.alternate_mobiles)) if (!list.includes(m)) list.push(m);
  return list;
}

const ownerOf = (rows, mobile, exceptKey = null) => rows.find((r) => r.mobile !== exceptKey && numbersOf(r).includes(mobile)) || null;

/**
 * Is this mobile (primary OR alternate) in the Existing_Customers list?
 * Accepts numbers typed by hand in any common format.
 */
export function resolveExistingCustomer(rows, settings, mobile) {
  const m = normalizeMobile(mobile);
  if (!MOBILE_RE.test(m)) return { existing: false, mobile: m };
  const row = (rows || []).find((r) => isActive(r) && numbersOf(r).includes(m));
  if (!row) return { existing: false, mobile: m };
  const own = row.minimum_order_value;
  const fallback = Number(settings?.existing_customer_minimum_order_value) || 0;
  const minimum = own !== null && own !== undefined && Number.isFinite(Number(own)) ? Number(own) : fallback;
  return {
    existing: true,
    mobile: m,
    key: row.mobile,
    primary: normalizeMobile(row.mobile),
    numbers: numbersOf(row),
    minimum_order_value: Math.max(0, minimum),
  };
}

/**
 * First purchase => existing customer. Operations (for the SAME commit as the
 * payment verification) that add the order's customer to Existing_Customers,
 * so from now on they may buy loose pieces and skip the minimum order.
 * Nothing happens if the setting is off or any of their numbers is already
 * listed (an INACTIVE row is an admin decision and is never reactivated).
 */
export function autoExistingOps({
  order, existingRows = [], settings = {}, admin = null, ip = '', now = nowIso(),
}) {
  if (settings.auto_existing_after_first_order === false) return [];
  const mobile = normalizeMobile(order?.mobile_snapshot);
  if (!MOBILE_RE.test(mobile)) return [];
  const alternate = normalizeMobile(order.alternate_mobile_snapshot);
  const numbers = [mobile, ...(MOBILE_RE.test(alternate) && alternate !== mobile ? [alternate] : [])];
  if (existingRows.some((r) => numbersOf(r).some((m) => numbers.includes(m)))) return [];
  const row = {
    mobile,
    alternate_mobiles: numbers.slice(1).join(', '),
    customer_name: String(order.customer_name_snapshot || '').slice(0, 100),
    business_name: String(order.business_name_snapshot || '').slice(0, 150),
    city: String(order.city_snapshot || '').slice(0, 80),
    gstin: String(order.gstin_snapshot || '').toUpperCase(),
    minimum_order_value: null,
    status: RECORD_STATUS.ACTIVE,
    notes: `Added automatically after first paid order ${order.order_number}`,
    added_at: now,
    updated_at: now,
    added_by: 'AUTO_FIRST_ORDER',
  };
  return [
    { op: 'append', sheet: SHEET, rows: [row] },
    auditOp({
      admin, ip, action: AUDIT_ACTION.EXISTING_CUSTOMER_ADDED, entity_type: 'Existing_Customer', entity_id: mobile,
      new_value: { mobile: maskMobile(mobile), order_number: order.order_number, reason: 'first paid order' },
    }),
  ];
}

// ------------------------------------------------------------------
// Verified-customer token: HMAC-signed { mobile, expiry } kept in the
// customer's browser for 90 days after WhatsApp OTP verification.
// Every quote / order still re-checks that the mobile is in the list.
// ------------------------------------------------------------------
const sign = (payload, secret) => createHmac('sha256', secret).update(`existing-customer:${payload}`).digest('base64url');

export function issueCustomerToken(mobile, { secret = config.sessionSecret, days = VERIFIED_DAYS } = {}) {
  const exp = Date.now() + days * 86400000;
  const payload = Buffer.from(JSON.stringify({ m: mobile, exp })).toString('base64url');
  return { token: `${payload}.${sign(payload, secret)}`, expires_at: new Date(exp).toISOString() };
}

export function readCustomerToken(token, { secret = config.sessionSecret } = {}) {
  if (!token || typeof token !== 'string' || token.length > 400) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { m, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!MOBILE_RE.test(m) || !(exp > Date.now())) return null;
    return { mobile: m, exp };
  } catch {
    return null;
  }
}

/** Customer context for pricing: token must be valid AND the number still listed. */
export function customerFromToken(catalog, token) {
  const t = readCustomerToken(token);
  if (!t) return { existing: false, type: CUSTOMER_TYPE.NEW };
  const status = resolveExistingCustomer(catalog.existingCustomers, catalog.settings, t.mobile);
  return status.existing ? { ...status, type: CUSTOMER_TYPE.EXISTING } : { existing: false, type: CUSTOMER_TYPE.NEW, mobile: t.mobile };
}

// ------------------------------------------------------------------ admin
function rowView(r, websiteCustomers, orders) {
  const nums = numbersOf(r);
  const m = normalizeMobile(r.mobile);
  const site = websiteCustomers.find((c) => nums.includes(normalizeMobile(c.mobile)));
  const own = orders.filter((o) => nums.includes(normalizeMobile(o.mobile_snapshot)));
  return {
    key: r.mobile, // raw value in column A (used to locate the row)
    mobile: m,
    valid_mobile: MOBILE_RE.test(m),
    alternate_mobiles: splitMobiles(r.alternate_mobiles).filter((x) => x !== m),
    customer_name: r.customer_name,
    business_name: r.business_name,
    city: r.city,
    gstin: r.gstin,
    minimum_order_value: r.minimum_order_value,
    status: isActive(r) ? RECORD_STATUS.ACTIVE : RECORD_STATUS.INACTIVE,
    notes: r.notes,
    added_at: r.added_at,
    added_by: r.added_by,
    website_customer_id: site?.customer_id || '',
    order_count: own.length,
    last_order_at: own.reduce((x, o) => (o.created_at > x ? o.created_at : x), ''),
  };
}

export async function listExistingCustomers({ q } = {}) {
  const [data, settings] = await Promise.all([
    sheetsService.readMany([SHEET, 'Customers', 'Orders'], { fresh: true }),
    getSettings(),
  ]);
  const needle = String(q || '').trim().toLowerCase();
  const all = data[SHEET].map((r) => rowView(r, data.Customers, data.Orders));
  const counts = new Map();
  for (const r of data[SHEET]) for (const m of numbersOf(r)) counts.set(m, (counts.get(m) || 0) + 1);
  const items = all
    .filter((r) => !needle || [r.mobile, ...r.alternate_mobiles, r.customer_name, r.business_name, r.city, r.gstin].some((v) => String(v || '').toLowerCase().includes(needle)))
    .sort((a, b) => String(b.added_at).localeCompare(String(a.added_at)));
  return {
    items,
    default_minimum: Number(settings.existing_customer_minimum_order_value) || 0,
    otp_enabled: settings.existing_customer_otp_enabled === true,
    duplicates: [...counts].filter(([, c]) => c > 1).map(([m]) => m),
  };
}

function cleanRow(input) {
  const mobile = normalizeMobile(input.mobile);
  if (!MOBILE_RE.test(mobile)) throw badRequest(`Invalid mobile number: ${input.mobile}`);
  const gstin = String(input.gstin || '').trim().toUpperCase();
  if (gstin && !GSTIN_RE.test(gstin)) throw badRequest(`Invalid GSTIN for ${mobile}`);
  const rawAlternates = Array.isArray(input.alternate_mobiles) ? input.alternate_mobiles : String(input.alternate_mobiles || '').split(/[,;/|\n]+/);
  const alternates = [];
  for (const raw of rawAlternates) {
    if (!String(raw).trim()) continue;
    const m = normalizeMobile(raw);
    if (!MOBILE_RE.test(m)) throw badRequest(`Invalid alternate number: ${raw}`);
    if (m !== mobile && !alternates.includes(m)) alternates.push(m);
  }
  if (alternates.length > MAX_ALTERNATES) throw badRequest(`Maximum ${MAX_ALTERNATES} alternate numbers per customer.`);
  const min = input.minimum_order_value;
  return {
    mobile,
    alternate_mobiles: alternates.join(', '),
    customer_name: String(input.customer_name || '').trim().slice(0, 100),
    business_name: String(input.business_name || '').trim().slice(0, 150),
    city: String(input.city || '').trim().slice(0, 80),
    gstin,
    minimum_order_value: min === '' || min === null || min === undefined ? null : Math.max(0, Number(min) || 0),
    notes: String(input.notes || '').trim().slice(0, 500),
  };
}

const ownerLabel = (r) => `${r.business_name || r.customer_name || 'another customer'} (${maskMobile(normalizeMobile(r.mobile))})`;

/** Additive: appends new customers; numbers already listed are skipped (or reactivated). */
export async function addExistingCustomers(inputs, { admin, ip }) {
  const rows = await sheetsService.read(SHEET, { fresh: true });
  const now = nowIso();
  const appended = [];
  const ops = [];
  const skipped = [];
  const seen = new Set();
  for (const input of inputs) {
    let row;
    try {
      row = cleanRow(input);
    } catch (err) {
      skipped.push({ mobile: input.mobile, reason: err.message });
      continue;
    }
    const nums = [row.mobile, ...splitMobiles(row.alternate_mobiles)];
    if (nums.some((m) => seen.has(m))) {
      skipped.push({ mobile: row.mobile, reason: 'Duplicate in this list' });
      continue;
    }
    const existing = rows.find((r) => normalizeMobile(r.mobile) === row.mobile);
    if (existing) {
      nums.forEach((m) => seen.add(m));
      if (!isActive(existing)) {
        ops.push({ op: 'update', sheet: SHEET, id: existing.mobile, patch: { status: RECORD_STATUS.ACTIVE, updated_at: now } });
        skipped.push({ mobile: row.mobile, reason: 'Already listed - reactivated' });
      } else {
        skipped.push({ mobile: row.mobile, reason: 'Already listed' });
      }
      continue;
    }
    const clash = nums.map((m) => ({ m, owner: ownerOf(rows, m) })).find((x) => x.owner);
    if (clash) {
      skipped.push({ mobile: row.mobile, reason: `${clash.m} is already registered with ${ownerLabel(clash.owner)}` });
      continue;
    }
    nums.forEach((m) => seen.add(m));
    appended.push({ ...row, status: RECORD_STATUS.ACTIVE, added_at: now, updated_at: now, added_by: admin?.email || admin?.admin_id || '' });
  }
  if (appended.length) ops.push({ op: 'append', sheet: SHEET, rows: appended });
  if (ops.length) {
    ops.push(auditOp({
      admin, ip, action: AUDIT_ACTION.EXISTING_CUSTOMER_ADDED, entity_type: 'Existing_Customer',
      entity_id: appended.map((r) => r.mobile).slice(0, 20).join(','), new_value: { added: appended.length, skipped: skipped.length },
    }));
    await sheetsService.commit(ops);
  }
  return { added: appended.length, skipped };
}

/**
 * Parses pasted text, one customer per line:
 *   mobile, name, business, city, alternate numbers (separated by / or more commas)
 */
// Column names accepted in a header row (template, Excel copy-paste or CSV file).
const BULK_COLUMNS = {
  mobile: ['mobile', 'mobile number', 'mobile no', 'phone', 'phone number', 'whatsapp', 'whatsapp number', 'number', 'contact'],
  customer_name: ['customer name', 'name', 'owner', 'owner name', 'contact name'],
  business_name: ['business name', 'business', 'shop', 'shop name', 'firm', 'firm name', 'company'],
  city: ['city', 'town', 'location'],
  alternate_mobiles: ['alternate mobiles', 'alternate mobile', 'alternate numbers', 'alternate number', 'alternate', 'other numbers', 'alt mobile'],
  gstin: ['gstin', 'gst', 'gst number', 'gst no'],
  minimum_order_value: ['minimum order value', 'minimum order', 'min order', 'minimum'],
  notes: ['notes', 'note', 'remarks'],
};
const normHeader = (h) => String(h || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[_\-.*:]+/g, ' ').replace(/\s+/g, ' ').trim();
const fieldOfHeader = (h) => Object.entries(BULK_COLUMNS).find(([, names]) => names.includes(normHeader(h)))?.[0] || null;
export const EXAMPLE_ROW_MARK = 'EXAMPLE ROW';

/**
 * Reads pasted text / a CSV file of existing customers.
 *  - With a header row (template, Excel copy-paste, CSV): columns are matched
 *    by name, in any order: mobile, customer_name, business_name, city,
 *    alternate_mobiles, gstin, minimum_order_value, notes.
 *  - Without a header: one customer per line
 *      mobile, name, business, city, alternate numbers (separated by / or more commas)
 * Blank lines, # comments and template example rows are ignored.
 */
export function parseBulkText(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .slice(0, 3001);
  if (!lines.length) return [];
  const delimiter = detectDelimiter(lines[0]);
  const first = parseCsvLine(lines[0], delimiter);
  const headerFields = first.map(fieldOfHeader);
  const hasHeader = headerFields.includes('mobile') && !first.some((c) => /\d{10}/.test(c.replace(/\D/g, '')));

  if (hasHeader) {
    return lines.slice(1).map((line) => {
      const cells = parseCsvLine(line, delimiter);
      const row = {};
      headerFields.forEach((field, i) => { if (field && cells[i] !== undefined && row[field] === undefined) row[field] = cells[i]; });
      return row;
    }).filter((r) => r.mobile && !String(r.notes || '').toUpperCase().startsWith(EXAMPLE_ROW_MARK));
  }
  return lines.slice(0, 3000).map((line) => {
    const [mobile, customerName, businessName, city, ...alts] = parseCsvLine(line, delimiter);
    return { mobile, customer_name: customerName, business_name: businessName, city, alternate_mobiles: alts.filter(Boolean).join('/') };
  }).filter((r) => r.mobile && !/^mobile$/i.test(r.mobile));
}

export async function updateExistingCustomer(key, input, { admin, ip }) {
  const rows = await sheetsService.read(SHEET, { fresh: true });
  const row = rows.find((r) => r.mobile === key);
  if (!row) throw notFound('Existing customer not found.');
  const next = cleanRow({
    ...input,
    mobile: row.mobile,
    alternate_mobiles: input.alternate_mobiles === undefined ? row.alternate_mobiles : input.alternate_mobiles,
  });
  for (const m of splitMobiles(next.alternate_mobiles)) {
    const owner = ownerOf(rows, m, row.mobile);
    if (owner) throw badRequest(`${m} is already registered with ${ownerLabel(owner)}.`);
  }
  const patch = {};
  const old = {};
  for (const k of ['customer_name', 'business_name', 'city', 'gstin', 'minimum_order_value', 'notes', 'alternate_mobiles']) {
    const before = k === 'alternate_mobiles' ? splitMobiles(row[k]).join(', ') : row[k];
    if (String(before ?? '') !== String(next[k] ?? '')) {
      patch[k] = next[k];
      old[k] = row[k];
    }
  }
  if (input.status && [RECORD_STATUS.ACTIVE, RECORD_STATUS.INACTIVE].includes(input.status) && input.status !== (isActive(row) ? RECORD_STATUS.ACTIVE : RECORD_STATUS.INACTIVE)) {
    patch.status = input.status;
    old.status = row.status;
  }
  if (!Object.keys(patch).length) return { updated: false };
  patch.updated_at = nowIso();
  const action = 'status' in patch && Object.keys(patch).length === 2
    ? (patch.status === RECORD_STATUS.ACTIVE ? AUDIT_ACTION.EXISTING_CUSTOMER_REACTIVATED : AUDIT_ACTION.EXISTING_CUSTOMER_DEACTIVATED)
    : AUDIT_ACTION.EXISTING_CUSTOMER_UPDATED;
  await sheetsService.commit([
    { op: 'update', sheet: SHEET, id: row.mobile, patch },
    auditOp({ admin, ip, action, entity_type: 'Existing_Customer', entity_id: normalizeMobile(row.mobile), old_value: old, new_value: patch }),
  ]);
  return { updated: true };
}

/**
 * Customer self-service: a verified existing customer adds another WhatsApp
 * number (already proven with its own OTP). Appends to alternate_mobiles only.
 */
export async function appendAlternateNumber(verifiedMobile, newMobile, { ip } = {}) {
  const [rows, settings] = await Promise.all([sheetsService.read(SHEET, { fresh: true }), getSettings()]);
  const status = resolveExistingCustomer(rows, settings, verifiedMobile);
  if (!status.existing) throw new AppError(403, 'NOT_EXISTING_CUSTOMER', 'Your number is no longer registered as an existing customer.');
  const row = rows.find((r) => r.mobile === status.key);
  if (numbersOf(row).includes(newMobile)) return { added: false, numbers: numbersOf(row) };
  const owner = ownerOf(rows, newMobile, row.mobile);
  if (owner) throw new AppError(409, 'NUMBER_IN_USE', 'This number is already registered with another customer. Please contact us on WhatsApp.');
  const alternates = [...splitMobiles(row.alternate_mobiles).filter((m) => m !== normalizeMobile(row.mobile)), newMobile];
  if (alternates.length > MAX_ALTERNATES) throw badRequest(`Maximum ${MAX_ALTERNATES} alternate numbers per customer.`);
  const patch = { alternate_mobiles: alternates.join(', '), updated_at: nowIso() };
  await sheetsService.commit([
    { op: 'update', sheet: SHEET, id: row.mobile, patch },
    auditOp({
      actorType: ACTOR.CUSTOMER, ip, action: AUDIT_ACTION.EXISTING_CUSTOMER_UPDATED, entity_type: 'Existing_Customer',
      entity_id: normalizeMobile(row.mobile), old_value: { alternate_mobiles: row.alternate_mobiles }, new_value: patch,
      notes: `Customer added alternate number ${maskMobile(newMobile)} (verified by WhatsApp OTP)`,
    }),
  ]);
  return { added: true, numbers: [normalizeMobile(row.mobile), ...alternates] };
}
