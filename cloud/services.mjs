import {decodeLink,SERVICE_RULES,DEFAULT_SERVICES} from '../src/decode.mjs';

export function serviceName(value){
  if(typeof value!=='string')throw new Error('Enter a service name.');
  const name=value.trim().normalize('NFC');
  if(!name||name.length>60||/[\u0000-\u001f\u007f]/.test(name)||['__proto__','constructor','prototype','decoded_links'].includes(name.toLowerCase()))throw new Error('Use a service name of 1–60 printable characters.');
  return name;
}
export async function serviceCatalog(repo){
  const saved=await repo.globalServiceCatalog();
  return saved?.value||{revision:0,services:SERVICE_RULES.map(rule=>({name:rule.service,builtin:true,removed:false,introducedRevision:0,rule}))};
}
export function inferService(input){
  const name=serviceName(input.name),decoded=decodeLink(input.sampleUrl);
  if(!decoded)throw new Error('Paste a valid LinkedIn safety/go link or a decoded HTTP(S) destination URL.');
  const url=new URL(decoded.url);
  if(decoded.host==='linkedin.com'&&/^\/safety\/go\/?$/.test(url.pathname))throw new Error('The wrapped link has no valid destination.');
  const queryAll=[...new Set([...url.searchParams.keys()].filter(key=>!/^utm_/i.test(key)&&!['fbclid','gclid','msclkid','trk','lipi','urlhash','mt'].includes(key.toLowerCase())))];
  if(queryAll.length>30||queryAll.some(key=>!key||key.length>120))throw new Error('This sample has too many or invalid URL parameters.');
  const rule={service:name,hosts:[decoded.host],exactPath:url.pathname,queryAll};
  return {name,rule,preview:{host:decoded.host,path:url.pathname,requiredParameters:queryAll}};
}
function overlaps(a,b){
  if(!a.hosts.some(host=>b.hosts.includes(host)))return false;
  if(a.exactPath!==undefined&&b.exactPath!==undefined)return a.exactPath===b.exactPath;
  const exact=a.exactPath!==undefined?a:b,legacy=exact===a?b:a;
  return (legacy.queryAny||[]).some(key=>exact.queryAll?.includes(key))||(legacy.pathPrefixes||[]).some(p=>exact.exactPath?.toLowerCase().startsWith(p))||(legacy.pathContains||[]).some(p=>exact.exactPath?.toLowerCase().includes(p));
}
export async function changeService(repo,input){
  const previous=await repo.globalServiceCatalog(),catalog=await serviceCatalog({globalServiceCatalog:async()=>previous});
  if(input.revision!==catalog.revision){const e=new Error('Services changed in another session. Reload the list and try again.');e.status=409;throw e;}
  const next=structuredClone(catalog);next.revision++;
  const name=serviceName(input.name),existing=next.services.find(item=>item.name.toLowerCase()===name.toLowerCase());
  if(input.action==='add'){
    const draft=inferService(input);
    if(existing&&!existing.removed)throw new Error('That service already exists. Remove it before changing its matching setup.');
    if(existing&&existing.name!==name)throw new Error('Use the original service name to restore its saved history.');
    const conflict=next.services.find(item=>!item.removed&&item!==existing&&overlaps(item.rule,draft.rule));
    if(conflict)throw new Error('This URL overlaps '+conflict.name+'. Use that service or a different destination path/parameter.');
    if(next.services.filter(item=>!item.removed).length>=50)throw new Error('Up to 50 services can be active.');
    const entry={name,builtin:false,removed:false,introducedRevision:next.revision,rule:draft.rule};
    if(existing)Object.assign(existing,entry);else{if(next.services.length>=200)throw new Error('The saved service catalog is full.');next.services.push(entry);}
  }else if(input.action==='remove'){
    if(!existing||existing.removed)throw new Error('Select an active service.');
    existing.removed=true;
  }else if(input.action==='restore'){
    if(!existing?.removed)throw new Error('Select a removed service.');
    const conflict=next.services.find(item=>!item.removed&&overlaps(item.rule,existing.rule));
    if(conflict)throw new Error('This service overlaps '+conflict.name+'.');
    if(next.services.filter(item=>!item.removed).length>=50)throw new Error('Up to 50 services can be active.');
    existing.removed=false;existing.introducedRevision=next.revision;
  }else throw new Error('Choose add, remove or restore.');
  await repo.saveServiceCatalog(previous,next);
  return next;
}
export function catalogPolicy(catalog,saved){
  const active=catalog.services.filter(item=>!item.removed),availableServices=active.map(item=>item.name);
  const selected=saved?.enabledServices??DEFAULT_SERVICES,seen=Number(saved?.serviceCatalogRevision)||0;
  const enabledServices=availableServices.filter(name=>selected.includes(name)||active.find(item=>item.name===name).introducedRevision>seen);
  return {availableServices,enabledServices,historyServices:catalog.services.map(item=>item.name),serviceCatalogRevision:catalog.revision,rules:active.map(item=>item.rule),requiresDynamicMatcher:active.some(item=>!item.builtin&&enabledServices.includes(item.name))};
}
