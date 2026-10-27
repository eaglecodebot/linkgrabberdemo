// Local payment-state fixtures only. No live payment or subscription is made.
const {chromium}=require('playwright');
const path=require('node:path'),assert=require('node:assert/strict');
const {serve,events,until}=require('./fixture.cjs');
const root=path.resolve(__dirname,'..');
const html=body=>`<!doctype html><meta charset="utf-8"><style>body{font:16px system-ui;padding:25px}button,label,input{margin:12px;padding:12px}[hidden]{display:none!important}</style>${body}<script>const record=(name,value)=>fetch('/event',{method:'POST',body:JSON.stringify({name,value})});</script>`;
const checkout=mode=>html(`<aside><div aria-busy="true">Chat loading</div><div role="alert">Payment help chat failed to connect</div></aside>
 <main class="checkout-container">
 <input type="radio" id="monthly" data-test-billing-cycle-card-radio-button="MONTHLY"><label for="monthly">Monthly</label>
 <button id="upi" aria-expanded="false"><span data-test-upi-panel-header>UPI</span></button>
 <form id="upi-form" hidden><input type="radio" id="upi-qr-code-button" name="upi-payment-option" value="QR_CODE"><label for="upi-qr-code-button">QR Code</label>
 <label for="pin">Pin code</label><input id="pin" type="text" required><button type="submit" data-test-save-upi-button>Continue</button></form>
 <div id="saving" aria-busy="false">Payment details</div><div id="spinner" role="progressbar" hidden>Saving</div>
 <div hidden aria-busy="true">Old saving region</div><div style="opacity:0" role="progressbar">Invisible spinner</div><div role="progressbar" aria-valuenow="50">Static checkout steps</div>
 <button id="order" type="button" data-test-place-order-btn hidden>Start my free trial</button></main>
 <script>
 const mode=${JSON.stringify(mode)},form=document.querySelector('#upi-form'),pin=document.querySelector('#pin'),saving=document.querySelector('#saving'),spinner=document.querySelector('#spinner'),order=document.querySelector('#order');
 let pinAt=0,continuedAt=0,saved=false,focused=false;
 document.querySelector('#monthly').onchange=()=>record('monthly');
 document.querySelector('#upi').onclick=()=>{record('upi');document.querySelector('#upi').setAttribute('aria-expanded','true');form.hidden=false};
 document.querySelector('#upi-qr-code-button').onchange=()=>record('qr');
 pin.oninput=()=>{pinAt=performance.now();record('pincode-input');form.setAttribute('aria-busy','true');setTimeout(()=>form.setAttribute('aria-busy','false'),1600)};
 form.onsubmit=e=>{e.preventDefault();record('continue',{afterPin:performance.now()-pinAt});continuedAt=performance.now();saving.setAttribute('aria-busy','true');spinner.hidden=false;order.hidden=false;
  setTimeout(()=>{saved=true;saving.setAttribute('aria-busy','false');spinner.hidden=true;record('saved')},mode==='success'?6200:4500)};
 order.onfocus=()=>{if(mode!=='success'||focused)return;focused=true;saving.setAttribute('aria-busy','true');record('focus-busy');setTimeout(()=>{saving.setAttribute('aria-busy','false');record('focus-idle')},450)};
 order.onclick=()=>{
  if(!saved||saving.getAttribute('aria-busy')==='true'){record('WRONG_EARLY_ORDER');return;}
  record('finish',{afterContinue:performance.now()-continuedAt});
  if(mode==='inline-error'){document.querySelector('main').insertAdjacentHTML('beforeend','<p role="alert">Payment could not be completed. PRIVATE_SENTINEL</p>');}
  else if(mode==='page-error')location.href='/guarded-payment-error';
  else{const alert=document.createElement('p');alert.setAttribute('role','alert');alert.textContent='Payment failed temporarily';document.querySelector('main').append(alert);setTimeout(()=>alert.remove(),350);setTimeout(()=>location.href='/done',900);}
 };
 </script>`);
(async()=>{
 const server=await serve(),origin=`http://127.0.0.1:${server.address().port}`;let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});const context=await browser.newContext();
  await context.route('**/guarded-*',async route=>{
   const name=new URL(route.request().url()).pathname;
   await route.fulfill({contentType:'text/html',body:name==='/guarded-payment-error'?html('<main><h1>Checkout</h1><p role="alert">Payment could not be completed. PRIVATE_SENTINEL</p></main>'):checkout(name.slice('/guarded-'.length))});
  });
  const runtime=await require('./chrome-bridge.cjs')(context,root,origin);runtime.config.steps=runtime.config.steps.slice(7);runtime.reloadWorker();
  const controls=await context.newPage();await controls.goto(origin+'/__extension/controls.html');
  const send=(type,payload={})=>controls.evaluate(([type,payload])=>chrome.runtime.sendMessage({type,...payload}),[type,payload]);
  await controls.evaluate(()=>chrome.permissions.request({origins:['http://127.0.0.1/*']}));
  for(const mode of ['success','inline-error','page-error']){
   events.length=0;const startUrl=origin+'/guarded-'+mode;
   const settings=await send('SAVE_SETTINGS',{settings:{startUrl,settleMilliseconds:200}});assert.ok(!settings.error,settings.error);
   const page=await context.newPage();await page.goto(startUrl);const started=await send('START',{tabId:runtime.ids.get(page)});assert.ok(!started.error,started.error);
   await until(()=>['finished','error'].includes(runtime.store.run?.status),'checkout outcome',30000);
   await until(()=>events.some(e=>e.name==='finish'),'single final click');
   assert.equal(events.filter(e=>e.name==='pincode-input').length,1);assert.equal(events.filter(e=>e.name==='continue').length,1);assert.equal(events.filter(e=>e.name==='finish').length,1);
   assert.equal(events.some(e=>e.name.startsWith('WRONG')),false);
   assert.ok(events.find(e=>e.name==='continue').value.afterPin>=1600);
   assert.ok(events.find(e=>e.name==='finish').value.afterContinue>=(mode==='success'?7200:5500));
   if(mode==='success'){
    assert.equal(runtime.store.run.status,'finished',runtime.store.run.message);
    assert.ok(events.some(e=>e.name==='focus-busy'));assert.ok(events.some(e=>e.name==='focus-idle'));
    console.log('PASS: pincode validation pause, sibling saving/progress guard, focus-time recheck, brief transient alert, then one final click and loaded QR; outside/hidden spinners ignored');
   }else{
    assert.equal(runtime.store.run.status,'error');assert.equal(runtime.store.run.siteError,'checkout');
    assert.ok(!JSON.stringify(runtime.store.run).includes('PRIVATE_SENTINEL'));
    const retry=await send('RETRY');assert.match(retry.error,/final click may already have been sent/);
    const metrics=await page.evaluate(()=>({...PrivateWorkflow.metrics}));await page.waitForTimeout(700);assert.deepEqual(await page.evaluate(()=>({...PrivateWorkflow.metrics})),metrics);
    console.log('PASS: '+mode+' stops on a persistent payment error, exports no raw error text and cannot repeat the last click');
   }
   await page.close();
  }
 }finally{await browser?.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
