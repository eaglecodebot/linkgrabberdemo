import { randomBytes, randomUUID } from 'node:crypto';
import { hashToken } from './auth.mjs';
import { pageMatches } from '../src/rules.mjs';
import { perkLink } from '../src/decode.mjs';
import { makeWebScript } from '../src/web-capture.mjs';
import { sealScript, openScript } from './script-vault.mjs';

export function cleanSettings(input) {
  const pagePattern=String(input.pagePattern||'').trim();
  if(!/^https?:\/\//.test(pagePattern)||pagePattern.length>2000)throw new Error('Enter the final main webpage URL, optionally with * in its path/query.');
  let parsed;try{parsed=new URL(pagePattern);}catch{throw new Error('Invalid main webpage URL.');}
  if(parsed.username||parsed.password||parsed.hostname.includes('*'))throw new Error('Use an exact website hostname; wildcards belong in the path/query only.');
  const minLinks=Math.max(1,Math.min(5000,Math.floor(Number(input.minLinks)||4)));
  return {pagePattern,minLinks,label:String(input.label||'Browser capture').trim().slice(0,150)||'Browser capture'};
}
export async function createCaptureScript(repo,user,panelOrigin,scriptSecret) {
  cleanSettings((await repo.settingsFor(user._id))?.value||{});
  let record=await repo.permanentScript(user._id);
  if(!record||record.authVersion!==user.authVersion){
    const token=randomBytes(32).toString('hex');
    const candidate={_id:user._id,authVersion:user.authVersion,revision:randomUUID(),keyHash:hashToken(token),username:user.username,createdAt:new Date()};
    candidate.ciphertext=sealScript(makeWebScript({panelOrigin,captureKey:token,username:user.username}),candidate,scriptSecret);
    record=await repo.ensurePermanentScript(candidate);
  }
  if(record.authVersion!==user.authVersion){const e=new Error('Your account changed. Log in again.');e.status=401;throw e;}
  return {script:openScript(record,scriptSecret),owner:{username:user.username,name:user.name},permanent:true,scriptId:record.revision,expiresAt:null};
}
async function resolveCapture(repo,packet) {
  const fail=(message,status=400)=>{const error=new Error(message);error.status=status;throw error;};
  if(!packet||![4,5].includes(packet.version)||!/^([a-f0-9]{64})$/.test(String(packet.captureKey||'')))fail('Invalid capture script. Copy your current script from the Railway panel.',401);
  const key=await repo.captureKey(hashToken(packet.captureKey));
  if(!key||(!key.permanent&&(!key.expiresAt||new Date(key.expiresAt)<=new Date())))fail('Capture script expired or revoked. Copy your current script from the panel.',401);
  const user=await repo.userById(key.ownerId);
  if(!user?.active||user.authVersion!==key.authVersion)fail('Capture access was revoked. Log in and copy your replacement script.',401);
  if(packet.version===5&&!key.permanent)fail('This is an older capture key. Copy your permanent script from the panel.',401);
  const current=cleanSettings((await repo.settingsFor(user._id))?.value||{});
  if(!key.permanent&&(current.pagePattern!==key.settings?.pagePattern||current.minLinks!==key.settings?.minLinks))fail('Main-page settings changed. Copy a new script from the panel.',409);
  return {key,user,current,fail};
}
function validateSource(packet,requestOrigin,panelOrigin,current,fail) {
  const sourceOrigin=new URL(current.pagePattern).origin;
  if(requestOrigin&&requestOrigin!==sourceOrigin&&requestOrigin!==panelOrigin)fail('This website cannot use this capture script.',403);
  if(typeof packet.sourceUrl!=='string'||packet.sourceUrl.length>4000||!pageMatches(current.pagePattern,packet.sourceUrl))fail('This capture is from a different webpage.',403);
}
export async function captureConfiguration(repo,packet,requestOrigin,panelOrigin) {
  const {user,current,fail}=await resolveCapture(repo,packet);validateSource(packet,requestOrigin,panelOrigin,current,fail);
  return {owner:{username:user.username,name:user.name},settings:current};
}
export async function acceptCapture(repo,packet,requestOrigin,panelOrigin) {
  const {key,user,current,fail}=await resolveCapture(repo,packet);validateSource(packet,requestOrigin,panelOrigin,current,fail);
  if(!/^[a-f0-9-]{20,60}$/i.test(String(packet.batchId||'')))fail('Invalid capture ID.');
  if(!Array.isArray(packet.links)||packet.links.length>5000)fail('Invalid link list.');
  const unique=new Map();
  for(const item of packet.links){if(!item||typeof item.url!=='string')fail('Invalid reward link.');const link=perkLink(item.url);if(!link)fail('An unsupported reward link was submitted.');unique.set(link.url,{...link,label:String(item.label||'').slice(0,1000)});}
  const owner={username:user.username,name:user.name};
  const base={owner,id:packet.batchId,at:new Date().toISOString(),count:unique.size,added:0,duplicates:0};
  if(unique.size<current.minLinks)return {...base,level:'error',code:unique.size?'too-few-links':'no-links',message:unique.size?'Only '+unique.size+' of '+current.minLinks+' required links found. Nothing saved.':'No matching links found. Nothing saved.'};
  const label=key.permanent?current.label:(String(packet.label||'Browser capture').trim().slice(0,150)||'Browser capture'),at=new Date().toISOString();
  const rows=[...unique.values()].map(link=>({_id:hashToken(user._id+'\0'+link.url),url:link.url,service:link.service,profile_id:'web-'+hashToken(label).slice(0,24),profile_name:label,account_name:'Web capture',label:link.label,source_url:packet.sourceUrl,title:String(packet.title||'').slice(0,1000),first_seen:at,last_seen:at,exported:false}));
  const added=await repo.captureWebLinks(user._id,rows,packet.batchId);
  const repeated=Number.isInteger(packet.repeated)&&packet.repeated>0?Math.min(5000,packet.repeated):Math.max(0,packet.links.length-unique.size);
  const duplicates=unique.size-added+repeated;
  return {...base,added,duplicates,level:duplicates?(added?'warning':'error'):'success',code:duplicates?'duplicates':'saved',message:duplicates?(added?added+' new links saved. '+duplicates+' duplicate links skipped.':'Duplicate links found. '+duplicates+' already saved or repeated; nothing added.'):added+' new links saved. You can continue.'};
}
