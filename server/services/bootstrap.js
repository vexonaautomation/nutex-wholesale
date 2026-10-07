import { config, validateConfig } from '../config/env.js';
import { createSheetsAuth, createDriveAuth } from '../config/google.js';
import { sheetsService } from './sheetsService.js';
import { driveService } from './driveService.js';
import { GoogleSheetsTransport } from './storage/googleSheetsTransport.js';
import { MemorySheetsTransport } from './storage/memorySheetsTransport.js';
import { GoogleDriveTransport } from './storage/googleDriveTransport.js';
import { MemoryDriveTransport } from './storage/memoryDriveTransport.js';
import { runMigrations } from './migrationService.js';
import { bootstrapAdmin } from './authService.js';
import { expireUnpaidOrders } from './orderService.js';
import { logger } from '../utils/logger.js';
import { keepAliveEnabled, startKeepAlive } from './keepAliveService.js';

export const runtime = {
  ready: false,
  startedAt: new Date().toISOString(),
  lastError: null,
  migration: null,
  driveReady: false,
};

/** Wires storage transports. Production refuses anything but Google. */
export function configureStorage(cfg = config, overrides = {}) {
  if (overrides.sheetsTransport) {
    sheetsService.configure({ transport: overrides.sheetsTransport, ttlMs: cfg.cacheTtlMs });
    driveService.configure({ transport: overrides.driveTransport || null });
    return;
  }
  if (cfg.dataBackend === 'memory') {
    if (cfg.isProd) throw new Error('Refusing to start: in-memory storage is not allowed in production.');
    logger.warn('DATA_BACKEND=memory - data is NOT persisted. Use only for local experiments.');
    sheetsService.configure({ transport: new MemorySheetsTransport(), ttlMs: cfg.cacheTtlMs });
    driveService.configure({ transport: new MemoryDriveTransport() });
    return;
  }
  sheetsService.configure({
    transport: new GoogleSheetsTransport({ auth: createSheetsAuth(cfg), spreadsheetId: cfg.google.sheetId }),
    ttlMs: cfg.cacheTtlMs,
  });
  driveService.configure({
    transport: cfg.google.driveFolderId
      ? new GoogleDriveTransport({ auth: createDriveAuth(cfg), rootFolderId: cfg.google.driveFolderId })
      : null,
  });
}

/** Migrations + first-admin bootstrap. Retries until Google is reachable. */
export async function initialize({ retryMs = 30000 } = {}) {
  try {
    runtime.migration = await runMigrations();
    await bootstrapAdmin();
    if (config.dataBackend === 'memory' && !config.isProd && process.env.SEED_DEMO !== 'false') {
      await seedMemoryDemo();
    }
    runtime.ready = true;
    runtime.lastError = null;
    logger.info(`Database ready (${config.dataBackend === 'google' ? 'Google Sheets' : 'in-memory'} schema verified, additive migrations applied).`);
  } catch (err) {
    runtime.lastError = err.message;
    logger.error('Startup initialisation failed - will retry', err);
    if (retryMs) setTimeout(() => initialize({ retryMs }), retryMs).unref();
    return;
  }
  if (driveService.enabled) {
    try {
      await driveService.ensureFolders();
      runtime.driveReady = true;
      logger.info('Google Drive folders verified.');
    } catch (err) {
      logger.error('Google Drive is not reachable - uploads will fail until fixed', err);
    }
  }
}

// Local experiments with DATA_BACKEND=memory: create a dev admin + demo catalogue
// in the process memory. Never reachable in production (configureStorage refuses).
async function seedMemoryDemo() {
  const { seedDemoData } = await import('../dev/demoData.js');
  const { sheetsService } = await import('./sheetsService.js');
  const { createAdmin } = await import('./authService.js');
  let admins = await sheetsService.read('Admin_Users', { fresh: true });
  if (!admins.length) {
    const email = 'admin@nutex.local';
    const password = 'DemoAdmin12345';
    await createAdmin({ email, name: 'Demo Admin', role: 'OWNER', password });
    logger.warn(`[memory demo] Admin login: ${email} / ${password}  (in-memory only - data resets on restart)`);
    admins = await sheetsService.read('Admin_Users', { fresh: true });
  }
  const result = await seedDemoData({ admin: admins[0] });
  if (!result.skipped) logger.warn(`[memory demo] Seeded ${result.products} demo products.`);
}

export function startBackgroundJobs() {
  const run = async () => {
    if (!runtime.ready) return;
    try {
      await expireUnpaidOrders();
    } catch (err) {
      logger.error('Reservation expiry job failed', err);
    }
  };
  setTimeout(run, 60 * 1000).unref();
  setInterval(run, 10 * 60 * 1000).unref();

  // never let the hosting put the site to sleep (self ping, touches no data)
  if (keepAliveEnabled(config)) startKeepAlive({ url: config.keepAlive.url, intervalMs: config.keepAlive.intervalMs });
  else if (config.isProd) logger.warn('Keep-alive is off (no public URL known). Set KEEP_ALIVE_URL to your website address so it never sleeps.');
}

export function configWarnings() {
  return validateConfig(config);
}
