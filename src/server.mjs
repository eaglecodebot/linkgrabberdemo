import http from 'node:http';
import { readFileSync, mkdirSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Store } from './store.mjs';
import { Secrets } from './secrets.mjs';
import { Collector, goRequest } from './collector.mjs';
import { cleanRule, csvCell } from './rules.mjs';
import { indianFilename } from './decode.mjs';
import { CloudClient, cloudOrigin } from './cloud-client.mjs';
import { notifyCaptured } from './desktop.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(process.env.LINK_GRABBER_DATA || join(root, 'data'));
mkdirSync(directory, { recursive: true, mode: 0o700 });
const port = Number(process.env.PORT || 8765);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be between 1024 and 65535.');
const origin = 'http://127.0.0.1:' + port;
const appKey = randomBytes(32).toString('hex');
let store = new Store(join(directory, 'links.sqlite'));
let secrets = new Secrets(directory);
let collector = new Collector(store, secrets, directory, origin);
collector.onCaptured = data => { notifyCaptured(data); if (cloud) void cloud.sync(); };
let cloud = null;
const rootSecrets = new Secrets(directory), sessionPath = join(directory, 'cloud-session.json');
function idle() { if (collector.publicSessions().some(s => s.state !== 'closed')) throw new Error('Stop & sync your profiles before changing panel users.'); }
async function connectCloud(baseUrl, token, user) {
  idle(); if (cloud?.busy) await cloud.busy;
  const userDirectory = join(directory, 'users', createHash('sha256').update(baseUrl + ':' + user.id).digest('hex'));
  mkdirSync(userDirectory, { recursive: true, mode: 0o700 });
  const nextStore = new Store(join(userDirectory, 'links.sqlite'));
  store.close(); store = nextStore; secrets = new Secrets(userDirectory);
  collector = new Collector(store, secrets, userDirectory, origin);
  cloud = new CloudClient(baseUrl, token, store, user);
  collector.onCaptured = data => { notifyCaptured(data); void cloud.sync(); };
  try {
    const { settings } = await cloud.request('settings');
    if (settings?.pagePattern && !store.rules().length) store.saveRule({ id: 'main', name: 'Main webpage', pagePattern: settings.pagePattern, minLinks: settings.minLinks, decodeMode: 'perks' });
  } catch {}
  writeFileSync(sessionPath, JSON.stringify({ origin: baseUrl, secret: await rootSecrets.encrypt(token) }), { mode: 0o600 });
}
if (existsSync(sessionPath)) {
  try { const saved = JSON.parse(readFileSync(sessionPath)); const token = await rootSecrets.decrypt(saved.secret); const client = new CloudClient(cloudOrigin(saved.origin), token); const { user } = await client.request('me'); await connectCloud(saved.origin, token, user); }
  catch { console.log('Sign in to the cloud backend again from the panel.'); }
}
const syncTimer = setInterval(() => { if (cloud) void cloud.sync(); }, 2000);
let shuttingDown = false;

async function body(req) {
  let size = 0, text = '';
  for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) throw new Error('Request too large.'); text += chunk; }
  try { return JSON.parse(text || '{}'); } catch { throw new Error('Invalid JSON.'); }
}
function send(res, value, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value));
}
function account(id) { const a = store.account(id); if (!a) throw new Error('Select or add a GoLogin account first.'); return a; }

