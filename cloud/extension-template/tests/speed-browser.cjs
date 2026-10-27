// Measures the shipped runner on the same local 14-step fixture each time.
// WORKFLOW_ROOT can point to a previous build for a like-for-like comparison.
const {chromium} = require('playwright');
const path = require('node:path');
const assert = require('node:assert/strict');
const {events, serve, until} = require('./fixture.cjs');

(async () => {
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox']});
    const context = await browser.newContext();
    const root = path.resolve(process.env.WORKFLOW_ROOT || path.join(__dirname, '..'));
    const runtime = await require('./chrome-bridge.cjs')(context, root, origin);
    const controls = await context.newPage();
    await controls.goto(origin + '/__extension/benchmark.html');
    const send = (type, payload = {}) => controls.evaluate(async ([type, payload]) => {
      const result = await chrome.runtime.sendMessage({type, ...payload});
      if (result.error) throw Error(result.error);
      return result;
    }, [type, payload]);
    const settleMilliseconds = Number(process.env.SETTLE_MS || runtime.config.settleMilliseconds);
    await send('SAVE_SETTINGS', {settings: {startUrl: origin + '/start', settleMilliseconds}});
    await controls.evaluate(origin => { const u = new URL(origin); return chrome.permissions.request({origins: [`${u.protocol}//${u.hostname}/*`]}); }, origin);
    const workflow = await context.newPage(); await workflow.goto(origin + '/start');
    const started = Date.now();
    await send('START');
    await until(() => {if (runtime.store.run?.status === 'error') throw Error(runtime.store.run.message); return runtime.store.run?.status === 'finished';}, '14-step speed fixture', 60000);
    await until(() => events.some(e => e.name === 'finish'), 'final website event');
    const milliseconds = Date.now() - started;
    assert.deepEqual(events.map(e => e.name), ['premium', 'other', 'next', 'career', 'redeem', 'individual', 'confirm-individual', 'monthly', 'upi', 'qr', 'continue', 'finish']);
    assert.equal(events.find(e => e.name === 'continue').value, runtime.store.run.values.pincode);
    if (process.env.MAX_SECONDS) assert.ok(milliseconds < Number(process.env.MAX_SECONDS) * 1000, `Run took ${milliseconds}ms`);
    console.log(JSON.stringify({settleMilliseconds, milliseconds, actions: runtime.config.steps.length, exactSequence: true}));
  } finally {
    await browser?.close();
    server.close();
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
