import puppeteer from 'puppeteer-core';
import ExcelJS from 'exceljs';
import http from 'node:http';
import { once } from 'node:events';
import { existsSync,readFileSync,mkdtempSync,rmSync,unlinkSync } from 'node:fs';
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
 const urls=['https://youtube.com/premium?acc='+variant,'https://lovable.dev/lp/test?reward_code='+variant,'https://www.notion.com/redeem/linkedin?code='+variant,'https://nordvpn.com/linkedin/?code='+variant,'https://checkout.headspace.com/checkout?voucherCode=LINKEDIN-'+variant];
 res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><title>Reward demo</title></head><body><h1>Fake source page</h1>'+urls.slice(0,count).map((url,i)=>'<p><a href="https://www.linkedin.com/safety/go/?url='+encodeURIComponent(url)+'">Reward '+i+'</a></p>').join('')+'</body></html>');
});source.listen(0,'127.0.0.1');await once(source,'listening');const sourceOrigin='http://127.0.0.1:'+source.address().port;
const api=async(path,token='',data)=>{const response=await fetch(origin+'/api/'+path,{headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(data===undefined?{}:{method:'POST',body:JSON.stringify(data)})});const body=await response.json();if(!response.ok)throw new Error(body.error);return body;};
const directory=mkdtempSync(join(tmpdir(),'lg-web-test-')),report={},errors=[];let browser;
try{
 const admin=await api('login','',{username:'admin',password:'admin-long-password'}),alice=(await api('admin/users',admin.token,{username:'alice',password:'alice-long-password'})).user;
 await api('admin/users',admin.token,{username:'bob',password:'bob-long-password'});
 await api('settings',admin.token,{pagePattern:sourceOrigin+'/perks*'});
 browser=await puppeteer.launch({executablePath,headless:true,args:process.env.TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]});
 await browser.defaultBrowserContext().overridePermissions(origin,['clipboard-read','clipboard-write','clipboard-sanitized-write']);
 const panel=await browser.newPage();panel.on('pageerror',e=>errors.push(e.message));await panel.setViewport({width:1440,height:1000});await panel.goto(origin);
 await panel.type('#username','alice');await panel.type('#password','alice-long-password');await panel.click('#login button');await panel.waitForFunction(()=>!document.querySelector('#workspace').hidden);
 assert.equal(await panel.$eval('#admin',n=>n.hidden),true);assert.equal(await panel.$eval('#configured-page',n=>n.textContent),sourceOrigin+'/perks*');
 assert.equal(await panel.$('#minimum-links'),null);
 await panel.waitForFunction(()=>document.querySelectorAll('.service-tab:not([hidden])').length===4);assert.equal(await panel.$eval('#tab-headspace',n=>n.hidden),true);await panel.click('#tab-youtube');await panel.keyboard.press('End');assert.equal(await panel.$eval('#tab-nordvpn',n=>n.getAttribute('aria-selected')),'true');await panel.click('#tab-youtube');
 const forbidden=await panel.evaluate(async()=>{const r=await fetch('/api/settings',{method:'POST',headers:{Authorization:'Bearer '+sessionStorage.getItem('lg-cloud-token'),'Content-Type':'application/json'},body:JSON.stringify({pagePattern:'https://evil.test/*',enabledServices:['Headspace']})});return r.status;});assert.equal(forbidden,403);
 await panel.waitForFunction(()=>!document.querySelector('#regenerate-script').hidden);assert.equal(repo.permanentScripts.size,0);await panel.click('#regenerate-script');await panel.waitForFunction(()=>document.querySelector('#console-script').value.includes('captureKey'));await panel.click('#generate-script');
 let script=await panel.$eval('#console-script',node=>node.value);
 const authToken=await panel.evaluate(()=>sessionStorage.getItem('lg-cloud-token'));assert(!script.includes(authToken));
 assert.equal(await panel.$$eval('#capture-setup button',nodes=>nodes.filter(n=>n.textContent==='Copy my script').length),1);assert.equal(await panel.$('#copy-script'),null);
 assert.equal(await panel.$eval('#script-area',n=>n.tagName),'DETAILS');assert.equal(await panel.$eval('#script-area',n=>n.open),false);
 await panel.click('#notice-dismiss');assert.equal(await panel.$eval('#notice',n=>n.hidden),true);
 await panel.click('#generate-script');await panel.waitForFunction(()=>!document.querySelector('#notice').hidden);await panel.waitForFunction(()=>document.querySelector('#notice').hidden,{timeout:5000});
 await panel.evaluate(()=>note('Temporary warning','warning'));await panel.waitForFunction(()=>document.querySelector('#notice').hidden,{timeout:7000});
 await panel.evaluate(()=>{document.querySelector('#manual-capture').closest('details').open=true;document.querySelector('#manual-capture').value='invalid';});await panel.click('#import-capture');await panel.waitForFunction(()=>!document.querySelector('#notice').hidden&&document.querySelector('#notice').dataset.level==='error');await panel.waitForFunction(()=>document.querySelector('#notice').hidden,{timeout:9000});
 // Replacing a notice cancels its previous timer; the new one gets its own time.
 await panel.evaluate(()=>{note('First message');setTimeout(()=>note('Replacement warning','warning'),2500);});await panel.waitForFunction(()=>document.querySelector('#notice-text').textContent==='Replacement warning');await new Promise(r=>setTimeout(r,1800));assert.equal(await panel.$eval('#notice',n=>n.hidden),false);await panel.click('#notice-dismiss');assert.equal(await panel.$eval('#notice',n=>n.hidden),true);
 await panel.evaluate(()=>document.querySelector('#manual-capture').closest('details').open=false);
 assert.equal(await panel.evaluate(()=>navigator.clipboard.readText()),script);
 await panel.evaluate(()=>{window.originalClipboardWrite=navigator.clipboard.writeText;navigator.clipboard.writeText=async()=>{throw new Error('Test clipboard denial');};});await panel.click('#generate-script');await panel.waitForFunction(()=>document.querySelector('#script-area').open&&document.querySelector('#notice-text').textContent.includes('Ctrl+C'));assert.equal(await panel.$eval('#console-script',n=>n.value),script);await panel.evaluate(()=>{navigator.clipboard.writeText=window.originalClipboardWrite;document.querySelector('#script-area').open=false;});await panel.click('#notice-dismiss');
 report.compactSingleCopyCard='PASS';report.allToastLevelsAutoDismiss='PASS';report.replacementTimerAndManualDismiss='PASS';report.clipboardAndManualCopyFallback='PASS';

 // Hold session restoration and watch the DOM for even a brief login flash.
 await panel.evaluateOnNewDocument(()=>{window.loginFlashed=false;new MutationObserver(()=>{const login=document.getElementById('login-card');if(login&&!login.hidden&&getComputedStyle(login).display!=='none')window.loginFlashed=true;}).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','style','class']});});
 await panel.setRequestInterception(true);let pendingMe;
 const intercept=request=>{if(request.url()===origin+'/api/me')pendingMe=request;else void request.continue();};panel.on('request',intercept);
 await panel.reload({waitUntil:'domcontentloaded'});await wait(()=>!!pendingMe,'held session check');
 assert.equal(await panel.$eval('#login-card',n=>n.hidden),true);assert.equal(await panel.$eval('#auth-loading',n=>n.hidden),false);
 await pendingMe.continue();await panel.waitForFunction(()=>document.querySelector('#console-script').value.includes('captureKey'));
 assert.equal(await panel.evaluate(()=>window.loginFlashed),false);panel.off('request',intercept);await panel.setRequestInterception(false);
 assert.equal(await panel.$eval('#console-script',n=>n.value),script);report.noLoginFlash='PASS';
 assert.equal(await panel.evaluate(()=>getComputedStyle(document.documentElement).colorScheme),'dark');
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));let copied='',popups=[];page.on('popup',p=>popups.push(p));
 const cdp=await page.createCDPSession();await cdp.send('Runtime.enable');cdp.on('Runtime.inspectRequested',event=>{if(typeof event.object?.value==='string')copied=event.object.value;});
 const run=()=>cdp.send('Runtime.evaluate',{expression:script,includeCommandLineAPI:true,userGesture:true,returnByValue:true});
 const level=()=>page.$eval('#link-grabber-result-v6',n=>n.dataset.level).catch(()=>null);
 await page.goto(sourceOrigin+'/perks');const start=performance.now();await run();await wait(async()=>await level()==='success','direct save');report.directSaveMs=Math.round(performance.now()-start);assert.equal((await api('links',authToken)).total,4);
 await run();await wait(async()=>await level()==='error','duplicate result');assert.match(await page.$eval('#link-grabber-result-v6',n=>n.textContent),/Duplicate links found/);assert.equal((await api('links',authToken)).total,4);
 // The delayed fourth link should be accepted before the three-second deadline.
 await page.goto(sourceOrigin+'/perks?variant=DELAYED&count=3');await page.evaluate(()=>setTimeout(()=>{const a=document.createElement('a');a.href='https://nordvpn.com/linkedin/?code=DELAYED';document.body.append(a);},2000));await run();await wait(async()=>await level()==='success','delayed fourth',4000);assert.equal((await api('links',authToken)).total,8);
 await page.goto(sourceOrigin+'/perks?count=0');const missingAt=performance.now();await run();await wait(async()=>await level()==='error','missing links',4000);report.noLinksMs=Math.round(performance.now()-missingAt);assert.match(await page.$eval('#link-grabber-result-v6',n=>n.textContent),/No enabled-service links/);assert.equal((await api('links',authToken)).total,8);
 await page.goto(sourceOrigin+'/perks?count=1');await run();await wait(async()=>await level()==='error','partial page',4000);assert.match(await page.$eval('#link-grabber-result-v6',n=>n.textContent),/Missing required links: Lovable, Notion, NordVPN/);
 // Strict source CSP blocks fetch/frames. Force a blocked automatic popup, then
 // use an actual click to open the save window and return the confirmed result.
 await page.goto(sourceOrigin+'/perks?variant=POPUP&csp=1');await page.evaluate(()=>{window.savedOpen=window.open;window.open=()=>null;});await run();await wait(()=>page.$eval('#link-grabber-result-v6',n=>n.textContent.includes('browser blocked')),'popup fallback prompt');
 await page.evaluate(()=>window.open=window.savedOpen);await page.evaluate(()=>[...document.querySelectorAll('#link-grabber-result-v6 button')].find(b=>b.textContent==='Open save window').id='open-save');await page.click('#open-save');
 await wait(async()=>await level()==='success','popup result on original page');assert.equal((await api('links',authToken)).total,12);report.strictCspPopup='PASS';
 // COOP can sever window.opener: the save window must still save and show the
 // result itself, without claiming success on a source page it cannot message.
 await page.goto(sourceOrigin+'/perks?variant=COOP&csp=1&coop=1');const before=popups.length;await run();
 await wait(async()=>popups.length>before||await page.$eval('#link-grabber-result-v6',n=>n.textContent.includes('browser blocked')),'COOP window or prompt');
 if(popups.length===before){await page.evaluate(()=>[...document.querySelectorAll('#link-grabber-result-v6 button')].find(b=>b.textContent==='Open save window').id='open-save');await page.click('#open-save');}
 await wait(()=>popups.length>before,'COOP popup created');const saveWindow=popups.at(-1);await saveWindow.waitForFunction(()=>document.body.dataset.result==='success');
 assert.equal(await saveWindow.evaluate(()=>location.hash),'');assert.equal(await saveWindow.evaluate(()=>window.opener===null),true);assert.equal((await api('links',authToken)).total,16);assert.equal(await level(),'info');await saveWindow.close();report.coopFallback='PASS';
 // If both direct requests and popups are unavailable, the existing Console
 // copy helper hands a packet to the authenticated web-panel import form.
 await page.goto(sourceOrigin+'/perks?variant=MANUAL&csp=1');await page.evaluate(()=>window.open=()=>null);await run();await wait(()=>page.$eval('#link-grabber-result-v6',n=>n.textContent.includes('browser blocked')),'manual prompt');
 await page.evaluate(()=>[...document.querySelectorAll('#link-grabber-result-v6 button')].find(b=>b.textContent==='Copy capture packet').id='copy-packet');await page.click('#copy-packet');await wait(()=>copied.startsWith('LG_WEB_V6:'),'native copy packet');
 await panel.$eval('#manual-capture',(n,text)=>{n.value=text;},copied);await panel.evaluate(()=>document.querySelector('#manual-capture').closest('details').open=true);await panel.click('#import-capture');await wait(async()=>(await api('links',authToken)).total===20,'web manual import');report.manualFallback='PASS';
 await panel.reload();await panel.waitForFunction(()=>document.querySelector('#count').textContent.startsWith('20 '));
 assert.equal(await panel.$$eval('.service-section',nodes=>nodes.length),5);assert.equal(await panel.$$eval('.service-section:not([hidden])',nodes=>nodes.length),1);
 for(const service of ['youtube','lovable','notion','nordvpn']){await panel.click('#tab-'+service);assert.equal(await panel.$eval('#section-'+service,n=>n.hidden),false);assert.equal(await panel.$eval('#tab-'+service,n=>n.textContent),({youtube:'YouTube',lovable:'Lovable',notion:'Notion',nordvpn:'NordVPN',headspace:'Headspace'}[service])+' ('+(service==='headspace'?0:5)+')');}
 await panel.click('#tab-youtube');report.serviceTabsAndCounts='PASS';for(const service of ['youtube','lovable','notion','nordvpn'])assert.equal(await panel.$$eval('#links-'+service+' .reward-url',nodes=>nodes.length),5);
 const downloadSession=await panel.createCDPSession();await downloadSession.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:directory});await panel.click('#export-youtube');
 await wait(async()=>(await api('exports',authToken)).exports.length===1,'section snapshot');const snapshot=(await api('exports',authToken)).exports[0];await wait(()=>existsSync(join(directory,snapshot.filename)),'TXT downloaded');assert.equal(readFileSync(join(directory,snapshot.filename),'utf8').trim().split(/\r?\n/).length,5);assert(snapshot.filename.startsWith('YouTube_'));
 if(process.env.TEST_SCREENSHOTS==='1')await panel.screenshot({path:'/workspace/scratch/d75d63e90043/web-panel-v6.png',fullPage:true});
 await panel.setViewport({width:390,height:844});assert(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const adminPanel=await browser.newPage();await adminPanel.goto(origin);await adminPanel.type('#username','admin');await adminPanel.type('#password','admin-long-password');await adminPanel.click('#login button');await adminPanel.waitForSelector('#history-user option');await adminPanel.select('#history-user',alice.id);await adminPanel.select('#status','all');await adminPanel.waitForFunction(()=>document.querySelector('#count').textContent.startsWith('20 '));assert.equal(await adminPanel.evaluate(()=>getComputedStyle(document.documentElement).colorScheme),'dark');
 const bob=(await api('admin/users',admin.token)).users.find(u=>u.username==='bob');await adminPanel.select('#history-user',bob.id);await adminPanel.waitForFunction(()=>document.querySelector('#count').textContent.startsWith('0 '));
 // Empty disabled tabs follow saved settings; switching off the selected tab
 // selects a visible service and keyboard navigation skips the hidden one.
 assert.equal(await adminPanel.$eval('#tab-headspace',n=>n.hidden),true);
 await adminPanel.evaluate(()=>document.querySelector('input[name="service"][value="Headspace"]').checked=true);await adminPanel.click('#settings-form button');await adminPanel.waitForFunction(()=>!document.querySelector('#tab-headspace').hidden);await adminPanel.click('#tab-headspace');
 await adminPanel.evaluate(()=>document.querySelector('input[name="service"][value="Headspace"]').checked=false);await adminPanel.click('#settings-form button');await adminPanel.waitForFunction(()=>document.querySelector('#tab-headspace').hidden);assert.equal(await adminPanel.$eval('#tab-youtube',n=>n.getAttribute('aria-selected')),'true');assert.equal(await adminPanel.$eval('#section-headspace',n=>n.hidden),true);
 report.disabledEmptyTabsAndActiveFallback='PASS';
 // Admin changes the shared URL and selected services through the panel.
 await adminPanel.$eval('#page-pattern',(n,value)=>{n.value=value;},sourceOrigin+'/changed*');
 await adminPanel.evaluate(()=>{for(const n of document.querySelectorAll('input[name="service"]'))n.checked=n.value==='YouTube';});
 await adminPanel.click('#settings-form button');await adminPanel.waitForFunction(()=>document.querySelector('#notice').textContent.startsWith('Capture settings saved'));
 assert.deepEqual((await api('settings',authToken)).settings.enabledServices,['YouTube']);
 assert.equal((await api('capture-script',authToken,{})).script,script);
 await page.goto(sourceOrigin+'/changed?variant=UPDATED&count=1');await run();await wait(async()=>await level()==='success','updated page and services');assert.equal((await api('links',authToken)).total,21);
 assert.match(await page.$eval('#link-grabber-result-v6',n=>n.textContent),/Saving to: alice/);
 assert.equal((await api('links',authToken)).rows.find(r=>r.url.includes('UPDATED')).profile_name,'Browser capture');
 await page.goto(sourceOrigin+'/perks?variant=WRONG&count=1');await run();await wait(async()=>await level()==='error','old page rejected after settings change');assert.equal((await api('links',authToken)).total,21);
 await page.goto(sourceOrigin+'/changed?variant=DYNAMIC_POPUP&count=1&csp=1');const popupStart=popups.length;await run();
 await wait(async()=>popups.length>popupStart||await page.$eval('#link-grabber-result-v6',n=>n.textContent.includes('browser blocked')),'dynamic config popup');
 if(popups.length===popupStart){await page.evaluate(()=>[...document.querySelectorAll('#link-grabber-result-v6 button')].find(b=>b.textContent==='Open save window').id='open-save');await page.click('#open-save');}
 await wait(async()=>await level()==='success','updated selected service through popup');assert.equal((await api('links',authToken)).total,22);
 report.dynamicSettingsWithoutNewScript='PASS';
 // A different valid user's script must identify that owner even while the panel
 // is still logged in as Alice. It must never silently reassign the destination.
 const bobAuth=await api('login','',{username:'bob',password:'bob-long-password'});
 const bobScript=(await api('capture-script/regenerate',bobAuth.token,{})).script;assert.notEqual(bobScript,script);
 await page.goto(sourceOrigin+'/changed?variant=BOB&count=1');await cdp.send('Runtime.evaluate',{expression:bobScript,includeCommandLineAPI:true,userGesture:true});await wait(async()=>await level()==='success','Bob own script');
 assert.match(await page.$eval('#link-grabber-result-v6',n=>n.textContent),/Saving to: bob/);assert.equal((await api('links',bobAuth.token)).total,1);assert.equal((await api('links',authToken)).total,22);
 if(process.env.TEST_SCREENSHOTS==='1')await page.screenshot({path:'/workspace/scratch/d75d63e90043/owner-banner-v6.png'});
 report.correctOwnerInNotifications='PASS';
 // Admin-only revocation keeps history and lets the enabled owner copy a fresh
 // replacement. The old script remains invalid after the replacement is issued.
 await adminPanel.evaluate(()=>{const row=[...document.querySelectorAll('#users .profile-item')].find(n=>n.querySelector('strong').textContent.includes('alice'));[...row.querySelectorAll('button')].find(b=>b.textContent==='Revoke script').click();});
 await adminPanel.waitForFunction(()=>document.querySelector('#notice').textContent.startsWith('Capture scripts revoked for alice'));
 await page.goto(sourceOrigin+'/changed?variant=ADMIN_REVOKED&count=1');await run();await wait(async()=>await level()==='error','admin revoked old script');
 await panel.waitForFunction(()=>!document.querySelector('#regenerate-script').hidden&&document.querySelector('#script-area').hidden);assert.match(await panel.$eval('#script-status-reason',n=>n.textContent),/administrator revoked/);assert.equal(await panel.$eval('#console-script',n=>n.value),'');
 await panel.reload();await panel.waitForFunction(()=>!document.querySelector('#regenerate-script').hidden);assert.equal(await panel.$eval('#console-script',n=>n.value),'');
 await panel.click('#regenerate-script');await panel.waitForFunction(()=>!document.querySelector('#script-area').hidden);
 const replacement=await panel.$eval('#console-script',n=>n.value);assert.notEqual(replacement,script);
 await run();await wait(async()=>await level()==='error','old script still invalid after replacement');
 script=replacement;await run();await wait(async()=>await level()==='success','replacement script');assert.equal((await api('links',authToken)).total,23);
 await panel.click('#revoke-scripts');await panel.waitForFunction(()=>document.querySelector('#notice').textContent.includes('have been revoked'));await page.goto(sourceOrigin+'/changed?variant=REVOKED&count=1');await run();await wait(async()=>await level()==='error','revoked key error');assert.equal((await api('links?status=all',authToken)).total,23);
 await panel.reload();await panel.waitForFunction(()=>!document.querySelector('#regenerate-script').hidden);assert.match(await panel.$eval('#script-status-reason',n=>n.textContent),/You revoked/);assert.equal(await panel.$eval('#console-script',n=>n.value),'');
 report.adminAndSelfRevocation='PASS';report.explicitRegenerationAndPersistedReason='PASS';
 // Reuse Bob's script with a new admin service selection: no recopy is needed.
 await api('settings',admin.token,{pagePattern:sourceOrigin+'/changed*',enabledServices:['Headspace']});
 await page.goto(sourceOrigin+'/changed?variant=HEADSPACE&count=5');await cdp.send('Runtime.evaluate',{expression:bobScript,includeCommandLineAPI:true,userGesture:true});await wait(async()=>await level()==='success','only selected Headspace saved');
 const bobRows=(await api('links',bobAuth.token)).rows;assert.equal(bobRows.length,2);assert.equal(bobRows.filter(r=>r.service==='Headspace').length,1);report.headspaceAndDisabledFiltering='PASS';
 await cdp.send('Runtime.evaluate',{expression:bobScript,includeCommandLineAPI:true,userGesture:true});await wait(async()=>await level()==='error','Headspace duplicate');assert.match(await page.$eval('#link-grabber-result-v6',n=>n.textContent),/Duplicate links found/);assert.equal((await api('links',bobAuth.token)).total,2);report.headspaceDuplicate='PASS';
 await api('settings',admin.token,{pagePattern:sourceOrigin+'/changed*',enabledServices:['YouTube']});
 await page.goto(sourceOrigin+'/changed?variant='+('LONG'.repeat(100))+'&count=1');await cdp.send('Runtime.evaluate',{expression:bobScript,includeCommandLineAPI:true,userGesture:true});await wait(async()=>await level()==='success','long URL capture');
 await adminPanel.select('#history-user',bob.id);await adminPanel.select('#status','all');await adminPanel.waitForFunction(()=>document.querySelector('#tab-youtube').textContent==='YouTube (2)');
 await adminPanel.click('#tab-youtube');await adminPanel.setViewport({width:390,height:844});
 const rowStyle=await adminPanel.$eval('#links-youtube .service-link',n=>{const a=n.querySelector('a'),meta=n.querySelector('.link-meta');a.scrollLeft=200;return{nowrap:getComputedStyle(a).whiteSpace,overflow:a.scrollWidth>a.clientWidth,scrolled:a.scrollLeft>0,meta:meta.textContent,children:[...meta.children].map(n=>n.tagName)};});
 assert.equal(await adminPanel.$eval('#tab-headspace',n=>n.hidden),false);assert.equal(await adminPanel.$eval('#tab-headspace',n=>n.textContent),'Headspace (1)');report.disabledSavedHistoryAvailable='PASS';
 await adminPanel.click('#tab-headspace');await adminPanel.click('#export-headspace');await wait(async()=>(await api('exports',bobAuth.token)).exports.length===1,'Headspace export snapshot');const hsSnapshot=(await api('exports',bobAuth.token)).exports[0];await wait(()=>existsSync(join(directory,hsSnapshot.filename)),'Headspace TXT downloaded');assert.equal(readFileSync(join(directory,hsSnapshot.filename),'utf8').trim(),'https://checkout.headspace.com/checkout?voucherCode=LINKEDIN-HEADSPACE');assert(hsSnapshot.filename.startsWith('Headspace_'));await adminPanel.click('#tab-youtube');report.headspaceTxtDownload='PASS';
 assert.equal(rowStyle.nowrap,'nowrap');assert.equal(rowStyle.overflow,true);assert.equal(rowStyle.scrolled,true);assert.deepEqual(rowStyle.children,['TIME']);assert.match(rowStyle.meta,/IST$/);assert(await adminPanel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));report.singleLineLinksAndDateOnly='PASS';
 if(process.env.TEST_SCREENSHOTS==='1')await adminPanel.screenshot({path:'/workspace/scratch/d75d63e90043/mobile-panel-v6.png',fullPage:true});
 await api('settings',admin.token,{pagePattern:sourceOrigin+'/changed*',enabledServices:[]});
 await page.goto(sourceOrigin+'/changed?count=5');await cdp.send('Runtime.evaluate',{expression:bobScript,includeCommandLineAPI:true,userGesture:true});await wait(async()=>await level()==='error','admin pause');assert.match(await page.$eval('#link-grabber-result-v6',n=>n.textContent),/paused/);
 // Reset through the actual admin form while the user's panel stays open.
 const bobPanel=await browser.newPage();bobPanel.on('pageerror',e=>errors.push(e.message));await bobPanel.goto(origin);await bobPanel.type('#username','bob');await bobPanel.type('#password','bob-long-password');await bobPanel.click('#login button');await bobPanel.waitForFunction(()=>!document.querySelector('#script-area').hidden);
 const beforeReset=structuredClone(repo.permanentScripts.get(bob.id));
 await adminPanel.evaluate(()=>document.querySelector('#reset-password').closest('details').open=true);await adminPanel.select('#reset-user',bob.id);await adminPanel.type('#reset-value','new');await adminPanel.click('#reset-password button');await adminPanel.waitForFunction(()=>document.querySelector('#notice').textContent.startsWith('Password reset.'));
 await bobPanel.waitForFunction(()=>!document.querySelector('#login-card').hidden);assert.equal(await bobPanel.$eval('#console-script',n=>n.value),'');assert.match(await bobPanel.$eval('#notice',n=>n.textContent),/password was reset/);
 await bobPanel.$eval('#username',n=>n.value='bob');await bobPanel.type('#password','new');await bobPanel.click('#login button');await bobPanel.waitForFunction(()=>!document.querySelector('#regenerate-script').hidden);
 assert.equal(await bobPanel.$eval('#console-script',n=>n.value),'');assert.equal(await bobPanel.$eval('#generate-script',n=>n.hidden),true);assert.match(await bobPanel.$eval('#script-status-reason',n=>n.textContent),/password was reset/);assert.deepEqual(repo.permanentScripts.get(bob.id),beforeReset);
 await bobPanel.reload();await bobPanel.waitForFunction(()=>!document.querySelector('#regenerate-script').hidden);assert.equal(await bobPanel.$eval('#console-script',n=>n.value),'');assert.deepEqual(repo.permanentScripts.get(bob.id),beforeReset);
 await page.goto(sourceOrigin+'/changed?variant=PASSWORD_OLD&count=1');await cdp.send('Runtime.evaluate',{expression:bobScript,includeCommandLineAPI:true,userGesture:true});await wait(async()=>await level()==='error','old script after password reset');assert.match(await page.$eval('#link-grabber-result-v6',n=>n.textContent),/password was reset/);
 if(process.env.TEST_SCREENSHOTS==='1'){await bobPanel.setViewport({width:1360,height:950});await bobPanel.screenshot({path:'/workspace/scratch/d75d63e90043/revoked-panel-v6_1.png',fullPage:true});}
 await bobPanel.click('#regenerate-script');await bobPanel.waitForFunction(()=>!document.querySelector('#script-area').hidden);const bobNew=await bobPanel.$eval('#console-script',n=>n.value);assert.notEqual(bobNew,bobScript);
 await api('settings',admin.token,{pagePattern:sourceOrigin+'/changed*',enabledServices:['YouTube']});await cdp.send('Runtime.evaluate',{expression:bobNew,includeCommandLineAPI:true,userGesture:true});await wait(async()=>await level()==='success','explicit password-reset replacement saves');
 // Changing one's own password also clears code and persists a distinct cause.
 await bobPanel.evaluate(()=>document.querySelector('#change-password').closest('details').open=true);await bobPanel.type('#current-password','new');await bobPanel.type('#new-password','next');await bobPanel.click('#change-password button');await bobPanel.waitForFunction(()=>!document.querySelector('#login-card').hidden);assert.equal(await bobPanel.$eval('#console-script',n=>n.value),'');
 await bobPanel.$eval('#username',n=>n.value='bob');await bobPanel.type('#password','next');await bobPanel.click('#login button');await bobPanel.waitForFunction(()=>!document.querySelector('#regenerate-script').hidden);assert.match(await bobPanel.$eval('#script-status-reason',n=>n.textContent),/password was changed/);
 await api('admin/users/update',admin.token,{id:bob.id,active:false});await bobPanel.waitForFunction(()=>!document.querySelector('#login-card').hidden);await api('admin/users/update',admin.token,{id:bob.id,active:true});
 await bobPanel.$eval('#username',n=>n.value='bob');await bobPanel.type('#password','next');await bobPanel.click('#login button');await bobPanel.waitForFunction(()=>!document.querySelector('#regenerate-script').hidden);assert.match(await bobPanel.$eval('#script-status-reason',n=>n.textContent),/disabled and re-enabled/);assert.equal(await bobPanel.$eval('#console-script',n=>n.value),'');
 report.passwordResetLivePanelAndSelfChange='PASS';report.accountDisableRestoreReason='PASS';
 // With all capture services off and no matching saved rows, no empty tab or
 // selected panel is left visible. Enabling a service restores it on polling.
 const emptyPanel=await browser.newPage();await emptyPanel.goto(origin);await emptyPanel.evaluate(t=>sessionStorage.setItem('lg-cloud-token',t),admin.token);
 await api('settings',admin.token,{pagePattern:sourceOrigin+'/changed*',enabledServices:[]});await emptyPanel.reload();await emptyPanel.waitForFunction(()=>!document.querySelector('#workspace').hidden&&document.querySelector('#configured-services').textContent.includes('paused'));assert.equal(await emptyPanel.$$eval('.service-tab:not([hidden])',n=>n.length),0);assert.equal(await emptyPanel.$$eval('.service-section:not([hidden])',n=>n.length),0);
 await api('settings',admin.token,{pagePattern:sourceOrigin+'/changed*',enabledServices:['YouTube']});await emptyPanel.waitForFunction(()=>document.querySelector('#tab-youtube').hidden===false);assert.equal(await emptyPanel.$$eval('.service-tab:not([hidden])',n=>n.length),1);await emptyPanel.close();report.noServicesAndLiveSettings='PASS';
 // An expired session reaches the login view only after the server rejects it.
 const expired=await browser.newPage();await expired.goto(origin);await expired.evaluate(()=>sessionStorage.setItem('lg-cloud-token','f'.repeat(64)));await expired.reload();await expired.waitForFunction(()=>!document.querySelector('#login-card').hidden);assert.equal(await expired.$eval('#workspace',n=>n.hidden),true);await expired.close();
 
 // Real Excel UI download: one service per worksheet, plus frozen-history retry.
 const excelUser=(await api('admin/users',admin.token,{username:'exceluser',password:'password'})).user;
 const excelUrls=['https://youtube.com/premium?acc=EXCEL-A','https://lovable.dev/lp/example?reward_code=EXCEL-A','https://www.notion.com/redeem/linkedin?code=EXCEL-A','https://nordvpn.com/linkedin/?code=EXCEL-A','https://checkout.headspace.com/checkout?voucherCode=LINKEDIN-EXCEL-A'];
 await repo.saveLinks(excelUser.id,excelUrls.map((url,i)=>({_id:'excel-'+i,url,service:['YouTube','Lovable','Notion','NordVPN','Headspace'][i],first_seen:'2026-10-25T08:39:54.000Z',last_seen:'2026-10-25T08:39:54.000Z',exported:false})));
 const excelAuth=await api('login','',{username:'exceluser',password:'password'}),excelPanel=await browser.newPage();excelPanel.on('pageerror',e=>errors.push(e.message));await excelPanel.goto(origin);await excelPanel.evaluate(t=>sessionStorage.setItem('lg-cloud-token',t),excelAuth.token);await excelPanel.reload();await excelPanel.waitForFunction(()=>document.querySelector('#count').textContent.startsWith('5 '));
 await excelPanel.click('#export-excel');await wait(async()=>(await api('exports',excelAuth.token)).exports.length===1,'Excel snapshot created');const excelSnapshot=(await api('exports',excelAuth.token)).exports[0];await wait(()=>existsSync(join(directory,excelSnapshot.filename)),'Excel workbook downloaded');
 const firstBook=new ExcelJS.Workbook();await firstBook.xlsx.load(readFileSync(join(directory,excelSnapshot.filename)));assert.deepEqual(firstBook.worksheets.map(s=>s.name),['YouTube','Lovable','Notion','Nord','Headspace']);for(let i=0;i<5;i++)assert.equal(firstBook.worksheets[i].getCell('A2').value,excelUrls[i]);
 await excelPanel.waitForFunction(()=>document.querySelector('#count').textContent.startsWith('0 '));assert.equal(await excelPanel.$eval('#export-excel-youtube',n=>n.disabled),true);
 const later='https://youtube.com/premium?acc=EXCEL-B';await repo.saveLinks(excelUser.id,[{_id:'excel-later',url:later,service:'YouTube',first_seen:'2026-10-25T08:40:00.000Z',last_seen:'2026-10-25T08:40:00.000Z',exported:false}]);
 unlinkSync(join(directory,excelSnapshot.filename));await excelPanel.evaluate(()=>document.querySelector('#exports button').click());await wait(()=>existsSync(join(directory,excelSnapshot.filename)),'Excel Download again');const againBook=new ExcelJS.Workbook();await againBook.xlsx.load(readFileSync(join(directory,excelSnapshot.filename)));assert.equal(againBook.getWorksheet('YouTube').rowCount,2);assert.equal(againBook.getWorksheet('YouTube').getCell('A2').value,excelUrls[0]);
 await excelPanel.select('#status','all');await excelPanel.waitForFunction(()=>document.querySelector('#count').textContent.startsWith('6 '));await excelPanel.click('#tab-youtube');await excelPanel.click('#export-excel-youtube');await wait(async()=>(await api('exports',excelAuth.token)).exports.length===2,'service Excel snapshot');const ownSnapshot=(await api('exports',excelAuth.token)).exports.find(x=>x.filename.startsWith('YouTube_'));await wait(()=>existsSync(join(directory,ownSnapshot.filename)),'YouTube-only Excel download');const ownBook=new ExcelJS.Workbook();await ownBook.xlsx.load(readFileSync(join(directory,ownSnapshot.filename)));assert.deepEqual(ownBook.worksheets.map(s=>s.name),['YouTube']);assert.deepEqual(new Set(ownBook.getWorksheet('YouTube').getColumn(1).values.slice(2)),new Set([excelUrls[0],later]));
 await excelPanel.click('#export');await wait(async()=>(await api('exports',excelAuth.token)).exports.length===3,'Grouped TXT snapshot');const groupedSnapshot=(await api('exports',excelAuth.token)).exports.find(x=>x.filename.endsWith('.txt'));await wait(()=>existsSync(join(directory,groupedSnapshot.filename)),'Grouped TXT download');const groupedText=readFileSync(join(directory,groupedSnapshot.filename),'utf8');assert.deepEqual(groupedText.trim().split(/\r?\n\r?\n/),['YouTube',later+'\r\n'+excelUrls[0],'Lovable',excelUrls[1],'Notion',excelUrls[2],'NordVPN',excelUrls[3],'Headspace',excelUrls[4]]);report.groupedAllTxtDownload='PASS';
 if(process.env.TEST_SCREENSHOTS==='1')await excelPanel.screenshot({path:'/workspace/scratch/d75d63e90043/excel-panel-v6_2.png',fullPage:true});await excelPanel.close();report.excelServiceSheetsAndDownloadAgain='PASS';report.perServiceExcelDownload='PASS';
 assert.deepEqual(errors,[]);report.darkPanelsExportsAndPrivacy='PASS';report.result='PASS';console.log(JSON.stringify(report,null,2));
}finally{if(browser)await browser.close();source.closeAllConnections();cloud.closeAllConnections();await Promise.all([new Promise(r=>source.close(r)),new Promise(r=>cloud.close(r))]);rmSync(directory,{recursive:true,force:true});}
