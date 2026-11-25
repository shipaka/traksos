// Actual Chromium geometry gate for the approved TrakSOS visual design.
// Guards against labels spilling out of illustrated tiles and fake/cropped
// app visuals across phone and desktop sizes. Uses local CI fixture only.
import { chromium } from 'playwright';
import {mkdir} from 'node:fs/promises';

const BASE=process.env.BASE_URL??'http://127.0.0.1:8080';
if(!['localhost','127.0.0.1'].includes(new URL(BASE).hostname))
  throw Error('Visual audit is local-only');
const out='e2e/shots/visual-geometry';
await mkdir(out,{recursive:true});
const browser=await chromium.launch();
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
const cssAudit=async(page,selector,width)=>page.evaluate(({selector,width})=>{
 const cards=[...document.querySelectorAll(selector)];
 const issues=[];
 const bounds=el=>{const r=el.getBoundingClientRect();return{top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}};
 for(let i=0;i<cards.length;i++){
   const card=cards[i],c=bounds(card);
   const texts=[...card.querySelectorAll('b,small')];
   if(c.width<115||c.height<100)issues.push('tiny card '+i+': '+JSON.stringify(c));
   for(const el of texts){
     const t=bounds(el);
     if(t.bottom>c.bottom+3||t.top<c.top-2||t.left<c.left-2||t.right>c.right+3)
       issues.push('overflow '+i+' '+el.tagName+': '+JSON.stringify({c,t,text:el.textContent}));
     if(width<900&&el.tagName==='B'&&parseFloat(getComputedStyle(el).fontSize)<11)
       issues.push('unreadable title '+i+': '+getComputedStyle(el).fontSize);
   }
   const layer=getComputedStyle(card,'::after').backgroundImage;
   const icon=layer&&layer!=='none'?layer:getComputedStyle(card).backgroundImage;
   // The latest six 19 Nov service cards use real SVG pictograms on new
   // gradients, not any of the physically deleted 14–16 Nov photo tiles.
   if(!icon||icon==='none')issues.push('missing current card surface '+i);
   if(/tracksos-photo-|traksos-final-|tracksos-partner-.*approved/.test(icon))
     issues.push('retired pre-17 Nov artwork returned in card '+i+': '+icon);
   if(selector.includes('public-landing') && card.querySelectorAll('.public-service-icon svg').length!==1)
     issues.push('missing approved service pictogram '+i);
   if(!selector.includes('public-landing') && !icon.includes('gradient'))
     issues.push('signed-in card lost its current gradient '+i);
 }
 const doc=document.documentElement;
 if(doc.scrollWidth>doc.clientWidth+3)
   issues.push('horizontal scroll '+doc.scrollWidth+'/'+doc.clientWidth);
 return{count:cards.length,issues};
},{selector,width});
async function checkDesktopGeometry(page,targets){
 await targets.first().waitFor({state:'visible'});
 const issues=await targets.evaluateAll(elements=>elements.flatMap(el=>{
   const b=el.getBoundingClientRect();
   return [el,...el.querySelectorAll('b,small,h1,p')].filter(child=>{
     const r=child.getBoundingClientRect();
     return r.width<=0 || r.height<=0 || r.left<b.left-2 || r.right>b.right+2 ||
       r.top<b.top-2 || r.bottom>b.bottom+2 || r.right>document.documentElement.clientWidth+2;
   }).map(child=>child.textContent);
 }));
 assert(!issues.length,'Desktop text geometry: '+JSON.stringify(issues));
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+3),'Desktop horizontal overflow');
}
try{
 const login=await fetch(BASE+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({phone:'+79990000141',password:'Test-Role-Only-2026!'})});
 assert(login.ok,'Visual audit account missing: '+login.status);
 const {token}=await login.json();
 for(const width of [320,390,768,1440]){
   const guest=await browser.newContext({viewport:{width,height:900},locale:'ru-RU'});
   const publicPage=await guest.newPage();
   await publicPage.goto(BASE+'/#/',{waitUntil:'domcontentloaded'});
   if(width<900){
     await publicPage.locator('.public-service-tile').first().waitFor();
     const pub=await cssAudit(publicPage,'.public-landing .public-service-tile',width);
     assert(pub.count===6&&pub.issues.length===0,width+'px public layout: '+JSON.stringify(pub));
   }else{
     const quick=publicPage.locator('.owner20-home .owner20-quick>a');
     await quick.first().waitFor();
     assert(await quick.count()===5,'Expected five approved desktop shortcuts');
     await checkDesktopGeometry(publicPage,quick);
   }
   await publicPage.screenshot({path:out+'/public-'+width+'.png',fullPage:true});
   await guest.close();
   const ctx=await browser.newContext({viewport:{width,height:900},locale:'ru-RU'});
   const page=await ctx.newPage();
   await page.addInitScript(t=>{localStorage.setItem('traksos.token',t);localStorage.setItem('traksos.mode','client');},token);
   await page.goto(BASE+'/#/',{waitUntil:'domcontentloaded'});
   if(width<900){
     await page.locator('.and19-client .and19-services>a').first().waitFor();
     const client=await page.evaluate(()=>{
       const items=[...document.querySelectorAll('.and19-client .and19-services>a')];
       const vw=document.documentElement.clientWidth;
       return {count:items.length,
         overflow:document.documentElement.scrollWidth>vw+3,
         tiny:items.map((e,i)=>({i,w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height}))
           .filter(x=>x.w<60||x.h<72)};
     });
     assert(client.count===4&&!client.overflow&&!client.tiny.length,
       width+'px approved Android 4 service hit-targets: '+JSON.stringify(client));
   }else{
     const desk=page.locator('main.approved-pc-client');
     await desk.waitFor();
     await checkDesktopGeometry(page,desk.locator('.approved-pc-heading'));
     assert(await page.locator('.desktop-quick-card').count()===0,'Retired desktop service cards mounted');
   }
   await page.screenshot({path:out+'/client-'+width+'.png',fullPage:true});
   await ctx.close();
   console.log('OK illustrated labels and no horizontal spill at '+width+'px');
 }
}finally{await browser.close();}
