import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { passwordHash, verifyPassword, username, safeUser, hashToken, ownerFor } from './auth.mjs';
import { perkLink, indianFilename, exportTitle } from '../src/decode.mjs';
import { acceptCapture, createCaptureScript, captureConfiguration, cleanSettings } from './capture.mjs';

const text = (value, size = 1000) => String(value || '').slice(0, size);
function validateLink(row, ownerId) {
  const decoded = perkLink(row.url);
  if (!decoded) throw new Error('A submitted link is not a supported reward URL.');
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(String(row.uid || ''))) throw new Error('Invalid capture ID.');
  const profile_id = text(row.profile_id, 100), url = decoded.url;
  const validDate = v => { const d = new Date(v); if (!Number.isFinite(d.getTime())) throw new Error('Invalid capture time.'); return d.toISOString(); };
  return { _id: hashToken(ownerId + '\0' + profile_id + '\0' + url), url, service: decoded.service, profile_id,
    profile_name: text(row.profile_name), account_name: text(row.account_name), label: text(row.label), source_url: text(row.source_url, 4000),
    original_url: text(row.original_url, 16000), first_seen: validDate(row.first_seen), last_seen: validDate(row.last_seen), exported: !!row.exported };
}

export async function bootstrap(repo, adminName, adminPassword) {
  const name = username(adminName), existing = await repo.userByName(name);
  if (existing) { if (existing.role !== 'admin') throw new Error('Bootstrap username already belongs to a regular user.'); return; }
  const password = await passwordHash(adminPassword);
  try { await repo.addUser({ _id: randomUUID(), username: name, name: 'Administrator', role: 'admin', active: true, authVersion: 1, password, createdAt: new Date().toISOString() }); }
  catch (e) { if (e.code !== 11000) throw e; }
}

