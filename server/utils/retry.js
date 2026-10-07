import { logger } from './logger.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const NETWORK_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED', 'EPIPE', 'ESOCKETTIMEDOUT']);

export function errorStatus(err) {
  const candidates = [err?.response?.status, err?.status, err?.code];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isInteger(n) && n >= 100 && n < 600) return n;
  }
  return null;
}

/**
 * Retries Google API calls with exponential backoff.
 * Reads retry on quota (429), server errors and network failures.
 * Writes (`write: true`) retry ONLY when Google explicitly rejected the request
 * (429 quota / 503 unavailable) - an ambiguous network failure is never
 * retried for writes, so an append can never be applied twice.
 */
export async function withRetry(fn, { label = 'google-api', retries = 5, write = false } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const status = errorStatus(err);
      const retriable = write
        ? status === 429 || status === 503
        : status === 429 || (status !== null && status >= 500) || NETWORK_CODES.has(err?.code);
      if (!retriable || attempt >= retries) throw err;
      const delay = Math.min(16000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 400);
      attempt += 1;
      logger.warn(`${label} failed (status ${status ?? err?.code}); retry ${attempt}/${retries} in ${delay}ms`);
      await sleep(delay);
    }
  }
}
