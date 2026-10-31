// Shared by the local collector and the cloud API. Never fetches a destination.
export function decodeLink(input) {
  let value = String(input || '').trim();
  if (!value || value.length > 16000 || /[\u0000-\u0020\u007f]/.test(value)) return null;
  for (let depth = 0; depth < 5; depth++) {
    if (!value || value.length > 16000 || /[\u0000-\u0020\u007f]/.test(value)) return null;
    let parsed;
    try { parsed = new URL(value); } catch { return null; }
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'linkedin.com' && /^\/safety\/go\/?$/.test(parsed.pathname)) {
      const embedded = parsed.searchParams.getAll('url');
      if (embedded.length !== 1 || !embedded[0] || embedded[0] === value) return null;
      // URLSearchParams decodes the wrapper once. Do not decode the resulting
      // URL again: encoded &, + and = inside reward codes must remain intact.
      value = embedded[0];
      continue;
    }
    return { url: value, host };
  }
  return null;
}

export const SERVICE_NAMES=['YouTube','Lovable','Notion','NordVPN','Headspace'];
export const DEFAULT_SERVICES=SERVICE_NAMES.slice(0,4);
export const SERVICE_RULES=[
  {service:'YouTube',hosts:['youtube.com'],queryAny:['acc']},
  {service:'Lovable',hosts:['lovable.dev'],queryAny:['reward_code']},
  {service:'Notion',hosts:['notion.com'],queryAny:['code']},
  {service:'NordVPN',hosts:['nordvpn.com'],queryAny:['code']},
  {service:'Headspace',hosts:['checkout.headspace.com'],queryAny:['voucherCode']}
];
// Embedded in the permanent script; rules themselves come from the server.
export function matchRewardLink(input,rules) {
  const decoded=decodeLink(input);if(!decoded)return null;
  const u=new URL(decoded.url),path=u.pathname.toLowerCase();
  for(const rule of rules){
    if(!rule.hosts.includes(decoded.host))continue;
    if(rule.exactPath!==undefined){
      if(u.pathname===rule.exactPath&&(rule.queryAll||[]).every(key=>!!u.searchParams.get(key)))return {...decoded,service:rule.service};
      continue;
    }
    const query=(rule.queryAny||[]).some(key=>!!u.searchParams.get(key));
    const prefix=(rule.pathPrefixes||[]).some(p=>path===p||path.startsWith(p+'/'));
    const contains=(rule.pathContains||[]).some(p=>path.includes(p));
    if(query||prefix||contains)return {...decoded,service:rule.service};
  }
  return null;
}
export function perkLink(input){return matchRewardLink(input,SERVICE_RULES);}

export function decodeResult(result, mode = 'perks') {
  if (mode === 'raw') return result;
  const links = new Map();
  for (const item of result.links) {
    const decoded = mode === 'perks' ? perkLink(item.url) : decodeLink(item.url);
    if (!decoded) continue;
    links.set(decoded.url, { ...item, url: decoded.url, originalUrl: item.url, service: decoded.service || decoded.host });
  }
  return { ...result, links: [...links.values()] };
}

export function indianFilename(title = 'Decoded_Links', date = new Date(), format = 'txt') {
  if (!['txt','xlsx'].includes(format)) throw new Error('Choose TXT or Excel export.');
  const stamp = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  return title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) + '_' + stamp + '.' + format;
}

// An absent service means the combined export; reject unsupported filters.
export function exportTitle(service,available=SERVICE_NAMES) {
  if (!service) return 'Decoded_Links';
  if(typeof service!=='string'||service.length>60||/[\u0000-\u001f\u007f]/.test(service)||(available&&!available.includes(service)))throw new Error('Select a supported service.');
  return service;
}
