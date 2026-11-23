// True Chromium proof: authenticated requester, real no_performer order, real
// approved #3 WebP, real DOM actions. Runs only after exerciseSandboxNoPerformer
// created and exhausted owner/driver orders through sandbox API + fake checkout.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { issueSandboxTicket, SANDBOX_LANDING } from '../server/src/services/sandboxTickets.ts';

const base=process.env.SANDBOX_BROWSER_BASE_URL??'';
const secret=process.env.SANDBOX_SHARED_SECRET??'';
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(base) || secret.length<32 ||
   process.env.TRAKSOS_RUN_DISPOSABLE_SCENARIO!=='true')
  throw Error('Real no-performer art browser test requires isolated loopback sandbox');
const out='e2e/shots/sandbox-real-browser';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const failures=[];
const widths=[320,360,390,412,768,900,1440,1672];
try{
  for(const role of ['owner','driver']){
    for(const width of widths){
      const context=await browser.newContext({viewport:{width,height:width<=412?844:width<=900?950:980},locale:'ru-RU'});
      const page=await context.newPage();
      try{
        const ticket=issueSandboxTicket(role,secret);
        await page.goto(base+'/#/sandbox-enter?ticket='+encodeURIComponent(ticket),{waitUntil:'domcontentloaded'});
        await page.waitForFunction(expected=>location.hash===expected,SANDBOX_LANDING[role],{timeout:20_000});
        const marker='TRAKSOS_QA_NO_PERFORMER_20261123_'+role.toUpperCase();
        const claim=await page.evaluate(async marker=>{
          const token=localStorage.getItem('traksos.token');
          if(!token)throw Error('Missing real sandbox login token');
          const auth={authorization:'Bearer '+token};
          const ordersResponse=await fetch('/api/orders',{headers:auth});
          if(!ordersResponse.ok)throw Error('Cannot list real customer orders');
          const list=await ordersResponse.json();
          const order=list.find(o=>o.description===marker);
          if(!order)throw Error('Real no-performer fixture missing: '+marker);
          const detailResponse=await fetch('/api/orders/'+order.id,{headers:auth});
          if(!detailResponse.ok)throw Error('Cannot load real protected order');
          return {order,detail:await detailResponse.json()};
        },marker);
        if(claim.detail.status!=='no_performer' || claim.detail.absenceReason!=='not_connected' ||
           !claim.detail.events?.some(e=>e.type==='no_performer' && e.data?.absenceReason==='not_connected'))
          throw Error('Not a truly exhausted customer order: '+JSON.stringify(claim.detail).slice(0,500));
        const id=claim.order.id;
        await page.goto(base+'/#/order/'+id,{waitUntil:'domcontentloaded'});
        const card=page.locator('section.traksos-no-performer');
        await card.waitFor({state:'visible',timeout:20_000});
        await card.getByRole('heading',{name:'По этому направлению пока нет партнёров'}).waitFor();
        await card.getByText('Мы расширяем сеть TrakSOS',{exact:false}).waitFor();
        const art=await card.locator('img').evaluate(async image=>{
          await image.decode();
          return {width:image.naturalWidth,height:image.naturalHeight,
            src:image.getAttribute('src'),complete:image.complete};
        });
        if(!art.complete || art.width!==480 || art.height!==384 ||
           !art.src?.includes('traksos-no-performer-search-approved-20261123.webp'))
          throw Error('Approved visual #3 failed real load/decode '+JSON.stringify(art));
        const details=await card.evaluate(el=>{
          const rect=(x)=>{const r=x.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
          const illustration=el.querySelector('.traksos-no-performer-art');
          const text=el.querySelector('.traksos-no-performer-copy');
          const title=el.querySelector('h2');
          const actions=[...el.querySelectorAll('button,a')].map(node=>({
            text:node.textContent.trim(),tag:node.tagName,href:node.getAttribute('href'),...rect(node)}));
          return {art:rect(illustration),text:rect(text),title:rect(title),actions,
            overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth};
        });
        if(details.overflow>3)throw Error('Horizontal overflow at '+role+' '+width+': '+details.overflow);
        if(width<=700 && details.art.bottom>details.title.top+2)
          throw Error('Mobile artwork is not above DOM copy '+JSON.stringify(details));
        if(width>700 && details.art.right<=details.text.right)
          throw Error('Desktop artwork is not to the right of text');
        const expected=['Искать ещё раз','Другая помощь','Поддержка'];
        if(details.actions.length!==3 || details.actions.some((a,i)=>a.text!==expected[i]||a.height<44))
          throw Error('Unavailable/inaccessible actions '+JSON.stringify(details.actions));
        // Full rendered page evidence, not prop screenshots and not invented data.
        await page.screenshot({path:out+'/no-performer-'+role+'-'+width+'.png',
          fullPage:true,animations:'disabled'});
        if(width===390){
          const another=card.getByRole('link',{name:'Другая помощь'});
          if(await another.getAttribute('href')!=='#/sos')
            throw Error('Alternative help has a broken destination');
          await another.click();
          await page.waitForURL(/#\/sos$/,{timeout:10_000});
          await page.goto(base+'/#/order/'+id);
          const support=page.locator('section.traksos-no-performer').getByRole('link',{name:'Поддержка'});
          if(await support.getAttribute('href')!==`#/support/new?order=${id}`)
            throw Error('Support link lost matching order ID');
          await support.click();
          await page.waitForURL(new RegExp('#/support/new\\?order='+id+'$'),{timeout:10_000});
          await page.goto(base+'/#/order/'+id);
          const retry=page.locator('section.traksos-no-performer').getByRole('button',{name:'Искать ещё раз'});
          const response=page.waitForResponse(r=>r.url().includes('/api/orders/'+id+'/retry') &&
            r.request().method()==='POST',{timeout:15_000});
          await retry.click();
          const result=await response;
          if(!result.ok())throw Error('Retry action failed: HTTP '+result.status());
          const replay=await result.json();
          if(replay.status!=='no_performer' || replay.absenceReason!=='not_connected')
            throw Error('Real retry did not restart and complete empty search: '+JSON.stringify(replay).slice(0,400));
          await page.locator('section.traksos-no-performer').waitFor({state:'visible'});
        }
        console.log('NO PERFORMER CHROMIUM PASS',role,width,id,art.width+'x'+art.height);
      }catch(error){
        const detail=String(error?.stack||error);
        failures.push({role,width,detail});
        console.error('NO PERFORMER CHROMIUM FAIL',role,width,detail);
        try{await page.screenshot({path:out+'/no-performer-'+role+'-'+width+'-ERROR.png',fullPage:true});}
        catch{/* evidence best-effort, preserve original reason */}
      }finally{await context.close();}
    }
  }
}finally{await browser.close();}
if(failures.length)throw Error('Real no-performer card proof failed in '+failures.length+
  ' cases: '+JSON.stringify(failures.map(x=>({...x,detail:x.detail.slice(0,500)}))));
