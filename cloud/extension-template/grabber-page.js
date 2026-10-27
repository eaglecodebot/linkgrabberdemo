(() => {
  const id = 'link-grabber-extension-result';
  function notify(level, message) {
    document.getElementById(id)?.remove();
    const host = document.createElement('div'); host.id = id;host.dataset.level=level;
    host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;max-width:380px';
    const root = host.attachShadow({mode:'closed'}), box = document.createElement('div'), close = document.createElement('button');
    const colors={success:['#154d39','#448969'],error:['#662c32','#b8666d'],warning:['#624719','#b18d42'],info:['#172436','#49607a']},color=colors[level]||colors.info;
    box.style.cssText = 'font:14px/1.5 system-ui;background:'+color[0]+';color:#f1f5f9;padding:15px 40px 15px 18px;border:1px solid '+color[1]+';border-radius:12px;box-shadow:0 5px 25px #0005';
    box.textContent = message; close.textContent = '×'; close.setAttribute('aria-label','Dismiss');
    close.style.cssText = 'position:absolute;right:10px;top:8px;border:0;background:none;color:#fff;font-size:20px;cursor:pointer';
    close.onclick = () => host.remove(); root.append(box,close); (document.body||document.documentElement).append(host);
    setTimeout(()=>host.remove(),level==='error'?8000:level==='warning'?6000:4000);
  }
  async function collect(settings) {
    const matches = url => new RegExp('^'+settings.pagePattern.split('*').map(p=>p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*')+'$','i').test(url);
    const scan = () => {
      if (!matches(location.href)) throw new Error('The configured page is not open. Sign in to the website if required, then click Grab Links again.');
      const links = new Map(), repeatedByService = {};
      for (const anchor of document.querySelectorAll('a[href]')) {
        const link = globalThis.__linkGrabberDecode.matchRewardLink(anchor.href,settings.rules);
        if (!link || !settings.enabledServices.includes(link.service)) continue;
        if (links.has(link.url)) repeatedByService[link.service]=(repeatedByService[link.service]||0)+1;
        else links.set(link.url,{url:link.url,service:link.service,label:(anchor.textContent||'').trim().slice(0,1000)});
        if (links.size>5000) throw new Error('Too many links on this page. Nothing saved.');
      }
      const present=new Set([...links.values()].map(link=>link.service));
      return {sourceUrl:location.href,title:document.title.slice(0,1000),links:[...links.values()],repeatedByService,missing:settings.enabledServices.filter(service=>!present.has(service))};
    };
    let current=scan(); if(!current.missing.length)return current;
    return new Promise((resolve,reject)=>{
      let observer,timer,poll;
      const stop=()=>{observer?.disconnect();clearTimeout(timer);clearInterval(poll);};
      const check=()=>{try{current=scan();if(!current.missing.length){stop();resolve(current);}}catch(e){stop();reject(e);}};
      observer=new MutationObserver(check);observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['href']});
      poll=setInterval(check,150);timer=setTimeout(()=>{stop();resolve(current);},3000);check();
    });
  }
  globalThis.__linkGrabberPage={collect,notify};
})();
