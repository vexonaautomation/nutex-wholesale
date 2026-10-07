#!/usr/bin/env node
// Checks the filled hosting env file BEFORE you paste it into Render.
//   npm run env:check                  -> checks deploy/render.env
//   npm run env:check -- other.env     -> checks another file
// It runs the same validation the server runs at start-up and lists
// anything still missing. Secret values are never printed.
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const file = path.resolve(process.argv[2] || 'deploy/render.env');
if (!fs.existsSync(file)) {
  console.error(`✗ ${file} not found. Copy deploy/render.env.example to deploy/render.env and fill it in.`);
  process.exit(1);
}
const vars = dotenv.parse(fs.readFileSync(file));

const KNOWN = [
  'NODE_ENV', 'NODE_VERSION', 'DATA_BACKEND', 'TRUST_PROXY', 'ADMIN_SESSION_TIMEOUT', 'CATALOG_CACHE_TTL_SECONDS',
  'KEEP_ALIVE', 'KEEP_ALIVE_URL', 'KEEP_ALIVE_INTERVAL_MINUTES', 'FRONTEND_URL', 'JWT_SECRET', 'SESSION_SECRET',
  'ADMIN_BOOTSTRAP_EMAIL', 'ADMIN_BOOTSTRAP_PASSWORD', 'ADMIN_BOOTSTRAP_NAME',
  'GOOGLE_SHEET_ID', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'GOOGLE_DRIVE_FOLDER_ID', 'GOOGLE_DRIVE_AUTH',
  'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REFRESH_TOKEN',
  'WHATSAPP_PROVIDER', 'WHATSAPP_API_URL', 'WHATSAPP_API_KEY', 'WHATSAPP_MOBILE_PREFIX', 'LOG_LEVEL', 'PORT',
];

// Only this file counts: blank out everything else so the local .env cannot fill gaps.
for (const k of KNOWN) process.env[k] = vars[k] ?? '';
process.env.NODE_ENV = vars.NODE_ENV || 'production';
const { config, validateConfig } = await import('../server/config/env.js');

const problems = [];
const notes = [];
const placeholders = Object.entries(vars).filter(([, v]) => /PASTE_/.test(v)).map(([k]) => k);
if (placeholders.length) problems.push(`Still to fill in: ${placeholders.join(', ')}`);
const unknown = Object.keys(vars).filter((k) => !KNOWN.includes(k));
if (unknown.length) notes.push(`Unknown names (typo?): ${unknown.join(', ')}`);

if (vars.NODE_ENV !== 'production') problems.push('NODE_ENV must be production');
if (vars.DATA_BACKEND !== 'google') problems.push('DATA_BACKEND must be google');
if (vars.FRONTEND_URL && !/^https:\/\/[^\s/]+/.test(vars.FRONTEND_URL)) problems.push('FRONTEND_URL must start with https://');
if (vars.ADMIN_BOOTSTRAP_EMAIL && !placeholders.includes('ADMIN_BOOTSTRAP_EMAIL') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(vars.ADMIN_BOOTSTRAP_EMAIL)) problems.push('ADMIN_BOOTSTRAP_EMAIL is not a valid email');
const pw = vars.ADMIN_BOOTSTRAP_PASSWORD || '';
if (pw && !placeholders.includes('ADMIN_BOOTSTRAP_PASSWORD') && !(pw.length >= 10 && /[A-Za-z]/.test(pw) && /\d/.test(pw))) problems.push('ADMIN_BOOTSTRAP_PASSWORD needs 10+ characters with letters and numbers');
const key = config.google.privateKey;
if (key && !placeholders.includes('GOOGLE_PRIVATE_KEY') && !(key.includes('-----BEGIN PRIVATE KEY-----') && key.includes('-----END PRIVATE KEY-----'))) {
  problems.push('GOOGLE_PRIVATE_KEY must contain the whole key incl. -----BEGIN PRIVATE KEY----- and -----END PRIVATE KEY-----');
}

const { errors, warnings } = validateConfig(config);
// placeholder values already reported above
const isPlaceholderError = (e) => placeholders.some((p) => e.includes(p)) || (placeholders.includes('GOOGLE_PRIVATE_KEY') && /PRIVATE_KEY/.test(e));
for (const e of errors) if (!isPlaceholderError(e)) problems.push(e);
for (const w of warnings) notes.push(w);

console.log(`Checking ${path.relative(process.cwd(), file)} (${Object.keys(vars).length} variables)\n`);
for (const k of KNOWN.filter((x) => x in vars)) {
  const v = vars[k];
  const state = /PASTE_/.test(v) ? '✗ to fill' : v ? '✓ set' : '- empty';
  console.log(`  ${state.padEnd(10)} ${k}`);
}
console.log('');
notes.forEach((n) => console.log(`! ${n}`));
if (problems.length) {
  problems.forEach((p) => console.log(`✗ ${p}`));
  console.log('\nFix the points above, then run the check again.');
  process.exit(1);
}
console.log('✓ Ready. Render -> service -> Environment -> "Add from .env" -> paste the whole file -> Save changes.');
