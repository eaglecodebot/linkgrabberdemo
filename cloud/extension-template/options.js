const $ = id => document.getElementById(id);
const fields = ['startUrl', 'step2StartUrl', 'step2SecondUrl', 'stepTimeoutSeconds', 'settleMilliseconds', 'pincodeMode', 'pincode', 'pincodeSelector'];
async function send(type, payload = {}) { const r = await chrome.runtime.sendMessage({type, ...payload}); if (r?.error) throw new Error(r.error); return r; }
function error(message) { $('error').textContent = message; $('error').hidden = !message; }
function fill(config) {
  $('managed-urls').hidden=!config.managedWorkflowUrls;
  for(const field of ['startUrl','step2StartUrl','step2SecondUrl'])$(field).readOnly=!!config.managedWorkflowUrls;
  for (const field of fields) $(field).value = config[field] ?? '';
  $('additionalOrigins').value = config.additionalOrigins.join('\n');
  $('delhiPincodes').value = config.delhiPincodes.join(', ');
  $('steps').replaceChildren(...config.steps.map(s => { const li = document.createElement('li'); li.textContent = s.title; return li; }));
  $('step2Steps').replaceChildren(...(config.step2Steps || []).map(s => { const li = document.createElement('li'); li.textContent = s.title; return li; }));
  $('pincodeCount').textContent = `${config.delhiPincodes.length} entries`;
}
$('form').addEventListener('submit', async e => {
  e.preventDefault(); error(''); $('saved').textContent = '';
  try {
    const settings = Object.fromEntries(fields.map(field => [field, $(field).value.trim()]));
    settings.stepTimeoutSeconds = Number(settings.stepTimeoutSeconds); settings.settleMilliseconds = Number(settings.settleMilliseconds);
    settings.additionalOrigins = $('additionalOrigins').value.split(/\s+/).filter(Boolean);
    settings.delhiPincodes = $('delhiPincodes').value.split(/[\s,]+/).filter(Boolean);
    const result = await send('SAVE_SETTINGS', {settings}); fill(result.config); $('saved').textContent = 'Saved. Open the extension and choose Trial, Grab Links or Cancel & Refund.';
  } catch (e) { error(e.message); }
});
$('defaults').addEventListener('click', async () => { try { error(''); fill((await send('RESET_SETTINGS')).config); $('saved').textContent = 'Loaded the current workflow.json defaults.'; } catch (e) { error(e.message); } });
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.settings) send('GET_STATUS').then(r => fill(r.config)).catch(e => error(e.message)); });
send('GET_STATUS').then(r => fill(r.config)).catch(e => error(e.message));
