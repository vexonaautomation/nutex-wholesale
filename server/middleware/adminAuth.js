import { verifySession, ADMIN_COOKIE } from '../services/authService.js';
import { config } from '../config/env.js';
import { unauthorized, forbidden } from '../utils/errors.js';
import { allowedFor } from '../utils/permissions.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function adminCookieOptions() {
  return {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'strict',
    path: '/',
    maxAge: config.adminSessionMs,
  };
}

/**
 * Protects every /api/admin route (except login).
 *  - JWT in an httpOnly, SameSite=Strict cookie (not readable by JS)
 *  - admin must still be ACTIVE with a matching session version
 *  - state-changing requests must carry the X-Requested-With header that
 *    only our own frontend sends (CSRF defence in depth)
 */
export async function requireAdmin(req, _res, next) {
  const bearer = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const token = req.cookies?.[ADMIN_COOKIE] || bearer;
  if (!token) return next(unauthorized());
  if (!SAFE_METHODS.has(req.method) && !bearer && req.get('x-requested-with') !== 'NutexAdmin') {
    return next(forbidden('Request rejected (missing client header).'));
  }
  req.admin = await verifySession(token);
  return next();
}

/** Sub admins may only call the parts of the panel the owner gave them. */
export function subAdminGate(req, _res, next) {
  if (allowedFor(req.admin, req)) return next();
  return next(forbidden('Your sub admin access does not include this. Ask the owner to allow it.'));
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.admin || !roles.includes(req.admin.role)) return next(forbidden('Your role does not allow this action.'));
    return next();
  };
}
