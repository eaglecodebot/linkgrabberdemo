import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pageMatches, extractFromPage } from './rules.mjs';
import { useStrictCommit } from './gologin-adapter.mjs';
import { decodeResult } from './decode.mjs';

export async function goRequest(token, path) {
  const response = await fetch('https://api.gologin.com' + path, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`GoLogin returned ${response.status}. ${[401,403].includes(response.status) ? 'Check the selected account token and profile permissions.' : 'Try again or check your GoLogin account.'}`);
  return response.json();
}

export function chromePath() {
  const paths = [process.env.CHROME_PATH,
    join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    join(process.env.LOCALAPPDATA || 'C:/Missing', 'Google/Chrome/Application/chrome.exe'),
    join(process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/google-chrome'];
  return paths.find(p => p && existsSync(p));
}

export class Collector {
  constructor(store, secrets, directory, origin) {
    Object.assign(this, { store, secrets, directory, origin });
    this.sessions = new Map(); this.paused = false; this.closing = false;
  }
  publicSessions() {
    return [...this.sessions.values()].map(({ id, accountId, accountName, profileId, profileName, state, error, added, pages, lastScan, captureStatus }) =>
      ({ id, accountId, accountName, profileId, profileName, state, error, added, pages, lastScan, captureStatus }));
  }
  begin(account, profileId, profileName) {
    if (this.closing) throw new Error('The app is shutting down.');
    if (!/^[a-f0-9]{24}$/i.test(profileId)) throw new Error('Enter a valid GoLogin profile ID (24 characters).');
    if ([...this.sessions.values()].some(s => s.profileId === profileId && s.state !== 'closed')) {
      throw new Error('This profile already has a session. Stop & sync it before opening it again.');
    }
    const s = { id: randomUUID(), accountId: account.id, accountName: account.name, profileId,
      profileName: profileName || profileId, state: 'starting', error: '', added: 0, pages: 0, signatures: new WeakMap() };
    this.sessions.set(s.id, s);
    s.launchPromise = this.launch(s, account);
    return { id: s.id };
  }
  async launch(s, account) {
    try {
      const token = await this.secrets.decrypt(account.secret);
      const profile = await goRequest(token, '/browser/' + s.profileId);
      s.profileName = profile.name || s.profileName;
      const [{ GoLogin }, { default: puppeteer }] = await Promise.all([import('gologin'), import('puppeteer-core')]);
      const profileDirectory = join(this.directory, 'runtime', s.profileId);
      mkdirSync(profileDirectory, { recursive: true, mode: 0o700 });
      s.sdk = new GoLogin({ token, profile_id: s.profileId, tmpdir: profileDirectory,
        uploadCookiesToServer: true, writeCookiesFromServer: true });
      useStrictCommit(s.sdk);
      const started = await s.sdk.start();
      s.started = true;
      if (!started.wsUrl) throw new Error('GoLogin did not return a browser connection.');
      s.browser = await puppeteer.connect({ browserWSEndpoint: started.wsUrl, defaultViewport: null, protocolTimeout: 15000 });
      s.state = 'running';
      s.browser.once('disconnected', () => { if (s.state === 'running') void this.stop(s.id).catch(() => {}); });
      this.monitor(s);
    } catch (e) {
      s.error = this.safeError(e); s.state = 'error';
      // Leave failed sync/launch state available for an explicit Stop & sync retry.
    }
  }
  safeError(e) {
    return String(e?.message || e).replace(/Bearer\s+\S+/gi, 'Bearer [hidden]').replace(/eyJ[A-Za-z0-9_.-]+/g, '[hidden]').slice(0, 500);
  }
  async demo() {
    if ([...this.sessions.values()].some(s => s.accountId === 'demo' && s.state === 'running')) return;
    const executablePath = chromePath();
    if (!executablePath) throw new Error('Demo needs Chrome or Edge installed. GoLogin profiles do not need this demo browser.');
    const { default: puppeteer } = await import('puppeteer-core');
    const s = { id: randomUUID(), accountId: 'demo', accountName: 'Demo', profileId: 'demo', profileName: 'Demo browser',
      state: 'starting', error: '', added: 0, pages: 0, signatures: new WeakMap() };
    this.sessions.set(s.id, s);
    try {
      s.browser = await puppeteer.launch({ executablePath, headless: process.env.TEST_HEADLESS === '1',
        userDataDir: join(this.directory, 'demo-browser'), defaultViewport: null,
        args: process.env.TEST_NO_SANDBOX === '1' ? ['--no-sandbox'] : [] });
      s.state = 'running';
      s.browser.once('disconnected', () => { if (s.state === 'running') void this.stop(s.id).catch(() => {}); });
      const ruleId = 'builtin-demo-rule';
      this.store.saveRule({ id: ruleId, name: 'Demo', pagePattern: this.origin + '/demo*', enabled: true, decodeMode: 'perks' });
      const pages = await s.browser.pages();
      await (pages[0] || await s.browser.newPage()).goto(this.origin + '/demo');
      this.monitor(s);
    } catch (e) { s.state = 'error'; s.error = this.safeError(e); throw e; }
  }
  async scan(s, rules, preview = false) {
    const results = [];
    const pages = await s.browser.pages(); s.pages = pages.length;
    // Different tabs are read concurrently, so a slow tab cannot delay another.
    await Promise.all(pages.map(async page => {
      if (page.isClosed()) return;
      for (const rule of rules) {
        if (!pageMatches(rule.pagePattern, page.url())) continue;
        try {
          const result = decodeResult(await page.evaluate(extractFromPage, rule), rule.decodeMode);
          // Navigation during extraction must not save links from a different page.
          if (!pageMatches(rule.pagePattern, result.sourceUrl)) continue;
          if (preview) { results.push({ profileName: s.profileName, ruleName: rule.name, ...result }); continue; }
          let cache = s.signatures.get(page);
          if (!cache) { cache = new Map(); s.signatures.set(page, cache); }
          const signature = JSON.stringify([rule, result]);
          if (cache.get(rule.id) !== signature) {
            const added = this.store.capture(s, rule, result);
            s.added += added;
            cache.set(rule.id, signature);
            const complete = result.links.length >= (rule.minLinks || 4);
            s.captureStatus = complete ? result.links.length + ' decoded links saved' : result.links.length + '/' + (rule.minLinks || 4) + ' minimum links found; waiting';
            if (!complete) await page.evaluate(() => document.getElementById('__local_link_grabber_notification')?.remove()).catch(() => {});
            if (complete) {
              this.onCaptured?.({ count: result.links.length, added, profileName: s.profileName });
              // Success is shown only AFTER the local database transaction commits.
              await page.evaluate(({ count, added, name }) => {
                const id = '__local_link_grabber_notification';
                document.getElementById(id)?.remove();
                const host = document.createElement('div'); host.id = id;
                host.style.cssText = 'position:fixed!important;bottom:24px!important;right:24px!important;z-index:2147483647!important;max-width:min(400px,calc(100vw - 32px))!important;';
                const shadow = host.attachShadow({ mode: 'closed' });
                const box = document.createElement('div');
                box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
                box.style.cssText = 'background:#12523f;color:#fff;padding:18px 20px;border-radius:14px;box-shadow:0 8px 32px #0004;font:14px/1.5 system-ui,sans-serif;';
                const title = document.createElement('strong'); title.textContent = '✓ Saved ' + count + ' decoded link' + (count === 1 ? '' : 's');
                title.style.cssText = 'display:block;font-size:16px;margin-bottom:5px;';
                const text = document.createElement('div'); text.textContent = 'You can continue. ' + added + ' new; ' + (count - added) + ' already saved.';
                const label = document.createElement('div'); label.textContent = name; label.style.cssText = 'font-size:11px;opacity:.8;margin-top:6px;';
                const close = document.createElement('button'); close.textContent = 'Dismiss'; close.style.cssText = 'margin-top:10px;background:transparent;color:#fff;border:1px solid #ffffff70;border-radius:6px;padding:4px 9px;cursor:pointer;font:12px system-ui;';
                close.onclick = () => host.remove(); box.append(title, text, label, close); shadow.append(box); document.documentElement.append(host);
                setTimeout(() => host.remove(), 10000);
              }, { count: result.links.length, added, name: rule.name }).catch(() => {});
            }
          }
          s.error = '';
        } catch (e) {
          if (preview) throw new Error('Could not read matching page: ' + this.safeError(e));
          s.error = 'Rule "' + rule.name + '": ' + this.safeError(e);
        }
      }
    }));
    s.lastScan = new Date().toISOString();
    return results;
  }
  monitor(s) {
    s.tracked = new WeakSet();
    const requestScan = () => {
      if (s.state !== 'running' || this.closing || this.paused) return;
      if (s.pendingScan) return;
      s.pendingScan = setTimeout(() => { s.pendingScan = null; void this.tick(s); }, 100);
    };
    s.requestScan = requestScan;
    s.browser.on('targetcreated', requestScan);
    s.timer = setInterval(() => void this.tick(s), 1000);
    void this.tick(s);
  }
  async tick(s) {
    if (s.state !== 'running' || this.closing || this.paused || s.scanning) return;
    s.scanning = true;
    try {
      const pages = await s.browser.pages();
      await Promise.all(pages.map(async page => {
        if (page.isClosed()) return;
        if (!s.tracked.has(page)) {
          s.tracked.add(page);
          page.on('domcontentloaded', s.requestScan);
          page.on('framenavigated', s.requestScan);
          const name = '__linkGrabber_' + randomUUID().replaceAll('-', '');
          page.linkGrabberBinding = name;
          await page.exposeFunction(name, s.requestScan).catch(() => {});
        }
        if (!this.store.rules().some(r => r.enabled && pageMatches(r.pagePattern, page.url()))) return;
        await page.evaluate(name => {
          if (window[name + '_observer']) return;
          let timer;
          const observer = new MutationObserver(() => {
            if (timer) return;
            timer = setTimeout(() => { timer = null; Promise.resolve(window[name]?.()).catch(() => {}); }, 150);
          });
          observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
          window[name + '_observer'] = observer;
        }, page.linkGrabberBinding).catch(() => {});
      }));
      await this.scan(s, this.store.rules().filter(r => r.enabled));
    } catch (e) { if (s.state === 'running') s.error = this.safeError(e); }
    finally { s.scanning = false; }
  }
  async preview(rule) {
    const results = [];
    for (const s of this.sessions.values()) if (s.state === 'running') results.push(...await this.scan(s, [rule], true));
    return results;
  }
  async stop(id) {
    const s = this.sessions.get(id);
    if (!s) throw new Error('Unknown session.');
    if (s.state === 'starting') throw new Error('Profile is still opening. Wait for it to finish first.');
    if (s.stopPromise) return s.stopPromise;
    if (s.state === 'closed') return;
    s.state = 'stopping'; clearInterval(s.timer); clearTimeout(s.pendingScan);
    s.stopPromise = (async () => {
      try {
        if (s.browser?.connected) await s.browser.close();
        if (s.sdk && s.started) await s.sdk.stop();
        else if (s.sdk?.processSpawned) s.sdk.killBrowser();
        s.state = 'closed'; s.error = ''; s.sdk = null;
      } catch (e) {
        // The SDK leaves this flag set when commit throws; clear it for retry.
        if (s.sdk) s.sdk.is_stopping = false;
        s.state = 'error'; s.error = 'Stop/sync failed: ' + this.safeError(e); throw e;
      }
      finally { s.stopPromise = null; }
    })();
    return s.stopPromise;
  }
  async shutdown() {
    this.closing = true;
    for (const s of this.sessions.values()) if (s.launchPromise) await s.launchPromise;
    await Promise.allSettled([...this.sessions.keys()].map(id => this.stop(id)));
  }
}
