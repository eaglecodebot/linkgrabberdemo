const {chromium}=require('playwright');
const path=require('node:path');
const assert=require('node:assert/strict');
const {events,serve,until,setFrameOrigin}=require('./fixture.cjs');
(async()=>{
 const server=await serve(),embeddedServer=await serve(),origin=`http://127.0.0.1:${server.address().port}`,embeddedOrigin=`http://localhost:${embeddedServer.address().port}`;let browser;
 setFrameOrigin(embeddedOrigin);
 try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
  const context=await browser.newContext(),runtime=await require('./chrome-bridge.cjs')(context,path.resolve(__dirname,'..'),origin);
  const original=structuredClone(runtime.config.steps);
  const controls=await context.newPage();await controls.goto(origin+'/__extension/controls.html');
  const send=(type,payload={})=>controls.evaluate(([type,payload])=>chrome.runtime.sendMessage({type,...payload}),[type,payload]);
  await controls.evaluate(()=>chrome.permissions.request({origins:['http://127.0.0.1/*','http://localhost/*']}));
  async function startAt(route,steps){
   runtime.config.steps=steps;runtime.reloadWorker();
   const saved=await send('SAVE_SETTINGS',{settings:{startUrl:origin+route,additionalOrigins:[embeddedOrigin],settleMilliseconds:200}});assert.ok(!saved.error,saved.error);
   const page=await context.newPage();await page.goto(origin+route);
   const result=await send('START',{tabId:runtime.ids.get(page)});assert.ok(!result.error,result.error);return page;
  }
  const page=await startAt('/tooltip-start',original);
  await until(()=>{if(runtime.store.run?.status==='error')throw Error(runtime.store.run.message);return runtime.store.run?.status==='finished';},'tooltip then all checkout actions',45000);
  await until(()=>events.some(e=>e.name==='finish'),'website final event');
  assert.deepEqual(events.map(e=>e.name),['premium','other','dismiss-tooltip','next','career','redeem','individual','confirm-individual','monthly','upi','qr','continue','finish']);
  assert.equal(events.filter(e=>e.name==='dismiss-tooltip').length,1);
  console.log('PASS: closes the captured parent-page tooltip with hidden label text before iframe Next and completes checkout');
  events.length=0;
  const frameTooltip=await startAt('/frame-tooltip-start',original);
  await until(()=>runtime.store.run?.index===original.findIndex(s=>s.id==='next'),'Other selected before frame tooltip');
  await frameTooltip.locator('#unknown-parent-cover').waitFor();await frameTooltip.waitForTimeout(900);
  assert.equal(events.some(e=>e.name==='dismiss-tooltip'),false,'a parent overlay must still block the child close button');
  assert.equal(await frameTooltip.frameLocator('iframe').locator('.chat-button__tooltip-dismiss').innerText(),'×');
  await frameTooltip.locator('#unknown-parent-cover').evaluate(el=>el.remove());
  await until(()=>{if(runtime.store.run?.status==='error')throw Error(runtime.store.run.message);return runtime.store.run?.status==='finished';},'close tooltip in actual cross-origin frame then finish',45000);
  await until(()=>events.some(e=>e.name==='finish'),'cross-origin final event');
  assert.deepEqual(events.map(e=>e.name),['premium','other','dismiss-tooltip','next','career','redeem','individual','confirm-individual','monthly','upi','qr','continue','finish']);
  console.log('PASS: finds the tooltip inside the cross-origin survey frame; checks parent occlusion, closes it once, then clicks Next');
  events.length=0;
  const delayed=await startAt('/delayed-final',original.slice(original.findIndex(s=>s.id==='monthly')));
  await until(()=>events.some(e=>e.name==='focus-disabled'),'focus disables final button',25000);
  assert.notEqual(runtime.store.run.status,'finished');
  assert.equal(events.some(e=>e.name==='finish'),false);
  await until(()=>{if(runtime.store.run?.status==='error')throw Error(runtime.store.run.message);return runtime.store.run?.status==='finished';},'final becomes actionable again',20000);
  await until(()=>events.some(e=>e.name==='finish'),'delayed final click');
  assert.deepEqual(events.map(e=>e.name),['monthly','upi','qr','continue','button-enabled','focus-disabled','focus-enabled','finish']);
  const final=events.find(e=>e.name==='finish').value;assert.ok(final.elapsed>=4500);assert.equal(final.continueStillVisible,true);
  await delayed.waitForTimeout(700);assert.equal(events.filter(e=>e.name==='finish').length,1);
  console.log('PASS: waits through native/ARIA/busy/inherited disabled states and changed CTA text; focus-time disabling never falsely finishes');
  events.length=0;
  const inherited=await startAt('/fieldset-final',[{...original.find(s=>s.id==='finish'),final:true}]);
  await inherited.waitForTimeout(1100);assert.equal(runtime.store.run.phase,'waiting');assert.equal(runtime.store.run.status,'running');assert.equal(events.length,0);
  assert.equal(await inherited.locator('button').evaluate(el=>el.disabled),false,'only the parent fieldset is disabled');
  await inherited.locator('fieldset').evaluate(el=>el.disabled=false);
  await until(()=>runtime.store.run.status==='finished','inherited disabled state clears');await until(()=>events.length===1,'one final event');
  console.log('PASS: never claims a button disabled only by its parent fieldset; proceeds once enabled');
 }finally{await browser?.close();server.close();embeddedServer.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
