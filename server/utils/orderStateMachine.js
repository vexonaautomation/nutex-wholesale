import { ORDER_STATUS as S, PAYMENT_STATUS, PAYMENT_MODE } from '../config/constants.js';

// Explicit order state machine.
//
//   DRAFT ─┐
//          ├─> PAYMENT_PENDING ──(customer submits payment, LOCK)──> PAYMENT_SUBMITTED
//          │        ^                                                 │        │
//          │        └──────────── admin REOPEN (reason, audited) ─────┤        │
//          │                                                  (verify)│  (reject)
//          │                                                          v        v
//          │                                           PAYMENT_VERIFIED   PAYMENT_REJECTED ─(re-submit)─> PAYMENT_SUBMITTED
//          │                                                  │
//          │                         CONFIRMED -> PROCESSING -> PACKED -> DISPATCHED -> COMPLETED
//          └── any state before DISPATCHED ──(admin cancel)──> CANCELLED
//
// Editable: DRAFT, PAYMENT_PENDING (and only while locked=false).
// Everything else is LOCKED. Only an admin can reopen.

export const STATE_LABELS = Object.freeze({
  [S.DRAFT]: 'Draft',
  [S.PAYMENT_PENDING]: 'Payment Pending',
  [S.PAYMENT_SUBMITTED]: 'Payment Submitted',
  [S.PAYMENT_VERIFIED]: 'Payment Verified',
  [S.PAYMENT_REJECTED]: 'Payment Rejected',
  [S.CONFIRMED]: 'Confirmed',
  [S.PROCESSING]: 'Processing',
  [S.PACKED]: 'Packed',
  [S.DISPATCHED]: 'Dispatched',
  [S.COMPLETED]: 'Handed over',
  [S.CANCELLED]: 'Cancelled',
});

export const LOCKED_STATUSES = Object.freeze([
  S.PAYMENT_SUBMITTED, S.PAYMENT_VERIFIED, S.PAYMENT_REJECTED, S.CONFIRMED,
  S.PROCESSING, S.PACKED, S.DISPATCHED, S.COMPLETED, S.CANCELLED,
]);

export const FULFILLMENT_FLOW = Object.freeze([
  S.PAYMENT_VERIFIED, S.CONFIRMED, S.PROCESSING, S.PACKED, S.DISPATCHED, S.COMPLETED,
]);

const TERMINAL_FOR_REOPEN = [S.DISPATCHED, S.COMPLETED, S.CANCELLED];

export function canReopen(order) {
  if (!order) return { ok: false, reason: 'Order not found.' };
  if (!order.locked) return { ok: false, reason: 'Order is not locked.' };
  if (TERMINAL_FOR_REOPEN.includes(order.order_status)) {
    return { ok: false, reason: `A ${STATE_LABELS[order.order_status]} order cannot be reopened.` };
  }
  return { ok: true };
}

export function canCancel(order) {
  if (!order) return { ok: false, reason: 'Order not found.' };
  if ([S.DISPATCHED, S.COMPLETED, S.CANCELLED].includes(order.order_status)) {
    return { ok: false, reason: `A ${STATE_LABELS[order.order_status]} order cannot be cancelled.` };
  }
  return { ok: true };
}

/**
 * Admin-driven status change via PUT /api/admin/orders/:id/status.
 * Payment verification/rejection, cancellation and reopen have their own
 * dedicated, audited endpoints and are not accepted here.
 */
export function canAdminTransition(order, to, { balanceDue = null } = {}) {
  const from = order.order_status;
  if (from === to) return { ok: false, reason: 'Order is already in this status.' };
  if (to === S.CANCELLED) return { ok: false, reason: 'Use the Cancel Order action.' };
  if ([S.PAYMENT_SUBMITTED, S.PAYMENT_REJECTED, S.PAYMENT_PENDING, S.DRAFT].includes(to)) {
    return { ok: false, reason: 'Payment states are changed through payment verification or reopen.' };
  }
  if (!FULFILLMENT_FLOW.includes(to)) return { ok: false, reason: 'Unknown target status.' };

  // Order placed while online payment was off: the team confirms it directly
  // (payment is collected outside the website), no payment verification step.
  if (order.payment_mode_snapshot === PAYMENT_MODE.OFFLINE) {
    if (to === S.PAYMENT_VERIFIED) return { ok: false, reason: 'This order has no online payment - confirm the order instead.' };
    const flow = [S.PAYMENT_PENDING, ...FULFILLMENT_FLOW.slice(1)];
    const fromIdx = flow.indexOf(from);
    if (fromIdx < 0) return { ok: false, reason: `Cannot move a ${STATE_LABELS[from] || from} order to ${STATE_LABELS[to]}.` };
    if (flow.indexOf(to) <= fromIdx) return { ok: false, reason: 'Orders can only move forward in the fulfilment flow.' };
    return { ok: true };
  }

  // Balance already covered by previously verified payments (e.g. a reopened
  // order that was reduced) - admin may mark it verified directly.
  if (from === S.PAYMENT_PENDING && to === S.PAYMENT_VERIFIED) {
    return balanceDue !== null && balanceDue <= 0
      ? { ok: true }
      : { ok: false, reason: 'Verify the customer payment from the Payments section first.' };
  }
  if (to === S.PAYMENT_VERIFIED) {
    return { ok: false, reason: 'Verify the customer payment from the Payments section.' };
  }
  if (order.payment_status !== PAYMENT_STATUS.VERIFIED) {
    return { ok: false, reason: 'Payment must be verified before the order can move to fulfilment.' };
  }
  const fromIdx = FULFILLMENT_FLOW.indexOf(from);
  const toIdx = FULFILLMENT_FLOW.indexOf(to);
  if (fromIdx < 0) return { ok: false, reason: `Cannot move a ${STATE_LABELS[from] || from} order to ${STATE_LABELS[to]}.` };
  if (toIdx <= fromIdx) return { ok: false, reason: 'Orders can only move forward in the fulfilment flow.' };
  return { ok: true };
}

export function allowedAdminTargets(order, opts) {
  return FULFILLMENT_FLOW.filter((to) => canAdminTransition(order, to, opts).ok);
}
