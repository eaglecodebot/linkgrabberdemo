import {serviceCatalog,catalogPolicy} from './services.mjs';
import {workflowSettings} from './workflow-settings.mjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { hashToken } from './auth.mjs';
import { pageMatches } from '../src/rules.mjs';
import { matchRewardLink, SERVICE_NAMES, DEFAULT_SERVICES } from '../src/decode.mjs';
import { makeWebScript } from '../src/web-capture.mjs';
import { sealScript, openScript } from './script-vault.mjs';

export function cleanSettings(input,available=SERVICE_NAMES) {
  const pagePattern=String(input.pagePattern||'').trim();
  if(!/^https?:\/\//.test(pagePattern)||pagePattern.length>2000)throw new Error('Enter the final main webpage URL, optionally with * in its path/query.');
  let parsed;try{parsed=new URL(pagePattern);}catch{throw new Error('Invalid main webpage URL.');}
  if(parsed.username||parsed.password||parsed.hostname.includes('*'))throw new Error('Use an exact website hostname; wildcards belong in the path/query only.');
  const selected=input.enabledServices===undefined?DEFAULT_SERVICES:input.enabledServices;
  if(!Array.isArray(selected)||selected.some(service=>!available.includes(service)))throw new Error('Choose only the supported capture services.');
  return {pagePattern,enabledServices:available.filter(service=>selected.includes(service)),label:'Browser capture'};
}
export async function captureSettings(repo) {
  const saved=(await repo.globalCaptureSettings())?.value,catalog=await serviceCatalog(repo),policy=catalogPolicy(catalog,saved);
  return saved?{...cleanSettings({...saved,enabledServices:policy.enabledServices},policy.availableServices),configured:true,...policy}:{pagePattern:'',label:'Browser capture',configured:false,...policy};
}
// Script reads never create replacements. Only an explicit regeneration action
// writes a new key. A separate version invalidates manual revocations without
// logging out the user; password/access changes also advance authVersion.
export function revocation(code, reason) { return {code, reason, at:new Date().toISOString()}; }
const scriptVersion = value => Number(value?.scriptVersion) || 0;
function scriptStatus(user, record, panelOrigin,minimumEngine=6) {
  const state=(status,code,reason,canRegenerate=true)=>({status,code,reason,canRegenerate,revokedAt:user.scriptRevocation?.at||null,scriptId:null});
  if(!user.active)return state('revoked','account-disabled','Your account was disabled by an administrator. Contact the administrator to restore access.',false);
  if(!record||record.authVersion!==user.authVersion||scriptVersion(record)!==scriptVersion(user)){
    if(user.scriptRevocation)return state('revoked',user.scriptRevocation.code,user.scriptRevocation.reason);
    if(record)return state('revoked','credentials-changed','Your credentials or account access changed. Your earlier script was revoked.');
    return state('missing','not-generated','You do not have a capture script yet.');
  }
  if((Number(record.engineVersion)||0)<6)return state('replacement-required','engine-update','The capture engine was updated. Your earlier script needs a replacement.');
  if(record.panelOrigin&&record.panelOrigin!==panelOrigin)return state('replacement-required','panel-address-changed','The panel address changed. Regenerate your script for the current address.');
  if((Number(record.engineVersion)||0)<minimumEngine)return {...state('replacement-required','service-matcher-update','New capture services need the updated console matcher. Regenerate your script once. The updated extension can keep its existing connection.'),extensionAllowed:true};
  return {status:'active',code:'active',reason:'Your private script is active.',canRegenerate:false,scriptId:record.revision,revokedAt:null};
}
async function currentScriptUser(repo,user){
  const current=await repo.userById(user._id);
  if(!current?.active||current.authVersion!==user.authVersion){const e=new Error((current?.scriptRevocation?.reason||'Your account changed.')+' Please log in again.');e.status=401;throw e;}
  return current;
}
export async function captureScriptStatus(repo,user,panelOrigin) {
  const record=await repo.permanentScript(user._id);
  return scriptStatus(await currentScriptUser(repo,user),record,panelOrigin,(await captureSettings(repo)).requiresDynamicMatcher?7:6);
}
export async function readCaptureScript(repo,user,panelOrigin,scriptSecret,{forExtension=false}={}) {
  const record=await repo.permanentScript(user._id);user=await currentScriptUser(repo,user);const status=scriptStatus(user,record,panelOrigin,!forExtension&&(await captureSettings(repo)).requiresDynamicMatcher?7:6);
  if(status.status!=='active'){const e=new Error(status.reason);e.status=409;e.scriptStatus=status;throw e;}
  const script=openScript(record,scriptSecret);
  // Older v6 records predate the panelOrigin metadata field.
  const storedOrigin=record.panelOrigin||script.match(/"panelOrigin":"([^"\n]+)"/)?.[1];
  if(storedOrigin&&storedOrigin!==panelOrigin){const e=new Error('The panel address changed. Regenerate your script for the current address.');e.status=409;e.scriptStatus={status:'replacement-required',code:'panel-address-changed',reason:e.message,canRegenerate:true,scriptId:null,revokedAt:null};throw e;}
  return {script,scriptStatus:status,owner:{username:user.username,name:user.name},permanent:true,scriptId:record.revision,engineVersion:record.engineVersion,expiresAt:null};
}
export async function createCaptureScript(repo,user,panelOrigin,scriptSecret) {
  const previous=await repo.permanentScript(user._id),currentSettings=await captureSettings(repo),status=scriptStatus(user,previous,panelOrigin,currentSettings.requiresDynamicMatcher?7:6);
  if(status.status==='active'){
    try{return await readCaptureScript(repo,user,panelOrigin,scriptSecret);}catch(e){if(e.scriptStatus?.code!=='panel-address-changed')throw e;}
  }
  const migrationScript=status.code==='service-matcher-update'?openScript(previous,scriptSecret):'';
  const migrationKey=migrationScript.match(/"captureKey":"([a-f0-9]{64})"/)?.[1];
  if(status.code==='service-matcher-update'&&!migrationKey)throw new Error('Could not read your current capture connection.');
  const previousOrigin=previous?.panelOrigin||migrationScript.match(/"panelOrigin":"([^"\n]+)"/)?.[1];
  const retained=(!previousOrigin||previousOrigin===panelOrigin)?migrationKey:null;
  const token=retained||randomBytes(32).toString('hex');
  const candidate={_id:user._id,authVersion:user.authVersion,scriptVersion:scriptVersion(user),revision:randomUUID(),keyHash:hashToken(token),username:user.username,engineVersion:7,panelOrigin,createdAt:new Date()};
  candidate.ciphertext=sealScript(makeWebScript({panelOrigin,captureKey:token,username:user.username,bootstrapRules:currentSettings.rules}),candidate,scriptSecret);
  await repo.installPermanentScript(previous,candidate);
  const currentUser=await repo.userById(user._id);
  if(!currentUser?.active||currentUser.authVersion!==user.authVersion||scriptVersion(currentUser)!==scriptVersion(user)){
    const e=new Error('Your account or script changed during regeneration. Refresh and try again.');e.status=409;throw e;
  }
  return readCaptureScript(repo,currentUser,panelOrigin,scriptSecret);
}
async function resolveCapture(repo,packet,requireCapturePolicy=true) {
  const fail=(message,status=400)=>{const error=new Error(message);error.status=status;throw error;};
  if(!packet||![4,5,6].includes(packet.version)||!/^([a-f0-9]{64})$/.test(String(packet.captureKey||'')))fail('Invalid capture script. Copy your current script from the Railway panel.',401);
  const key=await repo.captureKey(hashToken(packet.captureKey));
  if(!key||(!key.permanent&&(!key.expiresAt||new Date(key.expiresAt)<=new Date())))fail('Capture script expired or revoked. Copy your current script from the panel.',401);
  const user=await repo.userById(key.ownerId);
  if(!user?.active||user.authVersion!==key.authVersion||scriptVersion(user)!==scriptVersion(key))fail((user?.scriptRevocation?.reason||'Capture access was revoked.')+' Log in to the panel and regenerate your script.',401);
  if(packet.version!==6||!key.permanent)fail('Copy the updated permanent script from your panel once to use the admin service selector.',426);
  const current=await captureSettings(repo);
  if(requireCapturePolicy&&current.requiresDynamicMatcher&&packet.matcherVersion!==2)fail('New services require the updated matcher. Regenerate the console script or download/reload the updated extension from your panel once.',426);
  if(requireCapturePolicy&&!current.configured)fail('The administrator must configure the main webpage first.',409);
  if(requireCapturePolicy&&!current.enabledServices.length)fail('Capturing is paused by the administrator. No services are enabled.',403);
  return {key,user,current,fail};
}
function validateSource(packet,requestOrigin,panelOrigin,current,fail) {
  const sourceOrigin=new URL(current.pagePattern).origin;
  if(requestOrigin&&requestOrigin!==sourceOrigin&&requestOrigin!==panelOrigin)fail('This website cannot use this capture script.',403);
  if(typeof packet.sourceUrl!=='string'||packet.sourceUrl.length>4000||!pageMatches(current.pagePattern,packet.sourceUrl))fail('This capture is from a different webpage.',403);
}
export async function extensionWorkflowConfiguration(repo,packet){
  const {user}=await resolveCapture(repo,packet,false);
  return {owner:{username:user.username,name:user.name},workflowUrls:await workflowSettings(repo)};
}
export async function extensionConfiguration(repo,packet) {
  const {user,current}=await resolveCapture(repo,packet);
  return {owner:{username:user.username,name:user.name},settings:{...current}};
}
export async function captureConfiguration(repo,packet,requestOrigin,panelOrigin) {
  const {user,current,fail}=await resolveCapture(repo,packet);validateSource(packet,requestOrigin,panelOrigin,current,fail);
  return {owner:{username:user.username,name:user.name},settings:{...current}};
}
export async function acceptCapture(repo,packet,requestOrigin,panelOrigin) {
  const {key,user,current,fail}=await resolveCapture(repo,packet);validateSource(packet,requestOrigin,panelOrigin,current,fail);
  if(!/^[a-f0-9-]{20,60}$/i.test(String(packet.batchId||'')))fail('Invalid capture ID.');
  if(!Array.isArray(packet.links)||packet.links.length>5000)fail('Invalid link list.');
  const unique=new Map();let selectedOccurrences=0,ignored=0;
  for(const item of packet.links){
    if(!item||typeof item.url!=='string')fail('Invalid reward link.');const link=matchRewardLink(item.url,current.rules);if(!link){if(packet.rawCandidates===true){ignored++;continue;}fail('An unsupported reward link was submitted.');}
    if(!current.enabledServices.includes(link.service)){ignored++;continue;}
    selectedOccurrences++;unique.set(link.url,{...link,label:String(item.label||'').slice(0,1000)});
  }
  const owner={username:user.username,name:user.name};
  const base={owner,id:packet.batchId,at:new Date().toISOString(),count:unique.size,added:0,duplicates:0,ignored};
  const present=new Set([...unique.values()].map(link=>link.service)),missing=current.enabledServices.filter(service=>!present.has(service));
  if(missing.length)return {...base,missing,level:'error',code:unique.size?'missing-services':'no-links',message:unique.size?'Missing required links: '+missing.join(', ')+'. Nothing saved.':'No enabled-service links found on this page. Nothing saved.'};
  const label=key.permanent?current.label:(String(packet.label||'Browser capture').trim().slice(0,150)||'Browser capture'),at=new Date().toISOString();
  const rows=[...unique.values()].map(link=>({_id:hashToken(user._id+'\0'+link.url),url:link.url,service:link.service,profile_id:'web-'+hashToken(label).slice(0,24),profile_name:label,account_name:'Web capture',label:link.label,source_url:packet.sourceUrl,title:String(packet.title||'').slice(0,1000),first_seen:at,last_seen:at,exported:false}));
  const added=await repo.captureWebLinks(user._id,rows,packet.batchId);
  const repeated=current.enabledServices.reduce((sum,service)=>sum+(Number.isInteger(packet.repeatedByService?.[service])&&packet.repeatedByService[service]>0?Math.min(5000,packet.repeatedByService[service]):0),0)+Math.max(0,selectedOccurrences-unique.size);
  const rawRepeated=packet.rawCandidates===true?[...unique.keys()].reduce((sum,url)=>sum+(Number.isInteger(packet.rawRepeatedByUrl?.[url])&&packet.rawRepeatedByUrl[url]>0?Math.min(5000,packet.rawRepeatedByUrl[url]):0),0):0;
  const duplicates=unique.size-added+repeated+rawRepeated;
  return {...base,added,duplicates,level:duplicates?(added?'warning':'error'):'success',code:duplicates?'duplicates':'saved',message:duplicates?(added?added+' new links saved. '+duplicates+' duplicate links skipped.':'Duplicate links found. '+duplicates+' already saved or repeated; nothing added.'):added+' new links saved. You can continue.'};
}
