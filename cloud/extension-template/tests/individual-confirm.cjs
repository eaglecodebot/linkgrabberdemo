// Exercise text-independent Individual continuation through checkout/QR with
// the actual extension sources. The private production website is not used.
const {chromium} = require('playwright');
const path = require('node:path');
const assert = require('node:assert/strict');
const {events, serve, until} = require('./fixture.cjs');
const root = path.resolve(__dirname, '..');
const pageHTML = body => `<!doctype html><meta charset="utf-8"><style>body{font:16px system-ui;padding:25px}button,label{display:inline-block;margin:15px;padding:15px}iframe{width:100%;height:550px}</style>${body}<script>const record=(name)=>fetch('/event',{method:'POST',body:JSON.stringify({name})});</script>`;
const pricing = label => pageHTML(`<section role="dialog">
  <label>Individual<input id="premium-pricing-modal__card-0" type="radio" name="premium-pricing-modal__card-selection" value="0"></label>
  <button id="confirm" class="artdeco-button artdeco-button--primary" data-view-name="premium-chooser-pricing-modal-cta" disabled aria-disabled="true" aria-busy="true">${label}</button>
  <button type="button" id="close-plan" aria-label="Close" class="artdeco-button artdeco-button--secondary">Close</button>
  <div id="duplicates"></div></section>
  <button data-view-name="premium-chooser-pricing-modal-cta" id="old-trial">Start trial for ₹0</button>
  <button id="outside-submit">Submit</button><button id="outside-redeem">Redeem 1 month for ₹0</button>
  <button data-test-place-order-btn id="early-final">Start my free trial</button>
  <script>
  document.querySelector('input').onchange=()=>record('individual');
  document.querySelector('#old-trial').onclick=()=>record('WRONG_OLD_TRIAL');
  document.querySelector('#close-plan').onclick=()=>record('WRONG_CLOSE');
  document.querySelector('#outside-submit').onclick=()=>record('WRONG_OUTSIDE_SUBMIT');
  document.querySelector('#outside-redeem').onclick=()=>record('WRONG_OUTSIDE_REDEEM');
  document.querySelector('#early-final').onclick=()=>record('WRONG_EARLY_FINAL');
  document.querySelector('#confirm').onclick=()=>{record('confirm-individual');if(window===top)location.href='/checkout';else parent.postMessage({kind:'confirm-checkout'},'*')};
  </script>`);
