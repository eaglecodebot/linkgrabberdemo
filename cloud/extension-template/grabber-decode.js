(() => {
// Shared by the local collector and the cloud API. Never fetches a destination.
function decodeLink(input) {
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

const SERVICE_NAMES=['YouTube','Lovable','Notion','NordVPN','Headspace'];
const DEFAULT_SERVICES=SERVICE_NAMES.slice(0,4);
const SERVICE_RULES=[
  {service:'YouTube',hosts:['youtube.com'],queryAny:['acc']},
  {service:'Lovable',hosts:['lovable.dev'],queryAny:['reward_code']},
  {service:'Notion',hosts:['notion.com'],queryAny:['code']},
  {service:'NordVPN',hosts:['nordvpn.com'],queryAny:['code']},
  {service:'Headspace',hosts:['checkout.headspace.com'],queryAny:['voucherCode']}
];
// Embedded in the permanent script; rules themselves come from the server.
function matchRewardLink(input,rules) {
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
function perkLink(input){return matchRewardLink(input,SERVICE_RULES);}


globalThis.__linkGrabberDecode={decodeLink,matchRewardLink};
})();
