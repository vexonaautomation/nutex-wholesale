// Extra columns of the Orders sheet for the team (BD..BG in the standard
// column order): who handles the order, a bill link, the packing person and
// the type of customer.
//  - customer_type: "Existing Customer" when the order's mobile (or its
//    alternate number) is in the Existing_Customers list, else "Inbound Customer"
//  - doer: fixed per type - Settings doer_existing_customer (Ramesh) /
//    doer_inbound_customer (Mayank)
//  - bill_link: bill PDF that opens without a login (signed, does not expire)
import { config } from '../config/env.js';
import { CUSTOMER_TYPE } from '../config/constants.js';
import { numbersOf } from './existingCustomerService.js';
import { adminBillToken } from './orderAlertService.js';
import { normalizeMobile } from '../utils/orderToken.js';

export const CUSTOMER_TYPE_LABEL = { EXISTING: 'Existing Customer', INBOUND: 'Inbound Customer' };
const SHEET_LINK_DAYS = 36500; // the sheet keeps the link for good

const isActive = (row) => String(row.status || 'ACTIVE').trim().toUpperCase() !== 'INACTIVE';

export function isExistingOrder(order, existingRows) {
  if (order.customer_type_snapshot === CUSTOMER_TYPE.EXISTING) return true;
  const mine = [order.mobile_snapshot, order.alternate_mobile_snapshot].map(normalizeMobile).filter(Boolean);
  return (existingRows || []).some((r) => isActive(r) && numbersOf(r).some((m) => mine.includes(m)));
}

export function siteBaseUrl(baseUrl) {
  return String(baseUrl || config.frontendUrl || config.keepAlive.url || '').replace(/\/+$/, '');
}

export function billLink(orderId, baseUrl) {
  const base = siteBaseUrl(baseUrl);
  return base ? `${base}/api/admin-bill/${adminBillToken(orderId, { days: SHEET_LINK_DAYS })}` : '';
}

/** { customer_type, doer, bill_link } for one order. */
export function orderSheetColumns(order, { existingRows, settings, baseUrl }) {
  const existing = isExistingOrder(order, existingRows);
  return {
    customer_type: existing ? CUSTOMER_TYPE_LABEL.EXISTING : CUSTOMER_TYPE_LABEL.INBOUND,
    doer: String((existing ? settings?.doer_existing_customer : settings?.doer_inbound_customer) || (existing ? 'Ramesh' : 'Mayank')).trim(),
    bill_link: billLink(order.order_id, baseUrl),
  };
}
