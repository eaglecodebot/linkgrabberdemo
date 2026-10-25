import puppeteer from 'puppeteer-core';
import http from 'node:http';
import { once } from 'node:events';
import { existsSync,readFileSync,mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { createApp,bootstrap } from '../cloud/app.mjs';
import { MemoryRepository } from './cloud-memory.mjs';
const executablePath=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium'].find(p=>p&&existsSync(p));
if(!executablePath)throw new Error('Set CHROME_PATH or install Chrome/Edge for this optional browser test.');
const wait=async(fn,label,timeout=8000)=>{const at=performance.now();while(performance.now()-at<timeout){if(await fn())return Math.round(performance.now()-at);await new Promise(r=>setTimeout(r,25));}throw new Error('Timed out: '+label);};
const repo=new MemoryRepository();await bootstrap(repo,'admin','admin-long-password');const cloud=createApp(repo,{scriptSecret:'a3'.repeat(32)});cloud.listen(0,'127.0.0.1');await once(cloud,'listening');const origin='http://127.0.0.1:'+cloud.address().port;
const source=http.createServer((req,res)=>{
 const query=new URL(req.url,'http://localhost').searchParams,variant=query.get('variant')||'FIRST',count=Number(query.get('count')??4);
 if(query.get('csp'))res.setHeader('Content-Security-Policy',"default-src 'none';connect-src 'none';script-src 'none';style-src 'none';frame-src 'none'");
 if(query.get('coop'))res.setHeader('Cross-Origin-Opener-Policy','same-origin');
 const urls=['https://youtube.com/premium?acc='+variant,'https://lovable.dev/lp/test?reward_code='+variant,'https://www.notion.com/redeem/linkedin?code='+variant,'https://nordvpn.com/linkedin/?code='+variant];
 res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><title>Reward demo</title></head><body><h1>Fake source page</h1>'+urls.slice(0,count).map((url,i)=>'<p><a href="https://www.linkedin.com/safety/go/?url='+encodeURIComponent(url)+'">Reward '+i+'</a></p>').join('')+'</body></html>');
});source.listen(0,'127.0.0.1');await once(source,'listening');const sourceOrigin='http://127.0.0.1:'+source.address().port;
const api=async(path,token='',data)=>{const response=await fetch(origin+'/api/'+path,{headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(data===undefined?{}:{method:'POST',body:JSON.stringify(data)})});const body=await response.json();if(!response.ok)throw new Error(body.error);return body;};
const directory=mkdtempSync(join(tmpdir(),'lg-web-test-')),report={},errors=[];let browser;
try{
 const admin=await api('login','',{username:'admin',password:'admin-long-password'}),alice=(await api('admin/users',admin.token,{username:'alice',password:'alice-long-password'})).user;
 await api('admin/users',admin.token,{username:'bob',password:'bob-long-password'});
 browser=await puppeteer.launch({executablePath,headless:true,args:process.env.TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]});
 const panel=await browser.newPage();panel.on('pageerror',e=>errors.push(e.message));await panel.setViewport({width:1440,height:1000});await panel.goto(origin);
 await panel.type('#username','alice');await panel.type('#password','alice-long-password');await panel.click('#login button');await panel.waitForFunction(()=>!document.querySelector('#workspace').hidden);
 await panel.type('#page-pattern',sourceOrigin+'/perks*');await panel.click('#settings-form button');await panel.waitForFunction(()=>document.querySelector('#notice').textContent.startsWith('Page settings saved'));
 await panel.click('#generate-script');await panel.waitForFunction(()=>document.querySelector('#console-script').value.includes('captureKey'));
 let script=await panel.$eval('#console-script',node=>node.value);
 const authToken=await panel.evaluate(()=>sessionStorage.getItem('lg-cloud-token'));assert(!script.includes(authToken));
 await panel.reload();await panel.waitForFunction(()=>document.querySelector('#console-script').value.includes('captureKey'));assert.equal(await panel.$eval('#console-script',n=>n.value),script);
 assert.equal(await panel.evaluate(()=>getComputedStyle(document.documentElement).colorScheme),'dark');
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));let copied='',popups=[];page.on('popup',p=>popups.push(p));
 const cdp=await page.createCDPSession();await cdp.send('Runtime.enable');cdp.on('Runtime.inspectRequested',event=>{if(typeof event.object?.value==='string')copied=event.object.value;});
 const run=()=>cdp.send('Runtime.evaluate',{expression:script,includeCommandLineAPI:true,userGesture:true,returnByValue:true});
 const level=()=>page.$eval('#link-grabber-result-v5',n=>n.dataset.level).catch(()=>null);
 await page.goto(sourceOrigin+'/perks');const start=performance.now();await run();await wait(async()=>await level()==='success','direct save');report.directSaveMs=Math.round(performance.now()-start);assert.equal((await api('links',authToken)).total,4);
 await run();await wait(async()=>await level()==='error','duplicate result');assert.match(await page.$eval('#link-grabber-result-v5',n=>n.textContent),/Duplicate links found/);assert.equal((await api('links',authToken)).total,4);
 // The delayed fourth link should be accepted before the three-second deadline.
 await page.goto(sourceOrigin+'/perks?variant=DELAYED&count=3');await page.evaluate(()=>setTimeout(()=>{const a=document.createElement('a');a.href='https://nordvpn.com/linkedin/?code=DELAYED';document.body.append(a);},2000));await run();await wait(async()=>await level()==='success','delayed fourth',4000);assert.equal((await api('links',authToken)).total,8);
 await page.goto(sourceOrigin+'/perks?count=0');const missingAt=performance.now();await run();await wait(async()=>await level()==='error','missing links',4000);report.noLinksMs=Math.round(performance.now()-missingAt);assert.match(await page.$eval('#link-grabber-result-v5',n=>n.textContent),/No matching links/);assert.equal((await api('links',authToken)).total,8);
 await page.goto(sourceOrigin+'/perks?count=1');await run();await wait(async()=>await level()==='error','partial page',4000);assert.match(await page.$eval('#link-grabber-result-v5',n=>n.textContent),/Only 1 of 4/);
 // Strict source CSP blocks fetch/frames. Force a blocked automatic popup, then
 // use an actual click to open the save window and return the confirmed result.
 await page.goto(sourceOrigin+'/perks?variant=POPUP&csp=1');await page.evaluate(()=>{window.savedOpen=window.open;window.open=()=>null;});await run();await wait(()=>page.$eval('#link-grabber-result-v5',n=>n.textContent.includes('browser blocked')),'popup fallback prompt');
 await page.evaluate(()=>window.open=window.savedOpen);await page.evaluate(()=>[...document.querySelectorAll('#link-grabber-result-v5 button')].find(b=>b.textContent==='Open save window').id='open-save');await page.click('#open-save');
 await wait(async()=>await level()==='success','popup result on original page');assert.equal((await api('links',authToken)).total,12);report.strictCspPopup='PASS';
 // COOP can sever window.opener: the save window must still save and show the
 // result itself, without claiming success on a source page it cannot message.
 await page.goto(sourceOrigin+'/perks?variant=COOP&csp=1&coop=1');const before=popups.length;await run();
 await wait(async()=>popups.length>before||await page.$eval('#link-grabber-result-v5',n=>n.textContent.includes('browser blocked')),'COOP window or prompt');
 if(popups.length===before){await page.evaluate(()=>[...document.querySelectorAll('#link-grabber-result-v5 button')].find(b=>b.textContent==='Open save window').id='open-save');await page.click('#open-save');}
 await wait(()=>popups.length>before,'COOP popup created');const saveWindow=popups.at(-1);await saveWindow.waitForFunction(()=>document.body.dataset.result==='success');
 assert.equal(await saveWindow.evaluate(()=>location.hash),'');assert.equal(await saveWindow.evaluate(()=>window.opener===null),true);assert.equal((await api('links',authToken)).total,16);assert.equal(await level(),'info');await saveWindow.close();report.coopFallback='PASS';
 // If both direct requests and popups are unavailable, the existing Console
 // copy helper hands a packet to the authenticated web-panel import form.
 await page.goto(sourceOrigin+'/perks?variant=MANUAL&csp=1');await page.evaluate(()=>window.open=()=>null);await run();await wait(()=>page.$eval('#link-grabber-result-v5',n=>n.textContent.includes('browser blocked')),'manual prompt');
 await page.evaluate(()=>[...document.querySelectorAll('#link-grabber-result-v5 button')].find(b=>b.textContent==='Copy capture packet').id='copy-packet');await page.click('#copy-packet');await wait(()=>copied.startsWith('LG_WEB_V5:'),'native copy packet');
 await panel.$eval('#manual-capture',(n,text)=>{n.value=text;},copied);await panel.evaluate(()=>document.querySelector('#manual-capture').closest('details').open=true);await panel.click('#import-capture');await wait(async()=>(await api('links',authToken)).total===20,'web manual import');report.manualFallback='PASS';
 await panel.reload();await panel.waitForFunction(()=>document.querySelector('#count').textContent.startsWith('20 '));
 assert.equal(await panel.$$eval('.service-section',nodes=>nodes.length),4);for(const service of ['youtube','lovable','notion','nordvpn'])assert.equal(await panel.$$eval('#links-'+service+' .reward-url',nodes=>nodes.length),5);
 const downloadSession=await panel.createCDPSession();await downloadSession.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:directory});await panel.click('#export-youtube');
 await wait(async()=>(await api('exports',authToken)).exports.length===1,'section snapshot');const snapshot=(await api('exports',authToken)).exports[0];await wait(()=>existsSync(join(directory,snapshot.filename)),'TXT downloaded');assert.equal(readFileSync(join(directory,snapshot.filename),'utf8').trim().split(/\r?\n/).length,5);assert(snapshot.filename.startsWith('YouTube_'));
 if(process.env.TEST_SCREENSHOTS==='1')await panel.screenshot({path:'/workspace/scratch/d75d63e90043/web-panel-v5.png',fullPage:true});
 await panel.setViewport({width:390,height:844});assert(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const adminPanel=await browser.newPage();await adminPanel.goto(origin);await adminPanel.type('#username','admin');await adminPanel.type('#password','admin-long-password');await adminPanel.click('#login button');await adminPanel.waitForSelector('#history-user option');await adminPanel.select('#history-user',alice.id);await adminPanel.select('#status','all');await adminPanel.waitForFunction(()=>document.querySelector('#count').textContent.startsWith('20 '));assert.equal(await adminPanel.evaluate(()=>getComputedStyle(document.documentElement).colorScheme),'dark');
 const bob=(await api('admin/users',admin.token)).users.find(u=>u.username==='bob');await adminPanel.select('#history-user',bob.id);await adminPanel.waitForFunction(()=>document.querySelector('#count').textContent.startsWith('0 '));
 // Same byte-for-byte script reads new URL/minimum/label settings on each run.
 await api('settings',authToken,{pagePattern:sourceOrigin+'/changed*',minLinks:1,label:'Updated default'});
 assert.equal((await api('capture-script',authToken,{})).script,script);
 await page.goto(sourceOrigin+'/changed?variant=UPDATED&count=1');await run();await wait(async()=>await level()==='success','updated page and minimum');assert.equal((await api('links',authToken)).total,21);
 assert.match(await page.$eval('#link-grabber-result-v5',n=>n.textContent),/Saving to: alice/);
 assert.equal((await api('links',authToken)).rows.find(r=>r.url.includes('UPDATED')).profile_name,'Updated default');
 await page.goto(sourceOrigin+'/perks?variant=WRONG&count=1');await run();await wait(async()=>await level()==='error','old page rejected after settings change');assert.equal((await api('links',authToken)).total,21);
 await page.goto(sourceOrigin+'/changed?variant=DYNAMIC_POPUP&count=1&csp=1');const popupStart=popups.length;await run();
 await wait(async()=>popups.length>popupStart||await page.$eval('#link-grabber-result-v5',n=>n.textContent.includes('browser blocked')),'dynamic config popup');
 if(popups.length===popupStart){await page.evaluate(()=>[...document.querySelectorAll('#link-grabber-result-v5 button')].find(b=>b.textContent==='Open save window').id='open-save');await page.click('#open-save');}
 await wait(async()=>await level()==='success','updated minimum through popup');assert.equal((await api('links',authToken)).total,22);
 report.dynamicSettingsWithoutNewScript='PASS';
 // A different valid user's script must identify that owner even while the panel
 // is still logged in as Alice. It must never silently reassign the destination.
 const bobAuth=await api('login','',{username:'bob',password:'bob-long-password'});await api('settings',bobAuth.token,{pagePattern:sourceOrigin+'/changed*',minLinks:1});
 const bobScript=(await api('capture-script',bobAuth.token,{})).script;assert.notEqual(bobScript,script);
 await page.goto(sourceOrigin+'/changed?variant=BOB&count=1');await cdp.send('Runtime.evaluate',{expression:bobScript,includeCommandLineAPI:true,userGesture:true});await wait(async()=>await level()==='success','Bob own script');
 assert.match(await page.$eval('#link-grabber-result-v5',n=>n.textContent),/Saving to: bob/);assert.equal((await api('links',bobAuth.token)).total,1);assert.equal((await api('links',authToken)).total,22);
 if(process.env.TEST_SCREENSHOTS==='1')await page.screenshot({path:'/workspace/scratch/d75d63e90043/owner-banner-v5.png'});
 report.correctOwnerInNotifications='PASS';
 // Admin-only revocation keeps history and lets the enabled owner copy a fresh
 // replacement. The old script remains invalid after the replacement is issued.
 await adminPanel.evaluate(()=>{const row=[...document.querySelectorAll('#users .profile-item')].find(n=>n.querySelector('strong').textContent.includes('alice'));[...row.querySelectorAll('button')].find(b=>b.textContent==='Revoke script').click();});
 await adminPanel.waitForFunction(()=>document.querySelector('#notice').textContent.startsWith('Capture scripts revoked for alice'));
 await page.goto(sourceOrigin+'/changed?variant=ADMIN_REVOKED&count=1');await run();await wait(async()=>await level()==='error','admin revoked old script');
 await panel.click('#generate-script');await panel.waitForFunction(old=>document.querySelector('#console-script').value!==old,{},script);
 const replacement=await panel.$eval('#console-script',n=>n.value);assert.notEqual(replacement,script);
 await run();await wait(async()=>await level()==='error','old script still invalid after replacement');
 script=replacement;await run();await wait(async()=>await level()==='success','replacement script');assert.equal((await api('links',authToken)).total,23);
 await panel.click('#revoke-scripts');await panel.waitForFunction(()=>document.querySelector('#notice').textContent.includes('have been revoked'));await page.goto(sourceOrigin+'/changed?variant=REVOKED&count=1');await run();await wait(async()=>await level()==='error','revoked key error');assert.equal((await api('links?status=all',authToken)).total,23);
 report.adminAndSelfRevocation='PASS';
 assert.deepEqual(errors,[]);report.darkPanelsExportsAndPrivacy='PASS';report.result='PASS';console.log(JSON.stringify(report,null,2));
}finally{if(browser)await browser.close();source.closeAllConnections();cloud.closeAllConnections();await Promise.all([new Promise(r=>source.close(r)),new Promise(r=>cloud.close(r))]);rmSync(directory,{recursive:true,force:true});}
