// Android approved mobile navigation acceptance: real local test accounts, never production.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080';
if (!['localhost', '127.0.0.1'].includes(new URL(BASE).hostname))
  throw Error('Android workspace test may only run against local CI data');

const roles = [
  ['owner', '+79990000141', 'Test-Role-Only-2026!', 'client', '#/'],
  ['driver', '+79990000142', 'Test-Role-Only-2026!', 'client', '#/'],
  ['master', '+79992223344', 'TrakSOS-Test-2026!', 'performer', '#/work'],
  ['tow', '+79990000143', 'Test-Role-Only-2026!', 'performer', '#/work'],
  ['service', '+79990000144', 'Test-Role-Only-2026!', 'service', '#/base'],
  ['master_service', '+79990000146', 'Test-Role-Only-2026!', 'service', '#/base'],
  ['insurer', '+79990000145', 'Test-Role-Only-2026!', 'insurer', '#/insurance'],
  ['moderator', '+79990000147', 'Test-Role-Only-2026!', 'moderator', '#/moderation'],
  ['admin', '+79990000001', 'TrakSOS-Test-2026!', 'admin', '#/admin'],
];
await mkdir('e2e/shots/android-approved',{recursive:true});
const browser=await chromium.launch();
try {
  for(const [role,phone,password,mode,home] of roles){
    const login=await fetch(BASE+'/api/auth/login',{method:'POST',
      headers:{'content-type':'application/json'},body:JSON.stringify({phone,password})});
    if(!login.ok)throw Error(role+': synthetic test login '+login.status);
    const {token}=await login.json();
    const ctx=await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU'});
    const page=await ctx.newPage();
    const pageErrors=[];
    page.on('pageerror',e=>pageErrors.push(e.message));
    // Model the Android JS bridge before the app bundle executes. Without it
    // native.isApp stays false and Chromium tests the mobile website instead
    // of the actual Android-specific workspace.
    await page.addInitScript(v=>{
      Object.defineProperty(window,'TrakSOSNative',{configurable:true,value:{
        isApp:()=>true,
        setSession:()=>{},pushToken:()=>'',performerOnline:()=>{},
        appLockEnabled:()=>false,setAppLockEnabled:()=>false
      }});
      localStorage.setItem('traksos.token',v.token);
      localStorage.setItem('traksos.mode',v.mode);
    }, {token,mode});
    await page.goto(BASE+'/'+home,{waitUntil:'domcontentloaded'});
    await page.locator('.app').waitFor();
    // This is a synthetic CI account: accept any current synthetic legal offer.
    const offersResponse=await fetch(BASE+'/api/me/offers',{headers:{authorization:'Bearer '+token}});
    if(!offersResponse.ok)throw Error(role+': cannot inspect offer gate');
    for(const offer of (await offersResponse.json()).filter(o=>o.current&&!o.accepted)){
      const modal=page.getByRole('dialog',{name:offer.name});
      await modal.waitFor({state:'visible',timeout:15000});
      await modal.locator('input[type=checkbox]').check();
      await modal.getByRole('button',{name:'Принимаю'}).click();
      await modal.waitFor({state:'detached',timeout:15000});
    }
    // The role matrix creates a brand-new tow account without a performer
    // profile. Confirm that onboarding is visible, then finish it through the
    // public API on this isolated CI database before testing the full workspace.
    // A new partner must not be mistaken for a broken dashboard.
    if(role==='tow'){
      const profileResponse=await fetch(BASE+'/api/performer/profile',{
        headers:{authorization:'Bearer '+token}
      });
      if(!profileResponse.ok)throw Error(role+': cannot inspect performer onboarding '+profileResponse.status);
      const profile=await profileResponse.json();
      if(!profile){
        await page.getByText('Заполните профиль',{exact:true}).waitFor({state:'visible'});
        await page.getByRole('button',{name:'Заполнить',exact:true}).waitFor({state:'visible'});
        const created=await fetch(BASE+'/api/performer/profile',{
          method:'PUT',headers:{authorization:'Bearer '+token,'content-type':'application/json'},
          body:JSON.stringify({kind:'tow',specialties:[],brands:{},tier:'eco'})
        });
        if(!created.ok)throw Error(role+': synthetic profile setup failed HTTP '+created.status);
        await page.reload({waitUntil:'domcontentloaded'});
        await page.locator('.app').waitFor();
      }
    }
    // Verify both narrow Android WebView geometries with the native bridge active.
    for(const width of [320,390]){
      await page.setViewportSize({width,height:844});
      const bounds=await page.evaluate(()=>({
        page:document.documentElement.scrollWidth,
        viewport:document.documentElement.clientWidth
      }));
      if(bounds.page>bounds.viewport+3)
        throw Error(role+': Android workspace horizontal overflow at '+width+'px');
    }
    if(mode==='client'){
      const desk=page.locator('.and19-client');
      await desk.waitFor({state:'visible'});
      if(await desk.locator('.and19-services > a').count()!==4)throw Error(role+': missing 4 service actions');
      const urls=await desk.locator('.and19-services>a').evaluateAll(a=>a.map(x=>x.getAttribute('href')));
      if(JSON.stringify(urls)!==JSON.stringify(['#/sos','#/new/tow','#/services','#/new/consult']))
        throw Error(role+': service destinations changed '+JSON.stringify(urls));
      const garage=desk.locator('.and20-vehicle-preview');
      const vehicleHref=await garage.getAttribute('href');
      if(!vehicleHref?.startsWith('#/garage'))
        throw Error(role+': vehicle history does not open authorized garage');
      if(await desk.locator('.and19-sos').getAttribute('href')!=='#/sos')throw Error(role+': SOS missing');
    }
    // The approved owner, driver, moderator and admin layouts never offer
    // "On line". That is an incoming-work availability control for performers.
    // Never copy the decorative toggle visible in older approved reference PNGs.
    if(['owner','driver','moderator','admin'].includes(role)){
      const forbidden=page.locator([
        '.and19-client .and19-role button[role="switch"]',
        '.and19-client .and19-role button[aria-label*="На линии"]',
        '.and19-client .and19-line',
        '.moderator-workspace > .internal-role-hero button[role="switch"]',
        '.admin-workspace > .admin-command-hero button[role="switch"]',
        '.moderator-workspace > .internal-role-hero button[aria-label*="На линии"]',
        '.admin-workspace > .admin-command-hero button[aria-label*="На линии"]',
      ].join(','));
      if(await forbidden.count())throw Error(role+': forbidden top-level online switch');
      const top=page.locator(role==='owner'||role==='driver'
        ? '.and19-client .and19-role'
        : role==='moderator'
          ? '.moderator-workspace > .internal-role-hero'
          : '.admin-workspace > .admin-command-hero');
      if(await top.count() && /На линии|Режим администратора/.test(await top.innerText()))
        throw Error(role+': inherited decorative availability label on role header');
    }
    if(mode==='performer'){
      const desk=page.locator('.and19-performer');
      await desk.waitFor({state:'visible'});
      if(!await desk.locator('.and19-line button').count())throw Error(role+': availability control missing');
      if(!await desk.locator('a[href="#/work/jobs"]').count())throw Error(role+': jobs path missing');
    }
    const tabs=page.locator('.tabbar a');
    if(!await tabs.count())throw Error(role+': no mobile navigation');
    const links=await tabs.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('href')));
    if(links.some(v=>!v||!v.startsWith('#/')))throw Error(role+': dead mobile tab');
    // 20.11 owner-approved bottom navigation. Driver Air must remain immediately accessible.
    if(mode==='client'){
      const expected=['#/','#/orders','#/air','#/garage','#/shop','#/profile'];
      if(JSON.stringify(links)!==JSON.stringify(expected))
        throw Error(role+': agreed Air, vehicle and parts bottom tabs changed '+JSON.stringify(links));
      const names=await tabs.allTextContents();
      if(!names.some(t=>t.trim()==='Эфир')||!names.some(t=>t.trim()==='Магазин'))
        throw Error(role+': missing driver Air or bottom store label');
    }
    if(mode==='service'){
      const expected=['#/base','#/base/inbox','#/shop','#/base/money','#/profile'];
      if(JSON.stringify(links)!==JSON.stringify(expected))
        throw Error(role+': STO work actions and parts tab changed '+JSON.stringify(links));
    }
    if(mode!=='client' && links.some(v=>v==='#/sos'||v==='#/garage'))
      throw Error(role+': unauthorized client navigation');
    if(role==='master_service'){
      await page.locator('.account-menu > summary').click();
      const link=page.locator('.account-menu a[href="#/work"]');
      if(!await link.count())throw Error('Hybrid partner has no mobile master workplace');
      await page.goto(BASE+'/#/work',{waitUntil:'domcontentloaded'});
      await page.locator('.app.role-performer').waitFor();
      await page.goto(BASE+'/#/base',{waitUntil:'domcontentloaded'});
      await page.locator('.app.role-service').waitFor();
    }
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+3);
    if(overflow)throw Error(role+': mobile horizontal overflow');
    await page.waitForTimeout(400);
    await page.screenshot({path:'e2e/shots/android-approved/'+role+'.png'});
    for(const href of links){
      await page.goto(BASE+'/'+href,{waitUntil:'domcontentloaded'});
      await page.locator('.app').waitFor();
      if(await page.getByText('Такой страницы нет').count())throw Error(role+': missing route '+href);
      if(await page.getByText('Не удалось открыть раздел').count())throw Error(role+': crashed route '+href);
      if(pageErrors.length)throw Error(role+': JavaScript error on '+href+': '+pageErrors.join('; '));
    }
    if(mode==='performer'){
      await page.goto(BASE+'/#/work/chats',{waitUntil:'domcontentloaded'});
      await page.getByRole('heading',{name:'Чаты по заявкам'}).waitFor();
      if(await page.getByText('Такой страницы нет').count())throw Error(role+': chat inbox dead');
    }
    await ctx.close();
    console.log('Android workspace role OK:',role,links.length,'tabs');
  }
}finally{await browser.close()}
