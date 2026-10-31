import { perkLink, SERVICE_NAMES } from '../src/decode.mjs';

// Build from the saved URLs so old snapshots also gain organized downloads.
export function textExport(snapshot) {
  const groups = new Map(SERVICE_NAMES.map(service => [service, []]));
  if(snapshot.worksheets){
    for(const group of snapshot.worksheets){
      if(!groups.has(group.service))groups.set(group.service,[]);
      for(const index of group.indexes){if(!Number.isInteger(index)||typeof snapshot.urls[index]!=='string')throw new Error('Invalid export link.');groups.get(group.service).push(snapshot.urls[index]);}
    }
  }else for (const url of snapshot.urls) {
    const service = perkLink(url)?.service;
    if (!groups.has(service)) throw new Error('Unsupported link in export.');
    groups.get(service).push(url);
  }
  const sections = [...groups].filter(([, urls]) => urls.length);
  // Dedicated service files remain plain URL lists for convenient bulk use.
  if (sections.length === 1 && !snapshot.filename.startsWith('Decoded_Links_'))
    return snapshot.urls.join('\r\n') + '\r\n';
  return sections.map(([service, urls]) => service + '\r\n\r\n' + urls.join('\r\n')).join('\r\n\r\n') + '\r\n';
}
