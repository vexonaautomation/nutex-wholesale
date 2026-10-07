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
  admin_id: a.admin_id, email: a.email, name: a.name, role: a.role, status: a.status, last_login_at: a.last_login_at,
});

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
  const admin = admins.find((a) => a.email.toLowerCase() === email.toLowerCase());
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
  if (admin && admin.role === ADMIN_ROLE.STAFF) throw forbidden('Staff users cannot create admins.');
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
  if (admin.role === ADMIN_ROLE.STAFF) throw forbidden('Staff users cannot manage admins.');
  const admins = await sheetsService.read(SHEET, { fresh: true });
  const row = admins.find((a) => a.admin_id === id);
  if (!row) throw notFound('Admin not found.');
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
  return publicAdmin({ ...row, ...patch });
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
