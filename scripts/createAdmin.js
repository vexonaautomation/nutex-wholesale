#!/usr/bin/env node
// Adds an admin user to the Admin_Users sheet (append only - never modifies others).
//   npm run admin:create -- --email owner@nutex.in --name "Owner" --role OWNER
// The password is read from ADMIN_PASSWORD or prompted.
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { config } from '../server/config/env.js';
import { configureStorage } from '../server/services/bootstrap.js';
import { runMigrations } from '../server/services/migrationService.js';
import { createAdmin } from '../server/services/authService.js';
import { adminUserSchema, formatZodError } from '../server/utils/validation.js';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const rl = readline.createInterface({ input: stdin, output: stdout });
const email = arg('email') || (await rl.question('Admin email: '));
const name = arg('name') || (await rl.question('Full name: '));
const role = (arg('role') || 'OWNER').toUpperCase();
const password = process.env.ADMIN_PASSWORD || (await rl.question('Password (min 10 chars, letters + numbers): '));
rl.close();

const parsed = adminUserSchema.safeParse({ email, name, role, password });
if (!parsed.success) {
  formatZodError(parsed.error).forEach((e) => console.error(`✗ ${e.path}: ${e.message}`));
  process.exit(1);
}
if (config.dataBackend !== 'google') {
  console.error('✗ DATA_BACKEND must be google to create a persistent admin.');
  process.exit(1);
}
configureStorage(config);
try {
  await runMigrations();
  const admin = await createAdmin(parsed.data);
  console.log(`✓ Admin created: ${admin.email} (${admin.role}, ${admin.admin_id})`);
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exit(1);
}
