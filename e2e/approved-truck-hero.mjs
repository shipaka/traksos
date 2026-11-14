// Inspect the actual approved Scania asset and real customer desktop whitespace.
// Local seeded CI only. This is a visual gate, not a decorative mockup.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8080';
if (!['localhost','127.0.0.1'].includes(new URL(BASE).hostname))
  throw Error('Truck hero visual audit is restricted to localhost');

const login=await fetch(BASE+'/api/auth/login',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({phone:'+79990000141',password:'Test-Role-Only-2026!'})
});
if(!login.ok)throw Error('Local owner fixture unavailable: '+login.status);
const {token}=await login.json();
await mkdir('e2e/shots/approved-truck',{recursive:true});

const browser=await chromium.launch();
try{
  for(const width of [390,1440]){
    const context=await browser.newContext({viewport:{width,height:900},locale:'ru-RU'});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(t=>{
      localStorage.setItem('traksos.token',t);
      localStorage.setItem('traksos.mode','client');
    },token);
    await page.goto(BASE+'/#/',{waitUntil:'domcontentloaded'});
    const artwork=page.locator('.client-home .client-hero-art img');
    await artwork.waitFor({state:'visible'});
    await artwork.evaluate(async img=>{
      if(!img.complete)await new Promise((resolve,reject)=>{
        img.addEventListener('load',resolve,{once:true});
        img.addEventListener('error',reject,{once:true});
      });
    });
    const check=await page.evaluate(()=>{
      const image=document.querySelector('.client-home .client-hero-art img');
      const shell=document.querySelector('.client-home .desktop-hero');
      const picture=image?.getBoundingClientRect();
      const outer=shell?.getBoundingClientRect();
      const aside=document.querySelector('.desktop-home-aside');
      const art=document.querySelector('.client-home .client-hero-art');
      const computed=shell?getComputedStyle(shell):null;
      return {
        appClass:document.querySelector('.app')?.className,
        heroDisplay:computed?.display,
        heroBackground:computed?.backgroundImage?.slice(0,200),
        heroColumns:computed?.gridTemplateColumns,
        heroMatched:!!shell?.matches('.app.role-client .desktop-content .client-home .desktop-hero'),
        art:{left:art?.getBoundingClientRect().left,right:art?.getBoundingClientRect().right,width:art?.getBoundingClientRect().width},
        firstActionDisplay:document.querySelector('.desktop-primary-action')?getComputedStyle(document.querySelector('.desktop-primary-action')).display:'missing',
        nativeWidth:image?.naturalWidth,
        nativeHeight:image?.naturalHeight,
        objectFit:image?getComputedStyle(image).objectFit:null,
        image:{left:picture?.left,right:picture?.right,top:picture?.top,bottom:picture?.bottom},
        hero:{left:outer?.left,right:outer?.right,top:outer?.top,bottom:outer?.bottom},
        asideCards:aside?.querySelectorAll('.desktop-aside-card').length??0,
        asideVisible:aside?getComputedStyle(aside).display!=='none':false,
        pageWidth:document.documentElement.scrollWidth,
        viewport:document.documentElement.clientWidth
      };
    });
    await page.waitForTimeout(450);
    await page.screenshot({path:'e2e/shots/approved-truck/client-'+width+'.png',fullPage:true});
    console.log('Scania computed layout '+width+'px: '+JSON.stringify(check));
    if(!check.nativeWidth||!check.nativeHeight||check.objectFit!=='contain')
      throw Error(width+'px approved truck image missing or cropped by CSS: '+JSON.stringify(check));
    if(!check.hero||!check.art||check.art.left<check.hero.left-2||check.art.right>check.hero.right+2)
      throw Error(width+'px image panel overflows hero: '+JSON.stringify(check));
    if(check.heroBackground?.includes('url('))
      throw Error(width+'px duplicated background truck image: '+JSON.stringify(check));
    if(width>=900 && check.heroDisplay!=='grid')
      throw Error(width+'px desktop hero grid is missing: '+JSON.stringify(check));
    if(width<900 && await page.locator('.tracksos-dashboard-aside .tracksos-primary-help').count()!==1)
      throw Error(width+'px central roadside help action missing');
    if(check.pageWidth>check.viewport+3)
      throw Error(width+'px horizontal overflow: '+JSON.stringify(check));
    if(width>=900 && (!check.asideVisible||check.asideCards<4))
      throw Error(width+'px useful right column not filled: '+JSON.stringify(check));
    const directions=page.locator('.client-help-directions .client-direction-card');
    if(await directions.count()!==4)throw Error(width+'px: expected exactly four help directions');
    if(await page.locator('.client-help-directions .opt').count())
      throw Error(width+'px: obsolete symptom switcher returned');
    const master=page.getByRole('button',{name:/Выездной мастер/});
    await master.click();
    if(await master.getAttribute('aria-expanded')!=='true')
      throw Error(width+'px: master specialties did not expand');
    if(await directions.count()!==1)
      throw Error(width+'px: unrelated directions must hide after choosing master');
    if(await page.locator('.client-specialization-card').count()!==5)
      throw Error(width+'px: five master specializations missing');
    await page.emulateMedia({reducedMotion:'reduce'});
    const motion=await directions.first().evaluate(el=>getComputedStyle(el).animationName);
    if(motion!=='none')throw Error(width+'px: reduced motion preference not respected: '+motion);
    await page.getByRole('link',{name:/Диагност/}).first().click();
    await page.locator('#f-what textarea').waitFor({state:'visible'});
    if(await page.locator('#f-what button.chip').count()!==0)
      throw Error(width+'px: old fault-reason preset chips still appear inside the order');
    if(errors.length)throw Error(width+'px JS error: '+errors.join('; '));
    await context.close();

    const guest=await browser.newContext({viewport:{width,height:900},locale:'ru-RU'});
    const publicPage=await guest.newPage();
    await publicPage.goto(BASE+'/#/',{waitUntil:'domcontentloaded'});
    await publicPage.locator('.public-landing .public-hero-visual').waitFor();
    const style=await publicPage.locator('.public-landing .public-hero-visual')
      .evaluate(el=>getComputedStyle(el).backgroundSize);
    if(!style.split(',').some(v=>v.trim()==='contain'))
      throw Error(width+'px public approved truck artwork is not contained: '+style);
    await publicPage.waitForTimeout(450);
    await publicPage.screenshot({path:'e2e/shots/approved-truck/public-'+width+'.png',fullPage:true});
    await guest.close();
  }
}finally{await browser.close();}
console.log('Approved Scania preserved uncropped, useful desktop customer sidebar, phone/PC and public screenshots OK');
