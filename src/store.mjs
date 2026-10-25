import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { cleanRule } from './rules.mjs';

export class Store {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, secret TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rules (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS links (id INTEGER PRIMARY KEY, account_id TEXT, account_name TEXT,
        profile_id TEXT, profile_name TEXT, rule_id TEXT, rule_name TEXT, url TEXT, label TEXT,
        source_url TEXT, title TEXT, first_seen TEXT, last_seen TEXT,
        UNIQUE(account_id,profile_id,rule_id,url));
      CREATE INDEX IF NOT EXISTS links_time ON links(last_seen DESC);`);
    const columns = new Set(this.db.prepare('PRAGMA table_info(links)').all().map(x => x.name));
    for (const [name, definition] of Object.entries({ original_url: "TEXT DEFAULT ''", service: "TEXT DEFAULT ''", uid: "TEXT DEFAULT ''", revision: 'INTEGER DEFAULT 1', sync_ack: 'INTEGER DEFAULT 0', exported: 'INTEGER DEFAULT 0' })) {
      if (!columns.has(name)) this.db.exec('ALTER TABLE links ADD COLUMN ' + name + ' ' + definition);
    }
    for (const row of this.db.prepare("SELECT id FROM links WHERE uid='' OR uid IS NULL").all()) this.db.prepare('UPDATE links SET uid=? WHERE id=?').run(randomUUID(), row.id);
    this.db.exec('CREATE TABLE IF NOT EXISTS exports (id TEXT PRIMARY KEY,value TEXT); CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY,value TEXT); CREATE TABLE IF NOT EXISTS export_sync (id TEXT PRIMARY KEY);');
  }
  accounts() { return this.db.prepare('SELECT id,name FROM accounts ORDER BY name').all(); }
  account(id) { return this.db.prepare('SELECT * FROM accounts WHERE id=?').get(id); }
  saveAccount(id, name, secret) {
    id ||= randomUUID();
    this.db.prepare('INSERT INTO accounts VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,secret=excluded.secret').run(id, name, secret);
    return { id, name };
  }
  rules() { return this.db.prepare('SELECT value FROM rules').all().map(r => JSON.parse(r.value)); }
  saveRule(input) {
    const rule = cleanRule(input, input.id || randomUUID());
    this.db.prepare('INSERT INTO rules VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(rule.id, JSON.stringify(rule));
    return rule;
  }
  deleteRule(id) { this.db.prepare('DELETE FROM rules WHERE id=?').run(id); }
  capture(session, rule, result) {
    const stmt = this.db.prepare(`INSERT INTO links
      (account_id,account_name,profile_id,profile_name,rule_id,rule_name,url,label,source_url,title,first_seen,last_seen,original_url,service,uid)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,profile_id,rule_id,url)
      DO UPDATE SET label=excluded.label,source_url=excluded.source_url,title=excluded.title,last_seen=excluded.last_seen,original_url=excluded.original_url,service=excluded.service,revision=links.revision+1`);
    const now = new Date().toISOString();
    let added = 0;
    this.db.exec('BEGIN');
    try {
      for (const link of result.links) {
        const existing = this.db.prepare('SELECT id FROM links WHERE account_id=? AND profile_id=? AND rule_id=? AND url=?').get(session.accountId, session.profileId, rule.id, link.url);
        stmt.run(session.accountId, session.accountName, session.profileId, session.profileName, rule.id, rule.name, link.url, link.label, result.sourceUrl, result.title, now, now, link.originalUrl || link.url, link.service || '', randomUUID());
        if (!existing) added++;
      }
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    return added;
  }
  query(params = {}, exportAll = false) {
    const clauses = [], args = [];
    if (params.q) {
      clauses.push('(url LIKE ? OR label LIKE ? OR profile_name LIKE ? OR rule_name LIKE ? OR source_url LIKE ?)');
      for (let i = 0; i < 5; i++) args.push('%' + String(params.q).slice(0, 1000) + '%');
    }
    if (params.accountId) { clauses.push('account_id=?'); args.push(params.accountId); }
    if (params.status === 'new') clauses.push('exported=0');
    if (params.status === 'exported') clauses.push('exported=1');
    const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
    const total = this.db.prepare('SELECT count(*) AS n FROM links' + where).get(...args).n;
    const page = Math.max(1, Math.floor(Number(params.page) || 1));
    const sql = 'SELECT * FROM links' + where + ' ORDER BY last_seen DESC,id DESC';
    const rows = exportAll ? this.db.prepare(sql).all(...args) : this.db.prepare(sql + ' LIMIT 50 OFFSET ?').all(...args, (page - 1) * 50);
    return { total, page, rows };
  }
  total() { return this.db.prepare('SELECT count(*) AS n FROM links').get().n; }
  pending() { return this.db.prepare('SELECT * FROM links WHERE revision>sync_ack LIMIT 200').all(); }
  pendingCount() { return this.db.prepare('SELECT count(*) AS n FROM links WHERE revision>sync_ack').get().n; }
  acknowledge(rows) { for (const r of rows) this.db.prepare('UPDATE links SET sync_ack=max(sync_ack,?) WHERE uid=?').run(r.revision, r.uid); }
  setting(id, value) {
    if (value !== undefined) this.db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(id, JSON.stringify(value));
    const row = this.db.prepare('SELECT value FROM settings WHERE id=?').get(id); return row ? JSON.parse(row.value) : null;
  }
  exportSnapshot(rows, filename) {
    const item = { id: randomUUID(), filename, createdAt: new Date().toISOString(), urls: [...new Set(rows.map(r => r.url))] };
    this.db.exec('BEGIN');
    try {
      this.db.prepare('INSERT INTO exports VALUES (?,?)').run(item.id, JSON.stringify(item));
      for (const r of rows) this.db.prepare('UPDATE links SET exported=1,revision=revision+1 WHERE id=?').run(r.id);
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    return item;
  }
  exports() { return this.db.prepare('SELECT value FROM exports ORDER BY rowid DESC').all().map(x => JSON.parse(x.value)); }
  pendingExports() { return this.db.prepare('SELECT value FROM exports WHERE id NOT IN (SELECT id FROM export_sync) LIMIT 1').all().map(x => JSON.parse(x.value)); }
  acknowledgeExport(id) { this.db.prepare('INSERT OR IGNORE INTO export_sync VALUES (?)').run(id); }
  markUrlsExported(urls) { for (const url of urls) this.db.prepare('UPDATE links SET exported=1,revision=revision+1 WHERE url=? AND exported=0').run(url); }
  close() { this.db.close(); }
}
