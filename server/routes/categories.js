import { Router } from 'express';
import * as c from '../controllers/categoryController.js';
import { validate } from '../middleware/validation.js';
import { categorySchema, statusChangeSchema, reorderSchema } from '../utils/validation.js';

export const publicRouter = Router();
publicRouter.get('/categories', c.listPublic);

export const adminRouter = Router();
adminRouter.get('/categories', c.adminList);
adminRouter.post('/categories', validate(categorySchema), c.adminCreate);
adminRouter.put('/categories/reorder', validate(reorderSchema), c.adminReorder);
adminRouter.put('/categories/:id', validate(categorySchema), c.adminUpdate);
adminRouter.post('/categories/:id/status', validate(statusChangeSchema), c.adminStatus);
