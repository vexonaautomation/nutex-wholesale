import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { sheetsService } from './sheetsService.js';
import { auditOp } from './auditService.js';
import { config } from '../config/env.js';
import { ADMIN_ROLE, AUDIT_ACTION, RECORD_STATUS } from '../config/constants.js';
import { newId, ID_PREFIX } from '../utils/idGenerator.js';
import { nowIso } from '../utils/dates.js';
import {
  AppError, badRequest, notFound, unauthorized, forbidden,
} from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { normalizeMobile } from '../utils/orderToken.js';
import {
  isSubAdmin, permissionsOf, joinPermissions, SUB_ADMIN_PERMISSIONS,
} from '../utils/permissions.js';
import { getSettings, updateSettings } from './settingsService.js';

const SHEET = 'Admin_Users';
const BCRYPT_ROUNDS = 12;
// Used to keep login timing constant when the email does not exist.
let dummyHash;
const getDummyHash = async () => {
  dummyHash ||= await bcrypt.hash('nutex-timing-equaliser', BCRYPT_ROUNDS);
  return dummyHash;
};

export const ADMIN_COOKIE = 'nx_admin';

export const publicAdmin = (a) => ({
  admin_id: a.admin_id,
  email: a.email,
  name: a.name,
  role: a.role,
  status: a.status,
  last_login_at: a.last_login_at,
  mobile: a.mobile || '',
  // null = full access (owner / admin / staff)
  permissions: isSubAdmin(a) ? permissionsOf(a) : null,
});

const MOBILE_RE = /^[6-9]\d{9}$/;
const mobileOf = (a) => normalizeMobile(a?.mobile || '');

export async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

function signToken(admin) {
  return jwt.sign(
    { sub: admin.admin_id, ver: Number(admin.session_version) || 1 },
    config.jwtSecret,
    { expiresIn: Math.floor(config.adminSessionMs / 1000), issuer: 'nutex-wholesale', audience: 'nutex-admin' },
  );
}

export async function login({ email, password }, { ip }) {
  const admins = await sheetsService.read(SHEET, { fresh: true });
  // sign in with the email, or a sub admin's mobile number
  const id = String(email || '').trim().toLowerCase();
  const mobile = id.includes('@') ? '' : normalizeMobile(id);
  const admin = admins.find((a) => (a.email && a.email.toLowerCase() === id) || (MOBILE_RE.test(mobile) && mobileOf(a) === mobile));
  const ok = await bcrypt.compare(password, admin?.password_hash || await getDummyHash());
  if (!admin || !ok || admin.status !== RECORD_STATUS.ACTIVE) {
    logger.warn('Failed admin login', { email, ip });
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }
  const now = nowIso();
  await sheetsService.commit([
    { op: 'update', sheet: SHEET, id: admin.admin_id, patch: { last_login_at: now } },
    auditOp({ admin, ip, action: AUDIT_ACTION.ADMIN_LOGIN, entity_type: 'Admin', entity_id: admin.admin_id }),
  ]);
  return { token: signToken(admin), admin: publicAdmin({ ...admin, last_login_at: now }) };
}

/** Verifies the JWT AND that the admin is still active with the same session version. */
export async function verifySession(token) {
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { issuer: 'nutex-wholesale', audience: 'nutex-admin' });
  } catch {
    throw unauthorized('Your session has expired. Please sign in again.');
  }
  const admins = await sheetsService.read(SHEET);
  const admin = admins.find((a) => a.admin_id === payload.sub);
  if (!admin || admin.status !== RECORD_STATUS.ACTIVE || (Number(admin.session_version) || 1) !== payload.ver) {
    throw unauthorized('Your session is no longer valid. Please sign in again.');
  }
  return admin;
}

export async function changePassword(admin, { current_password: currentPassword, new_password: newPassword }, { ip }) {
  const admins = await sheetsService.read(SHEET, { fresh: true });
  const row = admins.find((a) => a.admin_id === admin.admin_id);
  if (!row || !(await bcrypt.compare(currentPassword, row.password_hash))) throw badRequest('Current password is incorrect.');
  const version = (Number(row.session_version) || 1) + 1;
  await sheetsService.commit([
    { op: 'update', sheet: SHEET, id: row.admin_id, patch: { password_hash: await hashPassword(newPassword), session_version: version, updated_at: nowIso() } },
    auditOp({ admin, ip, action: AUDIT_ACTION.ADMIN_PASSWORD_CHANGED, entity_type: 'Admin', entity_id: row.admin_id }),
  ]);
  return { token: signToken({ ...row, session_version: version }) };
}

export async function listAdmins() {
  const admins = await sheetsService.read(SHEET, { fresh: true });
  return admins.map(publicAdmin);
}

