// Search is retained on secondary desktop pages; 617.png guest PC home has
// its own approved header, and mobile uses the "Возможности" catalogue.
// Test actual public routes rather than requiring a retired hero heading.
import { chromium } from 'playwright';
const BASE=process.env.BASE_URL??'http://127.0.0.1:8080';
if(!['127.0.0.1','localhost'].includes(new URL(BASE).hostname))
 throw Error('Header search smoke is local only');
const browser=await chromium.launch();
const errors=[];
async function session(term, select, expectedHash){
 const page=await browser.newPage({viewport:{width:1440,height:900},locale:'ru-RU'});
 page.on('pageerror',error=>errors.push(error.message));
 try{
   await page.goto(BASE+'/#/explore/parts',{waitUntil:'domcontentloaded'});
   await page.locator('.guest-explore-hero h1').waitFor({state:'visible'});
   const search=page.getByRole('searchbox',{name:'Поиск разделов и услуг'});
   // Approved desktop header keeps search collapsed to an icon until focused.
   await page.locator('.track-site-search-icon').click();
   await search.waitFor({state:'visible'});
   await search.fill(term);
   const options=page.locator('#track-search-list');
   if(select){
     const found=options.getByRole('option',{name:select});
     await found.waitFor({state:'visible'});
     await found.click();
     await page.waitForURL(new RegExp('#/'+expectedHash+'$'));
   }else{
     await options.getByText(/Раздел не найден/).waitFor();
     await search.press('Escape');
     if(await options.count())throw Error('Escape did not close search results');
   }
 }finally{await page.close();}
}
async function mobile(){
 const page=await browser.newPage({viewport:{width:390,height:844},locale:'ru-RU'});
 page.on('pageerror',error=>errors.push(error.message));
 try{
   await page.goto(BASE+'/#/explore/parts',{waitUntil:'domcontentloaded'});
   await page.locator('.guest-explore-hero h1').waitFor({state:'visible'});
   const search=page.getByRole('searchbox',{name:'Поиск разделов и услуг'});
   if(await search.isVisible())throw Error('Unapproved desktop search overlay on mobile');
   const catalogue=page.locator('.guest-mobile-catalog summary');
   await catalogue.waitFor({state:'visible'});
   await catalogue.click();
   const nav=page.locator('.guest-mobile-catalog nav[aria-label="Возможности TrakSOS"]');
   await nav.locator('a[href="#/explore/parts"]').waitFor({state:'visible'});
   const width=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
   if(width>3)throw Error('Mobile header horizontal overflow: '+width);
 }finally{await page.close();}
}
try{
 await session('запчаст',/Запчасти и аналоги/,'register');
 await session('консультация',/Консультация специалиста/,'login');
 await session('несуществующее-направление',null,null);
 await mobile();
 if(errors.length)throw Error('Page errors: '+errors.join(' | '));
 console.log('Approved 617 desktop search on service pages and mobile capability catalogue — PASS');
}finally{await browser.close();}
