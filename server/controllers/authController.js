import {
  login, changePassword, listAdmins, createAdmin, setAdminStatus, publicAdmin, ADMIN_COOKIE,
} from '../services/authService.js';
import { adminCookieOptions } from '../middleware/adminAuth.js';
import { ctx, noStore } from './helpers.js';

export async function doLogin(req, res) {
  const { token, admin } = await login(req.body, { ip: req.ip });
  res.cookie(ADMIN_COOKIE, token, adminCookieOptions());
  noStore(res);
  res.json({ admin });
}

export function doLogout(_req, res) {
  const { maxAge, ...opts } = adminCookieOptions();
  res.clearCookie(ADMIN_COOKIE, opts);
  res.json({ ok: true });
}

export function me(req, res) {
  noStore(res);
  res.json({ admin: publicAdmin(req.admin) });
}

export async function doChangePassword(req, res) {
  const { token } = await changePassword(req.admin, req.body, ctx(req));
  res.cookie(ADMIN_COOKIE, token, adminCookieOptions());
  res.json({ ok: true });
}

export const usersList = async (_req, res) => res.json({ items: await listAdmins() });
export const usersCreate = async (req, res) => res.status(201).json(await createAdmin(req.body, ctx(req)));
export const usersStatus = async (req, res) => res.json(await setAdminStatus(req.params.id, req.body.status, ctx(req)));
