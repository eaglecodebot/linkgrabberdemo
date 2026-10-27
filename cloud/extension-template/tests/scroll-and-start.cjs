const {chromium} = require('playwright');
const path = require('node:path');
const assert = require('node:assert/strict');
const {events,serve,until} = require('./fixture.cjs');
(async()=>{
  const server=await serve(),origin=`http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
    const context=await browser.newContext();
    const runtime=await require('./chrome-bridge.cjs')(context,path.resolve(__dirname,'..'),origin);
    const fullSteps=structuredClone(runtime.config.steps);runtime.config.steps=fullSteps.slice(7);
    const controls=await context.newPage();await controls.goto(origin+'/__extension/controls.html');
    const send=(type,payload={})=>controls.evaluate(([type,payload])=>chrome.runtime.sendMessage({type,...payload}),[type,payload]);
    await controls.evaluate(()=>chrome.permissions.request({origins:['http://127.0.0.1/*']}));
    await send('SAVE_SETTINGS',{settings:{startUrl:origin+'/lazy-checkout',settleMilliseconds:200}});
    const page=await context.newPage();await page.goto(origin+'/lazy-checkout');
    await page.evaluate(()=>{window.keptPage='SAME_DOCUMENT';});const pages=context.pages().length;
    const started=await send('START',{tabId:runtime.ids.get(page)});assert.ok(!started.error,started.error);
    await until(()=>{if(runtime.store.run?.status==='error')throw Error(runtime.store.run.message);return runtime.store.run?.status==='finished';},'scroll and saved-payment checkout',30000);
    await until(()=>events.some(e=>e.name==='finish'),'one final click');
    assert.equal(context.pages().length,pages);assert.equal(await page.evaluate(()=>window.keptPage),'SAME_DOCUMENT');
    assert.deepEqual(events.map(e=>e.name),['monthly','lazy-mounted','upi','qr','continue','saved','finish']);
    assert.ok(events.find(e=>e.name==='finish').value.wait>=900);
    await page.waitForTimeout(900);assert.equal(events.filter(e=>e.name==='finish').length,1);
    const stopped=await page.evaluate(()=>({...PrivateWorkflow.metrics}));await page.waitForTimeout(800);
    assert.deepEqual(await page.evaluate(()=>({...PrivateWorkflow.metrics})),stopped);
    console.log('PASS: no duplicate tab/reload; nested scrolling reveals lazy UPI and reaches the final button without manual scrolling');
    console.log('PASS: final CTA waits for payment saving even when it was already present, clicks once, then stops all scrolling');

    runtime.config.steps=[{...fullSteps.find(s=>s.id==='finish'),final:true}];runtime.reloadWorker();
    await send('SAVE_SETTINGS',{settings:{startUrl:origin+'/invalid-final',settleMilliseconds:200}});
    await page.goto(origin+'/invalid-final');await send('START',{tabId:runtime.ids.get(page)});
    await page.waitForTimeout(1100);assert.equal(runtime.store.run.phase,'waiting');assert.equal(runtime.store.run.status,'running');
    const before=events.filter(e=>e.name==='finish').length;
    await page.locator('#required-email').fill('test@example.test');
    await until(()=>runtime.store.run?.status==='finished','valid final form');
    await until(()=>events.filter(e=>e.name==='finish').length===before+1,'valid form submission');
    console.log('PASS: an invalid final form is not falsely marked sent; completing it permits one submission');
  } finally {await browser?.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
