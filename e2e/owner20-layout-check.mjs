// TrakSOS 20 Nov desktop owner layout & route contract. The 19 Nov mobile
// assertions live in their own tests, not applied to the newly approved PC.
import { chromium } from 'playwright';
import {mkdir} from 'node:fs/promises';
const BASE=process.env.BASE_URL||'http://127.0.0.1:8080';
if(!['localhost','127.0.0.1'].includes(new URL(BASE).hostname)) throw Error('Local CI only');
await mkdir('e2e/shots/owner20-pc',{recursive:true});
const browser=await chromium.launch();
try {
 for(const width of [900,1024,1280,1440,1536,1672]){
  const ctx=await browser.newContext({viewport:{width,height:width===1536?864:900},locale:'ru-RU'});
  const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto(BASE+'/#/',{waitUntil:'domcontentloaded'});
   const root=page.locator('.owner20-home');await root.waitFor();
   const cards=await page.locator('.owner20-quick>a').count();
   const features=await page.locator('.owner20-features>a').count();
   const bottom=await page.locator('.owner20-bottom>.owner20-bottom-card').count();
   if(cards!==5||features!==5||bottom!==4)throw Error(width+': wrong approved rows '+cards+'/'+features+'/'+bottom);
   const heading=await page.locator('.owner20-lead h1').innerText();
   if(!heading.includes('Помощь в дороге.')||!heading.includes('для грузового транспорта'))throw Error('Wrong owner headline');
   const overflow=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
   if(overflow.scroll>overflow.client+3)throw Error(width+': desktop overflow '+JSON.stringify(overflow));
   if(errors.length)throw Error(width+': JS error '+errors.join('; '));
   // Visual contract from the real 1536x864 617.png, not a later assistant sketch.
   // Verify source imagery comes from the owner's bundled crop sprite and the
   // former 19 Nov truck cannot creep back through a CSS fallback.
   const art=await page.evaluate(async () => {
     const photo=document.querySelector('.owner20-photo');
     const map=document.querySelector('.owner20-map-source');
     const feature=document.querySelector('.owner20-feature-illustration');
     const logo=document.querySelector('.owner20-mark');
     const pick=(el,pseudo)=>el?getComputedStyle(el,pseudo).backgroundImage:'';
     const measure=async (path)=>{
       const res=await fetch(path);
       if(!res.ok) return {status:res.status,w:0,h:0};
       const image=await createImageBitmap(await res.blob()).catch(()=>null);
       return {status:res.status,w:image?.width??0,h:image?.height??0};
     };
     const [sprite,approvedHero,approvedLogo]=await Promise.all([
       measure('/owner20-artwork-sprite.webp'),
       measure('/owner20-photo-background-approved.webp'),
       measure('/owner20-header-logo-approved.webp'),
     ]);
     const rect=(selector)=>{const r=document.querySelector(selector)?.getBoundingClientRect();return r&&{x:r.x,y:r.y,w:r.width,h:r.height};};
     return {
       photo:pick(photo,'::after'),map:pick(map),feature:pick(feature),
       logo:pick(logo),sprite,approvedHero,approvedLogo,
       head:rect('.owner20-top'),hero:rect('.owner20-hero'),
       quick:rect('.owner20-quick'),features:rect('.owner20-features'),
       bottom:rect('.owner20-bottom'),coverage:rect('.owner20-map'),
     };
   });
   const expectedHero=width>=1281?'owner20-photo-background-approved.webp':'owner20-artwork-sprite.webp';
   if(!art.photo.includes(expectedHero) ||
      !art.map.includes('owner20-artwork-sprite.webp') ||
      !art.feature.includes('owner20-artwork-sprite.webp') ||
      !art.logo.includes('owner20-header-logo-approved.webp') ||
      art.photo.includes('tracksos-approved-hero-owner-20261119') ||
      art.sprite?.w!==1018 || art.sprite?.h!==446 ||
      art.approvedHero?.w!==1536 || art.approvedHero?.h!==324 ||
      art.approvedLogo?.w!==235 || art.approvedLogo?.h!==53)
     throw Error(width+': approved 617.png image or loaded size regressed '+JSON.stringify(art));
   if(width===1536){
     const near=(got,expected)=>Math.abs(got-expected)<=7;
     if(!art.head||!art.hero||!art.quick||!art.features||!art.bottom||!art.coverage||
        !near(art.head.y,0)||!near(art.head.h,66)||
        !near(art.hero.y,66)||!near(art.hero.h,324)||
        !near(art.quick.y,391)||!near(art.quick.h,85)||
        !near(art.features.y,493)||!near(art.features.h,144)||
        !near(art.bottom.y,654)||!near(art.bottom.h,177)||
        !near(art.coverage.x,986)||!near(art.coverage.y,96))
       throw Error('1536x864 approved 617.png geometry regressed: '+JSON.stringify(art));
   }
   await page.screenshot({path:'e2e/shots/owner20-pc/home-'+width+'.png',fullPage:true,animations:'disabled'});
   if(width===1536){
    for(const key of ['van','tow','sto','ecu','consult','tech','parts','insurance','inspection','air','club']){
     await page.goto(BASE+'/#/',{waitUntil:'domcontentloaded'});
     const link=page.locator('.owner20-home a[href="#/explore/'+key+'"]:visible').first();
     await link.waitFor();await link.click();
     await page.waitForURL('**/#/explore/'+key);
     await page.locator('.guest-explore-hero h1').waitFor();
    }
    for(const [selector,target] of [['.owner20-signin','#/login'],['.owner20-topnav a[href="#/join"]','#/join']]){
     await page.goto(BASE+'/#/');
     if(selector.includes('topnav')){await page.locator('.owner20-topnav summary').nth(3).click();}
     const l=page.locator(selector);await l.waitFor();await l.click();await page.waitForURL('**/'+target);
    }
   }
  }finally{await ctx.close();}
 }
 console.log('Approved 20 Nov PC: 6 desktop widths, 5+5+4 content, no overflow, 11 working feature routes, real screenshots');
}finally{await browser.close();}
