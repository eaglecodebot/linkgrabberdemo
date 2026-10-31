import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import {createApp,bootstrap} from '../cloud/app.mjs';
import {MemoryRepository} from './cloud-memory.mjs';
import {inferService} from '../cloud/services.mjs';
import {matchRewardLink} from '../src/decode.mjs';
import {sealScript} from '../cloud/script-vault.mjs';
const secret='ce'.repeat(32),wrap=url=>'https://www.linkedin.com/safety/go/?url='+encodeURIComponent(url);
async function fixture(){
 const repo=new MemoryRepository();await bootstrap(repo,'admin','a');const server=createApp(repo,{scriptSecret:secret});server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
 const raw=(path,token='',data)=>fetch(origin+'/api/'+path,{headers:{Authorization:'Bearer '+token,...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{method:'POST',body:JSON.stringify(data)})});
 const api=async(path,token='',data)=>{const r=await raw(path,token,data),v=await r.json();assert(r.ok,v.error);return v;};
 const admin=await api('login','',{username:'admin',password:'a'});const {user}=await api('admin/users',admin.token,{username:'alice',password:'a'});const alice=await api('login','',{username:'alice',password:'a'});
 await api('settings',admin.token,{pagePattern:'https://source.example/perks*',enabledServices:['YouTube']});
 const script=await api('capture-script/regenerate',alice.token,{}),key=script.script.match(/"captureKey":"([a-f0-9]{64})"/)[1];
 const change=async(action,name,sampleUrl)=>api('admin/services',admin.token,{action,name,sampleUrl,revision:(await api('admin/services',admin.token)).catalog.revision});
 const packet=(links,extra={})=>({version:6,matcherVersion:2,captureKey:key,batchId:crypto.randomUUID(),sourceUrl:'https://source.example/perks',links:links.map(url=>({url:wrap(url)})),...extra});
 return {repo,origin,raw,api,admin,alice,user,script,key,change,packet,close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
test('sample inference decodes once, preserves token encoding and matches exact paths and all required parameters',()=>{
 const url='https://rewards.example/redeem?code=EXAMPLE%2Bkeep&campaign=one&utm_source=test';
 const {rule}=inferService({name:'New Rewards',sampleUrl:wrap(url)});
 assert.deepEqual(rule,{service:'New Rewards',hosts:['rewards.example'],exactPath:'/redeem',queryAll:['code','campaign']});assert(!JSON.stringify(rule).includes('EXAMPLE'));
 assert.equal(matchRewardLink(wrap(url),[rule]).url,url);
 for(const value of ['https://rewards.example/redeem?code=NEXT&campaign=two','https://www.rewards.example/redeem?code=NEXT&campaign=two'])assert.equal(matchRewardLink(value,[rule]).service,'New Rewards');
 for(const value of ['https://rewards.example/redeem/other?code=A&campaign=B','https://rewards.example/redeem?code=A','https://rewards.example/redeem?code=&campaign=B','https://fake.rewards.example/redeem?code=A&campaign=B'])assert.equal(matchRewardLink(value,[rule]),null);
 for(const name of ['','__proto__','constructor','a\nb'])assert.throws(()=>inferService({name,sampleUrl:wrap(url)}));
 for(const sampleUrl of ['javascript:alert(1)','https://u:p@rewards.example/redeem',wrap('javascript:alert(1)')])assert.throws(()=>inferService({name:'Test',sampleUrl}));
});
test('admin catalog is persistent, rejects overlap/stale edits and keeps sample query codes out of stored data',async()=>{
 const f=await fixture();try{
  for(const route of ['admin/services','admin/services/preview'])assert.equal((await f.raw(route,f.alice.token,{action:'add',name:'Other',sampleUrl:'https://other.example/?code=X'})).status,403);
  const before=(await f.api('capture-script',f.alice.token)).script;
  await f.change('add','Custom Rewards',wrap('https://reward.example/redeem?code=SAMPLE_PRIVATE'));
  assert(!JSON.stringify(f.repo.settings.get('global:services')).includes('SAMPLE_PRIVATE'));
  assert.deepEqual((await f.api('settings',f.alice.token)).settings.enabledServices,['YouTube','Custom Rewards']);
  assert.equal((await f.raw('admin/services',f.admin.token,{action:'remove',name:'Custom Rewards',revision:0})).status,409);
  assert.equal((await f.raw('admin/services',f.admin.token,{action:'add',name:'Overlap',sampleUrl:'https://reward.example/redeem?code=B',revision:1})).status,400);
  assert.equal((await f.api('capture-script',f.alice.token)).script,before,'current scripts stay unchanged');
  const currentRelease=(await f.api('extension-release',f.alice.token)).release.id;
  await f.change('remove','Custom Rewards');assert.equal((await f.api('extension-release',f.alice.token)).release.id,currentRelease);
  const settings=(await f.api('settings',f.alice.token)).settings;assert(!settings.availableServices.includes('Custom Rewards'));assert(settings.historyServices.includes('Custom Rewards'));
  await f.change('restore','Custom Rewards');assert((await f.api('settings',f.alice.token)).settings.enabledServices.includes('Custom Rewards'));
  await f.api('settings',f.admin.token,{pagePattern:'https://source.example/perks*',enabledServices:['YouTube']});assert.equal((await f.api('settings',f.alice.token)).settings.requiresDynamicMatcher,false);
 }finally{await f.close();}
});
test('only older matchers need a prompt; updated extension works before console regeneration and migration keeps its key',async()=>{
 const f=await fixture();try{
  const record=f.repo.permanentScripts.get(f.user.id);record.engineVersion=6;record.ciphertext=sealScript('// legacy '+JSON.stringify({captureKey:f.key,panelOrigin:f.origin}),record,secret);
  assert.equal((await f.api('capture-script/status',f.alice.token)).scriptStatus.status,'active');
  await f.change('add','New Service',wrap('https://new.example/redeem?code=SAMPLE'));
  const state=(await f.api('capture-script/status',f.alice.token)).scriptStatus;assert.equal(state.code,'service-matcher-update');assert.equal(state.extensionAllowed,true);
  await f.change('remove','New Service');assert.equal((await f.api('capture-script/status',f.alice.token)).scriptStatus.status,'active');assert.equal((await f.raw('capture-config','',f.packet([],{matcherVersion:undefined}))).status,200);
  await f.change('restore','New Service');
  assert.equal((await f.raw('capture-config','',f.packet([],{matcherVersion:undefined}))).status,426);
  const zipResponse=await f.raw('extension-download',f.alice.token);assert.equal(zipResponse.status,200);const zip=await JSZip.loadAsync(await zipResponse.arrayBuffer());assert.equal(JSON.parse(await zip.file('capture-connection.json').async('string')).captureKey,f.key);
  const setup=await f.api('extension/config','',f.packet([]));assert(setup.settings.rules.some(rule=>rule.service==='New Service'));
  const captured=await f.api('extension/capture','',f.packet(['https://youtube.com/premium?acc=NEXT','https://new.example/redeem?code=NEXT']));assert.equal(captured.result.added,2);
  const updated=await f.api('capture-script/regenerate',f.alice.token,{});assert.equal(updated.engineVersion,7);assert(updated.script.includes(f.key));assert.equal((await f.api('capture-script/status',f.alice.token)).scriptStatus.status,'active');
  const release=(await f.api('extension-release',f.alice.token)).release.id;await f.change('add','Another Service','https://another.example/claim?token=EXAMPLE');
  assert.equal((await f.api('capture-script',f.alice.token)).script,updated.script);assert.equal((await f.api('extension-release',f.alice.token)).release.id,release);
 }finally{await f.close();}
});
test('a matcher upgrade rotates a legacy connection when its panel address also changed',async()=>{
 const f=await fixture();try{
  const record=f.repo.permanentScripts.get(f.user.id);record.engineVersion=6;delete record.panelOrigin;record.ciphertext=sealScript('// legacy '+JSON.stringify({captureKey:f.key,panelOrigin:'https://old-panel.example'}),record,secret);
  await f.change('add','New Service','https://new.example/redeem?code=EXAMPLE');
  const updated=await f.api('capture-script/regenerate',f.alice.token,{});assert(!updated.script.includes(f.key));assert(updated.script.includes(f.origin));
  assert.equal((await f.raw('extension/config','',f.packet([]))).status,401);
 }finally{await f.close();}
});
test('custom capture filters raw fallback candidates, skips duplicates and freezes TXT/Excel grouping after removal',async()=>{
 const f=await fixture();try{
  await f.change('add','Foo/Bar','https://a.example/redeem?code=EXAMPLE');await f.change('add','Foo?Bar','https://b.example/redeem?token=EXAMPLE');
  await f.api('settings',f.admin.token,{pagePattern:'https://source.example/perks*',enabledServices:['Foo/Bar','Foo?Bar']});
  const urls=['https://a.example/redeem?code=A%2BB','https://b.example/redeem?token=NEXT'];
  const packet=f.packet([...urls,'https://unrelated.example/help'],{rawCandidates:true,rawRepeatedByUrl:{[urls[0]]:1}});const first=await f.api('capture','',packet);assert.equal(first.result.added,2);assert.equal(first.result.ignored,1);assert.equal(first.result.level,'warning');assert.equal(first.result.duplicates,1);
  assert.equal((await f.api('capture','',f.packet(urls))).result.code,'duplicates');
  assert.equal((await f.raw('capture','',f.packet(['https://a.example/redeem/child?code=A',urls[1]]))).status,400);
  const txt=(await f.api('exports',f.alice.token,{status:'all'})).export;assert.match(txt.text,/Foo\/Bar\r\n\r\n/);assert.match(txt.text,/Foo\?Bar\r\n\r\n/);
  const response=await f.raw('exports',f.alice.token,{status:'all',format:'xlsx'}),id=response.headers.get('X-Export-Id');const bytes=await response.arrayBuffer();const book=new ExcelJS.Workbook();await book.xlsx.load(bytes);assert.deepEqual(book.worksheets.map(s=>s.name),['Foo_Bar','Foo_Bar (2)']);assert.equal(book.worksheets[0].getCell('A2').value,urls[0]);
  await f.change('remove','Foo/Bar');await f.change('remove','Foo?Bar');assert.equal((await f.api('links?service=Foo%2FBar',f.alice.token)).total,1);
  assert.equal((await f.api('exports/get?id='+txt._id,f.alice.token)).export.text,txt.text);
  const restored=new ExcelJS.Workbook();await restored.xlsx.load(await(await f.raw('exports/get?id='+id,f.alice.token)).arrayBuffer());assert.deepEqual(restored.worksheets.map(s=>s.name),['Foo_Bar','Foo_Bar (2)']);
 }finally{await f.close();}
});
