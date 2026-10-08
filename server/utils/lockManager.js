import { conflict, MESSAGES } from './errors.js';
import { ORDER_STATUS, PAYMENT_STATUS, PAYMENT_MODE } from '../config/constants.js';

/** Placed while online payment was off: no QR step, the team confirms it. */
export const isOfflineOrder = (order) => order?.payment_mode_snapshot === PAYMENT_MODE.OFFLINE;

// ---------------------------------------------------------------------
// 1) Write mutex
// Serialises read-validate-write sequences for inventory, orders and
// payments inside this process. Combined with fresh reads and atomic
// Google batches, two customers can never both buy the last unit.
// (Run a single Render instance - see README "Concurrency".)
// ---------------------------------------------------------------------
const queues = new Map();

export async function withLock(name, fn) {
  const previous = queues.get(name) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  queues.set(name, tail);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (queues.get(name) === tail) queues.delete(name);
  }
}

export const COMMERCE_LOCK = 'commerce';

// ---------------------------------------------------------------------
// 2) Order lock rules - enforced by the API, not just hidden buttons.
// ---------------------------------------------------------------------
export const EDITABLE_STATUSES = Object.freeze([ORDER_STATUS.DRAFT, ORDER_STATUS.PAYMENT_PENDING]);

export function isOrderEditable(order) {
  return Boolean(order) && order.locked !== true && EDITABLE_STATUSES.includes(order.order_status);
}

export function assertOrderEditable(order) {
  if (order.order_status === ORDER_STATUS.CANCELLED) {
    throw conflict('ORDER_CANCELLED', 'This order has been cancelled and can no longer be changed.');
  }
  if (order.locked === true) {
    const afterPayment = [PAYMENT_STATUS.SUBMITTED, PAYMENT_STATUS.VERIFIED, PAYMENT_STATUS.REJECTED].includes(order.payment_status);
    throw conflict('ORDER_LOCKED', afterPayment ? MESSAGES.ORDER_LOCKED_AFTER_PAYMENT : MESSAGES.ORDER_LOCKED);
  }
  if (!EDITABLE_STATUSES.includes(order.order_status)) {
    throw conflict('ORDER_LOCKED', MESSAGES.ORDER_LOCKED);
  }
}

export function canSubmitPayment(order) {
  if (!order || order.order_status === ORDER_STATUS.CANCELLED) return false;
  if (isOfflineOrder(order)) return false; // no online payment for these orders
  if (isOrderEditable(order)) return true;
  // A rejected payment may be re-submitted; the order stays locked.
  return order.order_status === ORDER_STATUS.PAYMENT_REJECTED && order.payment_status === PAYMENT_STATUS.REJECTED;
}
