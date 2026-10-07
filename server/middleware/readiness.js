import { runtime } from '../services/bootstrap.js';

// While the database schema check is still running (or Google is
// unreachable at boot) API calls get a clear 503 instead of half-working.
export function requireReady(_req, res, next) {
  if (runtime.ready) return next();
  return res.status(503).json({
    error: { code: 'SERVICE_STARTING', message: 'The store is starting up. Please try again in a few seconds.' },
  });
}
