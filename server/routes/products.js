import { Router } from 'express';
import * as c from '../controllers/productController.js';
import { validate } from '../middleware/validation.js';
import { productSchema, outOfStockSchema, bulkSellingSchema } from '../utils/validation.js';

export const publicRouter = Router();
publicRouter.get('/products', c.listProducts);
publicRouter.get('/products/:id', c.getProduct);
publicRouter.get('/products/:id/variants', c.getProductVariants);

export const adminRouter = Router();
adminRouter.get('/products', c.adminList);
adminRouter.post('/products', validate(productSchema), c.adminCreate);
adminRouter.post('/products/bulk-selling', validate(bulkSellingSchema), c.adminBulkSelling);
adminRouter.get('/products/:id', c.adminGet);
adminRouter.put('/products/:id', validate(productSchema), c.adminUpdate);
adminRouter.post('/products/:id/deactivate', c.adminDeactivate);
adminRouter.post('/products/:id/reactivate', c.adminReactivate);
adminRouter.post('/products/:id/archive', c.adminArchive);
adminRouter.post('/products/:id/duplicate', c.adminDuplicate);
adminRouter.post('/products/:id/out-of-stock', validate(outOfStockSchema), c.adminOutOfStock);
