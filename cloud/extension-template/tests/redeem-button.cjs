// Exercise the newly captured Redeem CTA after Career using the shipped runner.
const {chromium}=require('playwright');
const path=require('node:path'),assert=require('node:assert/strict');
const {events,serve,until}=require('./fixture.cjs');
const root=path.resolve(__dirname,'..');
const html=body=>`<!doctype html><meta charset="utf-8"><style>body{font:16px system-ui;padding:24px}a,button,label{display:inline-block;margin:12px;padding:12px}iframe{width:100%;height:520px}</style><main>${body}</main><script>const record=name=>fetch('/event',{method:'POST',body:JSON.stringify({name})});</script>`;
(async()=>{
  const server=await serve(),second=await serve();
  const origin=`http://127.0.0.1:${server.address().port}`,embeddedOrigin=`http://localhost:${second.address().port}`;
  let browser,layout='main',variant='capture';
  try{
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
    const context=await browser.newContext({viewport:{width:1280,height:800}});
    await context.route('**/redeem-*',async route=>{
      const name=new URL(route.request().url()).pathname;
      let body;
      if(name==='/redeem-start')body=html(`<a href="/redeem-career">Access exclusive tools &amp; insights Try Premium for ₹0</a>`);
      else if(name==='/redeem-unused')body=html(`<button onclick="record('WRONG_FRAME_REDEEM')">Redeem 1 month for ₹0</button>`);
      else if(name==='/redeem-career'){
        if(layout==='frame')body=html(`<button onclick="record('WRONG_PARENT_REDEEM')">Redeem 1 month for ₹0</button><iframe data-testid="interop-iframe" src="${embeddedOrigin}/redeem-inner-career"></iframe><script>addEventListener('message',e=>{if(e.source===document.querySelector('iframe').contentWindow&&e.data?.kind==='redeem-checkout')location.href='/checkout'});</script>`);
        else body=html(`<div id="flow"><button aria-label="Learn more about Career">Learn more</button></div><script>document.querySelector('[aria-label]').onclick=()=>{record('career');location.href='/redeem-plan'};</script>`);
      }else if(name==='/redeem-inner-career')body=html(`<button aria-label="Learn more about Career">Learn more</button><script>document.querySelector('button').onclick=()=>{record('career');location.href='/redeem-plan'};</script>`);
      else {
        const inFrame=layout==='frame';
        body=html(`<div id="flow"><form><div id="mount"></div></form></div><button id="outside" data-view-name="premium-checkout-primary-cta-action">Redeem 1 month for ₹0</button>${layout==='main-with-frame'?`<iframe data-testid="interop-iframe" src="${embeddedOrigin}/redeem-unused"></iframe>`:''}
          <script>
          document.querySelector('#outside').onclick=()=>record('WRONG_OUTSIDE_REDEEM');
          setTimeout(()=>{
            document.querySelector('#mount').innerHTML='<button role="link" id="ember65" class="artdeco-button artdeco-button--4 artdeco-button--primary ember-view premium-chooser__cta premium-chooser__pdr-cta" data-view-name="premium-checkout-primary-cta-action" disabled aria-disabled="true" aria-busy="true"><span class="artdeco-button__text">Redeem 1 month for ₹0</span></button>';
            const button=document.querySelector('#ember65');
            ${variant==='copy-change'?"button.querySelector('span').textContent='Redeem 1 month for ₹ 0 today';":''}
            ${variant==='class-fallback'?"button.removeAttribute('data-view-name');":''}
            button.onclick=e=>{
              e.preventDefault();record('redeem');
              document.querySelector('#flow').innerHTML='<section role="dialog"><label for="premium-pricing-modal__card-0">Individual</label><input id="premium-pricing-modal__card-0" type="radio" name="premium-pricing-modal__card-selection" value="0"><button data-view-name="premium-chooser-pricing-modal-cta" disabled>Continue with this plan</button></section>';
              document.querySelector('input').onchange=()=>{record('individual');document.querySelector('[data-view-name="premium-chooser-pricing-modal-cta"]').disabled=false};
              document.querySelector('[data-view-name="premium-chooser-pricing-modal-cta"]').onclick=()=>{record('confirm-individual');${inFrame?"parent.postMessage({kind:'redeem-checkout'},'*')":"location.href='/checkout'"}};
            };
          },550);
          </script>`);
      }
      await route.fulfill({contentType:'text/html; charset=utf-8',body});
    });
    const runtime=await require('./chrome-bridge.cjs')(context,root,origin),original=structuredClone(runtime.config.steps);
    runtime.config.steps=[original[0],...original.slice(3)];runtime.reloadWorker();
    const controls=await context.newPage();await controls.goto(origin+'/__extension/controls.html');
    const send=(type,payload={})=>controls.evaluate(([type,payload])=>chrome.runtime.sendMessage({type,...payload}),[type,payload]);
    await controls.evaluate(()=>chrome.permissions.request({origins:['http://127.0.0.1/*','http://localhost/*']}));
    for(const scenario of [{layout:'main',variant:'capture'},{layout:'frame',variant:'copy-change'},{layout:'main-with-frame',variant:'class-fallback'}]){
      ({layout,variant}=scenario);events.length=0;
      const saved=await send('SAVE_SETTINGS',{settings:{startUrl:origin+'/redeem-start',additionalOrigins:[embeddedOrigin]}});assert.ok(!saved.error,saved.error);
      const page=await context.newPage();await page.goto(origin+'/redeem-start');
      const started=await send('START',{tabId:runtime.ids.get(page)});assert.ok(!started.error,started.error);
      const target=layout==='frame'?await until(()=>page.frames().find(f=>f.url()===embeddedOrigin+'/redeem-plan'),'embedded offer page'):page.mainFrame();
      await target.locator('#ember65').waitFor();
      await page.waitForTimeout(900);assert.equal(events.some(e=>e.name==='redeem'),false,'disabled captured button must block the enabled outside duplicate');
      await target.locator('#ember65').evaluate(button=>button.disabled=false);
      await page.waitForTimeout(500);assert.equal(events.some(e=>e.name==='redeem'),false,'ARIA disabled still blocks');
      await target.locator('#ember65').evaluate(button=>button.removeAttribute('aria-disabled'));
      await page.waitForTimeout(500);assert.equal(events.some(e=>e.name==='redeem'),false,'busy still blocks');
      const duplicateId=await target.locator('#ember65').evaluate(button=>{
        const duplicate=button.cloneNode(true);duplicate.id='duplicate-offer';duplicate.disabled=false;duplicate.removeAttribute('aria-busy');duplicate.removeAttribute('aria-disabled');
        duplicate.onclick=()=>fetch('/event',{method:'POST',body:JSON.stringify({name:'WRONG_DUPLICATE'})});button.after(duplicate);
        button.removeAttribute('aria-busy');return duplicate.id;
      });
      await page.waitForTimeout(1100);assert.equal(events.some(e=>e.name==='redeem'),false,'two captured form CTAs cannot choose an arbitrary one');
      await target.locator('#'+duplicateId).evaluate(button=>button.remove());
      await page.evaluate(()=>{const cover=document.createElement('div');cover.id='cover';cover.style.cssText='position:fixed;inset:0;z-index:99999;background:#0001';document.body.append(cover);});
      await page.waitForTimeout(600);assert.equal(events.some(e=>e.name==='redeem'),false,'parent overlay blocks the plan button');
      await page.locator('#cover').evaluate(el=>el.remove());
      await until(()=>{if(runtime.store.run.status==='error')throw Error(runtime.store.run.message);return runtime.store.run.status==='finished';},'offer -> Individual -> checkout -> QR',45000);
      assert.deepEqual(events.map(e=>e.name),['career','redeem','individual','confirm-individual','monthly','upi','qr','continue','finish']);
      assert.equal(events.filter(e=>e.name==='redeem').length,1);assert.equal(events.filter(e=>e.name==='finish').length,1);
      const metrics=await page.evaluate(()=>({...PrivateWorkflow.metrics}));await page.waitForTimeout(500);assert.deepEqual(await page.evaluate(()=>({...PrivateWorkflow.metrics})),metrics);
      console.log(`PASS: ${layout}/${variant}; Career -> captured Redeem once -> Individual -> loaded QR; disabled, busy, duplicates and parent overlay wait; outside controls untouched`);
      await page.close();
    }
  }finally{await browser?.close();server.close();second.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
