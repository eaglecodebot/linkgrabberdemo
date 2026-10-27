// Runs the shipped background/content/UI code in Chromium against local pages.
// chrome.* is bridged by this harness because some headless builds omit extensions.
const {chromium}=require('playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const {webcrypto}=require('node:crypto');
const assert=require('node:assert/strict');
const {events,serve,until,setAlternateOrigin,setFrameOrigin,slowDelivered}=require('./fixture.cjs');
const root=path.resolve(__dirname,'..');
const extensionVersion=require('../manifest.json').version;
const extensionOrigin='chrome-extension://test-extension/';
const eventObject=()=>({listeners:[],addListener(fn){this.listeners.push(fn)}});
(async()=>{
  const server=await serve(),other=await serve();
  const origin=`http://127.0.0.1:${server.address().port}`, otherOrigin=`http://127.0.0.1:${other.address().port}`;
  setAlternateOrigin(otherOrigin);
  const embeddedOrigin=`http://localhost:${other.address().port}`;setFrameOrigin(embeddedOrigin);
  // Extension UI and modules are served only to this local test browser.
  const originalListeners=server.listeners('request');
  server.removeAllListeners('request');
  server.on('request',async(req,res)=>{
    if(req.url.startsWith('/__extension/')){
      const name=req.url.slice('/__extension/'.length);
      if(!/^[a-z.-]+$/.test(name)){res.statusCode=404;res.end();return;}
      try {res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(await fs.readFile(path.join(root,name)));}catch{res.statusCode=404;res.end();}
    }else originalListeners.at(-1)(req,res);
  });
  let browser,context;
  const clone=value=>structuredClone(value);
  try{
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});context=await browser.newContext({acceptDownloads:true});
    const runtime=await require('./chrome-bridge.cjs')(context,root,origin);
    const {store,tabs,ids,config,reloadWorker}=runtime;
    const options=await context.newPage();await options.goto(origin+'/__extension/options.html');
    const popup=await context.newPage();await popup.goto(origin+'/__extension/popup.html');
    // This harness keeps the popup as a regular test page so it can reopen
    // controls. Record auto-close requests; a real closable window is checked separately.
    await popup.addInitScript(()=>{window.close=()=>{globalThis.__popupCloseRequested=true;};});
    const message=(type,body={})=>options.evaluate(async([type,body])=>{const r=await chrome.runtime.sendMessage({type,...body});if(r.error)throw new Error(r.error);return r},[type,body]);
    const state=async()=>clone(store.run);
    async function settings(startUrl,extra={}){await message('SAVE_SETTINGS',{settings:{startUrl,additionalOrigins:[],stepTimeoutSeconds:20,settleMilliseconds:200,pincodeMode:'random',pincode:'',pincodeSelector:'',delhiPincodes:['110001','110002','110003'],...extra}});}
    async function start(){
      const previous=store.run?.id;
      const page=await context.newPage();await page.goto((await message('GET_STATUS')).config.startUrl);
      await popup.reload();const count=context.pages().length;await popup.locator('#start').click();assert.equal(context.pages().length,count,'Start must reuse a tab');
      await until(()=>store.run?.id!==previous&&store.run?.tabId===ids.get(page)&&['running','needs_access'].includes(store.run?.status),'fresh run established');
      await until(()=>popup.evaluate(()=>globalThis.__popupCloseRequested===true),'popup auto-close requested after successful Start');
      return page;
    }
    const idle=await context.newPage();await idle.goto(origin+'/start');await idle.waitForTimeout(1200);assert.equal(events.length,0);console.log('PASS: visiting a page does not start a run');
    await options.locator('#startUrl').fill(origin+'/start');await options.locator('#settleMilliseconds').fill('200');await options.locator('button[type=submit]').click();await options.locator('#saved').filter({hasText:'Saved.'}).waitFor();
    console.log('PASS: actual Settings form saves the private URL');
    await settings(origin+'/start');const page=await start();
    await until(async()=> (await state())?.index===2,'Other selected');await message('PAUSE');const pinned=(await state()).values.pincode;
    await page.evaluate(()=>document.querySelector('iframe').contentWindow.location.reload());reloadWorker();await page.waitForTimeout(1000);assert.equal((await state()).index,2);assert.equal(events.filter(e=>e.name==='next').length,0);
    assert.equal(await page.locator('#outside-other').isChecked(),false);
    const hitTest=await page.evaluate(step=>{
      const E=globalThis.PrivateWorkflow, el=E.resolve(step,{index:1}).element;E.scrollIntoView(el);
      const clear=E.unobstructed(el),cover=document.createElement('div');cover.style.cssText='position:fixed;inset:0;z-index:2147483647;background:#0001';document.body.append(cover);
      const covered=E.unobstructed(el);cover.remove();return {clear,covered};
    },config.steps[1]);assert.deepEqual(hitTest,{clear:true,covered:false});
    console.log('PASS: hidden checkbox labels work; a parent-page overlay blocks iframe actions');
    await message('RESUME');await until(async()=> (await state())?.index===6,'Individual selected',45000);
    await message('PAUSE');await page.evaluate(()=>document.querySelector('iframe').contentWindow.location.reload());await page.waitForTimeout(700);await message('RESUME');
    await until(async()=> (await state())?.index===11,'pincode entered',45000);
    await message('PAUSE');await page.reload();await page.waitForTimeout(600);await message('RESUME');
    await until(async()=> (await state())?.status==='finished','all 14 steps finished',45000);
    await until(()=>events.some(e=>e.name==='finish'),'website final event');
    assert.deepEqual(events.map(e=>e.name),['premium','other','other','next','career','redeem','individual','individual','confirm-individual','monthly','upi','qr','monthly','upi','qr','continue','finish']);assert.equal(events.find(e=>e.name==='continue').value,pinned);
    await page.waitForURL('**/done');await page.reload();await page.waitForTimeout(900);assert.equal(events.filter(e=>e.name==='finish').length,1);
    console.log('PASS: 14 actions, iframe navigation, duplicate offer buttons, generated IDs, exact Pin code label, final stop');
    console.log('PASS: survey/Individual/checkout refresh recover lost choices; worker recreation preserves progress and pincode');
    await settings(origin+'/start');const refreshed=await start();await refreshed.waitForLoadState('load');await refreshed.reload();await until(async()=> (await state())?.index>=1,'active refresh resumed');await message('STOP');console.log('PASS: active refresh preserves progress');
    await settings(origin+'/cross-start');const cross=await start();await until(async()=> (await state())?.status==='needs_access','new origin pause');await cross.waitForLoadState('load');assert.equal(await cross.frameLocator('iframe[data-testid="interop-iframe"]').locator('#random-survey').isChecked(),false);await message('ALLOW');await until(async()=> (await state())?.index>=2,'origin access continuation');await message('STOP');console.log('PASS: unlisted origin pauses; granting access resumes');
    await settings(origin+'/cross-frame-start');const embedded=await start();
    await until(async()=> (await state())?.status==='needs_access','cross-origin embedded access');
    await popup.reload();
    const downloadEvent=popup.waitForEvent('download');await popup.locator('#diagnostics').click();const download=await downloadEvent;
    const diagnostics=JSON.parse(await fs.readFile(await download.path(),'utf8'));
    assert.equal(diagnostics.status,'needs_access');assert.ok(!JSON.stringify(diagnostics).includes(origin));assert.ok(!JSON.stringify(diagnostics).includes(embeddedOrigin));assert.equal(diagnostics.version,extensionVersion);
    await popup.locator('#allow').click();await until(async()=> (await state())?.index>=2,'step 2 inside cross-origin frame',30000);await message('PAUSE');
    assert.equal(await embedded.locator('#outside-other').isChecked(),false);
    assert.equal(await embedded.frameLocator('iframe[data-testid="interop-iframe"]').locator('#random-survey').isChecked(),true);
    await message('STOP');console.log('PASS: step 2 resumes after cross-origin frame access; diagnostics omit private URLs');
    const otherBeforeDirect=events.filter(e=>e.name==='other').length;
    await settings(origin+'/direct-start');const direct=await start();await until(async()=> (await state())?.index>=2,'step 2 on direct page',20000);await message('PAUSE');
    await until(()=>events.filter(e=>e.name==='other').length>otherBeforeDirect,'direct page checkbox event');assert.equal(await direct.locator('iframe').count(),0);await message('STOP');
    console.log('PASS: step 2 works when the redirected survey opens directly without an iframe');
    await settings(origin+'/slow-start');const slow=await start();await until(async()=> (await state())?.index>=2,'control ready while resource loads',10000);await message('PAUSE');
    assert.equal(slowDelivered(),false,'a background image must not block automation');
    assert.notEqual(await slow.frameLocator('iframe').locator('body').evaluate(()=>document.readyState),'complete');
    await message('STOP');await slow.waitForTimeout(400);
    const before=await Promise.all(slow.frames().map(f=>f.evaluate(()=>globalThis.PrivateWorkflow?.metrics.queries||0)));
    await slow.waitForTimeout(1000);
    const after=await Promise.all(slow.frames().map(f=>f.evaluate(()=>globalThis.PrivateWorkflow?.metrics.queries||0)));
    assert.deepEqual(after,before);console.log('PASS: ready controls proceed while an image loads; stopped runner performs zero further DOM queries');
    await settings(origin+'/ambiguous');const ambiguous=await start();await ambiguous.waitForTimeout(1500);assert.equal((await state()).index,0);assert.equal((await state()).phase,'waiting');await message('STOP');console.log('PASS: duplicate matches do not click');
    await settings(origin+'/empty',{stepTimeoutSeconds:10});await start();await until(async()=> (await state())?.status==='error','missing element timeout',18000);assert.equal((await state()).index,0);console.log('PASS: missing controls time out without skipping');
    const inactive=await context.newPage();await inactive.goto(origin+'/empty');const denied=await inactive.evaluate(()=>chrome.runtime.sendMessage({type:'START'}));assert.match(denied.error,/only from the extension/);console.log('PASS: website context cannot issue start controls');
    await options.screenshot({path:path.join(root,'..','qa-settings.png'),fullPage:true});await popup.setViewportSize({width:398,height:700});await popup.screenshot({path:path.join(root,'..','qa-popup.png')});
    console.log('All simulated-browser checks passed.');
  }catch(e){console.error('Browser regression failed:',e.message);throw e;
  }finally{if(browser)await browser.close();server.close();other.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
