export function cloudOrigin(input) {
  const u = new URL(String(input || '').trim());
  if (u.username || u.password || u.pathname !== '/' || u.search || u.hash) throw new Error('Enter only the backend base URL, without a path.');
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost','127.0.0.1'].includes(u.hostname))) throw new Error('The backend must use HTTPS.');
  return u.origin;
}
export class CloudClient {
  constructor(origin, token, store, user) { Object.assign(this, { origin, token, store, user }); this.error = ''; this.lastSync = null; this.busy = null; }
  async request(path, data) {
    const r = await fetch(this.origin + '/api/' + path, { headers: { Authorization: 'Bearer ' + this.token, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(data === undefined ? {} : { method: 'POST', body: JSON.stringify(data) }), signal: AbortSignal.timeout(20000), redirect: 'error' });
    const result = await r.json();
    if (!r.ok) { const e = new Error(result.error || 'Cloud request failed.'); e.status = r.status; throw e; }
    return result;
  }
  async sync() {
    if (this.busy) return this.busy;
    this.busy = Promise.resolve().then(async () => {
      try {
        const settings = this.store.setting('cloudSettingsPending');
        if (settings) { await this.request('settings', settings); if (JSON.stringify(settings) === JSON.stringify(this.store.setting('cloudSettingsPending'))) this.store.setting('cloudSettingsPending', null); }
        const rows = this.store.pending();
        if (rows.length) {
          const valid = rows.filter(r => r.service && r.service !== 'Demo');
          if (valid.length) { const response = await this.request('sync', { rows: valid }); this.store.acknowledge(response.accepted); }
        }
        for (const item of this.store.pendingExports()) { await this.request('sync-exports', { export: item }); this.store.acknowledgeExport(item.id); }
        this.lastSync = new Date().toISOString(); this.error = '';
      } catch (e) { this.error = e.message; if (e.status === 401) this.expired = true; }
    });
    try { await this.busy; } finally { this.busy = null; }
  }
  status() { return { connected: true, user: this.user, origin: this.origin, pending: this.store.pendingCount() + this.store.pendingExports().length, error: this.error, expired: !!this.expired, lastSync: this.lastSync }; }
}
