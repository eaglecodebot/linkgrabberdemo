// Real Chromium DOM/network/UI with a test-only chrome.* adapter. The runtime
// supplied in this environment does not include the extension loading subsystem.
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import {once} from 'node:events';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {createApp,bootstrap} from '../cloud/app.mjs';
import {MemoryRepository} from './cloud-memory.mjs';
const wait=async(fn,label,timeout=10000)=>{const start=Date.now();while(Date.now()-start<timeout){if(await fn())return;await new Promise(r=>setTimeout(r,30));}throw new Error('Timed out: '+label);};
const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn);}});
const directory=await mkdtemp(join(tmpdir(),'lg-extension-test-'));
const repo=new MemoryRepository();await bootstrap(repo,'admin','admin');
const cloud=createApp(repo,{scriptSecret:'cd'.repeat(32)});cloud.listen(0,'127.0.0.1');await once(cloud,'listening');const origin='http://127.0.0.1:'+cloud.address().port;
let fixtureLinks=5;
const source=http.createServer(async(req,res)=>{
  if(req.url.startsWith('/extension/')){
    const file=req.url.slice('/extension/'.length);
    if(!/^[a-z.-]+$/.test(file)){res.writeHead(404);return res.end();}
    try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(join(directory,file)));}catch{res.writeHead(404);res.end();}return;
  }
  res.setHeader('Content-Type','text/html');res.setHeader('Content-Security-Policy',"default-src 'none';connect-src 'none';script-src 'none'");
  const variant=new URL(req.url,'http://localhost').searchParams.get('v')||'EXAMPLE';
  const links=['https://youtube.com/premium?acc='+variant+'%2Bkeep','https://lovable.dev/lp/test?reward_code='+variant,'https://www.notion.com/redeem/linkedin?code='+variant,'https://nordvpn.com/linkedin/?code='+variant,'https://checkout.headspace.com/checkout?voucherCode=LINKEDIN-'+variant];
  res.end('<!doctype html><title>Capture fixture</title><h1>Fake source page</h1>'+links.slice(0,fixtureLinks).map(url=>'<a href="https://www.linkedin.com/safety/go/?url='+encodeURIComponent(url)+'">Reward</a>').join(''));
});source.listen(0,'127.0.0.1');await once(source,'listening');const sourceOrigin='http://127.0.0.1:'+source.address().port;
const nativeFetch=globalThis.fetch;
const raw=(path,token='',body)=>nativeFetch(origin+'/api/'+path,{headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});
const api=async(path,token='',body)=>{const r=await raw(path,token,body),data=await r.json();assert(r.ok,data.error);return data;};
let browser;
try{
  const admin=await api('login','',{username:'admin',password:'admin'});
  const alice=(await api('admin/users',admin.token,{username:'alice',password:'a'})).user;
  const auth=await api('login','',{username:'alice',password:'a'});
  await api('admin/users',admin.token,{username:'bob',password:'b'});
  await api('settings',admin.token,{pagePattern:sourceOrigin+'/perks*',enabledServices:['YouTube','Lovable','Notion','NordVPN','Headspace']});
  const workflowUrls={startUrl:sourceOrigin+'/trial',step2StartUrl:sourceOrigin+'/subscriptions',step2SecondUrl:sourceOrigin+'/refund'};
  await api('workflow-settings',admin.token,workflowUrls);
  await api('capture-script/regenerate',auth.token,{});
  const download=await raw('extension-download',auth.token);assert.equal(download.status,200);const zip=await JSZip.loadAsync(await download.arrayBuffer());
  for(const entry of Object.values(zip.files)){if(entry.dir)continue;await writeFile(join(directory,entry.name),await entry.async('nodebuffer'));}
  const connection=JSON.parse(await readFile(join(directory,'capture-connection.json'),'utf8'));
  browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH,headless:true,args:process.env.TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]});
  const website=await browser.newPage();await website.goto('about:blank');
  let nextId=1,activeId=1;const tabs=new Map([[1,website]]),store={settings:{startUrl:sourceOrigin+'/stale-local',step2StartUrl:sourceOrigin+'/stale-cancel',step2SecondUrl:sourceOrigin+'/stale-refund',managedWorkflowUrls:false}},grants=new Set(JSON.parse(await readFile(join(directory,'manifest.json'),'utf8')).host_permissions),updates=[];
  const id='a'.repeat(32),extensionOrigin='chrome-extension://'+id;
  let popup;
  const list=()=>[...tabs].filter(([,p])=>!p.isClosed()).map(([id,p])=>({id,url:p.url(),active:id===activeId,status:'complete',windowId:1}));
  globalThis.chrome={
    runtime:{id,getURL:file=>extensionOrigin+'/'+file,getManifest:()=>({version:'1.9.2'}),onMessage:event(),onStartup:event(),onInstalled:event()},
    storage:{local:{get:async key=>({[key]:structuredClone(store[key])}),set:async data=>{const changes={};for(const [k,v] of Object.entries(data)){changes[k]={newValue:v};store[k]=structuredClone(v);}if(popup&&!popup.isClosed())await popup.evaluate(changes=>{for(const fn of globalThis.__storageListeners||[])fn(changes,'local');},changes);},remove:async key=>{delete store[key];},setAccessLevel:async()=>{}}},
    permissions:{contains:async({origins})=>origins.every(o=>grants.has(o))},
    action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},alarms:{create:async()=>{},clear:async()=>{},onAlarm:event()},
    scripting:{getRegisteredContentScripts:async()=>[],registerContentScripts:async()=>{},updateContentScripts:async()=>{},unregisterContentScripts:async()=>{},executeScript:async({target,files,func,args=[]})=>{
      const page=tabs.get(target.tabId);if(!page||page.isClosed())throw new Error('Tab closed');
      const url=new URL(page.url());if(!grants.has(url.protocol+'//'+url.hostname+'/*'))throw new Error('Missing host access');
      if(files?.includes('engine.js'))return [{frameId:0}]; // no workflow clicks in the capture fixture
      if(files){for(const file of files)await page.evaluate(await readFile(join(directory,file),'utf8'));return [{frameId:0}];}
      return [{frameId:0,result:await page.evaluate(func,...args)}];
    }},
    tabs:{query:async query=>list().filter(t=>!query.active||t.id===activeId),get:async tabId=>{const tab=list().find(t=>t.id===tabId);if(!tab)throw new Error('Tab closed');return tab;},update:async(tabId,{url,active})=>{if(active)activeId=tabId;if(url){updates.push(url);await tabs.get(tabId).goto(url);}return list().find(t=>t.id===tabId);},create:async({url})=>{const page=await browser.newPage(),tabId=++nextId;tabs.set(tabId,page);activeId=tabId;await page.goto(url);return {id:tabId,url};},sendMessage:async()=>{},onRemoved:event()},
    webNavigation:{getAllFrames:async()=>[],onCommitted:event(),onDOMContentLoaded:event(),onHistoryStateUpdated:event(),onReferenceFragmentUpdated:event(),onCreatedNavigationTarget:event()}
  };
  globalThis.fetch=async(url,options)=>{
    if(String(url).startsWith(extensionOrigin+'/'))return {ok:true,json:async()=>JSON.parse(await readFile(join(directory,String(url).slice(extensionOrigin.length+1)),'utf8'))};
    return nativeFetch(url,{...options,headers:{...options?.headers,Origin:extensionOrigin}});
  };
  await import(pathToFileURL(join(directory,'background.js')).href);
  const {grabIsRunning}=await import(pathToFileURL(join(directory,'grabber.js')).href);
  const send=(type,payload={},sender={id,url:extensionOrigin+'/popup.html'})=>new Promise(resolve=>chrome.runtime.onMessage.listeners[0]({type,...payload},sender,resolve));
  popup=await browser.newPage();
  await popup.exposeFunction('__ext',async(type,payload)=>{
    if(type==='permissions'){for(const origin of payload.origins)grants.add(origin);return true;}
    if(type==='tabs')return list().filter(t=>!payload.active||t.id===activeId);
    if(type==='message')return send(payload.type,payload);
  });
  await popup.evaluateOnNewDocument(()=>{
    globalThis.__storageListeners=[];globalThis.chrome={runtime:{sendMessage:msg=>__ext('message',msg),openOptionsPage:async()=>{}},permissions:{request:payload=>__ext('permissions',payload)},tabs:{query:query=>__ext('tabs',query)},storage:{onChanged:{addListener:fn=>__storageListeners.push(fn)}}};window.close=()=>{globalThis.closeRequested=true;};
  });
  await popup.goto(sourceOrigin+'/extension/popup.html');
  await wait(()=>popup.$eval('#grab-status',n=>n.textContent.includes('alice')),'connected account');
  assert.deepEqual(await popup.$$eval('.actions .primary:not([hidden])',nodes=>nodes.map(n=>n.textContent)),['Trial','Grab Links','Cancel & Refund']);
  const started=Date.now();await popup.click('#grab-links');await wait(()=>store.grabRun?.status==='done','blank tab navigates and captures');
  assert.equal(website.url(),sourceOrigin+'/perks');assert.equal(updates.length,1);assert.equal((await api('links',auth.token)).total,5);assert.equal(store.grabRun.level,'success');assert(await website.$('#link-grabber-extension-result'));const openAndSaveMs=Date.now()-started;
  await popup.click('#grab-links');await wait(()=>store.grabRun?.status==='error','duplicate capture');assert.match(store.grabRun.message,/Duplicate/);assert.equal(updates.length,1);
  fixtureLinks=0;await website.goto(sourceOrigin+'/perks?v=EMPTY');await popup.click('#grab-links');await wait(()=>store.grabRun?.status==='error'&&/No enabled-service/.test(store.grabRun.message),'missing links');assert.equal((await api('links',auth.token)).total,5);
  // Prefer an existing matching tab over navigating the unrelated active tab.
  fixtureLinks=5;await website.goto(sourceOrigin+'/perks?v=SECOND');const unrelated=await browser.newPage();const unrelatedId=++nextId;tabs.set(unrelatedId,unrelated);await unrelated.goto(sourceOrigin+'/other');activeId=unrelatedId;
  await popup.click('#grab-links');await wait(()=>store.grabRun?.status==='done','existing matching tab reused');assert.equal(activeId,1);assert.equal(unrelated.url(),sourceOrigin+'/other');assert.equal(updates.length,1);assert.equal((await api('links',auth.token)).total,10);
  // The same connection follows live admin URL/service settings.
  await api('settings',admin.token,{pagePattern:sourceOrigin+'/newperks?v=CHANGED',enabledServices:['YouTube']});await popup.reload();await wait(()=>popup.$eval('#grab-status',n=>!n.textContent.includes('Checking')),'settings reload');await popup.click('#grab-links');await wait(()=>store.grabRun?.status==='done'&&website.url().includes('CHANGED'),'live URL update');assert.equal((await api('links',auth.token)).total,11);
  const managed=await send('GET_STATUS');assert.equal(managed.config.startUrl,workflowUrls.startUrl);assert.equal(managed.config.managedWorkflowUrls,true);
  const override=await send('SAVE_SETTINGS',{settings:{startUrl:sourceOrigin+'/unauthorized'}});assert.match(override.error,/managed/);
  const updatedUrls={...workflowUrls,startUrl:sourceOrigin+'/trial-updated'};await api('workflow-settings',admin.token,updatedUrls);
  await wait(()=>!grabIsRunning(),'capture worker released');
  const startedWorkflow=await send('START',{tabId:1,workflowNumber:1});assert(!startedWorkflow.error,startedWorkflow.error);assert.equal(store.run.config.startUrl,updatedUrls.startUrl);assert.equal(website.url(),updatedUrls.startUrl);await send('STOP');
  await popup.goto(sourceOrigin+'/extension/options.html');await popup.waitForFunction(()=>!document.querySelector('#managed-urls').hidden);for(const field of ['startUrl','step2StartUrl','step2SecondUrl'])assert.equal(await popup.$eval('#'+field,n=>n.readOnly),true);
  await popup.goto(sourceOrigin+'/extension/popup.html');await wait(()=>popup.$eval('#grab-links',n=>!n.hidden),'popup returned');
  const newHost=sourceOrigin.replace('127.0.0.1','localhost'),newHostUrls={...updatedUrls,startUrl:newHost+'/trial-new-host'};
  await api('workflow-settings',admin.token,newHostUrls);await popup.click('#start');await popup.waitForFunction(()=>document.querySelector('#error').textContent.includes('current websites'));
  assert.notEqual(store.run.status,'running');await popup.click('#start');await wait(()=>store.run?.status==='running'&&store.run.config.startUrl===newHostUrls.startUrl,'new admin hostname permission retry');assert(grants.has('http://localhost/*'));await send('STOP');
  const forbidden=await send('GRAB_LINKS',{tabId:1},{id,url:sourceOrigin+'/perks',tab:{id:1},frameId:0});assert.match(forbidden.error,/only from the extension/);
  await api('capture-scripts/revoke',auth.token,{});await popup.click('#grab-links');await wait(()=>store.grabRun?.status==='error'&&/revoked/i.test(store.grabRun.message),'old ZIP revoked');assert.equal((await api('links',auth.token)).total,11);
  const bob=await api('login','',{username:'bob',password:'b'});assert.equal((await api('links',bob.token)).total,0);
  // The web panel exposes an actual personalized ZIP download beside Copy.
  const panel=await browser.newPage();await panel.goto(origin);await panel.evaluate(token=>sessionStorage.setItem('lg-cloud-token',token),auth.token);await panel.reload();await panel.waitForFunction(()=>!document.querySelector('#regenerate-script').hidden);assert.equal(await panel.$eval('#download-extension',n=>n.hidden),true);
  await panel.click('#regenerate-script');await panel.waitForFunction(()=>!document.querySelector('#download-extension').hidden);
  const session=await panel.createCDPSession();await session.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:directory});await panel.click('#download-extension');const downloaded=join(directory,'Private_Workflow_alice_v1_9_2.zip');await wait(async()=>{try{return(await readFile(downloaded)).length>0;}catch{return false;}},'web panel ZIP download');const refreshedZip=await JSZip.loadAsync(await readFile(downloaded));const refreshed=JSON.parse(await refreshedZip.file('capture-connection.json').async('string'));assert.equal(refreshed.username,'alice');assert.notEqual(refreshed.captureKey,connection.captureKey);
  await wait(()=>panel.$eval('#extension-update',n=>n.hidden),'update card cleared after confirmed download');await panel.reload();await panel.waitForFunction(()=>!document.querySelector('#workspace').hidden&&document.querySelector('#download-extension').hidden===false);assert.equal(await panel.$eval('#extension-update',n=>n.hidden),true);assert.equal(await panel.$eval('#notice',n=>n.hidden),true);

  console.log(JSON.stringify({result:'PASS',adapter:'chrome.* test double, real Chromium DOM/network/UI',openAndSaveMs,buttonOrder:true,blankTabNavigation:true,existingTabReuse:true,duplicates:true,noLinks:true,liveAdminSettings:true,webpageCannotStart:true,revocation:true,ownerIsolation:true,panelPersonalizedZipDownload:true,adminUrlsOverrideOldLocalSettings:true,workflowStartFetchesLatest:true,managedOptionsReadOnly:true,updateCardClearsAndDoesNotRepeat:true,newAdminHostPermissionRetry:true},null,2));
}finally{
  globalThis.fetch=nativeFetch;delete globalThis.chrome;await browser?.close();cloud.closeAllConnections();source.closeAllConnections();await Promise.all([new Promise(r=>cloud.close(r)),new Promise(r=>source.close(r))]);await rm(directory,{recursive:true,force:true});
}
