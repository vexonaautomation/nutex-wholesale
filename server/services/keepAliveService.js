// =====================================================================
// KEEP-ALIVE - stops the hosting from putting the website to sleep.
//
// Some hosting plans (e.g. Render Free) stop an app after ~15 minutes
// without visitors. Every few minutes the server calls its OWN public URL
// (GET /api/ping), which counts as a visit, so the site never goes idle.
//
// DATA SAFETY: /api/ping only answers {"ok":true}. It never reads or writes
// Google Sheets or Google Drive, sends no WhatsApp message and changes
// nothing - it does not use any Google quota either.
//
// Settings (environment variables, all optional):
//   KEEP_ALIVE                  auto (default) | on | off
//                               auto = on in production when a public URL is known
//   KEEP_ALIVE_URL              public site URL (default: RENDER_EXTERNAL_URL,
//                               which Render sets automatically, else FRONTEND_URL)
//   KEEP_ALIVE_INTERVAL_MINUTES 1-14, default 10 (must stay below 15)
// =====================================================================
import { logger } from '../utils/logger.js';

export const PING_PATH = '/api/ping';

export function keepAliveEnabled(cfg) {
  const ka = cfg?.keepAlive || {};
  if (!ka.url || ka.mode === 'off') return false;
  return ka.mode === 'on' || (ka.mode === 'auto' && cfg.isProd === true);
}

/**
 * Starts pinging `${url}/api/ping` every `intervalMs`. Returns { ping, stop }.
 * Failures are logged once (not every ping) and retried on the next tick.
 */
export function startKeepAlive({
  url, intervalMs = 10 * 60 * 1000, fetchImpl = globalThis.fetch, log = logger, firstDelayMs = 60 * 1000, timeoutMs = 15000,
} = {}) {
  if (!url || typeof fetchImpl !== 'function') return null;
  const target = `${String(url).replace(/\/+$/, '')}${PING_PATH}`;
  let failing = false;
  let stopped = false;

  const ping = async () => {
    if (stopped) return false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(target, {
        method: 'GET',
        headers: { 'User-Agent': 'nutex-keep-alive', 'Cache-Control': 'no-cache' },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (failing) log.info('Keep-alive: ping is working again.');
      failing = false;
      return true;
    } catch (err) {
      if (!failing) log.warn(`Keep-alive: ping to ${target} failed (${err.name === 'AbortError' ? 'timeout' : err.message}) - will retry.`);
      failing = true;
      return false;
    } finally {
      clearTimeout(timer);
    }
  };

  const interval = setInterval(ping, intervalMs);
  interval.unref?.();
  const first = setTimeout(ping, firstDelayMs);
  first.unref?.();
  log.info(`Keep-alive: pinging ${target} every ${Math.round(intervalMs / 60000)} min so the site never sleeps (no data is read or written).`);

  return {
    target,
    ping,
    stop() {
      stopped = true;
      clearInterval(interval);
      clearTimeout(first);
    },
  };
}
