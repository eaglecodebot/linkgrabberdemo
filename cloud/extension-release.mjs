import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const template=new URL('./extension-template/',import.meta.url);
let cached;
// Runtime bytes define a release; documentation/tests and personal data do not.
export async function loadExtensionRelease(base=template){
  const files=new Map();
  async function walk(directory,prefix=''){
    for(const entry of await readdir(directory,{withFileTypes:true})){
      if(entry.name.startsWith('.')||['tests','node_modules','capture-connection.json'].includes(entry.name))continue;
      const name=prefix+entry.name;
      if(entry.isDirectory())await walk(new URL(entry.name+'/',directory),name+'/');
      else if(entry.isFile()&&!/\.(txt|md|map)$/i.test(name))files.set(name,await readFile(new URL(entry.name,directory)));
    }
  }
  await walk(base);
  const manifest=JSON.parse(files.get('manifest.json')?.toString()||'{}');
  if(!/^\d+(\.\d+){0,3}$/.test(manifest.version||'')||manifest.version.split('.').some(n=>Number(n)>65535))throw new Error('Set a valid extension version in cloud/extension-template/manifest.json.');
  for(const name of ['background.js','popup.js','popup.html','workflow.json','grabber.js','grabber-page.js'])if(!files.has(name))throw new Error('Extension template is missing '+name+'.');
  if(!files.get('popup.html').toString().includes('id="grab-links"'))throw new Error('Keep the Grab Links button when updating the extension template.');
  const decoder=(await readFile(new URL('../src/decode.mjs',import.meta.url),'utf8')).split('export function decodeResult')[0].replaceAll('export ','');
  files.set('grabber-decode.js',Buffer.from('(() => {\n'+decoder+'\nglobalThis.__linkGrabberDecode={decodeLink,matchRewardLink};\n})();\n'));
  const hash=createHash('sha256');
  for(const [name,bytes] of [...files].sort(([a],[b])=>a<b?-1:a>b?1:0))hash.update(JSON.stringify([name,bytes.length])).update(bytes);
  return {id:hash.digest('hex'),version:manifest.version,files,manifest};
}
export const extensionRelease=()=>cached ||= loadExtensionRelease().catch(e=>{cached=undefined;throw e;});
export async function extensionReleaseStatus(repo,ownerId){
  const release=await extensionRelease(),state=await repo.extensionState(ownerId);
  return {release:{id:release.id,version:release.version},downloaded:!!state?.downloadedReleases?.includes(release.id),notify:!state?.seenReleases?.includes(release.id)};
}
export async function currentReleaseId(id){
  const release=await extensionRelease();
  if(id!==release.id){const e=new Error('A newer extension release is available. Refresh and download it.');e.status=409;throw e;}
  return release;
}
