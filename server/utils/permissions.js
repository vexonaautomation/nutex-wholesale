import { ADMIN_ROLE } from '../config/constants.js';

// Sub admins (role SUB_ADMIN) see only what the owner allows.
//  * always: the Orders tab (full access - list, details, edit items,
//    status, bill, cancel / reopen) and a small dashboard (pending orders +
//    sale value)
//  * optional, ticked per sub admin by the owner: the keys below
//  * never: settings, admin users, audit log, catalogue import, CSV export
// Owners / admins / staff keep full access (unchanged).
export const SUB_ADMIN_PERMISSIONS = Object.freeze({
  payments: 'Verify / reject payments + Payments page',
  customers: 'Customers + Existing customers',
  products: 'Products & catalogue (pack of, categories, colours, sizes)',
  inventory: 'Inventory / stock',
  pricing: 'Discount slabs',
  reports: 'Full dashboard (all numbers, stock alerts)',
});
export const PERMISSION_KEYS = Object.keys(SUB_ADMIN_PERMISSIONS);
// a new sub admin can also verify the payments of the orders they handle
export const DEFAULT_SUB_ADMIN_PERMISSIONS = Object.freeze(['payments']);

export const isSubAdmin = (admin) => admin?.role === ADMIN_ROLE.SUB_ADMIN;

/** Permissions stored on the Admin_Users row ("payments,customers"). */
export function permissionsOf(admin) {
  return String(admin?.permissions || '').split(',').map((p) => p.trim()).filter((p) => PERMISSION_KEYS.includes(p));
}

export const joinPermissions = (list) => [...new Set((list || []).filter((p) => PERMISSION_KEYS.includes(p)))].join(',');

/** May this admin use that part of the panel? Non sub admins: always. */
export function can(admin, permission) {
  if (!isSubAdmin(admin)) return true;
  return permissionsOf(admin).includes(permission);
}

// API paths (below /api/admin) a sub admin may call. Deny by default.
const ANY = '*';
const ALWAYS = [
  ['GET', /^\/me$/],
  ['POST', /^\/change-password$/],
  ['GET', /^\/dashboard$/],
  ['GET', /^\/media\/[^/]+$/],
  // the Orders tab: everything
  [ANY, /^\/orders(\/.*)?$/],
  ['GET', /^\/payments\/[^/]+\/proof$/],
];
const BY_PERMISSION = {
  payments: [['GET', /^\/payments$/], ['PUT', /^\/payments\/[^/]+\/(verify|reject)$/]],
  customers: [[ANY, /^\/(customers|existing-customers)(\/.*)?$/]],
  products: [
    [ANY, /^\/(products|categories|colors|sizes)(\/.*)?$/],
    ['GET', /^\/discount-slabs$/],
    ['POST', /^\/uploads$/],
  ],
  inventory: [[ANY, /^\/inventory(\/.*)?$/], ['GET', /^\/(products|categories)$/]],
  pricing: [[ANY, /^\/discount-slabs(\/.*)?$/], ['PUT', /^\/settings$/, 'pricing']],
};
// the discount page also saves these settings - nothing else
const PRICING_SETTINGS = new Set(['discount_mode', 'default_discount_percent', 'discount_slab_basis', 'minimum_order_value', 'price_display_mode']);

const matches = ([method, re, body], req) => {
  if (method !== ANY && method !== req.method && !(method === 'GET' && req.method === 'HEAD')) return false;
  if (!re.test(req.path)) return false;
  if (body === 'pricing') return Object.keys(req.body || {}).every((k) => PRICING_SETTINGS.has(k));
  return true;
};

/** Is this request allowed for this (sub) admin? */
export function allowedFor(admin, req) {
  if (!isSubAdmin(admin)) return true;
  if (ALWAYS.some((r) => matches(r, req))) return true;
  return permissionsOf(admin).some((p) => (BY_PERMISSION[p] || []).some((r) => matches(r, req)));
}
