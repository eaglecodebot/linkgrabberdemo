import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudClient } from '../src/cloud-client.mjs';
test('an empty initial sync cycle cannot block captures arriving later', async () => {
  let rows = [], acknowledged = [], snapshots = [], snapshotAck = [];
  const store = { setting: () => null, pending: () => rows, acknowledge: r => { acknowledged.push(...r); rows = []; }, pendingExports: () => snapshots, acknowledgeExport: id => { snapshotAck.push(id); snapshots = []; } };
  const client = new CloudClient('https://example.test', 'token', store);
  let requests = 0;
  client.request = async (path, body) => { requests++; return path === 'sync' ? { accepted: body.rows.map(r => ({ uid:r.uid, revision:r.revision })) } : { ok: true }; };
  await client.sync(); assert.equal(client.busy,null);
  rows = [{ uid:'capture',revision:1,service:'YouTube' }]; snapshots = [{ id:'snapshot' }];
  await client.sync(); assert.equal(acknowledged.length,1);assert.equal(snapshotAck.length,1);assert.equal(requests,2);assert.equal(client.busy,null);
  rows = [{ uid:'capture-2',revision:1,service:'Notion' }];
  client.request = async () => { throw new Error('Offline'); };
  await client.sync();assert.equal(rows.length,1);assert.equal(client.error,'Offline');assert.equal(client.busy,null);
});
