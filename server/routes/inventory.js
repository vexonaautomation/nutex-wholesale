import express, { Router } from 'express';
import * as c from '../controllers/inventoryController.js';
import { validate } from '../middleware/validation.js';
import { inventoryUpdateSchema } from '../utils/validation.js';

export const adminRouter = Router();
adminRouter.get('/inventory', c.adminList);
adminRouter.put('/inventory', validate(inventoryUpdateSchema), c.adminUpdate);
// bulk stock update with Excel: download the sheet, upload it back as CSV text
adminRouter.get('/inventory/stock-sheet', c.stockSheet);
adminRouter.post('/inventory/stock-sheet', express.text({ type: ['text/csv', 'text/plain'], limit: '8mb' }), c.stockSheetImport);