export function createApp(repo, { publicOrigin = '', trustProxy = false, scriptSecret = process.env.SCRIPT_ENCRYPTION_KEY } = {}) {
  const attempts = new Map(), captureAttempts = new Map();
  const send = (res, data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
  async function body(req) {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) { const e = new Error('JSON is required.'); e.status = 415; throw e; }
    let value = '', size = 0;
    for await (const b of req) { size += b.length; if (size > 12 * 1024 * 1024) throw new Error('Request too large.'); value += b; }
    return JSON.parse(value || '{}');
  }
  async function authenticate(req) {
    const token = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    const s = token && await repo.session(hashToken(token));
    const u = s && await repo.userById(s.userId);
    if (!u?.active || s.version !== u.authVersion) { const e = new Error('Please log in again.'); e.status = 401; throw e; }
    return { user: u, tokenHash: s._id };
  }
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    const path = new URL(req.url, 'http://localhost'), route = path.pathname, params = Object.fromEntries(path.searchParams);
    try {
      if (route === '/api/capture' || route === '/api/capture-config') {
        const origin = req.headers.origin;
        if (origin) {
          let parsed;try { parsed = new URL(origin); } catch { return send(res,{error:'Invalid request origin.'},403); }
          if (!['https:','http:'].includes(parsed.protocol) || parsed.origin !== origin) return send(res,{error:'Invalid request origin.'},403);
          res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
        }
        if (req.method === 'OPTIONS') {res.writeHead(204,{'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600'});return res.end();}
        if (req.method !== 'POST') return send(res,{error:'POST is required.'},405);
        if (Number(req.headers['content-length']||0)>2*1024*1024) return send(res,{error:'Capture exceeds 2 MiB.'},413);
        const b=await body(req);
        if (Buffer.byteLength(JSON.stringify(b))>2*1024*1024) return send(res,{error:'Capture exceeds 2 MiB.'},413);
        const now=Date.now(),key=hashToken(String(b.captureKey||''));
        for(const [id,value] of captureAttempts)if(value.until<now)captureAttempts.delete(id);
        if(captureAttempts.size>20000)return send(res,{error:'Capture service busy. Retry shortly.'},429);
        const limit=captureAttempts.get(key)||{count:0,until:now+60000};
        if(++limit.count>60)return send(res,{error:'Too many captures. Wait one minute.'},429);captureAttempts.set(key,limit);
        const panelOrigin=publicOrigin||'http://'+req.headers.host;
        return route === '/api/capture-config' ? send(res,await captureConfiguration(repo,b,origin,panelOrigin)) : send(res,{result:await acceptCapture(repo,b,origin,panelOrigin)});
      }
      if (req.headers.origin && publicOrigin && req.headers.origin !== publicOrigin) return send(res, { error: 'Origin not allowed.' }, 403);
      if (req.method === 'GET' && route === '/health') { return send(res, { ok: true }); }
      if (req.method === 'POST' && route === '/api/login') {
        const b = await body(req), name = username(b.username);
        const ip = trustProxy ? text(String(req.headers['x-forwarded-for'] || '').split(',').at(-1), 100) : req.socket.remoteAddress;
        const now = Date.now();
        for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
        if (attempts.size > 20000) return send(res, { error: 'Too many login attempts. Try later.' }, 429);
        const keys = ['ip:' + ip, 'user:' + name];
        for (const k of keys) { const a = attempts.get(k) || { count: 0, until: now + 15 * 60000 }; if (a.count >= (k.startsWith('ip:') ? 40 : 10)) return send(res, { error: 'Too many login attempts. Wait 15 minutes.' }, 429); a.count++; attempts.set(k, a); }
        const u = await repo.userByName(name);
        const valid = await verifyPassword(b.password, u?.password || ('0'.repeat(32) + ':' + '0'.repeat(128)));
        if (!u?.active || !valid) return send(res, { error: 'Incorrect credentials or account disabled.' }, 401);
        attempts.delete('user:' + name);
        const token = randomBytes(32).toString('hex');
        await repo.addSession({ _id: hashToken(token), userId: u._id, version: u.authVersion, expiresAt: new Date(Date.now() + 7 * 86400000) });
        return send(res, { token, user: safeUser(u) });
      }
      if (route.startsWith('/api/')) {
        const { user, tokenHash } = await authenticate(req);
        if (req.method === 'GET' && route === '/api/me') return send(res, { user: safeUser(user) });
        if (req.method === 'POST' && route === '/api/capture-script') { await body(req);return send(res,await createCaptureScript(repo,user,publicOrigin||'http://'+req.headers.host,scriptSecret)); }
        if (req.method === 'POST' && route === '/api/capture-scripts/revoke') { await repo.revokeCaptureKeys(user._id);return send(res,{ok:true}); }
        if (req.method === 'POST' && route === '/api/capture-import') {
          const b=await body(req),key=await repo.captureKey(hashToken(String(b.captureKey||'')));
          if(key?.ownerId!==user._id)return send(res,{error:'This capture packet belongs to another user or an invalid script.'},403);
          return send(res,{result:await acceptCapture(repo,b,publicOrigin||'http://'+req.headers.host,publicOrigin||'http://'+req.headers.host)});
        }
        if (req.method === 'POST' && route === '/api/logout') { await repo.revokeSession(tokenHash); return send(res, { ok: true }); }
        if (req.method === 'POST' && route === '/api/password') { const b = await body(req); if (!await verifyPassword(b.currentPassword, user.password)) return send(res, { error: 'Current password is incorrect.' }, 403); await repo.updateUser(user._id, { password: await passwordHash(b.password) }); return send(res, { ok: true }); }
        if (req.method === 'POST' && route === '/api/check-links') {
          const b = await body(req);
          if (!Array.isArray(b.urls) || b.urls.length > 5000 || b.urls.some(url => typeof url !== 'string' || !perkLink(url))) throw new Error('Invalid reward URL list.');
          const urls = [...new Set(b.urls.map(url => perkLink(url).url))];
          return send(res, { urls: await repo.existingUrls(user._id, urls) });
        }
        if (route.startsWith('/api/admin/')) {
          if (user.role !== 'admin') return send(res, { error: 'Administrator access required.' }, 403);
          if (route === '/api/admin/users' && req.method === 'GET') return send(res, { users: (await repo.allUsers()).map(safeUser) });
          if (route === '/api/admin/users' && req.method === 'POST') {
            const b = await body(req), name = username(b.username), password = await passwordHash(b.password);
            const u = { _id: randomUUID(), username: name, name: text(b.name || name, 150), password, role: 'user', active: true, authVersion: 1, createdAt: new Date().toISOString() };
            await repo.addUser(u); return send(res, { user: safeUser(u) }, 201);
          }
          if (route === '/api/admin/users/update' && req.method === 'POST') {
            const b = await body(req), u = await repo.userById(text(b.id, 100));
            if (!u || u.role === 'admin') throw new Error('Select a regular user.');
            const fields = {}; if (typeof b.active === 'boolean') fields.active = b.active;
            if (Object.hasOwn(b, 'password')) fields.password = await passwordHash(b.password);
            await repo.updateUser(u._id, fields); return send(res, { ok: true });
          }
          if (route === '/api/admin/users/revoke-script' && req.method === 'POST') {
            const b=await body(req),target=await repo.userById(text(b.id,100));
            if(!target)throw new Error('Select a user.');await repo.revokeCaptureKeys(target._id);return send(res,{ok:true});
          }
        }
        if (req.method === 'POST' && route === '/api/sync') {
          const b = await body(req); if (!Array.isArray(b.rows) || b.rows.length > 200) throw new Error('Send up to 200 captures per batch.');
          const rows = b.rows.map(r => validateLink(r, user._id));
          await repo.saveLinks(user._id, rows); return send(res, { accepted: b.rows.map(r => ({ uid: r.uid, revision: Number(r.revision) || 1 })) });
        }
        if (req.method === 'POST' && route === '/api/sync-exports') {
          const item = (await body(req)).export;
          if (!item || !/^[a-zA-Z0-9_-]{1,100}$/.test(item.id) || !Array.isArray(item.urls) || !item.urls.length || item.urls.length > 10000) throw new Error('Invalid export snapshot.');
          if (item.urls.some(url => !perkLink(url)) || Buffer.byteLength(item.urls.join('\n')) > 8 * 1024 * 1024) throw new Error('Invalid export URLs.');
          const createdAt = new Date(item.createdAt).toISOString();
          const services = new Set(item.urls.map(url => perkLink(url).service));
          const service = services.size === 1 ? [...services][0] : '';
          const title = service && item.filename === indianFilename(service, new Date(createdAt)) ? service : 'Decoded_Links';
          await repo.saveExport({ _id: hashToken(user._id + ':' + item.id), ownerId: user._id, filename: indianFilename(title, new Date(createdAt)), createdAt, urls: item.urls, count: item.urls.length });
          return send(res, { ok: true });
        }
        if (route === '/api/settings' && req.method === 'GET') return send(res, { settings: (await repo.settingsFor(user._id))?.value || null });
        if (route === '/api/settings' && req.method === 'POST') {
          const settings=cleanSettings(await body(req));
          await repo.saveSettings(user._id, settings);
          return send(res, { ok: true });
        }
        const owner = ownerFor(user, params.userId);
        if (route === '/api/links' && req.method === 'GET') { exportTitle(params.service); return send(res, await repo.listLinks(owner, params)); }
        if (route === '/api/exports' && req.method === 'GET') return send(res, { exports: await repo.listExports(owner) });
        if (route === '/api/exports' && req.method === 'POST') {
          const b = await body(req), target = ownerFor(user, b.userId), title = exportTitle(b.service), { rows } = await repo.listLinks(target, b, true);
          const urls = [...new Set(rows.map(r => r.url))];
          if (!urls.length) throw new Error('No links match this export.');
          if (Buffer.byteLength(urls.join('\n')) > 8 * 1024 * 1024) throw new Error('Export is too large. Narrow the search.');
          const item = { _id: randomUUID(), ownerId: target, filename: indianFilename(title), createdAt: new Date().toISOString(), count: urls.length, urls };
          await repo.addExport(item); await repo.markExported(target, rows.map(r => r._id)); return send(res, { export: item });
        }
        if (route === '/api/exports/get' && req.method === 'GET') { const item = await repo.exportById(owner, text(params.id, 100)); if (!item) return send(res, { error: 'Export not found.' }, 404); return send(res, { export: item }); }
        return send(res, { error: 'Not found.' }, 404);
      }
      const files = { '/': ['index.html','text/html'], '/app.js': ['app.js','text/javascript'], '/style.css': ['style.css','text/css'], '/capture':['capture.html','text/html'], '/capture.js':['capture.js','text/javascript'] };
      if (req.method === 'GET' && route === '/link-sections.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); return res.end(readFileSync(new URL('../public/link-sections.js', import.meta.url))); }
      if (req.method === 'GET' && files[route]) { const [file, type] = files[route]; res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' }); return res.end(readFileSync(new URL('./public/' + file, import.meta.url))); }
      return send(res, { error: 'Not found.' }, 404);
    } catch (e) { if (!res.headersSent) send(res, { error: route === '/api/capture' && !e.status ? 'Could not confirm the save. Retry the same capture; check history if the connection was interrupted.' : e.code === 11000 ? 'Username already exists.' : e.status || !e.code ? e.message : 'Database operation failed. Try again.' }, e.status || 400); else res.end(); }
  });
}
