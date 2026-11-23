// True Chromium proof: authenticated requester, real no_performer order, real
// owner-approved SHA-verified Russia-network WebP, real DOM actions. Runs after
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
        await page.waitForFunction(expected=>
          location.hash===expected && !!localStorage.getItem('traksos.token'),
          SANDBOX_LANDING[role],{timeout:20_000});
        await page.locator('header.top .sandbox-test-badge').waitFor({state:'visible',timeout:20_000});
        const marker='TRAKSOS_QA_NO_PERFORMER_20261123_'+role.toUpperCase();
        let claim;
        for(let navigationAttempt=0;navigationAttempt<3;navigationAttempt++){
          try{
            // The 900px owner breakpoint occasionally performs a real document
            // navigation immediately after sandbox-enter. A lost JS execution
            // context is not an API failure: re-run the same protected fetch
            // only after the new authenticated document is fully ready.
            claim=await page.evaluate(async marker=>{
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
            break;
          }catch(error){
            if(!/Execution context was destroyed|navigation/i.test(String(error)) ||
               navigationAttempt===2)throw error;
            await page.waitForLoadState('domcontentloaded');
            await page.waitForFunction(expected=>
              location.hash===expected && !!localStorage.getItem('traksos.token'),
              SANDBOX_LANDING[role],{timeout:20_000});
          }
        }
        if(claim.detail.status!=='no_performer' || claim.detail.absenceReason!=='not_connected' ||
           !claim.detail.events?.some(e=>e.type==='no_performer' && e.data?.absenceReason==='not_connected'))
          throw Error('Not a truly exhausted customer order: '+JSON.stringify(claim.detail).slice(0,500));
        const id=claim.order.id;
        await page.goto(base+'/#/order/'+id,{waitUntil:'domcontentloaded'});
        // A first-visit consent notice belongs to the real UI. Dismiss it
        // by its own button before measuring actionable order controls.
        const consent=page.getByRole('button',{name:'Понятно',exact:true});
        if(await consent.count() && await consent.first().isVisible())await consent.first().click();
        const card=page.locator('section.traksos-no-performer');
        await card.waitFor({state:'visible',timeout:20_000});
        await card.getByRole('heading',{name:'По этому направлению пока нет партнёров'}).waitFor();
        await card.getByText('Мы расширяем сеть TrakSOS',{exact:false}).waitFor();
        // No performer means no visit and no work was booked. A preliminary
        // "Цена / Выезд / Час работы" card below the approved illustration
        // falsely looked like an invoice despite the terminal no-performer state.
        if(await page.getByText('Цена',{exact:true}).count())
          throw Error('False service price shown on an unfulfilled order: '+role+' '+width);
        if(await page.getByRole('link',{name:/^Оплатить /}).count())
          throw Error('Pending checkout must not be offered for no-performer: '+role+' '+width);
        // Existing financial operations must remain visible; do not hide
        // held/refunded data to make the false price disappear.
        await page.getByText('Оплата',{exact:true}).first().waitFor({timeout:12_000});
        const art=await card.locator('img').evaluate(async image=>{
          await image.decode();
          const style=getComputedStyle(image);
          return {width:image.naturalWidth,height:image.naturalHeight,
            src:image.getAttribute('src'),complete:image.complete,
            fit:style.objectFit,position:style.objectPosition};
        });
        if(!art.complete || art.width!==2172 || art.height!==724 ||
           !art.src?.includes('traksos-no-performer-network-russia-approved-v1.webp') ||
           art.fit!=='cover' || !['100% 50%','right center','right 50%'].includes(art.position))
          throw Error('Owner-approved Russia network image absent, cropped wrongly or stale: '+
            JSON.stringify(art));
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
        // Real computed CSS is the final truth; checking the source alone
        // would miss mobile 618's high-specificity legacy pink button rules.
        const retryColors=await card.getByRole('button',{name:'Искать ещё раз'})
          .evaluate(button=>{
            const style=getComputedStyle(button);
            return {backgroundColor:style.backgroundColor,
              backgroundImage:style.backgroundImage,color:style.color};
          });
        // Both approved PC orange (#ed6724 → #fb8835) and mobile orange
        // (#fa6817 → #ff9626) are valid, not a single exact RGB gradient.
        // Reject pink/blue without changing the owner-approved desktop UI.
        const gradientStops=[...retryColors.backgroundImage.matchAll(
          /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g
        )].map(match=>match.slice(1,4).map(Number));
        const allApprovedOrange=gradientStops.length>=2 &&
          gradientStops.every(([red,green,blue])=>
            red>=215 && green>=65 && green<=175 && blue<=100 &&
            red-green>=70 && green-blue>=20);
        if(!/linear-gradient/i.test(retryColors.backgroundImage) ||
           !allApprovedOrange ||
           retryColors.color!=='rgb(255, 255, 255)')
          throw Error('Owner-approved retry CTA is not orange on '+role+' '+width+
            ': '+JSON.stringify({retryColors,gradientStops}));
        const expected=['Искать ещё раз','Другая помощь','Поддержка'];
        if(details.actions.length!==3 || details.actions.some((a,i)=>a.text!==expected[i]||a.height<44))
          throw Error('Unavailable/inaccessible actions '+JSON.stringify(details.actions));
        // No "button that looks clickable but a fixed overlay intercepts":
        // test each physical centre point after bringing the control into view.
        for(const action of await card.locator('button,a').all()){
          await action.scrollIntoViewIfNeeded();
          const hit=await action.evaluate(node=>{
            const box=node.getBoundingClientRect();
            const element=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);
            return element===node || node.contains(element);
          });
          if(!hit)throw Error('Action covered by another element: '+await action.innerText()+' @'+width);
        }
        // The hit-test above scrolled actions into view. A full-page capture
        // taken at that position would falsely paint the fixed 618 bottom
        // navigation and sticky 617 header in the *middle* of the long PNG.
        // Reset only for evidence; never hide, detach or mock real UI chrome.
        await page.evaluate(()=>window.scrollTo({top:0,left:0,behavior:'instant'}));
        await page.waitForFunction(()=>window.scrollY===0,{timeout:5_000});
        await page.screenshot({path:out+'/no-performer-'+role+'-'+width+'.png',
          fullPage:true,animations:'disabled'});
        // Separate honest viewport frame at the relevant real card: sticky
        // header and bottom bar remain in their actual on-screen positions.
        await card.scrollIntoViewIfNeeded();
        await page.screenshot({path:out+'/no-performer-'+role+'-'+width+'-viewport.png',
          fullPage:false,animations:'disabled'});
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
        if(width===390 || width===1440){
          // A second REAL terminal order for this user includes a durable
          // offer+withdraw history. Never show the zero-bids copy here.
          const withdrawn=await page.evaluate(async marker=>{
            const token=localStorage.getItem('traksos.token');
            const auth={authorization:'Bearer '+token};
            const list=await fetch('/api/orders',{headers:auth}).then(r=>r.json());
            const item=list.find(o=>o.description===marker);
            if(!item)throw Error('No real withdrawn-offer fixture: '+marker);
            const response=await fetch('/api/orders/'+item.id,{headers:auth});
            if(!response.ok)throw Error('Withdrawn order not visible to requester');
            return {id:item.id,detail:await response.json()};
          },'TRAKSOS_QA_WITHDRAWN_20261123_'+role.toUpperCase());
          if(withdrawn.detail.status!=='no_performer' ||
             withdrawn.detail.absenceReason!=='offers_withdrawn' ||
             !withdrawn.detail.events?.some(e=>e.type==='offer'))
            throw Error('Historical real offer disappeared from API: '+role+
              ' '+JSON.stringify(withdrawn.detail).slice(0,400));
          await page.goto(base+'/#/order/'+withdrawn.id,{waitUntil:'domcontentloaded'});
          const offered=page.locator('section.traksos-no-performer');
          await offered.getByRole('heading',{name:'Сейчас нет действующих предложений'}).waitFor({timeout:20_000});
          await offered.getByText('Специалист откликнулся, но его предложение больше не действует',
            {exact:false}).waitFor();
          if(await page.getByText('Цена',{exact:true}).count() ||
             await page.getByRole('link',{name:/^Оплатить /}).count())
            throw Error('False payable estimate shown after a withdrawn offer');
          await page.getByText('Оплата',{exact:true}).first().waitFor({timeout:12_000});
          if(await offered.getByText('Пока никто не откликнулся').count())
            throw Error('Misleading no-response copy shown after a withdrawn bid');
          const image=offered.locator('img');
          await image.evaluate(img=>img.decode());
          const actions=await offered.locator('button,a').evaluateAll(nodes=>
            nodes.map(n=>({label:n.textContent?.trim(),height:n.getBoundingClientRect().height})));
          if(actions.length!==3 || actions.some(n=>n.height<44))
            throw Error('Withdrawal actions are missing or too small '+JSON.stringify(actions));
          const overflow=await page.evaluate(()=>
            document.documentElement.scrollWidth-document.documentElement.clientWidth);
          if(overflow>3)throw Error('Withdrawn-offer card overflow at '+width+': '+overflow);
          await page.evaluate(()=>window.scrollTo({top:0,left:0,behavior:'instant'}));
          await page.waitForFunction(()=>window.scrollY===0,{timeout:5_000});
          await page.screenshot({path:out+'/offers-withdrawn-'+role+'-'+width+'.png',
            fullPage:true,animations:'disabled'});
          await offered.scrollIntoViewIfNeeded();
          await page.screenshot({path:out+'/offers-withdrawn-'+role+'-'+width+'-viewport.png',
            fullPage:false,animations:'disabled'});
          console.log('WITHDRAWN OFFER CHROMIUM PASS',role,width,withdrawn.id);
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
