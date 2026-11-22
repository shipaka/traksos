// Full non-destructive navigation audit for every staff, customer and performer cabinet.
// Runs after role-matrix.mjs and admin-master-switch.mjs on synthetic local accounts.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

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
const OUT='e2e/shots/inner-route-audit';
await mkdir(OUT,{recursive:true});
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
    // Previous E2E tests publish a new client offer. All synthetic users must
    // accept it through the actual UI before their navigation can be audited.
    const offersResponse = await fetch(BASE+'/api/me/offers',{
      headers:{authorization:'Bearer '+token}});
    if(!offersResponse.ok)throw Error(kind+': failed loading required offer status');
    const offers = await offersResponse.json();
    const pendingOffers = offers.filter(item=>item.current && !item.accepted);
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
      await page.getByRole('heading',{name:'Пригласить в TrakSOS'}).waitFor();
      const invitation=(await page.locator('main').textContent()??'').replace(/\s+/g,' ');
      if((kind==='owner'||kind==='driver') && !invitation.includes('не более 10% стоимости услуги'))
        throw Error(kind+': the invitation page shows the wrong client points cap');
      if(['master','tow','service','master_service'].includes(kind) &&
         !invitation.includes('не более 50% комиссии TrakSOS'))
        throw Error(kind+': the invitation page shows the wrong performer points cap');
      if(!invitation.includes('Приветственные баллы новому клиенту начисляются при регистрации'))
        throw Error(kind+': welcome reward timing contradicts actual referral logic');
    }
    const paths=[...new Set(links.map(l=>l.href))];
    if(kind!=='admin' && paths.some(path=>path.startsWith('#/admin/section')))
      throw Error(kind+': sees administrator menu routes');
    if(kind==='admin' && !paths.includes('#/admin/section/queue'))
      throw Error('Admin moderation shortcut missing');
    const coverage=[];
    // Reproduce actual clicks, not merely a hard-coded GET/navigation call.
    // Audit every menu destination in both owner-approved desktop and phone
    // compositions. Never press a payment, profile-save, SOS or cancel action.
    for(const width of [390,1440]) {
      await page.setViewportSize({width,height:width===390?844:900});
      for(const href of paths){
        console.log('Clicking role menu:',kind,width,href);
        await page.goto(BASE+'/'+initial,{waitUntil:'domcontentloaded'});
        const menu=page.locator('.account-menu > summary');
        await menu.waitFor();
        await menu.click();
        const link=page.locator('.account-menu nav a[href="'+href+'"]').first();
        if(await link.count()!==1)throw Error(kind+': role menu link vanished '+href);
        await link.click();
        await page.waitForURL(url=>url.hash===href,{timeout:12000});
        await page.locator('.app > header.top').waitFor();
        const state=await page.evaluate(()=>{
          const app=document.querySelector('.app');
          const main=document.querySelector('.desktop-content main');
          const logo=document.querySelector('.top .tr-approved-brand-logo img');
          const css=app?getComputedStyle(app):null;
          return {
            missing:main?.textContent?.includes('Такой страницы нет'),
            failed:document.body.textContent?.includes('Не удалось открыть раздел'),
            overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+3,
            obsolete:!!document.querySelector('.desktop-content .public-landing,.desktop-content .desktop-hero,.desktop-content .desktop-quick-links'),
            roleApp:app?.className.includes('role-')||false,
            logo:logo?.getAttribute('src'),
            accent:css?.getPropertyValue('--accent').trim(),
            help:!!document.querySelector('main.approved-help'),
            width:document.documentElement.clientWidth
          };
        });
        if(state.missing||state.failed||state.overflow||state.obsolete||!state.roleApp||
           state.logo!=='/traksos-brand-logo-approved-618.png')
          throw Error(kind+' '+width+'px '+href+': returned obsolete or broken cabinet screen '+JSON.stringify(state));
        if(width>=900 && state.accent!=='#ff701c')
          throw Error(kind+' '+width+'px '+href+': approved desktop palette missing '+JSON.stringify(state));
        if(href==='#/help' && !state.help)
          throw Error(kind+' '+width+'px '+href+': legacy help route returned instead of rebuilt help');
        // Approved-style candidate PROFILE: desktop has its own cohesive visual,
        // while phone/Android retains the earlier plain profile composition.
        if(href==='#/profile'){
          const profile=page.locator('main.account-profile-page');
          await profile.waitFor({state:'visible'});
          const hero=profile.locator('.account-profile-hero');
          const originalTitle=profile.locator('h1.account-profile-mobile-title');
          if(width>=900){
            if(!await hero.isVisible()||await originalTitle.isVisible()||
               await hero.locator('.account-profile-identity').count()!==1 ||
               await hero.locator('.account-profile-hero-art').count()!==0)
              throw Error(kind+': new role profile visual missing on desktop');
            const shortcuts=profile.locator('.account-profile-shortcuts button');
            if(await shortcuts.count()!==3)throw Error(kind+': profile section shortcuts missing');
            await shortcuts.nth(1).click();
            if(!await profile.locator('#account-profile-security').isVisible())
              throw Error(kind+': profile security shortcut does not reveal real section');
          }else if(await hero.isVisible()||!await originalTitle.isVisible()){
            throw Error(kind+': approved 618 mobile profile was replaced by desktop redesign');
          }
        }
        if(errors.length)throw Error(kind+' '+width+'px '+href+': JS error '+errors.join('; '));
        // Every desktop menu destination produces a real Chromium screenshot
        // on this exact commit, not a static approved design mockup.
        if(width===1440){
          await page.evaluate(()=>window.scrollTo({top:0,left:0,behavior:'instant'}));
          await page.screenshot({path:OUT+'/'+kind+'-'+href.slice(2).replace(/[^a-z0-9-]/gi,'-')+'.png',animations:'disabled'});
        }
        coverage.push({href,width,accent:state.accent});
      }
    }
    // Regression: a typo/deep-link into a role must never silently mount
    // a dashboard or the old generic help page.
    const invalid={
      owner:['#/tech/retired-page'],
      driver:['#/tech/retired-page'],
      master:['#/work/me/retired-page'],
      tow:['#/work/me/retired-page'],
      service:['#/base/retired-page'],
      master_service:['#/base/retired-page'],
      insurer:['#/insurance/retired-page'],
    }[kind]||[];
    for(const href of invalid){
      await page.goto(BASE+'/'+href,{waitUntil:'domcontentloaded'});
      await page.locator('main.tr-approved-route-unavailable').waitFor({state:'visible'});
      if(await page.locator('main.approved-pc,main.performer-workspace,main.base-workspace').count())
        throw Error(kind+': obsolete dashboard fallback on unknown route '+href);
    }
    report.push({role:kind,visited:paths.length,verifiedRouteSizes:coverage.length,unknownRoutesRejected:invalid.length});
    await ctx.close();
  }
} finally {await browser.close();}
await writeFile(OUT+'/route-report.json',JSON.stringify({source:'real Playwright Chromium, local isolated fixtures',report},null,2));
console.log('Validated every link in every accessible menu (phone + desktop):',JSON.stringify(report));
