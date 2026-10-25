import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeLink, perkLink, decodeResult, indianFilename } from '../src/decode.mjs';
const wrap = url => 'https://www.linkedin.com/safety/go/?url=' + encodeURIComponent(url) + '&urlhash=tracking&mt=tracking';
const destinations = ['https://youtube.com/premium?acc=example-code', 'https://lovable.dev/lp/linkedin-premium-2603?reward_code=example-code', 'https://www.notion.com/redeem/linkedin?code=example-code', 'https://nordvpn.com/linkedin/?code=example-code'];
test('all four provided wrapper formats decode to full destination URLs without network access', () => {
  for (const url of destinations) assert.equal(perkLink(wrap(url)).url, url);
});
test('signed queries are decoded once; encoded delimiters, literal plus and fragments are preserved', () => {
  for (const value of ['a%2Bb%26c%3Dd%252F','literal+plus','something%2526encoded']) {
    const url = 'https://youtube.com/premium?acc=' + value + '&other=keep%26this#fragment';
    assert.equal(decodeLink(wrap(url)).url, url);
    assert.equal(decodeLink(wrap(wrap(url))).url, url);
  }
});
test('unsafe, ambiguous and unrelated destinations are excluded', () => {
  for (const url of ['javascript:alert(1)','data:text/plain,hello','https://youtube.com/premium?acc=a\nmalicious-line','https://user:pass@youtube.com/premium?acc=abc','https://youtube.com.evil.test/premium?acc=abc','https://youtube.com/']) assert.equal(perkLink(wrap(url)), null);
  assert.equal(decodeLink(wrap(destinations[0]) + '&url=' + encodeURIComponent(destinations[1])), null);
});
test('batch removes tracking-wrapper duplicates and has no four-link cap', () => {
  const result = decodeResult({ links: [...destinations.map(url => ({ url: wrap(url), label: 'Reward' })), { url: destinations[0] }, { url: wrap('https://youtube.com/premium?acc=another') }, { url: 'https://example.test/help' }], sourceUrl: 'https://source.test', title: 'Perks' });
  assert.equal(result.links.length, 5); assert(result.links.every(x => !x.url.includes('safety/go')));
});
test('TXT filenames use the Indian calendar date across a UTC midnight boundary', () => {
  assert.equal(indianFilename('Decoded_Links', new Date('2026-10-24T20:00:00Z')), 'Decoded_Links_2026-10-25.txt');
});
