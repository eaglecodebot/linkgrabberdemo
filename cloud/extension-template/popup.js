import {hostPattern, validateConfig, workflowConfig, ACTIVE} from './shared.js';
const $ = id => document.getElementById(id);
let snapshot = null, grabSetup = null, grabSetupError = '';
const stoppedMessage = 'Stopped. Click Trial or Cancel & Refund to begin a new run.';
const names = {running: 'Running', paused: 'Paused', needs_access: 'Website access needed', stopped: 'Stopped', error: 'Check this action', finished: 'Final click sent'};
async function send(type, payload = {}) { const result = await chrome.runtime.sendMessage({type, ...payload}); if (result?.error) throw new Error(result.error); return result; }
function showError(message) { $('error').textContent = message; $('error').hidden = !message; }
async function render() {
  snapshot = await send('GET_STATUS'); const {run, config} = snapshot;
  $('version').textContent = snapshot.version ? `· v${snapshot.version}` : '';
  $('workflowTitle').textContent = run && run.status !== 'stopped' ? `Step ${run.config.workflowNumber || 1} workflow` : 'Your workflows';
  $('status').textContent = run?.status === 'finished' && run.config.steps[run.index].action === 'reveal' ? 'QR code ready' : names[run?.status] || 'Ready';
  const total = run?.config.steps.length || config.steps.length;
  const waitingForNext = run && ['observing', 'dispatching'].includes(run.phase) && !run.config.steps[run.index].final;
  $('counter').textContent = run ? `${waitingForNext ? 'Waiting for action ' : 'Action '}${Math.min(run.index + (waitingForNext ? 2 : 1), total)} / ${total}` : '2 workflows';
  $('progress').max = total; $('progress').value = run?.status === 'finished' ? total : run?.index || 0;
  $('message').textContent = run?.status === 'stopped' ? stoppedMessage : run?.message || (config.startUrl || config.step2StartUrl ? 'Choose Trial or Cancel & Refund when ready.' : 'Set your private workflow URLs in Settings or workflow.json.');
  $('start').hidden = ACTIVE.has(run?.status); $('start').disabled = false;
  const {grabRun}=await send('GET_GRAB_STATUS');
  $('grab-links').hidden=ACTIVE.has(run?.status);$('grab-links').disabled=grabRun?.status==='running';
  if(grabRun?.status==='running'){$('start').disabled=true;$('start2').disabled=true;}
  $('grab-status').textContent=grabRun?.message||grabSetupError||(grabSetup?'Saving links to '+grabSetup.owner.username+'.':'Checking capture connection…');
  $('grab-status').dataset.level=grabRun?.level||'info';
  $('start2').hidden = ACTIVE.has(run?.status); $('start2').disabled = grabRun?.status==='running';
  $('pause').hidden = run?.status !== 'running'; $('resume').hidden = run?.status !== 'paused';
  $('allow').hidden = run?.status !== 'needs_access'; $('stop').hidden = !ACTIVE.has(run?.status);
  const step = run?.config.steps[run.index];
  $('retry').hidden = run?.status !== 'error' || ((step?.noRepeat || (step?.final && step.action === 'click')) && run.phase !== 'waiting');
  $('log').replaceChildren(...[...(run?.log || [])].reverse().slice(0, 12).map(entry => { const li = document.createElement('li'); const message = entry.message === 'Stopped. Press Start for a new run.' ? stoppedMessage : entry.message === 'Workflow updated. Press Start to use the new captured steps.' ? 'Workflow updated. Click Trial or Cancel & Refund to begin a new run.' : entry.message; li.textContent = `${new Date(entry.at).toLocaleTimeString()} · ${message}`; return li; }));
}
function action(id, fn) { $(id).addEventListener('click', async () => { showError(''); try { await fn(); await render(); } catch (e) { showError(e.message); } }); }
async function startWorkflow(workflowNumber) {
  const cfg = workflowConfig(snapshot.config, workflowNumber, snapshot.run);
  if (!cfg.startUrl || (workflowNumber === 2 && !cfg.secondUrl)) throw new Error(`Set ${workflowNumber === 1 ? 'the Trial URL' : 'both Cancel & Refund URLs'} in Settings or workflow.json first.`);
  const origins = validateConfig(cfg);
  if (!await chrome.permissions.request({origins: origins.map(hostPattern)})) throw new Error('Allow website access to run this workflow.');
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  await send('START', {tabId: tab?.id, workflowNumber});
  window.close();
}
action('start', () => startWorkflow(1));
action('start2', () => startWorkflow(2));
action('grab-links',async()=>{
  if(!grabSetup){try{grabSetup=await send('GET_GRAB_SETUP');grabSetupError='';}catch(e){grabSetupError=e.message;throw e;}}
  if(!await chrome.permissions.request({origins:[hostPattern(grabSetup.settings.pagePattern)]}))throw new Error('Allow website access to grab links.');
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  await send('GRAB_LINKS',{tabId:tab?.id});window.close();
});
for (const [id, type] of [['pause','PAUSE'], ['resume','RESUME'], ['stop','STOP'], ['retry','RETRY']]) action(id, () => send(type));
action('allow', async () => {
  if (!await chrome.permissions.request({origins: (snapshot.run.pendingOrigins || [snapshot.run.blockedOrigin]).map(hostPattern)})) throw new Error('Access was not granted.');
  await send('ALLOW');
});
action('settings', () => chrome.runtime.openOptionsPage());
action('diagnostics', async () => {
  const {diagnostics} = await send('DIAGNOSTICS');
  const url = URL.createObjectURL(new Blob([JSON.stringify(diagnostics, null, 2)], {type: 'application/json'}));
  const link = document.createElement('a'); link.href = url; link.download = 'workflow_diagnostics.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
});
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && (changes.run || changes.settings || changes.grabRun)) render().catch(e => showError(e.message)); });
render().catch(e => showError(e.message));

send('GET_GRAB_SETUP').then(data=>{grabSetup=data;grabSetupError='';return render();}).catch(e=>{grabSetupError=e.message;$('grab-status').textContent=e.message;$('grab-status').dataset.level='error';});
