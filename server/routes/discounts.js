import { Router } from 'express';
import * as c from '../controllers/discountController.js';
import { validate } from '../middleware/validation.js';
import { slabSchema, slabPreviewSchema } from '../utils/validation.js';

export const adminRouter = Router();
adminRouter.get('/discount-slabs', c.adminList);
adminRouter.post('/discount-slabs', validate(slabSchema), c.adminCreate);
adminRouter.post('/discount-slabs/preview', validate(slabPreviewSchema), c.adminPreview);
adminRouter.put('/discount-slabs/:id', validate(slabSchema), c.adminUpdate);
adminRouter.post('/discount-slabs/:id/deactivate', c.adminDeactivate);
adminRouter.post('/discount-slabs/:id/reactivate', c.adminReactivate);
adminRouter.delete('/discount-slabs/:id', c.adminDelete);
