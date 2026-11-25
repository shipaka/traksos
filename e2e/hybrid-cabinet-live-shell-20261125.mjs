// Real application Shell, existing synthetic local hybrid account only.
// The final role-removal case intercepts /api/me to exercise UI recovery;
// it deliberately does not modify the database or claim server revocation proof.
import {chromium} from 'playwright';
const BASE=process.env.BASE_URL??'http://localhost:8080';
if(!['localhost','127.0.0.1'].includes(new URL(BASE).hostname))throw Error('Local CI only');
const assert=(ok,message)=>{if(!ok)throw Error(message)};
const login=await fetch(BASE+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
  phone:'+79990000146',password:'Test-Role-Only-2026!'
})});
assert(login.ok,'Synthetic hybrid login failed');
const {token,user}=await login.json();
assert(user.roles.includes('master')&&user.roles.includes('service'),'Missing seeded hybrid roles');
assert(!user.roles.includes('admin'),'Hybrid fixture must not be staff');
const staff=await fetch(BASE+'/api/admin/stats',{headers:{authorization:'Bearer '+token}});
assert(staff.status===403,'Hybrid fixture unexpectedly has backend administrator access');
const browser=await chromium.launch();
try{
  for(const [kind,width,native] of [['desktop',1440,false],['mobile-web',390,false],['android-bridge',390,true]]){
    const context=await browser.newContext({viewport:{width,height:900},locale:'ru-RU',hasTouch:width<900,isMobile:width<900});
    const page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(({token,native})=>{
      if(native)Object.defineProperty(window,'TrakSOSNative',{configurable:true,value:{
        isApp:()=>true,setSession:()=>{},pushToken:()=>'',performerOnline:()=>{},
        appLockEnabled:()=>false,setAppLockEnabled:()=>false
      }});
      if(!localStorage.getItem('traksos.token'))localStorage.setItem('traksos.token',token);
      if(!localStorage.getItem('traksos.mode'))localStorage.setItem('traksos.mode','performer');
    },{token,native});
    try{
      await page.goto(BASE+'/#/work',{waitUntil:'domcontentloaded'});
      const choice=page.getByRole('combobox',{name:'Текущий рабочий кабинет'});
      await choice.waitFor({timeout:20000});
      const required=await fetch(BASE+'/api/me/offers',{headers:{authorization:'Bearer '+token}});
      assert(required.ok,'Cannot read synthetic offer status');
      for(const offer of (await required.json()).filter(x=>x.current&&!x.accepted&&['privacy','performer'].includes(x.audience))){
        const modal=page.getByRole('dialog',{name:offer.name});
        await modal.waitFor({state:'visible',timeout:15000});
        await modal.locator('input[type=checkbox]').check();
        await modal.getByRole('button',{name:'Принимаю'}).click();
        await modal.waitFor({state:'detached',timeout:15000});
      }
      const writes=[];
      page.on('request',r=>{
        const path=new URL(r.url()).pathname;
        if(!['GET','HEAD','OPTIONS'].includes(r.method())&&
          (/^\/api\/auth\//.test(path)||/^\/api\/(performer\/line|base|service)(\/|$)/.test(path)))writes.push(path);
      });
      const checkMode=async(mode,hash,hasSwitch=true)=>{
        await page.waitForURL(url=>url.hash===hash,{timeout:15000});
        await page.locator('.app.role-'+mode).waitFor({state:'visible',timeout:15000});
        await page.waitForFunction(({mode})=>localStorage.getItem('traksos.mode')===mode,{mode});
        assert(await page.evaluate(t=>localStorage.getItem('traksos.token')===t,token),kind+': bearer changed');
        if(hasSwitch){await choice.waitFor();assert(await choice.inputValue()===mode,kind+': wrong selected mode')}
        const links=await page.locator('.account-menu nav a').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')));
        assert(!links.some(h=>h?.startsWith('#/admin')),kind+': leaked administrator navigation');
        assert(links.some(h=>h?.startsWith(mode==='service'?'#/base/':'#/work/')),kind+': missing selected workspace routes');
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+3),kind+': layout overflow');
      };
      assert((await choice.locator('option').allTextContents()).join('|')==='Выездной мастер|СТО',kind+': incorrect role choices');
      await choice.selectOption('service');
      await checkMode('service','#/base');
      await page.reload({waitUntil:'domcontentloaded'});
      await checkMode('service','#/base');
      await choice.selectOption('performer');
      await checkMode('performer','#/work');
      await page.evaluate(()=>{location.hash='#/as/admin'});
      await checkMode('performer','#/work');
      await choice.selectOption('service');
      await checkMode('service','#/base');
      // Simulate a refreshed server identity with service role removed.
      await page.route(/\/api\/me(?:\?.*)?$/,async route=>{
        const response=await route.fetch();
        if(!response.ok()){await route.fulfill({response});return}
        const profile=await response.json();
        await route.fulfill({response,json:{...profile,roles:profile.roles.filter(r=>r!=='service')}});
      });
      await page.goto(BASE+'/#/as/service',{waitUntil:'domcontentloaded'});
      await checkMode('performer','#/work',false);
      assert(await choice.count()===0,kind+': withdrawn role selector remains');
      assert(writes.length===0,kind+': switch unexpectedly submitted a mutation '+writes.join(','));
      assert(errors.length===0,kind+': page errors '+errors.join('; '));
      console.log('PASS real Shell hybrid switching, denied mode and simulated withdrawal:',kind);
    }finally{await context.close()}
  }
}finally{await browser.close()}
