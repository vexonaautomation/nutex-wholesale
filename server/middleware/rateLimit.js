import { rateLimit } from 'express-rate-limit';

const handler = (message) => (_req, res) => {
  res.status(429).json({ error: { code: 'RATE_LIMITED', message } });
};

const make = (windowMs, limit, message) => rateLimit({
  windowMs,
  limit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: handler(message),
  skip: () => process.env.NODE_ENV === 'test',
});

export const apiLimiter = make(60 * 1000, 300, 'Too many requests. Please slow down.');
export const loginLimiter = make(15 * 60 * 1000, 10, 'Too many login attempts. Please try again in 15 minutes.');
export const orderCreateLimiter = make(60 * 60 * 1000, 30, 'Too many orders from this network. Please try again later.');
export const orderAccessLimiter = make(15 * 60 * 1000, 40, 'Too many lookups. Please try again in a few minutes.');
export const paymentLimiter = make(15 * 60 * 1000, 15, 'Too many payment submissions. Please try again later.');
export const quoteLimiter = make(60 * 1000, 120, 'Too many cart updates. Please slow down.');
// WhatsApp OTP costs money per message - keep requests per network low.
export const otpSendLimiter = make(60 * 60 * 1000, 10, 'Too many verification requests. Please try again later.');
export const otpVerifyLimiter = make(15 * 60 * 1000, 30, 'Too many attempts. Please try again later.');
