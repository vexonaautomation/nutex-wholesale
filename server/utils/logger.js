const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const SECRET_KEYS = /pass(word)?|secret|private_?key|token|authorization|cookie|password_hash/i;

function minLevel() {
  const configured = (process.env.LOG_LEVEL || '').toLowerCase();
  if (LEVELS[configured]) return LEVELS[configured];
  return process.env.NODE_ENV === 'test' ? LEVELS.silent : LEVELS.info;
}

function sanitize(value, depth = 0) {
  if (value instanceof Error) {
    return {
      message: value.message,
      code: value.code,
      status: value.status ?? value.response?.status,
      stack: process.env.NODE_ENV === 'production' ? undefined : value.stack,
    };
  }
  if (!value || typeof value !== 'object' || depth > 3) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitize(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEYS.test(k) ? '[redacted]' : sanitize(v, depth + 1);
  }
  return out;
}

function write(level, message, meta) {
  if (LEVELS[level] < minLevel()) return;
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}`;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (meta === undefined) fn(line);
  else fn(line, JSON.stringify(sanitize(meta)));
}

export const logger = {
  debug: (msg, meta) => write('debug', msg, meta),
  info: (msg, meta) => write('info', msg, meta),
  warn: (msg, meta) => write('warn', msg, meta),
  error: (msg, meta) => write('error', msg, meta),
};
