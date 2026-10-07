import { Router } from 'express';
import * as c from '../controllers/customerController.js';
import { validate } from '../middleware/validation.js';
import { customerToken } from '../middleware/auth.js';
import { otpSendLimiter, otpVerifyLimiter, orderAccessLimiter } from '../middleware/rateLimit.js';
import {
  verifyStartSchema, verifyConfirmSchema, existingCustomerSchema, existingCustomerBulkSchema,
} from '../utils/validation.js';

// Existing-customer verification (WhatsApp OTP)
export const publicRouter = Router();
publicRouter.post('/customer/verify/start', otpSendLimiter, validate(verifyStartSchema), c.verifyStart);
publicRouter.post('/customer/verify/confirm', otpVerifyLimiter, validate(verifyConfirmSchema), c.verifyConfirm);
publicRouter.get('/customer/status', orderAccessLimiter, customerToken, c.status);
// verified customers can link another WhatsApp number (OTP to the new number)
publicRouter.post('/customer/alternate/start', otpSendLimiter, customerToken, validate(verifyStartSchema), c.alternateStart);
publicRouter.post('/customer/alternate/confirm', otpVerifyLimiter, customerToken, validate(verifyConfirmSchema), c.alternateConfirm);

export const adminRouter = Router();
adminRouter.get('/customers', c.adminList);
adminRouter.get('/customers/:id', c.adminGet);
adminRouter.get('/existing-customers', c.existingList);
adminRouter.post('/existing-customers', validate(existingCustomerSchema), c.existingAdd);
adminRouter.post('/existing-customers/bulk', validate(existingCustomerBulkSchema), c.existingBulk);
adminRouter.put('/existing-customers/:key', validate(existingCustomerSchema), c.existingUpdate);