const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  if (req.headers.host !== '127.0.0.1:' + port || (req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') {
    return send(res, { error: 'Open this panel at ' + origin + ' on this PC.' }, 403);
  }
  const url = new URL(req.url, origin), path = url.pathname;
  try {
    if (path.startsWith('/api/') && !['GET','HEAD'].includes(req.method) && req.headers['x-app-key'] !== appKey) return send(res, { error: 'Refresh the panel and try again.' }, 403);
    if (req.method === 'GET' && path === '/api/state') return send(res, { appKey, accounts: store.accounts(), rules: store.rules(), sessions: collector.publicSessions(), total: store.total(), paused: collector.paused, cloud: cloud?.status() || { connected: false } });
    if (req.method === 'POST' && path === '/api/cloud/login') {
      idle(); const b = await body(req), baseUrl = cloudOrigin(b.serverUrl);
      const client = new CloudClient(baseUrl, ''); const result = await client.request('login', { username: b.username, password: b.password });
      await connectCloud(baseUrl, result.token, result.user); return send(res, { user: result.user });
    }
    if (req.method === 'POST' && path === '/api/cloud/logout') {
      idle(); if (cloud?.busy) await cloud.busy; if (cloud) await cloud.request('logout', {}).catch(() => {});
      if (existsSync(sessionPath)) unlinkSync(sessionPath); cloud = null; store.close();
      store = new Store(join(directory, 'links.sqlite')); secrets = new Secrets(directory); collector = new Collector(store, secrets, directory, origin);
      collector.onCaptured = notifyCaptured; return send(res, { ok: true });
    }
    if (path.startsWith('/api/cloud/')) {
      if (!cloud) throw new Error('Log in to your Railway backend first.');
      const target = path.slice('/api/cloud/'.length);
      if (!['links','exports','exports/get','admin/users','admin/users/update','password'].includes(target)) throw new Error('Unknown cloud operation.');
      if (req.method === 'GET') return send(res, await cloud.request(target + '?' + url.searchParams));
      if (req.method === 'POST') {
        const b = await body(req), current = cloud, result = await current.request(target, b);
        if (target === 'exports' && current === cloud && (!b.userId || b.userId === cloud.user.id)) store.markUrlsExported(result.export.urls);
        return send(res, result);
      }
    }
    if (req.method === 'POST' && path === '/api/accounts') {
      const b = await body(req), name = String(b.name || '').trim().slice(0, 150), token = String(b.token || '').trim();
      if (!name) throw new Error('Give this account a name.');
      const existing = b.id ? account(b.id) : null;
      if (!token && !existing) throw new Error('Paste this account’s API token.');
      if (token.length > 10000) throw new Error('Token is too long.');
      const secret = token ? await secrets.encrypt(token) : existing.secret;
      return send(res, store.saveAccount(existing?.id, name, secret));
    }
    if (req.method === 'GET' && path === '/api/profiles') {
      const a = account(url.searchParams.get('accountId')), page = Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1));
      const result = await goRequest(await secrets.decrypt(a.secret), '/browser/v2?page=' + page + '&limit=100');
      const profiles = Array.isArray(result) ? result : result.profiles;
      if (!Array.isArray(profiles)) throw new Error('Unexpected GoLogin response. You can still launch using a profile ID.');
      return send(res, { page, profiles: profiles.map(p => ({ id: p.id || p._id, name: p.name || p.id || p._id })), total: result.allProfilesCount ?? result.total ?? null });
    }
    if (req.method === 'POST' && path === '/api/launch') {
      const b = await body(req); return send(res, collector.begin(account(b.accountId), String(b.profileId || '').trim(), String(b.profileName || '')), 202);
    }
    if (req.method === 'POST' && path === '/api/stop') { const b = await body(req); await collector.stop(b.id); return send(res, { ok: true }); }
    if (req.method === 'POST' && path === '/api/pause') { collector.paused = !!(await body(req)).paused; return send(res, { paused: collector.paused }); }
    if (req.method === 'POST' && path === '/api/demo') { await collector.demo(); return send(res, { ok: true }); }
    if (req.method === 'POST' && path === '/api/rules') {
      const rule = store.saveRule(await body(req));
      if (cloud && rule.id === 'main') { store.setting('cloudSettingsPending', { pagePattern: rule.pagePattern, minLinks: rule.minLinks }); void cloud.sync(); }
      return send(res, rule);
    }
    if (req.method === 'POST' && path === '/api/rules/delete') { store.deleteRule(String((await body(req)).id)); return send(res, { ok: true }); }
    if (req.method === 'POST' && path === '/api/preview') return send(res, { results: await collector.preview(cleanRule(await body(req), 'preview')) });
    if (req.method === 'GET' && path === '/api/links') return send(res, store.query(Object.fromEntries(url.searchParams)));
    if (req.method === 'GET' && path === '/api/exports') return send(res, { exports: store.exports() });
    if (req.method === 'POST' && path === '/api/export-txt') {
      const b = await body(req), rows = store.query(b, true).rows;
      if (!rows.length) throw new Error('No links match this export.');
      if (Buffer.byteLength(rows.map(r => r.url).join('\n')) > 8 * 1024 * 1024) throw new Error('Export too large. Narrow the search.');
      const item = store.exportSnapshot(rows, indianFilename()); if (cloud) void cloud.sync(); return send(res, { export: item });
    }
    if (req.method === 'GET' && path === '/api/export') {
      const rows = store.query(Object.fromEntries(url.searchParams), true).rows;
      if (url.searchParams.get('format') === 'json') {
        res.setHeader('Content-Disposition', 'attachment; filename="saved-links.json"');
        return send(res, { version: 1, exportedAt: new Date().toISOString(), rules: store.rules(), links: rows });
      }
      const keys = ['url','label','account_name','profile_name','rule_name','source_url','title','first_seen','last_seen'];
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="saved-links.csv"' });
      return res.end('\uFEFF' + [keys.map(csvCell).join(','), ...rows.map(r => keys.map(k => csvCell(r[k])).join(','))].join('\r\n'));
    }
    if (req.method === 'POST' && path === '/api/shutdown') {
      if (collector.publicSessions().some(s => !['closed'].includes(s.state))) throw new Error('Stop & sync every profile before exiting.');
      send(res, { ok: true }); setTimeout(() => void shutdown(), 100); return;
    }
    const files = { '/': ['index.html','text/html'], '/app.js': ['app.js','text/javascript'], '/style.css': ['style.css','text/css'], '/demo': ['demo.html','text/html'], '/demo.js': ['demo.js','text/javascript'] };
    if (req.method === 'GET' && files[path]) {
      const [file, type] = files[path]; res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' }); return res.end(readFileSync(join(root, 'public', file)));
    }
    send(res, { error: 'Not found.' }, 404);
  } catch (e) { if (!res.headersSent) send(res, { error: collector.safeError(e) }, 400); else res.end(); }
});

async function shutdown() {
  if (shuttingDown) return; shuttingDown = true;
  console.log('Closing profiles and syncing to GoLogin. Keep this window open...');
  await collector.shutdown();
  const failed = collector.publicSessions().filter(s => s.state === 'error');
  if (failed.length) { shuttingDown = false; collector.closing = false; console.error('Some profiles did not sync. Retry Stop & sync in the panel.'); return; }
  clearInterval(syncTimer); if (cloud?.busy) await cloud.busy;
  server.close(() => { store.close(); process.exit(0); });
}
server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? 'Port is already in use. The app may already be running: ' + origin : e.message); process.exit(1); });
server.listen(port, '127.0.0.1', () => {
  console.log('\nLink Grabber is ready: ' + origin + '\nOpen this address on this PC. Keep this window open while collecting.\n');
  if (process.env.LINK_GRABBER_OPEN === '1' && process.platform === 'win32') {
    const opener = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', origin], { detached: true, stdio: 'ignore', windowsHide: true });
    opener.on('error', () => console.log('Open the address above in Chrome or Edge.')); opener.unref();
  }
});
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
