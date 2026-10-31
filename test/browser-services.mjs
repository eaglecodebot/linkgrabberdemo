import puppeteer from 'puppeteer-core';
import http from 'node:http';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {createApp,bootstrap} from '../cloud/app.mjs';
import {MemoryRepository} from './cloud-memory.mjs';
const repo=new MemoryRepository();await bootstrap(repo,'admin','a');const cloud=createApp(repo,{scriptSecret:'bc'.repeat(32)});cloud.listen(0,'127.0.0.1');await once(cloud,'listening');const origin='http://127.0.0.1:'+cloud.address().port;
let code='FIRST';const wrapped=url=>'https://www.linkedin.com/safety/go/?url='+encodeURIComponent(url);
const source=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');if(req.url.includes('csp'))res.setHeader('Content-Security-Policy',"default-src 'none';connect-src 'none';script-src 'none';style-src 'none'");res.end('<!doctype html><title>Custom capture fixture</title><a href="'+wrapped('https://new.example/redeem?code='+code)+'">Custom reward</a><a href="'+wrapped('https://another.example/claim?token='+code)+'">Another reward</a><a href="https://irrelevant.example/help">Help</a>');});source.listen(0,'127.0.0.1');await once(source,'listening');const sourceOrigin='http://127.0.0.1:'+source.address().port;
const api=async(path,token='',data)=>{const r=await fetch(origin+'/api/'+path,{headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(data===undefined?{}:{method:'POST',body:JSON.stringify(data)})}),body=await r.json();assert(r.ok,body.error);return body;};
const wait=async(fn,label,timeout=12000)=>{const start=Date.now();while(Date.now()-start<timeout){if(await fn())return;await new Promise(r=>setTimeout(r,25));}throw new Error('Timed out: '+label);};
let browser;
try{
 const admin=await api('login','',{username:'admin',password:'a'}),{user}=await api('admin/users',admin.token,{username:'alice',password:'a'}),alice=await api('login','',{username:'alice',password:'a'});
 await api('settings',admin.token,{pagePattern:sourceOrigin+'/perks*',enabledServices:['YouTube']});
 const original=await api('capture-script/regenerate',alice.token,{}),key=original.script.match(/"captureKey":"([a-f0-9]{64})"/)[1];
 // Emulate an installed v6 record to check the user-facing upgrade state.
 repo.permanentScripts.get(user.id).engineVersion=6;
 browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH,headless:true,args:['--no-sandbox']});
 const errors=[],openPanel=async token=>{const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.evaluate(token=>sessionStorage.setItem('lg-cloud-token',token),token);await page.reload();await page.waitForFunction(()=>!document.querySelector('#workspace').hidden);return page;};
 const panel=await openPanel(alice.token),adminPanel=await openPanel(admin.token);await adminPanel.waitForFunction(()=>document.querySelector('#service-catalog').children.length===5);
 assert.equal(await panel.$eval('#admin',n=>n.hidden),true);assert.equal(await panel.$eval('#service-form',n=>!!n.closest('[hidden]')),true);
 const add=async(name,url)=>{await adminPanel.$eval('#service-name',(n,value)=>{n.value=value;n.dispatchEvent(new Event('input'));},name);await adminPanel.$eval('#service-sample',(n,value)=>{n.value=value;n.dispatchEvent(new Event('input'));},wrapped(url));await adminPanel.click('#service-form button[type=submit]');await adminPanel.waitForFunction(()=>!document.querySelector('#service-preview').hidden);assert(!(await adminPanel.$eval('#service-preview-text',n=>n.textContent)).includes('SAMPLE_PRIVATE'));await adminPanel.click('#add-service');await wait(async()=>!(await adminPanel.$eval('#service-catalog',n=>n.textContent)).includes('Loading')&&(await api('admin/services',admin.token)).catalog.services.some(item=>item.name===name),'service saved');await wait(()=>adminPanel.$eval('#service-name',n=>n.value===''),'add form completed');};
 await add('New Rewards','https://new.example/redeem?code=SAMPLE_PRIVATE');
 await panel.waitForFunction(()=>document.querySelector('#script-status-title').textContent==='Console script update required');assert.equal(await panel.$eval('#console-script',n=>n.value),'');assert.equal(await panel.$eval('#download-extension',n=>n.hidden||n.disabled),false);
 await panel.click('#regenerate-script');await panel.waitForFunction(()=>document.querySelector('#script-status').hidden);let script=await panel.$eval('#console-script',n=>n.value);assert(script.includes(key));
 // The next add must use the same script; only required service data changes.
 await add('Another Rewards','https://another.example/claim?token=SAMPLE_PRIVATE');
 await adminPanel.evaluate(()=>{for(const input of document.querySelectorAll('input[name=service]'))input.checked=['New Rewards','Another Rewards'].includes(input.value);});await adminPanel.click('#settings-form button');await wait(async()=>(await api('settings',alice.token)).settings.enabledServices.length===2,'custom selection saved');
 await panel.reload();await panel.waitForFunction(()=>document.querySelector('#console-script').value.includes('captureKey'));assert.equal(await panel.$eval('#console-script',n=>n.value),script);assert.equal(await panel.$eval('#script-status',n=>n.hidden),true);
 const website=await browser.newPage(),cdp=await website.createCDPSession();await website.goto(sourceOrigin+'/perks');const run=()=>cdp.send('Runtime.evaluate',{expression:script,includeCommandLineAPI:true,userGesture:true});await run();await website.waitForFunction(()=>document.querySelector('#link-grabber-result-v6')?.dataset.level==='success');assert.equal((await api('links',alice.token)).total,2);
 await wait(()=>panel.$$eval('.service-tab',nodes=>nodes.some(n=>n.textContent==='New Rewards (1)')),'dynamic user tab');
 await panel.$$eval('.service-tab',nodes=>nodes.find(n=>n.textContent==='New Rewards (1)').click());assert.equal(await panel.$$eval('.service-section:not([hidden]) .reward-url',nodes=>nodes[0].textContent),'https://new.example/redeem?code=FIRST');
 const saved=(await api('exports',alice.token,{status:'all'})).export;assert.match(saved.text,/New Rewards/);assert.match(saved.text,/Another Rewards/);
 code='CSP';await website.goto(sourceOrigin+'/perks?csp=1');let popup;const listener=p=>{popup=p;};website.on('popup',listener);await run();
 await wait(async()=>!!popup||await website.$eval('#link-grabber-result-v6',n=>n.textContent.includes('browser blocked')),'CSP fallback');
 if(!popup)await website.$$eval('#link-grabber-result-v6 button',nodes=>nodes.find(n=>n.textContent==='Open save window').click());
 await wait(async()=>(await api('links',alice.token)).total===4,'custom CSP save');website.off('popup',listener);
 await adminPanel.$$eval('#service-catalog .profile-item',rows=>rows.find(row=>row.querySelector('strong').textContent==='New Rewards').querySelector('button').click());
 await wait(async()=>(await api('settings',alice.token)).settings.enabledServices.join(',')==='Another Rewards','removed no longer captured');
 assert.equal((await api('exports/get?id='+saved._id,alice.token)).export.text,saved.text);assert.equal((await api('links?service=New%20Rewards',alice.token)).total,2);
 await adminPanel.reload();await adminPanel.waitForFunction(()=>document.querySelector('#service-catalog').textContent.includes('New Rewards · removed'));await adminPanel.setViewport({width:390,height:844});assert(await adminPanel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 if(process.env.TEST_SCREENSHOTS==='1'){await adminPanel.setViewport({width:1440,height:1100});await adminPanel.$eval('#service-form',n=>n.scrollIntoView());await adminPanel.screenshot({path:'/workspace/scratch/d75d63e90043/services-admin-v6_6.png'});}
 assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',adminPreviewAddRemove:true,noSampleCodeStored:true,oldConsolePrompt:true,extensionDownloadDuringScriptUpgrade:true,keyPreservedOnMatcherUpgrade:true,sameScriptForLaterServices:true,dynamicTabsAndCounts:true,customDirectAndCspCapture:true,historyAndExportsRetained:true,mobileLayout:true}));
}finally{await browser?.close();source.closeAllConnections();cloud.closeAllConnections();await Promise.all([new Promise(r=>source.close(r)),new Promise(r=>cloud.close(r))]);}
