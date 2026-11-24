// Actual clicks through the approved cabinets, on the local synthetic visual server.
// Run after owner20-cabinet-evidence and approved-pc-courier-real, which create fixtures.
// No order, payment, or delivery is submitted. Logout touches synthetic sessions only.
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {expectedTabs,assertRoleTabs,assertActiveTab,assertRoleMenu} from './role-click-contract.mjs';
import {watchPageErrors} from './visual-page-errors.mjs';

const BASE=process.env.BASE_URL||'http://127.0.0.1:8080';
if(!['127.0.0.1','localhost'].includes(new URL(BASE).hostname))throw Error('Local visual CI only');
const OUT='e2e/shots/role-click-matrix';
await mkdir(OUT,{recursive:true});
const password='Visual-Local-2026!';
const cases=[
 ['owner','+79990000341',password,'client'],
 ['driver','+79990000342',password,'client'],
 ['master','+79990000343',password,'performer'],
 ['tow','+79990000344',password,'performer'],
 ['service','+79990000345',password,'service'],
 ['hybrid-service','+79990000346',password,'service'],
 ['hybrid-master','+79990000346',password,'performer'],
 ['insurer','+79990000347',password,'insurer'],
 ['inspection','+79990000357',password,'inspection'],
 ['courier','+79990000350','Courier-Only-Visual-2026!','courier'],
 ['admin','+79990000348',password,'admin'],
 ['moderator','+79990000349',password,'moderator']
];
async function api(path,method='GET',body,token){
  const r=await fetch(BASE+path,{method,headers:{
    ...(body?{'content-type':'application/json'}:{}),
    ...(token?{authorization:'Bearer '+token}:{})
  },...(body?{body:JSON.stringify(body)}:{})});
  const data=await r.json().catch(()=>null);
  if(!r.ok)throw Error(path+' HTTP '+r.status);
  return data;
}
async function login(phone,password){return api('/api/auth/login','POST',{phone,password});}
// The inspection operator is a separately authorized account, never an insurer mock.
const admin=await login('+79990000348',password);
if(!(await api('/api/me','GET',undefined,admin.token)).roles.includes('admin'))
  throw Error('Visual admin fixture not authorized');
let inspection;
try{inspection=await login('+79990000357',password);}
catch(error){
  if(!/HTTP (401|404)/.test(String(error)))throw error;
  const code=await api('/api/auth/code','POST',{phone:'+79990000357'});
  if(!/^\d{4,6}$/.test(code.devCode||''))throw Error('No local dev SMS');
  inspection=await api('/api/auth/verify','POST',{phone:'+79990000357',code:code.devCode,accountType:'owner',password});
}
const inspectUser=await api('/api/me','GET',undefined,inspection.token);
if(!inspectUser.roles.includes('inspection_operator'))
  await api('/api/admin/users/'+inspectUser.id+'/roles','POST',{roles:['inspection_operator']},admin.token);
const verifiedInspection=await login('+79990000357',password);
const inspectRoles=(await api('/api/me','GET',undefined,verifiedInspection.token)).roles;
if(!inspectRoles.includes('inspection_operator')||inspectRoles.some(r=>['client','driver','insurer'].includes(r)))
  throw Error('Independent inspection fixture has wrong roles');

