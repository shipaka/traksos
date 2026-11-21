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
    // Brand-new tow accounts have no profile yet. #/work now displays the
    // canonical four-step PerformerOnboarding, NOT the retired "Заполните профиль"
    // card from Work(). Exercise that real screen before provisioning the test
    // profile via the ordinary authenticated API for the workspace smoke.
    if(role==='tow'){
      const profileResponse=await fetch(BASE+'/api/performer/profile',{
        headers:{authorization:'Bearer '+token}
      });
      if(!profileResponse.ok)throw Error(role+': cannot inspect performer onboarding '+profileResponse.status);
      const profile=await profileResponse.json();
      if(!profile){
        const setup=page.locator('main.performer-onboarding');
        await setup.waitFor({state:'visible',timeout:15000});
        await setup.getByRole('heading',{name:'Станьте исполнителем'}).waitFor({state:'visible'});
        const towRole=setup.getByRole('button',{name:'Эвакуатор',exact:true});
        if(await towRole.getAttribute('aria-pressed')!=='true')
          throw Error('tow: initial approved onboarding must preselect the registered tow role');
        if(await page.getByText('Заполните профиль',{exact:true}).count())
          throw Error('tow: retired Work() onboarding card leaked into native 618 shell');
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
    // Android on a tablet/resizable wide WebView must keep the approved 618.png
    // client shell. Desktop CSS breakpoints must not remount legacy Home().
    if(mode==='client'){
      for(const width of [900,960,1200]){
        await page.setViewportSize({width,height:844});
        await page.locator('main.client-dashboard .and19-workspace.and19-client')
          .waitFor({state:'visible',timeout:10000});
        if(!await page.locator('.and19-client').isVisible())
          throw Error(role+': wide Android dashboard CSS is hidden at '+width+'px');
        const old=await page.locator('.desktop-hero, .desktop-quick-links').count();
        if(old)throw Error(role+': legacy desktop dashboard leaked into Android '+width+'px');
        const bounds=await page.evaluate(()=>({
          viewport:document.documentElement.clientWidth,
          page:document.documentElement.scrollWidth
        }));
        if(bounds.page>bounds.viewport+3)
          throw Error(role+': wide Android viewport overflows '+width+'px '+JSON.stringify(bounds));
        await page.screenshot({path:'e2e/shots/android-approved/'+role+'-native-'+width+'.png'});
      }
      await page.setViewportSize({width:390,height:844});
    }
    if(mode==='client'){
      const desk=page.locator('.and19-client');
      await desk.waitFor({state:'visible'});
      if(await desk.locator('.and19-services > a').count()!==4)throw Error(role+': missing 4 service actions');
      const urls=await desk.locator('.and19-services>a').evaluateAll(a=>a.map(x=>x.getAttribute('href')));
      if(JSON.stringify(urls)!==JSON.stringify(['#/sos','#/new/tow','#/services','#/new/consult']))
        throw Error(role+': service destinations changed '+JSON.stringify(urls));
      const garage=desk.locator('.and19-equipment');
      if(!(await garage.getAttribute('href')||'').startsWith('#/garage'))throw Error(role+': vehicle history does not open a real garage card');
      if(await desk.locator('.and19-sos').getAttribute('href')!=='#/sos')throw Error(role+': SOS missing');
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
      const expected=['#/','#/orders','#/air','#/garage','#/menu'];
      if(JSON.stringify(links)!==JSON.stringify(expected))
        throw Error(role+': approved 618.png has exactly Main / Orders / Air / Vehicle / Menu '+JSON.stringify(links));
      const names=await tabs.allTextContents();
      if(!names.some(t=>t.trim()==='Эфир')||!names.some(t=>t.trim()==='Меню')||
         names.some(t=>t.trim()==='Магазин'))
        throw Error(role+': owner-approved bottom bar differs from 618.png');
      await page.locator('.tabbar a[href="#/menu"]').click();
      const menu=page.locator('main.tr-mobile-menu-page');
      await menu.waitFor({state:'visible',timeout:10000});
      if(!await menu.locator('a[href="#/shop"]').count())
        throw Error('Parts shop must remain accessible via role Menu, not an obsolete sixth tab');
      await page.goto(BASE+'/'+home,{waitUntil:'domcontentloaded'});
    }
    // Fleet management must not fall back to the old desktop form inside APK.
    if(role==='owner'){
      await page.goto(BASE+'/#/fleet',{waitUntil:'domcontentloaded'});
      await page.locator('main.fleet-mobile-approved').waitFor({state:'visible'});
      if(await page.locator('main.fleet-workspace .internal-role-hero-fleet').count())
        throw Error('owner: old Fleet desktop screen appeared inside Android');
      // A brand-new owner genuinely has ZERO vehicles. Never manufacture
      // fictitious trucks just to satisfy a screenshot test: compare the
      // rendered cards to real fleet API records for this isolated account.
      const fleetResponse=await fetch(BASE+'/api/fleet',{
        headers:{authorization:'Bearer '+token}
      });
      if(!fleetResponse.ok)throw Error('owner: cannot load real fleet API: '+fleetResponse.status);
      const fleetData=await fleetResponse.json();
      const expectedCars=fleetData.cars??[];
      const cards=page.locator('.fleet-mobile-car-link[href^="#/garage/"]');
      const actualCards=await cards.count();
      if(actualCards!==expectedCars.length)
        throw Error('owner: vehicle cards do not match real server-owned fleet '+JSON.stringify({
          expected:expectedCars.length,actual:actualCards
        }));
      if(expectedCars.length===0){
        const add=page.getByRole('link',{name:'Добавьте машину'});
        if(!await add.isVisible())
          throw Error('owner: empty fleet must invite the user to add a vehicle');
        await add.click();
        await page.waitForURL('**/#/garage',{timeout:10000});
        await page.goto(BASE+'/#/fleet',{waitUntil:'domcontentloaded'});
        await page.locator('main.fleet-mobile-approved').waitFor({state:'visible'});
      }else{
        const expectedHref='#/garage/'+expectedCars[0].id;
        if(await cards.first().getAttribute('href')!==expectedHref)
          throw Error('owner: actual vehicle history route differs from backend vehicle ID');
      }
      if(!await page.locator('.fleet-mobile-settings summary').count())
        throw Error('owner: settings were lost while replacing the legacy UI');
      for(const width of [320,390]){
        await page.setViewportSize({width,height:844});
        const size=await page.evaluate(()=>({
          client:document.documentElement.clientWidth,
          scroll:document.documentElement.scrollWidth
        }));
        if(size.scroll>size.client+3)
          throw Error('owner: new fleet overflows at '+width+'px '+JSON.stringify(size));
        await page.screenshot({path:'e2e/shots/android-approved/owner-fleet-'+width+'.png',
          fullPage:true});
      }
      await page.goto(BASE+'/'+home,{waitUntil:'domcontentloaded'});
    }
    if(mode==='service'){
      const expected=['#/base','#/base/inbox','#/shop','#/base/money','#/menu'];
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
      await page.locator('.desktop-content > main').getByRole('heading',{name:'Чаты по заявкам'}).first().waitFor();
      if(await page.getByText('Такой страницы нет').count())throw Error(role+': chat inbox dead');
    }
    await ctx.close();
    console.log('Android workspace role OK:',role,links.length,'tabs');
  }
}finally{await browser.close()}
