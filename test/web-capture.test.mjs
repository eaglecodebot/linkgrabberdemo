import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createApp,bootstrap } from '../cloud/app.mjs';
import { MemoryRepository } from './cloud-memory.mjs';
import { cleanSettings } from '../cloud/capture.mjs';
import { sealScript, openScript } from '../cloud/script-vault.mjs';
import { hashToken } from '../cloud/auth.mjs';
const SCRIPT_SECRET='a3'.repeat(32);
const urls=['https://youtube.com/premium?acc=EXAMPLE%2Bkeep','https://lovable.dev/lp/test?reward_code=EXAMPLE','https://www.notion.com/redeem/linkedin?code=EXAMPLE','https://nordvpn.com/linkedin/?code=EXAMPLE'];
async function fixture(){
 const repo=new MemoryRepository();await bootstrap(repo,'admin','admin-long-password');const server=createApp(repo,{publicOrigin:'https://panel.test',scriptSecret:SCRIPT_SECRET});server.listen(0,'127.0.0.1');await once(server,'listening');
 const origin='http://127.0.0.1:'+server.address().port;
 const req=async(path,token='',data,source='')=>{const response=await fetch(origin+'/api/'+path,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,...(data===undefined?{}:{'Content-Type':'application/json'}),...(source?{Origin:source}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});return{status:response.status,headers:response.headers,...await response.json()};};
 const admin=await req('login','',{username:'admin',password:'admin-long-password'});
 const alice=(await req('admin/users',admin.token,{username:'alice',password:'alice-long-password'})).user;
 const bob=(await req('admin/users',admin.token,{username:'bob',password:'bob-long-password'})).user;
 const auth=await req('login','',{username:'alice',password:'alice-long-password'}),other=await req('login','',{username:'bob',password:'bob-long-password'});
 const settings={pagePattern:'https://source.test/perks*',enabledServices:['YouTube','Lovable','Notion','NordVPN']};await req('settings',admin.token,settings);
 const generated=await req('capture-script/regenerate',auth.token,{label:'Profile A'}),captureKey=generated.script.match(/"captureKey":"([a-f0-9]{64})"/)[1];
 const packet=(changes={})=>({version:6,captureKey,batchId:randomUUID(),sourceUrl:'https://source.test/perks?id=1',label:'Profile A',title:'Test',links:urls.map(url=>({url:'https://www.linkedin.com/safety/go/?url='+encodeURIComponent(url)})),...changes});
 return{repo,server,req,auth,other,alice,bob,admin,generated,captureKey,packet,close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
test('web capture saves directly, decodes, reports duplicates and preserves the original result on retry',async()=>{
 const f=await fixture();try{
 assert(!f.generated.script.includes(f.auth.token));assert(!f.generated.script.includes('MONGODB_URI'));
 const packet=f.packet(),response=await f.req('capture','',packet,'https://source.test');assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),'https://source.test');assert.equal(response.result.added,4);assert.equal(response.result.level,'success');
 let history=await f.req('links',f.auth.token);assert.equal(history.total,4);assert(history.rows.every(r=>!r.url.includes('safety/go')));assert(history.rows.some(r=>r.url===urls[0]));
 const retry=await f.req('capture','',packet,'https://source.test');assert.equal(retry.result.added,4);assert.equal((await f.req('links',f.auth.token)).total,4);
 const dupe=await f.req('capture','',f.packet({label:'Other label'}),'https://source.test');assert.equal(dupe.result.level,'error');assert.equal(dupe.result.code,'duplicates');assert.equal(dupe.result.duplicates,4);assert.equal(dupe.result.added,0);
 const mixed=await f.req('capture','',f.packet({links:[...urls.slice(0,3).map(url=>({url})),{url:'https://nordvpn.com/linkedin/?code=NEW'}]}),'https://source.test');assert.equal(mixed.result.level,'warning');assert.equal(mixed.result.added,1);assert.equal(mixed.result.duplicates,3);
 history=await f.req('links',f.auth.token);assert.equal(history.total,5);assert.equal((await f.req('links',f.other.token)).total,0);
 }finally{await f.close();}
});
test('capture keys cannot read history/admin, change owner, use a wrong site, or import into another panel user',async()=>{
 const f=await fixture();try{
 assert.equal((await f.req('links',f.captureKey)).status,401);assert.equal((await f.req('admin/users',f.captureKey)).status,401);
 assert.equal((await f.req('capture','',f.packet(),'https://evil.test')).status,403);
 assert.equal((await f.req('capture','',f.packet({sourceUrl:'https://source.test/elsewhere'}),'https://source.test')).status,403);
 assert.equal((await f.req('capture-import',f.other.token,f.packet())).status,403);
 assert.equal((await f.req('capture','',f.packet({ownerId:f.bob.id,userId:f.bob.id}),'https://source.test')).result.added,4);
 assert.equal((await f.req('links',f.other.token)).total,0);
 const second=await f.req('capture-script/regenerate',f.other.token,{}),key=second.script.match(/"captureKey":"([a-f0-9]{64})"/)[1];
 assert.equal((await f.req('capture','',f.packet({captureKey:key}),'https://source.test')).result.added,4);
 }finally{await f.close();}
});
test('missing/partial pages, unsafe links and malformed packets never produce successful saves',async()=>{
 const f=await fixture();try{
 assert.equal((await f.req('capture','',f.packet({links:[]}),'https://source.test')).result.code,'no-links');
 assert.equal((await f.req('capture','',f.packet({links:[{url:urls[0]}]}),'https://source.test')).result.code,'missing-services');
 assert.equal((await f.req('capture','',f.packet({links:[{url:'javascript:alert(1)'}]}),'https://source.test')).status,400);
 assert.equal((await f.req('capture','',f.packet({captureKey:'invalid'}),'https://source.test')).status,401);
 assert.equal((await f.req('links',f.auth.token)).total,0);
 }finally{await f.close();}
});
test('permanent script stays identical across copying, settings edits, logout and a new server instance',async()=>{
 const f=await fixture();let otherServer;try{
  const copies=await Promise.all([f.req('capture-script',f.auth.token,{}),f.req('capture-script',f.auth.token,{label:'ignored-per-call-label'})]);
  assert.equal(copies[0].script,f.generated.script);assert.equal(copies[1].script,f.generated.script);assert.equal(copies[0].expiresAt,null);assert.equal(f.repo.permanentScripts.size,1);
  const stored=f.repo.permanentScripts.get(f.alice.id);assert(!JSON.stringify(stored).includes(f.captureKey));assert(!JSON.stringify(stored).includes(f.generated.script));assert.equal('expiresAt' in stored,false);
  stored.createdAt=new Date('2000-01-01');
  await f.req('settings',f.admin.token,{pagePattern:'https://source.test/other*',enabledServices:['YouTube','Lovable']});
  assert.equal((await f.req('capture-script',f.auth.token,{})).script,f.generated.script);
  const config=await f.req('capture-config','',f.packet({sourceUrl:'https://source.test/other'}),'https://source.test');assert.deepEqual(config.settings.enabledServices,['YouTube','Lovable']);assert.equal('minLinks' in config.settings,false);assert.equal(config.owner.username,'alice');
  assert.equal((await f.req('capture','',f.packet(),'https://source.test')).status,403);
  const accepted=await f.req('capture','',f.packet({sourceUrl:'https://source.test/other',links:urls.slice(0,2).map(url=>({url}))}),'https://source.test');assert.equal(accepted.result.added,2);assert.equal(accepted.result.owner.username,'alice');
  assert.equal((await f.req('links',f.auth.token)).rows[0].profile_name,'Browser capture');
  otherServer=createApp(f.repo,{publicOrigin:'https://panel.test',scriptSecret:SCRIPT_SECRET});otherServer.listen(0,'127.0.0.1');await once(otherServer,'listening');
  const response=await fetch('http://127.0.0.1:'+otherServer.address().port+'/api/capture-script',{method:'POST',headers:{Authorization:'Bearer '+f.auth.token,'Content-Type':'application/json'},body:'{}'});assert.equal((await response.json()).script,f.generated.script);
  await f.req('logout',f.auth.token,{});assert.equal((await f.req('capture','',f.packet({sourceUrl:'https://source.test/other',links:[{url:urls[0]},{url:urls[1]+'NEW'}]}),'https://source.test')).result.added,1);
 }finally{if(otherServer){otherServer.closeAllConnections();await new Promise(r=>otherServer.close(r));}await f.close();}
});
test('self/admin revocation, password resets and disabling stop old scripts; replacement is distinct',async()=>{
 const f=await fixture();try{
  assert.equal((await f.req('admin/users/revoke-script',f.other.token,{id:f.alice.id})).status,403);
  await f.req('capture-scripts/revoke',f.auth.token,{});assert.equal((await f.req('capture','',f.packet(),'https://source.test')).status,401);
  const next=await f.req('capture-script/regenerate',f.auth.token,{}),key=next.script.match(/"captureKey":"([a-f0-9]{64})"/)[1];assert.notEqual(next.script,f.generated.script);
  await f.req('admin/users/revoke-script',f.admin.token,{id:f.alice.id});assert.equal((await f.req('capture','',f.packet({captureKey:key}),'https://source.test')).status,401);
  const renewed=await f.req('capture-script/regenerate',f.auth.token,{}),beforeReset=renewed.script.match(/"captureKey":"([a-f0-9]{64})"/)[1];
  await f.req('admin/users/update',f.admin.token,{id:f.alice.id,password:'n'});assert.equal((await f.req('capture','',f.packet({captureKey:beforeReset}),'https://source.test')).status,401);
  const login=await f.req('login','',{username:'alice',password:'n'}),afterReset=await f.req('capture-script/regenerate',login.token,{});assert.notEqual(afterReset.script,renewed.script);
  const disabledKey=afterReset.script.match(/"captureKey":"([a-f0-9]{64})"/)[1];await f.req('admin/users/update',f.admin.token,{id:f.alice.id,active:false});
  assert.equal((await f.req('capture','',f.packet({captureKey:disabledKey}),'https://source.test')).status,401);assert.equal((await f.req('capture-script',login.token,{})).status,401);
 }finally{await f.close();}
});
test('legacy timed keys expire and active old engines request a one-time script update',async()=>{
 const f=await fixture();try{
  const token='f'.repeat(64),record={_id:hashToken(token),ownerId:f.alice.id,authVersion:1,settings:{pagePattern:'https://source.test/perks*',minLinks:4},expiresAt:new Date(0)};await f.repo.addCaptureKey(record);
  assert.equal((await f.req('capture','',f.packet({version:4,captureKey:token}),'https://source.test')).status,401);
  record.expiresAt=new Date(Date.now()+100000);await f.req('settings',f.admin.token,{pagePattern:'https://source.test/other*'});
  assert.equal((await f.req('capture','',f.packet({version:4,captureKey:token,sourceUrl:'https://source.test/other'}),'https://source.test')).status,426);
 }finally{await f.close();}
});
test('a save is never acknowledged before storage finishes; interrupted batches retry without duplicate rows',async()=>{
 const f=await fixture();try{
 const original=f.repo.captureWebLinks.bind(f.repo);let release,started;
 const entered=new Promise(r=>started=r),gate=new Promise(r=>release=r);
 f.repo.captureWebLinks=async(...args)=>{started();await gate;return original(...args);};
 let finished=false;const packet=f.packet(),request=f.req('capture','',packet,'https://source.test').then(r=>{finished=true;return r;});await entered;assert.equal(finished,false);release();assert.equal((await request).result.added,4);
 f.repo.captureWebLinks=original;
 assert.equal((await f.req('capture','',packet,'https://source.test')).result.added,4);assert.equal((await f.req('links',f.auth.token)).total,4);
 }finally{await f.close();}
});
test('settings accept path wildcards but reject wildcard hosts and embedded credentials',()=>{
 assert.deepEqual(cleanSettings({pagePattern:'https://source.test/path*'}).enabledServices,['YouTube','Lovable','Notion','NordVPN']);
 assert.throws(()=>cleanSettings({pagePattern:'https://source.test/path*',enabledServices:['Invalid']}));
 assert.throws(()=>cleanSettings({pagePattern:'https://*.test/path'}));assert.throws(()=>cleanSettings({pagePattern:'https://u:p@source.test/path'}));
});

