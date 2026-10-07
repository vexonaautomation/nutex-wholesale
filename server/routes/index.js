import { Router } from 'express';
import { publicRouter as products } from './products.js';
import { publicRouter as categories } from './categories.js';
import { publicRouter as colors } from './colors.js';
import { publicRouter as sizes } from './sizes.js';
import { publicRouter as orders } from './orders.js';
import { publicRouter as payments } from './payments.js';
import { publicRouter as settings } from './settings.js';
import { publicRouter as customers } from './customers.js';
import adminRoutes from './admin.js';
import { requireReady } from '../middleware/readiness.js';
import { runtime } from '../services/bootstrap.js';
import { config } from '../config/env.js';
import { notFoundApi } from '../middleware/errorHandler.js';

const api = Router();

// Liveness - always 200 so Render health checks pass while Google is reachable or not.
api.get('/health', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ status: 'ok', ready: runtime.ready, version: config.appVersion, time: new Date().toISOString() });
});

// Keep-alive target: tiny answer, never reads or writes any data
// (no Google Sheets / Drive access), works even while the store is starting.
api.get('/ping', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true });
});

api.use(requireReady);
api.use('/admin', adminRoutes);
api.use(settings);
api.use(categories);
api.use(colors);
api.use(sizes);
api.use(products);
api.use(orders);
api.use(payments);
api.use(customers);
api.use(notFoundApi);

export default api;
