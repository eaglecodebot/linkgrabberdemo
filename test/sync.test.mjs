import test from 'node:test';
import assert from 'node:assert/strict';
import { Collector } from '../src/collector.mjs';
import { useStrictCommit } from '../src/gologin-adapter.mjs';

test('upload errors propagate, retain the profile session and allow a sync retry', async () => {
  const collector = new Collector(null, null, '', '');
  let cleared = false, fail = true;
  const sdk = { getProfileDataToUpdate: async () => Buffer.from('profile'), postFile: async () => { if (fail) throw new Error('Network unavailable'); },
    stop: async () => { if (sdk.is_stopping) return; sdk.is_stopping = true; await sdk.commitProfile(); cleared = true; } };
  useStrictCommit(sdk);
  const s = { id: 's', sdk, started: true, state: 'running' }; collector.sessions.set(s.id, s);
  await assert.rejects(collector.stop(s.id), /Network unavailable/);
  assert.equal(s.state, 'error'); assert.equal(cleared, false); assert.equal(sdk.is_stopping, false);
  fail = false; await collector.stop(s.id); assert.equal(s.state, 'closed'); assert.equal(cleared, true);
});
test('a failed launch never uploads an incomplete profile', async () => {
  const collector = new Collector(null, null, '', ''); let uploaded = false, killed = false;
  const s = { id: 's', state: 'error', started: false, sdk: { processSpawned: {}, killBrowser: () => killed = true, stop: async () => uploaded = true } };
  collector.sessions.set(s.id, s); await collector.stop(s.id); assert.equal(uploaded, false); assert.equal(killed, true); assert.equal(s.state, 'closed');
});
