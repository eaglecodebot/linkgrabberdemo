import {grabSetup,grabStatus,startGrab,grabIsRunning} from './grabber.js';
import {ACTIVE, originOf, hostPattern, sameStartingPage, validateConfig, workflowConfig, mergeSettings, validateSettings, newRun, logRun, advance, contextPlan, redactedDiagnostics} from './shared.js';

// Serialize state changes. Long DOM waits live in the content script, never here.
let queue = Promise.resolve();
function serial(fn) { const next = queue.then(fn); queue = next.catch(() => {}); return next; }
let cachedRun, cachedConfig, lastBadge = '', alarmActive = false;
const readRun = async () => {
  if (cachedRun === undefined) cachedRun = (await chrome.storage.local.get('run')).run || null;
  return cachedRun;
};
async function config() {
  if (cachedConfig) return cachedConfig;
  const defaults = await (await fetch(chrome.runtime.getURL('workflow.json'))).json();
  const {settings = {}} = await chrome.storage.local.get('settings');
  cachedConfig = mergeSettings(defaults, settings); return cachedConfig;
}
async function save(run) {
  cachedRun = run;
  await chrome.storage.local.set({run});
  const active = run?.status === 'running';
  const badge = active ? String(run.index + 1) : run?.status === 'finished' ? '✓' : ACTIVE.has(run?.status) || run?.status === 'error' ? '!' : '';
  if (badge !== lastBadge) { await chrome.action.setBadgeText({text: badge}); await chrome.action.setBadgeBackgroundColor({color: active ? '#176b50' : '#805c22'}); lastBadge = badge; }
  if (active && !alarmActive) { await chrome.alarms.create('workflow-watchdog', {periodInMinutes: 0.5}); alarmActive = true; }
  if (!active) { await chrome.alarms.clear('workflow-watchdog'); alarmActive = false; }
  if (run && ['stopped', 'finished', 'error'].includes(run.status)) {
    try { await chrome.scripting.unregisterContentScripts({ids: ['private-workflow-runner']}); } catch {}
  }
  if (run && !active) {
    for (const frameId of Object.keys(run.actors || {})) { try { await chrome.tabs.sendMessage(run.tabId, {type: 'STOP_RUNNER'}, {frameId: Number(frameId)}); } catch {} }
  }
  return run;
}
async function register(origins) {
  const matches = [...new Set(origins.map(hostPattern))];
  if (!matches.length) return;
  const entry = {id: 'private-workflow-runner', matches, js: ['engine.js', 'content.js'], runAt: 'document_end', allFrames: true, matchOriginAsFallback: true, persistAcrossSessions: false};
  const existing = await chrome.scripting.getRegisteredContentScripts({ids: [entry.id]});
  if (existing.length) await chrome.scripting.updateContentScripts([entry]);
  else await chrome.scripting.registerContentScripts([entry]);
}
const injecting = new Set();
async function inject(tabId, onlyFrame) {
  const run = await readRun();
  let frames;
  try { frames = await chrome.webNavigation.getAllFrames({tabId}); } catch {}
  frames ||= [{frameId: 0, parentFrameId: -1, url: run?.config.startUrl}];
  for (const frame of frames) {
    if (onlyFrame !== undefined && frame.frameId !== onlyFrame) continue;
    let origin;
    try { origin = originOf(frame.url); } catch { try { origin = originOf(frames.find(f => f.frameId === frame.parentFrameId)?.url); } catch { continue; } }
    if (!run?.allowedOrigins.includes(origin)) continue;
    const key = `${tabId}:${frame.frameId}:${frame.documentId || ''}`;
    if (injecting.has(key)) continue;
    injecting.add(key);
    try {
      if (!run.actors?.[frame.frameId] || run.actors[frame.frameId].documentId !== frame.documentId) await chrome.scripting.executeScript({target: {tabId, frameIds: [frame.frameId]}, files: ['engine.js', 'content.js']});
      await chrome.tabs.sendMessage(tabId, {type: 'WAKE_RUNNER'}, {frameId: frame.frameId});
    } catch (e) { run.lastInjectionError = String(e.message).replace(/https?:\/\/\S+/g, '[private page]').slice(0, 300); }
    finally { injecting.delete(key); }
  }
}
function belongs(run, msg, sender) {
  return run && run.id === msg.runId && run.index === msg.index && Number.isInteger(sender.frameId) && sender.tab?.id === run.tabId && (!sender.documentLifecycle || sender.documentLifecycle === 'active');
}
async function actor(run, sender, readyState) {
  if (!run || sender.tab?.id !== run.tabId || !Number.isInteger(sender.frameId) || (sender.documentLifecycle && sender.documentLifecycle !== 'active')) return false;
  run.actors ||= {}; run.frameBindings ||= {}; run.frameInventory ||= {}; run.frameChallenges ||= {};
  let item = run.actors[sender.frameId];
  if (!item || item.documentId !== sender.documentId) {
    let info;
    try { info = await chrome.webNavigation.getFrame({tabId: run.tabId, frameId: sender.frameId}); } catch {}
    if (info?.documentId && info.documentId !== sender.documentId) return false;
    if (sender.frameId === 0 && item?.documentId !== sender.documentId) { run.frameBindings = {}; run.frameInventory = {}; run.frameChallenges = {}; }
    for (const [key, binding] of Object.entries(run.frameBindings)) if (binding.frameId === sender.frameId && binding.documentId !== sender.documentId) delete run.frameBindings[key];
    item = {documentId: sender.documentId, parentFrameId: info?.parentFrameId ?? (sender.frameId === 0 ? -1 : null)};
    run.actors[sender.frameId] = item;
  }
  item.at = Date.now(); item.readyState = readyState;
  return true;
}
function plans(run) {
  const current = run.config.steps[run.index], next = run.config.steps[run.index + 1];
  return [current, next, ...(current?.before || []), ...(current?.requires || []).map(id => run.config.steps.find(s => s.id === id))].filter(Boolean).map(step => contextPlan(run, step));
}
function discoveries(run, sender) {
  const result = new Map();
  for (const plan of plans(run)) for (const hop of plan.hops) {
    if (hop.parentFrameId !== sender.frameId) continue;
    let challenge = run.frameChallenges[hop.key];
    if (!challenge || challenge.parentDocumentId !== sender.documentId || challenge.expires < Date.now()) challenge = run.frameChallenges[hop.key] = {...hop, nonce: crypto.randomUUID(), parentDocumentId: sender.documentId, expires: Date.now() + 20000};
    result.set(hop.key, {key: hop.key, prefix: hop.prefix, css: hop.css, nonce: challenge.nonce});
  }
  return [...result.values()];
}
function actionPlan(run, sender, step = run.config.steps[run.index]) {
  const plan = contextPlan(run, step);
  if (!plan.available || plan.frameId !== sender.frameId) return null;
  const binding = Object.values(run.frameBindings || {}).find(b => b.frameId === sender.frameId);
  if (sender.frameId !== 0 && binding?.documentId !== sender.documentId) return null;
  return plan;
}
async function clearPoint(run, sender, point) {
  if (sender.frameId === 0) return true;
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  let childId = sender.frameId;
  for (let i = 0; i < 15 && childId !== 0; i++) {
    const binding = Object.values(run.frameBindings || {}).find(b => b.frameId === childId);
    if (!binding) return false;
    let response;
    try { response = await chrome.tabs.sendMessage(run.tabId, {type: 'CHECK_CHILD_POINT', prefix: binding.prefix, css: binding.css, point}, {frameId: binding.parentFrameId}); } catch { return false; }
    if (!response?.clear) return false;
    point = response.point; childId = binding.parentFrameId;
  }
  return childId === 0;
}
async function embeddedAccess(run, origin) {
  if (!origin || run.allowedOrigins.includes(origin)) return true;
  if (await chrome.permissions.contains({origins: [hostPattern(origin)]})) {
    run.allowedOrigins.push(origin); await register(run.allowedOrigins); await save(run); return true;
  }
  run.remainingMs = Math.max(1000, run.deadlineAt - Date.now()); run.status = 'needs_access'; run.blockedOrigin = origin; run.pendingOrigins = [origin];
  await save(logRun(run, 'The embedded page needs website access. Open the extension and choose Allow website & continue.'));
  return false;
}
async function expire(run) {
  if (run?.status === 'running' && Date.now() > run.deadlineAt) {
    run.status = 'error';
    const action = run.phase === 'waiting' ? 'The required element was not ready.' : 'The previous action could not be confirmed; it has not been repeated.';
    await save(logRun(run, `Action ${run.index + 1} timed out. ${action} Check this page, then Retry if appropriate.`));
  }
  return run;
}
async function checkDestination(run, url) {
  let origin;
  try { origin = originOf(url); } catch { return run; }
  if (!run.allowedOrigins.includes(origin)) {
    run.remainingMs = Math.max(1000, run.deadlineAt - Date.now());
    run.status = 'needs_access'; run.blockedOrigin = origin; run.pendingOrigins = [origin];
    await save(logRun(run, 'The next website needs access. Open the extension and choose Allow website & continue.'));
  }
  return run;
}
async function handle(msg, sender) {
  let run = await readRun();
  // Only our own extension pages may issue controls or change settings.
  const control = sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(''));
  if (['GET_GRAB_SETUP', 'GET_GRAB_STATUS', 'GRAB_LINKS', 'GET_STATUS', 'DIAGNOSTICS', 'START', 'PAUSE', 'RESUME', 'STOP', 'RETRY', 'ALLOW', 'SAVE_SETTINGS', 'RESET_SETTINGS'].includes(msg.type) && !control) throw new Error('This control is available only from the extension.');
  switch (msg.type) {
    case 'GET_GRAB_SETUP': return grabSetup();
    case 'GET_GRAB_STATUS': return {grabRun:await grabStatus()};
    case 'GRAB_LINKS': return startGrab(msg.tabId,run);
    case 'GET_STATUS': return {run, config: await config(), version: chrome.runtime.getManifest().version};
    case 'DIAGNOSTICS': return {diagnostics: redactedDiagnostics(run, chrome.runtime.getManifest().version)};
    case 'SAVE_SETTINGS': {
      if (ACTIVE.has(run?.status)) throw new Error('Stop the current run before changing settings.');
      const candidate = {...await config(), ...msg.settings}; validateSettings(candidate);
      await chrome.storage.local.set({settings: msg.settings}); cachedConfig = null; return {config: await config()};
    }
    case 'RESET_SETTINGS':
      if (ACTIVE.has(run?.status)) throw new Error('Stop the current run first.');
      await chrome.storage.local.remove('settings'); cachedConfig = null; return {config: await config()};
    case 'START': {
      if(grabIsRunning())throw new Error('Wait for the link capture to finish before starting a workflow.');
      if (ACTIVE.has(run?.status)) throw new Error('A run already exists. Stop it before starting again.');
      const cfg = workflowConfig(await config(), msg.workflowNumber ?? 1, run), origins = validateConfig(cfg);
      if (!await chrome.permissions.contains({origins: origins.map(hostPattern)})) throw new Error('Website access was not granted. Click Trial or Cancel & Refund again and allow access.');
      let selected;
      if (Number.isInteger(msg.tabId)) { try { selected = await chrome.tabs.get(msg.tabId); } catch {} }
      selected ||= (await chrome.tabs.query({active: true, currentWindow: true}))[0];
      // Reuse an exact matching page before replacing the selected tab. New Tab
      // and about:blank are navigation targets too; no script is injected there.
      const matching = selected && sameStartingPage(selected.url, cfg.startUrl) ? selected
        : (await chrome.tabs.query({currentWindow: true})).find(t => sameStartingPage(t.url, cfg.startUrl));
      const tab = matching || selected || await chrome.tabs.create({url: 'about:blank', active: true});
      await register(origins);
      run = newRun(cfg, tab.id); run.openingStart = !sameStartingPage(tab.url, cfg.startUrl);
      await save(logRun(run, `Step ${cfg.workflowNumber} started manually in your existing tab.`));
      if (!sameStartingPage(tab.url, cfg.startUrl)) await chrome.tabs.update(tab.id, {url: cfg.startUrl, active: true});
      else {await chrome.tabs.update(tab.id, {active: true}); await inject(tab.id);}
      return {run};
    }
    case 'PAUSE':
      if (run?.status === 'running') { run.remainingMs = Math.max(1000, run.deadlineAt - Date.now()); run.status = 'paused'; await save(logRun(run, 'Paused. Resume continues from this action.')); }
      return {run};
    case 'RESUME':
      if (run?.status === 'paused') {
        run.status = 'running'; run.deadlineAt = Date.now() + (run.remainingMs || run.config.stepTimeoutSeconds * 1000);
        await register(run.allowedOrigins); await save(logRun(run, 'Resumed from the saved step.')); await inject(run.tabId);
      } return {run};
    case 'STOP':
      if (run && ACTIVE.has(run.status)) { run.status = 'stopped'; await save(logRun(run, 'Stopped. Click Trial or Cancel & Refund to begin a new run.')); }
      return {run};
    case 'RETRY':
      if (run?.status === 'error') {
        const step = run.config.steps[run.index];
        if ((step.noRepeat || (step.final && step.action === 'click')) && run.phase !== 'waiting') throw new Error('The final click may already have been sent. Check the website; it will not be automatically repeated.');
        run.status = 'running'; run.phase = 'waiting'; run.pending = null;
        run.deadlineAt = Date.now() + run.config.stepTimeoutSeconds * 1000;
        await register(run.allowedOrigins); await save(logRun(run, 'Retry requested manually for the current action.')); await inject(run.tabId);
      } return {run};
    case 'ALLOW':
      if (run?.status === 'needs_access') {
        const origins = run.pendingOrigins || [run.blockedOrigin];
        if (!await chrome.permissions.contains({origins: origins.map(hostPattern)})) throw new Error('Website access was not granted.');
        run.allowedOrigins = [...new Set([...run.allowedOrigins, ...origins])];
        delete run.blockedOrigin; delete run.pendingOrigins; run.status = 'running'; run.deadlineAt = Date.now() + (run.remainingMs || run.config.stepTimeoutSeconds * 1000);
        await register(run.allowedOrigins); await save(logRun(run, 'Access granted. Continuing from the saved step.')); await inject(run.tabId);
      } return {run};
    case 'PULL': {
      if (run?.status !== 'running' || !await actor(run, sender, msg.readyState)) return {active: false, task: null};
      if (run.openingStart) {
        if (sender.frameId === 0 && sameStartingPage(msg.url, run.config.startUrl)) delete run.openingStart;
        else {await expire(run);return {active: run.status === 'running', runId: run.id, index: run.index, task: null, reason: 'Opening the configured starting page in this tab.'};}
      }
      if (sender.frameId === 0) run = await checkDestination(run, msg.url || sender.url);
      run = await expire(run);
      if (run.status !== 'running') return {active: false, task: null};
      const packet = {active: true, runId: run.id, index: run.index, frameId: sender.frameId, documentId: sender.documentId, discoveries: discoveries(run, sender), task: null};
      if (run.index === 0 && run.phase === 'waiting' && (sender.frameId !== 0 || !sameStartingPage(msg.url, run.config.startUrl))) return {...packet, reason: sender.frameId === 0 ? 'Waiting for the configured starting page.' : null};
      const current = run.config.steps[run.index], next = run.config.steps[run.index + 1];
      if (current.action === 'navigate' && run.phase === 'navigating' && sender.documentId === run.pending?.documentId && !sameStartingPage(msg.url, run.pending.navigationUrl)) return {...packet, reason: 'Opening the configured second URL in this tab.'};
      const observing = run.phase !== 'waiting', target = observing ? next : current;
      const plan = target && actionPlan(run, sender, target);
      if (!plan) {
        const pending = target && contextPlan(run, target);
        return {...packet, passive: packet.discoveries.length === 0, reason: sender.frameId === 0 && pending && !pending.available ? `Waiting for action ${run.index + (observing ? 2 : 1)}: ${pending.reason}` : null};
      }
      const localCurrent = actionPlan(run, sender, current)?.step || {...current, context: [], locators: []};
      const localNext = next && actionPlan(run, sender, next)?.step;
      const preconditions = [];
      for (const id of current.requires || []) {
        const required = run.config.steps.find(step => step.id === id), local = required && actionPlan(run, sender, required);
        if (!observing && !local) return {...packet, reason: 'Waiting for the page containing the saved form choices.'};
        if (local) preconditions.push(local.step);
      }
      return {...packet, task: {runId: run.id, index: run.index, phase: run.phase, step: observing ? localCurrent : plan.step,
        next: observing ? plan.step : localNext || null, pending: run.pending, preconditions,
        values: run.values, pincodeSelector: run.config.pincodeSelector,
        transitionAt: observing ? run.pending?.sentAt || run.pending?.at : run.previousActionAt,
        navigationChanged: Boolean((observing ? run.pending?.documentId : run.previousDocumentId) &&
          (sender.documentId !== (observing ? run.pending.documentId : run.previousDocumentId) ||
          msg.url !== (observing ? run.pending.url : run.previousUrl))),
        settleMilliseconds: run.config.settleMilliseconds}};
    }
    case 'FRAME_REPORT': {
      if (run?.status !== 'running' || msg.runId !== run.id || sender.tab?.id !== run.tabId) return {ok: false};
      const challenge = run.frameChallenges?.[msg.key];
      if (!challenge || challenge.nonce !== msg.nonce || challenge.parentFrameId !== sender.frameId || challenge.parentDocumentId !== sender.documentId) return {ok: false};
      const previous = run.frameInventory[msg.key];
      const count = Math.min(100, Math.max(0, Number(msg.count) || 0)), visibleCount = Math.min(count, Math.max(0, Number(msg.visibleCount) || 0));
      const changed = !previous || previous.count !== count || previous.visibleCount !== visibleCount || previous.ready !== Boolean(msg.ready) || previous.sourceUrl !== msg.sourceUrl;
      const inventory = run.frameInventory[msg.key] = {count, visibleCount, ready: Boolean(msg.ready), sourceUrl: msg.sourceUrl || '', since: changed ? Date.now() : previous.since, lastProbe: previous?.lastProbe || 0};
      if (count !== 1 || visibleCount !== 1) delete run.frameBindings[msg.key];
      if (changed) await save(run);
      if (count === 1 && visibleCount === 1 && msg.ready) {
        let origin; try { origin = originOf(msg.sourceUrl); } catch {}
        if (!await embeddedAccess(run, origin)) return {ok: true, active: false};
        if (!run.frameBindings[msg.key] && Date.now() - inventory.lastProbe > 1500) {
          inventory.lastProbe = Date.now();
          let frames = []; try { frames = await chrome.webNavigation.getAllFrames({tabId: run.tabId}) || []; } catch {}
          const children = frames.filter(f => f.parentFrameId === sender.frameId);
          const matching = children.filter(f => f.url === msg.sourceUrl);
          const target = matching.length === 1 ? matching[0] : children.length === 1 ? children[0] : null;
          if (target) {
            let actual; try { actual = originOf(target.url); } catch {}
            if (!await embeddedAccess(run, actual)) return {ok: true, active: false};
            await inject(run.tabId, target.frameId);
          }
        }
      }
      return {ok: true, active: run.status === 'running'};
    }
    case 'BIND_FRAME': {
      if (run?.status !== 'running' || msg.runId !== run.id || !await actor(run, sender, msg.readyState)) return {ok: false};
      const challenge = Object.values(run.frameChallenges || {}).find(c => c.nonce === msg.nonce && c.expires >= Date.now());
      if (!challenge || run.actors[sender.frameId].parentFrameId !== challenge.parentFrameId || sender.frameId === 0) return {ok: false};
      const previous = run.frameBindings[challenge.key];
      if (previous && (previous.frameId !== sender.frameId || previous.documentId !== sender.documentId)) return {ok: false};
      run.frameBindings[challenge.key] = {frameId: sender.frameId, documentId: sender.documentId, parentFrameId: challenge.parentFrameId, prefix: challenge.prefix, css: challenge.css};
      if (!previous) await save(logRun(run, `Connected to the embedded page for action ${run.index + (run.phase === 'waiting' ? 1 : 2)}.`));
      return {ok: true};
    }
    case 'PREPARE_BEFORE': {
      if (!belongs(run, msg, sender) || run.status !== 'running' || run.phase !== 'waiting' || !actionPlan(run, sender)) return {ready: false};
      if (run.index === 0 && !sameStartingPage(sender.url, run.config.startUrl)) return {ready: false};
      let absent = true;
      for (const step of run.config.steps[run.index].before || []) {
        const plan = contextPlan(run, step);
        if (!plan.available) return {ready: false, message: 'Waiting for the page containing the captured tooltip.'};
        const contexts = new Map([[plan.frameId, plan.step]]);
        if (step.searchActionFrames) {
          let frameId = sender.frameId;
          for (let i = 0; i < 15 && Number.isInteger(frameId) && frameId >= 0; i++) {
            if (!contexts.has(frameId)) contexts.set(frameId, {...step, context: []});
            frameId = run.actors?.[frameId]?.parentFrameId;
          }
        }
        for (const [frameId, localStep] of contexts) {
          const request = {type: 'DISMISS_CAPTURED', runId: run.id, index: run.index, step: localStep, settleMilliseconds: run.config.settleMilliseconds};
          let result;
          try {
            result = await chrome.tabs.sendMessage(run.tabId, request, {frameId});
            if (result?.canClick) {
              if (!await clearPoint(run, {frameId}, result.point)) return {ready: false, message: 'The captured tooltip close button is covered in its parent page; waiting for it to be visible.'};
              result = await chrome.tabs.sendMessage(run.tabId, {...request, commit: result.token}, {frameId});
            }
          } catch { return {ready: false, message: 'Waiting for the captured tooltip page to respond.'}; }
          if (result?.clicked) await save(logRun(run, 'Dismissed the captured chat tooltip.'));
          if (!result?.ready) return {ready: false, message: result?.message || 'Waiting for the captured tooltip to close.'};
          absent &&= Boolean(result.absent);
        }
      }
      if (run.config.steps[run.index].action === 'prepare') {advance(run); await save(run); return {ready: true, absent, advanced: true};}
      return {ready: true, absent};
    }
    case 'NAVIGATE': {
      if (!belongs(run, msg, sender) || run.status !== 'running' || run.phase !== 'waiting' || !actionPlan(run, sender)) return {ok: false};
      const step = run.config.steps[run.index];
      if (step.action !== 'navigate' || step.urlFrom !== 'secondUrl' || !run.config.secondUrl || sender.frameId !== 0) return {ok: false};
      const url = run.config.secondUrl;
      if (!await chrome.permissions.contains({origins: [hostPattern(url)]})) throw new Error('Access to the second URL is no longer available. Grant website access before continuing.');
      run.phase = 'navigating';run.pending = {token: crypto.randomUUID(), at: Date.now(), navigationUrl: url, documentId: sender.documentId, actionTabId: sender.tab.id, actionFrameId: 0, nextPresentBefore: false};
      await save(logRun(run, 'Confirm cancel transition observed. Opening Step 2 URL 2 in the same tab.'));
      await chrome.tabs.update(run.tabId, {url, active: true});return {ok: true};
    }
    case 'REVEALED': {
      if (!belongs(run, msg, sender) || run.status !== 'running' || run.phase !== 'waiting') return {ok: false};
      const step = run.config.steps[run.index];
      if (step.action !== 'reveal' || !step.final || !actionPlan(run, sender, step)) return {ok: false};
      if (step.afterNavigation && (!run.previousDocumentId || (sender.documentId === run.previousDocumentId && sender.url === run.previousUrl))) return {ok: false};
      if (!await clearPoint(run, sender, msg.point)) return {ok: false};
      run.status = 'finished'; run.phase = 'done';
      await save(logRun(run, 'QR code loaded and brought to the middle of the screen. Automation stopped.'));
      return {ok: true};
    }
    case 'CLAIM': {
      if (!belongs(run, msg, sender) || run.status !== 'running' || run.phase !== 'waiting') return {allowed: false};
      if (!actionPlan(run, sender)) return {allowed: false};
      if (run.index === 0 && (sender.frameId !== 0 || !sameStartingPage(msg.url, run.config.startUrl))) return {allowed: false};
      if (!await clearPoint(run, sender, msg.point)) return {allowed: false, reason: 'The embedded control is covered or its frame is not ready.'};
      const token = crypto.randomUUID();
      run.phase = 'dispatching';
      run.pending = {token, at: Date.now(), documentId: sender.documentId, actionTabId: sender.tab.id, actionFrameId: sender.frameId, url: msg.url, contextSignature: msg.contextSignature, nextPresentBefore: Boolean(msg.nextPresentBefore)};
      await save(logRun(run, `Action ${run.index + 1}: ${run.config.steps[run.index].title}.`));
      return {allowed: true, token};
    }
    case 'CAN_ACT':
      return {allowed: Boolean(belongs(run, msg, sender) && run.status === 'running' && run.pending?.token === msg.token && run.phase === 'dispatching' && sender.frameId === run.pending.actionFrameId && sender.documentId === run.pending.documentId)};
    case 'CAN_REPAIR': {
      if (!belongs(run, msg, sender) || run.status !== 'running' || run.phase !== 'waiting') return {allowed: false};
      const step = run.config.steps.find(step => step.id === msg.stepId);
      if (!step || !(run.config.steps[run.index].requires || []).includes(step.id) || !['radio', 'check', 'choice', 'expand', 'type'].includes(step.action)) return {allowed: false};
      if (!actionPlan(run, sender, step) || !await clearPoint(run, sender, msg.point)) return {allowed: false};
      await save(logRun(run, `Restoring saved form state: ${step.title}.`));
      return {allowed: true};
    }
    case 'ABANDON':
      if (belongs(run, msg, sender) && ['paused', 'running'].includes(run.status) && run.phase === 'dispatching' && run.pending?.token === msg.token && sender.frameId === run.pending.actionFrameId && sender.documentId === run.pending.documentId) {
        run.phase = 'waiting'; run.pending = null; await save(run);
      }
      return {ok: true};
    case 'RESULT': {
      if (!run || run.id !== msg.runId || run.index !== msg.index || run.pending?.token !== msg.token || sender.frameId !== run.pending.actionFrameId || sender.documentId !== run.pending.documentId || sender.tab?.id !== run.pending.actionTabId || !ACTIVE.has(run.status)) return {ok: false};
      if (msg.error) { run.status = 'error'; await save(logRun(run, msg.error)); return {ok: true}; }
      if (run.config.steps[run.index].final) {
        run.status = 'finished'; run.phase = 'done';
        await save(logRun(run, 'Final click sent. Automation stopped. Check the website for its result.'));
      } else if (msg.verified) {
        const status = run.status; advance(run); run.status = status; await save(run);
      } else { run.phase = 'observing'; run.pending.sentAt = Date.now(); await save(logRun(run, `Action sent. Waiting for action ${run.index + 2}: ${run.config.steps[run.index + 1].title}.`)); }
      return {ok: true};
    }
    case 'OBSERVED': {
      if (!belongs(run, msg, sender) || run.status !== 'running' || run.phase === 'waiting' || run.pending?.token !== msg.token) return {ok: false};
      if (run.config.steps[run.index].final) return {ok: false};
      if (!actionPlan(run, sender, run.config.steps[run.index + 1])) return {ok: false};
      if (run.phase === 'dispatching' && run.pending.nextPresentBefore && !msg.postcondition) return {ok: false};
      advance(run); await save(run); return {ok: true};
    }
    case 'HINT':
      if (belongs(run, msg, sender) && run.status === 'running' && run.message !== msg.message) await save(logRun(run, msg.message));
      return {ok: true};
    default: throw new Error('Unknown extension message.');
  }
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  serial(() => handle(msg, sender)).then(sendResponse, e => sendResponse({error: e.message})); return true;
});
chrome.webNavigation.onCommitted.addListener(details => {
  serial(async () => {
    const run = await readRun(); if (run?.status !== 'running' || run.tabId !== details.tabId) return;
    if (details.frameId === 0) {
      run.actors = {}; run.frameBindings = {}; run.frameInventory = {}; run.frameChallenges = {};
      if (!run.openingStart || sameStartingPage(details.url, run.config.startUrl)) await checkDestination(run, details.url);
    } else {
      delete run.actors?.[details.frameId];
      for (const [key, binding] of Object.entries(run.frameBindings || {})) if (binding.frameId === details.frameId) delete run.frameBindings[key];
    }
  });
});
chrome.webNavigation.onDOMContentLoaded.addListener(details => {
  serial(async () => { const run = await readRun(); if (run?.status === 'running' && run.tabId === details.tabId) await inject(details.tabId, details.frameId); });
});
for (const event of [chrome.webNavigation.onHistoryStateUpdated, chrome.webNavigation.onReferenceFragmentUpdated]) {
  event.addListener(details => { serial(async () => {
    const run = await readRun(); if (run?.status !== 'running' || run.tabId !== details.tabId) return;
    if (details.frameId === 0) await checkDestination(run, details.url);
    const needed = plans(run).some(plan => (plan.available && plan.frameId === details.frameId) || plan.hops.some(hop => hop.parentFrameId === details.frameId));
    if (run.status === 'running' && needed) { try { await chrome.tabs.sendMessage(run.tabId, {type: 'WAKE_RUNNER'}, {frameId: details.frameId}); } catch {} }
  }); });
}
chrome.webNavigation.onCreatedNavigationTarget.addListener(details => {
  serial(async () => {
    const run = await readRun();
    if (run?.status !== 'running' || run.tabId !== details.sourceTabId || details.sourceFrameId !== run.pending?.actionFrameId || !run.pending || Date.now() - run.pending.at > 15000) return;
    run.tabId = details.tabId; run.actors = {}; run.frameBindings = {}; run.frameInventory = {}; run.frameChallenges = {}; await save(logRun(run, 'Following the tab opened by the current action.'));
    await checkDestination(run, details.url); if (run.status === 'running') await inject(run.tabId);
  });
});
chrome.tabs.onRemoved.addListener(tabId => serial(async () => { const run = await readRun(); if (ACTIVE.has(run?.status) && run.tabId === tabId) { run.status = 'stopped'; await save(logRun(run, 'The workflow tab was closed.')); } }));
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'workflow-watchdog') serial(async () => { const run = await expire(await readRun()); if (run?.status === 'running') await inject(run.tabId); }); });
async function pauseOnStartup() {
  await chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
  const run = await readRun();
  if (ACTIVE.has(run?.status) && run.config.workflowRevision !== (await config()).workflowRevision) {
    run.status = 'stopped'; await save(logRun(run, 'Workflow updated. Click Trial or Cancel & Refund to begin a new run.')); return;
  }
  if (ACTIVE.has(run?.status)) { run.status = 'paused'; run.remainingMs = run.config.stepTimeoutSeconds * 1000; await save(logRun(run, 'Browser or extension restarted. Press Resume to continue; nothing starts automatically.')); }
}
chrome.runtime.onStartup.addListener(() => serial(pauseOnStartup));
chrome.runtime.onInstalled.addListener(() => serial(pauseOnStartup));
