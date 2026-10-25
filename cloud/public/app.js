const $ = id => document.getElementById(id);
let token = sessionStorage.getItem('lg-cloud-token') || '', me = null, page = 1, total = 0, users = [], loading = false;
function note(message) { $('notice').textContent = message; $('notice').hidden = false; }
function el(tag, text) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; return n; }
function action(text, fn) { const b = el('button', text); b.onclick = run(fn); return b; }
function run(fn) { return async event => { event?.preventDefault(); const b = event?.submitter || (event?.currentTarget?.tagName === 'BUTTON' ? event.currentTarget : null); if (b) b.disabled = true; try { await fn(); } catch (e) { note(e.message); } finally { if (b?.isConnected) b.disabled = false; } }; }
async function api(path, data) { const r = await fetch('/api/' + path, { headers: { Authorization: 'Bearer ' + token, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(data === undefined ? {} : { method: 'POST', body: JSON.stringify(data) }) }); const b = await r.json(); if (!r.ok) { if (r.status === 401 && path !== 'login') signOut(); throw new Error(b.error || 'Request failed.'); } return b; }
function signOut() { token = ''; me = null; sessionStorage.removeItem('lg-cloud-token'); $('workspace').hidden = true; $('login-card').hidden = false; $('logout').hidden = true; }
function params() { const p = new URLSearchParams({ status: $('status').value, q: $('search').value, page: String(page) }); if (me?.role === 'admin' && $('history-user').value) p.set('userId', $('history-user').value); return p; }
const date = value => new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST';
function download(item) { const url = URL.createObjectURL(new Blob([item.urls.join('\r\n') + '\r\n'], { type: 'text/plain;charset=utf-8' })), a = el('a'); a.href = url; a.download = item.filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
async function renderUsers() {
  if (me.role !== 'admin') return;
  const selected = $('history-user').value || me.id; users = (await api('admin/users')).users;
  $('users').replaceChildren(); $('history-user').replaceChildren(); $('reset-user').replaceChildren();
  for (const u of users) {
    $('history-user').add(new Option(u.name + ' (' + u.username + ')', u.id));
    if (u.role === 'user') $('reset-user').add(new Option(u.username, u.id));
    const row = el('div'); row.className = 'profile-item'; const info = el('div'); info.append(el('strong', u.name + ' · ' + u.username), el('small', u.active ? ' Active' : ' Disabled'));
    const controls = el('div'); controls.className = 'row'; controls.append(action('View history', async () => { $('history-user').value = u.id; page = 1; await refresh(); }));
    if (u.role === 'user') controls.append(action(u.active ? 'Disable' : 'Enable', async () => { await api('admin/users/update', { id: u.id, active: !u.active }); await renderUsers(); }));
    row.append(info, controls); $('users').append(row);
  }
  $('history-user').value = selected; if (!$('history-user').value) $('history-user').value = me.id;
}
async function enter() { me = (await api('me')).user; $('login-card').hidden = true; $('workspace').hidden = false; $('logout').hidden = false; $('welcome').textContent = 'Signed in as ' + me.name; $('admin').hidden = me.role !== 'admin'; $('history-user').hidden = me.role !== 'admin'; await renderUsers(); await refresh(); }
async function refresh() {
  if (!me || loading) return; loading = true;
  try {
    const p = params(), data = await api('links?' + p); total = data.total; $('links').replaceChildren();
    const selected = users.find(u => u.id === $('history-user').value); $('history-title').textContent = selected ? selected.name + ' — decoded links' : 'Your decoded links';
    for (const r of data.rows) { const tr = el('tr'), link = el('td'), who = el('td'), when = el('td', date(r.first_seen)), buttons = el('td'); link.append(el('strong', r.service)); const a = el('a', r.url); a.href = r.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; link.append(a); who.append(el('strong', r.profile_name), el('small', r.account_name)); buttons.append(action('Copy', async () => { await navigator.clipboard.writeText(r.url); note('Link copied.'); })); tr.append(link, who, when, buttons); $('links').append(tr); }
    if (!data.rows.length) { const tr = el('tr'), td = el('td', 'No matching links yet.'); td.colSpan = 4; tr.append(td); $('links').append(tr); }
    $('count').textContent = total + ' links · page ' + page; $('prev').disabled = page <= 1; $('next').disabled = page * 50 >= total;
    const history = await api('exports?' + p); $('exports').replaceChildren();
    for (const item of history.exports) { const row = el('div'); row.className = 'profile-item'; row.append(el('span', item.filename + ' · ' + item.count + ' links · ' + date(item.createdAt)), action('Download again', async () => { const q = params(); q.set('id', item._id); download((await api('exports/get?' + q)).export); })); $('exports').append(row); }
  } finally { loading = false; }
}
$('login').onsubmit = run(async () => { const r = await api('login', { username: $('username').value, password: $('password').value }); $('password').value = ''; token = r.token; sessionStorage.setItem('lg-cloud-token', token); await enter(); $('notice').hidden = true; });
$('logout').onclick = run(async () => { await api('logout', {}); signOut(); });
$('create-user').onsubmit = run(async () => { await api('admin/users', { username: $('new-username').value, name: $('new-name').value, password: $('create-password').value }); $('create-password').value = ''; $('new-username').value = ''; $('new-name').value = ''; await renderUsers(); note('User created.'); });
$('reset-password').onsubmit = run(async () => { await api('admin/users/update', { id: $('reset-user').value, password: $('reset-value').value }); $('reset-value').value = ''; note('Password reset. Earlier sessions are revoked.'); });
$('change-password').onsubmit = run(async () => { await api('password', { currentPassword: $('current-password').value, password: $('new-password').value }); $('current-password').value = ''; $('new-password').value = ''; signOut(); note('Password changed. Log in again.'); });
$('export').onclick = run(async () => { download((await api('exports', Object.fromEntries(params()))).export); await refresh(); note('TXT prepared. Saved links remain available in history.'); });
$('prev').onclick = run(async () => { page = Math.max(1, page - 1); await refresh(); }); $('next').onclick = run(async () => { page++; await refresh(); });
for (const id of ['history-user','status']) $(id).onchange = run(async () => { page = 1; await refresh(); });
let timer; $('search').oninput = () => { clearTimeout(timer); timer = setTimeout(run(async () => { page = 1; await refresh(); }), 300); };
setInterval(() => { if (me) refresh().catch(e => note(e.message)); }, 5000);
if (token) enter().catch(e => { signOut(); note(e.message); });