test('only admins can configure the global page/services; disabled links are filtered and cannot replace missing services',async()=>{
 const f=await fixture();try{
  const forbidden=await f.req('settings',f.auth.token,{pagePattern:'https://evil.test/*',enabledServices:['YouTube']});assert.equal(forbidden.status,403);
  assert.equal((await f.req('settings',f.other.token)).settings.pagePattern,'https://source.test/perks*');
  const partial=await f.req('capture','',f.packet({links:[0,1,2,3].map(i=>({url:urls[0]+i}))}),'https://source.test');
  assert.equal(partial.result.code,'missing-services');assert.deepEqual(partial.result.missing,['Lovable','Notion','NordVPN']);assert.equal(f.repo.links.size,0);
  await f.req('settings',f.admin.token,{pagePattern:'https://source.test/perks*',enabledServices:['YouTube']});
  const accepted=await f.req('capture','',f.packet(),'https://source.test');assert.equal(accepted.result.added,1);assert.equal(accepted.result.ignored,3);
  assert.deepEqual((await f.req('links',f.auth.token)).rows.map(row=>row.service),['YouTube']);
  await f.req('settings',f.admin.token,{pagePattern:'https://source.test/perks*',enabledServices:[]});
  const paused=await f.req('capture','',f.packet(),'https://source.test');assert.equal(paused.status,403);assert.match(paused.error,/paused/);assert.equal(f.repo.links.size,1);
  const now=new Date().toISOString();assert.equal((await f.req('sync',f.auth.token,{rows:[{uid:'x',url:urls[0],first_seen:now,last_seen:now}]})).status,403);
 }finally{await f.close();}
});
test('Headspace captures/export work when enabled and scripts do not change on admin policy changes',async()=>{
 const f=await fixture();try{
  const headspace='https://checkout.headspace.com/checkout?voucherCode=LINKEDIN-ABCDEF0123456789';
  await f.req('settings',f.admin.token,{pagePattern:'https://source.test/perks*',enabledServices:['Headspace']});
  assert.equal((await f.req('capture-script',f.auth.token,{})).script,f.generated.script);
  const wrapped='https://www.linkedin.com/safety/go/?url='+encodeURIComponent(headspace)+'&urlhash=example&mt=tracking&isSdui=true&lipi=tracking';
  assert.equal((await f.req('capture','',f.packet({links:[{url:wrapped},...urls.map(url=>({url}))]}),'https://source.test')).result.added,1);
  const duplicate=await f.req('capture','',f.packet({links:[{url:headspace}]}),'https://source.test');assert.equal(duplicate.result.code,'duplicates');assert.equal(duplicate.result.added,0);assert.equal(duplicate.result.duplicates,1);
  const snapshot=await f.req('exports',f.auth.token,{service:'Headspace'});assert.match(snapshot.export.filename,/^Headspace_\d{4}-\d{2}-\d{2}\.txt$/);assert.deepEqual(snapshot.export.urls,[headspace]);
  await f.req('settings',f.admin.token,{pagePattern:'https://source.test/perks*',enabledServices:['YouTube']});
  assert.equal((await f.req('links?service=Headspace',f.auth.token)).total,1);
 }finally{await f.close();}
});
test('outdated engines show a reason and require explicit regeneration before code is returned',async()=>{
 const f=await fixture();try{
  const stored=f.repo.permanentScripts.get(f.alice.id),old={...stored};delete old.engineVersion;
  const plaintext='// Old v5 script '+JSON.stringify({captureKey:f.captureKey});old.ciphertext=sealScript(plaintext,old,SCRIPT_SECRET);f.repo.permanentScripts.set(f.alice.id,old);
  const rejected=await f.req('capture-config','',f.packet({version:5}),'https://source.test');assert.equal(rejected.status,426);
  const read=await f.req('capture-script',f.auth.token,{});assert.equal(read.status,409);assert.equal(read.scriptStatus.code,'engine-update');assert.equal(read.script,undefined);
  assert.equal(f.repo.permanentScripts.get(f.alice.id).ciphertext,old.ciphertext);
  const upgraded=await f.req('capture-script/regenerate',f.auth.token,{});assert.match(upgraded.script,/Link Grabber Web v6/);assert.notEqual(upgraded.scriptId,old.revision);
  assert.notEqual(upgraded.script.match(/"captureKey":"([a-f0-9]{64})"/)[1],f.captureKey);
  assert.equal(openScript(f.repo.permanentScripts.get(f.alice.id),SCRIPT_SECRET),upgraded.script);
  assert.equal((await f.req('capture-script',f.auth.token,{})).script,upgraded.script);
  assert.equal((await f.req('capture','',f.packet(),'https://source.test')).status,401);
 }finally{await f.close();}
});
test('an admin must set a main URL before capture; old private settings do not become shared automatically',async()=>{
 const f=await fixture();try{
  f.repo.settings.delete('global:capture');await f.repo.saveSettings(f.alice.id,{pagePattern:'https://private.test/*',minLinks:4});
  assert.equal((await f.req('settings',f.auth.token)).settings.configured,false);
  assert.equal((await f.req('capture-script',f.auth.token,{})).status,200);
  const rejected=await f.req('capture','',f.packet(),'https://source.test');assert.equal(rejected.status,409);assert.match(rejected.error,/administrator/);
 }finally{await f.close();}
});

