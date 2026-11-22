// Regression for the real owner-approved 617 PC and 618 Android/browser UIs.
// The earlier test waited for retired .and19-cover img and desktop-hero markup.
// Keep meaningful photo, click, routing, visibility and overflow assertions.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE=process.env.BASE_URL ?? 'http://127.0.0.1:8080';
if(!['localhost','127.0.0.1'].includes(new URL(BASE).hostname))
  throw Error('Approved visual acceptance must use local isolated CI data');

const login=await fetch(BASE+'/api/auth/login',{method:'POST',
  headers:{'content-type':'application/json'},
  body:JSON.stringify({phone:'+79990000141',password:'Test-Role-Only-2026!'})});
if(!login.ok)throw Error('Local synthetic owner unavailable: '+login.status);
const {token}=await login.json();
await mkdir('e2e/shots/approved-truck',{recursive:true});

const browser=await chromium.launch();
const checkOverflow=async(page,label)=>{
  const g=await page.evaluate(()=>({
    client:document.documentElement.clientWidth,
    scroll:document.documentElement.scrollWidth,
    body:document.body.scrollWidth
  }));
  if(g.scroll>g.client+3||g.body>g.client+3)
    throw Error(label+': horizontal overflow '+JSON.stringify(g));
};
const checkImage=async(locator,label)=>{
  const img=await locator.first().elementHandle();
  if(!img)throw Error(label+': image element missing');
  const state=await img.evaluate(async i=>{
    if(!i.complete)await i.decode().catch(()=>{});
    const r=i.getBoundingClientRect();
    return {complete:i.complete,width:i.naturalWidth,height:i.naturalHeight,visible:r.width>40&&r.height>30};
  });
  if(!state.complete||state.width<100||!state.visible)
    throw Error(label+': approved artwork missing '+JSON.stringify(state));
};
try{
  for(const width of [390,1440]){
    const nativeApp=width<900;
    const ctx=await browser.newContext({viewport:{width,height:900},locale:'ru-RU'});
    const page=await ctx.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(({token,nativeApp})=>{
      if(nativeApp)Object.defineProperty(window,'TrakSOSNative',{
        configurable:true,value:{
          isApp:()=>true,setSession:()=>{},pushToken:()=>'',performerOnline:()=>{},
          appLockEnabled:()=>false,setAppLockEnabled:()=>false
        }
      });
      localStorage.setItem('traksos.token',token);
      localStorage.setItem('traksos.mode','client');
    },{token,nativeApp});
    await page.goto(BASE+'/#/',{waitUntil:'domcontentloaded'});

    if(nativeApp){
      const android=page.locator('main.client-dashboard .and19-workspace.and19-client');
      await android.waitFor({state:'visible',timeout:15000});
      await android.locator('.and19-cover h1').getByText('Рабочий стол',{exact:true}).waitFor();
      // The canonical 618 home deliberately has a TEXT heading and an
      // order-only photo. Never re-add a cropped decorative hero image.
      if(await android.locator('.and19-cover img,.desktop-hero,.desktop-quick-links').count())
        throw Error('618 Android resurrected old hero/image renderer');
      const services=android.locator('.and19-services>a');
      if(await services.count()!==4)
        throw Error('618 Android needs exactly four real help actions');
      for(const a of await services.all()){
        if(!await a.locator('svg').count())throw Error('618 Android lost vector service icon');
      }
      await checkOverflow(page,'Android owner '+width);
      await page.screenshot({path:'e2e/shots/approved-truck/client-'+width+'.png',fullPage:true});
      await android.locator('.and19-services>a[href="#/sos"]').click();
    }else{
      const pc=page.locator('main.approved-pc.approved-pc-client');
      await pc.waitFor({state:'visible',timeout:15000});
      await checkImage(pc.locator('.approved-pc-heading>img'),'617 signed-in client header');
      if(await pc.locator('.desktop-hero,.desktop-quick-links').count())
        throw Error('Old desktop-hero leaked into approved PC cabinet');
      if(!await pc.locator('a[href="#/sos"]').count())
        throw Error('Approved PC client does not offer a real SOS action');
      await checkOverflow(page,'PC owner '+width);
      await page.screenshot({path:'e2e/shots/approved-truck/client-'+width+'.png',fullPage:true});
      await pc.locator('a[href="#/sos"]').first().click();
    }
    await page.locator('.client-sos-choices').waitFor({state:'visible',timeout:15000});
    if(await page.locator('.client-sos-choice').count()!==3)
      throw Error(width+'px approved SOS must retain the three main help directions');
    await page.getByRole('button',{name:/Выездной мастер/}).click();
    if(await page.locator('.client-sos-specialty').count()!==5)
      throw Error(width+'px approved master must keep the five verified specialties');
    if(errors.length)throw Error(width+'px authenticated page JS errors: '+errors.join('; '));
    await ctx.close();

    const guest=await browser.newContext({viewport:{width,height:900},locale:'ru-RU'});
    const p=await guest.newPage();
    const guestErrors=[];
    p.on('pageerror',e=>guestErrors.push(e.message));
    await p.goto(BASE+'/#/',{waitUntil:'domcontentloaded'});
    if(width<900){
      const home=p.locator('main.public-landing');
      await home.waitFor({state:'visible'});
      const art=home.locator('.public-hero-visual');
      await art.waitFor({state:'visible'});
      const info=await art.evaluate(el=>({
        photo:getComputedStyle(el).backgroundImage,
        fit:getComputedStyle(el).backgroundSize,
        w:el.getBoundingClientRect().width,
        h:el.getBoundingClientRect().height
      }));
      if(info.w<100||info.h<100||
         !info.photo.includes('tracksos-approved-hero-owner-20261119')||
         info.photo.includes('tracksos-approved-scenic-hero'))
        throw Error('Approved mobile browser photo replaced by obsolete asset '+JSON.stringify(info));
      if(await home.locator('.public-service-tiles>a').count()!==6)
        throw Error('Mobile public catalog must retain six clickable services');
      await p.getByRole('button',{name:'Следующее фото'}).click();
      if(!await p.getByRole('heading',{name:/Эвакуация грузовиков/}).count())
        throw Error('Mobile hero did not advance to the tow slide');
      await p.getByRole('button',{name:'Следующее фото'}).click();
      if(!await p.getByRole('heading',{name:/Ремонт и запись в СТО/}).count())
        throw Error('Mobile hero did not advance to the station slide');
      await p.getByRole('button',{name:/Показать фото 1:/}).click();
      await checkOverflow(p,'mobile guest');
      await p.screenshot({path:'e2e/shots/approved-truck/public-'+width+'.png',fullPage:true});
      await home.getByRole('button',{name:'Зарегистрироваться'}).click();
      await p.waitForURL('**/#/register');
    }else{
      const home=p.locator('main.owner20-home');
      await home.waitFor({state:'visible'});
      const hero=home.locator('.owner20-photo');
      const photo=await hero.evaluate(el=>getComputedStyle(el).backgroundImage);
      if(!photo.includes('owner20-photo-background-approved.webp'))
        throw Error('617 PC hero must use owner-approved background, not retired truck: '+photo);
      const approved=await p.request.get(BASE+'/owner20-photo-background-approved.webp');
      if(!approved.ok()||(await approved.body()).byteLength<15000)
        throw Error('617 PC approved hero image is unavailable');
      if(await home.locator('.owner20-quick>a').count()!==5||
         await home.locator('.owner20-quick-icon svg').count()!==5||
         await home.locator('.owner20-features>a').count()!==5)
        throw Error('617 PC needs five vector service shortcuts and five approved service tiles');
      if(await p.locator('.public-landing,.desktop-hero,.desktop-quick-links').count())
        throw Error('Retired public or client desktop shell mounted over approved 617 PC home');
      await checkOverflow(p,'617 desktop guest');
      await p.screenshot({path:'e2e/shots/approved-truck/public-'+width+'.png',fullPage:true});
      await home.locator('.owner20-signin').click();
      await p.waitForURL('**/#/login');
    }
    if(guestErrors.length)throw Error(width+'px guest JS errors: '+guestErrors.join('; '));
    await guest.close();
    console.log('APPROVED REAL UI PASS '+width+'px: signed-in cabinet, guest visuals, no old fallback and live navigation');
  }
}finally{
  await browser.close();
}