import test from 'node:test';
import assert from 'node:assert/strict';
import { Repository } from '../cloud/repository.mjs';

// Small Mongo update contract double. Native Mongo/Atlas is not available here.
class Collection {
  constructor(rows = []) { this.rows = rows; }
  matches(row, filter) { return Object.entries(filter).every(([k,v]) => v&&typeof v==='object'&&Array.isArray(v.$in)?v.$in.includes(row[k]):row[k] === v); }
  async findOne(filter) { return this.rows.find(row => this.matches(row, filter)); }
  async countDocuments(filter) { return this.rows.filter(row=>this.matches(row,filter)).length; }
  async replaceOne(filter,replacement){const index=this.rows.findIndex(row=>this.matches(row,filter));if(index<0)return{matchedCount:0};this.rows[index]=structuredClone(replacement);return{matchedCount:1};}
  async updateOne(filter, update, { upsert = false } = {}) {
    let row = await this.findOne(filter);
    if (!row && upsert) {
      row = { ...filter, ...update.$setOnInsert };
      if (this.rows.some(r => r._id === row._id)) { const e = new Error('duplicate _id'); e.code = 11000; throw e; }
      this.rows.push(row);
    }
    if (row) Object.assign(row, update.$set || {});
  }
}
const item = (profile_id = 'first', exported = false) => ({ _id: 'old-client-id-' + profile_id, profile_id, url: 'https://youtube.com/premium?acc=TEST', service: 'YouTube', first_seen: '2026-10-25T00:00:00.000Z', exported });
test('production repository keeps one URL per user across concurrent profiles and preserves legacy row identity', async () => {
  const links = new Collection(), repo = new Repository({ collection: () => links });
  await Promise.all([repo.saveLinks('alice', [item('p1')]), repo.saveLinks('alice', [item('p2')])]);
  assert.equal(links.rows.length, 1); assert.equal(links.rows[0].ownerId, 'alice');
  const original = structuredClone(links.rows[0]);
  await repo.saveLinks('alice', [item('other', true)]);
  assert.equal(links.rows.length, 1); assert.equal(links.rows[0].exported, true);
  assert.equal(links.rows[0].profile_id, original.profile_id); assert.equal(links.rows[0]._id, original._id);
  await repo.saveLinks('bob', [item('p1')]); assert.equal(links.rows.length, 2);
  const legacy = { ...item(), ownerId: 'legacy-user', _id: 'legacy-history-id' }; links.rows.push(legacy);
  await repo.saveLinks('legacy-user', [item('new-profile', true)]);
  assert.equal(links.rows.filter(r => r.ownerId === 'legacy-user').length, 1);
  assert.equal(legacy._id, 'legacy-history-id'); assert.equal(legacy.profile_id, 'first'); assert.equal(legacy.exported, true);
});
test('permanent script slot is one per user and cannot be downgraded by an older request',async()=>{
 const scripts=new Collection(),repo=new Repository({collection:name=>name==='permanent_scripts'?scripts:new Collection()});
 const one={_id:'alice',authVersion:1,revision:'one',keyHash:'key-one',ciphertext:'first'},two={...one,revision:'two',keyHash:'key-two'};
 const results=await Promise.all([repo.ensurePermanentScript(one),repo.ensurePermanentScript(two)]);assert.equal(scripts.rows.length,1);assert.equal(results[0].revision,results[1].revision);
 const newer={...one,authVersion:2,revision:'new',keyHash:'new-key',ciphertext:'new encrypted script'};
 assert.equal((await repo.ensurePermanentScript(newer)).authVersion,2);
 assert.equal((await repo.ensurePermanentScript(one)).revision,'new');assert.equal(scripts.rows.length,1);
});
test('web writes preserve batch counts on retry, skip other batches and retain legacy captures', async()=>{
 const links=new Collection(),repo=new Repository({collection:()=>links});
 const rows=[item('a'),{...item('a'),url:'https://nordvpn.com/linkedin/?code=TEST'}];
 assert.equal(await repo.captureWebLinks('alice',rows,'batch-one'),2);
 assert.equal(await repo.captureWebLinks('alice',rows,'batch-one'),2);assert.equal(links.rows.length,2);
 assert.equal(await repo.captureWebLinks('alice',rows,'batch-two'),0);assert.equal(links.rows.length,2);
 assert.equal(await repo.captureWebLinks('bob',rows,'batch-three'),2);assert.equal(links.rows.length,4);
 const legacy={...item('old'),ownerId:'legacy',_id:'legacy-id'};links.rows.push(legacy);
 assert.equal(await repo.captureWebLinks('legacy',[item('new')],'batch-new'),0);assert.equal(legacy._id,'legacy-id');assert.equal(legacy.profile_id,'old');
});
test('repository retries only a verified canonical duplicate and does not hide unrelated database failures', async () => {
  const links = new Collection(), repo = new Repository({ collection: () => links });
  const update = links.updateOne.bind(links); let first = true;
  links.updateOne = async (...args) => {
    if (first) { first = false; await update(...args); const e = new Error('concurrent insert'); e.code = 11000; throw e; }
    return update(...args);
  };
  await repo.saveLinks('alice', [item('p1', true)]); assert.equal(links.rows.length, 1); assert.equal(links.rows[0].exported, true);
  links.updateOne = async () => { const e = new Error('other index failure'); e.code = 11000; throw e; };
  await assert.rejects(repo.saveLinks('other-user', [item()]), /other index failure/);
});
