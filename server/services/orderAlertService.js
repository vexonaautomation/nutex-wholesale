// New-order alert: as soon as an order is placed on the website, every admin
// gets a WhatsApp message with the order details and a link to the bill PDF
// (opens without a login, signed, valid 30 days).
// Admins = the admin order numbers (Settings - sub admins are added there
// automatically), active admin users with a mobile, and the extra alert
// numbers in Settings. Sending never blocks or fails the customer's order.
import { sheetsService } from './sheetsService.js';
import { sendWhatsAppText } from './whatsappService.js';
import { getSettings } from './settingsService.js';
import { config } from '../config/env.js';
import { RECORD_STATUS } from '../config/constants.js';
import { signedOrderToken, readSignedOrderToken } from '../utils/signedLink.js';
import { normalizeMobile } from '../utils/orderToken.js';
import { formatINR } from '../utils/money.js';
import { notFound } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const PURPOSE = 'admin-bill';
const MOBILE_RE = /^[6-9]\d{9}$/;

export const adminBillToken = (orderId, opts) => signedOrderToken(PURPOSE, orderId, opts);

export async function adminBillByToken(token) {
  const orderId = readSignedOrderToken(PURPOSE, token);
  if (!orderId) throw notFound('This bill link is not valid any more. Open the order in the admin panel.');
  const { adminBill } = await import('./billService.js');
  return adminBill(orderId);
}

const numbers = (value) => String(value || '').split(/[,;/|\n]+/).map(normalizeMobile).filter((m) => MOBILE_RE.test(m));

/** Who gets the alert (unique 10-digit numbers). */
export function alertRecipients(settings, admins) {
  const out = new Set([
    ...numbers(settings.admin_order_mobiles),
    ...admins.filter((a) => a.status === RECORD_STATUS.ACTIVE).flatMap((a) => numbers(a.mobile)),
    ...numbers(settings.new_order_alert_mobiles),
  ]);
  return [...out];
}

/** Articles and pieces of an order's active lines (a box counts its pieces). */
export function orderCounts(items) {
  const active = items.filter((i) => i.status === 'ACTIVE');
  return {
    articles: new Set(active.map((i) => i.product_id)).size,
    pcs: active.reduce((s, i) => s + (Number(i.qty) || 0) * (i.inventory_mode_snapshot === 'BOX_WISE' ? Number(i.units_per_box_snapshot) || 1 : 1), 0),
  };
}

export function newOrderMessage({ order, items, link, adminLink, placedBy }) {
  const { articles, pcs } = orderCounts(items);
  const party = order.business_name_snapshot || order.customer_name_snapshot;
  return [
    '*Nutex - new order*',
    `Order: ${order.order_number}`,
    `Party: ${party}${order.business_name_snapshot && order.customer_name_snapshot ? ` (${order.customer_name_snapshot})` : ''}`,
    `City: ${[order.city_snapshot, order.state_snapshot].filter(Boolean).join(', ') || '-'}`,
    `Mobile: ${order.mobile_snapshot}`,
    `Customer: ${order.customer_type_snapshot === 'EXISTING' ? 'Existing' : 'New'}`,
    `Items: ${articles} article${articles === 1 ? '' : 's'}, ${pcs} pcs`,
    `Total: ${formatINR(order.final_payable)}${order.less_packing === true ? ' (less packing charges)' : ''}`,
    `Payment: ${order.payment_mode_snapshot === 'OFFLINE' ? 'Offline - team confirms' : 'Online (UPI) - pending'}`,
    placedBy ? `Made by: ${placedBy}` : null,
    order.order_notes ? `Note: ${String(order.order_notes).trim().slice(0, 300)}` : null,
    '',
    `Bill PDF: ${link}`,
    adminLink ? `Admin: ${adminLink}` : null,
  ].filter((line) => line !== null).join('\n');
}

/** Sends the alert for one order. Returns { sent, failed, skipped }. */
export async function sendNewOrderAlert(orderId, { baseUrl = config.frontendUrl } = {}) {
  const [settings, data] = await Promise.all([
    getSettings({ fresh: true }),
    sheetsService.readMany(['Orders', 'Order_Items', 'Admin_Users'], { fresh: true }),
  ]);
  if (settings.new_order_alert_enabled === false) return { sent: 0, failed: 0, skipped: 'off' };
  const order = data.Orders.find((o) => o.order_id === orderId);
  if (!order) return { sent: 0, failed: 0, skipped: 'no order' };
  const to = alertRecipients(settings, data.Admin_Users);
  if (!to.length) return { sent: 0, failed: 0, skipped: 'no admin numbers' };

  const base = String(baseUrl || '').replace(/\/+$/, '');
  const placedBy = order.placed_by_mobile
    ? data.Admin_Users.find((a) => normalizeMobile(a.mobile) === normalizeMobile(order.placed_by_mobile))?.name || 'Nutex team'
    : '';
  const message = newOrderMessage({
    order,
    items: data.Order_Items.filter((i) => i.order_id === order.order_id),
    link: `${base}/api/admin-bill/${adminBillToken(order.order_id)}`,
    adminLink: base ? `${base}/admin/orders/${order.order_id}` : '',
    placedBy,
  });
  let sent = 0;
  let failed = 0;
  for (const mobile of to) {
    try {
      await sendWhatsAppText(mobile, message);
      sent += 1;
    } catch (err) {
      failed += 1;
      logger.warn('New order alert not sent', { order: order.order_number, error: err.message });
    }
  }
  logger.info(`New order alert ${order.order_number}: sent to ${sent} admin number(s)${failed ? `, ${failed} failed` : ''}`);
  return { sent, failed };
}

/** Fire and forget: the customer never waits for (or sees) the alert. */
export function queueNewOrderAlert(orderId, opts) {
  setImmediate(() => {
    sendNewOrderAlert(orderId, opts).catch((err) => logger.error('New order alert failed', err));
  });
}
