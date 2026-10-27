import test from 'node:test';
import assert from 'node:assert/strict';
import { Repository } from '../cloud/repository.mjs';

// Small Mongo update contract double. Native Mongo/Atlas is not available here.
class Collection {
  constructor(rows = []) { this.rows = rows; }
  matches(row, filter) { return Object.entries(filter).every(([k,v]) => v&&typeof v==='object'&&Array.isArray(v.$in)?v.$in.includes(row[k]):v&&typeof v==='object'&&Object.hasOwn(v,'$ne')?!(Array.isArray(row[k])?row[k].includes(v.$ne):row[k]===v.$ne):row[k] === v); }
  async findOne(filter) { return this.rows.find(row => this.matches(row, filter)); }
  async countDocuments(filter) { return this.rows.filter(row=>this.matches(row,filter)).length; }
  async insertOne(row){if(this.rows.some(r=>r._id===row._id)){const e=new Error('duplicate');e.code=11000;throw e;}this.rows.push(structuredClone(row));}
  async deleteMany(filter){this.rows=this.rows.filter(row=>!this.matches(row,filter));}
  async replaceOne(filter,replacement){const index=this.rows.findIndex(row=>this.matches(row,filter));if(index<0)return{matchedCount:0};this.rows[index]=structuredClone(replacement);return{matchedCount:1};}
  async updateOne(filter, update, { upsert = false } = {}) {
    let row = await this.findOne(filter);
    if (!row && upsert) {
      row = { ...filter, ...update.$setOnInsert };
      if (this.rows.some(r => r._id === row._id)) { const e = new Error('duplicate _id'); e.code = 11000; throw e; }
      this.rows.push(row);
    }
    if(!row)return {matchedCount:0,modifiedCount:0};
    const before=JSON.stringify(row);
    Object.assign(row,update.$set||{});for(const [key,n] of Object.entries(update.$inc||{}))row[key]=(Number(row[key])||0)+n;
    for(const [key,value] of Object.entries(update.$addToSet||{})){row[key]||=[];if(!row[key].includes(value))row[key].push(value);}
    return {matchedCount:1,modifiedCount:JSON.stringify(row)===before?0:1};
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
test('engine upgrades cannot overwrite a revoked, replaced or newer-password script',async()=>{
 const scripts=new Collection(),repo=new Repository({collection:name=>name==='permanent_scripts'?scripts:new Collection()});
 const old={_id:'alice',authVersion:1,revision:'old',keyHash:'original',engineVersion:5,ciphertext:'v5'};
 scripts.rows.push({...old});const upgrade={...old,engineVersion:6,ciphertext:'v6'};
 assert.equal((await repo.upgradePermanentScript(old,upgrade)).ciphertext,'v6');
 scripts.rows.length=0;assert.equal(await repo.upgradePermanentScript(old,upgrade),undefined);assert.equal(scripts.rows.length,0);
 const replacement={...old,authVersion:2,revision:'replacement',ciphertext:'replacement'};scripts.rows.push(replacement);
 assert.equal((await repo.upgradePermanentScript(old,upgrade)).revision,'replacement');assert.equal(scripts.rows[0].ciphertext,'replacement');
});
test('global capture policy is shared and does not overwrite per-user legacy documents',async()=>{
 const settings=new Collection([{_id:'alice',value:{pagePattern:'https://private.test/*'}}]),repo=new Repository({collection:name=>name==='settings'?settings:new Collection()});
 const policy={pagePattern:'https://source.test/*',enabledServices:['YouTube']};await repo.saveGlobalCaptureSettings(policy);
 assert.deepEqual((await repo.globalCaptureSettings()).value,policy);assert.equal((await repo.settingsFor('alice')).value.pagePattern,'https://private.test/*');
 await repo.saveGlobalCaptureSettings({...policy,enabledServices:[]});assert.deepEqual((await repo.globalCaptureSettings()).value.enabledServices,[]);assert.equal(settings.rows.length,2);
});

test('explicit script installation converges on one key and stale writes cannot replace the current slot',async()=>{
 const scripts=new Collection(),repo=new Repository({collection:name=>name==='permanent_scripts'?scripts:new Collection()});
 const first={_id:'alice',authVersion:1,scriptVersion:0,revision:'first',keyHash:'key-one'},other={...first,revision:'other',keyHash:'key-other'};
 const results=await Promise.all([repo.installPermanentScript(null,first),repo.installPermanentScript(null,other)]);assert.equal(scripts.rows.length,1);assert.equal(results[0].revision,results[1].revision);
 const current=structuredClone(scripts.rows[0]),next={...first,scriptVersion:1,revision:'new',keyHash:'new'};
 await repo.installPermanentScript(current,next);assert.equal((await repo.installPermanentScript(current,other)).revision,'new');assert.equal(scripts.rows.length,1);
});
test('manual revocation stores its cause and advances capture version without revoking the login session',async()=>{
 const users=new Collection([{_id:'alice',authVersion:3}]),scripts=new Collection([{_id:'alice',authVersion:3,scriptVersion:0,revision:'first',keyHash:'old'}]),keys=new Collection([{_id:'legacy',ownerId:'alice'},{_id:'other',ownerId:'bob'}]);
 const repo=new Repository({collection:name=>name==='users'?users:name==='permanent_scripts'?scripts:name==='capture_keys'?keys:new Collection()}),reason={code:'admin-revoked',reason:'Administrator revoked your script.',at:'2026-10-25T12:00:00Z'};
 await repo.revokeCaptureKeys('alice',reason);
 assert.equal(users.rows[0].authVersion,3);assert.equal(users.rows[0].scriptVersion,1);assert.deepEqual(users.rows[0].scriptRevocation,reason);assert.equal((await repo.captureKey('old')).scriptVersion,0);assert.deepEqual(keys.rows.map(r=>r._id),['other']);
});


test('Mongo extension notices use a conditional add-to-set and never modify account credentials',async()=>{
 const state=new Collection(),users=new Collection([{_id:'alice',authVersion:7}]);
 const repo=new Repository({collection:name=>name==='extension_updates'?state:name==='users'?users:new Collection()});
 const results=await Promise.all([repo.claimExtensionNotice('alice','release-one'),repo.claimExtensionNotice('alice','release-one')]);assert.equal(results.filter(Boolean).length,1);
 assert.equal(await repo.claimExtensionNotice('alice','release-two'),true);assert.equal(await repo.claimExtensionNotice('alice','release-one'),false);
 await repo.markExtensionDownloaded('alice','release-one');await repo.markExtensionDownloaded('alice','release-one');
 assert.deepEqual((await repo.extensionState('alice')).downloadedReleases,['release-one']);assert.equal((await repo.userById('alice')).authVersion,7);
 assert.equal(await repo.extensionState('bob'),undefined);
});
