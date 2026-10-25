import { exportTitle } from '../src/decode.mjs';
import { hashToken } from './auth.mjs';

export class Repository {
  constructor(db) { this.db = db; this.users = db.collection('users'); this.sessions = db.collection('sessions'); this.links = db.collection('links'); this.exports = db.collection('exports'); this.settings = db.collection('settings'); this.captureKeys = db.collection('capture_keys'); this.permanentScripts=db.collection('permanent_scripts'); }
  async initialize() {
    await this.users.createIndex({ username: 1 }, { unique: true });
    await this.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await this.links.createIndex({ ownerId: 1, last_seen: -1 });
    await this.links.createIndex({ ownerId: 1, service: 1, last_seen: -1 });
    await this.links.createIndex({ ownerId: 1, url: 1 });
    await this.exports.createIndex({ ownerId: 1, createdAt: -1 });
    await this.captureKeys.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await this.captureKeys.createIndex({ ownerId: 1 });
    await this.permanentScripts.createIndex({keyHash:1},{unique:true});
  }
  userByName(name) { return this.users.findOne({ username: name }); }
  userById(id) { return this.users.findOne({ _id: id }); }
  addUser(u) { return this.users.insertOne(u); }
  allUsers() { return this.users.find({}).project({ password: 0, authVersion: 0 }).sort({ username: 1 }).toArray(); }
  updateUser(id, fields) { return this.users.updateOne({ _id: id }, { $set: fields, $inc: { authVersion: 1 } }); }
  addSession(s) { return this.sessions.insertOne(s); }
  session(hash) { return this.sessions.findOne({ _id: hash, expiresAt: { $gt: new Date() } }); }
  revokeSession(hash) { return this.sessions.deleteOne({ _id: hash }); }
  addCaptureKey(key) { return this.captureKeys.insertOne(key); }
  async captureKey(hash) { const record=await this.permanentScripts.findOne({keyHash:hash});return record?{ownerId:record._id,authVersion:record.authVersion,scriptVersion:Number(record.scriptVersion)||0,permanent:true}:this.captureKeys.findOne({_id:hash}); }
  permanentScript(ownerId) { return this.permanentScripts.findOne({_id:ownerId}); }
  async upgradePermanentScript(previous,next){await this.permanentScripts.replaceOne({_id:previous._id,revision:previous.revision,authVersion:previous.authVersion},next);return this.permanentScript(previous._id);}
  globalCaptureSettings(){return this.settings.findOne({_id:'global:capture'});}
  saveGlobalCaptureSettings(value){return this.settings.updateOne({_id:'global:capture'},{$set:{value}},{upsert:true});}
  async ensurePermanentScript(candidate) {
    try { await this.permanentScripts.updateOne({_id:candidate._id},{$setOnInsert:candidate},{upsert:true}); }
    catch(e) { if(e.code!==11000)throw e; }
    for(let attempt=0;attempt<4;attempt++){
      const current=await this.permanentScript(candidate._id);
      if(!current)throw new Error('The script was revoked during copying. Copy it again.');
      if(current.authVersion>=candidate.authVersion)return current;
      const result=await this.permanentScripts.replaceOne({_id:current._id,revision:current.revision},candidate);
      if(result.matchedCount)return candidate;
    }
    throw new Error('The script changed during copying. Try again.');
  }
  async installPermanentScript(previous,candidate) {
    if(previous)await this.permanentScripts.replaceOne({_id:previous._id,revision:previous.revision},candidate);
    else {try{await this.permanentScripts.insertOne(candidate);}catch(e){if(e.code!==11000)throw e;}}
    return this.permanentScript(candidate._id);
  }
  async revokeCaptureKeys(ownerId,reason) {
    await this.users.updateOne({_id:ownerId},{$set:{scriptRevocation:reason},$inc:{scriptVersion:1}});
    return this.captureKeys.deleteMany({ownerId});
  }
  async captureWebLinks(ownerId, rows, batchId) {
    for (const row of rows) {
      const insert = { ...row, _id: hashToken(ownerId + '\0' + row.url), ownerId, capture_batch: batchId };
      try { await this.links.updateOne({ ownerId, url: row.url }, { $setOnInsert: insert }, { upsert: true }); }
      catch (e) { if (e.code !== 11000 || !await this.links.findOne({ _id: insert._id, ownerId, url: row.url })) throw e; }
    }
    // The batch marker makes a retry return its original inserted count even if
    // the first HTTP response was lost. Existing captures keep their metadata.
    return this.links.countDocuments({ ownerId, capture_batch: batchId, url: { $in: rows.map(r => r.url) } });
  }
  filter(ownerId, params) {
    const filter = { ownerId };
    if (params.service) { exportTitle(params.service); filter.service = params.service; }
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
      const insert = { ...fields, ownerId, first_seen, _id: hashToken(ownerId + '\0' + item.url) };
      if (!exported) insert.exported = false;
      // Existing IDs/history remain intact. New rows use a stable owner+URL ID,
      // so two PCs cannot insert the same new URL under different labels.
      const filter = { ownerId, url: item.url };
      // Keep the original capture metadata; only the exported flag may advance.
      const update = { $setOnInsert: insert, ...(exported ? { $set: { exported: true } } : {}) };
      try { await this.links.updateOne(filter, update, { upsert: true }); }
      catch (e) {
        if (e.code !== 11000 || !await this.links.findOne({ _id: insert._id, ownerId, url: item.url })) throw e;
        if (exported) await this.links.updateOne(filter, { $set: { exported: true } });
      }
    }
  }
  async existingUrls(ownerId, urls) {
    return (await this.links.find({ ownerId, url: { $in: urls } }).project({ url: 1 }).toArray()).map(r => r.url);
  }
  settingsFor(ownerId) { return this.settings.findOne({ _id: ownerId }); }
  saveSettings(ownerId, value) { return this.settings.updateOne({ _id: ownerId }, { $set: { value } }, { upsert: true }); }
  addExport(item) { return this.exports.insertOne(item); }
  saveExport(item) { return this.exports.updateOne({ _id: item._id, ownerId: item.ownerId }, { $setOnInsert: item }, { upsert: true }); }
  markExported(ownerId, ids) { return this.links.updateMany({ ownerId, _id: { $in: ids } }, { $set: { exported: true } }); }
  listExports(ownerId) { return this.exports.find({ ownerId }).project({ urls: 0 }).sort({ createdAt: -1 }).limit(100).toArray(); }
  exportById(ownerId, id) { return this.exports.findOne({ ownerId, _id: id }); }
}
