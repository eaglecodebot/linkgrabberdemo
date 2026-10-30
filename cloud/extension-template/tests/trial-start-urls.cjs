// Real Chromium DOM + shipped options/popup/runner; test-only chrome.* bridge.
const {chromium} = require('playwright');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const {events, serve, until} = require('./fixture.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const server = await serve(), origin = `http://127.0.0.1:${server.address().port}`;
  const alternateOrigin = `http://localhost:${server.address().port}`;
  const original = server.listeners('request').at(-1);
  server.removeAllListeners('request');
  server.on('request', async (req, res) => {
    if (req.url.startsWith('/__extension/')) {
      const name = req.url.slice('/__extension/'.length);
      if (!/^[a-z.-]+$/.test(name)) {res.statusCode=404;res.end();return;}
      res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(await fs.readFile(path.join(root, name)));return;
    }
    const redirects = {'/trial-entry':'/trial-ready', '/trial-cross-entry':alternateOrigin+'/trial-ready', '/trial-unlisted-entry':'/trial-ready/child'};
    if (redirects[req.url]) {res.writeHead(302, {Location:redirects[req.url]});res.end();return;}
    if (['/trial-ready','/trial-spa-entry','/trial-empty','/trial-ready/child'].includes(req.url)) {
      const spa = req.url === '/trial-spa-entry', empty = req.url === '/trial-empty';
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.end(`<!doctype html><meta charset="utf-8"><style>body{padding:30px}a{display:inline-block;padding:15px}</style><main></main><script>
        window.originalDocumentMarker='PRESERVE';
        ${spa ? "setTimeout(()=>history.replaceState({},'', '/trial-spa-ready'),250);" : ''}
        ${empty ? '' : `setTimeout(()=>{document.querySelector('main').innerHTML='<a href="/survey-shell"><p>Access exclusive tools &amp; insights</p><p>Try Premium for ₹0</p></a>';document.querySelector('a').onclick=()=>{sessionStorage.setItem('originalDocumentMarker',window.originalDocumentMarker);fetch('/event',{method:'POST',body:JSON.stringify({name:'premium',path:location.pathname})})}},700);`}
      </script>`);return;
    }
    original(req,res);
  });
  let browser;
  try {
    browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH, headless:true, args:['--no-sandbox']});
    const context = await browser.newContext({viewport:{width:1280,height:800}});
    const runtime = await require('./chrome-bridge.cjs')(context,root,origin);
    const options = await context.newPage();await options.goto(origin+'/__extension/options.html');
    const aliases = [origin+'/trial-ready', origin+'/trial-spa-ready', alternateOrigin+'/trial-ready', origin+'/trial-empty'];
    await options.locator('#startUrl').fill(origin+'/trial-entry');
    await options.locator('#trialAlternateUrls').fill(aliases.join('\n'));
    await options.locator('button[type=submit]').click();await options.locator('#saved').filter({hasText:'Saved.'}).waitFor();
    assert.deepEqual(runtime.store.settings.trialAlternateUrls,aliases);
    await options.reload();await until(async()=>await options.locator('#trialAlternateUrls').inputValue()===aliases.join('\n'),'alternate settings round trip');
    await options.locator('#trialAlternateUrls').fill('javascript:alert(1)');
    await options.locator('button[type=submit]').click();await options.locator('#error').filter({hasText:'HTTP or HTTPS'}).waitFor();
    assert.deepEqual(runtime.store.settings.trialAlternateUrls,aliases,'invalid input must not replace saved URLs');
    await options.reload();
    const popup = await context.newPage();await popup.addInitScript(()=>{window.close=()=>{globalThis.closedAfterStart=true;};});
    await popup.goto(origin+'/__extension/popup.html');
    const send = (type,payload={})=>options.evaluate(([type,payload])=>chrome.runtime.sendMessage({type,...payload}),[type,payload]);
    const configure = async primary=>{const result=await send('SAVE_SETTINGS',{settings:{startUrl:primary,trialAlternateUrls:aliases}});assert.ok(!result.error,result.error);};
    const start = async()=>{await popup.reload();await popup.locator('#start').click();await until(()=>popup.evaluate(()=>globalThis.closedAfterStart),'popup closes');};
    const waitFirst = async()=>until(()=>{if(runtime.store.run?.status==='error')throw Error(runtime.store.run.message);return events.some(e=>e.name==='premium');},'first control clicked on accepted page');
    for (const primary of [origin+'/trial-entry', origin+'/trial-cross-entry', origin+'/trial-spa-entry']) {
      events.length=0;await configure(primary);
      const website=await context.newPage();await website.goto('about:blank');
      const count=context.pages().length,before=runtime.navigationUpdates.length;
      await start();await waitFirst();
      assert.deepEqual(runtime.navigationUpdates.slice(before),[{tabId:runtime.ids.get(website),url:primary}],'extension must navigate only to the primary URL');
      assert.equal(context.pages().length,count);assert.equal(events.filter(e=>e.name==='premium').length,1);
      assert.equal(events.find(e=>e.name==='premium').path,primary.endsWith('/trial-spa-entry')?'/trial-spa-ready':'/trial-ready');
      assert.ok(runtime.store.run.allowedOrigins.includes(alternateOrigin));
      if(primary.endsWith('/trial-entry')) {
        await until(()=>{if(runtime.store.run.status==='error')throw Error(runtime.store.run.message);return runtime.store.run.status==='finished';},'redirected full Trial reaches QR',45000);
        assert.equal(events.filter(e=>e.name==='finish').length,1);assert.equal(events.some(e=>e.name.startsWith('WRONG')),false);
      } else await send('STOP');
      await website.close();
    }
    console.log('PASS: real HTTP, cross-origin and SPA redirects; only primary opened; delayed control; full redirected Trial reaches loaded QR');
    for (const selected of [true,false]) {
      events.length=0;await configure(origin+'/trial-entry');
      const website=await context.newPage();await website.goto((selected?origin:alternateOrigin)+'/trial-ready');
      await website.evaluate(()=>{window.originalDocumentMarker='KEEP_EXISTING';});
      const blank=selected?null:await context.newPage();if(blank)await blank.goto('about:blank');
      const count=context.pages().length,before=runtime.navigationUpdates.length;
      await start();await waitFirst();
      assert.equal(runtime.store.run.tabId,runtime.ids.get(website));assert.equal(runtime.navigationUpdates.length,before);
      assert.equal(await website.evaluate(()=>sessionStorage.getItem('originalDocumentMarker')),'KEEP_EXISTING');
      assert.equal(context.pages().length,count);if(blank)assert.equal(blank.url(),'about:blank');
      await send('STOP');await website.close();await blank?.close();
    }
    console.log('PASS: selected/background alternate tab reused without reloading; actual popup/settings work and invalid input is rejected');
    for (const primary of [origin+'/trial-empty',origin+'/trial-unlisted-entry']) {
      events.length=0;await configure(primary);
      const website=await context.newPage();await website.goto('about:blank');await start();
      await website.waitForURL(primary.endsWith('/trial-empty')?'**/trial-empty':'**/trial-ready/child');
      await website.waitForTimeout(1300);
      assert.equal(runtime.store.run.index,0);assert.equal(runtime.store.run.phase,'waiting');assert.equal(events.some(e=>e.name==='premium'),false);
      assert.equal(runtime.store.run.status,'running');await send('STOP');await website.close();
    }
    console.log('PASS: accepted page without the control waits; unlisted sibling with the control cannot start Trial');
  } finally {await browser?.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