const surfaces=[
 {name:'pc',width:1440,height:900,native:false},
 {name:'mobile-browser',width:390,height:844,native:false},
 {name:'android-bridge',width:390,height:844,native:true}
];
const report=[];
const browser=await chromium.launch();
async function visibleRoute(page,href,assertClean){
  await page.waitForURL(url=>url.hash===href,{timeout:15000});
  await page.locator('.account-menu > summary').waitFor({state:'visible',timeout:15000});
  await page.locator('.desktop-content').waitFor({state:'visible'});
  for(const text of ['Такой страницы нет','Не удалось открыть раздел','Нет доступа к кабинету страховщика','Нет прав оператора техосмотра','Нет доступа к клиентским заявкам','Нет доступа к гаражу'])
    if(await page.getByText(text,{exact:true}).first().isVisible())throw Error('Unreachable '+href+': '+text);
  const size=await page.evaluate(()=>({w:document.documentElement.clientWidth,s:document.documentElement.scrollWidth}));
  if(size.s>size.w+3)throw Error('Horizontal overflow on '+href+': '+JSON.stringify(size));
  await assertClean('route '+href);
}
async function linksOf(locator){return locator.evaluateAll(nodes=>nodes.map(x=>x.getAttribute('href')));}
async function clickRoute(page,locator,href,assertClean){
  await locator.waitFor({state:'visible',timeout:15000});
  await locator.click();
  await visibleRoute(page,href,assertClean);
}
async function openHeaderMenu(page){
  const menu=page.locator('.account-menu');
  if(!(await menu.evaluate(el=>el.open)))await menu.locator('summary').click();
  await menu.locator('nav').waitFor({state:'visible'});
  return menu;
}
async function openMobileMenu(page,assertClean){
  await clickRoute(page,page.locator('.tabbar a[href="#/menu"]'),'#/menu',assertClean);
  const menu=page.locator('main.tr-mobile-menu-page');
  await menu.waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelectorAll('.tabbar a.on').length===1&&document.querySelector('.tabbar a.on')?.getAttribute('href')==='#/menu');
  const sections=menu.locator('details');
  for(let i=0;i<await sections.count();i++){
    const details=sections.nth(i);
    if(!(await details.evaluate(el=>el.open)))await details.locator('summary').click();
  }
  return menu;
}
try{
 for(const [role,phone,pass,mode] of cases){
  for(const surface of surfaces){
   const result={role,mode,surface:surface.name,clicked:[],status:'FAIL'};
   report.push(result);
   let ctx;
   try{
    const {token}=await login(phone,pass);
    ctx=await browser.newContext({viewport:{width:surface.width,height:surface.height},locale:'ru-RU',
      ...(surface.width===390?{isMobile:true,hasTouch:true}:{}),serviceWorkers:'block'});
    const page=await ctx.newPage();
    const assertClean=watchPageErrors(page);
    const unexpectedDialogs=[];
    page.on('dialog',async dialog=>{
      if(dialog.type()==='confirm'&&dialog.message().includes('На линии'))await dialog.accept();
      else{unexpectedDialogs.push(dialog.message());await dialog.dismiss();}
    });
    await page.addInitScript(({token,mode,native})=>{
      if(native)Object.defineProperty(window,'TrakSOSNative',{configurable:true,value:{
        isApp:()=>true,setSession:()=>{},pushToken:()=>'',performerOnline:()=>{},
        appLockEnabled:()=>false,setAppLockEnabled:()=>false
      }});
      // Explicit logout reloads the page: never silently reinsert a revoked token.
      if(!sessionStorage.getItem('ci-role-click-initialized')){
        sessionStorage.setItem('ci-role-click-initialized','1');
        localStorage.setItem('traksos.token',token);
        localStorage.setItem('traksos.mode',mode);
      }
    },{token,mode,native:surface.native});
    const home=expectedTabs[mode][0];
    await page.goto(BASE+'/'+home,{waitUntil:'domcontentloaded'});
    await page.locator('.account-menu > summary').waitFor({state:'visible'});
    const audience={client:'client',performer:'performer',service:'performer',insurer:'insurer',inspection:'inspection'}[mode];
    const offers=await api('/api/me/offers','GET',undefined,token);
    for(const offer of offers.filter(x=>x.current&&!x.accepted&&(x.audience==='privacy'||x.audience===audience))){
      const dlg=page.getByRole('dialog',{name:offer.name});
      await dlg.waitFor({state:'visible',timeout:15000});
      await dlg.locator('input[type=checkbox]').check();
      await dlg.getByRole('button',{name:'Принимаю'}).click();
      await dlg.waitFor({state:'detached'});
    }
    await visibleRoute(page,home,assertClean);
    if(surface.width===390){
      assertRoleTabs(mode,await linksOf(page.locator('.tabbar a')));
      for(const href of expectedTabs[mode]){
        await clickRoute(page,page.locator('.tabbar a[href="'+href+'"]'),href,assertClean);
        await page.waitForFunction(target=>Array.from(document.querySelectorAll('.tabbar a.on')).map(x=>x.getAttribute('href')).join('|')===target,href);
        assertActiveTab(await linksOf(page.locator('.tabbar a.on')),href);
        result.clicked.push(href);
      }
      let menu=await openMobileMenu(page,assertClean);
      assertRoleMenu(mode,await linksOf(menu.locator('a[href^="#/"]')));
      for(const href of ['#/profile','#/support','#/help']){
        await clickRoute(page,menu.locator('a[href="'+href+'"]').first(),href,assertClean);
        result.clicked.push(href);
        menu=await openMobileMenu(page,assertClean);
      }
      await clickRoute(page,menu.locator('.tr-mobile-menu-home'),home,assertClean);
      result.clicked.push('return-home');
    }else{
      let menu=await openHeaderMenu(page);
      assertRoleMenu(mode,await linksOf(menu.locator('nav a[href^="#/"]')));
      for(const href of ['#/profile','#/support','#/help']){
        await clickRoute(page,menu.locator('nav a[href="'+href+'"]').first(),href,assertClean);
        if(await page.locator('.account-menu').evaluate(el=>el.open))throw Error('Header menu stayed open');
        result.clicked.push(href);
        menu=await openHeaderMenu(page);
      }
      await menu.locator('summary').press('Escape');
      if(await menu.evaluate(el=>el.open))throw Error('Escape did not close desktop menu');
    }
    if(!['client','performer','service'].includes(mode)){
      await page.goto(BASE+'/#/shop',{waitUntil:'domcontentloaded'});
      await page.getByText('Магазин доступен в клиентском кабинете или кабинете исполнителя.').waitFor({state:'visible'});
      result.shopDenied=true;
    }
    const logout=surface.width===390
      ?(await openMobileMenu(page,assertClean)).locator('.tr-mobile-menu-logout')
      :(await openHeaderMenu(page)).locator('.account-menu-logout');
    await logout.click();
    await page.waitForURL(url=>url.hash==='#/login',{timeout:15000});
    await page.waitForFunction(()=>localStorage.getItem('traksos.token')===null);
    // Wait for actual reloaded guest UI; a revoked token must not survive in the backend.
    await page.locator('.account-menu').waitFor({state:'detached',timeout:15000});
    await page.getByRole('heading',{name:'Вход по номеру телефона'}).waitFor({state:'visible',timeout:15000});
    const old=await fetch(BASE+'/api/me',{headers:{authorization:'Bearer '+token}});
    if(old.status!==401)throw Error('Logged-out token still authorized: '+old.status);
    if(unexpectedDialogs.length)throw Error('Unexpected dialog(s): '+unexpectedDialogs.join(' | '));
    await assertClean('logout');
    result.logoutRevoked=true;
    result.status='PASS';
    console.log(role,surface.name,'real clicks:',result.clicked.length,'logout revoked');
   }catch(error){result.error=String(error);console.error(role,surface.name,result.error);}
   finally{await ctx?.close();}
  }
 }
}finally{
 await browser.close();
 await writeFile(OUT+'/report.json',JSON.stringify({synthetic:true,production:false,source:'real Chromium clicks; Android bridge simulation is not native APK runtime',results:report},null,2));
}
if(report.length!==cases.length*surfaces.length||report.some(x=>x.status!=='PASS'))process.exitCode=1;
