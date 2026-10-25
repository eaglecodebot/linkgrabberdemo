import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.mjs';
import { Secrets } from '../src/secrets.mjs';
import { cleanRule, pageMatches, csvCell, extractFromPage } from '../src/rules.mjs';

test('page patterns anchor to the whole URL, support wildcards and escape punctuation', () => {
  assert.equal(pageMatches('https://site.test/items/*?x=1*', 'https://site.test/items/24?x=1&y=2'), true);
  assert.equal(pageMatches('https://site.test/items*', 'https://siteXtest/items'), false);
  assert.equal(pageMatches('https://site.test/items', 'https://site.test/items?x=1'), false);
  assert.equal(pageMatches('https://site.test/items*', 'https://evil.test/https://site.test/items'), false);
});
test('rule validation and defaults', () => {
  const r = cleanRule({ name: 'Files', pagePattern: 'https://site.test/*' }, 'r');
  assert.equal(r.selector, 'a[href]'); assert.equal(r.attribute, 'href'); assert.equal(r.enabled, true);
  assert.throws(() => cleanRule({ name: 'Files', pagePattern: '*' }, 'r'));
  assert.throws(() => cleanRule({ name: '', pagePattern: 'https://site.test/*' }, 'r'));
});
test('selective extraction resolves relative links, preserves signed queries, rejects unsafe schemes and uses AND filters', () => {
  const oldDoc = globalThis.document, oldLocation = globalThis.location;
  const element = (href, text) => ({ getAttribute: key => key === 'href' ? href : null, innerText: text });
  globalThis.document = { baseURI: 'https://site.test/folder/', title: 'Downloads', querySelectorAll: () => [
    element('/wanted/a?signature=a%2Bb#part', 'Download file'), element('/wanted/no', 'Preview'),
    element('/other/b', 'Download file'), element('javascript:alert(1)', 'Download'), element('#section', 'Download'),
    element('/wanted/a?signature=a%2Bb#part', 'Download file'), element('https://user:pass@site.test/wanted/x', 'Download') ] };
  globalThis.location = { href: 'https://site.test/folder/' };
  try {
    const result = extractFromPage({ selector: 'a[href]', attribute: 'href', urlContains: '/wanted/', textContains: 'download' });
    assert.equal(result.links.length, 1); assert.equal(result.links[0].url, 'https://site.test/wanted/a?signature=a%2Bb#part');
  } finally { globalThis.document = oldDoc; globalThis.location = oldLocation; }
});
test('database survives restart, deduplicates per profile/rule/account and filters exports', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lg-db-')), path = join(dir, 'db.sqlite');
  let store = new Store(path);
  try {
    const a = store.saveAccount(null, 'Account A', 'encrypted'); const b = store.saveAccount(null, 'Account B', 'encrypted');
    const r = store.saveRule({ name: 'Files', pagePattern: 'https://site.test/*' });
    const session = { accountId: a.id, accountName: a.name, profileId: 'p1', profileName: 'Profile 1' };
    const result = { sourceUrl: 'https://site.test/files', title: 'Files', links: [{ url: 'https://files.test/a?key=exact', label: '=UNSAFE()' }] };
    assert.equal(store.capture(session, r, result), 1); assert.equal(store.capture(session, r, result), 0);
    assert.equal(store.capture({ ...session, accountId: b.id, accountName: b.name }, r, result), 1);
    assert.equal(store.capture({ ...session, profileId: 'p2' }, r, result), 1);
    assert.equal(store.query({ accountId: a.id }).total, 2); assert.equal(store.query({ q: 'key=exact' }).total, 3);
    store.deleteRule(r.id); assert.equal(store.total(), 3);
    store.close(); store = new Store(path); assert.equal(store.total(), 3); assert.equal(store.accounts().length, 2);
    assert.equal(store.query({}, true).rows[0].url, 'https://files.test/a?key=exact');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('token encryption round-trip does not store plaintext', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lg-token-'));
  try { const s = new Secrets(dir), token = 'test-token-ABC-123'; const encrypted = await s.encrypt(token); assert.equal(encrypted.includes(token), false); assert.equal(await s.decrypt(encrypted), token); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});
test('CSV quoting prevents spreadsheet formula execution', () => {
  assert.equal(csvCell('=1+1'), '"\'=1+1"'); assert.equal(csvCell('hello,"x"'), '"hello,""x"""');
});
