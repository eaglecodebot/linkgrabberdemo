// Test-only chrome.* bridge. Frame IDs/documents, site access, and frame-targeted
// injection/messages are modeled separately; cross-origin DOM stays browser-enforced.
const fs=require('node:fs/promises');
const path=require('node:path');
const vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const {webcrypto}=require('node:crypto');
const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn)}});
module.exports=async function bridge(context,root,uiOrigin){
  const config=JSON.parse(await fs.readFile(path.join(root,'workflow.json'),'utf8'));
  const manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
  const source=(await fs.readFile(path.join(root,'background.js'),'utf8')).replace(/^import .*?;\n/gm,'');
  const engine=await fs.readFile(path.join(root,'engine.js'),'utf8'),content=await fs.readFile(path.join(root,'content.js'),'utf8');
  const shared=await import(pathToFileURL(path.join(root,'shared.js')));
  const store={},tabs=new Map(),ids=new WeakMap(),frames=new WeakMap(),grants=new Set(),navigationUpdates=[];
  let nextTab=1,nextFrame=1,registry=[],chrome,activeId,reads=0;
  const began=Date.now();
  const clone=v=>structuredClone(v);
  function tab(page){if(ids.has(page))return ids.get(page);const id=nextTab++;ids.set(page,id);tabs.set(id,page);activeId=id;page.on('pageerror',e=>console.log('PAGE ERROR:',e.message));return id;}
  function frame(sourceFrame){let rec=frames.get(sourceFrame);if(!rec){rec={frameId:sourceFrame.parentFrame()?nextFrame++:0,documentId:null,frame:sourceFrame};frames.set(sourceFrame,rec);}return rec;}
  function info(sourceFrame){const r=frame(sourceFrame);return {frameId:r.frameId,parentFrameId:sourceFrame.parentFrame()?frame(sourceFrame.parentFrame()).frameId:-1,documentId:r.documentId,url:sourceFrame.url()};}
  function frameList(tabId){return tabs.get(tabId)?.frames().map(info)||[];}
  function sourceFor(tabId,frameId){return tabs.get(tabId)?.frames().find(f=>frame(f).frameId===frameId);}
  function tabList(query={}) {return [...tabs].filter(([id,p])=>!p.isClosed()&&(!query.active||id===activeId)).map(([id,p])=>({id,url:p.url(),active:id===activeId,windowId:1}));}
  function permitted(sourceFrame){let f=sourceFrame;while(f){try{const u=new URL(f.url());if(['http:','https:'].includes(u.protocol))return grants.has(`${u.protocol}//${u.hostname}/*`);}catch{}f=f.parentFrame();}return false;}
  const dispatch=(msg,sender)=>new Promise(resolve=>chrome.runtime.onMessage.listeners[0](msg,sender,resolve));
  async function notify(changes){await Promise.allSettled([...tabs.values()].filter(p=>!p.isClosed()).map(p=>p.evaluate(changes=>{for(const fn of globalThis.__storageListeners||[])fn(changes,'local')},changes)));}
  function reloadWorker(){
    chrome={runtime:{id:'test-extension',getURL:p=>'chrome-extension://test-extension/'+p,getManifest:()=>manifest,onMessage:event(),onStartup:event(),onInstalled:event()},
      storage:{local:{get:async key=>{reads++;return typeof key==='string'?{[key]:clone(store[key])}:clone(store)},set:async values=>{
        const changes={};for(const[key,value]of Object.entries(values)){changes[key]={oldValue:clone(store[key]),newValue:clone(value)};store[key]=clone(value);}await notify(changes);
        if(process.env.DEBUG_WORKFLOW&&values.run)console.log('RUN',Date.now()-began,values.run.index,values.run.phase,values.run.status,values.run.message);
      },remove:async key=>{delete store[key]},setAccessLevel:async()=>{}}},
      permissions:{contains:async({origins})=>origins.every(o=>grants.has(o))},
      action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},alarms:{create:async()=>{},clear:async()=>{},onAlarm:event()},
      scripting:{getRegisteredContentScripts:async()=>registry,registerContentScripts:async entries=>{registry=entries},updateContentScripts:async entries=>{registry=entries},unregisterContentScripts:async()=>{registry=[]},executeScript:async({target,files,func})=>{
        const results=[];for(const frameId of target.frameIds||[0]){const f=sourceFor(target.tabId,frameId);if(!f||!permitted(f))throw Error('Missing website access or frame');
          if(func){results.push({frameId,result:await f.evaluate(func)});continue;}
          for(const name of files)await f.evaluate(await fs.readFile(path.join(root,name),'utf8'));
          results.push({frameId,documentId:frame(f).documentId});
        }return results;
      }},
      tabs:{create:async({url})=>{const p=await context.newPage(),id=tab(p);await p.goto(url);return{id}},query:async query=>tabList(query),get:async id=>{const item=tabList().find(t=>t.id===id);if(!item)throw Error('Tab closed');return item;},update:async(id,{url,active})=>{if(active)activeId=id;if(url){navigationUpdates.push({tabId:id,url});tabs.get(id).goto(url).catch(()=>{});}return{id}},
        sendMessage:async(id,msg,options={})=>{const f=sourceFor(id,options.frameId??0);if(!f)throw Error('Frame unavailable');return await f.evaluate(msg=>new Promise(resolve=>{let matched=false;for(const fn of globalThis.__runtimeListeners||[]){matched=true;fn(msg,{},resolve)}if(!matched)resolve();}),msg)},onRemoved:event()},
      webNavigation:{getAllFrames:async({tabId})=>frameList(tabId),getFrame:async({tabId,frameId})=>{const f=sourceFor(tabId,frameId);return f?info(f):null},
        onCommitted:event(),onDOMContentLoaded:event(),onCompleted:event(),onHistoryStateUpdated:event(),onReferenceFragmentUpdated:event(),onCreatedNavigationTarget:event()}};
    vm.runInNewContext(source,{...shared,grabIsRunning:()=>false,grabStatus:async()=>null,grabSetup:async()=>({owner:{username:'test'},settings:{pagePattern:'https://private.example/'}}),startGrab:async()=>({started:true}),chrome,crypto:webcrypto,URL,Date,console,fetch:async()=>({json:async()=>clone(config)})},{filename:'background.js'});
  }
  reloadWorker();context.on('page',tab);
  await context.exposeBinding('__extensionBridge',async(source,{type,payload,documentId})=>{
    const page=source.page,id=tab(page),f=source.frame,r=frame(f);
    if(type==='boot'){
      if(r.documentId!==documentId){r.documentId=documentId;for(const fn of chrome.webNavigation.onCommitted.listeners)fn({...info(f),tabId:id});}
      return registry.length>0&&permitted(f);
    }
    if(type==='domReady'){for(const fn of chrome.webNavigation.onDOMContentLoaded.listeners)fn({...info(f),tabId:id});return;}
    if(type==='history'){for(const fn of chrome.webNavigation.onHistoryStateUpdated.listeners)fn({...info(f),tabId:id});return;}
    if(type==='grant'){for(const o of payload.origins)grants.add(o);return true;}
    if(type==='queryTabs')return tabList(payload);
    if(type==='options'){const p=await context.newPage();await p.goto(uiOrigin+'/__extension/options.html');return;}
    if(type==='message'){
      const isUI=f.url().startsWith(uiOrigin+'/__extension/');
      const sender={id:'test-extension',url:isUI?'chrome-extension://test-extension/'+f.url().split('/').at(-1):f.url(),frameId:r.frameId,documentId,documentLifecycle:'active',...(isUI?{}:{tab:{id,url:page.url()}})};
      const result=await dispatch(payload,sender);
      if(process.env.DEBUG_WORKFLOW&&payload.type==='BIND_FRAME')console.log('BIND',r.frameId,result);
      return result;
    }
  });
  await context.addInitScript(({engine,content})=>{
    const documentId=Math.random().toString(36).slice(2)+Date.now();
    globalThis.__runtimeListeners=[];globalThis.__storageListeners=[];
    const bridge=(type,payload)=>__extensionBridge({type,payload,documentId});
    globalThis.chrome={runtime:{id:'test-extension',getURL:p=>'chrome-extension://test-extension/'+p,sendMessage:payload=>bridge('message',payload),onMessage:{addListener:fn=>__runtimeListeners.push(fn)},openOptionsPage:()=>bridge('options')},
      storage:{onChanged:{addListener:fn=>__storageListeners.push(fn)}},permissions:{request:payload=>bridge('grant',payload)},tabs:{query:payload=>bridge('queryTabs',payload)}};
    document.addEventListener('DOMContentLoaded',()=>bridge('domReady'),{once:true});
    for(const name of ['pushState','replaceState']){const original=history[name];history[name]=function(...args){const result=original.apply(this,args);bridge('history');return result;};}
    bridge('boot').then(allowed=>{if(allowed&&!location.pathname.startsWith('/__extension/')){eval(engine);eval(content);}});
  },{engine,content});
  return {store,tabs,ids,config,reloadWorker,navigationUpdates,reads:()=>reads,registry:()=>registry};
};
