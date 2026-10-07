#!/usr/bin/env node
// Static guard: fails if server code contains destructive Google Sheets/Drive
// operations or wires demo seeding into the production startup path.
//   npm run check:data-safety
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'server');

const RULES = [
  { re: /\.values\.(clear|batchClear)\s*\(/, rule: 'values.clear/batchClear deletes cell data' },
  { re: /\b(deleteSheet|deleteDimension|deleteRange|deleteRows)\b(?!.*Blocked)/, rule: 'delete* Sheets request' },
  { re: /\bfiles\.(delete|emptyTrash)\s*\(/, rule: 'Drive file deletion' },
  { re: /trashed\s*:\s*true/, rule: 'Drive trash operation' },
  { re: /\b(clearSheets|resetDatabase|deleteAllRows|overwriteProducts|replaceSheetData|initializeDemoData)\s*\(/, rule: 'forbidden reset/seed helper' },
  { re: /valueInputOption\s*:\s*['"]USER_ENTERED['"]/, rule: 'USER_ENTERED allows formula injection' },
];

// Files allowed to *mention* these words (guards, comments, test doubles).
const ALLOW = new Set(['services/storage/sheetsGuard.js', 'services/storage/memorySheetsTransport.js']);
const STARTUP_FILES = ['server.js', 'app.js'];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'tests') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

export function runDataSafetyScan() {
  const files = walk(SERVER);
  const violations = [];
  for (const file of files) {
    const rel = path.relative(SERVER, file).replace(/\\/g, '/');
    if (ALLOW.has(rel)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      for (const r of RULES) if (r.re.test(code)) violations.push({ file: `server/${rel}`, line: i + 1, rule: r.rule });
    });
    const codeOnly = lines.map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    if (STARTUP_FILES.includes(rel) && /(import|require)\b[^;]*(demoData|seedDemo)|seedDemoData\s*\(/.test(codeOnly)) {
      violations.push({ file: `server/${rel}`, line: 0, rule: 'demo seeding referenced from production startup file' });
    }
  }
  return { filesScanned: files.length, violations };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { filesScanned, violations } = runDataSafetyScan();
  if (violations.length) {
    for (const v of violations) console.error(`✗ ${v.file}:${v.line} - ${v.rule}`);
    process.exit(1);
  }
  console.log(`✓ Data-safety scan passed (${filesScanned} server files).`);
}
