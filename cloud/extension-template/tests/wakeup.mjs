import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
const source = await fs.readFile(new URL('../content.js', import.meta.url), 'utf8');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function harness() {
  let listener, resolveFirst, calls = 0, observers = 0;
  const first = new Promise(resolve => { resolveFirst = resolve; });
  const window = {addEventListener() {}}; window.top = window; window.parent = window;
  const context = vm.createContext({window, document: {readyState: 'interactive', addEventListener() {}}, location: {href: 'https://private.example/'},
    PrivateWorkflow: {}, chrome: {runtime: {sendMessage: async msg => { assert.equal(msg.type, 'PULL'); calls++; return calls === 1 ? first : {active: false}; }, onMessage: {addListener: fn => { listener = fn; }}}},
    MutationObserver: class { constructor() { observers++; } observe() {} disconnect() {} },
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 5)), clearTimeout});
  vm.runInContext(source, context);
  return {resolveFirst, signal: type => listener({type}, {}, () => {}), calls: () => calls, observers: () => observers};
}
test('a fresh wake cannot be lost behind an older inactive response', async () => {
  const h = harness(); h.signal('WAKE_RUNNER'); h.resolveFirst({active: false});
  await wait(40); assert.equal(h.calls(), 2);
});
test('a passive frame wakes when its binding arrives during an outstanding poll', async () => {
  const h = harness(); h.signal('WAKE_RUNNER'); h.resolveFirst({active: true, passive: true});
  await wait(40); assert.equal(h.calls(), 2);
});
test('stop cancels monitoring even when an older active response arrives later', async () => {
  const h = harness(); h.signal('STOP_RUNNER'); h.resolveFirst({active: true, discoveries: [], task: null});
  await wait(40); assert.equal(h.calls(), 1); assert.equal(h.observers(), 0);
});
test('main-plan discovery reports only scoped counts and never treats a button as a frame', async () => {
  const sent=[];let calls=0;
  const window={addEventListener(){}};window.top=window;window.parent=window;
  const button={getAttribute(){throw Error('A main-page button has no frame URL');},get contentWindow(){throw Error('A main-page button must not receive frame binding');}};
  const context=vm.createContext({window,document:{readyState:'interactive',documentElement:{},addEventListener(){}},location:{href:'https://private.example/plan'},
    PrivateWorkflow:{inspectFrame(prefix,css){assert.deepEqual(Array.from(prefix),[]);assert.equal(css,'form button[data-view-name]');return {elements:[button],count:1,visibleCount:1,ready:true};}},
    chrome:{runtime:{sendMessage:async msg=>{sent.push(msg);if(msg.type==='PULL')return ++calls===1?{active:true,runId:'run',index:4,discoveries:[{key:'target-key',kind:'target',prefix:[],css:'form button[data-view-name]',nonce:'token'}],task:null}:{active:false};if(msg.type==='FRAME_REPORT')return {ok:true,active:true};throw Error(msg.type);},onMessage:{addListener(){}}}},
    MutationObserver:class{observe(){}disconnect(){}},setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,5)),clearTimeout});
  vm.runInContext(source,context);await wait(40);
  const reports=sent.filter(msg=>msg.type==='FRAME_REPORT');assert.equal(reports.length,1);
  assert.equal(reports[0].sourceUrl,'');assert.equal(reports[0].count,1);assert.equal(reports[0].visibleCount,1);assert.equal(reports[0].nonce,'token');
  assert.equal(calls,2);assert.equal(sent.some(msg=>msg.type==='BIND_FRAME'),false);
});
