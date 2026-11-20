// Approved 617 PC public header and approved mobile "Возможности" navigation.
// The old guest search overlay intentionally is not visible; verify live links
// rather than reintroducing a deleted legacy search bar.
import {chromium} from 'playwright';
const BASE=process.env.BASE_URL??'http://127.0.0.1:8080';
if(!['127.0.0.1','localhost'].includes(new URL(BASE).hostname))
  throw Error('Header navigation smoke is local only');
const browser=await chromium.launch();
const errors=[];
async function desktop(href,heading){
 const page=await browser.newPage({viewport:{width:1440,height:900},locale:'ru-RU'});
 page.on('pageerror',error=>errors.push(error.message));
 try{
   await page.goto(BASE+'/#/',{waitUntil:'domcontentloaded'});
   await page.locator('.owner20-home').waitFor({state:'visible'});
   const link=page.locator(href);
   await link.waitFor({state:'visible'});
   await link.click();
   await page.locator('.guest-explore-hero h1').waitFor({state:'visible'});
   if(!page.url().includes(heading))throw Error('Approved desktop tile went to wrong route '+page.url());
   await page.locator('.guest-explore-cta[href="#/register"]').waitFor({state:'visible'});
   const dims=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
   if(dims.scroll>dims.client+3)throw Error('Approved PC navigation horizontal overflow '+JSON.stringify(dims));
 } finally {await page.close();}
}
async function mobile(){
 const page=await browser.newPage({viewport:{width:390,height:844},locale:'ru-RU'});
 page.on('pageerror',error=>errors.push(error.message));
 try{
   await page.goto(BASE+'/#/',{waitUntil:'domcontentloaded'});
   await page.locator('.public-landing').waitFor({state:'visible'});
   const catalogue=page.locator('.guest-mobile-catalog summary');
   await catalogue.waitFor({state:'visible'});
   await catalogue.click();
   const nav=page.locator('.guest-mobile-catalog nav[aria-label="Возможности TrakSOS"]');
   const parts=nav.locator('a[href="#/explore/parts"]');
   await parts.waitFor({state:'visible'});
   await parts.click();
   await page.locator('.guest-explore-hero h1').waitFor({state:'visible'});
   if(!page.url().endsWith('#/explore/parts'))throw Error('Mobile catalogue parts link broken');
   const width=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
   if(width>3)throw Error('Approved mobile header horizontal overflow '+width);
 } finally {await page.close();}
}
try {
 await desktop('.owner20-feature-parts','#/explore/parts');
 await desktop('.owner20-quick a[href="#/explore/consult"]','#/explore/consult');
 await mobile();
 if(errors.length)throw Error('Page errors: '+errors.join(' | '));
 console.log('Approved 617 PC live service tiles and mobile capability navigation — PASS');
} finally {await browser.close();}
