import { createApp } from './app.js';
import { config } from './config/env.js';
import {
  configureStorage, initialize, startBackgroundJobs, configWarnings,
} from './services/bootstrap.js';
import { logger } from './utils/logger.js';

// ---------------------------------------------------------------------
// PRODUCTION STARTUP CONTRACT
//   - reads existing Google Sheets data; never clears / reseeds / overwrites
//   - creates ONLY missing sheets/columns/settings (additive migration)
//   - never runs demo seeds (demo data exists only in scripts/seedDemo.js,
//     which refuses to run when NODE_ENV=production)
// ---------------------------------------------------------------------

const { errors, warnings } = configWarnings();
for (const w of warnings) logger.warn(w);
if (errors.length) {
  for (const e of errors) logger.error(`Configuration error: ${e}`);
  logger.error('Fix the environment variables above (see .env.example and README "Environment variables").');
  process.exit(1);
}

configureStorage();
const app = createApp();

const server = app.listen(config.port, () => {
  logger.info(`Nutex Wholesale v${config.appVersion} listening on port ${config.port} (${config.nodeEnv}, storage=${config.dataBackend})`);
});

initialize();
startBackgroundJobs();

function shutdown(signal) {
  logger.info(`${signal} received - finishing in-flight requests`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 15000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error('Unhandled promise rejection', err));
