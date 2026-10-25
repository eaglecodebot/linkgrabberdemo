const $ = id => document.getElementById(id);
let token = sessionStorage.getItem('lg-cloud-token') || '', me = null, users = [], refreshVersion = 0, scriptRequest = 0, scriptMutation = false, displayedScriptId = '';
function note(message,level='info') { $('notice').textContent = message; $('notice').className=level==='error'?'error':level==='warning'?'warning':''; $('notice').hidden = false; }
function el(tag, text) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; return n; }
function action(text, fn) { const b = el('button', text); b.onclick = run(fn); return b; }
function run(fn) { return async event => { event?.preventDefault(); const b = event?.submitter || (event?.currentTarget?.tagName === 'BUTTON' ? event.currentTarget : null); if (b) b.disabled = true; try { await fn(); } catch (e) { note(e.message,'error'); } finally { if (b?.isConnected) b.disabled = false; } }; }
async function api(path, data) {
 const requestToken=token;
 const r=await fetch('/api/'+path,{headers:{Authorization:'Bearer '+requestToken,...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{method:'POST',body:JSON.stringify(data)})});
 const b=await r.json();
 if(!r.ok){if(r.status===401&&path!=='login'&&token===requestToken){signOut();note(b.error||'Please log in again.','error');}const e=new Error(b.error||'Request failed.');e.status=r.status;e.scriptStatus=b.scriptStatus;throw e;}return b;
}
function clearScript(){displayedScriptId='';$('console-script').value='';$('script-area').hidden=true;$('generate-script').hidden=true;$('revoke-scripts').hidden=true;if(me)sessionStorage.removeItem('lg-web-script:'+me.id);}
function signOut() {scriptRequest++;clearScript();$('script-status').hidden=false;$('script-status-title').textContent='Checking script…';$('script-status-reason').textContent='';$('regenerate-script').hidden=true;$('retry-script-status').hidden=true;token='';me=null;refreshVersion++;sections.reset();$('exports').replaceChildren();sessionStorage.removeItem('lg-cloud-token');$('workspace').hidden=true;$('login-card').hidden=false;$('auth-loading').hidden=true;$('logout').hidden=true;}
function renderScriptStatus(status){
 const active=status.status==='active';
 $('script-status').hidden=active;$('retry-script-status').hidden=true;
 if(!active){clearScript();$('script-status-title').textContent=status.status==='missing'?'Generate your private script':'Script revoked · replacement required';$('script-status-reason').textContent=status.reason;}
 $('regenerate-script').hidden=!status.canRegenerate;
 $('regenerate-script').textContent=status.status==='missing'?'Generate script':'Regenerate script';
 if(active){$('generate-script').hidden=false;$('revoke-scripts').hidden=false;}
}
function unavailableScript(message){clearScript();$('script-status').hidden=false;$('script-status-title').textContent='Script unavailable';$('script-status-reason').textContent=message;$('regenerate-script').hidden=true;$('retry-script-status').hidden=false;}
async function checkScript(){
 if(!me||scriptMutation)return;
 const ownRequest=++scriptRequest,session=token;
 try{
  const {scriptStatus}=await api('capture-script/status');
  if(ownRequest!==scriptRequest||session!==token||!me)return;
  renderScriptStatus(scriptStatus);
  if(scriptStatus.status==='active'&&displayedScriptId!==scriptStatus.scriptId){
   const data=await api('capture-script');
   if(ownRequest===scriptRequest&&session===token&&me)showScript(data);
  }
 }catch(e){
  if(ownRequest!==scriptRequest||session!==token||!me)return;
  if(e.scriptStatus)renderScriptStatus(e.scriptStatus);else unavailableScript(e.message);
 }
}
async function changeScript(fn){if(scriptMutation)return;scriptMutation=true;scriptRequest++;try{await fn();}finally{scriptRequest++;scriptMutation=false;}}
function params() { const p = new URLSearchParams({ status: $('status').value, q: $('search').value }); if (me?.role === 'admin' && $('history-user').value) p.set('userId', $('history-user').value); return p; }
const date = value => new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST';
const sections = createLinkSections({ container: $('link-sections'), load: p => api('links?' + p),
  copy: async rows => { await navigator.clipboard.writeText(rows.map(r => r.url).join('\n')); note(rows.length + ' URLs copied.'); },
  exportSection: service => exportTxt(service), date, onError: message=>note(message,'error') });