export async function createAdmin({ email, name, role, password }, { admin, ip } = {}) {
  const admins = await sheetsService.read(SHEET, { fresh: true });
  if (admins.some((a) => a.email.toLowerCase() === email.toLowerCase())) throw badRequest('An admin with this email already exists.');
  if (admin && [ADMIN_ROLE.STAFF, ADMIN_ROLE.SUB_ADMIN].includes(admin.role)) throw forbidden('Staff users cannot create admins.');
  const now = nowIso();
  const row = {
    admin_id: newId(ID_PREFIX.admin),
    email: email.toLowerCase(),
    name,
    password_hash: await hashPassword(password),
    role: role || ADMIN_ROLE.ADMIN,
    status: RECORD_STATUS.ACTIVE,
    session_version: 1,
    last_login_at: '',
    created_at: now,
    updated_at: now,
  };
  await sheetsService.commit([
    { op: 'append', sheet: SHEET, rows: [row] },
    auditOp({ admin, ip, action: AUDIT_ACTION.ADMIN_CREATED, entity_type: 'Admin', entity_id: row.admin_id, new_value: publicAdmin(row) }),
  ]);
  return publicAdmin(row);
}

export async function setAdminStatus(id, status, { admin, ip }) {
  if (![RECORD_STATUS.ACTIVE, RECORD_STATUS.INACTIVE].includes(status)) throw badRequest('Invalid status');
  if (id === admin.admin_id) throw badRequest('You cannot change your own status.');
  if ([ADMIN_ROLE.STAFF, ADMIN_ROLE.SUB_ADMIN].includes(admin.role)) throw forbidden('Staff users cannot manage admins.');
  const admins = await sheetsService.read(SHEET, { fresh: true });
  const row = admins.find((a) => a.admin_id === id);
  if (!row) throw notFound('Admin not found.');
  if (row.role === ADMIN_ROLE.OWNER && admin.role !== ADMIN_ROLE.OWNER) throw forbidden('Only an owner can change an owner.');
  if (status === RECORD_STATUS.INACTIVE && row.status === RECORD_STATUS.ACTIVE
    && admins.filter((a) => a.status === RECORD_STATUS.ACTIVE).length <= 1) {
    throw badRequest('At least one active admin is required.');
  }
  // bumping session_version signs the user out everywhere
  const patch = { status, session_version: (Number(row.session_version) || 1) + 1, updated_at: nowIso() };
  await sheetsService.commit([
    { op: 'update', sheet: SHEET, id, patch },
    auditOp({ admin, ip, action: AUDIT_ACTION.ADMIN_UPDATED, entity_type: 'Admin', entity_id: id, old_value: { status: row.status }, new_value: { status } }),
  ]);
  // a sub admin's number orders for customers only while they are active
  if (isSubAdmin(row) && mobileOf(row)) {
    await syncAdminNumbers(status === RECORD_STATUS.ACTIVE ? { add: [mobileOf(row)] } : { remove: [mobileOf(row)] }, { admin, ip });
  }
  return publicAdmin({ ...row, ...patch });
}

// ------------------------------------------------------------- sub admins

/**
 * Sub admin numbers are admin order numbers (Settings > admin_order_mobiles):
 * they place orders for customers, and the order shows who made it. A number
 * is removed only when no other active admin user has it.
 */
async function syncAdminNumbers({ add = [], remove = [] }, ctx) {
  const settings = await getSettings({ fresh: true });
  const admins = await sheetsService.read(SHEET, { fresh: true });
  const stillUsed = new Set(admins.filter((a) => a.status === RECORD_STATUS.ACTIVE).map(mobileOf).filter(Boolean));
  const current = String(settings.admin_order_mobiles || '').split(/[,;/|\n]+/).map((m) => normalizeMobile(m)).filter((m) => MOBILE_RE.test(m));
  let next = current.filter((m) => !remove.includes(m) || stillUsed.has(m));
  for (const m of add) if (MOBILE_RE.test(m) && !next.includes(m)) next = [...next, m];
  if (next.join(',') !== current.join(',')) await updateSettings({ admin_order_mobiles: next.join(', ') }, ctx);
}

function checkUnique(admins, { mobile, email }, exceptId = null) {
  const others = admins.filter((a) => a.admin_id !== exceptId);
  if (others.some((a) => mobileOf(a) === mobile)) throw badRequest('Another admin user already has this mobile number.');
  if (email && others.some((a) => a.email && a.email.toLowerCase() === email.toLowerCase())) throw badRequest('An admin with this email already exists.');
}

