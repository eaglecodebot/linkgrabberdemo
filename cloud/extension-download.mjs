import JSZip from 'jszip';
import { readCaptureScript, captureSettings } from './capture.mjs';
import { hostPattern } from './extension-template/shared.js';
import { extensionRelease } from './extension-release.mjs';
import { workflowSettings, WORKFLOW_URL_FIELDS } from './workflow-settings.mjs';

// Template files are bundled code. Only connection data varies by signed-in user.
export async function extensionDownload(repo,user,panelOrigin,secret) {
  const data=await readCaptureScript(repo,user,panelOrigin,secret);
  const captureKey=data.script.match(/"captureKey":"([a-f0-9]{64})"/)?.[1];
  if(!captureKey)throw new Error('Your script needs a replacement before downloading an extension.');
  const settings=await captureSettings(repo);
  if(!settings.configured)throw new Error('The administrator must configure the main webpage before downloading an extension.');
  const release=await extensionRelease(),zip=new JSZip(),urls=await workflowSettings(repo);
  for(const [file,bytes] of release.files)zip.file(file,bytes);
  const manifest=structuredClone(release.manifest);
  manifest.host_permissions=[...new Set([hostPattern(panelOrigin),hostPattern(settings.pagePattern),...WORKFLOW_URL_FIELDS.filter(field=>urls[field]).map(field=>hostPattern(urls[field])),...urls.trialAlternateUrls.map(hostPattern)])];
  zip.file('manifest.json',JSON.stringify(manifest,null,2)+'\n');
  zip.file('capture-connection.json',JSON.stringify({version:6,panelOrigin,captureKey,username:data.owner.username,pagePattern:settings.pagePattern},null,2)+'\n');
  const workflow=JSON.parse(release.files.get('workflow.json').toString());
  zip.file('workflow.json',JSON.stringify({...workflow,...urls,managedWorkflowUrls:true},null,2)+'\n');
  zip.file('CAPTURE_SETUP.txt','PERSONAL LINK GRABBER EXTENSION\n\nConnected account: '+data.owner.username+'\n\nExtract this ZIP to its own folder. Open chrome://extensions, enable Developer mode,\nchoose Load unpacked and select the folder containing manifest.json.\n\nButtons: Trial | Grab Links | Cancel & Refund.\nGrab Links uses the admin-configured page and services, reuses a matching tab or\nopens the page in your current tab, then saves to your connected account.\nA new tab is created when there is no usable current tab. Sign in to the source\nwebsite if asked; click Grab Links again after signing in. No panel login needed.\nSuccess appears on the webpage only after the database confirms the save.\nDuplicate and missing-link errors also appear on the webpage and in the popup.\nThe page scan is immediate when links are ready, with up to 3 seconds for missing\nlinks. Opening/loading the source page and network saves can take longer.\n\nTreat this ZIP as private: it contains your capture key, but no panel password.\nPassword changes, account disablement and script revocation also revoke this\nextension connection. Regenerate your script in the panel, then download a new ZIP.\nReloading an old extension ZIP does not restore a revoked connection.\nFor an update, extract the new ZIP over the same installed folder and press Reload\non chrome://extensions. Other workflow settings in this browser are retained. Workflow URLs, including Trial alternate starting pages,\nare managed by your web-panel administrator and refresh on each workflow start.\n\nThe console script remains available as a separate option in your web panel.\n');
  const buffer=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
  // Recheck revocation and replacement after ZIP construction, before releasing it.
  const current=await readCaptureScript(repo,user,panelOrigin,secret);
  if(current.scriptId!==data.scriptId){const e=new Error('Your capture connection changed. Download the extension again.');e.status=409;throw e;}
  return {buffer,release:{id:release.id,version:release.version},filename:'Private_Workflow_'+data.owner.username+'_v'+release.version.replaceAll('.','_')+'.zip'};
}
