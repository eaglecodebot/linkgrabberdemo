export class Repository {
  constructor(db) { this.db = db; this.users = db.collection('users'); this.sessions = db.collection('sessions'); this.links = db.collection('links'); this.exports = db.collection('exports'); this.settings = db.collection('settings'); }
  async initialize() {
    await this.users.createIndex({ username: 1 }, { unique: true });
    await this.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await this.links.createIndex({ ownerId: 1, last_seen: -1 });
    await this.exports.createIndex({ ownerId: 1, createdAt: -1 });
  }
  userByName(name) { return this.users.findOne({ username: name }); }
  userById(id) { return this.users.findOne({ _id: id }); }
  addUser(u) { return this.users.insertOne(u); }
  allUsers() { return this.users.find({}).project({ password: 0, authVersion: 0 }).sort({ username: 1 }).toArray(); }
  updateUser(id, fields) { return this.users.updateOne({ _id: id }, { $set: fields, $inc: { authVersion: 1 } }); }
  addSession(s) { return this.sessions.insertOne(s); }
  session(hash) { return this.sessions.findOne({ _id: hash, expiresAt: { $gt: new Date() } }); }
  revokeSession(hash) { return this.sessions.deleteOne({ _id: hash }); }
  filter(ownerId, params) {
    const filter = { ownerId };
    if (params.status === 'new') filter.exported = false;
    if (params.status === 'exported') filter.exported = true;
    if (params.q) {
      const text = String(params.q).slice(0, 200).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = ['url','label','profile_name','account_name','service'].map(k => ({ [k]: { $regex: text, $options: 'i' } }));
    }
    return filter;
  }
  async listLinks(ownerId, params = {}, all = false) {
    const filter = this.filter(ownerId, params), page = Math.min(100000, Math.max(1, Math.floor(Number(params.page) || 1)));
    const total = await this.links.countDocuments(filter);
    if (all && total > 10000) throw new Error('More than 10,000 links match. Narrow the search before exporting.');
    const rows = await this.links.find(filter).sort({ last_seen: -1, _id: 1 }).skip(all ? 0 : (page - 1) * 50).limit(all ? 10000 : 50).toArray();
    return { total, page, rows };
  }
  async saveLinks(ownerId, items) {
    for (const item of items) {
      const { _id, exported, first_seen, ...fields } = item;
      const insert = { first_seen };
      if (!exported) insert.exported = false; else fields.exported = true;
      await this.links.updateOne({ _id, ownerId }, { $setOnInsert: insert, $set: { ...fields, ownerId } }, { upsert: true });
    }
  }
  settingsFor(ownerId) { return this.settings.findOne({ _id: ownerId }); }
  saveSettings(ownerId, value) { return this.settings.updateOne({ _id: ownerId }, { $set: { value } }, { upsert: true }); }
  addExport(item) { return this.exports.insertOne(item); }
  saveExport(item) { return this.exports.updateOne({ _id: item._id, ownerId: item.ownerId }, { $setOnInsert: item }, { upsert: true }); }
  markExported(ownerId, ids) { return this.links.updateMany({ ownerId, _id: { $in: ids } }, { $set: { exported: true } }); }
  listExports(ownerId) { return this.exports.find({ ownerId }).project({ urls: 0 }).sort({ createdAt: -1 }).limit(100).toArray(); }
  exportById(ownerId, id) { return this.exports.findOne({ ownerId, _id: id }); }
}
