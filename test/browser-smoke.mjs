import {chromePath} from '../src/collector.mjs';
import puppeteer from 'puppeteer-core';
import {createApp,bootstrap} from '../cloud/app.mjs';
import {MemoryRepository} from './cloud-memory.mjs';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import assert from 'node:assert/strict';
const executablePath=chromePath();if(!executablePath)throw new Error('Install Chrome/Edge or set CHROME_PATH.');
const data=mkdtempSync(join(tmpdir(),'lg-browser-v2-'));
const origin='http://127.0.0.1:18765';
const repo=new MemoryRepository();await bootstrap(repo,'admin','admin-long-password');
const cloud=createApp(repo);cloud.listen(0,'127.0.0.1');await once(cloud,'listening');const cloudOrigin='http://127.0.0.1:'+cloud.address().port;
const server=spawn(process.execPath,['src/server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'18765',LINK_GRABBER_DATA:data,CHROME_PATH:executablePath,TEST_HEADLESS:'1',TEST_NO_SANDBOX:process.env.TEST_NO_SANDBOX||'0'},stdio:['ignore','pipe','pipe']});
let logs='',key,browser;server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
const api=async(path,payload)=>{const r=await fetch(origin+'/api/'+path,payload===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-App-Key':key},body:JSON.stringify(payload)});const b=await r.json();if(!r.ok)throw new Error(b.error);return b;};
const wait=async(fn,label,timeout=7000)=>{const start=performance.now();while(performance.now()-start<timeout){if(await fn())return Math.round(performance.now()-start);await new Promise(r=>setTimeout(r,40));}throw new Error('Timed out: '+label);};
const report={};
try{
 await wait(async()=>{try{key=(await api('state')).appKey;return true;}catch{return false;}},'local start');
 await api('demo',{});report.initialFourMs=await wait(async()=>(await api('links')).total===4,'four decoded links',3000);
 const port=readFileSync(join(data,'demo-browser','DevToolsActivePort'),'utf8').split('\n')[0];
 const version=await(await fetch('http://127.0.0.1:'+port+'/json/version')).json();
 browser=await puppeteer.connect({browserWSEndpoint:version.webSocketDebuggerUrl,defaultViewport:null});
 const page=(await browser.pages()).find(p=>p.url().startsWith(origin+'/demo'));assert(await page.$('#__local_link_grabber_notification'));
 let links=await api('links');assert(links.rows.every(r=>!r.url.includes('safety/go')));assert(links.rows.some(r=>r.url==='https://youtube.com/premium?acc=DEMO_YOUTUBE'));
 await page.evaluate(()=>{for(let i=0;i<20;i++){const a=document.createElement('a');a.href='https://www.linkedin.com/safety/go/?url='+encodeURIComponent('https://youtube.com/premium?acc=DEMO_BULK_'+i);a.textContent='Bulk';document.body.append(a);}});
 report.twentyDecodedLinksMs=await wait(async()=>(await api('links')).total===24,'twenty new links',3000);
 await page.evaluate(()=>{const a=document.createElement('a');a.href='https://youtube.com/premium?acc=DEMO_YOUTUBE';a.textContent='Duplicate direct URL';document.body.append(a);});
 await new Promise(r=>setTimeout(r,1100));assert.equal((await api('links')).total,24);
 await api('pause',{paused:true});await page.evaluate(()=>{const a=document.createElement('a');a.href='https://youtube.com/premium?acc=DEMO_PAUSED';a.textContent='Paused';document.body.append(a);});
 await new Promise(r=>setTimeout(r,1100));assert.equal((await api('links')).total,24);await api('pause',{paused:false});
 report.resumeMs=await wait(async()=>(await api('links')).total===25,'resume',3000);
 const panel=await browser.newPage();await panel.setViewport({width:1440,height:1000});await panel.goto(origin);await panel.waitForFunction(()=>document.querySelector('#total').textContent==='25');
 await panel.setViewport({width:390,height:844,isMobile:true});assert(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await panel.setViewport({width:1440,height:1000});
 if(process.env.TEST_SCREENSHOTS==='1')await panel.screenshot({path:'/workspace/scratch/d75d63e90043/panel-v2.png',fullPage:true});
 // Stop the demo before changing panel users. The panel tab shares the demo browser.
 await panel.close();await browser.disconnect();browser=null;let s=(await api('state')).sessions.find(s=>s.state==='running');await api('stop',{id:s.id});
 const cloudReq=async(path,token,payload)=>{const r=await fetch(cloudOrigin+'/api/'+path,{headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},...(payload===undefined?{}:{method:'POST',body:JSON.stringify(payload)})});return r.json();};
 const admin=await cloudReq('login','',{username:'admin',password:'admin-long-password'});
 const alice=(await cloudReq('admin/users',admin.token,{username:'alice',password:'alice-long-password'})).user;
 await cloudReq('admin/users',admin.token,{username:'bob',password:'bob-long-password'});
 await api('cloud/login',{serverUrl:cloudOrigin,username:'alice',password:'alice-long-password'});
 assert.equal((await api('links')).total,0);
 await api('accounts',{name:'Alice GoLogin',token:'fake-alice-token'});
 await api('demo',{});await wait(async()=>(await api('cloud/links')).total===4,'cloud sync',12000);
 const snapshot=(await api('export-txt',{status:'new'})).export;assert.equal(snapshot.urls.length,4);assert(snapshot.filename.endsWith('.txt'));
 await wait(async()=>(await api('cloud/exports')).exports.length===1,'export history sync');
 assert.equal((await api('links?status=new')).total,0);assert.equal((await api('links?status=exported')).total,4);
 s=(await api('state')).sessions.find(s=>s.state==='running');await api('stop',{id:s.id});await api('cloud/logout',{});
 await api('cloud/login',{serverUrl:cloudOrigin,username:'bob',password:'bob-long-password'});
 assert.equal((await api('state')).accounts.length,0);assert.equal((await api('links')).total,0);assert.equal((await api('cloud/links')).total,0);
 const aliceHistory=await cloudReq('links?userId='+alice.id,admin.token);assert.equal(aliceHistory.total,4);

 const web=await puppeteer.launch({executablePath,headless:true,args:process.env.TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]});
 try { const dashboard=await web.newPage();await dashboard.setViewport({width:1440,height:1000});await dashboard.goto(cloudOrigin);await dashboard.type('#username','admin');await dashboard.type('#password','admin-long-password');await dashboard.click('#login button');await dashboard.waitForFunction(()=>!document.querySelector('#workspace').hidden);await dashboard.select('#status','all');await dashboard.select('#history-user',alice.id);await dashboard.waitForFunction(()=>document.querySelector('#links').textContent.includes('Notion'));
 assert.equal(await dashboard.$$eval('#links tr',rows=>rows.length),4);
 if(process.env.TEST_SCREENSHOTS==='1')await dashboard.screenshot({path:'/workspace/scratch/d75d63e90043/cloud-panel-v2.png',fullPage:true});
 await dashboard.setViewport({width:390,height:844,isMobile:true});assert(await dashboard.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 } finally {await web.close();}
 const exited=once(server,'exit');await api('shutdown',{});await exited;
 report.cloudAndUserIsolation='PASS';report.result='PASS';console.log(JSON.stringify(report,null,2));
}catch(e){console.error(logs);try{const s=await api('state');console.error(JSON.stringify({cloud:s.cloud,sessions:s.sessions,localLinks:await api('links')},null,2));}catch{}throw e;}finally{
 if(browser)await browser.disconnect();if(server.exitCode===null){const exited=once(server,'exit');server.kill('SIGTERM');await exited;}
 cloud.closeAllConnections();await new Promise(r=>cloud.close(r));rmSync(data,{recursive:true,force:true});
}