test('password reset hides code and keeps its reason across reads/logins until explicit regeneration',async()=>{
 const f=await fixture();try{
  const original=structuredClone(f.repo.permanentScripts.get(f.alice.id));
  await f.req('admin/users/update',f.admin.token,{id:f.alice.id,password:'new'});
  const stale=await f.req('capture-script/status',f.auth.token);assert.equal(stale.status,401);assert.match(stale.error,/password was reset/);
  assert.equal((await f.req('capture','',f.packet(),'https://source.test')).status,401);
  const login=await f.req('login','',{username:'alice',password:'new'});
  for(let i=0;i<2;i++){
   const status=await f.req('capture-script/status',login.token);assert.equal(status.scriptStatus.code,'password-reset');assert.equal(status.scriptStatus.canRegenerate,true);
   const get=await f.req('capture-script',login.token);const oldPost=await f.req('capture-script',login.token,{});
   for(const response of [get,oldPost]){assert.equal(response.status,409);assert.equal(response.script,undefined);assert.equal(response.scriptStatus.code,'password-reset');}
   assert.deepEqual(f.repo.permanentScripts.get(f.alice.id),original);
  }
  const next=await f.req('capture-script/regenerate',login.token,{});assert.equal(next.status,200);assert.notEqual(next.script,f.generated.script);
  assert.equal((await f.req('capture-script/status',login.token)).scriptStatus.status,'active');assert.equal((await f.req('capture-script',login.token)).script,next.script);
  const key=next.script.match(/"captureKey":"([a-f0-9]{64})"/)[1];assert.equal((await f.req('capture','',f.packet({captureKey:key}),'https://source.test')).result.added,4);
 }finally{await f.close();}
});
test('self/admin revoke and disable/enable preserve distinct reasons without automatic replacement',async()=>{
 const f=await fixture();try{
  await f.req('capture-scripts/revoke',f.auth.token,{});
  assert.equal((await f.req('capture-script/status',f.auth.token)).scriptStatus.code,'self-revoked');
  assert.equal((await f.req('capture-script',f.auth.token,{})).status,409);assert.equal((await f.req('capture','',f.packet(),'https://source.test')).status,401);
  const next=await f.req('capture-script/regenerate',f.auth.token,{});assert.equal(next.status,200);
  await f.req('admin/users/revoke-script',f.admin.token,{id:f.alice.id});
  assert.equal((await f.req('capture-script/status',f.auth.token)).scriptStatus.code,'admin-revoked');
  assert.equal((await f.req('capture-script',f.auth.token)).script,undefined);
  await f.req('admin/users/update',f.admin.token,{id:f.alice.id,active:false});assert.equal((await f.req('capture-script/regenerate',f.auth.token,{})).status,401);
  await f.req('admin/users/update',f.admin.token,{id:f.alice.id,active:true});
  const login=await f.req('login','',{username:'alice',password:'alice-long-password'});
  assert.equal((await f.req('capture-script/status',login.token)).scriptStatus.code,'account-restored');assert.equal((await f.req('capture-script',login.token)).status,409);
  assert.equal((await f.req('capture-script/regenerate',login.token,{})).status,200);
 }finally{await f.close();}
});
test('self password change records the cause atomically and new accounts require Generate script',async()=>{
 const f=await fixture();try{
  const empty=await f.req('capture-script/status',f.other.token);assert.equal(empty.scriptStatus.code,'not-generated');
  assert.equal((await f.req('capture-script',f.other.token,{})).status,409);assert.equal(f.repo.permanentScripts.has(f.bob.id),false);
  await f.req('password',f.auth.token,{currentPassword:'alice-long-password',password:'changed'});
  const login=await f.req('login','',{username:'alice',password:'changed'});assert.equal((await f.req('capture-script/status',login.token)).scriptStatus.code,'password-changed');
  assert.equal((await f.req('capture-script',login.token)).status,409);
 }finally{await f.close();}
});
test('revocation during regeneration cannot return or reactivate a stale generated key',async()=>{
 const f=await fixture();try{
  await f.req('capture-scripts/revoke',f.auth.token,{});
  const install=f.repo.installPermanentScript.bind(f.repo);let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  f.repo.installPermanentScript=async(...args)=>{entered();await gate;return install(...args);};
  const pending=f.req('capture-script/regenerate',f.auth.token,{});await started;
  await f.req('admin/users/revoke-script',f.admin.token,{id:f.alice.id});release();
  assert.equal((await pending).status,409);assert.equal((await f.req('capture-script/status',f.auth.token)).scriptStatus.code,'admin-revoked');assert.equal((await f.req('capture-script',f.auth.token)).script,undefined);
  assert.equal((await f.req('capture','',f.packet(),'https://source.test')).status,401);
  f.repo.installPermanentScript=install;assert.equal((await f.req('capture-script/regenerate',f.auth.token,{})).status,200);
 }finally{await f.close();}
});

