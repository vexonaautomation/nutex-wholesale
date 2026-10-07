import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..', '..');

// Real environment variables (Render dashboard) always win over .env files.
for (const file of [path.join(ROOT_DIR, '.env'), path.join(ROOT_DIR, 'server', '.env')]) {
  if (fs.existsSync(file)) dotenv.config({ path: file, quiet: true });
}

const env = process.env;
const nodeEnv = env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';
const isTest = nodeEnv === 'test';

function readAppVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
    const commit = (env.RENDER_GIT_COMMIT || '').slice(0, 7);
    return commit ? `${pkg.version}+${commit}` : pkg.version;
  } catch {
    return '0.0.0';
  }
}

export function parsePrivateKey(raw) {
  if (!raw) return '';
  let key = String(raw).trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  return key.replace(/\\n/g, '\n');
}

// "8h", "30m", "1d", "45s" or a bare number of minutes
export function parseDuration(raw, fallbackMs = 8 * 3600 * 1000) {
  if (!raw) return fallbackMs;
  const m = String(raw).trim().match(/^(\d+)\s*([smhd]?)$/i);
  if (!m) return fallbackMs;
  const unit = (m[2] || 'm').toLowerCase();
  const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit];
  return Number(m[1]) * mult;
}

const devSecret = () => crypto.randomBytes(32).toString('hex');

const driveOauthConfigured = Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_REFRESH_TOKEN);

