export const ACTIVE = new Set(['running', 'paused', 'needs_access']);
export function originOf(value) {
  const u = new URL(value);
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) throw new Error('Use an HTTP or HTTPS URL without credentials.');
  return u.origin;
}
export function hostPattern(value) {
  const u = new URL(originOf(value));
  return `${u.protocol}//${u.hostname}/*`;
}
export function sameStartingPage(actual, expected) {
  try {
    const a = new URL(actual), b = new URL(expected);
    const path = p => p === '/' ? p : p.replace(/\/$/, '');
    return a.origin === b.origin && path(a.pathname) === path(b.pathname) && a.search === b.search && (!b.hash || a.hash === b.hash);
  } catch { return false; }
}
export function workflowConfig(config, number = 1, previousRun = null) {
  if (![1, 2].includes(number)) throw new Error('Choose Step 1 or Step 2.');
  const {step2StartUrl, step2SecondUrl, step2Steps, ...base} = config;
  const previous = previousRun?.config;
  // Reuse only missing URLs from the same workflow. Its action definitions,
  // revision and other settings always come from the current configuration.
  const recover = !config.managedWorkflowUrls && previous && (previous.workflowNumber || 1) === number &&
    (number === 1 ? !base.startUrl : !step2StartUrl && !step2SecondUrl);
  return number === 1 ? {...base, workflowNumber: 1, startUrl: base.startUrl || (recover ? previous.startUrl : '')}
    : {...base, workflowNumber: 2, startUrl: step2StartUrl || (recover ? previous.startUrl : '') || '', secondUrl: step2SecondUrl || (recover ? previous.secondUrl : '') || '', steps: step2Steps || []};
}
export function mergeSettings(defaults, settings) {
  const merged = {...defaults, ...settings, steps: defaults.steps, step2Steps: defaults.step2Steps};
  const legacy = ['110001', '110002', '110003', '110006', '110011', '110020'];
  if (settings.delhiPincodes?.length === legacy.length && legacy.every(pin => settings.delhiPincodes.map(String).includes(pin))) merged.delhiPincodes = defaults.delhiPincodes;
  return merged;
}
export function validateSettings(config) {
  let configured = false;
  if (config.startUrl) { validateConfig(workflowConfig(config, 1)); configured = true; }
  if (config.step2StartUrl || config.step2SecondUrl) { validateConfig(workflowConfig(config, 2)); configured = true; }
  if (!configured) throw new Error('Enter the Step 1 URL or both Step 2 URLs before saving.');
}
export function validateConfig(config) {
  if (!config.startUrl) throw new Error('Set your starting page in Settings or workflow.json first.');
  originOf(config.startUrl);
  if (!Array.isArray(config.additionalOrigins)) throw new Error('additionalOrigins must be an array.');
  if (config.workflowNumber === 2 && !config.secondUrl) throw new Error('Set both Step 2 URLs in Settings or workflow.json first.');
  const origins = [...new Set([originOf(config.startUrl), ...(config.workflowNumber === 2 ? [originOf(config.secondUrl)] : []), ...config.additionalOrigins.map(originOf)])];
  if (!(config.stepTimeoutSeconds >= 10 && config.stepTimeoutSeconds <= 1800)) throw new Error('Step timeout must be 10–1800 seconds.');
  if (!(config.settleMilliseconds >= 200 && config.settleMilliseconds <= 5000)) throw new Error('Settle time must be 200–5000 milliseconds.');
  if (!Array.isArray(config.steps) || config.steps.length === 0) throw new Error('The workflow has no steps.');
  if (!['random', 'fixed'].includes(config.pincodeMode)) throw new Error('Choose random or fixed pincode mode.');
  const pins = config.pincodeMode === 'fixed' ? [config.pincode] : config.delhiPincodes;
  if (!Array.isArray(pins) || pins.length === 0 || pins.some(p => !/^110\d{3}$/.test(String(p)))) throw new Error('Enter six-digit Delhi pincodes beginning with 110.');
  return origins;
}
export function newRun(config, tabId, random = crypto.getRandomValues(new Uint32Array(1))[0]) {
  const allowedOrigins = validateConfig(config), now = Date.now();
  const pins = config.pincodeMode === 'fixed' ? [config.pincode] : config.delhiPincodes;
  return {id: crypto.randomUUID(), status: 'running', tabId, config, allowedOrigins,
    index: 0, phase: 'waiting', startedAt: now, stepStartedAt: now,
    deadlineAt: now + config.stepTimeoutSeconds * 1000, values: {pincode: String(pins[random % pins.length])},
    message: 'Waiting for the configured starting page.', log: []};
}
export function logRun(run, message) {
  run.message = message;
  run.log = [...(run.log || []), {at: Date.now(), message}].slice(-80);
  return run;
}
export function advance(run) {
  run.previousActionAt = run.pending?.sentAt || run.pending?.at || Date.now();
  run.previousDocumentId = run.pending?.documentId;
  run.previousUrl = run.pending?.url;
  run.index += 1;
  run.phase = 'waiting';
  run.pending = null;
  run.stepStartedAt = Date.now();
  run.deadlineAt = Date.now() + run.config.stepTimeoutSeconds * 1000;
  return logRun(run, `Waiting for action ${run.index + 1}: ${run.config.steps[run.index].title}.`);
}
export function frameKey(parentFrameId, prefix, css) {
  return JSON.stringify([parentFrameId, prefix, css]);
}
export function contextPlan(run, step) {
  if (!step) return {available: false, hops: []};
  let frameId = 0, prefix = [];
  const context = step.context || [], hops = [];
  for (let i = 0; i < context.length; i++) {
    const part = context[i];
    if (part.kind !== 'frame') { prefix.push(part); continue; }
    const key = frameKey(frameId, prefix, part.css);
    hops.push({key, parentFrameId: frameId, prefix, css: part.css});
    const inventory = run.frameInventory?.[key], binding = run.frameBindings?.[key];
    if (binding && inventory?.count === 1 && inventory.visibleCount === 1) {
      frameId = binding.frameId; prefix = []; continue;
    }
    // The site can render the same survey directly after a redirect. A real
    // captured frame, including a hidden or still-loading one, prevents fallback.
    if (frameId === 0 && step.allowTopLevelFallback && !context.slice(i + 1).some(p => p.kind === 'frame') && inventory?.ready && inventory.count === 0 && Date.now() - inventory.since >= 1500) {
      return {available: true, frameId: 0, step: {...step, context: [...prefix, ...context.slice(i + 1)]}, hops, fallback: true};
    }
    return {available: false, hops, reason: inventory?.count > 1 ? 'More than one captured frame is present.' : inventory?.count === 0 ? 'Waiting for the captured frame or the survey on the main page.' : 'Connecting to the embedded page.'};
  }
  return {available: true, frameId, step: {...step, context: prefix}, hops};
}
export function redactedDiagnostics(run, version) {
  if (!run) return {version, status: 'idle'};
  const hidden = [run.config.startUrl, run.config.secondUrl, ...(run.allowedOrigins || []), ...Object.values(run.values || {}).filter(v => typeof v === 'string' && v.length >= 3)].filter(Boolean).sort((a, b) => b.length - a.length);
  function clean(value) {
    if (typeof value === 'string') { for (const secret of hidden) value = value.replaceAll(secret, '[private value]'); return value.replace(/https?:\/\/[^\s"'<>]+/g, '[private page]'); }
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, clean(v)]));
    return value;
  }
  return clean({version, workflowStep: run.config.workflowNumber || 1, status: run.status, action: run.index + 1, totalActions: run.config.steps.length,
    actionName: run.config.steps[run.index]?.title, phase: run.phase, message: run.message,
    frames: Object.entries(run.actors || {}).map(([frameId, actor]) => ({frameId: Number(frameId), parentFrameId: actor.parentFrameId, readyState: actor.readyState, lastSeenSecondsAgo: Math.round((Date.now() - actor.at) / 1000)})),
    contexts: Object.values(run.frameInventory || {}).map(info => ({count: info.count, visibleCount: info.visibleCount, ready: info.ready})),
    lastInjectionError: run.lastInjectionError || null, recentActivity: (run.log || []).slice(-25)});
}
