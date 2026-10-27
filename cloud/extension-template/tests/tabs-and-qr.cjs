// Real Chromium DOM + shipped popup/background/content, with chrome.* bridged.
const {chromium} = require('playwright');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const {events, serve, until} = require('./fixture.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const server = await serve(), origin = `http://127.0.0.1:${server.address().port}`;
  const original = server.listeners('request').at(-1);
  server.removeAllListeners('request');
  server.on('request', async (req, res) => {
    if (!req.url.startsWith('/__extension/')) return original(req, res);
    const name = req.url.slice('/__extension/'.length);
    if (!/^[a-z.-]+$/.test(name)) {res.statusCode = 404;res.end();return;}
    try {res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');res.end(await fs.readFile(path.join(root, name)));}
    catch {res.statusCode = 404;res.end();}
  });
  let browser;
  try {
    browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox']});
    const context = await browser.newContext({viewport: {width: 1280, height: 800}});
    const runtime = await require('./chrome-bridge.cjs')(context, root, origin);
    const options = await context.newPage(); await options.goto(origin + '/__extension/options.html');
    const popup = await context.newPage();
    await popup.addInitScript(() => {window.close = () => {globalThis.closedAfterStart = true;};});
    await popup.goto(origin + '/__extension/popup.html');
    const send = (type, payload = {}) => options.evaluate(([type, payload]) => chrome.runtime.sendMessage({type, ...payload}), [type, payload]);
    await options.evaluate(() => chrome.permissions.request({origins: ['http://127.0.0.1/*']}));
    const destination = origin + '/empty';
    await send('SAVE_SETTINGS', {settings: {startUrl: destination, step2StartUrl: destination, step2SecondUrl: origin + '/done', settleMilliseconds: 200}});
    for (const number of [1, 2]) {
      for (const initial of ['about:blank', origin + '/unrelated']) {
        const page = await context.newPage(); await page.goto(initial);
        const count = context.pages().length;
        await popup.reload(); await popup.locator(number === 1 ? '#start' : '#start2').click();
        await page.waitForURL(destination);
        await until(() => popup.evaluate(() => globalThis.closedAfterStart), 'popup auto hides');
        assert.equal(runtime.store.run.tabId, runtime.ids.get(page));
        assert.equal(context.pages().length, count, 'new/other tab must be reused');
        assert.equal(runtime.store.run.status, 'running');
        await send('STOP'); await page.close();
      }
      const matching = await context.newPage(); await matching.goto(destination);
      await matching.evaluate(() => {window.sameDocumentMarker = 'KEEP';});
      const selected = await context.newPage(); await selected.goto('about:blank');
      const count = context.pages().length, beforeUpdates = runtime.navigationUpdates.length;
      await popup.reload(); await popup.locator(number === 1 ? '#start' : '#start2').click();
      await until(() => runtime.store.run?.tabId === runtime.ids.get(matching) && runtime.store.run.status === 'running', 'matching tab reused');
      assert.equal(await matching.evaluate(() => window.sameDocumentMarker), 'KEEP');
      assert.equal(selected.url(), 'about:blank');assert.equal(context.pages().length, count);
      assert.equal(runtime.navigationUpdates.length, beforeUpdates, 'matching document must not reload');
      await send('STOP'); await matching.close(); await selected.close();
    }
    console.log('PASS: both real Start buttons reuse blank/unrelated tabs, prefer an existing matching tab, retain its document, and auto hide');

    events.length = 0;
    await send('SAVE_SETTINGS', {settings: {startUrl: origin + '/start', settleMilliseconds: 200}});
    const website = await context.newPage(); await website.goto('about:blank');
    const count = context.pages().length;
    await popup.reload(); await popup.locator('#start').click();
    await until(() => events.some(event => event.name === 'finish'), 'last checkout click', 45000);
    await send('PAUSE'); runtime.reloadWorker();
    await website.waitForURL('**/done'); await website.reload();
    await website.locator('img[data-test-upi-processing-upi-qr-code-image]').waitFor();
    await website.waitForTimeout(800);
    assert.equal(runtime.store.run.status, 'paused');
    assert.equal(events.filter(event => event.name === 'finish').length, 1);
    await website.evaluate(() => {
      document.querySelector('img').style.pointerEvents = 'none';
      const cover = document.createElement('div');cover.id = 'qr-cover';
      cover.style.cssText = 'position:fixed;inset:0;z-index:999999;background:#0001';document.body.append(cover);
    });
    await send('RESUME');
    await website.waitForTimeout(700);assert.equal(runtime.store.run.status, 'running', 'a covered QR cannot finish');
    await website.locator('#qr-cover').evaluate(element => element.remove());
    await until(() => {if (runtime.store.run.status === 'error') throw Error(runtime.store.run.message);return runtime.store.run.status === 'finished';}, 'loaded QR centered');
    const qr = await website.locator('img[data-test-upi-processing-upi-qr-code-image]').evaluate(image => {
      const rect = image.getBoundingClientRect();
      return {loaded: image.complete && image.naturalWidth > 0, centerError: Math.abs(rect.top + rect.height / 2 - innerHeight / 2), fullyVisible: rect.top >= 0 && rect.bottom <= innerHeight, spacerCount: document.querySelectorAll('[data-private-workflow-qr-space]').length};
    });
    assert.equal(qr.loaded, true);assert.equal(qr.fullyVisible, true);assert.ok(qr.centerError <= 4, JSON.stringify(qr));
    assert.equal(qr.spacerCount, 1, 'near-bottom QR needs only one small layout spacer');
    assert.equal(runtime.store.run.index, 13);assert.equal(context.pages().length, count);
    assert.equal(events.filter(event => event.name === 'finish').length, 1);
    assert.equal(events.some(event => event.name.startsWith('WRONG')), false);
    const imageChecks = await website.evaluate(step => {
      const E = PrivateWorkflow, image = document.querySelector('img'), task = {navigationChanged:true};
      const duplicate = image.cloneNode();image.after(duplicate);
      const ambiguous = E.resolve(step, task).element === null;duplicate.remove();
      image.style.opacity = '0';const transparent = E.postcondition(step, task);image.style.opacity = '';
      const imageSource = image.getAttribute('src');image.removeAttribute('src');
      const unloaded = E.resolve(step, task).element === null;image.setAttribute('src', imageSource);
      return {ambiguous, transparent, unloaded};
    }, runtime.config.steps.at(-1));
    assert.deepEqual(imageChecks, {ambiguous:true, transparent:false, unloaded:true});
    const metrics = await website.evaluate(() => ({...PrivateWorkflow.metrics}));
    await website.waitForTimeout(800);assert.deepEqual(await website.evaluate(() => ({...PrivateWorkflow.metrics})), metrics);
    await popup.reload();await popup.locator('#status').filter({hasText: 'QR code ready'}).waitFor();
    const diagnostics = (await send('DIAGNOSTICS')).diagnostics;
    assert.ok(!JSON.stringify(diagnostics).includes('/qr-image'));assert.ok(!JSON.stringify(diagnostics).includes(origin));
    console.log('PASS: complete Step 1 from blank; pause/refresh/worker restart after one last click; QR image loads, scrolls to viewport center near page end, is never clicked, then queries/scrolling stop');
  } finally {await browser?.close();server.close();}
})().catch(error => {console.error(error);process.exitCode = 1;});
