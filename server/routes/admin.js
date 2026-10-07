import { Router } from 'express';
import * as auth from '../controllers/authController.js';
import * as misc from '../controllers/adminMiscController.js';
import * as catalogImport from '../controllers/catalogImportController.js';
import { requireAdmin, requireRole } from '../middleware/adminAuth.js';
import { validate } from '../middleware/validation.js';
import { loginLimiter } from '../middleware/rateLimit.js';
import { upload } from '../middleware/upload.js';
import {
  loginSchema, changePasswordSchema, adminUserSchema, statusChangeSchema, catalogImportSchema,
} from '../utils/validation.js';
import { adminRouter as products } from './products.js';
import { adminRouter as categories } from './categories.js';
import { adminRouter as colors } from './colors.js';
import { adminRouter as sizes } from './sizes.js';
import { adminRouter as inventory } from './inventory.js';
import { adminRouter as discounts } from './discounts.js';
import { adminRouter as orders } from './orders.js';
import { adminRouter as payments } from './payments.js';
import { adminRouter as customers } from './customers.js';
import { adminRouter as settings } from './settings.js';

const router = Router();

// ---- unauthenticated ----
router.post('/login', loginLimiter, validate(loginSchema), auth.doLogin);
router.post('/logout', auth.doLogout);

// ---- everything below requires a valid admin session ----
router.use(requireAdmin);
router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

router.get('/me', auth.me);
router.post('/change-password', validate(changePasswordSchema), auth.doChangePassword);
router.get('/users', auth.usersList);
router.post('/users', requireRole('OWNER', 'ADMIN'), validate(adminUserSchema), auth.usersCreate);
router.post('/users/:id/status', requireRole('OWNER', 'ADMIN'), validate(statusChangeSchema), auth.usersStatus);

router.get('/dashboard', misc.dashboard);
router.get('/audit-log', misc.audit);
router.get('/system', misc.systemStatus);
router.get('/export', misc.exportList);
router.get('/export/:sheet', requireRole('OWNER', 'ADMIN'), misc.exportCsv);
router.post('/setup/initial-master-data', requireRole('OWNER', 'ADMIN'), misc.setupMasterData);
router.post('/uploads', upload.single('file'), misc.uploadImage);
router.get('/media/:fileId', misc.adminMedia);
router.get('/catalog-import', requireRole('OWNER', 'ADMIN'), catalogImport.preview);
router.post('/catalog-import', requireRole('OWNER', 'ADMIN'), validate(catalogImportSchema), catalogImport.start);
router.get('/catalog-import/status', catalogImport.status);
router.get('/catalog-import/images/:folder/:file', catalogImport.image);

router.use(products);
router.use(categories);
router.use(colors);
router.use(sizes);
router.use(inventory);
router.use(discounts);
router.use(orders);
router.use(payments);
router.use(customers);
router.use(settings);

export default router;
