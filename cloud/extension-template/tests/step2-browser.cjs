const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,timeout=40000){const at=Date.now();while(Date.now()-at<timeout){if(await fn())return;await wait(60);}throw Error('Timed out: '+label);}
const events=[];
const page=body=>`<!doctype html><html><meta charset="utf-8"><style>body{font:16px system-ui;padding:30px}a,button{display:inline-block;padding:14px;margin:10px}aside{margin:20px}</style><body>${body}<script>const record=(name)=>fetch('/event',{method:'POST',body:JSON.stringify({name})});</script></body></html>`;
(async()=>{
 const route=async(req,res)=>{
  if(req.url==='/event'){let body='';req.on('data',b=>body+=b);req.on('end',()=>{events.push(JSON.parse(body));res.end('ok')});return;}
  if(req.url.startsWith('/__extension/')){const name=req.url.slice('/__extension/'.length);if(!/^[a-z.-]+$/.test(name)){res.statusCode=404;res.end();return;}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(await fs.readFile(path.join(root,name)));return;}
  res.setHeader('Content-Type','text/html');let body='';
  if(req.url==='/s2-subscriptions')body=`<main hidden><div>Account</div><div><div><div><div><div><a data-test-link-text-cell-link href="/s2-manage" onclick="record('career-selected')">Premium Career</a></div></div></div></div></div></main><aside>${Array.from({length:3},()=>'<a data-test-link-text-cell-link href="/wrong">Premium Career</a>').join('')}</aside><div id="tooltip" hidden style="position:fixed;inset:0;z-index:9999;background:#0001"><button type="button" class="chat-button__tooltip-dismiss" aria-label="Dismiss chat tooltip" style="position:absolute;right:20px;top:20px"><span style="display:none">Dismiss chat tooltip</span>×</button></div><script>setTimeout(()=>{document.querySelector('main').hidden=false;document.querySelector('#tooltip').hidden=false},700);document.querySelector('.chat-button__tooltip-dismiss').onclick=()=>{record('dismiss-tooltip');document.querySelector('#tooltip').remove()};</script>`;
  else if(req.url==='/s2-manage')body='<a data-test-cancel_subscription_premium-btn href="/s2-cancel" onclick="record(\'cancel-open\')">Cancel subscription</a>';
  else if(req.url==='/s2-cancel')body=`<section role="dialog" id="wizard"><h1>Keep your benefits</h1><button type="button" componentkey="stage-one">Continue to cancel</button></section><script>
    const button=document.querySelector('button'),wizard=document.querySelector('#wizard');let stage=1,waiting=false;
    button.onclick=()=>{if(waiting){record('WRONG_DOUBLE_CONTINUE');return;}waiting=true;
      if(stage===1){record('continue-1');setTimeout(()=>button.setAttribute('componentkey','loading-rerender'),100);setTimeout(()=>{stage=2;waiting=false;wizard.querySelector('h1').textContent='Review your cancellation';button.setAttribute('componentkey','stage-two')},700)}
      else{record('continue-2');button.disabled=true;setTimeout(()=>{wizard.innerHTML='<h1>Confirm your cancellation</h1><a role="button" href="#" aria-disabled="false">Confirm cancel</a>';wizard.querySelector('a').onclick=e=>{e.preventDefault();const a=e.currentTarget;a.setAttribute('aria-disabled','true');record('confirm-click');setTimeout(()=>{record('cancel-confirmed');wizard.innerHTML='<p>Cancellation complete</p>';history.pushState({},'', '/s2-cancelled')},900)}},300)}
    };</script>`;
  else if(req.url==='/s2-refund'){events.push({name:'url2-opened'});body=`<button type="button" data-test-refund__next-button disabled>Submit</button><div id="result"></div><script>const submit=document.querySelector('button');setTimeout(()=>submit.disabled=false,500);submit.onclick=()=>{record('refund-submit');submit.disabled=true;setTimeout(()=>{submit.hidden=true;document.querySelector('#result').innerHTML='<a href="/s2-support" target="_blank" data-test-refund-action-button>Contact LinkedIn Support</a>'},500)};</script>`;}
  else if(req.url==='/s2-support'){events.push({name:'support-opened'});body='<h1>Support page</h1>';}
  else if(req.url==='/wrong'){events.push({name:'WRONG_CAREER_LINK'});body='Wrong subscription';}
  else body='<h1>Existing website tab</h1>';
  res.end(page(body));
 };
 const first=http.createServer(route),second=http.createServer(route);await new Promise(r=>first.listen(0,'127.0.0.1',r));await new Promise(r=>second.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${first.address().port}`,url1=origin+'/s2-subscriptions',url2=`http://localhost:${second.address().port}/s2-refund`;let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});const context=await browser.newContext();
  const runtime=await require('./chrome-bridge.cjs')(context,root,origin);
  runtime.store.settings={delhiPincodes:['110001','110002','110003','110006','110011','110020']};runtime.reloadWorker();
  const options=await context.newPage();await options.goto(origin+'/__extension/options.html');
  await options.locator('#pincodeCount').filter({hasText:'56 entries'}).waitFor();
  const pins=(await options.locator('#delhiPincodes').inputValue()).split(/[\s,]+/).filter(Boolean);assert.equal(new Set(pins).size,56);
  await options.locator('#step2StartUrl').fill(url1);await options.locator('#step2SecondUrl').fill(url2);await options.locator('button[type=submit]').click();await options.locator('#saved').filter({hasText:'Saved.'}).waitFor();
  assert.equal(runtime.store.settings.startUrl,'');assert.equal(runtime.store.settings.step2StartUrl,url1);assert.equal(runtime.store.settings.step2SecondUrl,url2);
  const popup=await context.newPage();await popup.addInitScript(()=>{window.close=()=>{globalThis.__closedAfterStart=true;};});await popup.goto(origin+'/__extension/popup.html');
  assert.equal(await popup.locator('#start').isDisabled(),false);assert.equal(await popup.locator('#start2').isDisabled(),false);
  const website=await context.newPage();await website.goto('about:blank');const tabId=runtime.ids.get(website),count=context.pages().length;
  await popup.locator('#start2').click();await until(()=>runtime.store.run?.config.workflowNumber===2,'Step 2 starts');
  await until(()=>popup.evaluate(()=>globalThis.__closedAfterStart===true),'popup closes after Step 2 start');
  await until(()=>events.some(e=>e.name==='confirm-click'),'Confirm cancel clicked');runtime.reloadWorker();
  await until(()=>events.some(e=>e.name==='url2-opened'),'URL 2 opened after cancellation');
  assert.ok(events.findIndex(e=>e.name==='cancel-confirmed')<events.findIndex(e=>e.name==='url2-opened'));
  const paused=await options.evaluate(()=>chrome.runtime.sendMessage({type:'PAUSE'}));assert.ok(!paused.error);
  await website.waitForURL('**/s2-refund');await website.reload();runtime.reloadWorker();await wait(600);
  assert.equal(runtime.store.run.status,'paused');assert.equal(events.some(e=>e.name==='refund-submit'),false);
  await options.evaluate(()=>chrome.runtime.sendMessage({type:'RESUME'}));
  await until(()=>{if(runtime.store.run?.status==='error')throw Error(runtime.store.run.message);return runtime.store.run?.status==='finished';},'Step 2 complete');
  await website.waitForURL('**/s2-support');await until(()=>events.some(e=>e.name==='support-opened'),'support link opens');
  assert.equal(context.pages().length,count);assert.equal(runtime.store.run.tabId,tabId);
  assert.deepEqual(runtime.navigationUpdates.map(x=>x.url),[url1,url2]);
  for(const name of ['dismiss-tooltip','career-selected','cancel-open','continue-1','continue-2','confirm-click','cancel-confirmed','refund-submit','support-opened'])assert.equal(events.filter(e=>e.name===name).length,1,name);
  assert.equal(events.some(e=>e.name.startsWith('WRONG')),false);
  const diagnostics=await options.evaluate(()=>chrome.runtime.sendMessage({type:'DIAGNOSTICS'}));assert.equal(diagnostics.diagnostics.workflowStep,2);assert.ok(!JSON.stringify(diagnostics).includes(url1));assert.ok(!JSON.stringify(diagnostics).includes(url2));
  await popup.reload();await popup.locator('#workflowTitle').filter({hasText:'Step 2 workflow'}).waitFor();await popup.screenshot({path:path.join(root,'..','qa-step2-popup.png')});await options.screenshot({path:path.join(root,'..','qa-step2-settings.png'),fullPage:true});
  console.log('PASS: actual settings + Step 2 button, 50 additional pincodes, unique subscription selection, repeated Continue screens, Confirm cancel before URL 2, cross-origin navigation, pause/refresh/worker recovery, same-tab support link, auto-hide and redacted diagnostics');
 }finally{await browser?.close();first.close();second.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
