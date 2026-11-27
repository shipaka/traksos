// Real local Shell and SOS directions. Synthetic Air reads only; no order/payment/SMS writes.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const BASE=process.env.BASE_URL??'http://localhost:8080';
assert.ok(['localhost','127.0.0.1'].includes(new URL(BASE).hostname),'Local CI only');
const login=await fetch(BASE+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phone:'+79991112233',password:'TrakSOS-Test-2026!'})});
assert.equal(login.status,200,'existing disposable client');
const {token}=await login.json();
assert.ok(token);
const browser=await chromium.launch();
try{
  for(const width of [390,1440]){
    const context=await browser.newContext({viewport:{width,height:844},locale:'ru-RU'});
    try{
      await context.addInitScript(t=>localStorage.setItem('traksos.token',t),token);
      const page=await context.newPage(),writes=[],errors=[];
      await page.addInitScript(()=>{window.__airGpsCalls=0;navigator.geolocation.getCurrentPosition=()=>{window.__airGpsCalls++;};});
      page.on('pageerror',e=>errors.push(e.message));
      page.on('request',r=>{
        if(!['GET','HEAD','OPTIONS'].includes(r.method())&&/^\/api\/(orders|payments|payment|air\/messages|sms)(\/|$)/.test(new URL(r.url()).pathname))
          writes.push(r.method()+' '+new URL(r.url()).pathname);
      });
      await page.route('**/api/air/messages',route=>{
        if(route.request().method()!=='GET')return route.abort();
        return route.fulfill({json:{
          messages:Array.from({length:30},(_,i)=>({id:'row-'+i,author:'Тест',body:'Учебное сообщение '+i,isBot:false,createdAt:'2026-11-27T00:00:00Z'})),
          botEnabled:true,canPost:true,canConfigure:false,canModerate:false,publicForDrivers:true
        }});
      });
      await page.goto(BASE+'/#/sos');
      await page.getByRole('heading',{name:'Помощь в дороге',exact:true}).waitFor();
      const back=page.getByRole('link',{name:/Вернуться в Эфир/});
      assert.equal(await back.count(),0,'direct SOS must not invent an Air origin');
      for(const query of ['?from=air','?from=other']){
        await page.goto(BASE+'/#/sos'+query);
        await page.getByRole('button',{name:'Определить GPS устройства'}).waitFor();
        assert.equal(await back.count(),0,'query alone must not invent a saved Air context');
      }
      await page.goto(BASE+'/#/air');
      const composer=page.getByRole('textbox',{name:'Сообщение в эфир'});
      await composer.fill('Учебный черновик');
      await page.getByRole('button',{name:'SOS · Помощь в дороге'}).click();
      await page.getByRole('heading',{name:'Помощь в дороге',exact:true}).waitFor();
      await back.waitFor();
      await page.waitForURL('**/#/sos?from=air');
      assert.equal(await page.evaluate(()=>window.__airGpsCalls),0,'Air-origin SOS must not request GPS');
      const choices=page.getByRole('region',{name:'Направление помощи'});
      for(const name of ['Выездной мастер','Эвакуатор','Грузовая СТО'])
        assert.ok(await choices.getByRole('button',{name:new RegExp(name)}).isVisible(),name+' unavailable');
      await choices.getByRole('button',{name:/Выездной мастер/}).click();
      await page.getByRole('link',{name:/Электрик/}).waitFor();
      await back.click();
      await composer.waitFor();
      assert.equal(await composer.inputValue(),'Учебный черновик');
      // Once consumed, an ordinary later SOS visit must use its normal Back.
      await page.goto(BASE+'/#/sos');
      await page.getByRole('heading',{name:'Помощь в дороге',exact:true}).waitFor();
      assert.equal(await back.count(),0);
      assert.deepEqual(writes,[]);
      assert.deepEqual(errors,[]);
    }finally{await context.close();}
  }
  console.log('PASS real Shell: direct SOS, Air origin, actual help directions, explicit return and draft, no business writes');
}finally{await browser.close();}
