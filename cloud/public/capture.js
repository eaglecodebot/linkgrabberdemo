// Fragment data never becomes a server URL/referrer; remove it before requests.
let packet=null,result=null,busy=false,sourceOrigin='',connected=false,configTimer,fallbackTimer,lastOwner='';
const fragment=location.hash.slice(1);history.replaceState(null,'','/capture');
const message=document.getElementById('capture-result'),retry=document.getElementById('retry'),ownerLine=document.getElementById('capture-owner');
function identify(owner){if(owner&&typeof owner.username==='string')lastOwner=owner.username;ownerLine.textContent='Saving to: '+(lastOwner||'verifying account…');}
function display(level,text){document.body.dataset.result=level;message.className='capture-result '+level;message.textContent=text;identify();}
function publish(value){try{window.opener?.postMessage({type:'LG_RESULT_V'+packet.version,batchId:packet.batchId,result:value},sourceOrigin);}catch{}}
try{
 if(!fragment||fragment.length>120000)throw new Error('No valid capture was provided. Run your script on the source page.');
 packet=JSON.parse(decodeURIComponent(fragment));sourceOrigin=new URL(packet.sourceUrl).origin;lastOwner=String(packet.username||'');
 if(!['http:','https:'].includes(new URL(sourceOrigin).protocol))throw new Error('Invalid source webpage.');
}catch(e){packet=null;display('error',e.message);}
window.addEventListener('message',event=>{
 if(!packet||event.source!==window.opener||event.origin!==sourceOrigin||event.data?.batchId!==packet.batchId)return;
 if(event.data.type==='LG_ACK_V'+packet.version)setTimeout(()=>window.close(),350);
 if(event.data.type==='LG_CONFIG_ACK_V6'){connected=true;clearInterval(configTimer);clearTimeout(fallbackTimer);}
 if(event.data.type==='LG_CAPTURE_V6'){
  const next=event.data.packet;
  if(next?.version!==6||next.captureKey!==packet.captureKey||next.batchId!==packet.batchId)return;
  connected=true;clearInterval(configTimer);clearTimeout(fallbackTimer);packet=next;void save();
 }
});
async function post(path,value){const response=await fetch('/api/'+path,{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify(value),signal:AbortSignal.timeout(15000)});const data=await response.json();if(!response.ok)throw new Error(data.error||'Capture could not be confirmed. Retry or check history.');return data;}
async function save(){
 if(!packet||busy)return;busy=true;retry.hidden=true;display('info','Saving to your private cloud history…');
 try{
  const data=await post('capture',packet);result=data.result;identify(result.owner);display(result.level,result.message);
  document.getElementById('capture-count').textContent=result.count+' matching · '+result.added+' new · '+result.duplicates+' duplicate/repeated';publish(result);
 }catch(e){display('error',e.message||'The save could not be confirmed. Retry this capture and check history.');retry.hidden=false;publish({level:'error',code:'save-unconfirmed',message:message.textContent,owner:{username:lastOwner}});}
 finally{busy=false;}
}
async function setup(){
 display('info','Loading current page settings…');
 try{
  const config=await post('capture-config',{version:6,matcherVersion:packet.matcherVersion,captureKey:packet.captureKey,sourceUrl:packet.sourceUrl});identify(config.owner);
  display('info','Waiting for the source page to send its current links…');
  const send=()=>{try{window.opener?.postMessage({type:'LG_CONFIG_V6',batchId:packet.batchId,...config},sourceOrigin);}catch{}};
  if(window.opener){send();configTimer=setInterval(send,300);}
  const present=new Set((packet.links||[]).map(link=>link.service));
  const enough=config.settings.enabledServices.every(service=>present.has(service)),remaining=Math.max(0,3000-(Date.now()-Number(packet.startedAt||Date.now())));
  const delay=window.opener?(enough?900:Math.max(900,remaining)):(enough?0:remaining);
  fallbackTimer=setTimeout(()=>{clearInterval(configTimer);if(!connected)void save();},delay);
 }catch(e){display('error',e.message);publish({level:'error',code:'access-denied',message:e.message,owner:{username:lastOwner}});}
}
retry.onclick=()=>void save();document.getElementById('close').onclick=()=>window.close();
if(packet){identify();if(packet.version===6&&packet.phase==='setup')void setup();else void save();}
