import {loadExtensionRelease} from '../cloud/extension-release.mjs';
import {workflowConfig} from '../cloud/extension-template/shared.js';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import JSZip from 'jszip';
import {createApp,bootstrap} from '../cloud/app.mjs';
import {MemoryRepository} from './cloud-memory.mjs';

async function fixture(){
  const repo=new MemoryRepository();await bootstrap(repo,'admin','admin');
  const server=createApp(repo,{scriptSecret:'ab'.repeat(32)});server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin='http://127.0.0.1:'+server.address().port;
  const raw=(path,token='',body,headers={})=>fetch(origin+'/api/'+path,{headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});
  const api=async(path,token,body)=>{const r=await raw(path,token,body);const data=await r.json();assert(r.ok,data.error);return data;};
  const admin=await api('login','',{username:'admin',password:'admin'});
  await api('settings',admin.token,{pagePattern:'https://source.example/perks*',enabledServices:['YouTube','Headspace']});
  const users=[];
  for(const username of ['alice','bob']){const {user}=await api('admin/users',admin.token,{username,password:'p@ss'});const auth=await api('login','',{username,password:'p@ss'});users.push({...user,...auth});}
  const connection=async token=>{const r=await raw('extension-download',token);assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'application/zip');const zip=await JSZip.loadAsync(await r.arrayBuffer());return {zip,data:JSON.parse(await zip.file('capture-connection.json').async('string'))};};
  return {repo,raw,api,admin,alice:users[0],bob:users[1],connection,close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
const packet=key=>({version:6,captureKey:key,batchId:crypto.randomUUID(),sourceUrl:'https://source.example/perks',links:[{url:'https://youtube.com/premium?acc=EXT-EXAMPLE%2Bkeep'},{url:'https://checkout.headspace.com/checkout?voucherCode=LINKEDIN-EXAMPLE'}]});
test('personalized ZIPs use the signed-in owner and current permanent key; common workflows stay bundled',async()=>{
  const f=await fixture();try{
    assert.equal((await f.raw('extension-download',f.alice.token)).status,409);
    const first=await f.api('capture-script/regenerate',f.alice.token,{});await f.api('capture-script/regenerate',f.bob.token,{});
    const a=await f.connection(f.alice.token),b=await f.connection(f.bob.token);
    assert.equal(a.data.username,'alice');assert.equal(b.data.username,'bob');assert.notEqual(a.data.captureKey,b.data.captureKey);assert(first.script.includes(a.data.captureKey));
    assert.equal((await f.api('capture-script',f.alice.token)).script,first.script);
    const manifest=JSON.parse(await a.zip.file('manifest.json').async('string'));assert.equal(manifest.version,'1.9.2');assert.deepEqual(manifest.host_permissions,['http://127.0.0.1/*','https://source.example/*']);
    const popup=await a.zip.file('popup.html').async('string');assert(popup.indexOf('id="start"')<popup.indexOf('id="grab-links"'));assert(popup.indexOf('id="grab-links"')<popup.indexOf('id="start2"'));
    for(const file of ['engine.js','content.js','workflow.json','options.html','grabber.js','grabber-page.js','grabber-decode.js'])assert(a.zip.file(file));
    assert.equal(await a.zip.file('engine.js').async('string'),await b.zip.file('engine.js').async('string'));
    assert(!JSON.stringify(a.data).includes('p@ss'));assert(!JSON.stringify(a.data).includes(b.data.captureKey));assert(!a.zip.file('server.mjs'));
    assert.equal((await f.raw('extension-download')).status,401);
  }finally{await f.close();}
});
test('extension APIs isolate owners, validate the actual page, report missing/duplicate links and use current admin settings',async()=>{
  const f=await fixture();try{
    await f.api('capture-script/regenerate',f.alice.token,{});const {data}=await f.connection(f.alice.token),p=packet(data.captureKey);
    const headers={Origin:'chrome-extension://'+'a'.repeat(32)};
    const config=await f.raw('extension/config','',{version:6,captureKey:data.captureKey},headers);assert.equal(config.status,200);const setup=await config.json();assert.deepEqual(setup.settings.enabledServices,['YouTube','Headspace']);assert.equal(setup.owner.username,'alice');
    assert.equal((await f.raw('extension/config','',{version:6,captureKey:data.captureKey},{Origin:'https://untrusted.example'})).status,403);
    assert.equal((await f.raw('extension/config','',{version:6,captureKey:'f'.repeat(64)})).status,401);
    assert.equal((await f.raw('extension/capture','',{...p,sourceUrl:'https://wrong.example/perks'},headers)).status,403);
    assert.equal((await (await f.raw('extension/capture','',{...p,links:p.links.slice(0,1)},headers)).json()).result.code,'missing-services');
    const result=(await (await f.raw('extension/capture','',p,headers)).json()).result;assert.equal(result.added,2);assert.equal(result.owner.username,'alice');
    assert.equal((await f.api('links',f.bob.token)).total,0);assert.equal((await f.api('links',f.alice.token)).total,2);
    assert.equal((await (await f.raw('extension/capture','',{...p,batchId:crypto.randomUUID()},headers)).json()).result.code,'duplicates');
    await f.api('settings',f.admin.token,{pagePattern:'https://source.example/changed*',enabledServices:['YouTube']});
    const latest=await f.api('extension/config','',{version:6,captureKey:data.captureKey});assert.deepEqual(latest.settings.enabledServices,['YouTube']);assert.equal(latest.settings.pagePattern,'https://source.example/changed*');
    await f.api('settings',f.admin.token,{pagePattern:'https://source.example/changed*',enabledServices:[]});assert.equal((await f.raw('extension/config','',{version:6,captureKey:data.captureKey})).status,403);
  }finally{await f.close();}
});
test('revoked/password-reset extension connections fail; download never silently regenerates a replacement',async()=>{
  const f=await fixture();try{
    await f.api('capture-script/regenerate',f.alice.token,{});const old=(await f.connection(f.alice.token)).data;
    await f.api('capture-scripts/revoke',f.alice.token,{});assert.equal((await f.raw('extension-download',f.alice.token)).status,409);assert.equal((await f.raw('extension/config','',{version:6,captureKey:old.captureKey})).status,401);
    await f.api('capture-script/regenerate',f.alice.token,{});const fresh=(await f.connection(f.alice.token)).data;assert.notEqual(fresh.captureKey,old.captureKey);
    await f.api('admin/users/update',f.admin.token,{id:f.alice.id,password:'new@pass'});
    assert.equal((await f.raw('extension-download',f.alice.token)).status,401);assert.equal((await f.raw('extension/capture','',packet(fresh.captureKey))).status,401);
    const login=await f.api('login','',{username:'alice',password:'new@pass'});const revoked=await f.raw('extension-download',login.token);assert.equal(revoked.status,409);assert.match((await revoked.json()).error,/password/i);
  }finally{await f.close();}
});

test('only admins manage the three exact workflow URLs; ZIPs include them and live settings work while capture is paused',async()=>{
  const f=await fixture();try{
    const urls={startUrl:'https://trial.example/start?offer=TEST%2Bkeep',step2StartUrl:'https://cancel.example/subscriptions',step2SecondUrl:'https://refund.example/request'};
    assert.equal((await f.raw('workflow-settings',f.alice.token,urls)).status,403);
    for(const value of ['javascript:alert(1)','https://u:p@site.example/','https://site.example/*','https://site.example/a b'])assert.equal((await f.raw('workflow-settings',f.admin.token,{...urls,startUrl:value})).status,400);
    await f.api('workflow-settings',f.admin.token,urls);assert.deepEqual((await f.api('workflow-settings',f.alice.token)).workflowUrls,urls);
    await f.api('capture-script/regenerate',f.alice.token,{});const {data,zip}=await f.connection(f.alice.token);
    const workflow=JSON.parse(await zip.file('workflow.json').async('string'));assert.equal(workflow.managedWorkflowUrls,true);for(const key of Object.keys(urls))assert.equal(workflow[key],urls[key]);
    const manifest=JSON.parse(await zip.file('manifest.json').async('string'));for(const host of ['trial','cancel','refund'])assert(manifest.host_permissions.includes('https://'+host+'.example/*'));
    const before=(await f.api('extension-release',f.alice.token)).release.id;
    await f.api('settings',f.admin.token,{pagePattern:'https://source.example/perks*',enabledServices:[]});
    const changed={...urls,startUrl:'https://trial.example/new'};await f.api('workflow-settings',f.admin.token,changed);
    assert.deepEqual((await f.api('extension/workflow','',{version:6,captureKey:data.captureKey})).workflowUrls,changed);
    assert.equal((await f.api('extension-release',f.alice.token)).release.id,before,'URL changes are data, not an extension-code release');
    const cleared={startUrl:'',step2StartUrl:'',step2SecondUrl:''};await f.api('workflow-settings',f.admin.token,cleared);assert.deepEqual((await f.api('extension/workflow','',{version:6,captureKey:data.captureKey})).workflowUrls,cleared);
    assert.equal(workflowConfig({...workflow,...cleared},1,{config:{workflowNumber:1,startUrl:urls.startUrl}}).startUrl,'','cleared admin URLs never recover an old local URL');
  }finally{await f.close();}
});

test('release notices are claimed once per account in persistent storage and downloads need successful client confirmation',async()=>{
  const f=await fixture();try{
    const originalUser=await f.repo.userById(f.alice.id),initial=await f.api('extension-release',f.alice.token),releaseId=initial.release.id;
    assert.equal(initial.downloaded,false);assert.equal(initial.notify,true);
    const claims=await Promise.all(Array.from({length:4},()=>f.api('extension-release/seen',f.alice.token,{releaseId})));assert.equal(claims.filter(r=>r.notify).length,1);
    const again=await f.api('login','',{username:'alice',password:'p@ss'});assert.equal((await f.api('extension-release',again.token)).notify,false);
    assert.equal((await f.api('extension-release',f.bob.token)).notify,true);
    assert.equal((await f.raw('extension-download/confirm',f.alice.token,{releaseId:'old-or-unknown-release'})).status,409);
    await f.api('capture-script/regenerate',f.alice.token,{});const response=await f.raw('extension-download',f.alice.token);assert.equal(response.headers.get('X-Extension-Release'),releaseId);await response.arrayBuffer();
    assert.equal((await f.api('extension-release',f.alice.token)).downloaded,false,'preparing/sending a ZIP alone must not clear the update card');
    await f.api('extension-download/confirm',f.alice.token,{releaseId});const complete=await f.api('extension-release',f.alice.token);assert.equal(complete.downloaded,true);assert.equal(complete.notify,false);
    assert.equal((await f.api('extension-release',f.bob.token)).downloaded,false);
    assert.equal((await f.repo.userById(f.alice.id)).authVersion,originalUser.authVersion,'update tracking does not revoke sessions or capture keys');
    assert.equal((await f.raw('extension-release')).status,401);
  }finally{await f.close();}
});

test('runtime file changes automatically create releases; documents do not and nested extension assets are included',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'lg-release-'));
  try{
    const files={'manifest.json':JSON.stringify({manifest_version:3,version:'1.9.0'}),'popup.html':'<button id="grab-links">Grab Links</button>','background.js':'// initial','popup.js':'// popup','workflow.json':'{}','grabber.js':'// capture','grabber-page.js':'// page'};
    for(const [name,content] of Object.entries(files))await writeFile(join(folder,name),content);
    const base=pathToFileURL(folder+'/'),first=await loadExtensionRelease(base);
    await writeFile(join(folder,'README.txt'),'new instructions');await writeFile(join(folder,'capture-connection.json'),'private data');
    assert.equal((await loadExtensionRelease(base)).id,first.id);
    await writeFile(join(folder,'background.js'),'// changed without bumping the version');const changed=await loadExtensionRelease(base);assert.notEqual(changed.id,first.id);assert.equal(changed.version,first.version);
    await mkdir(join(folder,'icons'));await writeFile(join(folder,'icons','test.svg'),'<svg/>');const assets=await loadExtensionRelease(base);assert(assets.files.has('icons/test.svg'));assert.notEqual(assets.id,changed.id);assert(!assets.files.has('capture-connection.json'));
  }finally{await rm(folder,{recursive:true,force:true});}
});
