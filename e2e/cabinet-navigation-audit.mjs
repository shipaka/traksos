// Full non-destructive navigation audit for every staff, customer and performer cabinet.
// Runs after role-matrix.mjs and admin-master-switch.mjs on synthetic local accounts.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
if (!['localhost','127.0.0.1'].includes(new URL(BASE).hostname))
  throw Error('Cabinet navigation audit is restricted to local CI');

const accounts = [
  ['owner', '+79990000141', 'Test-Role-Only-2026!', '#/'],
  ['driver', '+79990000142', 'Test-Role-Only-2026!', '#/'],
  ['master', '+79992223344', 'TrakSOS-Test-2026!', '#/work'],
  ['moderator_master', '+79990000147', 'Test-Role-Only-2026!', '#/moderation'],
  ['tow', '+79990000143', 'Test-Role-Only-2026!', '#/work'],
  ['service', '+79990000144', 'Test-Role-Only-2026!', '#/base'],
  ['master_service', '+79990000146', 'Test-Role-Only-2026!', '#/base'],
  ['insurer', '+79990000145', 'Test-Role-Only-2026!', '#/insurance'],
  ['admin', '+79990000001', 'TrakSOS-Test-2026!', '#/admin'],
];
const browser = await chromium.launch();
const report = [];
try {
  for (const [kind, phone, password, initial] of accounts) {
    const response = await fetch(BASE+'/api/auth/login',{method:'POST',
      headers:{'content-type':'application/json'},body:JSON.stringify({phone,password})});
    if(!response.ok) throw Error(kind+': login fixture failed '+response.status);
    const {token}=await response.json();
    const ctx=await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU'});
    const page=await ctx.newPage();
    const errors=[];
    page.on('pageerror', e=>errors.push(e.message));
    await page.addInitScript(t=>localStorage.setItem('traksos.token',t),token);
    await page.goto(BASE+'/'+initial,{waitUntil:'domcontentloaded'});
    await page.locator('.account-menu > summary').waitFor();
    // Previous tests may publish a client offer. A user can have multiple
    // roles, but only the active cabinet's terms may cover its navigation.
    const offersResponse = await fetch(BASE+'/api/me/offers',{
      headers:{authorization:'Bearer '+token}});
    if(!offersResponse.ok)throw Error(kind+': failed loading required offer status');
    const offers = await offersResponse.json();
    const audienceByCabinet={
      owner:['client'],driver:['client'],master:['performer'],tow:['performer'],
      service:['performer'],master_service:['performer'],
      insurer:['insurer'],admin:[],moderator_master:[]
    };
    const activeAudiences=audienceByCabinet[kind]??[];
    const pendingOffers=offers.filter(item=>item.current && !item.accepted &&
      (item.audience==='privacy'||activeAudiences.includes(item.audience)));
    for(const item of pendingOffers){
      const modal=page.getByRole('dialog',{name:item.name});
      await modal.waitFor({state:'visible',timeout:12000});
      await modal.locator('input[type=checkbox]').check();
      await modal.getByRole('button',{name:'Принимаю'}).click();
      await modal.waitFor({state:'detached',timeout:12000});
    }
    // Catch stale PC and narrow-phone layouts in each real role, not only at 390px.
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({width, height: width === 1440 ? 900 : 844});
      const size = await page.evaluate(() => ({
        actual: document.documentElement.scrollWidth,
        available: document.documentElement.clientWidth,
      }));
      if (size.actual > size.available + 3)
        throw Error(kind + ': role layout overflows at ' + width + 'px');
    }
    await page.setViewportSize({width:390,height:844});
    await page.locator('.account-menu > summary').click();
    const links=await page.locator('.account-menu nav a[href^="#/"]').evaluateAll(
      els=>els.map(el=>({href:el.getAttribute('href'),text:(el.textContent??'').trim()}))
    );
    if(links.length < 6)throw Error(kind+': almost empty cabinet menu');
    const duplicates=links.filter((link,index)=>links.findIndex(x=>x.href===link.href)!==index);
    if(duplicates.length)throw Error(kind+': repeated cabinet menu destinations '+JSON.stringify(duplicates));
    for(const required of ['#/profile','#/support','#/offer/privacy']){
      if(!links.some(x=>x.href===required))throw Error(kind+': required destination removed '+required);
    }
    if((kind==='master'||kind==='tow'||kind==='service'||kind==='master_service')&&links.some(x=>x.href==='#/air'))
      throw Error(kind+': driver-only community exposed in partner menu');

    // Each account has its own direct economic explanation, not a generic
    // performer pricing page or unapproved commission in the customer menu.
    const financeMenu=links.find(l=>l.href==='#/economics');
    if(!financeMenu || !financeMenu.text.includes('Комиссии, баллы и рефералы'))
      throw Error(kind+': financial conditions and referral terms are missing from cabinet menu');
    await page.goto(BASE+'/#/economics',{waitUntil:'domcontentloaded'});
    await page.getByRole('heading',{name:'Комиссии, баллы и рефералы',exact:true}).waitFor();
    const guide=page.locator('section.economics-guide');
    await guide.waitFor({timeout:12000});
    const financeText=(await guide.innerText()).replace(/\s+/g,' ');
    if(!financeText.includes('Математика на примерах') &&
      !['admin','insurer'].includes(kind) && kind!=='moderator_master')
      throw Error(kind+': economics guide has no example math');
    if(kind==='owner'||kind==='driver') {
      if(!financeText.includes('10 500') || financeText.includes('исполнителю'))
        throw Error(kind+': owner financial example or role privacy incorrect');
    }
    if(kind==='master'||kind==='tow') {
      if(!financeText.includes('9 500') || financeText.includes('клиент оплачивает'))
        throw Error(kind+': performer financial example or role privacy incorrect');
    }
    if(kind==='insurer' && !financeText.includes('Универсальная комиссия'))
      throw Error(kind+': insurer must not inherit the master commission');


    // Invite bonuses are calculated with different role-specific caps.
    // This check also guards the registration welcome gift against stale FAQ text.
    if(links.some(link=>link.href==='#/invite')) {
      await page.goto(BASE+'/#/invite',{waitUntil:'domcontentloaded'});
      // The approved 617 hero renders before the referral API response.
      // Wait for the REAL points and share-link form, not the static hero title.
      await page.locator('.desktop-content > main input[readonly]').waitFor({state:'visible',timeout:12000});
      await page.locator('.desktop-content > main').getByText('Ваши баллы',{exact:true}).waitFor();
      const invitation=(await page.locator('main').textContent()??'').replace(/\s+/g,' ');
      if((kind==='owner'||kind==='driver') && !invitation.includes('не более 10% стоимости услуги'))
        throw Error(kind+': the invitation page shows the wrong client points cap');
      if(['master','tow','service','master_service'].includes(kind) &&
         (!invitation.includes('не более 50% фактически начисленной комиссии TrakSOS') ||
          !invitation.includes('акцией 0% списание баллов исполнителя равно нулю')))
        throw Error(kind+': the invitation page shows the wrong performer points cap');
      if(!invitation.includes('Приветственные баллы новому клиенту начисляются при регистрации'))
        throw Error(kind+': welcome reward timing contradicts actual referral logic');
    }
    // The phone keeps its complete menu; desktop must preserve all those
    // destinations exactly once across its left and right navigation.
    await page.setViewportSize({width:1440,height:900});
    await page.locator('.account-menu > summary').click();
    const left=await page.locator('.desktop-sidebar .desktop-nav a[href^="#/"]').evaluateAll(els=>els.map(el=>el.getAttribute('href')));
    const right=await page.locator('.account-menu nav a[href^="#/"]').evaluateAll(els=>els.map(el=>el.getAttribute('href')));
    const combined=[...left,...right];
    if(new Set(combined).size!==combined.length)throw Error(kind+': duplicate desktop menu destination');
    if(links.some(link=>!combined.includes(link.href)))throw Error(kind+': desktop menu lost a mobile destination');
    const personal=new Set(['#/profile','#/privacy','#/work/me','#/work/me/about','#/work/me/phone','#/work/me/cars','#/work/me/tax','#/base/me']);
    if(!right.includes('#/profile')||right.some(href=>!personal.has(href))||left.some(href=>personal.has(href)))
      throw Error(kind+': desktop personal/work navigation not separated');
    if(!left.includes('#/economics')||!left.includes('#/support')||!left.includes('#/learn'))
      throw Error(kind+': desktop work/help destination missing');
    if(!await page.locator('.desktop-sidebar .account-menu-tour').isVisible())
      throw Error(kind+': desktop manual tour missing');
    if(!await page.locator('.account-menu-logout').isVisible())throw Error(kind+': desktop logout missing');
    await page.locator('.account-menu > summary').click();
    await page.setViewportSize({width:390,height:844});
    const paths=[...new Set(links.map(l=>l.href))];
    if(kind!=='admin' && paths.some(path=>path.startsWith('#/admin/section')))
      throw Error(kind+': sees administrator menu routes');
    if(kind==='admin' && !paths.includes('#/admin/section/queue'))
      throw Error('Admin moderation shortcut missing');
    for(const href of paths){
      console.log('Navigating:',kind,href);
      await page.goto(BASE+'/'+href,{waitUntil:'domcontentloaded'});
      try {
        await page.locator('.app').waitFor({timeout:12000});
      } catch {
        throw Error(kind+': app shell did not render for '+href+
          ' (actual URL '+page.url()+', JS errors: '+errors.join('; ')+')');
      }
      const state=await page.evaluate(()=>({
        missing:document.querySelector('main')?.textContent?.includes('Такой страницы нет'),
        overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+3,
      }));
      if(state.missing)throw Error(kind+': dead link '+href);
      if(state.overflow)throw Error(kind+': horizontal overflow on '+href);
      if(errors.length)throw Error(kind+': script error at '+href+': '+errors.join('; '));
    }
    const invalidRoutes={
      owner:['#/tech/retired-page'],
      driver:['#/tech/retired-page'],
      master:['#/work/me/retired-page','#/work/retired-page'],
      tow:['#/work/me/retired-page'],
      service:['#/base/retired-page'],
      master_service:['#/base/retired-page'],
      insurer:['#/insurance/retired-page'],
    }[kind]??[];
    for(const href of invalidRoutes){
      await page.goto(BASE+'/'+href,{waitUntil:'domcontentloaded'});
      await page.locator('main.tr-approved-route-unavailable').waitFor({state:'visible',timeout:12000});
      if(await page.locator('main.approved-pc,main.performer-workspace,main.base-workspace').count())
        throw Error(kind+': unrelated dashboard fallback on unknown route '+href);
      if(errors.length)throw Error(kind+': script error on invalid route '+href+': '+errors.join('; '));
    }
    report.push({role:kind,visited:paths.length,unknownRoutesRejected:invalidRoutes.length});
    await ctx.close();
  }
} finally {await browser.close();}
console.log('Validated all menu routes in local browser:',JSON.stringify(report));
