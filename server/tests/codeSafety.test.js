import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runDataSafetyScan } from '../../scripts/dataSafetyCheck.js';
import { validateConfig } from '../config/env.js';

test('server code contains no destructive Sheets/Drive operations or startup seeding', () => {
  const { violations, filesScanned } = runDataSafetyScan();
  assert.ok(filesScanned > 50);
  assert.deepEqual(violations, []);
});

test('production refuses the in-memory backend and weak secrets', () => {
  const base = {
    isProd: true, dataBackend: 'memory', jwtSecret: 'short', sessionSecret: '', frontendUrl: '',
    google: { sheetId: '', serviceAccountEmail: '', privateKey: '', driveFolderId: '', driveAuth: 'service_account' },
    adminBootstrap: { password: '' },
  };
  const { errors } = validateConfig(base);
  assert.ok(errors.some((e) => /Production must use DATA_BACKEND=google/.test(e)));
  assert.ok(errors.some((e) => /JWT_SECRET/.test(e)));
  assert.ok(errors.some((e) => /SESSION_SECRET/.test(e)));
});
