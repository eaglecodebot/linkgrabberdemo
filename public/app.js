const $ = id => document.getElementById(id);
let state = { accounts: [], rules: [], sessions: [] }, key = '', selected = localStorage.getItem('lg-account') || '';
let profiles = [], profilePage = 1, linkPage = 1, linkRows = [], linksTotal = 0, noticeTimer;
async function api(path, data) {
  const res = await fetch('/api/' + path, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-App-Key': key }, body: JSON.stringify(data) });
  const body = await res.json(); if (!res.ok) throw new Error(body.error || 'Request failed.'); return body;
}
function notice(message, error = false) { $('notice').textContent = message; $('notice').className = error ? 'error' : ''; $('notice').hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => $('notice').hidden = true, error ? 18000 : 7000); }
function handle(fn) { return async event => { event?.preventDefault(); const button = event?.currentTarget?.tagName === 'BUTTON' ? event.currentTarget : event?.submitter; if (button) button.disabled = true; try { await fn(event); } catch (e) { notice(e.message, true); } finally { if (button?.isConnected) button.disabled = false; } }; }
function node(tag, text, cls) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; }
function button(text, action, cls = '') { const b = node('button', text, cls); b.onclick = handle(action); return b; }
function info(title, subtitle) { const n = node('div', undefined, 'item-info'); n.append(node('strong', title), node('small', subtitle)); return n; }
function options(el, values, empty, current) { el.replaceChildren(new Option(empty, '')); for (const a of values) el.add(new Option(a.name, a.id)); el.value = current || ''; }
function accountForm(a) { $('account-id').value = a?.id || ''; $('account-name').value = a?.name || ''; $('account-token').value = ''; $('account-token').placeholder = a ? 'New token (leave blank to keep existing)' : 'Paste token here'; $('account-name').focus(); }
function ruleDraft() { return { id: 'main', name: 'Main webpage', pagePattern: $('page-pattern').value, selector: 'a[href]', attribute: 'href', decodeMode: 'perks', minLinks: Number($('minimum-links').value), enabled: $('rule-enabled').checked }; }
function ruleForm(r) { $('page-pattern').value = r?.pagePattern || ''; $('minimum-links').value = r?.minLinks || 4; $('rule-enabled').checked = r?.enabled !== false; $('preview-result').hidden = true; }
function renderRules() {
  $('rules').replaceChildren();
  for (const r of state.rules) {
    const row = node('div', undefined, 'rule-item'), actions = node('div', undefined, 'row');
    actions.append(button('Load settings', () => ruleForm(r), 'quiet'), button(r.enabled ? 'Disable' : 'Enable', async () => { await api('rules', { ...r, enabled: !r.enabled }); await refresh(); }, 'quiet'));
    row.append(info(r.name + (r.enabled ? '' : ' · disabled'), r.pagePattern), actions); $('rules').append(row);
  }
}
function renderSessions() {
  $('sessions').replaceChildren();
  if (!state.sessions.length) $('sessions').append(node('p', 'No monitored profiles yet. Open one above, or try the demo.', 'hint'));
  for (const s of state.sessions) {
    const row = node('div', undefined, 'session-item'), details = info(s.profileName, s.accountName + ' · ' + s.state + ' · ' + s.added + ' new links this session · ' + s.pages + ' tabs');
    if (s.error) details.append(node('small', s.error, 'error'));
    if (s.captureStatus) details.append(node('small', s.captureStatus));
    row.append(details);
    if (!['closed','starting','stopping'].includes(s.state)) row.append(button('Stop & sync', async () => { notice('Closing and syncing this profile. Please wait…'); await api('stop', { id: s.id }); await refresh(); notice('Profile closed and sync finished.'); }, 'quiet'));
    $('sessions').append(row);
  }
}
async function refresh() {
  const next = await api('state'); key = next.appKey;
  const changedAccounts = JSON.stringify(next.accounts) !== JSON.stringify(state.accounts);
  const changedRules = JSON.stringify(next.rules) !== JSON.stringify(state.rules);
  const changedSessions = JSON.stringify(next.sessions) !== JSON.stringify(state.sessions);
  state = next;
  const connected = !!state.cloud?.connected;
  $('cloud-login').hidden = connected; $('cloud-account').hidden = !connected;
  $('cloud-user').textContent = connected ? state.cloud.user.name + ' (' + state.cloud.user.username + ')' : '';
  $('cloud-status').textContent = connected ? (state.cloud.error || (state.cloud.pending ? state.cloud.pending + ' items waiting for cloud sync' : 'All captures and exports synced to cloud')) : 'Local mode — not backed up online';
  if (changedRules && !$('page-pattern').value) { const main = next.rules.find(r => r.id === 'main'); if (main) ruleForm(main); }
  if (!state.accounts.some(a => a.id === selected)) selected = state.accounts[0]?.id || '';
  if (changedAccounts || $('account').value !== selected) { options($('account'), state.accounts, 'Select account', selected); options($('link-account'), [...state.accounts, { id: 'demo', name: 'Demo' }], 'All accounts', $('link-account').value); }
  if (changedRules) renderRules(); if (changedSessions) renderSessions();
  $('total').textContent = state.total; $('running').textContent = state.sessions.filter(s => ['running','starting'].includes(s.state)).length;
  $('mode').textContent = state.paused ? 'Paused' : 'Active'; $('pause').textContent = state.paused ? 'Resume collection' : 'Pause collection';
}
async function launch(id, name) { if (!selected) throw new Error('Select an account first.'); await api('launch', { accountId: selected, profileId: id, profileName: name }); notice('Opening profile. The first launch may download Orbita; watch its status below.'); await refresh(); }
function renderProfiles() {
  $('profiles').replaceChildren(); const q = $('profile-search').value.toLowerCase();
  for (const p of profiles.filter(p => (p.name + p.id).toLowerCase().includes(q))) { const row = node('div', undefined, 'profile-item'); row.append(info(p.name, p.id), button('Open & collect', () => launch(p.id, p.name), 'primary')); $('profiles').append(row); }
  $('profile-page').textContent = profiles.length ? 'GoLogin page ' + profilePage + ' · ' + profiles.length + ' profiles loaded' : 'No profiles loaded.';
  $('previous-profiles').disabled = profilePage <= 1;
}
async function loadProfiles() { if (!selected) throw new Error('Add and select a GoLogin account first.'); const a = selected; const result = await api('profiles?accountId=' + encodeURIComponent(a) + '&page=' + profilePage); if (selected !== a) return; profiles = result.profiles; renderProfiles(); if (!profiles.length) notice('No profiles on this page. Try Previous or enter a profile ID.'); }
function linkParams() { return new URLSearchParams({ q: $('link-search').value, accountId: $('link-account').value, status: $('link-status').value, page: String(linkPage) }); }
function cloudView() { return $('link-source').value === 'cloud'; }
async function loadLinks() {
  if (cloudView() && !state.cloud?.connected) return;
  const data = await api((cloudView() ? 'cloud/' : '') + 'links?' + linkParams()); linksTotal = data.total; linkRows = data.rows; $('links').replaceChildren();
  for (const r of linkRows) {
    const tr = node('tr'), link = node('td'), context = node('td'), rule = node('td'), actions = node('td');
    if (r.label) link.append(node('strong', r.label));
    const a = node('a', r.url); a.href = r.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.title = 'Open in your default browser'; link.append(a, node('small', 'From: ' + r.source_url));
    context.append(node('strong', r.profile_name), node('small', r.account_name)); rule.append(node('strong', r.service || 'Decoded'), node('small', new Date(r.first_seen).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST'));
    actions.append(button('Copy', async () => { await navigator.clipboard.writeText(r.url); notice('Link copied.'); }, 'quiet'));
    tr.append(link, context, rule, actions); $('links').append(tr);
  }
  if (!linkRows.length) { const tr = node('tr'), td = node('td', 'No saved links match. Open a monitored profile and visit a page matching an enabled rule.'); td.colSpan = 4; tr.append(td); $('links').append(tr); }
  $('link-count').textContent = linksTotal + ' links · page ' + linkPage + ' of ' + Math.max(1, Math.ceil(linksTotal / 50));
  $('previous-links').disabled = linkPage <= 1; $('next-links').disabled = linkPage * 50 >= linksTotal;
  $('export-csv').href = '/api/export?' + linkParams(); $('export-json').href = '/api/export?' + linkParams() + '&format=json';
  $('export-csv').hidden = cloudView(); $('export-json').hidden = cloudView(); $('link-account').hidden = cloudView();
}
function download(item) { const blob = new Blob([item.urls.join('\r\n') + '\r\n'], { type: 'text/plain;charset=utf-8' }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = item.filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
async function loadExports() {
  if (cloudView() && !state.cloud?.connected) return;
  const data = await api((cloudView() ? 'cloud/' : '') + 'exports'); $('export-history').replaceChildren();
  for (const item of data.exports) { const row = node('div', undefined, 'profile-item'); row.append(info(item.filename, new Date(item.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST'), button('Download again', async () => { const snapshot = item.urls ? item : (await api('cloud/exports/get?id=' + encodeURIComponent(item._id))).export; download(snapshot); }, 'quiet')); $('export-history').append(row); }
}
$('export-txt').onclick = handle(async () => { const data = await api(cloudView() ? 'cloud/exports' : 'export-txt', Object.fromEntries(linkParams())); download(data.export); await loadLinks(); await loadExports(); notice('TXT prepared. Links remain in exported history for repeat downloads.'); });
$('cloud-login').onsubmit = handle(async () => { await api('cloud/login', { serverUrl: $('cloud-url').value, username: $('cloud-username').value, password: $('cloud-password').value }); $('cloud-password').value = ''; location.reload(); });
$('cloud-logout').onclick = handle(async () => { await api('cloud/logout', {}); location.reload(); });
$('cloud-open').onclick = () => { if (state.cloud?.origin) window.open(state.cloud.origin, '_blank', 'noopener,noreferrer'); };
$('account-form').onsubmit = handle(async () => { const a = await api('accounts', { id: $('account-id').value || undefined, name: $('account-name').value, token: $('account-token').value }); selected = a.id; localStorage.setItem('lg-account', selected); $('account-token').value = ''; profiles = []; await refresh(); accountForm(a); renderProfiles(); notice('Account saved and selected. Click Load profiles to connect.'); });
$('account').onchange = () => { selected = $('account').value; localStorage.setItem('lg-account', selected); profiles = []; profilePage = 1; renderProfiles(); notice('Account selected. Click Load profiles to fetch its profiles.'); };
$('new-account').onclick = () => accountForm(); $('edit-account').onclick = () => accountForm(state.accounts.find(a => a.id === selected));
$('load-profiles').onclick = handle(async () => { profilePage = 1; await loadProfiles(); });
$('previous-profiles').onclick = handle(async () => { profilePage = Math.max(1, profilePage - 1); await loadProfiles(); });
$('next-profiles').onclick = handle(async () => { profilePage++; await loadProfiles(); });
$('profile-search').oninput = renderProfiles;
$('manual-launch').onsubmit = handle(() => launch($('profile-id').value));
$('new-rule').onclick = () => ruleForm();
$('rule-form').onsubmit = handle(async () => { const r = await api('rules', ruleDraft()); ruleForm(r); await refresh(); notice('Rule saved. Matching pages in monitored profiles will be collected automatically.'); });
$('preview').onclick = handle(async () => { const { results } = await api('preview', ruleDraft()); const lines = []; for (const r of results) { lines.push(r.profileName + ' · ' + r.links.length + ' matching links', r.sourceUrl); for (const l of r.links.slice(0, 50)) lines.push('• ' + (l.label ? l.label + ': ' : '') + l.url); } $('preview-result').textContent = lines.join('\n') || 'No matching page is open in a monitored profile. Open the profile here, visit your main page, then preview again.'; $('preview-result').hidden = false; });
$('demo').onclick = handle(async () => { notice('Opening a demo browser…'); await api('demo', {}); await refresh(); notice('Demo opened. Four fake reward links will be decoded, including a delayed link.'); });
$('pause').onclick = handle(async () => { await api('pause', { paused: !state.paused }); await refresh(); });
$('exit').onclick = handle(async () => { await api('shutdown', {}); notice('App stopped. Your saved links remain available next time you start it.'); clearInterval(pollTimer); });
let searchTimer; $('link-search').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { linkPage = 1; void loadLinks().catch(e => notice(e.message, true)); }, 250); };
$('link-account').onchange = handle(async () => { linkPage = 1; await loadLinks(); });
for (const id of ['link-status','link-source']) $(id).onchange = handle(async () => { if (cloudView() && !state.cloud?.connected) { $('link-source').value = 'local'; throw new Error('Log in to your backend first.'); } linkPage = 1; await loadLinks(); await loadExports(); });
$('previous-links').onclick = handle(async () => { linkPage = Math.max(1, linkPage - 1); await loadLinks(); });
$('next-links').onclick = handle(async () => { linkPage++; await loadLinks(); });
$('copy-page').onclick = handle(async () => { await navigator.clipboard.writeText(linkRows.map(r => r.url).join('\n')); notice(linkRows.length + ' URLs copied.'); });
let refreshing = false;
async function poll() { if (refreshing) return; refreshing = true; try { await refresh(); await loadLinks(); await loadExports(); } catch (e) { notice(e.message, true); } finally { refreshing = false; } }
const pollTimer = setInterval(poll, 2000); void poll(); renderSessions(); renderProfiles();
