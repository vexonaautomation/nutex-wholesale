import { Router } from 'express';
import * as c from '../controllers/orderController.js';
import { validate } from '../middleware/validation.js';
import { orderToken, customerToken } from '../middleware/auth.js';
import {
  orderCreateLimiter, orderAccessLimiter, quoteLimiter, activeOrdersLimiter,
} from '../middleware/rateLimit.js';
import {
  quoteSchema, draftOrderSchema, trackOrderSchema, activeOrdersSchema, updateOrderSchema, recalculateSchema,
  orderStatusSchema, reopenSchema, cancelSchema, packingDeductionSchema, adminOrderItemsSchema,
  packerSchema, assignPackerSchema,
} from '../utils/validation.js';
import { requireRole } from '../middleware/adminAuth.js';

export const publicRouter = Router();
publicRouter.post('/cart/quote', quoteLimiter, customerToken, validate(quoteSchema), c.quoteCart);
publicRouter.post('/orders/draft', orderCreateLimiter, customerToken, validate(draftOrderSchema), c.createDraft);
publicRouter.post('/orders/track', orderAccessLimiter, validate(trackOrderSchema), c.track);
publicRouter.post('/orders/active', activeOrdersLimiter, validate(activeOrdersSchema), c.activeOrders);
publicRouter.get('/orders/:orderNumber', orderAccessLimiter, orderToken, c.getOrder);
publicRouter.get('/orders/:orderNumber/bill', orderAccessLimiter, orderToken, c.bill);
publicRouter.put('/orders/:orderNumber', orderToken, validate(updateOrderSchema), c.updateOrder);
publicRouter.post('/orders/:orderNumber/recalculate', quoteLimiter, orderToken, validate(recalculateSchema), c.recalculate);
publicRouter.post('/orders/:orderNumber/lock', orderToken, c.lock);
// packing slip for the packer (signed link from WhatsApp, no login, no amounts)
publicRouter.get('/packing-slip/:token', orderAccessLimiter, c.packingSlipPublic);
// bill PDF link in the admins' new-order WhatsApp (signed, no login)
publicRouter.get('/admin-bill/:token', orderAccessLimiter, c.adminBillPublic);

export const adminRouter = Router();
adminRouter.get('/orders', c.adminList);
adminRouter.get('/orders/:id', c.adminGet);
adminRouter.get('/orders/:id/bill', c.adminBillPdf);
adminRouter.get('/orders/:id/packing-slip', c.adminPackingSlip);
adminRouter.post('/orders/:id/packer', validate(assignPackerSchema), c.adminAssignPacker);
// packing team: everyone in the panel sees the list, the owner manages it
adminRouter.get('/packers', c.adminPackers);
adminRouter.post('/packers', requireRole('OWNER', 'ADMIN'), validate(packerSchema), c.adminPackerCreate);
adminRouter.put('/packers/:id', requireRole('OWNER', 'ADMIN'), validate(packerSchema), c.adminPackerUpdate);
adminRouter.put('/orders/:id/status', validate(orderStatusSchema), c.adminStatus);
adminRouter.post('/orders/:id/reopen', validate(reopenSchema), c.adminReopen);
adminRouter.post('/orders/:id/cancel', validate(cancelSchema), c.adminCancel);
adminRouter.post('/orders/:id/packing-deduction', validate(packingDeductionSchema), c.adminPackingDeduction);
adminRouter.get('/orders/:id/product-options', c.adminProductOptions);
adminRouter.post('/orders/:id/items/preview', validate(recalculateSchema), c.adminPreviewItems);
adminRouter.put('/orders/:id/items', validate(adminOrderItemsSchema), c.adminUpdateItems);
