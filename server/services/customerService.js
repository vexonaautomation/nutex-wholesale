import { sheetsService } from './sheetsService.js';
import { newId, ID_PREFIX } from '../utils/idGenerator.js';
import { nowIso } from '../utils/dates.js';
import { notFound } from '../utils/errors.js';
import { normalizeMobile } from '../utils/orderToken.js';
import { ORDER_STATUS } from '../config/constants.js';

const FIELDS = ['customer_name', 'business_name', 'mobile', 'whatsapp', 'email', 'billing_address', 'shipping_address', 'city', 'state', 'pincode', 'gstin', 'alternate_mobile'];

/**
 * Customer master upsert keyed on the mobile number. Returns the operations
 * to include in the order-creation commit. The ORDER keeps its own snapshot
 * of these details, so later customer edits never change past orders.
 */
export function customerUpsertOps(customerRows, input) {
  const mobile = normalizeMobile(input.mobile);
  // match the customer by main mobile, or by the alternate number they gave before
  const existing = customerRows.find((c) => normalizeMobile(c.mobile) === mobile)
    || customerRows.find((c) => c.alternate_mobile && normalizeMobile(c.alternate_mobile) === mobile);
  const now = nowIso();
  const fields = Object.fromEntries(FIELDS.map((f) => [f, f === 'mobile' ? mobile : input[f] ?? '']));
  if (existing && !fields.alternate_mobile) {
    // never lose a number the customer gave earlier
    const previousMain = normalizeMobile(existing.mobile);
    fields.alternate_mobile = previousMain !== mobile ? previousMain : existing.alternate_mobile || '';
  }
  if (!existing) {
    const customer_id = newId(ID_PREFIX.customer);
    return { customer_id, ops: [{ op: 'append', sheet: 'Customers', rows: [{ customer_id, ...fields, created_at: now, updated_at: now }] }] };
  }
  const patch = {};
  for (const f of FIELDS) if (String(existing[f] ?? '') !== String(fields[f] ?? '')) patch[f] = fields[f];
  if (!Object.keys(patch).length) return { customer_id: existing.customer_id, ops: [] };
  patch.updated_at = now;
  return { customer_id: existing.customer_id, ops: [{ op: 'update', sheet: 'Customers', id: existing.customer_id, patch }] };
}

function withStats(customer, orders) {
  const mine = orders.filter((o) => o.customer_id === customer.customer_id);
  const counted = mine.filter((o) => o.order_status !== ORDER_STATUS.CANCELLED);
  return {
    ...customer,
    order_count: mine.length,
    total_value: Math.round(counted.reduce((s, o) => s + (Number(o.final_payable) || 0), 0) * 100) / 100,
    last_order_at: mine.reduce((m, o) => (o.created_at > m ? o.created_at : m), ''),
  };
}

const existingSet = (rows) => new Set(rows
  .filter((r) => String(r.status || 'ACTIVE').toUpperCase() !== 'INACTIVE')
  .map((r) => normalizeMobile(r.mobile)));

export async function listCustomers({ q } = {}) {
  const data = await sheetsService.readMany(['Customers', 'Orders', 'Existing_Customers']);
  const existing = existingSet(data.Existing_Customers);
  const needle = String(q || '').trim().toLowerCase();
  return data.Customers
    .filter((c) => !needle || [c.customer_name, c.business_name, c.mobile, c.city, c.gstin, c.email].some((v) => String(v).toLowerCase().includes(needle)))
    .map((c) => ({ ...withStats(c, data.Orders), is_existing: existing.has(normalizeMobile(c.mobile)) }))
    .sort((a, b) => (a.last_order_at < b.last_order_at ? 1 : -1));
}

export async function getCustomer(id) {
  const data = await sheetsService.readMany(['Customers', 'Orders', 'Existing_Customers']);
  const customer = data.Customers.find((c) => c.customer_id === id);
  if (!customer) throw notFound('Customer not found.');
  const isExisting = existingSet(data.Existing_Customers).has(normalizeMobile(customer.mobile));
  const orders = data.Orders.filter((o) => o.customer_id === id)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .map((o) => ({
      order_id: o.order_id, order_number: o.order_number, created_at: o.created_at, final_payable: o.final_payable,
      order_status: o.order_status, payment_status: o.payment_status, locked: o.locked,
    }));
  return { customer: { ...withStats(customer, data.Orders), is_existing: isExisting }, orders };
}
