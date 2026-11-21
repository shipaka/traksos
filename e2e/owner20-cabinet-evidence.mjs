// Real rendered desktop cabinet evidence. Synthetic accounts ONLY on local CI,
// never a production token, never a synthetic design/mock image.
import { chromium } from 'playwright';
import { mkdir,writeFile } from 'node:fs/promises';
const BASE=process.env.BASE_URL||'http://127.0.0.1:8080';
if(!['localhost','127.0.0.1'].includes(new URL(BASE).hostname))throw Error('Local CI only');
const out='e2e/shots/owner20-cabinets';
await mkdir(out,{recursive:true});
const cases=[
 {id:'owner',phone:'+79990000341',accountType:'owner',mode:'client',url:'#/',inside:'#/garage'},
 {id:'driver',phone:'+79990000342',accountType:'driver',mode:'client',url:'#/',inside:'#/orders'},
 {id:'master',phone:'+79990000343',accountType:'master',mode:'performer',url:'#/work',inside:'#/work/me'},
 {id:'tow',phone:'+79990000344',accountType:'tow',mode:'performer',url:'#/work',inside:'#/work/jobs'},
 {id:'service',phone:'+79990000345',accountType:'service',mode:'service',url:'#/base',inside:'#/base/me'},
 {id:'master_service',phone:'+79990000346',accountType:'master_service',mode:'service',url:'#/base',inside:'#/base/money'},
 {id:'insurer',phone:'+79990000347',accountType:'insurer',mode:'insurer',url:'#/insurance',inside:'#/profile'},
 {id:'admin',phone:'+79990000348',accountType:'owner',mode:'admin',url:'#/admin',inside:'#/admin/section/orders',needs:'admin'},
 {id:'moderator',phone:'+79990000349',accountType:'owner',mode:'moderator',url:'#/moderation',inside:'#/profile',needs:'moderator'}
];
async function post(path,body,token){
 const r=await fetch(BASE+path,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
 const data=await r.json().catch(()=>null);if(!r.ok)throw Error(path+' HTTP '+r.status+' '+JSON.stringify(data));return data;
}
async function get(path,token){
 const r=await fetch(BASE+path,{headers:{authorization:'Bearer '+token}});
 const data=await r.json().catch(()=>null);
 if(!r.ok)throw Error(path+' HTTP '+r.status+' '+JSON.stringify(data));
 return data;
}
async function put(path,body,token){
 const r=await fetch(BASE+path,{method:'PUT',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(body)});
 const data=await r.json().catch(()=>null);
 if(!r.ok)throw Error(path+' HTTP '+r.status+' '+JSON.stringify(data));
 return data;
}
/** Prepare genuine role dashboards using LOCAL synthetic accounts.
 * Avoid publishing fixture accounts, implying real partners or altering live data.
 * No job/order/payment is created by this visual test. */
async function ensureConfiguredWorkspace(c,token){
 if(['master','tow','master_service'].includes(c.id)){
  const profile=await get('/api/performer/profile',token);
  const kind=c.id==='tow'?'tow':'master';
  if(!profile){
   await put('/api/performer/profile',{
    kind,name:c.id==='tow'?'Тестовый эвакуаторщик — локальный стенд':'Тестовый мастер — локальный стенд',
    specialties:kind==='tow'?[]:['electric','diag'],brands:{},tier:'eco'
   },token);
  }
 }
 if(['service','master_service'].includes(c.id)){
  const data=await get('/api/base',token);
  if(!data?.center){
   await put('/api/base',{
    name:'Тестовая СТО TrakSOS — локальный стенд',
    address:'Санкт-Петербург, только тестовый стенд',
    brands:['Scania','Volvo'],accepts:['quick','day']
   },token);
  }
 }
}
const browser=await chromium.launch();
const results=[];
let localAdminToken=null;
try{
 for(const c of cases){
  try{
   const sms=await post('/api/auth/code',{phone:c.phone});
   if(!/^\d{4,6}$/.test(sms?.devCode||''))throw Error('Dev SMS code not provided');
   const account=await post('/api/auth/verify',{phone:c.phone,code:sms.devCode,accountType:c.accountType,password:'Visual-Local-2026!'});
   if(!account?.token)throw Error('No session token');
   let token=account.token;
   if(c.id==='admin' && account.user?.roles?.includes('admin'))localAdminToken=token;
   // A moderator role is NEVER granted by SMS possession. Use the real
   // administrator-only role assignment, then log in again because the
   // backend correctly invalidates prior sessions on privilege changes.
   if(c.id==='moderator' && !account.user?.roles?.includes('moderator')){
     if(!localAdminToken)throw Error('Local admin account must be created first');
     await post('/api/admin/users/'+account.user.id+'/roles',{roles:['moderator']},localAdminToken);
     const fresh=await post('/api/auth/login',{phone:c.phone,password:'Visual-Local-2026!'});
     if(!fresh.token)throw Error('Moderator password login failed after role assignment');
     token=fresh.token;
   }
   const identity=await get('/api/me',token);
   if(c.needs && !identity.roles?.includes(c.needs))throw Error('Staff role not confirmed by live /api/me: '+c.needs);
   await ensureConfiguredWorkspace(c,token);
   for(const width of (c.id==='admin'?[1440,1672,390]:[1440,390])){
    const context=await browser.newContext({viewport:{width,height:width===390?844:width===1672?941:900},locale:'ru-RU',deviceScaleFactor:c.id==='owner'?2:1});
    const page=await context.newPage();
    const errors=[];page.on('pageerror',x=>errors.push(x.message));
    await page.addInitScript(({token,mode})=>{localStorage.setItem('traksos.token',token);localStorage.setItem('traksos.mode',mode)}, {token,mode:c.mode});
    try {
     await page.goto(BASE+'/'+c.url,{waitUntil:'domcontentloaded'});
     await page.locator('.app').waitFor();
     // Accept the current local offer through the real UI if required.
     const offers=await fetch(BASE+'/api/me/offers',{headers:{authorization:'Bearer '+token}}).then(r=>r.ok?r.json():[]);
     for(const o of offers.filter(x=>x.current&&!x.accepted)){
       const dlg=page.getByRole('dialog',{name:o.name});
       await dlg.waitFor({state:'visible',timeout:12000});
       await dlg.locator('input[type=checkbox]').check();
       await dlg.getByRole('button',{name:'Принимаю'}).click();
       await dlg.waitFor({state:'detached',timeout:12000});
     }
     await page.locator('.account-menu > summary').waitFor({timeout:14000});
     await page.evaluate(()=>document.fonts.ready);
     await page.waitForTimeout(650);
     const dims=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
     if(dims.scroll>dims.client+3){
       const offenders=await page.evaluate(()=>Array.from(document.querySelectorAll('body *'))
         .filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.right>innerWidth+5;})
         .slice(0,10).map(el=>({tag:el.tagName,cls:String(el.className).slice(0,100),
           right:Math.round(el.getBoundingClientRect().right),
           width:Math.round(el.getBoundingClientRect().width)})));
       throw Error('Horizontal overflow '+JSON.stringify({dims,offenders}));
     }
     if(errors.length)throw Error('Uncaught errors '+errors.join('; '));
     if(c.id==='moderator'&&await page.locator('.trakbot-dock').count())
       throw Error('Moderator workdesk unexpectedly shows floating TrakBot: '+width);
     if(c.id==='owner' && width===390){
       // The 618.png phone dashboard uses four SVG service actions and
       // genuine vehicle/order links, not the retired desktop crop atlas.
       const desk=page.locator('main .and19-workspace.and19-client');
       await desk.waitFor({state:'visible',timeout:14_000});
       const visual=await page.evaluate(()=>{
         const logo=document.querySelector('.top .tr-approved-brand-logo img');
         const services=Array.from(document.querySelectorAll('.and19-client .and19-services>a'));
         return {
           logo:logo?.getAttribute('src'),
           logoLoaded:!!logo?.complete && logo.naturalWidth===274 && logo.naturalHeight===46,
           logoWidth:logo?.getBoundingClientRect().width ?? 0,
           icons:document.querySelectorAll('.and19-client .and19-service-symbol svg').length,
           routes:services.map(a=>a.getAttribute('href')),
           oldCards:document.querySelectorAll('.desktop-quick-links,.desktop-quick-card,.desktop-hero').length,
           tabs:Array.from(document.querySelectorAll('.tabbar a')).map(a=>a.getAttribute('href')),
         };
       });
       const expected=['#/sos','#/new/tow','#/services','#/new/consult'];
       const tabs=['#/','#/orders','#/air','#/garage','#/menu'];
       if(visual.logo!=='/traksos-brand-logo-approved-618.png'||!visual.logoLoaded||
          visual.logoWidth>274.5||visual.icons!==4||visual.oldCards!==0||
          JSON.stringify(visual.routes)!==JSON.stringify(expected)||
          JSON.stringify(visual.tabs)!==JSON.stringify(tabs))
         throw Error('Owner-approved 618 phone actions, logo or navigation broken: '+JSON.stringify(visual));
       console.log('Approved owner 618.png mobile workspace: real SVG services, links and logo PASS');
     }
     if(width>=1440) {
       // 20 Nov owner-approved desktop contracts: real React workdesk, not an image.
       const workdesk=page.locator('.approved-pc');
       await workdesk.waitFor({timeout:14000});
       const roleExpected=c.id==='master_service'?'service':c.id;
       const roleClass='approved-pc-'+(roleExpected==='owner'||roleExpected==='driver'?'client':roleExpected==='tow'||roleExpected==='master'?'performer':roleExpected==='insurer'?'insurance':roleExpected);
       if(!await workdesk.evaluate((node,cls)=>node.classList.contains(cls),roleClass))
         throw Error('Wrong approved role workdesk: '+c.id+' expected '+roleClass);
       const columns=page.locator('.approved-pc-three');
       if(await columns.count()!==1)throw Error('Exactly one full-size workdesk expected: '+c.id);
       const realTabs=page.locator(['owner','driver'].includes(c.id)
         ?'.approved-pc-active-order-nav .approved-pc-tabs [role="tab"]'
         :'.approved-pc > .approved-pc-tabs [role="tab"]');
       // A brand-new driver/fleet owner with zero active jobs has no fake order tab.
       if(!['driver','owner','admin'].includes(c.id)&&await realTabs.count()<1)
         throw Error('Desktop tabs missing: '+c.id);
       if(['driver','owner'].includes(c.id)&&await page.locator('.approved-pc-order-heading').count()!==1)
         throw Error('Owner/driver active orders heading missing');
       if(['master','tow'].includes(c.id)){
         if(await realTabs.count()!==2)throw Error('Expected current work and new offers modes: '+c.id);
         await realTabs.nth(1).click();
         if((await realTabs.nth(1).getAttribute('aria-selected'))!=='true')throw Error('New offers mode did not change');
         await realTabs.nth(0).click();
       }
       if(c.id==='admin'){
         const outline=page.locator('.approved-pc-russia');
         if(await outline.count()!==1)throw Error('Approved Russia map is missing');
         const image=await outline.evaluate(el=>getComputedStyle(el,'::before').backgroundImage);
         if(!image.includes('traksos-russia-outline.svg'))throw Error('Admin map is not the approved Russia outline: '+image);
       }
       if(c.id==='moderator'&&await workdesk.locator('.approved-pc-bot').count())
         throw Error('Moderator workdesk must not force TrakBot');
       if(!['moderator','admin'].includes(c.id)&&await workdesk.locator('.approved-pc-bot').count()!==1)
         throw Error('Expected original TrakBot launch for '+c.id);
       // The desktop must show ONE onboarding prompt, not two stacked panels.
       const prompts=await page.locator('.tr-training-invite:visible, section.card[aria-label="Знакомство с TrakSOS"]:visible').count();
       if(prompts>1)throw Error('Duplicate desktop training prompts: '+prompts);
     }
     await page.screenshot({path:out+'/'+c.id+'-home-'+width+'-viewport.png',fullPage:false,animations:'disabled',scale:'css'});
     await page.screenshot({path:out+'/'+c.id+'-home-'+width+'.png',fullPage:true,animations:'disabled',scale:'css'});
     if(c.id==='owner')await page.screenshot({
       path:out+'/'+c.id+'-home-'+width+'-retina2x.png',fullPage:false,animations:'disabled',scale:'device'
     });
     await page.goto(BASE+'/'+c.inside,{waitUntil:'domcontentloaded'});
     await page.locator('.account-menu > summary').waitFor({timeout:12000});
     await page.waitForTimeout(500);
     if(await page.getByText('Не удалось открыть раздел').count())throw Error('Inner route crashed');
     if(c.id==='moderator'&&await page.locator('.trakbot-dock').count())
       throw Error('Moderator inner page unexpectedly shows floating TrakBot: '+width);
     if(c.id==='admin') await page.locator('.admin-stage-content .admin-orders-zero, .admin-stage-content .list-item').first().waitFor({timeout:12000});
     if(c.id==='owner'){
       const header=page.locator('.client-garage-page>.client-section-hero');
       await header.waitFor();
       const geometry=await header.evaluate(el=>({
         height:el.getBoundingClientRect().height,
         leftBorder:parseFloat(getComputedStyle(el).borderLeftWidth)
       }));
       if(geometry.height>160 || geometry.leftBorder<3)
         throw Error('Owner garage restored an oversized old-style header: '+JSON.stringify(geometry));
     }
     await page.screenshot({path:out+'/'+c.id+'-inside-'+width+'-viewport.png',fullPage:false,animations:'disabled',scale:'css'});
     await page.screenshot({path:out+'/'+c.id+'-inside-'+width+'.png',fullPage:true,animations:'disabled',scale:'css'});
     // The inspection API accepts both insurers and inspection operators.
     // Verify the partner UI applies the SAME role policy on direct navigation.
     if(c.id==='insurer'){
       if(!identity.roles.includes('insurer'))throw Error('Insurer role was not seeded');
       await page.goto(BASE+'/#/inspections',{waitUntil:'domcontentloaded'});
       await page.locator('.account-menu > summary').waitFor({timeout:14000});
       if(await page.getByText('Нет прав оператора техосмотра').count())
         throw Error('Insurer cannot access the inspection workspace despite server authorization');
       await page.locator(width>=1440?'.approved-pc-insurance':'.partner-workspaces')
         .first().waitFor({state:'visible',timeout:14000});
       await page.screenshot({path:out+'/insurer-inspection-'+width+'-viewport.png',
         fullPage:false,animations:'disabled',scale:'css'});
       // Both submenu routes must resolve to their proper contents, rather
       // than the general approved dashboard or a fake missing inspection.
       await page.goto(BASE+'/#/inspections/processing',{waitUntil:'domcontentloaded'});
       await page.locator('.partner-workspaces').waitFor({state:'visible',timeout:14000});
       if(await page.getByText('Техосмотр не найден среди назначенных вам заявок.').count())
         throw Error('Inspection processing list was parsed as an inspection ID');
       const unknownId='00000000-0000-4000-8000-000000000001';
       await page.goto(BASE+'/#/inspections/'+unknownId,{waitUntil:'domcontentloaded'});
       await page.getByText('Техосмотр не найден среди назначенных вам заявок.').waitFor({timeout:14000});
       if(await page.locator('.approved-pc').count())
         throw Error('A direct inspection detail route incorrectly showed the generic desktop dashboard');
     }
     results.push({role:c.id,width,height:width===390?844:width===1672?941:900,result:'screens saved',files:[
       c.id+'-home-'+width+'-viewport.png',
       c.id+'-home-'+width+'.png',
       c.id+'-inside-'+width+'-viewport.png',
       c.id+'-inside-'+width+'.png',
       ...(c.id==='owner'?[c.id+'-home-'+width+'-retina2x.png']:[]),
     ]});
    }finally{await context.close()}
   }
  }catch(error){
   results.push({role:c.id,result:'FAILED',error:String(error)});
   console.error(c.id+': '+String(error));
  }
 }
}finally{await browser.close();}
await writeFile(out+'/capture-report.json',JSON.stringify(results,null,2));
console.log('Owner PC cabinet evidence (real Chromium):',JSON.stringify(results));
const failures=results.filter(x=>x.result==='FAILED');
if(failures.length)process.exitCode=1;
