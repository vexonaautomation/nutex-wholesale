// "Order received" WhatsApp to the customer, as soon as the order is placed
// (also when an admin number placed it for them). It has the order number,
// party, items, total, what happens next (pay by UPI / the team confirms), a
// link that opens the order on any phone and a bill PDF link.
// Sending never blocks or fails the order. Settings: customer_order_message_enabled.
import { sheetsService } from './sheetsService.js';
import { sendWhatsAppText } from './whatsappService.js';
import { getSettings } from './settingsService.js';
import { orderCounts } from './orderAlertService.js';
import { siteBaseUrl } from './orderSheetColumns.js';
import { orderAccessToken, normalizeMobile } from '../utils/orderToken.js';
import { signedOrderToken, readSignedOrderToken } from '../utils/signedLink.js';
import { formatINR } from '../utils/money.js';
import { notFound } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const PURPOSE = 'customer-bill';
const LINK_DAYS = 365;
const MOBILE_RE = /^[6-9]\d{9}$/;

export const customerBillToken = (orderId, opts) => signedOrderToken(PURPOSE, orderId, { days: LINK_DAYS, ...opts });

export async function customerBillByToken(token) {
  const orderId = readSignedOrderToken(PURPOSE, token);
  if (!orderId) throw notFound('This bill link is not valid any more. Open your order on the website.');
  const { adminBill } = await import('./billService.js');
  const { loadOrderBundle, billAvailable } = await import('./orderService.js');
  const { order } = await loadOrderBundle(orderId, { byId: true });
  if (!billAvailable(order)) throw notFound('There is no bill for a cancelled order.');
  return adminBill(orderId);
}

const supportNumber = (value) => {
  const m = normalizeMobile(value);
  return MOBILE_RE.test(m) ? `+91 ${m.slice(0, 5)} ${m.slice(5)}` : '';
};

export function customerOrderMessage({ order, items, settings, orderLink, billLink }) {
  const { articles, pcs } = orderCounts(items);
  const gst = Number(settings.gst_percent) || 0;
  const offline = order.payment_mode_snapshot === 'OFFLINE';
  const support = supportNumber(settings.whatsapp_number);
  const name = order.customer_name_snapshot || order.business_name_snapshot;
  return [
    `*${settings.company_name || 'Nutex'}* - Order received ✅`,
    '',
    `Namaste ${name} ji,`,
    'Aapka order mil gaya hai. Dhanyavaad!',
    '',
    `Order No: ${order.order_number}`,
    `Party: ${order.business_name_snapshot || name}${order.city_snapshot ? `, ${order.city_snapshot}` : ''}`,
    `Items: ${articles} article${articles === 1 ? '' : 's'}, ${pcs} pcs`,
    `Total: ${formatINR(order.final_payable)}${gst > 0 ? ` (${gst}% GST included)` : ''}`,
    '',
    ...(offline
      ? ['Hamari team jaldi aapse sampark karke order confirm karegi.', `Order dekhein: ${orderLink}`]
      : [
        'Payment pending - neeche link se UPI QR scan karke payment karein aur UTR bhejein:',
        orderLink,
        '',
        'Order dekhne / badalne ke liye bhi yahi link use karein (payment se pehle items badal sakte hain).',
      ]),
    billLink ? `Bill PDF: ${billLink}` : null,
    '',
    support ? `Koi sawaal ho to WhatsApp karein: ${support}` : null,
    '- Team Nutex',
  ].filter((line) => line !== null).join('\n');
}

/** Sends the message for one order. Returns { sent, to } or { skipped }. */
export async function sendCustomerOrderMessage(orderId, { baseUrl } = {}) {
  const [settings, data] = await Promise.all([
    getSettings({ fresh: true }),
    sheetsService.readMany(['Orders', 'Order_Items'], { fresh: true }),
  ]);
  if (settings.customer_order_message_enabled === false) return { sent: false, skipped: 'off' };
  const order = data.Orders.find((o) => o.order_id === orderId);
  if (!order) return { sent: false, skipped: 'no order' };
  const to = [order.whatsapp_snapshot, order.mobile_snapshot].map(normalizeMobile).find((m) => MOBILE_RE.test(m));
  if (!to) return { sent: false, skipped: 'no number' };
  const base = siteBaseUrl(baseUrl);
  const message = customerOrderMessage({
    order,
    items: data.Order_Items.filter((i) => i.order_id === order.order_id),
    settings,
    orderLink: `${base}/order/${encodeURIComponent(order.order_number)}?t=${orderAccessToken(order.order_id)}`,
    billLink: base ? `${base}/api/bill/${customerBillToken(order.order_id)}` : '',
  });
  try {
    await sendWhatsAppText(to, message);
  } catch (err) {
    logger.warn('Customer order message not sent', { order: order.order_number, error: err.message });
    return { sent: false, to, error: err.message };
  }
  logger.info(`Order message sent to the customer of ${order.order_number}`);
  return { sent: true, to };
}

/** Fire and forget: the customer never waits for the message. */
export function queueCustomerOrderMessage(orderId, opts) {
  setImmediate(() => {
    sendCustomerOrderMessage(orderId, opts).catch((err) => logger.error('Customer order message failed', err));
  });
}
