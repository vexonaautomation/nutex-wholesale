import { Router } from 'express';
import * as c from '../controllers/inventoryController.js';
import { validate } from '../middleware/validation.js';
import { inventoryUpdateSchema } from '../utils/validation.js';

export const adminRouter = Router();
adminRouter.get('/inventory', c.adminList);
adminRouter.put('/inventory', validate(inventoryUpdateSchema), c.adminUpdate);
