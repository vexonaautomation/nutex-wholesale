import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';
import { freshStore } from './helpers/fixtures.js';
import { runtime } from '../services/bootstrap.js';
import { keepAliveEnabled, startKeepAlive } from '../services/keepAliveService.js';

const quietLog = () => {
  const lines = [];
  return { lines, info: (m) => lines.push(['info', m]), warn: (m) => lines.push(['warn', m]) };
};

// Counts every call made on a storage transport (Google Sheets / Drive stand-ins).
function spyOn(transport) {
  const calls = [];
  const proto = Object.getPrototypeOf(transport);
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === 'constructor' || typeof transport[name] !== 'function') continue;
    const original = transport[name].bind(transport);
    transport[name] = (...args) => { calls.push(name); return original(...args); };
  }
  return calls;
}

test('keep-alive is on in production with a public URL, off in development / tests / when disabled', () => {
  const url = 'https://nutex.onrender.com';
  assert.equal(keepAliveEnabled({ isProd: true, keepAlive: { mode: 'auto', url } }), true);
  assert.equal(keepAliveEnabled({ isProd: false, keepAlive: { mode: 'auto', url } }), false);
  assert.equal(keepAliveEnabled({ isProd: true, keepAlive: { mode: 'auto', url: '' } }), false);
  assert.equal(keepAliveEnabled({ isProd: true, keepAlive: { mode: 'off', url } }), false);
  assert.equal(keepAliveEnabled({ isProd: false, keepAlive: { mode: 'on', url } }), true);
});

test('keep-alive pings <site>/api/ping, logs a failure once and recovers', async () => {
  const seen = [];
  let fail = false;
  const fetchImpl = async (u, init) => { seen.push([u, init.headers['User-Agent']]); if (fail) throw new Error('offline'); return { ok: true, status: 200 }; };
  const log = quietLog();
  const ka = startKeepAlive({ url: 'https://nutex.onrender.com/', intervalMs: 600000, firstDelayMs: 600000, fetchImpl, log });
  try {
    assert.equal(ka.target, 'https://nutex.onrender.com/api/ping');
    assert.equal(await ka.ping(), true);
    fail = true;
    assert.equal(await ka.ping(), false);
    assert.equal(await ka.ping(), false);
    fail = false;
    assert.equal(await ka.ping(), true);
    assert.deepEqual(seen[0], ['https://nutex.onrender.com/api/ping', 'nutex-keep-alive']);
    assert.equal(log.lines.filter(([lvl]) => lvl === 'warn').length, 1, 'failure logged once, not every ping');
    assert.ok(log.lines.some(([, m]) => /working again/.test(m)));
  } finally {
    ka.stop();
  }
  assert.equal(await ka.ping(), false, 'stopped');
});

test('/api/ping never touches Google Sheets or Drive (no data read or written)', async (t) => {
  const { sheetsTransport, driveTransport } = await freshStore();
  const app = createApp();
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const sheetCalls = spyOn(sheetsTransport);
  const driveCalls = spyOn(driveTransport);
  const before = JSON.stringify([...sheetsTransport.sheets.entries()]);

  for (let i = 0; i < 5; i += 1) {
    const res = await fetch(`${base}/api/ping`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  }
  // also answers while the store is still starting
  runtime.ready = false;
  try {
    assert.equal((await fetch(`${base}/api/ping`)).status, 200);
  } finally {
    runtime.ready = true;
  }

  assert.deepEqual(sheetCalls, [], 'no Google Sheets call');
  assert.deepEqual(driveCalls, [], 'no Google Drive call');
  assert.equal(JSON.stringify([...sheetsTransport.sheets.entries()]), before, 'data unchanged');
});
