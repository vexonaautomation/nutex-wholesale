import { Router } from 'express';
import * as c from '../controllers/sizeController.js';
import { validate } from '../middleware/validation.js';
import { sizeSchema, statusChangeSchema, reorderSchema } from '../utils/validation.js';

export const publicRouter = Router();
publicRouter.get('/sizes', c.listPublic);

export const adminRouter = Router();
adminRouter.get('/sizes', c.adminList);
adminRouter.post('/sizes', validate(sizeSchema), c.adminCreate);
adminRouter.put('/sizes/reorder', validate(reorderSchema), c.adminReorder);
adminRouter.put('/sizes/:id', validate(sizeSchema), c.adminUpdate);
adminRouter.post('/sizes/:id/status', validate(statusChangeSchema), c.adminStatus);