(async () => {
  const server = await serve(), embeddedServer = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const embeddedOrigin = `http://localhost:${embeddedServer.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox']});
    const context = await browser.newContext();
    let currentLabel = 'Confirm';
    await context.route('**/confirm-*', async route => {
      const name = new URL(route.request().url()).pathname;
      let html;
      if (name.startsWith('/confirm-start-')) {
        const target = name.endsWith('frame') ? '/confirm-shell' : '/confirm-main';
        html = pageHTML(`<a href="${target}">Access exclusive tools &amp; insights Try Premium for ₹0</a>`);
      } else if (name === '/confirm-shell') {
        html = pageHTML(`<button onclick="record('WRONG_PARENT_CONFIRM')">Confirm</button><iframe data-testid="interop-iframe" src="${embeddedOrigin}/confirm-pricing"></iframe><script>addEventListener('message',e=>{if(e.source===document.querySelector('iframe').contentWindow&&e.data?.kind==='confirm-checkout')location.href='/checkout'});</script>`);
      } else html = pricing(currentLabel);
      await route.fulfill({contentType: 'text/html', body: html});
    });
    const runtime = await require('./chrome-bridge.cjs')(context, root, origin);
    const original = structuredClone(runtime.config.steps);
    const confirmation = original[6];
    assert.equal(confirmation.id, 'confirm-individual');
    assert.equal(confirmation.title, 'Continue with the Individual plan');
    assert.equal(original[12].title, 'Click Start my free trial');
    runtime.config.steps = [original[0], ...original.slice(5)];
    runtime.reloadWorker();
    const controls = await context.newPage(); await controls.goto(origin + '/__extension/controls.html');
    const send = (type, payload = {}) => controls.evaluate(([type, payload]) => chrome.runtime.sendMessage({type, ...payload}), [type, payload]);
    await controls.evaluate(() => chrome.permissions.request({origins: ['http://127.0.0.1/*', 'http://localhost/*']}));
    for (const label of ['Confirm', 'Start free trial', 'An entirely different continuation label']) for (const layout of ['frame', 'main']) {
      currentLabel = label;
      events.length = 0;
      const startUrl = origin + '/confirm-start-' + layout;
      const saved = await send('SAVE_SETTINGS', {settings: {startUrl, additionalOrigins: [embeddedOrigin], settleMilliseconds: 200}});
      assert.ok(!saved.error, saved.error);
      const page = await context.newPage(); await page.goto(startUrl);
      const started = await send('START', {tabId: runtime.ids.get(page)}); assert.ok(!started.error, started.error);
      await until(() => runtime.store.run?.index === 2 && runtime.store.run?.phase === 'waiting', 'Individual selected before Confirm');
      const target = layout === 'frame' ? page.frames().find(frame => frame.url() === embeddedOrigin + '/confirm-pricing') : page.mainFrame();
      assert.ok(target);
      const matchedLabels = await target.evaluate(step => {
        const button=document.querySelector('#confirm'),saved=button.textContent;
        const results=['Confirm','Submit','Redeem 1 month for ₹0','Start free trial','Completely unknown wording'].map(text=>{
          button.textContent=text;
          return PrivateWorkflow.resolve({...step,context:[]},{index:2},{includeUnready:true}).element?.id;
        });button.textContent=saved;return results;
      },confirmation);
      assert.deepEqual(matchedLabels,Array(5).fill('confirm'));
      await page.waitForTimeout(650);
      assert.equal(events.some(event => event.name !== 'individual'), false, 'no checkout/final/decoy action before Confirm');
      await target.locator('#confirm').evaluate(button => {button.disabled = false;});
      await page.waitForTimeout(650);
      assert.equal(runtime.store.run.index, 2, 'ARIA disabled must still block Confirm');
      await target.locator('#confirm').evaluate(button => button.removeAttribute('aria-disabled'));
      await page.waitForTimeout(650);
      assert.equal(runtime.store.run.index, 2, 'busy state must still block Confirm');
      if (layout === 'main') {
        // The captured primary styling is a text-independent fallback within
        // the Individual dialog. It cannot escape to the outside old CTA.
        await target.evaluate(() => {
          const button = document.querySelector('#confirm'); button.removeAttribute('data-view-name');
          button.classList.remove('artdeco-button--primary');
          button.removeAttribute('aria-busy');
        });
        await page.waitForTimeout(700);
        assert.equal(runtime.store.run.index,2,'missing dialog CTA must not use the captured outside button');
        await target.evaluate(label => {
          const button = document.querySelector('#confirm');button.classList.add('artdeco-button--primary');
          const duplicate = document.createElement('button');
          duplicate.className='artdeco-button--primary';
          duplicate.textContent = label === 'Submit' ? 'Redeem 1 month for ₹0' : 'Submit';
          document.querySelector('#duplicates').append(duplicate);
        }, label);
        await page.waitForTimeout(900);
        assert.equal(runtime.store.run.index, 2, 'duplicate confirmations must wait');
        await target.locator('#duplicates').evaluate(element => element.replaceChildren());
      } else {
        await page.evaluate(() => {
          const cover = document.createElement('div'); cover.id = 'cover';
          cover.style.cssText = 'position:fixed;inset:0;z-index:999999;background:#0001'; document.body.append(cover);
        });
        await target.locator('#confirm').evaluate(button => button.removeAttribute('aria-busy'));
        await page.waitForTimeout(900);
        assert.equal(runtime.store.run.index, 2, 'parent overlay must block embedded Confirm');
        await page.locator('#cover').evaluate(element => element.remove());
      }
      await until(() => {if (runtime.store.run?.status === 'error') throw Error(runtime.store.run.message); return runtime.store.run?.status === 'finished';}, 'Confirm then checkout completed', 30000);
      await until(() => events.some(event => event.name === 'finish'), 'website final action');
      assert.deepEqual(events.map(event => event.name), ['individual', 'confirm-individual', 'monthly', 'upi', 'qr', 'continue', 'finish']);
      await page.waitForTimeout(600);
      assert.equal(events.filter(event => event.name === 'confirm-individual').length, 1);
      assert.equal(events.filter(event => event.name === 'finish').length, 1);
      console.log(`PASS: ${layout} layout selects Individual, waits for ${label}, clicks it once, then completes checkout; unrelated controls stay untouched`);
      await page.close();
    }
  } finally {await browser?.close(); server.close(); embeddedServer.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
