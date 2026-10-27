const http = require('node:http');
const events = [];
let alternateOrigin, frameOrigin;
let slowDelivered = false;
const offer = 'Access exclusive tools & insights Try Premium for ₹0';
const wrapper = body => `<!doctype html><html><meta charset="utf-8"><title>Workflow test</title><style>body{font:16px system-ui;padding:30px}button,a,label,input{margin:12px;padding:12px}label{display:inline-block}button{cursor:pointer}form{padding:20px;background:#eee}input[type=radio],input[type=checkbox]{width:20px;height:20px}.hidden-choice{position:absolute!important;opacity:0!important;width:1px!important;height:1px!important;clip-path:inset(50%)}iframe{width:100%;height:650px;border:1px solid #bbb}</style><body>${body}<script>const recordStep=(name,value)=>fetch('/event',{method:'POST',body:JSON.stringify({name,value})});</script></body></html>`;
const pricing = `<label for="premium-pricing-modal__card-0">Individual<input class="hidden-choice" id="premium-pricing-modal__card-0" name="premium-pricing-modal__card-selection" type="radio" value="0"></label><label for="other-plan">Another plan<input id="other-plan" name="premium-pricing-modal__card-selection" type="radio" value="1" checked></label><button data-view-name="premium-chooser-pricing-modal-cta" disabled>Confirm</button>`;
const pricingScript = `document.querySelector('#premium-pricing-modal__card-0').onchange=()=>{recordStep('individual');document.querySelector('[data-view-name="premium-chooser-pricing-modal-cta"]').disabled=false};document.querySelector('[data-view-name="premium-chooser-pricing-modal-cta"]').onclick=()=>{recordStep('confirm-individual');if(window===window.top)location.href='/checkout';else window.parent.postMessage({kind:'fixture_checkout'},'*')};`;
function route(req, res) {
  if (req.url === '/event') { let body=''; req.on('data', b=>body+=b); req.on('end',()=>{events.push(JSON.parse(body));res.end('ok');});return; }
  if (req.url === '/qr-image') {setTimeout(()=>{res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="white"/><path d="M20 20h60v60H20zm140 0h60v60h-60zM20 160h60v60H20z" fill="black"/></svg>');},600);return;}
  if(req.url==='/slow-resource'){slowDelivered=false;setTimeout(()=>{slowDelivered=true;res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>')},6000);return;}
  res.setHeader('Content-Type','text/html; charset=utf-8');
  let body='';
  switch(req.url) {
    case '/start': case '/cross-start': case '/cross-frame-start': case '/direct-start': case '/slow-start': case '/tooltip-start': case '/frame-tooltip-start': {
      const dest=req.url==='/cross-start'?`${alternateOrigin}/survey-shell`:req.url==='/cross-frame-start'?'/cross-frame-shell':req.url==='/direct-start'?'/direct-survey':req.url==='/slow-start'?'/slow-shell':req.url==='/tooltip-start'?'/tooltip-shell':req.url==='/frame-tooltip-start'?'/frame-tooltip-shell':'/survey-shell';
      body=`<div id="mount"></div><script>setTimeout(()=>{const a=document.createElement('a');a.href=${JSON.stringify(dest)};a.innerHTML='<div><p>Access exclusive tools &amp; insights</p><p>Try Premium for ₹0</p></div>';a.onclick=()=>recordStep('premium');document.querySelector('#mount').append(a)},500);</script>`;break;
    }
    case '/survey-shell': case '/cross-frame-shell': case '/slow-shell': case '/tooltip-shell': case '/frame-tooltip-shell': {
      const frameSrc=req.url==='/cross-frame-shell'?frameOrigin+'/survey':req.url==='/slow-shell'?'/slow-survey':req.url==='/frame-tooltip-shell'?frameOrigin+'/frame-tooltip-survey':'/survey';
      body=`<p>Top-level controls are deliberate decoys.</p><input type="checkbox" id="outside-other" data-test-text-selectable-option__input="Other"><label for="outside-other">Other</label><button onclick="recordStep('WRONG_OUTSIDE_NEXT')">Next</button><iframe data-testid="interop-iframe" src="${frameSrc}"></iframe><script>window.addEventListener('message',e=>{if(e.source===document.querySelector('iframe').contentWindow&&e.data?.kind==='fixture_checkout')location.href='/checkout'});</script>`;break;
    }
    case '/survey': case '/slow-survey': case '/direct-survey': case '/frame-tooltip-survey': {
      const career=req.url==='/direct-survey'?'/direct-career':'/career';
      const image=req.url==='/slow-survey'?'<img src="/slow-resource" alt="" onload="document.querySelector(\'button\').disabled=false">':'';
      const nextDisabled=req.url==='/slow-survey'?'true':'false';
      body=`<form><input class="hidden-choice" type="checkbox" id="random-survey" data-test-text-selectable-option__input="Other"><label for="random-survey">Other</label><button type="button" id="ember${Math.random()}" disabled>Next</button></form><script>document.querySelector('input').onchange=()=>{recordStep('other');document.querySelector('button').disabled=${nextDisabled}};document.querySelector('button').onclick=()=>{recordStep('next');location.href=${JSON.stringify(career)}};</script>${image}`;break;
    }
    case '/career': case '/direct-career':
      body=`<button aria-label="Learn more about Business">Learn more</button><button aria-label="Learn more about Career" id="ember${Math.random()}">Learn more</button><script>document.querySelector('[aria-label="Learn more about Career"]').onclick=()=>{recordStep('career');history.pushState({},'', '/plan');document.body.innerHTML='<button data-view-name="premium-checkout-primary-cta-action">Redeem 1 month for ₹0</button><form><div><button type="button" role="link" data-view-name="premium-checkout-primary-cta-action">Redeem 1 month for ₹0</button></div></form>';document.querySelector('body > button').onclick=()=>recordStep('WRONG_REDEEM');document.querySelector('form button').onclick=()=>{recordStep('redeem');history.pushState({},'', '/pricing');document.body.innerHTML=${JSON.stringify(pricing)};${pricingScript}}};</script>`;break;
    case '/pricing':body=pricing+`<script>${pricingScript}</script>`;break;
    case '/checkout': case '/lazy-checkout': case '/delayed-final':
      body=`<section><input class="hidden-choice" data-test-billing-cycle-card-radio-button="MONTHLY" type="radio" id="monthly" name="billing"><label for="monthly">Monthly</label></section><label for="unrelated">Zip code</label><input id="unrelated" type="text" value="KEEP_ME"><button aria-expanded="false" id="upi"><div data-test-upi-panel-header>UPI</div></button><form id="upi-form" hidden><input class="hidden-choice" id="upi-qr-code-button" name="upi-payment-option" type="radio" value="QR_CODE"><label for="upi-qr-code-button">QR Code</label><label for="reference">Reference</label><input id="reference" type="text" value="LEAVE_THIS"><div id="fields"></div><button data-test-save-upi-button type="submit">Continue</button></form><div id="final"></div><script>document.querySelector('#monthly').onchange=()=>recordStep('monthly');document.querySelector('#upi').onclick=()=>{recordStep('upi');document.querySelector('#upi').setAttribute('aria-expanded','true');document.querySelector('form').hidden=false};document.querySelector('#upi-qr-code-button').onchange=()=>{recordStep('qr');setTimeout(()=>{const id='input-uid-ember'+Math.floor(Math.random()*100000);document.querySelector('#fields').innerHTML='<label for="'+id+'">Pin code</label><input inputmode="text" type="text" required id="'+id+'">'},700)};document.querySelector('form').onsubmit=e=>{e.preventDefault();const pin=document.querySelector('#fields input').value;if(document.querySelector('#unrelated').value!=='KEEP_ME'||document.querySelector('#reference').value!=='LEAVE_THIS')recordStep('WRONG_FIELD');recordStep('continue',pin);document.querySelector('form').hidden=true;document.querySelector('#upi').hidden=true;document.querySelector('#final').innerHTML='<button type="button" data-test-place-order-btn>Start my free trial</button>';document.querySelector('[data-test-place-order-btn]').onclick=()=>{recordStep('finish');setTimeout(()=>location.href='/done',50)}};</script>`;break;
    case '/invalid-final':
      body=`<form><label for="required-email">Required email</label><input id="required-email" type="email" required><button type="submit" data-test-place-order-btn>Start my free trial</button></form><script>document.querySelector('form').onsubmit=e=>{e.preventDefault();recordStep('finish')};</script>`;break;
    case '/fieldset-final':
      body=`<fieldset id="disabled-parent" disabled><button type="button" data-test-place-order-btn>Start my free trial</button></fieldset><script>document.querySelector('button').onclick=()=>recordStep('finish');</script>`;break;
    case '/done':body='<p id="done">Demo finished</p><div id="generated"></div><script>setTimeout(()=>{document.querySelector("#generated").innerHTML=\'<div style="height:1400px"></div><img width="240" height="240" alt="UPI QR Code" data-test-upi-processing-upi-qr-code-image src="/qr-image"><div style="height:20px"></div>\';document.querySelector("img").onclick=()=>recordStep("WRONG_QR_CLICK")},400);</script>';break;
    case '/moving':
      body=`<a href="/done">${offer}</a><script>let moves=0,lastMove=performance.now();const a=document.querySelector('a');const timer=setInterval(()=>{a.style.transform='translateX('+(++moves*8)+'px)';a.style.display='inline-block';lastMove=performance.now();if(moves===8)clearInterval(timer)},60);a.onclick=e=>{e.preventDefault();recordStep('motion',{moves,stillFor:performance.now()-lastMove})};</script>`;break;
    case '/ambiguous':body=`<a href="/done">${offer}</a><a href="/done">${offer}</a>`;break;
    default:body='<p>No workflow controls here.</p>';
  }
  if (req.url === '/survey' || req.url === '/direct-survey' || req.url === '/frame-tooltip-survey') body += `<script>
    const choice=document.querySelector('input'),originalChange=choice.onchange;
    choice.onchange=()=>{originalChange();window.parent.postMessage({kind:'fixture_other_selected'},'*')};
  </script>`;
  if (req.url === '/tooltip-shell') body += `<div id="chat-shield" hidden style="position:fixed;inset:0;background:#0001;z-index:99999"><button class="chat-button__tooltip-dismiss" aria-label="Dismiss chat tooltip" style="position:absolute;right:20px;top:20px" type="button"><span style="display:none">Dismiss chat tooltip</span><span aria-hidden="true">×</span></button></div><button id="unrelated-dismiss" type="button" onclick="recordStep('WRONG_DISMISS')">Close another popup</button><script>
    window.addEventListener('message',e=>{if(e.source===document.querySelector('iframe').contentWindow&&e.data?.kind==='fixture_other_selected')document.querySelector('#chat-shield').hidden=false});
    document.querySelector('.chat-button__tooltip-dismiss').onclick=()=>{recordStep('dismiss-tooltip');setTimeout(()=>document.querySelector('#chat-shield').remove(),500)};
  </script>`;
  if (req.url === '/frame-tooltip-shell') body += `<script>
    window.addEventListener('message',e=>{if(e.source===document.querySelector('iframe').contentWindow&&e.data?.kind==='fixture_other_selected'){const cover=document.createElement('div');cover.id='unknown-parent-cover';cover.style.cssText='position:fixed;inset:0;background:#0001;z-index:999999';document.body.append(cover)}});
  </script>`;
  if (req.url === '/frame-tooltip-survey') body += `<div id="chat-shield" hidden style="position:fixed;inset:0;background:#0001;z-index:99999"><button class="chat-button__tooltip-dismiss" aria-label="Dismiss chat tooltip" type="button" style="position:absolute;right:20px;top:20px"><span style="display:none">Dismiss chat tooltip</span><span aria-hidden="true">×</span></button></div><script>
    const choose=document.querySelector('input'),change=choose.onchange;choose.onchange=()=>{change();document.querySelector('#chat-shield').hidden=false};
    document.querySelector('.chat-button__tooltip-dismiss').onclick=()=>{recordStep('dismiss-tooltip');setTimeout(()=>document.querySelector('#chat-shield').remove(),500)};
  </script>`;
  if (req.url === '/delayed-final') body += `<script>
    const form=document.querySelector('#upi-form'),final=document.querySelector('#final');
    final.innerHTML='<fieldset disabled><button type="button" disabled aria-disabled="true" aria-busy="true" data-test-place-order-btn>Preparing your free trial…</button></fieldset>';
    const button=final.querySelector('button'),fieldset=final.querySelector('fieldset');let focused=false,continuedAt=0;
    form.onsubmit=e=>{e.preventDefault();continuedAt=performance.now();recordStep('continue',document.querySelector('#fields input').value);setTimeout(()=>{button.disabled=false;button.removeAttribute('aria-disabled');button.removeAttribute('aria-busy');button.innerHTML='<span>Start my free trial</span><small>₹0 today</small>';recordStep('button-enabled');setTimeout(()=>fieldset.disabled=false,300)},2800)};
    button.onfocus=()=>{if(focused)return;focused=true;button.disabled=true;recordStep('focus-disabled');setTimeout(()=>{button.disabled=false;recordStep('focus-enabled')},1400)};
    button.onclick=()=>{recordStep('finish',{elapsed:performance.now()-continuedAt,continueStillVisible:!form.hidden});setTimeout(()=>location.href='/done',50)};
  </script>`;
  if (req.url === '/lazy-checkout') body += `<script>
    const pane=document.createElement('main');pane.id='scroll-pane';pane.style.cssText='height:360px;overflow:auto;position:relative;border:2px solid #999';
    const items=[...document.body.children].filter(n=>n.tagName!=='SCRIPT');document.body.prepend(pane);for(const item of items)pane.append(item);
    const upi=document.querySelector('#upi'),form=document.querySelector('#upi-form'),final=document.querySelector('#final');
    const gap=document.createElement('div');gap.style.height='1100px';upi.before(gap);upi.remove();form.remove();
    const monthly=document.querySelector('#monthly'),changed=monthly.onchange;monthly.onchange=()=>{changed();pane.scrollTop=0};
    let mounted=false;pane.addEventListener('scroll',()=>{if(!mounted&&pane.scrollTop>250&&!upi.isConnected){mounted=true;final.before(upi,form);recordStep('lazy-mounted')}},{passive:true});
    final.style.marginTop='700px';final.innerHTML='<button type="button" data-test-place-order-btn>Start my free trial</button>';
    let saved=false,saveAt=0;document.querySelector('[data-test-place-order-btn]').onclick=()=>{recordStep(saved?'finish':'WRONG_EARLY_FINAL',{wait:performance.now()-saveAt});if(saved){history.pushState({},'', '/qr-ready');pane.innerHTML='<div style="height:1400px"></div><img width="240" height="240" alt="UPI QR Code" data-test-upi-processing-upi-qr-code-image src="/qr-image"><div style="height:700px"></div>';pane.querySelector('img').onclick=()=>recordStep('WRONG_QR_CLICK')}};
    form.onsubmit=e=>{e.preventDefault();recordStep('continue',document.querySelector('#fields input').value);saveAt=performance.now();setTimeout(()=>{saved=true;form.hidden=true;upi.hidden=true;recordStep('saved')},900)};
  </script>`;
  res.end(wrapper(body));
}
const serve=async()=>{const s=http.createServer(route);await new Promise(r=>s.listen(0,'127.0.0.1',r));return s;};
async function until(fn,label,timeout=30000){const start=Date.now();while(Date.now()-start<timeout){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,80));}throw new Error(`Timed out: ${label}`);}
module.exports={events,serve,until,setAlternateOrigin:value=>{alternateOrigin=value;},setFrameOrigin:value=>{frameOrigin=value;},slowDelivered:()=>slowDelivered};
