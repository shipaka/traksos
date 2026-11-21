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
  for(const width of [320,390,1440]){
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
        if(errors.length)throw Error('JavaScript error in '+role+': '+errors.join('; '));
        // A legal dialog or navigation click may leave the page scrolled.
        // Reset before full-page proof so sticky header is not rendered
        // halfway down the PNG and misrepresented as the live UI layout.
        await page.evaluate(()=>window.scrollTo({top:0,left:0,behavior:'instant'}));
        await page.waitForFunction(()=>window.scrollY===0,{timeout:5000});
        await page.screenshot({path:out+'/'+role+'-'+width+'.png',fullPage:true});
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
