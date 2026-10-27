// State-machine regression tests, no dependencies beyond Node.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import * as shared from '../shared.js';
const defaults = JSON.parse(await fs.readFile(new URL('../workflow.json', import.meta.url), 'utf8'));
const source = (await fs.readFile(new URL('../background.js', import.meta.url), 'utf8')).replace(/^import .*?;\n/gm, '');
const event = () => ({listeners: [], addListener(fn) { this.listeners.push(fn); }});
function harness() {
  const data = {}, cfg = {...defaults, startUrl: 'https://private.example/start', steps: defaults.steps.map(step => ({...step, context: []}))};
  let chrome, reads = 0, respond = async () => undefined;
  let openTabs = [{id: 7, url: cfg.startUrl, active: true}], updates = [], creations = [];
  const clone = value => structuredClone(value);
  function restart() {
    chrome = {
      runtime: {id: 'test', getManifest: () => ({version: '1.2.0'}), getURL: s => `chrome-extension://test/${s}`, onMessage: event(), onStartup: event(), onInstalled: event()},
      storage: {local: {get: async key => { reads++; return {[key]: clone(data[key])}; }, set: async values => Object.assign(data, clone(values)), remove: async key => delete data[key], setAccessLevel: async () => {}}},
      permissions: {contains: async () => true},
      scripting: {getRegisteredContentScripts: async () => [], registerContentScripts: async () => {}, executeScript: async () => {}},
      tabs: {get: async id => {const t=openTabs.find(t=>t.id===id);if(!t)throw Error('Tab closed');return t;}, query: async q => openTabs.filter(t=>!q.active||t.active), create: async details => {creations.push(clone(details));const tab={id:Math.max(0,...openTabs.map(t=>t.id))+1,...details};openTabs.push(tab);return tab;}, update: async (id, details) => {updates.push({id,...details});}, sendMessage: async (...args) => respond(...args), onRemoved: event()},
      action: {setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}},
      alarms: {create: async () => {}, clear: async () => {}, onAlarm: event()},
      webNavigation: Object.fromEntries(['onCommitted', 'onDOMContentLoaded', 'onCompleted', 'onHistoryStateUpdated', 'onReferenceFragmentUpdated', 'onCreatedNavigationTarget'].map(k => [k, event()]))
    };
    const context = vm.createContext({...shared, grabIsRunning:()=>false, grabStatus:async()=>null, grabSetup:async()=>({owner:{username:'test'},settings:{pagePattern:'https://private.example/'}}), startGrab:async()=>({started:true}), chrome, crypto: webcrypto, Date, URL, fetch: async () => ({json: async () => clone(cfg)})});
    vm.runInContext(source, context);
  }
  const ui = {id: 'test', url: 'chrome-extension://test/options.html', tab: {id: 99}, frameId: 0};
  const page = {id: 'test', url: cfg.startUrl, tab: {id: 7}, frameId: 0, documentId: 'document-one'};
  async function send(type, body = {}, sender = ui) { return new Promise(resolve => chrome.runtime.onMessage.listeners[0]({type, ...body}, sender, resolve)); }
  const request = (type, body = {}, sender = page) => send(type, {runId: data.run.id, index: data.run.index, url: cfg.startUrl, ...body}, sender);
  restart();
  return {data, cfg, page, ui, restart, send, request, responder: fn => {respond=fn;}, setTabs: tabs => {openTabs=tabs;}, updates: () => updates, creations: () => creations, startup: () => chrome.runtime.onStartup.listeners[0](), reads: () => reads};
}
function configureStep2(h) {h.cfg.step2StartUrl='https://private.example/subscriptions';h.cfg.step2SecondUrl='https://refund.example/request';}
test('either workflow button starts a fresh run directly after Stop', async () => {
  for (const previous of [1,2]) for (const selected of [1,2]) {
    const h=harness();configureStep2(h);await h.send('START',{workflowNumber:previous,tabId:7});
    const oldId=h.data.run.id;h.data.run.index=4;await h.send('STOP');
    assert.match(h.data.run.message,/Click Trial or Cancel & Refund/);
    assert.ok(!(await h.send('START',{workflowNumber:selected,tabId:7})).error);
    assert.notEqual(h.data.run.id,oldId);assert.equal(h.data.run.index,0);assert.equal(h.data.run.phase,'waiting');
    assert.equal(h.data.run.config.workflowNumber,selected);
  }
});
test('a stopped workflow recovers missing URLs while using current action definitions', async () => {
  for (const number of [1,2]) {
    const h=harness();configureStep2(h);await h.send('START',{workflowNumber:number,tabId:7});
    const savedUrl=h.data.run.config.startUrl,savedSecond=h.data.run.config.secondUrl;
    await h.send('STOP');h.data.run.config.steps=[{id:'obsolete-action'}];h.data.run.config.workflowRevision=0;
    if(number===1)h.cfg.startUrl='';else{h.cfg.step2StartUrl='';h.cfg.step2SecondUrl='';}
    h.restart();assert.ok(!(await h.send('START',{workflowNumber:number,tabId:7})).error);
    assert.equal(h.data.run.config.startUrl,savedUrl);assert.equal(h.data.run.config.secondUrl,savedSecond);
    assert.equal(h.data.run.config.workflowRevision,defaults.workflowRevision);assert.notEqual(h.data.run.config.steps[0].id,'obsolete-action');
    await h.send('STOP');const replacement='https://new.example/start';
    if(number===1)h.cfg.startUrl=replacement;else{h.cfg.step2StartUrl=replacement;h.cfg.step2SecondUrl='https://new.example/refund';}
    h.restart();await h.send('START',{workflowNumber:number,tabId:7});assert.equal(h.data.run.config.startUrl,replacement);
  }
});
test('URL recovery never borrows another workflow or completes a partially changed URL pair', () => {
  const previous={config:{workflowNumber:2,startUrl:'https://old.example/start',secondUrl:'https://old.example/refund'}};
  const missing={...defaults,startUrl:'',step2StartUrl:'',step2SecondUrl:''};
  assert.equal(shared.workflowConfig(missing,1,previous).startUrl,'');
  const partial=shared.workflowConfig({...missing,step2StartUrl:'https://new.example/start'},2,previous);
  assert.equal(partial.startUrl,'https://new.example/start');assert.equal(partial.secondUrl,'');assert.throws(()=>shared.validateConfig(partial),/both Step 2 URLs/);
  assert.equal(shared.workflowConfig(missing,2,{config:{workflowNumber:1,startUrl:'https://old.example/trial'}}).startUrl,'');
});
test('workflow selection isolates actions/URLs and validates both Step 2 URLs', () => {
  const h=harness();configureStep2(h);
  const one=shared.workflowConfig(h.cfg,1),two=shared.workflowConfig(h.cfg,2);
  assert.equal(one.startUrl,h.cfg.startUrl);assert.equal(one.steps[0].id,'premium');assert.equal(one.secondUrl,undefined);
  assert.equal(two.startUrl,h.cfg.step2StartUrl);assert.equal(two.steps[0].action,'prepare');assert.equal(two.steps[6].action,'navigate');
  assert.ok(shared.validateConfig(two).includes('https://refund.example'));
  assert.throws(()=>shared.validateConfig({...two,secondUrl:''}),/both Step 2 URLs/);
  assert.throws(()=>shared.workflowConfig(h.cfg,3),/Step 1 or Step 2/);
});
test('legacy six-pin defaults expand while private URLs and custom pin lists are preserved', () => {
  const legacy=['110001','110002','110003','110006','110011','110020'];
  const migrated=shared.mergeSettings(defaults,{startUrl:'https://private.example/custom',delhiPincodes:legacy});
  assert.equal(migrated.startUrl,'https://private.example/custom');assert.equal(migrated.delhiPincodes.length,56);assert.equal(new Set(migrated.delhiPincodes).size,56);
  assert.ok(legacy.every(pin=>migrated.delhiPincodes.includes(pin)));
  assert.deepEqual(shared.mergeSettings(defaults,{delhiPincodes:['110001']}).delhiPincodes,['110001']);
});
test('Step 2 opens URL 1 in the selected existing tab and needs both URLs', async () => {
  const h=harness();configureStep2(h);await h.send('START',{workflowNumber:2,tabId:7});
  assert.equal(h.data.run.config.workflowNumber,2);assert.equal(h.data.run.tabId,7);
  assert.deepEqual(h.updates(),[{id:7,url:h.cfg.step2StartUrl,active:true}]);
  const missing=harness();missing.cfg.step2StartUrl='https://private.example/subscriptions';
  assert.match((await missing.send('START',{workflowNumber:2,tabId:7})).error,/both Step 2 URLs/);assert.equal(missing.data.run,undefined);
});
test('optional Step 2 tooltip preparation advances only on the configured first page', async () => {
  const h=harness();configureStep2(h);await h.send('START',{workflowNumber:2,tabId:7});
  h.responder(async(tab,msg)=>msg.type==='DISMISS_CAPTURED'?{ready:true,absent:true}:undefined);
  assert.equal((await h.request('PREPARE_BEFORE')).ready,false);assert.equal(h.data.run.index,0);
  const correct={...h.page,url:h.cfg.step2StartUrl};const result=await h.request('PREPARE_BEFORE',{},correct);
  assert.equal(result.advanced,true);assert.equal(h.data.run.index,1);assert.equal(h.data.run.phase,'waiting');
});
test('URL 2 navigation is saved once and survives a worker restart without replaying cancellation', async () => {
  const h=harness();configureStep2(h);await h.send('START',{workflowNumber:2,tabId:7});
  const idx=h.data.run.config.steps.findIndex(s=>s.action==='navigate');h.data.run.index=idx;h.data.run.openingStart=false;h.restart();
  assert.equal((await h.request('NAVIGATE',{}, {...h.page,tab:{id:999}})).ok,false);
  await h.request('NAVIGATE');const pending=structuredClone(h.data.run.pending);assert.equal(h.data.run.phase,'navigating');
  assert.equal((await h.request('NAVIGATE')).ok,false);assert.equal(h.updates().filter(t=>t.url===h.cfg.step2SecondUrl).length,1);
  h.restart();assert.equal((await h.request('PULL')).task,null);
  const nextPage={...h.page,url:h.cfg.step2SecondUrl,documentId:'second-url-document'};
  const task=(await h.request('PULL',{url:h.cfg.step2SecondUrl},nextPage)).task;assert.equal(task.phase,'navigating');assert.equal(task.next.id,'refund-submit');
  await h.request('OBSERVED',{token:pending.token},nextPage);assert.equal(h.data.run.config.steps[h.data.run.index].id,'refund-submit');
  assert.equal(h.updates().filter(t=>t.url===h.cfg.step2SecondUrl).length,1);
});
test('Step 2 diagnostics identify the workflow and redact both private URLs', async () => {
  const h=harness();configureStep2(h);await h.send('START',{workflowNumber:2,tabId:7});
  const run=h.data.run;run.message=run.config.startUrl+' '+run.config.secondUrl;
  const diagnostics=shared.redactedDiagnostics(run,'1.6.0');assert.equal(diagnostics.workflowStep,2);
  const encoded=JSON.stringify(diagnostics);assert.ok(!encoded.includes(run.config.startUrl));assert.ok(!encoded.includes(run.config.secondUrl));
});
test('Start attaches to the selected matching document without navigating or creating a tab', async () => {
  const h=harness();h.setTabs([{id:7,url:h.cfg.startUrl,active:false},{id:8,url:h.cfg.startUrl,active:true}]);
  await h.send('START',{tabId:8});assert.equal(h.data.run.tabId,8);
  assert.deepEqual(h.updates(),[{id:8,active:true}]);
});
test('Start navigates the selected unrelated page to the configured URL', async () => {
  const h=harness();h.setTabs([{id:7,url:'https://unrelated.example/',active:true}]);
  assert.ok(!(await h.send('START',{tabId:7})).error);
  assert.equal(h.data.run.tabId,7);assert.deepEqual(h.updates(),[{id:7,url:h.cfg.startUrl,active:true}]);
  assert.equal((await h.request('PULL',{url:'https://unrelated.example/'})).task,null);
  assert.equal(h.data.run.status,'running','the outgoing website must not request unrelated site access');
});
test('both workflows start from blank and browser New Tab pages in the same tab', async () => {
  for (const workflowNumber of [1,2]) for (const url of ['about:blank','chrome://newtab/','edge://newtab/']) {
    const h=harness();configureStep2(h);h.setTabs([{id:7,url,active:true}]);
    assert.ok(!(await h.send('START',{workflowNumber,tabId:7})).error);
    assert.equal(h.data.run.tabId,7);
    assert.deepEqual(h.updates(),[{id:7,url:workflowNumber===1?h.cfg.startUrl:h.cfg.step2StartUrl,active:true}]);
  }
});
test('both workflows reuse a matching background tab before replacing the active page', async () => {
  for (const workflowNumber of [1,2]) {
    const h=harness();configureStep2(h);const start=workflowNumber===1?h.cfg.startUrl:h.cfg.step2StartUrl;
    h.setTabs([{id:7,url:'chrome://newtab/',active:true},{id:8,url:start,active:false}]);
    assert.ok(!(await h.send('START',{workflowNumber,tabId:7})).error);
    assert.equal(h.data.run.tabId,8);assert.deepEqual(h.updates(),[{id:8,active:true}]);
  }
});
test('both workflows create a tab only when no existing tab is available', async () => {
  for (const workflowNumber of [1,2]) {
    const h=harness();configureStep2(h);h.setTabs([]);
    assert.ok(!(await h.send('START',{workflowNumber})).error);
    assert.equal(h.data.run.tabId,1);
    assert.deepEqual(h.creations(),[{url:'about:blank',active:true}]);
    assert.deepEqual(h.updates(),[{id:1,url:workflowNumber===1?h.cfg.startUrl:h.cfg.step2StartUrl,active:true}]);
  }
});
test('start-page comparison preserves query and origin restrictions', () => {
  assert.equal(shared.sameStartingPage('https://x.test/start/', 'https://x.test/start'), true);
  assert.equal(shared.sameStartingPage('https://x.test/start?q=2', 'https://x.test/start?q=1'), false);
  assert.equal(shared.sameStartingPage('https://y.test/start', 'https://x.test/start'), false);
  assert.equal(shared.sameStartingPage('https://x.test/start#b', 'https://x.test/start#a'), false);
  assert.throws(() => shared.originOf('javascript:alert(1)'));
});
test('a checkpoint survives worker recreation and prevents another claim', async () => {
  const h = harness(); await h.send('START');
  const pin = h.data.run.values.pincode;
  const claimed = await h.request('CLAIM', {nextPresentBefore: true}); assert.equal(claimed.allowed, true);
  h.restart();
  const pulled = await h.request('PULL'); assert.equal(pulled.task.phase, 'dispatching'); assert.equal(pulled.task.values.pincode, pin);
  const navigated = await h.request('PULL', {url: 'https://private.example/survey'});
  assert.equal(navigated.task.phase, 'dispatching', 'the first action may finish on a different page');
  assert.equal((await h.request('CLAIM')).allowed, false);
  assert.equal((await h.request('OBSERVED', {token: claimed.token, postcondition: false})).ok, false);
  assert.equal(h.data.run.index, 0, 'a next control already on the page is not evidence the click happened');
  await h.request('RESULT', {token: claimed.token});
  await h.request('OBSERVED', {token: claimed.token}); assert.equal(h.data.run.index, 1);
});
test('wrong tabs, tokens and website-origin controls cannot drive a run', async () => {
  const h = harness();
  assert.match((await h.send('START', {}, h.page)).error, /only from the extension/);
  await h.send('START');
  assert.equal((await h.request('PULL', {}, {...h.page, tab: {id: 8}})).task, null);
  assert.equal((await h.request('PULL', {url: 'https://private.example/wrong'})).task, null);
  const {token} = await h.request('CLAIM');
  await h.request('RESULT', {token: 'wrong', verified: true}); assert.equal(h.data.run.index, 0);
  await h.send('STOP'); assert.equal((await h.request('CAN_ACT', {token})).allowed, false);
  await h.request('RESULT', {token, verified: true}); assert.equal(h.data.run.index, 0);
});
test('pause before a claimed action can abandon the unexecuted checkpoint', async () => {
  const h = harness(); await h.send('START'); const {token} = await h.request('CLAIM');
  await h.send('PAUSE'); assert.equal((await h.request('CAN_ACT', {token})).allowed, false);
  await h.request('ABANDON', {token}); assert.equal(h.data.run.phase, 'waiting');
  await h.send('RESUME'); assert.equal((await h.request('CLAIM')).allowed, true);
});
test('unknown website access pauses without discarding the action checkpoint', async () => {
  const h = harness(); await h.send('START'); const {token} = await h.request('CLAIM');
  await h.request('PULL', {url: 'https://checkout.example/next'});
  assert.equal(h.data.run.status, 'needs_access'); assert.equal(h.data.run.pending.token, token);
  await h.send('ALLOW'); assert.equal(h.data.run.status, 'running'); assert.ok(h.data.run.allowedOrigins.includes('https://checkout.example'));
});
test('an interrupted final click is never automatically repeated', async () => {
  const h = harness(); await h.send('START'); h.data.run.index = defaults.steps.findIndex(s=>s.id==='finish'); h.restart();
  const {token} = await h.request('CLAIM'); assert.ok(token);
  h.restart(); assert.equal((await h.request('CLAIM')).allowed, false);
  h.data.run.deadlineAt = Date.now() - 1; h.restart(); await h.request('PULL'); assert.equal(h.data.run.status, 'error');
  assert.match((await h.send('RETRY')).error, /final click may already have been sent/);
  assert.equal(h.data.run.phase, 'dispatching');
});
test('a final claim released before dispatch can wait and claim again', async () => {
  const h=harness();await h.send('START');h.data.run.index=defaults.steps.findIndex(s=>s.id==='finish');h.restart();
  const first=await h.request('CLAIM');assert.equal(first.allowed,true);
  await h.request('ABANDON',{token:first.token});assert.equal(h.data.run.phase,'waiting');
  const second=await h.request('CLAIM');assert.equal(second.allowed,true);assert.notEqual(second.token,first.token);
});
test('submission stays checkpointed until the QR page; reveal cannot repeat the order', async () => {
  const h=harness();await h.send('START');h.data.run.index=defaults.steps.findIndex(s=>s.id==='finish');h.restart();
  const {token}=await h.request('CLAIM');await h.request('RESULT',{token});
  assert.equal(h.data.run.phase,'observing');assert.equal(h.data.run.status,'running');
  assert.equal((await h.request('CLAIM')).allowed,false);
  const qrPage={...h.page,url:'https://private.example/payment',documentId:'qr-document'};
  assert.equal((await h.request('PULL',{url:qrPage.url},qrPage)).task.navigationChanged,true);
  await h.request('OBSERVED',{token},qrPage);assert.equal(h.data.run.config.steps[h.data.run.index].action,'reveal');
  h.restart();const task=(await h.request('PULL',{url:qrPage.url},qrPage)).task;
  assert.equal(task.navigationChanged,true);assert.equal(task.step.id,'show-qr');
  assert.equal((await h.request('REVEALED')).ok,false,'old pre-order document cannot finish the QR action');
  assert.equal((await h.request('REVEALED',{}, {...qrPage,tab:{id:999}})).ok,false);
  await h.request('REVEALED',{},qrPage);assert.equal(h.data.run.status,'finished');
  assert.match(h.data.run.message,/QR code loaded/);
});
test('a reported checkout error stops the current payment observation without enabling a repeat', async () => {
  const h=harness();await h.send('START');
  assert.equal((await h.request('CHECKOUT_ERROR')).ok,false);
  h.data.run.index=defaults.steps.findIndex(s=>s.id==='finish');h.restart();
  assert.equal((await h.request('CHECKOUT_ERROR')).ok,false,'an unsubmitted checkout is not a payment result');
  const {token}=await h.request('CLAIM');await h.request('RESULT',{token});
  assert.equal((await h.request('CHECKOUT_ERROR',{}, {...h.page,tab:{id:999}})).ok,false);
  assert.equal((await h.request('CHECKOUT_ERROR',{}, {...h.page,frameId:5})).ok,false);
  assert.equal((await h.request('CHECKOUT_ERROR',{errorText:'PRIVATE_SENTINEL'})).ok,true);
  assert.equal(h.data.run.status,'error');assert.equal(h.data.run.siteError,'checkout');
  assert.ok(!JSON.stringify(h.data.run).includes('PRIVATE_SENTINEL'));
  assert.match((await h.send('RETRY')).error,/final click may already have been sent/);
});
test('only the current action owner can request its configured tooltip preparation', async () => {
  const h=harness();await h.send('START');h.data.run.index=defaults.steps.findIndex(s=>s.id==='next');h.restart();
  assert.equal((await h.request('PREPARE_BEFORE',{}, {...h.page,tab:{id:999}})).ready,false);
  assert.equal((await h.request('PREPARE_BEFORE',{}, {...h.page,frameId:5})).ready,false);
});
test('upgrading the captured workflow stops old snapshots; same-version restart pauses', async () => {
  const h = harness(); await h.send('START'); h.data.run.config.workflowRevision = 1; h.restart();
  await h.startup(); assert.equal(h.data.run.status, 'stopped');
  await h.send('START'); await h.startup(); assert.equal(h.data.run.status, 'paused');
});
test('polling uses the worker cache instead of repeated storage reads', async () => {
  const h = harness(); await h.send('START'); const before = h.reads();
  for (let i = 0; i < 25; i++) await h.request('PULL');
  assert.equal(h.reads(), before);
});
test('frame routing keeps a real captured frame separate from main-page controls', () => {
  const step = {...defaults.steps[1], allowTopLevelFallback: true};
  const key = shared.frameKey(0, [], step.context[0].css);
  const run = {frameInventory: {[key]: {count: 1, visibleCount: 1, ready: true, since: 0}}, frameBindings: {[key]: {frameId: 7}}};
  assert.equal(shared.contextPlan(run, step).frameId, 7);
  run.frameBindings = {}; assert.equal(shared.contextPlan(run, step).available, false);
  run.frameInventory[key].count = 0; run.frameInventory[key].visibleCount = 0;
  assert.equal(shared.contextPlan(run, step).frameId, 0);
  run.frameInventory[key].ready = false; assert.equal(shared.contextPlan(run, step).available, false);
});
test('diagnostics redact page URLs and entered values even when an error echoes them', async () => {
  const h = harness(); await h.send('START'); const run = h.data.run;
  run.message = `${run.config.startUrl} / ${run.values.pincode}`;
  run.log = [{at: Date.now(), message: run.message}];
  const result = JSON.stringify(shared.redactedDiagnostics(run, '1.2.0'));
  assert.ok(!result.includes(run.config.startUrl)); assert.ok(!result.includes(run.values.pincode));
  assert.ok(!result.includes('startUrl')); assert.ok(!result.includes('allowedOrigins'));
});
