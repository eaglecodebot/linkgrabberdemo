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

test('Headspace LinkedIn checkout vouchers decode from wrappers with the full code preserved',()=>{
 const url='https://checkout.headspace.com/checkout?voucherCode=LINKEDIN-ABCDEF0123456789';
 for(const input of [url,wrap(url),wrap(wrap(url))]){const actual=perkLink(input);assert.equal(actual.service,'Headspace');assert.equal(actual.url,url);}
 const encoded='https://checkout.headspace.com/checkout?voucherCode=LINKEDIN-A%2BB%26C%3DD%252F&origin=keep#fragment';assert.equal(perkLink(wrap(encoded)).url,encoded);
});
test('Headspace generic pages, wrong/empty voucher fields and lookalike hosts are excluded',()=>{
 for(const url of ['https://headspace.com/','https://www.headspace.com/code','https://work.headspace.com/linkedin/member','https://checkout.headspace.com/checkout','https://checkout.headspace.com/checkout?voucherCode=','https://checkout.headspace.com/checkout?code=EXAMPLE','https://checkout.headspace.com/checkout?vouchercode=EXAMPLE','https://checkout.headspace.com.evil.test/checkout?voucherCode=EXAMPLE','https://help.headspace.com/checkout?voucherCode=EXAMPLE'])assert.equal(perkLink(wrap(url)),null);
});
