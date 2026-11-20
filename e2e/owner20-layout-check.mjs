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