test('a delayed copy request checks current password/revocation state before returning code',async()=>{
 const f=await fixture();try{
  const original=f.repo.permanentScript.bind(f.repo);let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  f.repo.permanentScript=async(...args)=>{const record=await original(...args);entered();await gate;return record;};
  const copy=f.req('capture-script',f.auth.token);await started;
  await f.req('admin/users/update',f.admin.token,{id:f.alice.id,password:'new'});release();
  const response=await copy;assert.equal(response.status,401);assert.equal(response.script,undefined);assert.match(response.error,/password was reset/);
  f.repo.permanentScript=original;
 }finally{await f.close();}
});

test('all five selected services require Headspace and save decoded vouchers in the fifth category',async()=>{
 const f=await fixture();try{
  await f.req('settings',f.admin.token,{pagePattern:'https://source.test/perks*',enabledServices:['YouTube','Lovable','Notion','NordVPN','Headspace']});
  const config=await f.req('capture-config','',f.packet(),'https://source.test');assert.deepEqual(config.settings.rules.find(rule=>rule.service==='Headspace'),{service:'Headspace',hosts:['checkout.headspace.com'],queryAny:['voucherCode']});
  const partial=await f.req('capture','',f.packet(),'https://source.test');assert.equal(partial.result.code,'missing-services');assert.deepEqual(partial.result.missing,['Headspace']);assert.equal(f.repo.links.size,0);
  const destination='https://checkout.headspace.com/checkout?voucherCode=LINKEDIN-ABCDEF0123456789';
  const response=await f.req('capture','',f.packet({links:[...urls.map(url=>({url})),{url:'https://www.linkedin.com/safety/go/?url='+encodeURIComponent(destination)+'&urlhash=example'}]}),'https://source.test');assert.equal(response.result.added,5);
  const history=await f.req('links?service=Headspace',f.auth.token);assert.equal(history.total,1);assert.equal(history.rows[0].url,destination);
  const script=await f.req('capture-script',f.auth.token);assert.equal(script.script,f.generated.script);
 }finally{await f.close();}
});