function download(item) { const url = URL.createObjectURL(new Blob([item.urls.join('\r\n') + '\r\n'], { type: 'text/plain;charset=utf-8' })), a = el('a'); a.href = url; a.download = item.filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
async function renderUsers() {
  if (me.role !== 'admin') return;
  const selected = $('history-user').value || me.id; users = (await api('admin/users')).users;
  $('users').replaceChildren(); $('history-user').replaceChildren(); $('reset-user').replaceChildren();
  for (const u of users) {
    $('history-user').add(new Option(u.name + ' (' + u.username + ')', u.id));
    if (u.role === 'user') $('reset-user').add(new Option(u.username, u.id));
    const row = el('div'); row.className = 'profile-item'; const info = el('div'); info.append(el('strong', u.name + ' · ' + u.username), el('small', u.active ? ' Active' : ' Disabled'));
    const controls = el('div'); controls.className = 'row'; controls.append(action('View history', async () => { $('history-user').value = u.id; refreshVersion++; sections.reset(); $('exports').replaceChildren(); await refresh(); }));
    controls.append(action('Revoke script',async()=>{await api('admin/users/revoke-script',{id:u.id});if(u.id===me.id){scriptRequest++;await checkScript();}note('Capture scripts revoked for '+u.username+'. The user must click Regenerate script.','success');}));
    if (u.role === 'user') controls.append(action(u.active ? 'Disable' : 'Enable', async () => { await api('admin/users/update', { id: u.id, active: !u.active }); await renderUsers(); }));
    row.append(info, controls); $('users').append(row);
  }
  $('history-user').value = selected; if (!$('history-user').value) $('history-user').value = me.id;
}
function renderSettings(settings) {
 $('configured-page').textContent=settings.configured?settings.pagePattern:'The administrator must configure the main webpage.';
 $('configured-services').textContent=settings.enabledServices.length?settings.enabledServices.join(', '):'Capture paused — no services enabled';
 if(me?.role==='admin'){
  $('page-pattern').value=settings.pagePattern;
  for(const input of document.querySelectorAll('input[name="service"]'))input.checked=settings.enabledServices.includes(input.value);
 }
}
async function enter() {
 me=(await api('me')).user;
 $('login-card').hidden=true; $('auth-loading').hidden=true; $('workspace').hidden=false; $('logout').hidden=false;
 $('welcome').textContent='Signed in as '+me.name;
 $('capture-owner').textContent='Captures save to '+me.name+' ('+me.username+')';
 $('admin').hidden=me.role!=='admin'; $('history-user').hidden=me.role!=='admin';
 renderSettings((await api('settings')).settings);
 sessionStorage.removeItem('lg-web-script:'+me.id);
 await checkScript();
 if(!me)return;await renderUsers();await refresh();
}
function showScript(data){renderScriptStatus(data.scriptStatus);displayedScriptId=data.scriptId;$('console-script').value=data.script;$('script-expiry').textContent='Permanent script for '+data.owner.username+' · no automatic expiry. Password changes, disabling or revocation require Regenerate script.';$('script-area').hidden=false;}
$('settings-form').onsubmit=run(async()=>{
 const enabledServices=[...document.querySelectorAll('input[name="service"]:checked')].map(input=>input.value);
 await api('settings',{pagePattern:$('page-pattern').value,enabledServices});
 renderSettings((await api('settings')).settings);
 note('Capture settings saved for all users. Their current v6 scripts use the changes automatically.','success');
});
async function copyMine(){
 const session=token,request=++scriptRequest;
 try{
  const data=await api('capture-script');if(request!==scriptRequest||session!==token||!me)return;showScript(data);
  try{await navigator.clipboard.writeText(data.script);note('Your permanent script is copied. Check Saving to: '+data.owner.username+' on the source page.','success');}
  catch{$('console-script').focus();$('console-script').select();throw new Error('Script selected. Press Ctrl+C to copy it.');}
 }catch(e){if(session===token&&me){if(e.scriptStatus)renderScriptStatus(e.scriptStatus);else if(e.status)unavailableScript(e.message);}throw e;}
}
$('generate-script').onclick=run(copyMine);
$('copy-script').onclick=run(copyMine);
$('retry-script-status').onclick=run(checkScript);
$('regenerate-script').onclick=run(()=>changeScript(async()=>{
 clearScript();const session=token;const data=await api('capture-script/regenerate',{});if(session!==token||!me)return;
 showScript(data);note('Your script is ready. Click Copy my script to use it. Earlier revoked copies remain invalid.','success');
}));
$('revoke-scripts').onclick=run(()=>changeScript(async()=>{
 await api('capture-scripts/revoke',{});clearScript();const {scriptStatus}=await api('capture-script/status');renderScriptStatus(scriptStatus);note('All your capture scripts have been revoked.','success');
}));
$('import-capture').onclick=run(async()=>{const raw=$('manual-capture').value.trim();if(!/^LG_WEB_V[456]:/.test(raw))throw new Error('Paste a Link Grabber Web capture packet.');let packet;try{packet=JSON.parse(raw.slice(raw.indexOf(':')+1));}catch{throw new Error('Invalid capture packet.');}
 const data=await api('capture-import',packet);note('Saving to: '+data.result.owner.username+' · '+data.result.message,data.result.level);$('manual-capture').value='';await refresh();});
async function refresh() {
  if (!me) return;
  const ownVersion = ++refreshVersion;
    const p = params();
    const selected = users.find(u => u.id === $('history-user').value); $('history-title').textContent = selected ? selected.name + ' — links by service' : 'Your links by service';
    const data = await sections.refresh(p);
    if (!data || ownVersion !== refreshVersion || !me) return;
    $('count').textContent = data.total + ' matching links';
    const history = await api('exports?' + p);
    if (ownVersion !== refreshVersion || !me) return;
    $('exports').replaceChildren();
    for (const item of history.exports) { const row = el('div'); row.className = 'profile-item'; row.append(el('span', item.filename + ' · ' + item.count + ' links · ' + date(item.createdAt)), action('Download again', async () => { const q = params(); q.set('id', item._id); download((await api('exports/get?' + q)).export); })); $('exports').append(row); }
}
$('login').onsubmit = run(async () => { const r = await api('login', { username: $('username').value, password: $('password').value }); $('password').value = ''; token = r.token; sessionStorage.setItem('lg-cloud-token', token); $('notice').hidden=true;await enter(); });
$('logout').onclick = run(async () => { await api('logout', {}); signOut(); });
$('create-user').onsubmit = run(async () => { await api('admin/users', { username: $('new-username').value, name: $('new-name').value, password: $('create-password').value }); $('create-password').value = ''; $('new-username').value = ''; $('new-name').value = ''; await renderUsers(); note('User created.'); });
$('reset-password').onsubmit = run(async () => { await api('admin/users/update', { id: $('reset-user').value, password: $('reset-value').value }); $('reset-value').value = ''; note('Password reset. Earlier sessions and capture scripts are revoked. The user must log in and click Regenerate script.'); });
$('change-password').onsubmit = run(async () => { await api('password', { currentPassword: $('current-password').value, password: $('new-password').value }); $('current-password').value = ''; $('new-password').value = ''; signOut(); note('Password changed. Your capture script was revoked. Log in again, then click Regenerate script.'); });
async function exportTxt(service) { const p = params(); if (service) p.set('service', service); download((await api('exports', Object.fromEntries(p))).export); await refresh(); note((service || 'Combined') + ' TXT prepared. Saved links remain available in history.'); }
$('export').onclick = run(() => exportTxt());
for (const id of ['history-user','status']) $(id).onchange = run(async () => { refreshVersion++; sections.reset(); $('exports').replaceChildren(); await refresh(); });
let timer; $('search').oninput = () => { clearTimeout(timer); timer = setTimeout(run(async () => { sections.reset(); await refresh(); }), 300); };
setInterval(()=>{if(me)refresh().catch(e=>note(e.message,'error'));},5000);
setInterval(()=>void checkScript(),2000);
window.addEventListener('focus',()=>void checkScript());
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void checkScript();});
async function restoreSession(){
 $('auth-loading').hidden=false;$('login-card').hidden=true;$('auth-retry').hidden=true;
 $('auth-message').textContent='Checking your session…';
 try{await enter();}catch(e){
  if(!token){note(e.message,'error');return;}
  if(me){note(e.message,'error');return;}
  $('auth-message').textContent='Could not check your session. Try again when connected.';
  $('auth-retry').hidden=false;
 }
}
$('auth-retry').onclick=run(restoreSession);
if(token)void restoreSession();else signOut();
