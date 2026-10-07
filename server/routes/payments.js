import { Router } from 'express';
import * as c from '../controllers/paymentController.js';
import { validate } from '../middleware/validation.js';
import { orderToken } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { paymentLimiter } from '../middleware/rateLimit.js';
import { verifyPaymentSchema, rejectPaymentSchema } from '../utils/validation.js';

export const publicRouter = Router();
publicRouter.post('/orders/:orderNumber/payment', paymentLimiter, orderToken, upload.single('screenshot'), c.submit);

export const adminRouter = Router();
adminRouter.get('/payments', c.adminList);
adminRouter.get('/payments/:id/proof', c.adminProof);
adminRouter.put('/payments/:id/verify', validate(verifyPaymentSchema), c.adminVerify);
adminRouter.put('/payments/:id/reject', validate(rejectPaymentSchema), c.adminReject);
