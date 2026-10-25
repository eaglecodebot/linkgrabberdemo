import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

test('local HTTP API guards writes, keeps tokens private, supports account replacement and persists data', { timeout: 30000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'lg-http-'));
  const port = 19000 + Math.floor(Math.random() * 1000), origin = 'http://127.0.0.1:' + port;
  let child;
  async function start() {
    child = spawn(process.execPath, ['src/server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), LINK_GRABBER_DATA: directory }, stdio: ['ignore','pipe','pipe'] });
    for (let i = 0; i < 100; i++) { try { const r = await fetch(origin + '/api/state'); if (r.ok) return r.json(); } catch {} await new Promise(r => setTimeout(r, 50)); }
    throw new Error('Server failed to start');
  }
  const post = (path, data, key, extra = {}) => fetch(origin + '/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-App-Key': key, ...extra }, body: JSON.stringify(data) });
  try {
    let state = await start(), key = state.appKey;
    assert.equal((await post('accounts', { name: 'A', token: 'secret' }, '')).status, 403);
    assert.equal((await post('accounts', { name: 'A', token: 'secret' }, key, { Origin: 'https://evil.test' })).status, 403);
    const a = await (await post('accounts', { name: 'A', token: 'secret-A' }, key)).json();
    const b = await (await post('accounts', { name: 'B', token: 'secret-B' }, key)).json();
    assert.notEqual(a.id, b.id);
    assert.equal((await post('accounts', { id: a.id, name: 'Renamed A', token: '' }, key)).status, 200);
    await post('rules', { name: 'Only downloads', pagePattern: 'https://site.test/files*', urlContains: '/wanted/' }, key);
    state = await (await fetch(origin + '/api/state')).json();
    assert.equal(state.accounts.length, 2); assert.equal(JSON.stringify(state).includes('secret-A'), false);
    assert.equal(state.rules[0].urlContains, '/wanted/');
    assert.equal((await post('launch', { accountId: a.id, profileId: '../../bad' }, key)).status, 400);
    const exported = await (await fetch(origin + '/api/export?format=json')).json(); assert.equal(exported.rules.length, 1); assert.equal('accounts' in exported, false);
    let exited = once(child, 'exit'); await post('shutdown', {}, key); await exited;
    state = await start(); assert.equal(state.accounts.length, 2); assert.equal(state.rules.length, 1);
    exited = once(child, 'exit'); await post('shutdown', {}, state.appKey); await exited;
  } finally { if (child?.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; } rmSync(directory, { recursive: true, force: true }); }
});
