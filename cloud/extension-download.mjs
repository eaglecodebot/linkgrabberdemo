import { readFile, readdir } from 'node:fs/promises';
import JSZip from 'jszip';
import { readCaptureScript, captureSettings } from './capture.mjs';
import { hostPattern } from './extension-template/shared.js';

// Template files are bundled code. Only connection data varies by signed-in user.
export async function extensionDownload(repo,user,panelOrigin,secret) {
  const data=await readCaptureScript(repo,user,panelOrigin,secret);
  const captureKey=data.script.match(/"captureKey":"([a-f0-9]{64})"/)?.[1];
  if(!captureKey)throw new Error('Your script needs a replacement before downloading an extension.');
  const settings=await captureSettings(repo);
  if(!settings.configured)throw new Error('The administrator must configure the main webpage before downloading an extension.');
  const base=new URL('./extension-template/',import.meta.url),zip=new JSZip();
  for(const file of await readdir(base,{withFileTypes:true})){
    if(!file.isFile())continue;
    zip.file(file.name,await readFile(new URL(file.name,base)));
  }
  const manifest=JSON.parse(await readFile(new URL('manifest.json',base),'utf8'));
  manifest.host_permissions=[...new Set([hostPattern(panelOrigin),hostPattern(settings.pagePattern)])];
  zip.file('manifest.json',JSON.stringify(manifest,null,2)+'\n');
  zip.file('capture-connection.json',JSON.stringify({version:6,panelOrigin,captureKey,username:data.owner.username,pagePattern:settings.pagePattern},null,2)+'\n');
  // Use the production decoder directly; template and script stay consistent.
  const decoder=(await readFile(new URL('../src/decode.mjs',import.meta.url),'utf8')).split('export function decodeResult')[0].replaceAll('export ','');
  zip.file('grabber-decode.js','(() => {\n'+decoder+'\nglobalThis.__linkGrabberDecode={decodeLink,matchRewardLink};\n})();\n');
  zip.file('CAPTURE_SETUP.txt','PERSONAL LINK GRABBER EXTENSION\n\nConnected account: '+data.owner.username+'\n\nExtract this ZIP to its own folder. Open chrome://extensions, enable Developer mode,\nchoose Load unpacked and select the folder containing manifest.json.\n\nButtons: Trial | Grab Links | Cancel & Refund.\nGrab Links uses the admin-configured page and services, reuses a matching tab or\nopens the page in your current tab, then saves to your connected account.\nA new tab is created when there is no usable current tab. Sign in to the source\nwebsite if asked; click Grab Links again after signing in. No panel login needed.\nSuccess appears on the webpage only after the database confirms the save.\nDuplicate and missing-link errors also appear on the webpage and in the popup.\nThe page scan is immediate when links are ready, with up to 3 seconds for missing\nlinks. Opening/loading the source page and network saves can take longer.\n\nTreat this ZIP as private: it contains your capture key, but no panel password.\nPassword changes, account disablement and script revocation also revoke this\nextension connection. Regenerate your script in the panel, then download a new ZIP.\nReloading an old extension ZIP does not restore a revoked connection.\nFor an update, extract the new ZIP over the same installed folder and press Reload\non chrome://extensions. Existing workflow settings in this browser are retained.\n\nThe console script remains available as a separate option in your web panel.\n');
  const buffer=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
  // Recheck revocation and replacement after ZIP construction, before releasing it.
  const current=await readCaptureScript(repo,user,panelOrigin,secret);
  if(current.scriptId!==data.scriptId){const e=new Error('Your capture connection changed. Download the extension again.');e.status=409;throw e;}
  return {buffer,filename:'Private_Workflow_'+data.owner.username+'_v1_8_0.zip'};
}
