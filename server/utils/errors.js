// Application errors carry an HTTP status, a stable machine-readable code and a
// customer-friendly message. Raw technical details never reach customers.
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}

export const badRequest = (message, details) => new AppError(400, 'VALIDATION_ERROR', message, details);
export const unauthorized = (message = 'Please sign in to continue.') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have access to this resource.') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'The requested record was not found.') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (code, message, details) => new AppError(409, code, message, details);
export const unprocessable = (code, message, details) => new AppError(422, code, message, details);
export const serviceUnavailable = (message, code = 'SERVICE_UNAVAILABLE') => new AppError(503, code, message);

// Customer-facing messages required by the business specification.
export const MESSAGES = Object.freeze({
  PRODUCT_UNAVAILABLE: 'Product is currently unavailable.',
  COMBINATION_OUT_OF_STOCK: 'This color-size combination is out of stock.',
  BOX_OUT_OF_STOCK: 'This box is out of stock.',
  MIN_ORDER_NOT_MET: 'This order does not meet the minimum wholesale order value.',
  ORDER_LOCKED: 'This order has already been locked.',
  ORDER_LOCKED_AFTER_PAYMENT: 'Your order has been locked because payment confirmation has been submitted.',
  PAYMENT_ALREADY_SUBMITTED: 'Payment confirmation has already been submitted.',
  STOCK_CHANGED: 'Stock has changed. Please review your cart.',
  PRICE_CHANGED: 'Prices have changed. Please review your cart.',
  PAYMENT_SUBMIT_FAILED: 'Your payment details could not be submitted. Please try again.',
});
