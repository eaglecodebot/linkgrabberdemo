import {hostPattern} from './shared.js';
const ACTIVE=new Set(['running','paused','needs_access']);
let connectionPromise, busy=false;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export const grabIsRunning=()=>busy;
export function captureConnection(){
  return connectionPromise ||= fetch(chrome.runtime.getURL('capture-connection.json')).then(async r=>{
    if(!r.ok)throw new Error('Download your personalized extension from your Link Grabber panel first.');
    const c=await r.json();
    if(!/^[a-f0-9]{64}$/.test(c.captureKey)||!/^https?:\/\//.test(c.panelOrigin))throw new Error('This extension has no valid personal capture connection. Download it again from your panel.');
    return c;
  });
}
async function request(path,body){
  const c=await captureConnection();let r;
  try{r=await fetch(c.panelOrigin+'/api/extension/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:6,matcherVersion:2,captureKey:c.captureKey,...body}),signal:AbortSignal.timeout(12000)});}
  catch{throw new Error(path==='workflow'?'Cannot reach the Link Grabber panel to load workflow URLs. Check the connection and retry.':'Cannot reach the Link Grabber panel. Check the connection and retry. No save was confirmed.');}
  let data;try{data=await r.json();}catch{throw new Error('The Link Grabber server returned an invalid response. No save was confirmed.');}
  if(!r.ok)throw new Error(data.error||'Capture access failed. Download a fresh extension from your panel.');
  return data;
}
export async function workflowSetup(){return request('workflow',{});}
export async function grabSetup(){
  const {owner,settings}=await request('config',{});
  return {owner,settings};
}
export async function grabStatus(){
  const {grabRun}=await chrome.storage.local.get('grabRun');
  if(grabRun?.status==='running'&&!busy){
    const stopped={...grabRun,status:'error',level:'error',message:'The capture was interrupted. Check your panel history, then click Grab Links to retry.'};
    await chrome.storage.local.set({grabRun:stopped});return stopped;
  }
  return grabRun||null;
}
const matches=(pattern,url)=>new RegExp('^'+pattern.split('*').map(p=>p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*')+'$','i').test(url||'');
async function save(state){await chrome.storage.local.set({grabRun:state});}
async function notify(tabId,level,message){try{await chrome.scripting.executeScript({target:{tabId},files:['grabber-page.js']});await chrome.scripting.executeScript({target:{tabId},func:(level,message)=>globalThis.__linkGrabberPage.notify(level,message),args:[level,message]});}catch{}}
async function runCapture(tabId,workflowRun){
  let targetId;
  const state={id:crypto.randomUUID(),status:'running',level:'info',message:'Checking your capture connection…',at:Date.now()};
  try{
    if(ACTIVE.has(workflowRun?.status))throw new Error('Stop the current workflow before grabbing links.');
    await save(state);const setup=await grabSetup(),{settings,owner}=setup;
    const permission=hostPattern(settings.pagePattern);
    if(!await chrome.permissions.contains({origins:[permission]}))throw new Error('Website access is needed. Reopen the extension and click Grab Links to allow it.');
    const tabs=await chrome.tabs.query({currentWindow:true});
    let current=tabs.find(t=>t.id===tabId),target=matches(settings.pagePattern,current?.url)?current:tabs.find(t=>matches(settings.pagePattern,t.url));
    if(target){targetId=target.id;await chrome.tabs.update(targetId,{active:true});}
    else{
      const url=settings.pagePattern.replaceAll('*','');
      if(current){targetId=current.id;await chrome.tabs.update(targetId,{url,active:true});}
      else {target=await chrome.tabs.create({url,active:true});targetId=target.id;}
    }
    await save({...state,message:'Opening the capture page for '+owner.username+'…'});
    const deadline=Date.now()+30000;let ready=false;
    while(Date.now()<deadline){
      const tab=await chrome.tabs.get(targetId),lastUrl=tab.url||'';
      if(matches(settings.pagePattern,lastUrl)){
        try{const [doc]=await chrome.scripting.executeScript({target:{tabId:targetId},func:()=>document.readyState});if(doc?.result==='interactive'||doc?.result==='complete'){ready=true;break;}}catch{}
      }else if(tab.status==='complete'&&lastUrl&&lastUrl!=='about:blank'){
        // Give redirects time to settle, then explain a sign-in wall accurately.
        if(Date.now()>deadline-27000)throw new Error('The capture page redirected elsewhere. Sign in to the website, then click Grab Links again.');
      }
      await sleep(150);
    }
    if(!ready)throw new Error('The capture page did not become ready. Finish loading or signing in, then click Grab Links again.');
    await save({...state,tabId:targetId,message:'Collecting links for '+owner.username+'…'});
    await chrome.scripting.executeScript({target:{tabId:targetId},files:['grabber-decode.js','grabber-page.js']});
    const [snapshot]=await chrome.scripting.executeScript({target:{tabId:targetId},func:settings=>globalThis.__linkGrabberPage.collect(settings),args:[settings]});
    const packet=snapshot?.result;if(!packet||!matches(settings.pagePattern,packet.sourceUrl))throw new Error('The webpage changed during capture. Click Grab Links again.');
    const {result}=await request('capture',{...packet,batchId:state.id,startedAt:state.at});
    const message='Saving to '+result.owner.username+': '+result.message;
    await notify(targetId,result.level,message);
    await save({...state,status:result.level==='error'?'error':'done',level:result.level,message,tabId:targetId});
  }catch(e){
    if(targetId)await notify(targetId,'error',e.message);
    await save({...state,status:'error',level:'error',message:e.message,tabId:targetId});
  }finally{busy=false;}
}
export async function startGrab(tabId,workflowRun){
  if(busy)throw new Error('A link capture is already running.');
  if(ACTIVE.has(workflowRun?.status))throw new Error('Stop the current workflow before grabbing links.');
  busy=true;
  void runCapture(tabId,workflowRun);
  return {started:true};
}
