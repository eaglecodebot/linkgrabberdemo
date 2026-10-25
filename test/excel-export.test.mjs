import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { createApp, bootstrap } from '../cloud/app.mjs';
import { MemoryRepository } from './cloud-memory.mjs';
import { indianFilename, perkLink } from '../src/decode.mjs';

const urls = ['https://youtube.com/premium?acc=EXAMPLE%2Bkeep&other=%26keep', 'https://lovable.dev/lp/example?reward_code=EXAMPLE', 'https://www.notion.com/redeem/linkedin?code=EXAMPLE', 'https://nordvpn.com/linkedin/?code=EXAMPLE', 'https://checkout.headspace.com/checkout?voucherCode=LINKEDIN-EXAMPLE'];
const workbook = async bytes => { const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes); return book; };
const values = sheet => sheet.getColumn(1).values.slice(2);
async function fixture() {
  const repo = new MemoryRepository(); await bootstrap(repo, 'admin', 'password');
  const server = createApp(repo); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  const request = (path, token = '', body) => fetch(origin + '/api/' + path, { headers: { Authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
  const admin = await (await request('login', '', { username: 'admin', password: 'password' })).json();
  const alice = (await (await request('admin/users', admin.token, { username: 'alice', password: 'password' })).json()).user;
  const bob = (await (await request('admin/users', admin.token, { username: 'bob', password: 'password' })).json()).user;
  const auth = await (await request('login', '', { username: 'alice', password: 'password' })).json();
  const other = await (await request('login', '', { username: 'bob', password: 'password' })).json();
  const seed = async (owner, links) => repo.saveLinks(owner, links.map((url, i) => ({ _id: owner + '-' + i + '-' + url, url, service: perkLink(url).service, exported: false, first_seen: '2026-10-25T08:39:54.000Z', last_seen: '2026-10-25T08:39:54.000Z' })));
  return { repo, request, admin, alice, bob, auth, other, seed, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

test('Excel combines exact full URLs into their service sheets, retains history and isolates users', async () => {
  const f = await fixture(); try {
    const long = 'https://youtube.com/premium?acc=' + 'A%2B%26B'.repeat(500);
    await f.seed(f.alice.id, [...urls, long]); await f.seed(f.bob.id, [urls[0] + 'BOB']);
    const response = await f.request('exports', f.auth.token, { format: 'xlsx', status: 'new' });
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.match(response.headers.get('content-disposition'), /^attachment; filename="Decoded_Links_\d{4}-\d{2}-\d{2}\.xlsx"$/);
    const buffer = Buffer.from(await response.arrayBuffer()), book = await workbook(buffer);
    assert.deepEqual(book.worksheets.map(sheet => sheet.name), ['YouTube', 'Lovable', 'Notion', 'Nord', 'Headspace']);
    assert.deepEqual(values(book.getWorksheet('YouTube')), [urls[0], long]);
    for (const [index, name] of [[1, 'Lovable'], [2, 'Notion'], [3, 'Nord'], [4, 'Headspace']]) assert.deepEqual(values(book.getWorksheet(name)), [urls[index]]);
    for (const sheet of book.worksheets) { assert.equal(sheet.getCell('A1').value, 'Link'); assert.equal(sheet.views[0].ySplit, 1); for (const value of values(sheet)) assert.equal(typeof value, 'string'); }
    assert.equal((await f.repo.listLinks(f.alice.id, { status: 'exported' })).total, 6); assert.equal((await f.repo.listLinks(f.bob.id, { status: 'new' })).total, 1);
    const id = response.headers.get('x-export-id'); assert(id);
    assert.equal((await f.request('exports/get?id=' + id, f.other.token)).status, 404);
    assert.equal((await f.request('exports/get?id=' + id + '&userId=' + f.alice.id, f.other.token)).status, 403);
    assert.equal((await f.request('exports/get?id=' + id)).status, 401);
    const adminDownload = await f.request('exports/get?id=' + id + '&userId=' + f.alice.id, f.admin.token); assert.equal(adminDownload.status, 200); assert.equal((await workbook(await adminDownload.arrayBuffer())).worksheets.length, 5);
    if (process.env.TEST_XLSX_DIR) { await mkdir(process.env.TEST_XLSX_DIR, { recursive: true }); await writeFile(join(process.env.TEST_XLSX_DIR, 'service-export.xlsx'), buffer); }
  } finally { await f.close(); }
});

test('service/search/status filters apply to Excel and all matching rows export beyond the first page', async () => {
  const f = await fixture(); try {
    const many = Array.from({ length: 72 }, (_, index) => 'https://youtube.com/premium?acc=MATCH-' + index);
    await f.seed(f.alice.id, [...many, urls[1]]);
    const response = await f.request('exports', f.auth.token, { format: 'xlsx', service: 'YouTube', status: 'new', q: 'MATCH-' });
    const book = await workbook(await response.arrayBuffer()); assert.deepEqual(book.worksheets.map(sheet => sheet.name), ['YouTube']); assert.equal(values(book.getWorksheet('YouTube')).length, 72); assert.equal(new Set(values(book.getWorksheet('YouTube'))).size, 72);
    assert.match(response.headers.get('content-disposition'), /YouTube_.*\.xlsx/); assert.equal((await f.repo.listLinks(f.alice.id, { status: 'new' })).total, 1);
    const exported = await f.request('exports', f.auth.token, { format: 'xlsx', service: 'YouTube', status: 'exported', q: 'MATCH-71' }); assert.deepEqual(values((await workbook(await exported.arrayBuffer())).getWorksheet('YouTube')), [many[71]]);
  } finally { await f.close(); }
});

test('Excel Download again uses its original snapshot even when current records change', async () => {
  const f = await fixture(); try {
    await f.seed(f.alice.id, urls);
    const response = await f.request('exports', f.auth.token, { format: 'xlsx' }); const id = response.headers.get('x-export-id'); const original = await workbook(await response.arrayBuffer());
    f.repo.links.clear(); await f.seed(f.alice.id, [urls[0] + 'NEW']);
    const again = await f.request('exports/get?id=' + id, f.auth.token), restored = await workbook(await again.arrayBuffer());
    assert.deepEqual(restored.worksheets.map(sheet => [sheet.name, values(sheet)]), original.worksheets.map(sheet => [sheet.name, values(sheet)]));
    const history = await (await f.request('exports', f.auth.token)).json(); assert.equal(history.exports[0].format, 'xlsx'); assert.equal(history.exports[0].count, 5); assert.equal('urls' in history.exports[0], false); assert.equal('worksheets' in history.exports[0], false);
  } finally { await f.close(); }
});

test('invalid/empty/oversized and cross-user Excel exports never create snapshots or mark links', async () => {
  const f = await fixture(); try {
    await f.seed(f.alice.id, urls);
    for (const [body, status] of [[{ format: 'csv' }, 400], [{ format: 'xlsx', q: 'does-not-exist' }, 400], [{ format: 'xlsx', userId: f.bob.id }, 403]]) assert.equal((await f.request('exports', f.auth.token, body)).status, status);
    assert.equal(f.repo.exports.size, 0); assert.equal((await f.repo.listLinks(f.alice.id, { status: 'new' })).total, 5);
    const list = f.repo.listLinks.bind(f.repo); f.repo.listLinks = async () => ({ rows: Array.from({ length: 10001 }, (_, index) => ({ _id: '' + index, url: urls[0] + index, service: 'YouTube' })) });
    assert.equal((await f.request('exports', f.auth.token, { format: 'xlsx' })).status, 400); assert.equal(f.repo.exports.size, 0); f.repo.listLinks = list;
    assert.equal((await f.repo.listLinks(f.alice.id, { status: 'new' })).total, 5);
  } finally { await f.close(); }
});

test('Excel filenames use the Indian date; TXT defaults and old snapshots remain compatible', async () => {
  assert.equal(indianFilename('Decoded_Links', new Date('2026-10-24T20:00:00Z'), 'xlsx'), 'Decoded_Links_2026-10-25.xlsx');
  assert.equal(indianFilename('YouTube', new Date('2026-10-24T20:00:00Z')), 'YouTube_2026-10-25.txt');
  const f = await fixture(); try {
    await f.repo.addExport({ _id: 'legacy', ownerId: f.alice.id, filename: 'YouTube_2026-10-25.txt', urls: [urls[0]], count: 1, createdAt: '2026-10-25T00:00:00Z' });
    const legacy = await (await f.request('exports/get?id=legacy', f.auth.token)).json(); assert.deepEqual(legacy.export.urls, [urls[0]]);
    await f.seed(f.alice.id, urls); const response = await f.request('exports', f.auth.token, {}); assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8'); assert.deepEqual((await response.json()).export.urls, urls);
  } finally { await f.close(); }
});


test('All TXT exports group mixed links and legacy snapshots by service without changing URLs', async () => {
  const f = await fixture(); try {
    const second = urls[0] + '&second=%2B%26';
    const mixed = [urls[4], urls[0], urls[3], urls[1], second, urls[2]];
    await f.seed(f.alice.id, mixed);
    const result = await (await f.request('exports', f.auth.token, {})).json();
    const expected = 'YouTube\r\n\r\n' + urls[0] + '\r\n' + second + '\r\n\r\nLovable\r\n\r\n' + urls[1] + '\r\n\r\nNotion\r\n\r\n' + urls[2] + '\r\n\r\nNordVPN\r\n\r\n' + urls[3] + '\r\n\r\nHeadspace\r\n\r\n' + urls[4] + '\r\n';
    assert.equal(result.export.text, expected);
    assert.deepEqual(result.export.urls, mixed);
    f.repo.links.clear();
    const again = await (await f.request('exports/get?id=' + result.export._id, f.auth.token)).json();
    assert.equal(again.export.text, expected);
    await f.repo.addExport({ _id: 'legacy-mixed', ownerId: f.alice.id, filename: 'Decoded_Links_2026-10-25.txt', urls: mixed, count: mixed.length, createdAt: '2026-10-25T00:00:00Z' });
    assert.equal((await (await f.request('exports/get?id=legacy-mixed', f.auth.token)).json()).export.text, expected);
    await f.seed(f.alice.id, [urls[0]]);
    const singleAll = await (await f.request('exports', f.auth.token, {})).json();
    assert.equal(singleAll.export.text, 'YouTube\r\n\r\n' + urls[0] + '\r\n');
    const service = await (await f.request('exports', f.auth.token, { service: 'YouTube', status: 'all' })).json();
    assert.equal(service.export.text, urls[0] + '\r\n');
  } finally { await f.close(); }
});
