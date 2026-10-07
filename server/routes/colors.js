import { Router } from 'express';
import * as c from '../controllers/colorController.js';
import { validate } from '../middleware/validation.js';
import { colorSchema, statusChangeSchema, reorderSchema } from '../utils/validation.js';

export const publicRouter = Router();
publicRouter.get('/colors', c.listPublic);

export const adminRouter = Router();
adminRouter.get('/colors', c.adminList);
adminRouter.post('/colors', validate(colorSchema), c.adminCreate);
adminRouter.put('/colors/reorder', validate(reorderSchema), c.adminReorder);
adminRouter.put('/colors/:id', validate(colorSchema), c.adminUpdate);
adminRouter.post('/colors/:id/status', validate(statusChangeSchema), c.adminStatus);
