// Contract-test storage. Production always uses Repository + MongoDB.
export class MemoryRepository {
  constructor() { this.users = new Map(); this.sessions = new Map(); this.links = new Map(); this.exports = new Map(); this.settings = new Map(); }
  async userByName(name) { return [...this.users.values()].find(u => u.username === name); }
  async userById(id) { return this.users.get(id); }
  async addUser(u) { if (await this.userByName(u.username)) { const e = new Error('duplicate'); e.code = 11000; throw e; } this.users.set(u._id, { ...u }); }
  async allUsers() { return [...this.users.values()]; }
  async updateUser(id, fields) { const u = this.users.get(id); Object.assign(u, fields); u.authVersion++; }
  async addSession(s) { this.sessions.set(s._id, s); }
  async session(hash) { const s = this.sessions.get(hash); return s && s.expiresAt > new Date() ? s : null; }
  async revokeSession(hash) { this.sessions.delete(hash); }
  async listLinks(ownerId, params = {}, all = false) {
    let rows = [...this.links.values()].filter(l => l.ownerId === ownerId);
    if (params.status === 'new') rows = rows.filter(l => !l.exported);
    if (params.status === 'exported') rows = rows.filter(l => l.exported);
    if (params.q) rows = rows.filter(l => JSON.stringify(l).includes(params.q));
    return { rows: all ? rows : rows.slice(0,50), total: rows.length, page: 1 };
  }
  async saveLinks(ownerId, rows) { for (const r of rows) { const old = this.links.get(r._id); this.links.set(r._id, { ...old, ...r, ownerId, exported: old?.exported || r.exported }); } }
  async settingsFor(id) { return { value: this.settings.get(id) }; }
  async saveSettings(id, value) { this.settings.set(id, value); }
  async addExport(item) { this.exports.set(item._id, structuredClone(item)); }
  async saveExport(item) { if (!this.exports.has(item._id)) await this.addExport(item); }
  async markExported(id, ids) { for (const key of ids) { const r = this.links.get(key); if (r?.ownerId === id) r.exported = true; } }
  async listExports(id) { return [...this.exports.values()].filter(e => e.ownerId === id).map(({ urls,...r }) => r); }
  async exportById(id, key) { const r = this.exports.get(key); return r?.ownerId === id ? r : null; }
}
