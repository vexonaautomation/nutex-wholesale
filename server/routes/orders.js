import { Router } from 'express';
import * as c from '../controllers/orderController.js';
import { validate } from '../middleware/validation.js';
import { orderToken, customerToken } from '../middleware/auth.js';
import {
  orderCreateLimiter, orderAccessLimiter, quoteLimiter, activeOrdersLimiter,
} from '../middleware/rateLimit.js';
import {
  quoteSchema, draftOrderSchema, trackOrderSchema, activeOrdersSchema, updateOrderSchema, recalculateSchema,
  orderStatusSchema, reopenSchema, cancelSchema,
} from '../utils/validation.js';

export const publicRouter = Router();
publicRouter.post('/cart/quote', quoteLimiter, customerToken, validate(quoteSchema), c.quoteCart);
publicRouter.post('/orders/draft', orderCreateLimiter, customerToken, validate(draftOrderSchema), c.createDraft);
publicRouter.post('/orders/track', orderAccessLimiter, validate(trackOrderSchema), c.track);
publicRouter.post('/orders/active', activeOrdersLimiter, validate(activeOrdersSchema), c.activeOrders);
publicRouter.get('/orders/:orderNumber', orderAccessLimiter, orderToken, c.getOrder);
publicRouter.put('/orders/:orderNumber', orderToken, validate(updateOrderSchema), c.updateOrder);
publicRouter.post('/orders/:orderNumber/recalculate', quoteLimiter, orderToken, validate(recalculateSchema), c.recalculate);
publicRouter.post('/orders/:orderNumber/lock', orderToken, c.lock);

export const adminRouter = Router();
adminRouter.get('/orders', c.adminList);
adminRouter.get('/orders/:id', c.adminGet);
adminRouter.put('/orders/:id/status', validate(orderStatusSchema), c.adminStatus);
adminRouter.post('/orders/:id/reopen', validate(reopenSchema), c.adminReopen);
adminRouter.post('/orders/:id/cancel', validate(cancelSchema), c.adminCancel);
