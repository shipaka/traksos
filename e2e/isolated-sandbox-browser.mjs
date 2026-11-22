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
        const ticket=issueSandboxTicket(role,secret);
        await page.goto(base+'/#/sandbox-enter?ticket='+encodeURIComponent(ticket),{
          waitUntil:'domcontentloaded',
        });
        await page.locator('header.top .sandbox-test-badge').filter({hasText:'Тест'}).first().waitFor({timeout:25_000});
        await page.waitForFunction(expected=>location.hash===expected,landing,{timeout:20_000});
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
        const marker=await page.locator('header.top .sandbox-test-badge').filter({hasText:'Тест'}).first().innerText();
        if(marker.trim()!=='Тест')
          throw Error('Compact sandbox badge missing for '+role);
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
        // Every working role must be reachable directly from the real
        // admin dashboard, not only from a hidden test-center URL.
        if(role==='admin'){
          const links=await page.locator('.approved-pc-role-grid a').evaluateAll(nodes=>
            nodes.map(node=>node.getAttribute('href')));
          const required=SANDBOX_ROLES.map(id=>'#/admin/test-center/'+id);
          const missing=required.filter(href=>!links.includes(href));
          if(missing.length || links.length!==required.length)
            throw Error('Admin role launcher differs from the 12 real sandbox roles: '+
              JSON.stringify({missing,links}));
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
        // Include 1440px desktop inner routes: prior scans only checked desktop workspaces.
        if(width===390 || width===960 || width===1440 ||
           (width===320 && ['client','inspection'].includes(role))){
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
            admin:['#/admin/section/orders','#/admin/test-center','#/menu'],
          };
          for(const destination of destinations[role].filter(path=>width!==1440 || path!=='#/menu')){
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
            // A desktop secondary route must retain the approved 617 inner header.
            // The administrative test-center and main workspaces deliberately use
            // their own approved shells, not the ordinary section header.
            if(width===1440 && !['#/admin/test-center','#/base'].includes(destination) &&
               !(await page.locator('.desktop-content > .tr-inner-hero[data-traksos-inner-ui="approved-617-618"]').isVisible()))
              throw Error('Desktop 617 secondary route returned without approved inner shell '+
                role+' '+destination);
            // Horizontal overflow of the document does NOT reveal individually
            // clipped actions inside a scrollable rail. Verify all 3 role links
            // remain on-screen in the *real* 390px sandbox browser.
            if(width<=390 && destination!=='#/menu'){
              const quick=page.locator('.desktop-content > .tr-inner-rail .tr-inner-rail-tools nav');
              if(await quick.count()){
                const geometry=await quick.evaluate(node=>{
                  const rect=node.getBoundingClientRect();
                  const actions=[...node.querySelectorAll('a')];
                  return {count:actions.length,scroll:node.scrollWidth,client:node.clientWidth,
                    inside:actions.every(link=>{
                      const r=link.getBoundingClientRect();
                      return r.width>0 && r.left>=rect.left-2 && r.right<=rect.right+2;
                    })};
                });
                if(geometry.count!==3 || geometry.scroll>geometry.client+2 || !geometry.inside)
                  throw Error('Hidden or clipped approved 618 role action '+role+' '+
                    destination+' '+JSON.stringify(geometry));
              }
            }
            if(destination==='#/menu' && !await page.locator('main.tr-mobile-menu-page').isVisible())
              throw Error('Approved role menu not mounted at '+role+' '+width);
            if(errors.length)throw Error('Navigation JavaScript exception '+role+' '+destination+': '+errors.join('; '));
            // Proof of the actual React panel, not a design mockup.
            // Capture genuine deep-route screenshots at 1440px too.
            if(destination==='#/menu' || destination===destinations[role][0]){
              const safe=destination.slice(2).replaceAll('/','-')||'home';
              await page.screenshot({path:out+'/'+role+'-'+width+'-route-'+safe+'.png',fullPage:true,animations:'disabled'});
            }
            console.log('SANDBOX ROUTE PASS',role,width,destination,state.mainClass);
          }
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
        // A performer must not see the client's insurance application even
        // through a manually entered hash. The partner's dossier thread stays
        // accessible through the separate authorized insurer role.
        if(role==='master' && width===390){
          await page.goto(base+'/#/insurance/request/new',{waitUntil:'domcontentloaded'});
          await page.locator('main.tr-approved-route-unavailable').waitFor({state:'visible',timeout:15000});
          if(await page.getByRole('heading',{name:'Заявка на страхование грузовика'}).count())
            throw Error('Master unexpectedly mounted customer insurance form');
          if(errors.length)throw Error('Denied insurance route JS error '+errors.join('; '));
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
}finally{await browser.close();}
if(failures.length)
  throw Error('Isolated role browser review failed ('+failures.length+' cases): '+
    JSON.stringify(failures.map(({role,width,detail})=>({role,width,detail:detail.slice(0,450)}))));
