// Real Chromium evidence from the SAME isolated sandbox candidate image/API.
// No mocked components: use the HMAC one-time entry and actual role pages.
// Runs exclusively on a disposable GitHub Actions runner, local loopback only.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { issueSandboxTicket, SANDBOX_ROLES, SANDBOX_LANDING } from '../server/src/services/sandboxTickets.ts';

const base=process.env.SANDBOX_BROWSER_BASE_URL ?? '';
const secret=process.env.SANDBOX_SHARED_SECRET ?? '';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base) || secret.length<32 ||
    process.env.TRAKSOS_RUN_DISPOSABLE_SCENARIO!=='true')
  throw Error('Browser review requires a local disposable sandbox and ticket secret');

const roles=SANDBOX_ROLES.map(role => [role,SANDBOX_LANDING[role]]);
const out='e2e/shots/sandbox-real-browser';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const failures=[];
try{
  // Independent map failures must not suppress the remaining 12-role
  // evidence on the same exact SHA. Record them as hard failures at the end.
  try{
  // Owner-approved 617 guest PC map must be an actual accessible expanded
  // network, not a painted or falsely populated static screenshot. Inspect
  // the SAME disposable server that supplies all real cabinet screenshots.
  {
    const context=await browser.newContext({viewport:{width:1440,height:900},locale:'ru-RU'});
    const page=await context.newPage();
    try{
      await page.goto(base+'/#/',{waitUntil:'domcontentloaded'});
      const opener=page.getByRole('button',{name:'Развернуть карту партнёров'});
      await opener.waitFor({state:'visible',timeout:25_000});
      if(!(await page.locator('aside.owner20-map .owner20-map-demo-tag').isVisible()))
        throw Error('Approved 617 compact map lost its DEMO label');
      await opener.click();
      const dialog=page.getByRole('dialog',{name:'Карта партнёров TrakSOS'});
      await dialog.waitFor({state:'visible',timeout:15_000});
      const evidence=await page.evaluate(async()=>{
        const response=await fetch('/api/public/partner-map',{cache:'no-store'});
        const payload=await response.json();
        const modal=document.querySelector('.tr-network-dialog');
        if(!modal)throw Error('Expanded map DOM missing');
        const rect=modal.getBoundingClientRect();
        return {status:response.status,source:payload.source,
          ids:Array.isArray(payload.points)?payload.points.map(p=>p.id):null,
          width:rect.width,height:rect.height,viewport:[innerWidth,innerHeight],
          overlay:!!document.querySelector('.tr-network-backdrop'),
          markers:[...modal.querySelectorAll('button.tr-network-marker')].length};
      });
      if(evidence.status!==200 || evidence.source!=='verified_stationary_opt_in' ||
         !Array.isArray(evidence.ids) || !evidence.overlay ||
         evidence.width<.64*evidence.viewport[0] || evidence.width>.75*evidence.viewport[0] ||
         evidence.height<.64*evidence.viewport[1] || evidence.height>.75*evidence.viewport[1])
        throw Error('Real 70% public partner map failed geometry/API contract: '+JSON.stringify(evidence));
      if(evidence.ids.length===0){
        await dialog.getByText('Пока нет СТО, разрешивших показывать проверенное местоположение',{exact:false}).waitFor();
        if(evidence.markers!==0)
          throw Error('Map invented yellow pins when no approved opted-in workshops exist');
      }else if(evidence.markers===0){
        // A populated API may be outside the initial Russia map viewport;
        // no pin count is assumed until the map is panned/zoomed.
        if(!evidence.ids.every(x=>typeof x==='string'))
          throw Error('Non-stationary identifiers in public map payload');
      }
      await page.screenshot({path:out+'/guest-1440-expanded-partner-network.png',
        fullPage:false,animations:'disabled'});
      await page.keyboard.press('Escape');
      await dialog.waitFor({state:'detached'});
      // Focus is restored after React's layout/effect frame; asserting in
      // the very same tick as unmount would invent an intermittent failure.
      await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')===
        'Развернуть карту партнёров',null,{timeout:3000});
      if(!(await page.locator('aside.owner20-map .owner20-map-demo-tag').isVisible()))
        throw Error('Collapsed approved map changed after accessible close');
      console.log('APPROVED 617 PUBLIC PARTNER MAP PASS',evidence.ids.length,
        'verified points',Math.round(evidence.width)+'x'+Math.round(evidence.height));
      // Secondary clickable control must work too, and clicking the backdrop
      // must close the modal without changing the approved compact 617 art.
      const footer=page.getByRole('button',{name:'Подробнее о покрытии'});
      await footer.click();
      await dialog.waitFor({state:'visible'});
      await page.mouse.click(3,3);
      await dialog.waitFor({state:'detached'});
      await page.waitForFunction(()=>document.activeElement?.textContent?.includes('Подробнее о покрытии'),
        null,{timeout:3000});
    }finally{await context.close();}
  }
  }catch(error){
    const detail=String(error instanceof Error ? error.stack??error.message : error);
    failures.push({role:'guest-partner-map',width:1440,detail});
    console.error('PUBLIC PARTNER MAP FAIL',1440,detail);
  }
  // Cover the real guest desktop breakpoints and keyboard activation, beyond
  // the 1440px hero screenshot. 900/1024 can intentionally use wider dialogs
  // for touch-friendly controls, while 1280+ uses the approved 70% overlay.
  for(const width of [900,1024,1280,1536,1672]){
    const context=await browser.newContext({viewport:{width,height:900},locale:'ru-RU'});
    const page=await context.newPage();
    try{
      await page.goto(base+'/#/',{waitUntil:'domcontentloaded'});
      const trigger=page.getByRole('button',{name:'Развернуть карту партнёров'});
      await trigger.waitFor({state:'visible',timeout:25_000});
      await trigger.focus();
      await page.keyboard.press('Enter');
      const dialog=page.getByRole('dialog',{name:'Карта партнёров TrakSOS'});
      await dialog.waitFor({state:'visible'});
      const rect=await dialog.boundingBox();
      const expectedWidth=width<=1100?.86:.70;
      const expectedHeight=width<=1100?.78:.70;
      if(!rect || Math.abs(rect.width/width-expectedWidth)>.035 ||
         Math.abs(rect.height/900-expectedHeight)>.035)
        throw Error('Expanded map wrong responsive footprint '+width+': '+JSON.stringify(rect));
      await page.screenshot({path:out+'/guest-'+width+'-expanded-partner-network.png',
        fullPage:false,animations:'disabled'});
      await page.keyboard.press('Escape');
      await dialog.waitFor({state:'detached'});
      await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')===
        'Развернуть карту партнёров',null,{timeout:3000});
      console.log('APPROVED MAP KEYBOARD/RESPONSIVE PASS',width,Math.round(rect.width),Math.round(rect.height));
    }catch(error){
      const detail=String(error instanceof Error ? error.stack??error.message : error);
      failures.push({role:'guest-partner-map',width,detail});
      console.error('PUBLIC PARTNER MAP FAIL',width,detail);
      try{
        await page.screenshot({path:out+'/guest-'+width+'-partner-network-ERROR.png',
          fullPage:false,animations:'disabled'});
      }catch{/* The browser's original failure is authoritative. */}
    } finally {await context.close();}
  }
  // 960px is crucial: formerly between mobile 899px and PC 1000px,
  // silently displaying the retired desktop dashboard.
  for(const width of [320,390,960,1440]){
    for(const [role,landing] of roles){
      const context=await browser.newContext({
        viewport:{width,height:width===1440?900:844},locale:'ru-RU',
      });
      const page=await context.newPage();
      const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      try{
        // A signed owner handoff must show a visible Admin/Back control; a
        // regular direct sandbox ticket has no invented return destination.
        const qaReturnUrl=role==='inspection' && width===390
          ? 'https://example.test/#/admin/test-center' : '';
        const ticket=issueSandboxTicket(role,secret,Date.now(),qaReturnUrl);
        await page.goto(base+'/#/sandbox-enter?ticket='+encodeURIComponent(ticket),{
          waitUntil:'domcontentloaded',
        });
        await page.locator('header.top .sandbox-test-badge').filter({hasText:'Тест'}).first().waitFor({timeout:25_000});
        await page.waitForFunction(expected=>location.hash===expected,landing,{timeout:20_000});
        if(qaReturnUrl){
          const back=page.locator('header.top .sandbox-test-badge');
          await back.waitFor({state:'visible'});
          const visibleLabel=(await back.textContent())?.trim()??'';
          if(await back.getAttribute('href')!==qaReturnUrl ||
             !visibleLabel.includes('Admin') || !visibleLabel.includes('Назад'))
            throw Error('Signed sandbox handoff has no visible Admin / Back to owner test center');
        }
        // The role needs an actually usable desk. Clear mandatory legal
        // acceptance through the REAL interface, then close optional first-use
        // invitations before screenshot evidence. These are fake sandbox users;
        // never accept any legal document on behalf of a production account.
        await page.waitForTimeout(450);
        let accepted=0;
        const legal=page.locator('div.call[role="dialog"][aria-modal="true"]');
        for(let attempt=0;attempt<8;attempt++){
          if(!(await legal.count()) || !(await legal.first().isVisible()))break;
          const dialog=legal.first();
          await dialog.locator('input[type="checkbox"]').check();
          await dialog.getByRole('button',{name:'Принимаю',exact:true}).click();
          accepted++;
          await page.waitForTimeout(260);
        }
        if(await legal.count() && await legal.first().isVisible())
          throw Error('Mandatory agreement still blocks sandbox '+role);
        const optional=[
          page.getByRole('button',{name:'Не сейчас',exact:true}),
          page.getByRole('button',{name:'Позже',exact:true}),
          page.getByRole('button',{name:'Понятно',exact:true}),
        ];
        for(const button of optional){
          if(await button.count() && await button.first().isVisible())await button.first().click();
        }
        if(await page.getByRole('dialog',{name:'Короткая экскурсия по кабинету'}).count())
          await page.getByRole('dialog',{name:'Короткая экскурсия по кабинету'})
            .getByRole('button',{name:'Закрыть',exact:true}).click();
        await page.waitForTimeout(200);
        if(await page.locator('[role="dialog"][aria-modal="true"]').count())
          throw Error('Unexpected blocking dialog after login in sandbox '+role);
        const marker=(await page.locator('header.top .sandbox-test-badge')
          .filter({hasText:'Тест'}).first().innerText()).trim();
        // Direct sandbox tickets use a small "Тест" badge, while supervised
        // owner/admin handoffs show Admin and, when signed, a back action.
        if(!['Тест','Admin · Тест','Admin · Тест · ← Назад'].includes(marker))
          throw Error('Unexpected sandbox badge: '+role+' '+marker);
        if(qaReturnUrl && !marker.includes('Назад'))
          throw Error('Signed owner handoff lost Admin/Back: '+role);
        if(role==='admin' && !marker.includes('Admin'))
          throw Error('Admin sandbox supervisor badge missing');
        if(['master','master_service','tow'].includes(role) && width===390){
          const search=page.locator('.work-mobile-searchbar input[type=search]');
          await search.waitFor({state:'visible'});
          const colors=await search.evaluate(input=>({
            field:getComputedStyle(input).backgroundColor,
            toolbar:getComputedStyle(input.parentElement).backgroundColor,
            hint:getComputedStyle(input,'::placeholder').color,
          }));
          if(colors.field!=='rgba(0, 0, 0, 0)' || colors.toolbar!=='rgb(28, 45, 61)' ||
             colors.hint!=='rgb(183, 199, 217)')
            throw Error(role+': unreadable work search '+JSON.stringify(colors));
          await search.click();
          await page.getByRole('group',{name:'Что ищем'}).waitFor();
          await page.getByRole('button',{name:'Свернуть поиск',exact:true}).click();
        }
        if(role==='client' && width===1440){
          // The account dropdown must remain usable when the mouse crosses
          // the deliberate 8px visual gap, then disappear on pointer exit.
          // Also keep native keyboard Escape/focus, no manual link navigation.
          const menu=page.locator('header.top details.account-menu');
          const trigger=menu.locator('summary');
          await trigger.click();
          if(await menu.getAttribute('open')===null)
            throw Error('Account menu did not open');
          const triggerRect=await trigger.boundingBox();
          const navRect=await menu.locator('nav').boundingBox();
          if(!triggerRect || !navRect)throw Error('Account menu geometry missing');
          const x=triggerRect.x+triggerRect.width/2;
          await page.mouse.move(x,triggerRect.y+triggerRect.height/2);
          await page.mouse.move(x,triggerRect.y+triggerRect.height+3);
          await page.mouse.move(x,navRect.y+12);
          if(await menu.getAttribute('open')===null)
            throw Error('Menu closes while crossing approved dropdown gap');
          await menu.locator('nav a').first().hover();
          if(await menu.getAttribute('open')===null)
            throw Error('Account menu links cannot be reached by mouse');
          await page.mouse.move(20,Math.min(800,navRect.y+navRect.height+30));
          await page.waitForFunction(()=>!document.querySelector('details.account-menu')?.open,
            null,{timeout:5000});
          await trigger.click();
          if(await menu.getAttribute('open')===null)throw Error('Keyboard-close setup failed');
          await page.keyboard.press('Escape');
          if(await menu.getAttribute('open')!==null ||
             !(await trigger.evaluate(node=>node===document.activeElement)))
            throw Error('Escape failed to close account menu and return focus');
          // Clicking a link to the *same* route used to leave the native
          // details menu expanded: no hash change means no remount. Exercise
          // the real Profile link rather than a synthetic menu action.
          await page.goto(base+'/#/profile',{waitUntil:'domcontentloaded'});
          const sameRouteMenu=page.locator('header.top details.account-menu');
          await sameRouteMenu.locator('summary').click();
          const current=page.evaluate(()=>location.hash);
          const sameLink=sameRouteMenu.locator('nav a[href="#/profile"]');
          await sameLink.waitFor({state:'visible'});
          await sameLink.click();
          if(await sameRouteMenu.getAttribute('open')!==null ||
             await current!=='#/profile' || await page.evaluate(()=>location.hash)!=='#/profile')
            throw Error('Clicking account link for current route leaves dropdown open');
          await page.goto(base+'/#/',{waitUntil:'domcontentloaded'});
          await page.locator('header.top details.account-menu').waitFor({state:'visible'});
          console.log('CABINET MENU POINTER PASS',width,'gap, hover, leave, Escape, same-route link');
        }
        if(role==='admin' && width<=390){
          const headerLayout=await page.locator('header.top').evaluate(header=>{
            const badge=header.querySelector('.sandbox-test-badge');
            const menu=header.querySelector('.account-menu > summary');
            const bell=header.querySelector('[aria-label="Уведомления"]')||
              header.querySelector('button.bell');
            if(!badge || !menu)throw Error('Missing admin supervisor badge/account menu');
            const textRange=document.createRange();textRange.selectNodeContents(badge);
            const box=node=>{if(!node)return null;const r=node.getBoundingClientRect();
              return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,
                width:r.width,height:r.height};};
            const hit=node=>{if(!node)return true;
              const r=node.getBoundingClientRect();
              const top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
              return top===node || node.contains(top);};
            return {width:document.documentElement.clientWidth,
              header:box(header),badge:box(badge),text:box(textRange),
              menu:box(menu),bell:box(bell),badgeHit:hit(badge),menuHit:hit(menu),
              bellHit:hit(bell)};
          });
          const {badge,text,menu,bell}=headerLayout;
          const intersect=(a,b)=>!!a&&!!b&&a.left<b.right-1&&a.right>b.left+1&&
            a.top<b.bottom-1&&a.bottom>b.top+1;
          if(!badge||!text||text.width<55||
             text.left<badge.left-1||text.right>badge.right+1||
             text.right>headerLayout.width+1||intersect(text,menu)||intersect(text,bell)||
             !headerLayout.badgeHit||!headerLayout.menuHit||!headerLayout.bellHit||
             menu.height<40)
            throw Error('320/390 admin badge obscured by clickable header controls: '+
              JSON.stringify(headerLayout));
        }
        if(width===390 && role==='client'){
          // The latest approved symbolic Russia-network illustration, never
          // the cancelled #3 truck. This resource is decoded from the real
          // server; the requester-specific card is audited separately.
          const art=await page.evaluate(async()=>{
            const url='/feature-art/traksos-no-performer-network-russia-approved-v1.webp';
            const response=await fetch(url,{cache:'no-store'});
            const img=new Image();
            img.src=url;
            await img.decode();
            return {status:response.status,type:response.headers.get('content-type'),
              width:img.naturalWidth,height:img.naturalHeight};
          });
          if(art.status!==200 || !art.type?.includes('image/webp') ||
             art.width!==2172 || art.height!==724)
            throw Error('Latest owner-approved Russia map absent or undecodable in Chromium: '+JSON.stringify(art));
        }
        const content=await page.locator('main').first().innerText();
        if(!content.trim() || /Вход по номеру телефона|Отсутствует приглашение/.test(content))
          throw Error('Role did not open a real authenticated cabinet: '+role);
        // The isolated browser used to show a legacy 900px Fleet page even
        // though APK owned a separate approved client dashboard. Pin both
        // browser and APK to the same real mobile composition.
        if(role==='owner'){
          await page.locator('main.fleet-mobile-approved').waitFor({state:'visible'});
          if(await page.locator('main.fleet-workspace').count() ||
             await page.locator('.internal-role-hero-fleet').count())
            throw Error('Retired Fleet desktop renderer reappeared at '+width+'px');
          if(!await page.locator('.fleet-mobile-car-link[href^="#/garage/"]').count())
            throw Error('Approved fleet cards do not open real vehicle history');
        }else if(width<=390 && ['client','driver'].includes(role)){
          await page.locator('.and19-workspace.and19-client').waitFor({state:'visible'});
          if(await page.locator('main .desktop-hero').count())
            throw Error('Legacy mobile-browser client desk replaced Android-approved shell');
        }
        if(width===960 && ['client','driver'].includes(role)){
          await page.locator('main.approved-pc-client').waitFor({state:'visible'});
          if(await page.locator('main.client-dashboard').count())
            throw Error('900–999px: obsolete client home mounted instead of approved PC workspace');
        }
        if(role==='courier' && width<=390){
          // Approved 618/Android has the courier-android desk. Desktop 617
          // deliberately mounts a different role shell; do not assert its DOM
          // is a phone layout at 960/1440px.
          const desk=page.locator('main.courier-android');
          await desk.waitFor({state:'visible'});
          const active=desk.locator('article.courier-trip.focus');
          await active.waitFor({state:'visible'});
          // QA: actual 390px pixels showed an empty ▣ box and two identical
          // delivery links. Do not consider a replaced text glyph a parcel.
          const parcel=active.locator('.courier-trip-illustration svg.courier-parcel-glyph[role="img"]');
          const shape=await parcel.evaluate(svg=>({
            paths:svg.querySelectorAll('path').length,
            width:svg.getBoundingClientRect().width,
            height:svg.getBoundingClientRect().height,
            visible:getComputedStyle(svg).display!=='none',
          }));
          if(!shape.visible || shape.paths<5 || shape.width<40 || shape.height<40)
            throw Error('Courier still has an empty/nonvisual parcel: '+JSON.stringify(shape));
          const actionLinks=await desk.locator('a[href^="#/courier/jobs/"]').evaluateAll(
            nodes=>nodes.map(n=>({href:n.getAttribute('href'),text:n.textContent.trim()})));
          if(actionLinks.length!==1 || !actionLinks[0].text.includes('Открыть доставку'))
            throw Error('Courier has duplicate primary job actions: '+JSON.stringify(actionLinks));
          if(await desk.getByRole('link',{name:'Продолжить доставку'}).count())
            throw Error('Duplicated courier continue button returned');
        }
        // Visited on a real backend, not mocked routes: these are the
        // high-value inner screens reached by approved menu/role actions.
        // Read-only navigation only: never accept offers, execute payments,
        // make order transitions or send real SMS from this audit.
        const geometry=await page.evaluate(()=>({
          client:document.documentElement.clientWidth,
          scroll:document.documentElement.scrollWidth,
        }));
        if(geometry.scroll>geometry.client+3){
          const offenders=await page.evaluate(()=>{
            const viewport=document.documentElement.clientWidth;
            return Array.from(document.querySelectorAll('body *')).map(el=>{
              const rect=el.getBoundingClientRect();
              const css=getComputedStyle(el);
              return {tag:el.tagName.toLowerCase(),
                cls:typeof el.className==='string'?el.className.slice(0,100):'',
                width:Math.round(rect.width),left:Math.round(rect.left),
                right:Math.round(rect.right),position:css.position,
                minWidth:css.minWidth,overflowX:css.overflowX};
            }).filter(x=>x.right>viewport+3 && x.width>0 && x.position!=='fixed')
              .sort((a,b)=>b.right-a.right).slice(0,12);
          });
          await page.screenshot({path:out+'/'+role+'-'+width+'-OVERFLOW.png',fullPage:true});
          throw Error('Horizontal scroll in '+role+' '+width+': '+JSON.stringify({geometry,offenders}));
        }
        if(role==='moderator' && width<=390){
          // Actual 618 screenshot showed four dated purple Unicode symbols,
          // out of place against the approved graphite/orange working UI.
          const controls=page.locator('main.moderator-workspace .moderator-action');
          await controls.first().waitFor({state:'visible'});
          const visual=await controls.evaluateAll(nodes=>nodes.map(el=>{
            const span=el.querySelector('span');
            const glyph=span?.querySelector('svg');
            return {text:el.textContent.trim(),iconCount:span?.querySelectorAll('svg').length,
              color:span?getComputedStyle(span).color:'',
              size:glyph?glyph.getBoundingClientRect().width:0,
              border:getComputedStyle(el).borderTopColor,
              active:el.classList.contains('active')};
          }));
          const approvedOrange=(value)=>{
            const [red,green,blue]=(value.match(/[0-9]+/g)||[]).slice(0,3).map(Number);
            return red>=220 && green>=95 && green<=200 && blue<155 &&
              red-green>=45;
          };
          if(visual.length!==4 || visual.some(x=>x.iconCount!==1 ||
             x.size<20 || !approvedOrange(x.color)) ||
             !visual.some(x=>x.active && approvedOrange(x.border)))
            throw Error('Moderator old purple nonvector icons/active border at '+width+': '+
              JSON.stringify(visual));
          await controls.nth(1).click();
          if(await controls.nth(1).getAttribute('aria-pressed')!=='true')
            throw Error('Moderator queue cards do not select a real section');
          await controls.first().click();
        }
        // Every working role must be reachable directly from the real
        // admin dashboard, not only from a hidden test-center URL.
        if(role==='admin'){
          // 617 desktop has the approved PC role grid; 618 mobile keeps its
          // own Admin workspace and must reach the SAME 12 real role tickets.
          // Do not require desktop DOM on a phone just to make CI green.
          if(width<900){
            const launcher=page.locator('main.admin-workspace a[href="#/admin/test-center"]').first();
            await launcher.waitFor({state:'visible',timeout:15_000});
            await launcher.click();
            await page.locator('main.sandbox-root .sandbox-role-grid').waitFor({state:'visible'});
          }
          const links=await page.locator(width<900
            ? '.sandbox-role-grid a.sandbox-role-card'
            : '.approved-pc-role-grid a').evaluateAll(nodes=>
              nodes.map(node=>node.getAttribute('href')));
          const required=SANDBOX_ROLES.map(id=>'#/admin/test-center/'+id);
          const missing=required.filter(href=>!links.includes(href));
          if(missing.length || links.length!==required.length)
            throw Error('Admin role launcher differs from the 12 real sandbox roles: '+
              JSON.stringify({width,missing,links}));
          if(width<900){
            await page.getByRole('link',{name:'← Вернуться в админку'}).click();
            await page.waitForFunction(()=>location.hash==='#/admin',{timeout:15_000});
            await page.locator('main.admin-workspace').waitFor({state:'visible'});
          }
        }
        if(errors.length)throw Error('JavaScript error in '+role+': '+errors.join('; '));
        // A legal dialog or navigation click may leave the page scrolled.
        // Reset before full-page proof so sticky header is not rendered
        // halfway down the PNG and misrepresented as the live UI layout.
        await page.evaluate(()=>window.scrollTo({top:0,left:0,behavior:'instant'}));
        await page.waitForFunction(()=>window.scrollY===0,{timeout:5000});
        await page.screenshot({path:out+'/'+role+'-'+width+'.png',fullPage:true});
        // The approved dashboard is not the finish line. Probe real
        // secondary destinations while authenticated to catch old forms,
        // wrong roles, empty screens and links to retired frontend sources.
        if(width===390 || width===960){
          const destinations={
            client:['#/sos','#/orders','#/garage','#/menu'],
            owner:['#/garage','#/orders','#/menu'],
            driver:['#/orders','#/garage','#/menu'],
            master:['#/work/jobs','#/work/me','#/menu'],
            tow:['#/work/jobs','#/work/me','#/menu'],
            service:['#/base/me','#/base/money','#/menu'],
            master_service:['#/work/me','#/base','#/menu'],
            insurer:['#/insurance/requests','#/menu'],
            inspection:['#/inspections/processing','#/menu'],
            courier:['#/courier/jobs','#/courier/chat','#/menu'],
            moderator:['#/moderation/verify','#/menu'],
            admin:['#/admin/section/orders','#/admin/section/demand','#/admin/section/announcements','#/admin/test-center','#/menu'],
          };
          for(const destination of destinations[role]){
            await page.goto(base+'/'+destination,{waitUntil:'domcontentloaded'});
            await page.waitForFunction(target=>location.hash===target,destination,{timeout:15_000});
            await page.locator('header.top .sandbox-test-badge').waitFor({state:'visible',timeout:15_000});
            // Wait for the actual role section to render, not merely the hash.
            await page.waitForTimeout(220);
            const state=await page.evaluate(()=>{
              const main=document.querySelector('.desktop-content main');
              const text=(main?.innerText||'').trim();
              const root=document.documentElement;
              return {
                mainClass:main?.className||'',
                length:text.length,
                preview:text.slice(0,160),
                overflow:root.scrollWidth-root.clientWidth,
                obsolete:!!document.querySelector('main.fleet-workspace, .internal-role-hero-fleet, main .desktop-hero, .desktop-quick-links'),
                nativePreview:!!document.querySelector('.and19-review-page'),
              };
            });
            if(state.length<8 ||
               /Такой страницы нет|Не удалось открыть раздел|Вход по номеру телефона|Отсутствует приглашение/.test(state.preview)||
               state.obsolete || state.nativePreview || state.overflow>3)
              throw Error('Navigation regression '+role+' '+width+' '+destination+' '+JSON.stringify(state));
            if(role==='admin' && destination==='#/admin/section/announcements'){
              // Actual admin fields and enabled buttons, not a generated mock.
              // A cleared datetime-local previously threw RangeError before
              // useAction could handle it; saving must be impossible until the
              // user fills a coherent date range.
              const work=page.locator('main.admin-workspace');
              await work.locator('input[maxlength="140"]').fill('Учебная проверка времени');
              await work.locator('textarea[maxlength="3000"]').fill('Учебное сообщение для проверки формата дат.');
              const announce=work.getByRole('button',{name:'Сохранить объявление'});
              await announce.waitFor({state:'visible'});
              const times=work.locator('input[type="datetime-local"]');
              if(await times.count()!==4)throw Error('Admin date fields missing');
              await times.nth(0).fill('');
              if(!await announce.isDisabled())
                throw Error('Empty announcement date must block real Save action');
              // A past interval is valid for a retained draft, but not for
              // an immediately published notice that could never be sent.
              const pastStart=new Date(Date.now()-3*86_400_000).toISOString().slice(0,16);
              const pastEnd=new Date(Date.now()-2*86_400_000).toISOString().slice(0,16);
              await times.nth(0).fill(pastStart);
              await times.nth(1).fill(pastEnd);
              if(!await announce.isDisabled())
                throw Error('An expired published announcement must block Save');
              const publishCheckbox=work.getByLabel('Опубликовать после наступления даты');
              await publishCheckbox.uncheck();
              if(await announce.isDisabled())
                throw Error('A historical draft must remain saveable with past dates');
              await publishCheckbox.check();
              await work.locator('textarea[maxlength="500"]').fill('Учебная проверка акции гидравлики');
              const commission=work.getByRole('button',{name:'Назначить комиссию'});
              const percent=work.locator('input[type="number"][step="0.5"]');
              await percent.fill('');
              if(!await commission.isDisabled() ||
                 !await work.getByText('Пустое поле не означает 0%',{exact:false}).isVisible())
                throw Error('An empty percentage must not silently become a 0% finance campaign');
              await percent.fill('0'); // zero is valid only when explicitly entered
              await times.nth(2).fill('');
              if(!await commission.isDisabled())
                throw Error('Empty campaign date must block real finance action');
              console.log('ADMIN DATE CONTROLS BROWSER PASS',width);
              if(width===390){
                // Genuine HTTP announcements in this disposable sandbox.
                // One is published but scheduled, the other a preserved
                // expired draft. Neither may expose a broken send action.
                const fixtures=await page.evaluate(async()=>{
                  const token=localStorage.getItem('traksos.token');
                  if(!token)throw Error('Admin token unavailable for notice scenario');
                  const post=async(input)=>{
                    const response=await fetch('/api/admin/announcements',{
                      method:'POST',headers:{'content-type':'application/json',
                        authorization:'Bearer '+token},body:JSON.stringify(input)
                    });
                    const body=await response.json();
                    if(!response.ok)throw Error('Cannot create real notice: '+response.status+' '+JSON.stringify(body));
                    return body;
                  };
                  const now=Date.now();
                  const common={
                    audience:'master',service:'electric',
                    body:'Одноразовое объявление для настоящей проверки интерфейса администратора.'
                  };
                  const scheduled=await post({...common,title:'QA запланированное объявление',
                    startsAt:new Date(now+20*86_400_000).toISOString(),
                    endsAt:new Date(now+21*86_400_000).toISOString(),
                    published:true});
                  const expired=await post({...common,title:'QA истёкший черновик',
                    startsAt:new Date(now-3*86_400_000).toISOString(),
                    endsAt:new Date(now-2*86_400_000).toISOString(),
                    published:false});
                  // A real disabled future campaign verifies history's time
                  // label without touching actual commission calculation.
                  const campaignResponse=await fetch('/api/admin/commission-campaigns',{
                    method:'POST',headers:{'content-type':'application/json',
                      authorization:'Bearer '+token},
                    body:JSON.stringify({
                      service:'hydraulics',commissionPct:0,
                      startsAt:new Date(now+20*86_400_000).toISOString(),
                      endsAt:new Date(now+21*86_400_000).toISOString(),
                      enabled:false,reason:'Учебная неактивная акция на будущую дату'
                    })
                  });
                  const campaign=await campaignResponse.json();
                  if(!campaignResponse.ok)
                    throw Error('Cannot save draft commission campaign: '+JSON.stringify(campaign));
                  return {scheduled:scheduled.id,expired:expired.id,campaign:campaign.id};
                });
                if(!fixtures.scheduled||!fixtures.expired)
                  throw Error('Admin notice fixtures have no API IDs');
                await page.reload({waitUntil:'domcontentloaded'});
                const scheduledCard=page.locator('main.admin-workspace .list-item')
                  .filter({hasText:'QA запланированное объявление'});
                const expiredCard=page.locator('main.admin-workspace .list-item')
                  .filter({hasText:'QA истёкший черновик'});
                const campaignCard=page.locator('main.admin-workspace .list-item')
                  .filter({hasText:'Учебная неактивная акция на будущую дату'});
                await scheduledCard.waitFor({state:'visible',timeout:15000});
                await expiredCard.waitFor({state:'visible',timeout:15000});
                await campaignCard.waitFor({state:'visible',timeout:15000});
                if(!await campaignCard.getByText('начало впереди',{exact:false}).isVisible() ||
                   !await campaignCard.getByRole('button',{name:'Включить акцию'}).isEnabled())
                  throw Error('Future disabled commission campaign has a dead button or wrong period label');
                if(!await scheduledCard.getByText('запланировано',{exact:false}).isVisible()||
                   await scheduledCard.getByRole('button',{name:'Разослать уведомление'}).count()!==0||
                   !await expiredCard.getByText('срок истёк',{exact:false}).isVisible()||
                   !await expiredCard.getByRole('button',{name:'Опубликовать'}).isDisabled())
                  throw Error('Scheduled or expired notice has misleading status or dead admin action');
                console.log('ADMIN NOTICE SCHEDULE BROWSER PASS',width,fixtures);
              }
            }
            if(role==='admin' && destination==='#/admin/section/demand'){
              // The existing admin tools must show live grouped data, not
              // invented demand, placeholder locations or individual GPS.
              const demand=page.getByLabel('Спрос на партнёров по зонам');
              await demand.waitFor({state:'visible',timeout:15000});
              await demand.getByText('Где подключать новых партнёров · услуга и зона').waitFor();
              const api=await page.evaluate(async()=>{
                const token=localStorage.getItem('traksos.token');
                const response=await fetch('/api/admin/demand?days=7',{
                  headers:{authorization:'Bearer '+token},cache:'no-store'
                });
                return {status:response.status,body:response.ok?await response.json():null};
              });
              if(api.status!==200 || !Array.isArray(api.body?.byServiceZone) ||
                 api.body.byServiceZone.some(row=>Object.keys(row).some(
                   key=>['lat','lng','phone','address','client_id'].includes(key))))
                throw Error('Demand-by-zone admin API is unavailable or exposes private coordinates');
              await page.screenshot({path:out+'/admin-'+width+'-demand-by-zone.png',
                fullPage:true,animations:'disabled'});
              console.log('ADMIN DEMAND BY ZONE BROWSER PASS',width,api.body.byServiceZone.length);
            }
            if(destination==='#/menu' && !await page.locator('main.tr-mobile-menu-page').isVisible())
              throw Error('Approved role menu not mounted at '+role+' '+width);
            if(errors.length)throw Error('Navigation JavaScript exception '+role+' '+destination+': '+errors.join('; '));
            // Proof of the actual React panel, not a design mockup.
            if(destination==='#/menu' || destination===destinations[role][0]){
              const safe=destination.slice(2).replaceAll('/','-')||'home';
              await page.screenshot({path:out+'/'+role+'-'+width+'-route-'+safe+'.png',fullPage:true,animations:'disabled'});
            }
            console.log('SANDBOX ROUTE PASS',role,width,destination,state.mainClass);
          }
        }
        if(role==='service' && (width===390 || width===960)){
          // Real authenticated service UI against disposable Postgres. The
          // location is test-only and must be erasable without a second
          // confirmation step or a misleading cosmetic field reset.
          const prepared=await page.evaluate(async()=>{
            const token=localStorage.getItem('traksos.token');
            if(!token)throw Error('No sandbox service auth token');
            const headers={'content-type':'application/json',authorization:'Bearer '+token};
            const before=await fetch('/api/base',{headers}).then(r=>r.json());
            if(!before.center?.id)throw Error('Sandbox service card is missing');
            const response=await fetch('/api/base',{
              method:'PUT',headers,body:JSON.stringify({lat:59.97,lng:30.31})
            });
            if(!response.ok)throw Error('Cannot prepare disposable station GPS: '+response.status);
            return {name:before.center.name,verification:before.center.verification};
          });
          await page.goto(base+'/#/base/me',{waitUntil:'domcontentloaded'});
          const clear=page.getByRole('button',{name:'Удалить GPS-координаты и скрыть точку'});
          await clear.waitFor({state:'visible',timeout:15000});
          await clear.click(); // real DOM pointer event; protected PUT /api/base
          await clear.waitFor({state:'detached',timeout:15000});
          const verified=await page.evaluate(async()=>{
            const token=localStorage.getItem('traksos.token');
            const headers={authorization:'Bearer '+token};
            const [stationResponse,mapResponse]=await Promise.all([
              fetch('/api/base',{headers,cache:'no-store'}),
              fetch('/api/public/partner-map',{cache:'no-store'})
            ]);
            if(!stationResponse.ok || !mapResponse.ok)
              throw Error('Cannot verify real saved station and public map');
            return {center:(await stationResponse.json()).center,
              map:(await mapResponse.json())};
          });
          const result=verified.center;
          if(result?.lat!==null || result?.lng!==null ||
             result?.public_map_opt_in!==false || result?.public_map_location_verified_at!==null ||
             result.name!==prepared.name || result.verification!==prepared.verification ||
             verified.map?.source!=='verified_stationary_opt_in' ||
             verified.map.points?.some(p=>p.id===result.id))
            throw Error('GPS clear button did not remove the private/public station location: '+
              JSON.stringify({prepared,result,publicIdVisible:
                verified.map.points?.some(p=>p.id===result.id)}));
          await page.screenshot({path:out+'/service-'+width+'-gps-cleared.png',
            fullPage:false,animations:'disabled'});
          console.log('STATIONARY GPS CLEAR BROWSER PASS',width,result.id);
        }
        if (width === 390 && (role === 'driver' || role === 'owner')) {
          const docs = [];
          for (const audience of ['client', 'privacy']) {
            const response = await page.request.get(base + '/api/offers/current/' + audience);
            if (!response.ok()) throw Error('Missing sandbox document: ' + audience);
            const doc = await response.json();
            if (doc.audience !== audience || !doc.body || !doc.summary || !doc.version)
              throw Error('Incomplete sandbox document: ' + audience);
            await page.goto(base + '/#/offer/' + audience);
            const body = page.locator('main.public-offer-page .offer-text');
            const title = audience === 'privacy' ? 'Согласие на обработку персональных данных' : 'Оферта для клиентов';
            await body.getByText(title, {exact:true}).first().waitFor();
            await body.getByText('Редакция ' + doc.version, {exact:false}).waitFor();
            if (audience === 'privacy')
              await body.getByText('вымышленные данные', {exact:false}).first().waitFor();
            await page.screenshot({path:out+'/'+role+'-'+width+'-document-'+audience+'.png', fullPage:true});
            docs.push(doc);
          }
          if (docs[0].id === docs[1].id || docs[0].body === docs[1].body || docs[0].summary === docs[1].summary)
            throw Error('Privacy duplicates client offer in ' + role);
        }
        // A wrong-role deep link must NEVER show an old Home dashboard.
        // Clear denial screens are safer than silently exposing a stale
        // or misleading cabinet for an authenticated user.
        if(role==='client' && width===390){
          for(const forbidden of ['#/admin','#/moderation','#/base','#/work','#/login']){
            await page.goto(base+'/'+forbidden,{waitUntil:'domcontentloaded'});
            await page.locator('main.tr-approved-route-unavailable').waitFor({state:'visible',timeout:15000});
            if(await page.locator('main.client-dashboard, main.approved-pc').count())
              throw Error('Retired dashboard mounted on forbidden route '+forbidden);
            if(errors.length)throw Error('Denied route Javascript failure '+forbidden+': '+errors.join('; '));
            console.log('SANDBOX DENIED ROUTE PASS',forbidden,'neutral approved-only state');
          }
        }
        // A real browser must switch roles without new SMS or new signed
        // admin handoff. Verify the resulting role cannot elevate itself.
        if(role==='admin'){
          const currentMode=await page.evaluate(()=>localStorage.getItem('traksos.mode'));
          if(currentMode!=='admin')throw Error('Sandbox admin mode lost on secondary routes: '+currentMode);
          if(await page.getByRole('dialog',{name:'Оферта для клиентов'}).count())
            throw Error('Sandbox admin route is incorrectly blocked by a client legal offer');
          await page.locator('.sandbox-supervisor-badge > summary').click();
          const choose=page.locator('#sandbox-switch-role');
          await choose.waitFor();
          await choose.selectOption('client');
          await page.getByRole('button',{name:'Перейти',exact:true}).click();
          await page.waitForFunction(()=>location.hash==='#/' &&
            localStorage.getItem('traksos.token')?.length>30,{timeout:15_000});
          const privilege=await page.evaluate(async()=>{
            const token=localStorage.getItem('traksos.token');
            const me=await fetch('/api/me',{headers:{authorization:'Bearer '+token}}).then(r=>r.json());
            const attempt=await fetch('/api/sandbox/switch-role',{
              method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},
              body:JSON.stringify({role:'admin'}),
            });
            return {roles:me.roles,status:attempt.status};
          });
          if(!privilege.roles?.includes('client') || privilege.roles?.includes('admin') ||
              privilege.status!==403)
            throw Error('Browser role switch or non-supervisor isolation failed '+JSON.stringify(privilege));
          console.log('SANDBOX BROWSER SWITCH PASS',width,'supervisor to client; client cannot escalate');
        }
        console.log('SANDBOX BROWSER PASS',role,width,landing,'approved interface and isolated session');
      }catch(err){
        const detail=String(err instanceof Error ? err.stack ?? err.message : err);
        failures.push({role,width,detail});
        console.error('SANDBOX BROWSER FAIL',role,width,detail);
        try{
          await page.screenshot({path:out+'/'+role+'-'+width+'-ERROR.png',fullPage:true});
        }catch{ /* Preserve the original failure if Chromium itself crashed. */ }
      }finally{await context.close();}
    }
  }
  // Real positive pin proof: the test-only station must go through BOTH
  // independent human geo review and its own explicit map consent. It never
  // appears on production; the entire backend is a disposable CI sandbox.
  // Revoke consent afterwards and verify the live map refresh actually
  // removes the point/card without leaking any master's live location.
  {
    const serviceContext=await browser.newContext({viewport:{width:1440,height:900},locale:'ru-RU'});
    const adminContext=await browser.newContext({viewport:{width:1440,height:900},locale:'ru-RU'});
    const guestContext=await browser.newContext({viewport:{width:1440,height:900},locale:'ru-RU'});
    let centerId='',serviceToken='';
    try{
      const servicePage=await serviceContext.newPage();
      await servicePage.goto(base+'/#/sandbox-enter?ticket='+
        encodeURIComponent(issueSandboxTicket('service',secret,Date.now())),{waitUntil:'domcontentloaded'});
      await servicePage.waitForFunction(()=>localStorage.getItem('traksos.token')?.length>30,
        null,{timeout:20000});
      serviceToken=await servicePage.evaluate(()=>localStorage.getItem('traksos.token'));
      const adminPage=await adminContext.newPage();
      await adminPage.goto(base+'/#/sandbox-enter?ticket='+
        encodeURIComponent(issueSandboxTicket('admin',secret,Date.now())),{waitUntil:'domcontentloaded'});
      await adminPage.waitForFunction(()=>localStorage.getItem('traksos.token')?.length>30,
        null,{timeout:20000});
      const adminToken=await adminPage.evaluate(()=>localStorage.getItem('traksos.token'));
      const station=await serviceContext.request.get(base+'/api/base',{
        headers:{authorization:'Bearer '+serviceToken}});
      if(!station.ok())throw Error('Sandbox service station GET failed: '+station.status());
      const existing=(await station.json()).center;
      if(!existing?.id || !existing?.name)throw Error('Sandbox partner has no station');
      centerId=existing.id;
      const auth=(token)=>({authorization:'Bearer '+token});
      const requestOk=async(response,step)=>{
        if(!response.ok())throw Error(step+' rejected: '+response.status()+' '+(await response.text()).slice(0,200));
        return response.json();
      };
      await requestOk(await serviceContext.request.put(base+'/api/base',{
        headers:auth(serviceToken),data:{
          address:'Тестовый стационарный адрес, Санкт-Петербург, 1',
          lat:59.97,lng:30.31,accepts:['quick']
        }}),'Set isolated stationary GPS');
      await requestOk(await serviceContext.request.post(base+'/api/base/confirm-accepts',{
        headers:auth(serviceToken),data:{}}),'Confirm isolated services');
      await requestOk(await adminContext.request.post(base+'/api/admin/services/'+centerId+'/verify',{
        headers:auth(adminToken),data:{decision:'approved'}}),'Approve isolated station');
      await requestOk(await adminContext.request.post(base+'/api/admin/services/'+centerId+'/verify-location',{
        headers:auth(adminToken),data:{
          kind:'site_visit',reference:'TEST-ONLY-CHROMIUM-STATIONARY-MAP',confirmed:true
        }}),'Independently verify isolated station location');
      await requestOk(await serviceContext.request.put(base+'/api/service/public-map',{
        headers:auth(serviceToken),data:{enabled:true}}),'Opt in isolated stationary map');
      const guestPage=await guestContext.newPage();
      await guestPage.goto(base+'/#/',{waitUntil:'domcontentloaded'});
      await guestPage.getByRole('button',{name:'Развернуть карту партнёров'}).click();
      const dialog=guestPage.getByRole('dialog',{name:'Карта партнёров TrakSOS'});
      await dialog.waitFor({state:'visible'});
      const partnerButton=dialog.getByRole('button',{name:'СТО '+existing.name,exact:true});
      await partnerButton.waitFor({state:'visible',timeout:15000});
      await partnerButton.click();
      const partnerCard=dialog.locator('aside.tr-network-partner');
      await partnerCard.getByText(existing.name,{exact:true}).waitFor({state:'visible'});
      const exposed=await guestPage.evaluate(async()=>{
        const r=await fetch('/api/public/partner-map',{cache:'no-store'});
        const d=await r.json();
        return {status:r.status,source:d.source,points:d.points};
      });
      const point=exposed.points?.find(p=>p.id===centerId);
      if(exposed.status!==200 || exposed.source!=='verified_stationary_opt_in' ||
         !point || point.kind!=='service' || point.name!==existing.name ||
         Math.abs(point.lat-59.97)>.00001 || Math.abs(point.lng-30.31)>.00001 ||
         Object.keys(point).sort().join(',')!=='id,kind,lat,lng,name')
        throw Error('Real map pin mismatch or unsafe public fields: '+JSON.stringify(exposed));
      await guestPage.screenshot({path:out+'/guest-1440-verified-opt-in-partner.png',
        fullPage:false,animations:'disabled'});
      await requestOk(await serviceContext.request.put(base+'/api/service/public-map',{
        headers:auth(serviceToken),data:{enabled:false}}),'Revoke isolated map consent');
      // Same event that the open map listens for on tab return: real server
      // fetch, not mocked data or a page.reload hiding stale client state.
      await guestPage.evaluate(()=>window.dispatchEvent(new Event('focus')));
      await partnerButton.waitFor({state:'detached',timeout:15000});
      await partnerCard.waitFor({state:'detached',timeout:15000});
      const revoked=await guestPage.evaluate(async()=>{
        const r=await fetch('/api/public/partner-map',{cache:'no-store'});
        const d=await r.json();
        return {status:r.status,stillPublished:d.points?.some(p=>p.id===centerId)};
      });
      if(revoked.status!==200 || revoked.stillPublished)
        throw Error('Revoked station is still published to guests');
      await guestPage.screenshot({path:out+'/guest-1440-partner-consent-revoked.png',
        fullPage:false,animations:'disabled'});
      console.log('LIVE PARTNER MAP CONSENT PASS',centerId,'published → selected → revoked');
    }catch(error){
      const detail=String(error instanceof Error?error.stack??error.message:error);
      failures.push({role:'guest-map-live-opt-in',width:1440,detail});
      console.error('LIVE PARTNER MAP CONSENT FAIL',detail);
    }finally{
      if(serviceToken && centerId){
        await serviceContext.request.put(base+'/api/service/public-map',{
          headers:{authorization:'Bearer '+serviceToken},data:{enabled:false}
        }).catch(()=>{});
      }
      await Promise.all([serviceContext.close(),adminContext.close(),guestContext.close()]);
    }
  }
}finally{await browser.close();}
if(failures.length)
  throw Error('Isolated role browser review failed ('+failures.length+' cases): '+
    JSON.stringify(failures.map(({role,width,detail})=>({role,width,detail:detail.slice(0,450)}))));
