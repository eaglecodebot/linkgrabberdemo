import { pageMatches } from './rules.mjs';
import { decodeLink, matchRewardLink } from './decode.mjs';

// This self-contained script is encrypted in MongoDB once, then returned exactly
// as stored. Page settings and owner identity are validated online on every run.
export function captureOnWeb(config, consoleCopy) {
  const namespace='__linkGrabberWebV6';
  try{window[namespace]?.stop();window.__linkGrabberWebV5?.stop();window.__linkGrabberWebV4?.stop();}catch{}
  const runId=typeof crypto.randomUUID==='function'?crypto.randomUUID():[...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,'0')).join('');
  const startedAt=Date.now();
  let stopped=false,settings=null,owner=config.username,mode='direct',popup=null,packet=null,observer,scanTimer,poll,deadline;
  const host=document.createElement('div');host.id='link-grabber-result-v6';
  Object.assign(host.style,{position:'fixed',bottom:'20px',right:'20px',width:'390px',maxWidth:'calc(100vw - 40px)',zIndex:'2147483647',borderRadius:'12px',padding:'18px',color:'#f1f5f9',background:'#172436',border:'1px solid #49607a',boxShadow:'0 8px 30px #0006',font:'14px/1.5 system-ui,sans-serif',boxSizing:'border-box'});
  host.setAttribute('role','status');host.setAttribute('aria-live','polite');
  const ownerLine=document.createElement('strong'),heading=document.createElement('strong'),message=document.createElement('div'),actions=document.createElement('div');
  Object.assign(ownerLine.style,{display:'block',paddingBottom:'9px',marginBottom:'9px',borderBottom:'1px solid #ffffff44',fontSize:'16px'});
  Object.assign(heading.style,{display:'block',marginBottom:'6px'});Object.assign(actions.style,{display:'flex',gap:'8px',flexWrap:'wrap',marginTop:'12px'});
  host.append(ownerLine,heading,message,actions);(document.body||document.documentElement).append(host);
  function identify(value){if(value&&typeof value.username==='string')owner=value.username;ownerLine.textContent='Saving to: '+owner;}
  function button(text,fn){const b=document.createElement('button');b.type='button';b.textContent=text;Object.assign(b.style,{cursor:'pointer',padding:'7px 10px',borderRadius:'6px',border:'1px solid #ffffff66',background:'#ffffff15',color:'#fff',font:'12px system-ui'});b.onclick=fn;actions.append(b);}
  function stopScanning(){clearTimeout(scanTimer);clearTimeout(deadline);clearInterval(poll);observer?.disconnect();}
  function stop(){stopped=true;stopScanning();window.removeEventListener('message',receive);host.remove();}
  function show(level,title,text){if(stopped)return;identify();const colors={success:['#154d39','#448969'],error:['#662c32','#b8666d'],warning:['#624719','#b18d42'],info:['#172436','#49607a']};const c=colors[level]||colors.info;host.style.background=c[0];host.style.borderColor=c[1];host.dataset.level=level;heading.textContent=title;message.textContent=text;actions.replaceChildren();button('Close',stop);}
  function finish(result){if(stopped)return;identify(result.owner);stopScanning();show(result.level,result.code==='duplicates'?'Duplicate links found':result.level==='error'?'Capture error':'Links saved',result.message);if(result.code==='save-unconfirmed')button('Retry save window',()=>openSaveWindow(packet?'save':'setup'));}
  function collect(){
    const links=new Map(),repeatedByService={};const rules=settings?.rules||config.bootstrapRules;
    for(const a of document.querySelectorAll('a[href]')){
      const raw=a.getAttribute('href');if(!raw)continue;let absolute;try{absolute=new URL(raw,document.baseURI).href;}catch{continue;}
      const decoded=matchRewardLink(absolute,rules);if(!decoded||settings&&!settings.enabledServices.includes(decoded.service))continue;
      if(links.has(decoded.url))repeatedByService[decoded.service]=Math.min(5000,(repeatedByService[decoded.service]||0)+1);
      links.set(decoded.url,{url:decoded.url,service:decoded.service,label:(a.innerText||a.textContent||decoded.service).replace(/\s+/g,' ').trim().slice(0,1000)});if(links.size>=5000)break;
    }
    return{links:[...links.values()],repeatedByService};
  }
  function missingServices(value){const present=new Set(value.links.map(link=>link.service));return settings.enabledServices.filter(service=>!present.has(service));}
  function snapshot(){return{version:6,captureKey:config.captureKey,batchId:runId,startedAt,sourceUrl:location.href,title:document.title.slice(0,1000),username:owner,...collect()};}
  function bounded(value){return new TextEncoder().encode(JSON.stringify(value)).length<=2*1024*1024;}
  async function request(path,value,timeoutMs){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);try{const response=await fetch(config.panelOrigin+'/api/'+path,{method:'POST',mode:'cors',credentials:'omit',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify(value),signal:controller.signal});const data=await response.json();if(!response.ok){const e=new Error(data.error||'The request was rejected.');e.server=true;throw e;}return data;}finally{clearTimeout(timer);}}
  function manualCopy(){const value=packet||snapshot();if(!bounded(value)){show('error','Capture too large','The capture exceeds 2 MiB. Nothing confirmed saved.');return;}const text='LG_WEB_V6:'+JSON.stringify(value);if(typeof consoleCopy==='function'){try{consoleCopy(text);show('warning','Capture packet copied','Paste it into Manual capture handoff in your Railway panel and confirm the result there.');return;}catch{}}
    if(navigator.clipboard?.writeText)navigator.clipboard.writeText(text).then(()=>show('warning','Capture packet copied','Paste it into Manual capture handoff in your Railway panel and confirm the result there.')).catch(()=>show('error','Copy unavailable','Rerun from Developer Tools Console or allow this page to copy to the clipboard.'));
    else show('error','Copy unavailable','Run this script in Developer Tools Console, where copy() is available.');}
  function openSaveWindow(phase){if(stopped)return;const value=packet||snapshot();if(!bounded(value)){show('error','Capture too large','The capture exceeds 2 MiB. Nothing confirmed saved.');return;}const fragment=encodeURIComponent(JSON.stringify({...value,phase:phase||'setup'}));if(fragment.length>120000){show('warning','Manual handoff required','This capture is too large for the save window. Copy its packet and import it through your panel.');button('Copy capture packet',manualCopy);return;}
    popup=window.open(config.panelOrigin+'/capture#'+fragment,'_blank','popup,width=540,height=680');
    if(!popup){show('warning','Open save window','The browser blocked automatic opening. Click below to load current settings and save through Railway.');button('Open save window',()=>openSaveWindow(phase));button('Copy capture packet',manualCopy);return;}
    show('info','Save window opened','Confirm the result in that window. It will return here if the browser permits window messaging.');button('Open save window again',()=>openSaveWindow(packet?'save':'setup'));button('Copy capture packet',manualCopy);
  }
  async function submit(value){if(stopped||packet)return;packet=value;stopScanning();if(!bounded(packet)){show('error','Capture too large','The capture exceeds 2 MiB. Nothing was sent.');return;}
    show('info','Saving links','Waiting for MongoDB to confirm saving and duplicate checks…');
    if(mode==='bridge'){try{if(!popup||popup.closed)throw new Error('closed');popup.postMessage({type:'LG_CAPTURE_V6',batchId:runId,packet},config.panelOrigin);return;}catch{openSaveWindow('save');return;}}
    try{const data=await request('capture',packet,6000);finish(data.result);}catch(e){if(stopped)return;if(e.server){show('error','Capture error',e.message);button('Retry in save window',()=>openSaveWindow('save'));}else openSaveWindow('save');}
  }
  function scan(final=false){if(stopped||packet||!settings)return;if(!pageMatches(settings.pagePattern,location.href)){stopScanning();show('error','Wrong webpage','Open the currently configured main webpage and run the same script there.');return;}
    const value=snapshot(),missing=missingServices(value);
    if(missing.length&&!final){message.textContent='Waiting for: '+missing.join(', ')+'. Checking for up to three seconds…';return;}
    if(missing.length&&mode==='direct'){stopScanning();show('error',value.links.length?'Some links are missing':'No links found',value.links.length?'Missing required links: '+missing.join(', ')+'. Nothing saved.':'No enabled-service links found on this page. Nothing saved.');return;}
    void submit(value);
  }
  function configure(data,nextMode){if(stopped||packet)return;identify(data.owner);if(!data.settings||typeof data.settings.pagePattern!=='string'||!Array.isArray(data.settings.enabledServices)||!Array.isArray(data.settings.rules)){show('error','Configuration error','Current page settings could not be read. Check your panel.');return;}
    mode=nextMode;if(settings)return;settings=data.settings;show('info','Current settings loaded','Looking for your matching reward links…');
    observer=new MutationObserver(records=>{if(records.some(r=>!host.contains(r.target))){clearTimeout(scanTimer);scanTimer=setTimeout(()=>scan(),150);}});observer.observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['href']});
    poll=setInterval(()=>scan(),1000);deadline=setTimeout(()=>scan(true),Math.max(0,3000-(Date.now()-startedAt)));scanTimer=setTimeout(()=>scan(),150);
  }
  function receive(event){if(stopped||event.origin!==config.panelOrigin||event.source!==popup||event.data?.batchId!==runId)return;
    if(event.data.type==='LG_CONFIG_V6'){try{popup.postMessage({type:'LG_CONFIG_ACK_V6',batchId:runId},config.panelOrigin);}catch{}configure(event.data,'bridge');}
    if(event.data.type==='LG_RESULT_V6'){const r=event.data.result;if(!r||!['success','warning','error'].includes(r.level)||typeof r.message!=='string'||r.message.length>1000)return;finish(r);try{popup.postMessage({type:'LG_ACK_V6',batchId:runId},config.panelOrigin);}catch{}}
  }
  window[namespace]={stop};window.addEventListener('message',receive);identify();show('info','Loading current settings','Checking this script and account with Railway…');
  void request('capture-config',{version:6,captureKey:config.captureKey,sourceUrl:location.href},2000).then(data=>configure(data,'direct')).catch(e=>{if(stopped)return;if(e.server)show('error','Capture error',e.message);else openSaveWindow('setup');});
  return 'Permanent Link Grabber started. Confirm Saving to: '+owner+' and wait for the result.';
}
export function makeWebScript(config){return '// Link Grabber Web v6 — private permanent script for '+config.username+'.\n'+'// Reusable until explicitly revoked, the password changes, or the account is disabled.\n'+`(() => {\n${pageMatches.toString()}\n${decodeLink.toString()}\n${matchRewardLink.toString()}\nreturn (${captureOnWeb.toString()})(${JSON.stringify(config)},typeof copy==='function'?copy:null);\n})();`;}
