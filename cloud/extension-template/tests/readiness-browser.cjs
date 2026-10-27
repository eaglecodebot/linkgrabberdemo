// Fast timing must still wait for motion to stop and for the intended field.
const {chromium} = require('playwright');
const path = require('node:path');
const assert = require('node:assert/strict');
const {events, serve, until} = require('./fixture.cjs');
(async () => {
  const server = await serve(), origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox']});
    const context = await browser.newContext();
    const runtime = await require('./chrome-bridge.cjs')(context, path.resolve(__dirname, '..'), origin);
    const controls = await context.newPage(); await controls.goto(origin + '/__extension/readiness.html');
    const send = (type, payload = {}) => controls.evaluate(([type, payload]) => chrome.runtime.sendMessage({type, ...payload}), [type, payload]);
    await send('SAVE_SETTINGS', {settings: {startUrl: origin + '/moving', settleMilliseconds: 200}});
    await controls.evaluate(() => chrome.permissions.request({origins: ['http://127.0.0.1/*']}));
    const workflow = await context.newPage(); await workflow.goto(origin + '/moving');
    await send('START'); await until(() => events.some(e => e.name === 'motion'), 'moving control click');
    const motion = events.find(e => e.name === 'motion').value;
    assert.equal(motion.moves, 8);
    assert.ok(motion.stillFor >= 200, `Clicked after only ${motion.stillFor}ms still`);
    await send('STOP');
    console.log('PASS: fastest timing still waits for control movement to finish');

    const page = runtime.tabs.get(runtime.store.run.tabId);
    await page.goto(origin + '/checkout');
    await page.addScriptTag({path: path.resolve(__dirname, '../engine.js')});
    const step = runtime.config.steps.find(step => step.id === 'pincode');
    const result = await page.evaluate(step => {
      const E = globalThis.PrivateWorkflow, find = () => E.resolve(step, {index: 10, values: {pincode: '110001'}}).element?.id || null;
      document.querySelector('#upi-form').hidden = false;
      const referenceOnly = find();
      document.querySelector('#fields').innerHTML = '<input id="real-postal" name="postalCode" type="text">';
      const semantic = find();
      document.querySelector('#fields').innerHTML = '<label for="real-pin">Pin code</label><input id="real-pin" type="text">';
      const capturedLabel = find();
      document.querySelector('#fields').innerHTML += '<label for="other-pin">Pin code</label><input id="other-pin" type="text">';
      return {referenceOnly, semantic, capturedLabel, duplicate: find(), unrelated: document.querySelector('#unrelated').value, reference: document.querySelector('#reference').value};
    }, step);
    assert.deepEqual(result, {referenceOnly: null, semantic: 'real-postal', capturedLabel: 'real-pin', duplicate: null, unrelated: 'KEEP_ME', reference: 'LEAVE_THIS'});
    console.log('PASS: waits for Pin code, scopes semantic fallback, and rejects ambiguous fields');
  } finally {await browser?.close(); server.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
