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
   const expected=(selector.includes('public-landing')
     ? ['tracksos-photo-tow','tracksos-photo-master','tracksos-photo-sto','traksos-final-insurance','traksos-final-parts','tracksos-photo-consult']
     : ['tracksos-photo-master','tracksos-photo-tow','tracksos-photo-sto','tracksos-photo-consult'])[i];
   if(!icon||icon==='none')issues.push('missing illustration '+i);
   if(expected&&!icon.includes(expected))
     issues.push('reference photo mismatch '+i+': expected '+expected+', found '+icon);
 }
 const doc=document.documentElement;
 if(doc.scrollWidth>doc.clientWidth+3)
   issues.push('horizontal scroll '+doc.scrollWidth+'/'+doc.clientWidth);
 return{count:cards.length,issues};
},{selector,width});
try{
 const login=await fetch(BASE+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({phone:'+79990000141',password:'Test-Role-Only-2026!'})});
 assert(login.ok,'Visual audit account missing: '+login.status);
 const {token}=await login.json();
 for(const width of [320,390,768,1440]){
   const guest=await browser.newContext({viewport:{width,height:900},locale:'ru-RU'});
   const publicPage=await guest.newPage();
   await publicPage.goto(BASE+'/#/',{waitUntil:'domcontentloaded'});
   await publicPage.locator('.public-service-tile').first().waitFor();
   const pub=await cssAudit(publicPage,'.public-landing .public-service-tile',width);
   assert(pub.count===6&&pub.issues.length===0,width+'px public layout: '+JSON.stringify(pub));
   await publicPage.screenshot({path:out+'/public-'+width+'.png',fullPage:true});
   await guest.close();
   const ctx=await browser.newContext({viewport:{width,height:900},locale:'ru-RU'});
   const page=await ctx.newPage();
   await page.addInitScript(t=>{localStorage.setItem('traksos.token',t);localStorage.setItem('traksos.mode','client');},token);
   await page.goto(BASE+'/#/',{waitUntil:'domcontentloaded'});
   await page.locator('.client-dashboard .desktop-quick-card').first().waitFor();
   const client=await cssAudit(page,'.client-dashboard .desktop-quick-card',width);
   assert(client.count===4&&client.issues.length===0,width+'px client layout: '+JSON.stringify(client));
   await page.screenshot({path:out+'/client-'+width+'.png',fullPage:true});
   await ctx.close();
   console.log('OK illustrated labels and no horizontal spill at '+width+'px');
 }
}finally{await browser.close();}