/** Sub admins with what they may see and the orders made with their number. */
export async function listSubAdmins() {
  const [admins, orders] = await Promise.all([sheetsService.read(SHEET, { fresh: true }), sheetsService.read('Orders')]);
  const stats = new Map();
  for (const o of orders) {
    const m = normalizeMobile(o.placed_by_mobile || '');
    if (!m || o.order_status === 'CANCELLED') continue;
    const s = stats.get(m) || { orders: 0, value: 0 };
    s.orders += 1;
    s.value += Number(o.final_payable) || 0;
    stats.set(m, s);
  }
  return {
    permission_options: Object.entries(SUB_ADMIN_PERMISSIONS).map(([key, label]) => ({ key, label })),
    items: admins.filter(isSubAdmin).map((a) => ({
      ...publicAdmin(a),
      created_at: a.created_at,
      orders: stats.get(mobileOf(a))?.orders || 0,
      order_value: Math.round(stats.get(mobileOf(a))?.value || 0),
    })),
  };
}

export async function createSubAdmin({ name, mobile, email = '', password, permissions = [] }, { admin, ip }) {
  if (!admin || ![ADMIN_ROLE.OWNER, ADMIN_ROLE.ADMIN].includes(admin.role)) throw forbidden('Only the owner can add sub admins.');
  const admins = await sheetsService.read(SHEET, { fresh: true });
  const m = normalizeMobile(mobile);
  checkUnique(admins, { mobile: m, email });
  const now = nowIso();
  const row = {
    admin_id: newId(ID_PREFIX.admin),
    email: String(email || '').toLowerCase(),
    name,
    password_hash: await hashPassword(password),
    role: ADMIN_ROLE.SUB_ADMIN,
    status: RECORD_STATUS.ACTIVE,
    session_version: 1,
    last_login_at: '',
    created_at: now,
    updated_at: now,
    mobile: m,
    permissions: joinPermissions(permissions),
  };
  await sheetsService.commit([
    { op: 'append', sheet: SHEET, rows: [row] },
    auditOp({ admin, ip, action: AUDIT_ACTION.ADMIN_CREATED, entity_type: 'Admin', entity_id: row.admin_id, new_value: publicAdmin(row) }),
  ]);
  await syncAdminNumbers({ add: [m] }, { admin, ip });
  return publicAdmin(row);
}

export async function updateSubAdmin(id, { name, mobile, email = '', password = '', permissions = [] }, { admin, ip }) {
  if (!admin || ![ADMIN_ROLE.OWNER, ADMIN_ROLE.ADMIN].includes(admin.role)) throw forbidden('Only the owner can change sub admins.');
  const admins = await sheetsService.read(SHEET, { fresh: true });
  const row = admins.find((a) => a.admin_id === id);
  if (!row || !isSubAdmin(row)) throw notFound('Sub admin not found.');
  const m = normalizeMobile(mobile);
  checkUnique(admins, { mobile: m, email }, id);
  const patch = {
    name, mobile: m, email: String(email || '').toLowerCase(), permissions: joinPermissions(permissions), updated_at: nowIso(),
  };
  // a new password (or a new login number) signs them out everywhere
  if (password || m !== mobileOf(row)) patch.session_version = (Number(row.session_version) || 1) + 1;
  if (password) patch.password_hash = await hashPassword(password);
  const before = publicAdmin(row);
  await sheetsService.commit([
    { op: 'update', sheet: SHEET, id, patch },
    auditOp({
      admin, ip, action: AUDIT_ACTION.ADMIN_UPDATED, entity_type: 'Admin', entity_id: id,
      old_value: { name: before.name, mobile: before.mobile, email: before.email, permissions: before.permissions },
      new_value: { name: patch.name, mobile: patch.mobile, email: patch.email, permissions: permissionsOf(patch), password_changed: Boolean(password) },
    }),
  ]);
  if (m !== mobileOf(row) && row.status === RECORD_STATUS.ACTIVE) await syncAdminNumbers({ add: [m], remove: [mobileOf(row)] }, { admin, ip });
  return publicAdmin({ ...row, ...patch });
}

/** normalized mobile -> name of the admin user with that number (who made an order). */
export async function adminNamesByMobile() {
  const admins = await sheetsService.read(SHEET);
  return new Map(admins.filter((a) => mobileOf(a)).map((a) => [mobileOf(a), a.name]));
}

/**
 * First-admin bootstrap: runs only when the Admin_Users sheet is EMPTY and
 * ADMIN_BOOTSTRAP_EMAIL/PASSWORD are configured. Never modifies existing admins.
 */
export async function bootstrapAdmin() {
  const { email, password, name } = config.adminBootstrap;
  if (!email || !password) return null;
  const admins = await sheetsService.read(SHEET, { fresh: true });
  if (admins.length) return null;
  const created = await createAdmin({ email, name, role: ADMIN_ROLE.OWNER, password });
  logger.info(`Bootstrap admin created: ${email}. Remove ADMIN_BOOTSTRAP_PASSWORD from the environment now.`);
  return created;
}
