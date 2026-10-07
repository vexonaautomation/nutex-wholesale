import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import api from './routes/index.js';
import { config } from './config/env.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requireReady } from './middleware/readiness.js';
import * as seo from './controllers/seoController.js';
import { CLIENT_DIST } from './services/seoService.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'blob:'],
        'font-src': ["'self'", 'data:'],
        'connect-src': ["'self'"],
        'frame-ancestors': ["'none'"],
        'form-action': ["'self'"],
        'upgrade-insecure-requests': config.isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }));
  app.use(compression());

  // Same-origin in the single-service deployment. FRONTEND_URL is allowed
  // explicitly for a future split frontend deployment.
  const allowed = new Set([config.frontendUrl, ...(config.isProd ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173'])].filter(Boolean));
  app.use('/api', cors({
    origin: (origin, cb) => cb(null, !origin || allowed.has(origin)),
    credentials: true,
  }));

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // SEO + media
  app.get('/robots.txt', seo.robots);
  app.get('/sitemap.xml', requireReady, seo.sitemap);
  app.get('/media/demo-payment-qr.png', seo.demoQr);
  app.get('/media/:fileId', requireReady, seo.media);

  // API
  app.use('/api', apiLimiter, api);

  // Built frontend (Vite output). Hashed assets are immutable.
  if (fs.existsSync(CLIENT_DIST)) {
    app.use('/assets', express.static(path.join(CLIENT_DIST, 'assets'), { immutable: true, maxAge: '1y', index: false }));
    app.use(express.static(CLIENT_DIST, { index: false, maxAge: '1h' }));
  }

  // SPA routing: every other GET returns index.html (with page-specific meta tags)
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    return seo.spa(req, res, next);
  });

  app.use((req, res) => {
    if (!fs.existsSync(CLIENT_DIST)) {
      return res.status(404).type('text').send('Frontend not built. Run "npm run build" (production) or "npm run dev" (development).');
    }
    return res.status(404).type('text').send('Not found');
  });

  app.use(errorHandler);
  return app;
}
