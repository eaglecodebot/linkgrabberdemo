// Developer test. Requires Playwright and a Chromium binary supporting extensions.
// Run: CHROMIUM_PATH=/path/to/chromium node tests/browser-smoke.cjs
const {chromium} = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const baseDir = path.resolve(__dirname, '..');
const {events,serve,until,setAlternateOrigin}=require('./fixture.cjs');
(async () => {
  const server=await serve(), other=await serve();
  const origin=`http://127.0.0.1:${server.address().port}`; const alternateOrigin=`http://127.0.0.1:${other.address().port}`; setAlternateOrigin(alternateOrigin);
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'workflow-extension-test-'));
  const extension=path.join(temp,'extension');
  await fs.cp(baseDir,extension,{recursive:true,filter:src=>!src.includes(path.sep+'tests')});
  const manifest=JSON.parse(await fs.readFile(path.join(extension,'manifest.json'),'utf8'));
  // Only this disposable test copy has localhost access pre-granted.
  manifest.host_permissions=['http://127.0.0.1/*'];
  await fs.writeFile(path.join(extension,'manifest.json'),JSON.stringify(manifest));
  let context;
  try {
    console.log('Launching Chromium with the test extension…');
    context=await chromium.launchPersistentContext(path.join(temp,'profile'),{executablePath:process.env.CHROMIUM_PATH,headless:true,ignoreDefaultArgs:['--disable-extensions','--disable-component-extensions-with-background-pages'],args:['--no-sandbox','--enable-unsafe-extension-debugging',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
    console.log('Chromium launched. Waiting for extension worker…');
    await new Promise(r=>setTimeout(r,1500));
    if(!context.serviceWorkers().length) {
      try { const cdp=await context.newCDPSession(context.pages()[0]); console.log('CDP extension load:',await cdp.send('Extensions.loadUnpacked',{path:extension})); }
      catch(e) { console.log('CDP extension loading unavailable:',e.message); }
    }
    let worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker',{timeout:8000});
    const extensionId=new URL(worker.url()).host;
    const options=await context.newPage(); await options.goto(`chrome-extension://${extensionId}/options.html`);
    const popup=await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    // Keep this regular test tab available between runs; real action popups close.
    await popup.addInitScript(()=>{window.close=()=>{globalThis.__popupCloseRequested=true;};});
    const message=(type,body={})=>options.evaluate(async ([type,body])=>{const r=await chrome.runtime.sendMessage({type,...body});if(r.error)throw new Error(r.error);return r},[type,body]);
    const state=async()=> (await message('GET_STATUS')).run;
    async function settings(startUrl,extra={}) { await message('SAVE_SETTINGS',{settings:{startUrl,additionalOrigins:[],stepTimeoutSeconds:20,settleMilliseconds:250,pincodeMode:'random',pincode:'',pincodeSelector:'',delhiPincodes:['110001','110002','110003'],...extra}}); }
    async function start() { const previous=(await state())?.id,page=await context.newPage();await page.goto((await message('GET_STATUS')).config.startUrl);await page.bringToFront();const count=context.pages().length;await popup.reload();await popup.locator('#start').click();assert.equal(context.pages().length,count);await until(async()=> (await state())?.id!==previous,'fresh run established');return page; }
    const idle=await context.newPage(); await idle.goto(origin+'/start'); await idle.waitForTimeout(1200);
    assert.equal(events.length,0); console.log('PASS: visiting the page does not start a run');
    // Exercise the actual Settings form once, including the extension-page sender check.
    await options.locator('#startUrl').fill(origin+'/start'); await options.locator('#settleMilliseconds').fill('250');
    await options.locator('button[type=submit]').click(); await options.locator('#saved').filter({hasText:'Saved.'}).waitFor();
    await settings(origin+'/start');
    const page=await start();
    await until(async()=> (await state())?.index===2,'survey selected');
    await message('PAUSE'); const paused=await state(); assert.equal(paused.status,'paused');
    const pinned=paused.values.pincode;
    await page.reload(); await page.waitForTimeout(1000); assert.equal((await state()).index,2); assert.equal(events.filter(e=>e.name==='next').length,0);
    await message('RESUME');
    await until(async()=> (await state())?.status==='finished','all 14 steps finished',45000);
    await until(()=>events.some(e=>e.name==='finish'),'final website event');
    const expected=['premium','other','next','career','redeem','individual','confirm-individual','monthly','upi','qr','continue','finish'];
    expected.splice(2,0,'other'); // The survey choice is restored after refresh.
    assert.deepEqual(events.map(e=>e.name),expected); assert.equal(events.find(e=>e.name==='continue').value,pinned);
    await page.waitForURL('**/done'); await page.reload(); await page.waitForTimeout(900); assert.equal(events.filter(e=>e.name==='finish').length,1);
    console.log('PASS: 14 steps, delayed controls, generated IDs, SPA change, full navigation, pause + refresh + resume, native typing, single final click');
    // Page refresh while actively waiting for a delayed first control.
    await settings(origin+'/start'); const refreshed=await start(); await refreshed.waitForLoadState('load'); await refreshed.reload();
    await until(async()=> (await state())?.index>=1,'active refresh resumed'); await message('STOP');
    console.log('PASS: active refresh keeps progress');
    await settings(origin+'/cross-start'); const cross=await start();
    await until(async()=> (await state())?.status==='needs_access','cross-origin pause');
    assert.equal(await cross.frameLocator('iframe[data-testid="interop-iframe"]').locator('#random-survey').isChecked(),false);
    await message('ALLOW'); await until(async()=> (await state())?.index>=2,'cross-origin continuation'); await message('STOP');
    console.log('PASS: new origin pauses; explicit access resumes the same step');
    await settings(origin+'/ambiguous'); const ambiguous=await start(); await ambiguous.waitForTimeout(1500);
    assert.equal((await state()).index,0); assert.equal((await state()).phase,'waiting');
    await message('STOP'); console.log('PASS: duplicate matching controls are never clicked');
    await settings(origin+'/empty',{stepTimeoutSeconds:10}); await start();
    await until(async()=> (await state())?.status==='error','missing control timeout',18000);
    assert.equal((await state()).index,0); console.log('PASS: a missing control times out without skipping steps');
    const inactive=await context.newPage();await inactive.goto(origin+'/empty');
    const inactiveTabId=await options.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,origin+'/empty');
    const denied=await worker.evaluate(async tabId=>(await chrome.scripting.executeScript({target:{tabId},func:async()=>await chrome.runtime.sendMessage({type:'START'})}))[0].result,inactiveTabId);
    assert.match(denied.error,/only from the extension/);
    await options.screenshot({path:path.join(baseDir,'..','qa-settings.png'),fullPage:true});
    console.log('All browser smoke checks passed.');
  } finally { if(context)await context.close(); server.close(); other.close(); await fs.rm(temp,{recursive:true,force:true}); }
})().catch(e=>{console.error(e);process.exitCode=1;});
