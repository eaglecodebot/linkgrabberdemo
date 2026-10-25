// Contract-test storage. Production always uses Repository + MongoDB.
export class MemoryRepository {
  constructor() { this.users = new Map(); this.sessions = new Map(); this.links = new Map(); this.exports = new Map(); this.settings = new Map(); this.captureKeys = new Map(); this.permanentScripts=new Map(); }
  async userByName(name) { return [...this.users.values()].find(u => u.username === name); }
  async userById(id) { return this.users.get(id); }
  async addUser(u) { if (await this.userByName(u.username)) { const e = new Error('duplicate'); e.code = 11000; throw e; } this.users.set(u._id, { ...u }); }
  async allUsers() { return [...this.users.values()]; }
  async updateUser(id, fields) { const u = this.users.get(id); Object.assign(u, fields); u.authVersion++; }
  async addSession(s) { this.sessions.set(s._id, s); }
  async session(hash) { const s = this.sessions.get(hash); return s && s.expiresAt > new Date() ? s : null; }
  async revokeSession(hash) { this.sessions.delete(hash); }
  async addCaptureKey(key) { this.captureKeys.set(key._id,key); }
  async captureKey(hash) { const script=[...this.permanentScripts.values()].find(r=>r.keyHash===hash);return script?{ownerId:script._id,authVersion:script.authVersion,permanent:true}:this.captureKeys.get(hash); }
  async permanentScript(ownerId){return this.permanentScripts.get(ownerId);}
  async ensurePermanentScript(candidate){const current=this.permanentScripts.get(candidate._id);if(!current||current.authVersion<candidate.authVersion)this.permanentScripts.set(candidate._id,structuredClone(candidate));return this.permanentScripts.get(candidate._id);}
  async revokeCaptureKeys(ownerId) { this.permanentScripts.delete(ownerId);for(const [id,key] of this.captureKeys)if(key.ownerId===ownerId)this.captureKeys.delete(id); }
  async captureWebLinks(ownerId,rows,batchId) {
    for(const row of rows) {
      const old=[...this.links.values()].find(r=>r.ownerId===ownerId&&r.url===row.url);
      if(!old)this.links.set(row._id,{...row,ownerId,capture_batch:batchId});
    }
    return [...this.links.values()].filter(r=>r.ownerId===ownerId&&r.capture_batch===batchId&&rows.some(item=>item.url===r.url)).length;
  }
  async listLinks(ownerId, params = {}, all = false) {
    let rows = [...this.links.values()].filter(l => l.ownerId === ownerId);
    if (params.status === 'new') rows = rows.filter(l => !l.exported);
    if (params.status === 'exported') rows = rows.filter(l => l.exported);
    if (params.service) rows = rows.filter(l => l.service === params.service);
    if (params.q) rows = rows.filter(l => JSON.stringify(l).includes(params.q));
    rows.sort((a,b) => b.last_seen.localeCompare(a.last_seen) || a._id.localeCompare(b._id));
    const page = Math.max(1, Math.floor(Number(params.page) || 1));
    return { rows: all ? rows : rows.slice((page-1)*50,page*50), total: rows.length, page };
  }
  async existingUrls(ownerId, urls) { return [...this.links.values()].filter(r => r.ownerId === ownerId && urls.includes(r.url)).map(r => r.url); }
  async saveLinks(ownerId, rows) { for (const r of rows) {
    const old = [...this.links.values()].find(item => item.ownerId === ownerId && item.url === r.url);
    if (old) { if (r.exported) old.exported = true; continue; }
    const id = old?._id || r._id;
    this.links.set(id, { ...old, ...r, _id:id, ownerId, exported: old?.exported || r.exported });
  } }
  async settingsFor(id) { return { value: this.settings.get(id) }; }
  async saveSettings(id, value) { this.settings.set(id, value); }
  async addExport(item) { this.exports.set(item._id, structuredClone(item)); }
  async saveExport(item) { if (!this.exports.has(item._id)) await this.addExport(item); }
  async markExported(id, ids) { for (const key of ids) { const r = this.links.get(key); if (r?.ownerId === id) r.exported = true; } }
  async listExports(id) { return [...this.exports.values()].filter(e => e.ownerId === id).map(({ urls,...r }) => r); }
  async exportById(id, key) { const r = this.exports.get(key); return r?.ownerId === id ? r : null; }
}
