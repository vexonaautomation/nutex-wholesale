import { sheetsService } from './sheetsService.js';
import { DEFAULT_SETTINGS, SETTINGS_BY_KEY } from '../config/defaults.js';
import { AUDIT_ACTION, DISCOUNT_MODE } from '../config/constants.js';
import { auditOp } from './auditService.js';
import { badRequest } from '../utils/errors.js';
import { nowIso } from '../utils/dates.js';
import { parseBool } from './sheetsService.js';

const SHEET = 'Settings';

function parseValue(def, raw) {
  if (!def) return raw;
  if (raw === '' || raw === null || raw === undefined) {
    return def.type === 'number' ? Number(def.value) : def.value;
  }
  switch (def.type) {
    case 'number': {
      const n = Number(String(raw).replace(/[,₹\s]/g, ''));
      return Number.isFinite(n) ? n : Number(def.value);
    }
    case 'boolean': return parseBool(raw);
    case 'enum': {
      const v = String(raw).trim().toUpperCase();
      return def.options.includes(v) ? v : def.value;
    }
    default: return String(raw);
  }
}

// Settings sheet rows -> typed settings object (defaults fill missing keys).
export function parseSettings(rows = []) {
  const byKey = new Map(rows.map((r) => [r.setting_key, r.setting_value]));
  const out = {};
  for (const def of DEFAULT_SETTINGS) out[def.key] = parseValue(def, byKey.get(def.key));
  return out;
}

export function publicSettings(settings) {
  const out = {};
  for (const def of DEFAULT_SETTINGS) if (def.public) out[def.key] = settings[def.key];
  return out;
}

export async function getSettings({ fresh = false } = {}) {
  return parseSettings(await sheetsService.read(SHEET, { fresh }));
}

// ADDITIVE: appends default rows only for keys missing in the sheet.
export async function ensureDefaultSettings() {
  const rows = await sheetsService.read(SHEET, { fresh: true });
  const present = new Set(rows.map((r) => r.setting_key));
  const now = nowIso();
  const missing = DEFAULT_SETTINGS.filter((d) => !present.has(d.key)).map((d) => ({
    setting_key: d.key,
    setting_value: d.value,
    data_type: d.type,
    description: d.description,
    updated_at: now,
    updated_by: 'SYSTEM_DEFAULT',
  }));
  if (missing.length) await sheetsService.commit([{ op: 'append', sheet: SHEET, rows: missing }]);
  return missing.map((m) => m.setting_key);
}

const digitsOnly = (v) => String(v || '').replace(/\D/g, '');

function normalizePhone(value) {
  const d = digitsOnly(value);
  if (!d) return '';
  if (d.length === 10) return `91${d}`;
  if (d.length >= 11 && d.length <= 15) return d;
  throw badRequest('Enter the WhatsApp number with country code, e.g. 919876543210');
}

function validateSetting(key, value) {
  const def = SETTINGS_BY_KEY[key];
  if (!def) throw badRequest(`Unknown setting: ${key}`);
  switch (def.type) {
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) throw badRequest(`${key} must be a number`);
      if (key === 'minimum_order_value' && (n < 0 || n > 100000000)) throw badRequest('Minimum order value must be between 0 and 10,00,00,000');
      if (key === 'default_discount_percent' && (n < 0 || n >= 100)) throw badRequest('Discount % must be between 0 and 99.99');
      if (key === 'reservation_expiry_hours' && (n < 0 || n > 720)) throw badRequest('Reservation expiry must be between 0 and 720 hours');
      if (key === 'low_stock_threshold' && (n < 0 || n > 100000)) throw badRequest('Low stock threshold must be 0 or more');
      if (key === 'existing_customer_minimum_order_value' && (n < 0 || n > 100000000)) throw badRequest('Existing customer minimum must be 0 or more');
      return Math.round(n * 100) / 100;
    }
    case 'enum': {
      const v = String(value || '').trim().toUpperCase();
      if (!def.options.includes(v)) throw badRequest(`${key} must be one of ${def.options.join(', ')}`);
      return v;
    }
    case 'phone':
      return normalizePhone(value);
    case 'boolean':
      return parseBool(value);
    default: {
      const s = String(value ?? '').trim();
      const max = def.type === 'text' ? 40000 : 500;
      if (s.length > max) throw badRequest(`${key} is too long`);
      if (key === 'order_prefix' && !/^[A-Z0-9]{1,8}$/.test(s.toUpperCase())) throw badRequest('Order prefix must be 1-8 letters/digits');
      if (key === 'upi_id' && s && !/^[\w.-]{2,256}@[A-Za-z][A-Za-z0-9.-]{1,64}$/.test(s)) throw badRequest('Enter a valid UPI ID, e.g. nutex@okaxis');
      if (key === 'company_email' && s && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) throw badRequest('Enter a valid email address');
      if (key === 'otp_message_template' && !s.includes('{{otp}}')) throw badRequest('The OTP message must contain {{otp}}');
      return key === 'order_prefix' ? s.toUpperCase() : s;
    }
  }
}

/**
 * Updates ONLY the changed keys (single cells). Every change is audited.
 */
export async function updateSettings(patch, { admin, ip }) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw badRequest('Invalid settings payload');
  const rows = await sheetsService.read(SHEET, { fresh: true });
  const byKey = new Map(rows.map((r) => [r.setting_key, r]));
  const current = parseSettings(rows);
  const now = nowIso();
  const ops = [];
  const changed = {};
  const previous = {};

  for (const [key, raw] of Object.entries(patch)) {
    const value = validateSetting(key, raw);
    if (String(current[key] ?? '') === String(value ?? '')) continue;
    changed[key] = value;
    previous[key] = current[key];
    const def = SETTINGS_BY_KEY[key];
    if (byKey.has(key)) {
      ops.push({ op: 'update', sheet: SHEET, id: key, patch: { setting_value: value, updated_at: now, updated_by: admin.admin_id } });
    } else {
      ops.push({ op: 'append', sheet: SHEET, rows: [{ setting_key: key, setting_value: value, data_type: def.type, description: def.description, updated_at: now, updated_by: admin.admin_id }] });
    }
  }
  if (!ops.length) return { settings: current, changed: {}, warnings: [] };

  ops.push(auditOp({ admin, ip, action: AUDIT_ACTION.SETTINGS_UPDATED, entity_type: 'Settings', entity_id: Object.keys(changed).join(','), old_value: previous, new_value: changed }));
  const pricingKeys = ['discount_mode', 'default_discount_percent', 'discount_slab_basis'];
  if (pricingKeys.some((k) => k in changed)) {
    const pick = (o) => Object.fromEntries(pricingKeys.filter((k) => k in changed).map((k) => [k, o[k]]));
    ops.push(auditOp({ admin, ip, action: AUDIT_ACTION.DISCOUNT_UPDATED, entity_type: 'Settings', entity_id: 'discount', old_value: pick(previous), new_value: pick(changed) }));
  }
  await sheetsService.commit(ops);

  const settings = { ...current, ...changed };
  const warnings = [];
  if (settings.discount_mode === DISCOUNT_MODE.SLAB) {
    const slabs = await sheetsService.read('Discount_Slabs', { fresh: true });
    if (!slabs.some((s) => s.active && !s.deleted)) warnings.push('Slab mode is ON but there are no active slabs - carts will get 0% discount until you add slabs.');
  }
  return { settings, changed, warnings };
}
