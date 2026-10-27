// Reproduce a stopped popup with missing current URL settings, then exercise
// the two real buttons against the shipped background and shared code.
const {chromium}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {serve,until}=require('./fixture.cjs');
const root=path.resolve(__dirname,'..');
(async()=>{
  const server=await serve(),origin=`http://127.0.0.1:${server.address().port}`;
  const original=server.listeners('request').at(-1);server.removeAllListeners('request');
  server.on('request',async(req,res)=>{
    if(!req.url.startsWith('/__extension/'))return original(req,res);
    const name=req.url.slice('/__extension/'.length);if(!/^[a-z.-]+$/.test(name)){res.statusCode=404;res.end();return;}
    try{res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(await fs.readFile(path.join(root,name)));}catch{res.statusCode=404;res.end();}
  });
  let browser;
  try{
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
    const context=await browser.newContext(),runtime=await require('./chrome-bridge.cjs')(context,root,origin);
    const options=await context.newPage();await options.goto(origin+'/__extension/options.html');
    const popup=await context.newPage();await popup.addInitScript(()=>{window.close=()=>{globalThis.closeRequested=true;};});await popup.goto(origin+'/__extension/popup.html');
    const website=await context.newPage();await website.goto('about:blank');
    const send=(type,payload={})=>options.evaluate(([type,payload])=>chrome.runtime.sendMessage({type,...payload}),[type,payload]);
    await options.evaluate(()=>chrome.permissions.request({origins:['http://127.0.0.1/*']}));
    await send('SAVE_SETTINGS',{settings:{startUrl:origin+'/empty',step2StartUrl:origin+'/empty',step2SecondUrl:origin+'/done',settleMilliseconds:200}});
    let lastId;
    for(const number of [1,1,2,2,1]){
      await popup.reload();const button=popup.locator(number===1?'#start':'#start2');
      assert.equal(await button.isDisabled(),false);await button.click();
      await until(()=>runtime.store.run?.status==='running'&&runtime.store.run.id!==lastId,'fresh run from selected workflow');
      assert.equal(runtime.store.run.config.workflowNumber,number);assert.equal(runtime.store.run.tabId,runtime.ids.get(website));
      lastId=runtime.store.run.id;
      await until(()=>popup.evaluate(()=>globalThis.closeRequested),'popup auto-close after fresh start');
      await popup.locator('#stop').click();await popup.locator('#status').filter({hasText:'Stopped'}).waitFor();
      assert.match(await popup.locator('#message').innerText(),/Click Trial or Cancel & Refund/);
      assert.equal(await popup.locator('#start').isVisible(),true);assert.equal(await popup.locator('#start2').isVisible(),true);
      assert.equal(await popup.getByRole('button',{name:'Start',exact:true}).count(),0);
    }
    // Reproduce the screenshot's old stopped message and blank current URLs.
    runtime.store.run.message='Stopped. Press Start for a new run.';runtime.store.run.log.push({at:Date.now(),message:runtime.store.run.message});runtime.store.settings={};
    runtime.config.startUrl='';runtime.config.step2StartUrl='';runtime.config.step2SecondUrl='';runtime.reloadWorker();
    await popup.reload();
    assert.match(await popup.locator('#message').innerText(),/Click Trial or Cancel & Refund/);
    assert.ok(!(await popup.locator('#log').textContent()).includes('Press Start'));
    assert.equal(await popup.locator('#start').isDisabled(),false);assert.equal(await popup.locator('#start2').isDisabled(),false);
    await popup.locator('#start').click();await until(()=>runtime.store.run.id!==lastId&&runtime.store.run.status==='running','Trial recovers its last working URL');
    assert.equal(runtime.store.run.config.startUrl,origin+'/empty');assert.equal(runtime.store.run.config.workflowRevision,runtime.config.workflowRevision);
    await popup.locator('#stop').click();
    await popup.locator('#start2').click();await popup.locator('#error').filter({hasText:'Set both Cancel & Refund URLs'}).waitFor();
    assert.equal(runtime.store.run.status,'stopped','a genuinely unconfigured workflow gives an error without starting');
    await send('SAVE_SETTINGS',{settings:{step2StartUrl:origin+'/empty',step2SecondUrl:origin+'/done'}});
    await popup.locator('#start2').click();await until(()=>runtime.store.run.config.workflowNumber===2&&runtime.store.run.status==='running','switch directly to Cancel & Refund');
    await popup.locator('#stop').click();lastId=runtime.store.run.id;
    runtime.store.settings={};runtime.reloadWorker();await popup.reload();await popup.locator('#start2').click();
    await until(()=>runtime.store.run.id!==lastId&&runtime.store.run.status==='running','Cancel & Refund recovers both URLs');
    assert.equal(runtime.store.run.config.startUrl,origin+'/empty');assert.equal(runtime.store.run.config.secondUrl,origin+'/done');
    await popup.locator('#stop').click();await popup.screenshot({path:path.join(root,'..','qa-restart-popup.png')});
    console.log('PASS: Stop -> either button starts a fresh run directly; legacy stopped text corrected; missing URLs recover only for the previous workflow; unconfigured choice shows a clear error; no separate Start button');
  }finally{await browser?.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
