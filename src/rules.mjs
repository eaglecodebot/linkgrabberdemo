export function cleanRule(input, id) {
  const value = key => String(input[key] ?? '').trim();
  const r = { id, name: value('name'), pagePattern: value('pagePattern'),
    selector: value('selector') || 'a[href]', attribute: value('attribute') || 'href',
    urlContains: value('urlContains'), textContains: value('textContains'), enabled: input.enabled !== false,
    decodeMode: ['perks','decode','raw'].includes(input.decodeMode) ? input.decodeMode : 'perks',
    minLinks: Math.max(1, Math.min(5000, Math.floor(Number(input.minLinks) || 4))) };
  if (!r.name || r.name.length > 150) throw new Error('Give the rule a name (up to 150 characters).');
  if (!/^https?:\/\//i.test(r.pagePattern) || r.pagePattern.length > 2000) {
    throw new Error('Page pattern must start with http:// or https://. Use * to match variable parts.');
  }
  if (r.selector.length > 1000 || !/^[\w:-]{1,100}$/.test(r.attribute)) throw new Error('Invalid selector or link attribute.');
  if (r.urlContains.length > 2000 || r.textContains.length > 500) throw new Error('Link filters are too long.');
  return r;
}

export function pageMatches(pattern, url) {
  const escaped = pattern.split('*').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${escaped}$`, 'i').test(url);
}

// This function is sent to the browser. Keep it independent of Node globals.
export function extractFromPage(rule) {
  const links = new Map();
  const elements = document.querySelectorAll(rule.selector);
  for (const el of elements) {
    const raw = el.getAttribute(rule.attribute);
    if (!raw || !raw.trim() || /^(?:javascript|data|mailto|tel):/i.test(raw.trim()) || raw.trim().startsWith('#')) continue;
    let url;
    try { url = new URL(raw, document.baseURI); } catch { continue; }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue;
    const label = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    if (rule.urlContains && !url.href.toLowerCase().includes(rule.urlContains.toLowerCase())) continue;
    if (rule.textContains && !label.toLowerCase().includes(rule.textContains.toLowerCase())) continue;
    if (url.href.length > 16000) continue;
    links.set(url.href, { url: url.href, label: label.slice(0, 1000) });
    if (links.size >= 5000) break;
  }
  return { links: [...links.values()], title: document.title.slice(0, 1000), sourceUrl: location.href };
}

export function csvCell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r\n]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
