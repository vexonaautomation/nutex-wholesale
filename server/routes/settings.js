import { Router } from 'express';
import * as c from '../controllers/settingsController.js';

export const publicRouter = Router();
publicRouter.get('/store', c.store);
publicRouter.get('/settings/public', c.publicGet);

export const adminRouter = Router();
adminRouter.get('/settings', c.adminGet);
adminRouter.put('/settings', c.adminUpdate);
