(() => {
  if (globalThis.__privateWorkflowRunner) return;
  globalThis.__privateWorkflowRunner = true;
  const E = globalThis.PrivateWorkflow;
  const send = async data => { const r = await chrome.runtime.sendMessage(data); if (r?.error) throw new Error(r.error); return r; };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let enabled = true, looping = false, invalid = false, observer, napTimer, releaseNap, dirty = false, wakeVersion = 0;
  let stability, packet, lastHint = '', lastMutationWake = 0, mutationTimer, lastActionTarget, search, dispatched, navigationObservation;
  const discoveryAt = new Map();
  const dismissals = new Map();
  let dismissalToken = 0;
  function stop() { enabled = false; observer?.disconnect(); observer = null; clearTimeout(mutationTimer); mutationTimer = null; stability = null; search = null; lastActionTarget = null; if (releaseNap) releaseNap(); }
  function wake() { if (invalid) return; wakeVersion++; enabled = true; dirty = true; if (releaseNap) releaseNap(); loop(); }
  function monitor() {
    if (observer || document.readyState === 'loading') return;
    observer = new MutationObserver(() => {
      if (mutationTimer) return;
      const remaining = 150 - (Date.now() - lastMutationWake);
      const notify = () => { mutationTimer = null; if (enabled) { lastMutationWake = Date.now(); wake(); } };
      if (remaining <= 0) notify();
      else mutationTimer = setTimeout(notify, remaining);
    });
    observer.observe(document.documentElement, {subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'aria-disabled', 'aria-busy', 'hidden']});
  }
  function stableDelay(element, key, milliseconds, reveal = false) {
    const now = Date.now();
    if (stability?.element !== element || stability.key !== key) {
      if (reveal) E.centerOnScreen(element); else E.scrollIntoView(element);
      stability = {element, key, signature: null, since: now};
    }
    const target = E.proxy(element);
    if (!target) { stability = null; return 150; }
    const rect = target.getBoundingClientRect();
    const signature = [rect.x, rect.y, rect.width, rect.height].map(Math.round).join(',');
    if (signature !== stability.signature) { stability.signature = signature; stability.since = now; }
    return Math.max(0, milliseconds - (now - stability.since));
  }
  function recover(result, task, step) {
    const key = `${task.runId}:${task.index}:${step?.id}`;
    if (search?.key !== key) search = {key, at: 0, moves: 0};
    if (Date.now() - search.at < 500 || result.blocked) return false;
    search.at = Date.now();
    if (result.scrollTarget) { E.scrollIntoView(result.scrollTarget); return true; }
    return result.missing && E.seek(lastActionTarget, search);
  }
  async function hint(message) {
    if (!message || !packet?.runId) return;
    const key = `${packet.runId}:${packet.index}:${message}`;
    if (key === lastHint) return; lastHint = key;
    await send({type: 'HINT', runId: packet.runId, index: packet.index, message});
  }
  async function discover() {
    for (const item of packet.discoveries || []) {
      if (Date.now() - (discoveryAt.get(item.key) || 0) < 1000) continue;
      discoveryAt.set(item.key, Date.now());
      const info = E.inspectFrame(item.prefix, item.css);
      const target = info.count === 1 ? info.elements[0] : null;
      const sourceUrl = target ? new URL(target.getAttribute('src') || 'about:blank', target.ownerDocument.baseURI).href : '';
      const report = await send({type: 'FRAME_REPORT', runId: packet.runId, key: item.key, nonce: item.nonce, count: info.count, visibleCount: info.visibleCount, ready: info.ready, sourceUrl});
      if (report?.active && target && info.visibleCount === 1) target.contentWindow?.postMessage({kind: 'PWR_BIND_FRAME_V1', runId: packet.runId, nonce: item.nonce}, '*');
    }
  }
  async function tick() {
    const requestedAt = wakeVersion;
    packet = await send({type: 'PULL', url: location.href, readyState: document.readyState});
    if (!enabled) return 0;
    if (!packet?.active) { if (wakeVersion !== requestedAt) return 200; stop(); return 0; }
    if (packet.passive) { observer?.disconnect(); observer = null; clearTimeout(mutationTimer); mutationTimer = null; stability = null; return -1; }
    if (document.readyState === 'loading') { stability = null; return 800; }
    monitor(); await discover();
    if (!enabled) return 0;
    const task = packet.task;
    if (!task) { stability = null; if (packet.reason) await hint(packet.reason); return 900; }
    if (task.phase !== 'waiting') {
      if (task.step.final) return 200;
      let currentDone = E.postcondition(task.step, task);
      if (task.next?.action === 'navigate') {
        const prior = E.resolve(task.step, task, {includeUnready: true}).element;
        const samePage = packet.documentId === task.pending.documentId && location.href === task.pending.url;
        const inFlight = dispatched?.runId === task.runId && dispatched.index === task.index && E.proxy(dispatched.element) && !E.ready(dispatched.element);
        const oldPageStillPresent = samePage && Boolean(prior);
        if (oldPageStillPresent || inFlight || Date.now() - (task.pending.sentAt || task.pending.at) < (task.next.afterPreviousMilliseconds || 1500)) {
          navigationObservation = null;await hint('Waiting for the Confirm cancel screen to finish before opening URL 2.');return 250;
        }
        const key = `${task.runId}:${task.index}:${task.pending.token}`;
        if (navigationObservation?.key !== key) navigationObservation = {key, at: Date.now()};
        if (Date.now() - navigationObservation.at < task.settleMilliseconds) return 150;
        await send({type:'OBSERVED',runId:task.runId,index:task.index,token:task.pending.token,postcondition:true});return 0;
      }
      const result = E.resolve(task.next, {...task, index: task.index + 1});
      if (!result.element) { stability = null; const moved = recover(result, task, task.next); await hint(`Action ${task.index + 2}: ${result.reason}`); return moved ? 150 : 700; }
      if (task.next.afterNavigation && task.navigationChanged) currentDone = true;
      if (task.step.transitionRequired && packet.documentId === task.pending.documentId && location.href === task.pending.url) {
        if (E.transitionSignature(result.element) === task.pending.contextSignature) {stability=null;await hint('Waiting for the first Continue to cancel screen to change before the next Continue.');return 250;}
        currentDone = true;
      }
      // The next control's stability check also qualifies it for the next
      // action. Keep the same key when OBSERVED advances the saved checkpoint.
      const remaining = Math.max(stableDelay(result.element, `${task.runId}:${task.index + 1}:${task.next.id}`, Math.max(task.settleMilliseconds, task.next.enabledMilliseconds || 0), task.next.action === 'reveal'), task.settleMilliseconds - (Date.now() - task.pending.at));
      if (remaining > 0) return Math.min(150, remaining);
      if (task.phase === 'dispatching' && task.pending.nextPresentBefore && !currentDone) return 600;
      await send({type: 'OBSERVED', runId: task.runId, index: task.index, token: task.pending.token, postcondition: currentDone}); return 0;
    }
    if (task.step.action === 'navigate') {await send({type:'NAVIGATE',runId:task.runId,index:task.index});return 700;}
    let actionStep = task.step, repairing = false;
    for (const required of task.preconditions || []) {
      const match = E.resolve(required, task, {includeUnready: true});
      if (!match.element) { stability = null; const moved = recover(match, task, required); await hint(match.reason || `Waiting for ${required.title}.`); return moved ? 150 : 700; }
      if (!E.postcondition(required, task)) { actionStep = required; repairing = true; break; }
    }
    let preparation;
    // Close the captured overlay before finding, scrolling, or stabilizing Next.
    if (!repairing && task.step.before?.length) {
      preparation = await send({type: 'PREPARE_BEFORE', runId: task.runId, index: task.index});
      if (!preparation?.ready) { await hint(preparation?.message); return 150; }
      if (preparation.advanced) {stability=null;return 0;}
    }
    const result = E.resolve(actionStep, task), element = result.element;
    if (!element) { stability = null; const moved = recover(result, task, actionStep); await hint(result.reason); return moved ? 150 : 700; }
    const blocked = E.submitBlock(element);
    if (blocked) { stability = null; await hint(blocked); return 700; }
    const remaining = stableDelay(element, `${task.runId}:${task.index}:${repairing ? 'repair:' : ''}${actionStep.id}`, Math.max(task.settleMilliseconds, actionStep.enabledMilliseconds || 0), actionStep.action === 'reveal');
    if (remaining > 0) return Math.min(150, remaining);
    const uncovered = actionStep.action === 'reveal' ? E.revealVisible(element) : E.unobstructed(element);
    if (!uncovered) { recover({scrollTarget: element}, task, actionStep); await hint(preparation?.absent ? `Action ${task.index + 1}: the captured tooltip is absent; ${task.step.title} is still covered or outside view.` : `Action ${task.index + 1}: waiting for the control to be uncovered and in view.`); return 300; }
    const base = {runId: task.runId, index: task.index};
    if (task.step.action === 'reveal') {
      if (!E.postcondition(task.step, task)) { E.centerOnScreen(element); stability = null; return 200; }
      await send({type: 'REVEALED', ...base, point: E.pointFor(element)}); return 0;
    }
    if (repairing) {
      const allowed = await send({type: 'CAN_REPAIR', ...base, stepId: actionStep.id, point: E.pointFor(element)});
      if (allowed?.allowed) { const current = E.resolve(actionStep, task).element; if (current === element && E.unobstructed(current)) { E.perform(actionStep, task, current); lastActionTarget = current; await sleep(250); } }
      stability = null; return 0;
    }
    const claim = await send({type: 'CLAIM', ...base, url: location.href, contextSignature: task.step.transitionRequired ? E.transitionSignature(element) : undefined, nextPresentBefore: Boolean(E.resolve(task.next, task).element), point: E.pointFor(element)});
    if (!claim?.allowed) { if (claim?.reason) await hint(claim.reason); return 600; }
    base.token = claim.token;
    if (!(await send({type: 'CAN_ACT', ...base}))?.allowed) { await send({type: 'ABANDON', ...base}); return 300; }
    try {
      const current = E.resolve(task.step, task).element;
      if (current !== element || !E.unobstructed(current) || E.perform(task.step, task, current) === false) {
        await send({type: 'ABANDON', ...base}); stability = null;
        await hint('The control changed or became disabled before the click; waiting for it to be ready again.'); return 150;
      }
      lastActionTarget = current;
      dispatched = {runId: task.runId, index: task.index, element: current};
      if (task.step.action !== 'click') { await sleep(250); if (!E.postcondition(task.step, task)) throw new Error(`Action ${task.index + 1} did not keep the expected selection or text.`); }
      await send({type: 'RESULT', ...base, verified: task.step.action !== 'click'});
    } catch (e) { try { await send({type: 'RESULT', ...base, error: e.message}); } catch {} }
    return 0;
  }
  async function nap(delay) {
    if (!enabled) return;
    delay = dirty ? Math.min(delay, 250) : delay; dirty = false;
    await new Promise(resolve => { const done = () => { clearTimeout(napTimer); releaseNap = null; resolve(); }; releaseNap = done; napTimer = setTimeout(done, delay); });
  }
  async function loop() {
    if (looping) return; looping = true;
    while (enabled && !invalid) {
      const generation = wakeVersion;
      let delay = 700;
      try { delay = await tick(); }
      catch (e) {
        if (/Extension context invalidated/i.test(e.message)) { invalid = true; stop(); break; }
        try { await hint(`Runner error: ${String(e.message).replace(/https?:\/\/\S+/g, '[private page]').slice(0, 240)}`); } catch {}
      }
      if (delay < 0) { if (wakeVersion !== generation) continue; break; }
      await nap(delay);
    }
    looping = false;
  }
  window.addEventListener('message', event => {
    if (!enabled || window === window.top || event.source !== window.parent || event.data?.kind !== 'PWR_BIND_FRAME_V1' || typeof event.data.nonce !== 'string') return;
    send({type: 'BIND_FRAME', runId: event.data.runId, nonce: event.data.nonce, readyState: document.readyState}).then(r => { if (r?.ok) wake(); }).catch(() => {});
  });
  document.addEventListener('DOMContentLoaded', () => { if (enabled) wake(); }, {once: true});
  window.addEventListener('pageshow', () => { if (enabled) wake(); });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message.type === 'WAKE_RUNNER') { wake(); respond({ok: true}); }
    if (message.type === 'STOP_RUNNER') { stop(); respond({ok: true}); }
    if (message.type === 'CHECK_CHILD_POINT') {
      const info = E.inspectFrame(message.prefix, message.css);
      if (info.count === 1) E.scrollIntoView(info.elements[0]);
      respond(E.childPoint(message.prefix, message.css, message.point));
    }
    if (message.type === 'DISMISS_CAPTURED') {
      if (!enabled || document.readyState === 'loading') { respond({ready: false}); return; }
      const step = message.step, result = E.resolve(step, {index: message.index});
      const key = `${message.runId}:${message.index}:${step.id}`;
      if (!result.element) {
        respond({ready: Boolean(result.missing && !result.blocked), absent: Boolean(result.missing && !result.blocked), message: result.reason}); return;
      }
      const element = result.element;
      let entry = dismissals.get(key);
      if (entry?.element !== element) { E.scrollIntoView(element); entry = {element, at: Date.now(), token: String(++dismissalToken)}; dismissals.set(key, entry); }
      if (entry.clicked) { respond({ready: false, message: 'Waiting for the captured chat tooltip to disappear.'}); return; }
      const r = E.proxy(element)?.getBoundingClientRect(), signature = r && [r.x,r.y,r.width,r.height].map(Math.round).join(',');
      if (entry.signature !== signature) { entry.signature = signature; entry.at = Date.now(); }
      if (Date.now() - entry.at < message.settleMilliseconds || !E.unobstructed(element)) { respond({ready: false, message: 'Waiting for the captured chat tooltip close button to be ready.'}); return; }
      if (!message.commit) { respond({ready: false, canClick: true, token: entry.token, point: E.pointFor(element)}); return; }
      if (message.commit !== entry.token) { respond({ready: false, message: 'The captured tooltip control changed; checking it again.'}); return; }
      const clicked = E.perform(step, {}, element) !== false;
      if (clicked) entry.clicked = true;
      respond({ready: false, clicked, message: 'Waiting for the captured chat tooltip to disappear.'});
    }
  });
  wake();
})();