export const config = Object.freeze({
  nodeEnv,
  isProd,
  isTest,
  port: Number(env.PORT) || 4000,
  appVersion: readAppVersion(),
  frontendUrl: (env.FRONTEND_URL || '').trim().replace(/\/+$/, ''),
  // Keep-alive self ping so the host never puts the site to sleep (see services/keepAliveService.js)
  keepAlive: {
    mode: (env.KEEP_ALIVE || 'auto').trim().toLowerCase(),
    url: (env.KEEP_ALIVE_URL || env.RENDER_EXTERNAL_URL || env.FRONTEND_URL || '').trim().replace(/\/+$/, ''),
    intervalMs: Math.min(14, Math.max(1, Number(env.KEEP_ALIVE_INTERVAL_MINUTES) || 10)) * 60 * 1000,
  },
  dataBackend: (env.DATA_BACKEND || 'google').trim().toLowerCase(),
  trustProxy: env.TRUST_PROXY === undefined ? 1 : Number(env.TRUST_PROXY) || 0,
  cacheTtlMs: Math.max(5, Number(env.CATALOG_CACHE_TTL_SECONDS) || 60) * 1000,
  google: {
    sheetId: (env.GOOGLE_SHEET_ID || '').trim(),
    serviceAccountEmail: (env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim(),
    privateKey: parsePrivateKey(env.GOOGLE_PRIVATE_KEY),
    driveFolderId: (env.GOOGLE_DRIVE_FOLDER_ID || '').trim(),
    driveAuth: (env.GOOGLE_DRIVE_AUTH || (driveOauthConfigured ? 'oauth' : 'service_account')).trim().toLowerCase(),
    oauthClientId: (env.GOOGLE_OAUTH_CLIENT_ID || '').trim(),
    oauthClientSecret: (env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim(),
    oauthRefreshToken: (env.GOOGLE_OAUTH_REFRESH_TOKEN || '').trim(),
  },
  jwtSecret: env.JWT_SECRET || (isProd ? '' : devSecret()),
  sessionSecret: env.SESSION_SECRET || (isProd ? '' : devSecret()),
  adminSessionMs: parseDuration(env.ADMIN_SESSION_TIMEOUT),
  adminBootstrap: {
    email: (env.ADMIN_BOOTSTRAP_EMAIL || '').trim().toLowerCase(),
    password: env.ADMIN_BOOTSTRAP_PASSWORD || '',
    name: (env.ADMIN_BOOTSTRAP_NAME || 'Administrator').trim(),
  },
  // WhatsApp OTP for existing-customer verification.
  // provider "cloudwhatsapp": POST apikey/mobile/msg to WHATSAPP_API_URL
  // provider "console": development only - OTP is printed in the server log
  whatsapp: {
    provider: (env.WHATSAPP_PROVIDER || (env.WHATSAPP_API_URL ? 'cloudwhatsapp' : (isProd ? '' : 'console'))).trim().toLowerCase(),
    apiUrl: (env.WHATSAPP_API_URL || '').trim().replace(/^http:\/\//i, 'https://'),
    apiKey: (env.WHATSAPP_API_KEY || '').trim(),
    mobilePrefix: (env.WHATSAPP_MOBILE_PREFIX ?? '91').trim(),
  },
});

export function validateConfig(cfg = config) {
  const errors = [];
  const warnings = [];

  if (!['google', 'memory'].includes(cfg.dataBackend)) {
    errors.push('DATA_BACKEND must be "google" or "memory".');
  }
  if (cfg.isProd && cfg.dataBackend !== 'google') {
    errors.push('Production must use DATA_BACKEND=google. The in-memory backend is for local development and tests only and would lose data.');
  }
  if (cfg.dataBackend === 'google') {
    if (!cfg.google.sheetId) errors.push('GOOGLE_SHEET_ID is required.');
    if (!cfg.google.serviceAccountEmail) errors.push('GOOGLE_SERVICE_ACCOUNT_EMAIL is required.');
    if (!cfg.google.privateKey.includes('PRIVATE KEY')) errors.push('GOOGLE_PRIVATE_KEY is missing or malformed.');
    if (!cfg.google.driveFolderId) {
      warnings.push('GOOGLE_DRIVE_FOLDER_ID is not set - image, QR and payment-proof uploads are disabled.');
    }
    if (cfg.google.driveAuth === 'oauth' && !(cfg.google.oauthClientId && cfg.google.oauthClientSecret && cfg.google.oauthRefreshToken)) {
      errors.push('GOOGLE_DRIVE_AUTH=oauth requires GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and GOOGLE_OAUTH_REFRESH_TOKEN.');
    }
    if (!['oauth', 'service_account'].includes(cfg.google.driveAuth)) {
      errors.push('GOOGLE_DRIVE_AUTH must be "service_account" or "oauth".');
    }
  }
  if (cfg.isProd) {
    if (!cfg.jwtSecret || cfg.jwtSecret.length < 32) errors.push('JWT_SECRET must be set (min 32 characters).');
    if (!cfg.sessionSecret || cfg.sessionSecret.length < 32) errors.push('SESSION_SECRET must be set (min 32 characters).');
    if (!cfg.frontendUrl) warnings.push('FRONTEND_URL is not set - sitemap/OpenGraph links will use the request host.');
  } else if (!process.env.JWT_SECRET || !process.env.SESSION_SECRET) {
    warnings.push('JWT_SECRET/SESSION_SECRET not set - using random development secrets (sessions reset on restart).');
  }
  if (cfg.whatsapp?.provider === 'console' && cfg.isProd) {
    errors.push('WHATSAPP_PROVIDER=console is for development only.');
  }
  if (cfg.whatsapp?.provider === 'cloudwhatsapp' && !(cfg.whatsapp.apiUrl && cfg.whatsapp.apiKey)) {
    errors.push('WhatsApp OTP needs WHATSAPP_API_URL and WHATSAPP_API_KEY.');
  }
  if (cfg.isProd && !cfg.whatsapp?.provider) {
    warnings.push('WhatsApp OTP is not configured - existing customers can only be verified if OTP is switched off in Settings.');
  }
  if (cfg.adminBootstrap.password && cfg.adminBootstrap.password.length < 10) {
    errors.push('ADMIN_BOOTSTRAP_PASSWORD must be at least 10 characters.');
  }
  return { errors, warnings };
}
