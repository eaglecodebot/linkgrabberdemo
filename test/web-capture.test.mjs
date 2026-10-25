import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createApp,bootstrap } from '../cloud/app.mjs';
import { MemoryRepository } from './cloud-memory.mjs';
import { cleanSettings } from '../cloud/capture.mjs';
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
 const settings={pagePattern:'https://source.test/perks*',minLinks:4};await req('settings',auth.token,settings);await req('settings',other.token,settings);
 const generated=await req('capture-script',auth.token,{label:'Profile A'}),captureKey=generated.script.match(/"captureKey":"([a-f0-9]{64})"/)[1];
 const packet=(changes={})=>({version:5,captureKey,batchId:randomUUID(),sourceUrl:'https://source.test/perks?id=1',label:'Profile A',title:'Test',links:urls.map(url=>({url:'https://www.linkedin.com/safety/go/?url='+encodeURIComponent(url)})),...changes});
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
 const second=await f.req('capture-script',f.other.token,{}),key=second.script.match(/"captureKey":"([a-f0-9]{64})"/)[1];
 assert.equal((await f.req('capture','',f.packet({captureKey:key}),'https://source.test')).result.added,4);
 }finally{await f.close();}
});
test('missing/partial pages, unsafe links and malformed packets never produce successful saves',async()=>{
 const f=await fixture();try{
 assert.equal((await f.req('capture','',f.packet({links:[]}),'https://source.test')).result.code,'no-links');
 assert.equal((await f.req('capture','',f.packet({links:[{url:urls[0]}]}),'https://source.test')).result.code,'too-few-links');
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
  await f.req('settings',f.auth.token,{pagePattern:'https://source.test/other*',minLinks:1,label:'Updated label'});
  assert.equal((await f.req('capture-script',f.auth.token,{})).script,f.generated.script);
  const config=await f.req('capture-config','',f.packet({sourceUrl:'https://source.test/other'}),'https://source.test');assert.equal(config.settings.minLinks,1);assert.equal(config.owner.username,'alice');
  assert.equal((await f.req('capture','',f.packet(),'https://source.test')).status,403);
  const accepted=await f.req('capture','',f.packet({sourceUrl:'https://source.test/other',links:[{url:urls[0]}]}),'https://source.test');assert.equal(accepted.result.added,1);assert.equal(accepted.result.owner.username,'alice');
  assert.equal((await f.req('links',f.auth.token)).rows[0].profile_name,'Updated label');
  otherServer=createApp(f.repo,{publicOrigin:'https://panel.test',scriptSecret:SCRIPT_SECRET});otherServer.listen(0,'127.0.0.1');await once(otherServer,'listening');
  const response=await fetch('http://127.0.0.1:'+otherServer.address().port+'/api/capture-script',{method:'POST',headers:{Authorization:'Bearer '+f.auth.token,'Content-Type':'application/json'},body:'{}'});assert.equal((await response.json()).script,f.generated.script);
  await f.req('logout',f.auth.token,{});assert.equal((await f.req('capture','',f.packet({sourceUrl:'https://source.test/other',links:[{url:urls[1]}]}),'https://source.test')).result.added,1);
 }finally{if(otherServer){otherServer.closeAllConnections();await new Promise(r=>otherServer.close(r));}await f.close();}
});
test('self/admin revocation, password resets and disabling stop old scripts; replacement is distinct',async()=>{
 const f=await fixture();try{
  assert.equal((await f.req('admin/users/revoke-script',f.other.token,{id:f.alice.id})).status,403);
  await f.req('capture-scripts/revoke',f.auth.token,{});assert.equal((await f.req('capture','',f.packet(),'https://source.test')).status,401);
  const next=await f.req('capture-script',f.auth.token,{}),key=next.script.match(/"captureKey":"([a-f0-9]{64})"/)[1];assert.notEqual(next.script,f.generated.script);
  await f.req('admin/users/revoke-script',f.admin.token,{id:f.alice.id});assert.equal((await f.req('capture','',f.packet({captureKey:key}),'https://source.test')).status,401);
  const renewed=await f.req('capture-script',f.auth.token,{}),beforeReset=renewed.script.match(/"captureKey":"([a-f0-9]{64})"/)[1];
  await f.req('admin/users/update',f.admin.token,{id:f.alice.id,password:'n'});assert.equal((await f.req('capture','',f.packet({captureKey:beforeReset}),'https://source.test')).status,401);
  const login=await f.req('login','',{username:'alice',password:'n'}),afterReset=await f.req('capture-script',login.token,{});assert.notEqual(afterReset.script,renewed.script);
  const disabledKey=afterReset.script.match(/"captureKey":"([a-f0-9]{64})"/)[1];await f.req('admin/users/update',f.admin.token,{id:f.alice.id,active:false});
  assert.equal((await f.req('capture','',f.packet({captureKey:disabledKey}),'https://source.test')).status,401);assert.equal((await f.req('capture-script',login.token,{})).status,401);
 }finally{await f.close();}
});
test('legacy timed keys still expire and their configured page changes remain restricted',async()=>{
 const f=await fixture();try{
  const token='f'.repeat(64),record={_id:hashToken(token),ownerId:f.alice.id,authVersion:1,settings:{pagePattern:'https://source.test/perks*',minLinks:4},expiresAt:new Date(0)};await f.repo.addCaptureKey(record);
  assert.equal((await f.req('capture','',f.packet({version:4,captureKey:token}),'https://source.test')).status,401);
  record.expiresAt=new Date(Date.now()+100000);await f.req('settings',f.auth.token,{pagePattern:'https://source.test/other*',minLinks:4});
  assert.equal((await f.req('capture','',f.packet({version:4,captureKey:token,sourceUrl:'https://source.test/other'}),'https://source.test')).status,409);
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
 assert.equal(cleanSettings({pagePattern:'https://source.test/path*',minLinks:4}).minLinks,4);
 assert.throws(()=>cleanSettings({pagePattern:'https://*.test/path'}));assert.throws(()=>cleanSettings({pagePattern:'https://u:p@source.test/path'}));
});
