// Customer order access: the token issued at checkout (or after verifying
// order number + mobile on the tracking page) is sent as X-Order-Token.
// Services verify it against the order (HMAC) - see utils/orderToken.js.
export function orderToken(req, _res, next) {
  req.orderToken = req.get('x-order-token') || '';
  next();
}

// Verified existing customer (WhatsApp OTP): X-Customer-Token.
// Verified by services/existingCustomerService.js on every use.
export function customerToken(req, _res, next) {
  req.customerToken = req.get('x-customer-token') || '';
  next();
}
