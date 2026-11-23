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
   if(await page.locator('.app > header.top, .desktop-sidebar').count()!==0)
     throw Error(width+': legacy header/sidebar mounted on approved PC page');
   const footer=page.locator('.guest-home-standalone > .site-footer');
   if(await footer.count()!==1||!await footer.isVisible())
     throw Error(width+': existing legal/footer block missing beneath final 617 page');
   if(!await footer.getByText('Маркетплейс выездной помощи грузовому транспорту').count())
     throw Error(width+': footer heading missing');
   for(const href of ['#/company','#/offers','#/offer/privacy','#/rules']){
     if(await footer.locator('a[href="'+href+'"]').count()!==1)
       throw Error(width+': footer route missing '+href);
   }
   if(await page.locator('header.owner20-top').count()!==1)
     throw Error(width+': approved header should appear exactly once');
   const cards=await page.locator('.owner20-quick>a').count();
   const features=await page.locator('.owner20-features>a').count();
   const bottom=await page.locator('.owner20-bottom>.owner20-bottom-card').count();
   // Owner 22 Nov: balanced five shortcuts. ECU stays only in the illustrated
   // specialist row; TrakBot opens the existing assistant, not another page.
   if(cards!==5||features!==5||bottom!==4)throw Error(width+': wrong approved rows '+cards+'/'+features+'/'+bottom);
   const quickTitles=await page.locator('.owner20-quick>a b').allInnerTexts();
   const featureTitles=await page.locator('.owner20-features>a b').allInnerTexts();
   if(quickTitles.some(title=>/ЭБУ|Шиномонтаж/i.test(title))||
      quickTitles.filter(title=>title.includes('TrakBot')).length!==1 ||
      quickTitles[4] !== 'TrakBot · ИИ' ||
      featureTitles.filter(title=>title==='Специалисты ЭБУ').length!==1)
     throw Error(width+': duplicate ECU or unwanted tire service in promoted tiles');
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
     const logo=document.querySelector('.owner20-mark');
     const sceneKeys=['tech','ecu','parts','insurance','inspection'];
     const renderedScenes=await Promise.all(sceneKeys.map(async key=>{
       const card=document.querySelector('.owner20-feature-'+key);
       const picture=card?.querySelector('.traksos-feature-art');
       const image=picture?.querySelector('img');
       if(image && !image.complete) await image.decode().catch(()=>{});
       const frame=card?.getBoundingClientRect();
       const title=card?.querySelector('.owner20-feature-title')?.getBoundingClientRect();
       const body=card?.querySelector('p')?.getBoundingClientRect();
       return {key,src:image?.getAttribute('src')||'',display:image?getComputedStyle(image).display:'none',
         loaded:!!image?.naturalWidth,imageW:image?.naturalWidth||0,imageH:image?.naturalHeight||0,
         picture:!!picture,gradient:getComputedStyle(card,'::before').backgroundImage,
         frameWidth:frame?.width||0,titleRight:title?.right||0,bodyRight:body?.right||0,
         frameLeft:frame?.left||0,oldSprite:!!card?.querySelector('.owner20-feature-illustration')};
     }));
     const pick=(el,pseudo)=>el?getComputedStyle(el,pseudo).backgroundImage:'';
     const measure=async (path)=>{
       const res=await fetch(path);
       if(!res.ok) return {status:res.status,w:0,h:0};
       const image=await createImageBitmap(await res.blob()).catch(()=>null);
       return {status:res.status,w:image?.width??0,h:image?.height??0};
     };
     const [sprite,approvedHero,approvedLogo]=await Promise.all([
       measure('/owner20-artwork-sprite-retouched.webp'),
       measure('/owner20-photo-background-approved-retouched.webp'),
       measure('/traksos-brand-logo-approved-618.png'),
     ]);
     const rect=(selector)=>{const r=document.querySelector(selector)?.getBoundingClientRect();return r&&{x:r.x,y:r.y,w:r.width,h:r.height};};
     return {
       photo:pick(photo,'::after'),map:pick(map),renderedScenes,
       logo:logo?.querySelector('img')?.getAttribute('src')||'',sprite,approvedHero,approvedLogo,
       head:rect('.owner20-top'),hero:rect('.owner20-hero'),
       quick:rect('.owner20-quick'),features:rect('.owner20-features'),
       bottom:rect('.owner20-bottom'),coverage:rect('.owner20-map'),
     };
   });
   const expectedHero=width>=1281?'owner20-photo-background-approved-retouched.webp':'owner20-artwork-sprite-retouched.webp';
   if(!art.photo.includes(expectedHero) ||
      !art.map.includes('owner20-artwork-sprite-retouched.webp') ||
      !art.logo.includes('traksos-brand-logo-approved-618.png') ||
      art.photo.includes('tracksos-approved-hero-owner-20261119') ||
      art.sprite?.w!==1018 || art.sprite?.h!==446 ||
      art.approvedHero?.w!==1536 || art.approvedHero?.h!==324 ||
      art.approvedLogo?.w!==274 || art.approvedLogo?.h!==46)
     throw Error(width+': approved 617.png image or loaded size regressed '+JSON.stringify(art));
   const expectedScenes=['tech','ecu','parts','insurance','inspection'];
   if(art.renderedScenes?.length!==expectedScenes.length)throw Error(width+': feature card image count incorrect');
   for(const scene of art.renderedScenes){
     if(!expectedScenes.includes(scene.key)||!scene.picture||!scene.loaded||
        scene.imageW!==512||scene.imageH!==300||
        !scene.src.includes('/feature-art/traksos-feature-'+scene.key+'-desktop-20261122.webp')||
        scene.oldSprite||
        !scene.gradient.includes('linear-gradient')||
        scene.titleRight>scene.frameLeft+scene.frameWidth*.84 ||
        scene.bodyRight>scene.frameLeft+scene.frameWidth*.8)
       throw Error(width+': clipped/overlapping/missing canonical service art '+JSON.stringify(scene));
   }
   // Narrow PC is still the approved four-card strip. Check that the
   // extra community imagery is full-bleed and does NOT paste bitmap
   // captions over the text. The fifth "Почему" line must fit above
   // the card bottom; app release text must stay separate from the phone.
   {
     const bottomReading=await page.locator('.owner20-bottom>.owner20-bottom-card').evaluateAll(cards=>cards.map(card=>{
       const bounds=card.getBoundingClientRect();
       const title=card.querySelector('b')?.getBoundingClientRect();
       const summary=card.querySelector('p')?.getBoundingClientRect();
       const action=card.querySelector(':scope > span:not(.owner20-store)')?.getBoundingClientRect();
       const store=card.querySelector('.owner20-store')?.getBoundingClientRect();
       const lastBullet=[...card.querySelectorAll('li')].at(-1)?.getBoundingClientRect();
       const bg=getComputedStyle(card).backgroundImage;
       const after=getComputedStyle(card,'::after');
       return {className:card.className,height:bounds.height,
         headingOk:!!title&&title.bottom<=bounds.bottom-8,
         copyOk:!summary||summary.bottom <= (action?.top??store?.top??bounds.bottom)+2,
         actionOk:!action||action.bottom<=bounds.bottom-6,
         storeOk:!store||store.bottom<=bounds.bottom-5,
         bulletsOk:!lastBullet||lastBullet.bottom<=bounds.bottom-8,
         fullBleed:!card.classList.contains('owner20-bottom-air')&&!card.classList.contains('owner20-bottom-club')||
           (bg.includes('traksos-service-scenes-desktop-hq.webp')&&after.display==='none')
       };
     }));
     if(bottomReading.length!==4||bottomReading.some(x=>!x.fullBleed||
         (width<=1024&&(!x.headingOk||!x.copyOk||!x.actionOk||!x.storeOk||!x.bulletsOk))))
       throw Error(width+': bottom strip has clipped text, extra photo slice or hidden CTA: '+JSON.stringify(bottomReading));
   }
   // Both 617 and 618 now use the same real DOM phone/TrakSOS app icon.
   // No pseudo-phone may return; keep floating TrakBot outside the artwork.
   const phoneBot=await page.evaluate(async()=>{
     const card=document.querySelector('.owner20-bottom-app');
     const phone=card?.querySelector('.traksos-app-phone');
     const img=phone?.querySelector('.traksos-app-phone-icon');
     const bot=document.querySelector('.trakbot-dock-launcher');
     if(!card||!phone||!img||!bot)return {missing:true};
     if(!img.complete)await img.decode().catch(()=>{});
     const c=card.getBoundingClientRect(),p=phone.getBoundingClientRect(),
       b=bot.getBoundingClientRect();
     const textCollision=[...card.querySelectorAll(':scope > b, :scope > p, :scope > .owner20-store')].some(el=>{
       const range=document.createRange();
       range.selectNodeContents(el);
       return [...range.getClientRects()].some(r=>r.left<p.right && r.right>p.left && r.top<p.bottom && r.bottom>p.top);
     });
     // Geometric phone checks alone missed severe 1280px word splitting and
     // the RuStore badge printed over the description. Guard actual text flow.
     const heading=card.querySelector(':scope > b');
     const copy=card.querySelector(':scope > p');
     const store=card.querySelector(':scope > .owner20-store');
     const headingRange=document.createRange();
     if(heading)headingRange.selectNodeContents(heading);
     const headingLines=heading?[...new Set([...headingRange.getClientRects()]
       .filter(r=>r.width>0).map(r=>Math.round(r.top)))].length:0;
     const copyRect=copy?.getBoundingClientRect();
     const storeRect=store?.getBoundingClientRect();
     const copyStoreCollision=!!(copyRect&&storeRect&&
       copyRect.left<storeRect.right&&copyRect.right>storeRect.left&&
       copyRect.top<storeRect.bottom&&copyRect.bottom>storeRect.top);
     return {textCollision,headingLines,copyStoreCollision,
       phone:[p.x,p.y,p.width,p.height],dock:[b.x,b.y,b.width,b.height],
       assetLoaded:img.naturalWidth>30,branded:phone.textContent.includes('Trak')&&phone.textContent.includes('SOS'),
       rustore:card.querySelector('.owner20-store')?.textContent?.includes('RuStore')??false,
       pseudoHidden:['::before','::after'].every(side=>getComputedStyle(card,side).display==='none'),
       phoneCount:card.querySelectorAll('.traksos-app-phone').length,
       inside:p.left>=c.left-2&&p.right<=c.right+2&&p.top>=c.top-2&&p.bottom<=c.bottom+2,
       overlaps:p.left<b.right&&p.right>b.left&&p.top<b.bottom&&p.bottom>b.top};
   });
   if(phoneBot.missing||phoneBot.phoneCount!==1||!phoneBot.assetLoaded||!phoneBot.branded||
      !phoneBot.rustore||!phoneBot.pseudoHidden||!phoneBot.inside||phoneBot.overlaps||phoneBot.textCollision||
      (width>=1200&&(phoneBot.headingLines>2||phoneBot.copyStoreCollision)))
     throw Error(width+': app-card copy clipped, broken or overlapping branded phone/RuStore/TrakBot: '+JSON.stringify(phoneBot));
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
   // The approved 617 compact Russia graphic remains intact. The owner has
   // separately approved a real ~70% partner-network modal. Test actual
   // keyboard, close/focus, visible map and honest network source; no mock pins.
   const launchMap=page.getByRole('button',{name:'Развернуть карту партнёров'});
   await launchMap.waitFor({state:'visible'});
   await launchMap.click();
   const network=page.getByRole('dialog',{name:'Карта партнёров TrakSOS'});
   await network.waitFor({state:'visible'});
   const modalBox=await network.boundingBox();
   if(!modalBox || modalBox.width<width*.62 || modalBox.width>width*.96 ||
      modalBox.height<900*.57 || modalBox.height>900*.94)
     throw Error(width+': network modal is not around 70vw×70vh '+JSON.stringify(modalBox));
   const zoomButton=network.getByRole('button',{name:'Приблизить карту'});
   await zoomButton.click();
   const tiles=network.locator('.tr-network-tiles img');
   if(await tiles.count()<3)throw Error(width+': interactive map has no geographic base');
   await network.getByRole('button',{name:'Показать Россию'}).click();
   const actual=await page.evaluate(async()=>{
     try{const response=await fetch('/api/public/partner-map');
       if(!response.ok)return {ok:false,points:[]};
       const body=await response.json();
       return {ok:body.source==='verified_stationary_opt_in',points:body.points||[]};
     }catch{return {ok:false,points:[]};}
   });
   if(actual.ok && actual.points.length===0 && await network.locator('.tr-network-marker').count()!==0)
     throw Error(width+': visual map invented yellow partner pins absent from real backend');
   await page.screenshot({path:'e2e/shots/owner20-pc/partner-network-'+width+'.png',
     fullPage:false,animations:'disabled'});
   await page.keyboard.press('Escape');
   await network.waitFor({state:'detached'});
   if(!await launchMap.evaluate(node=>document.activeElement===node))
     throw Error(width+': network ESC did not restore keyboard focus');
   const footerMap=page.getByRole('button',{name:'Подробнее о покрытии →'});
   await footerMap.click();
   await network.waitFor({state:'visible'});
   await page.mouse.click(3,3);
   await network.waitFor({state:'detached'});

    const botShortcut=page.locator('.owner20-quick-trakbot');
    if(await botShortcut.count()!==1) throw Error('TrakBot shortcut missing');
    const mascotFits=await botShortcut.evaluate(tile=>{
      const mascot=tile.querySelector('.trakbot-mascot-original').getBoundingClientRect();
      const title=document.createRange();
      title.selectNodeContents(tile.querySelector('b'));
      return mascot.left>=tile.getBoundingClientRect().left && mascot.right<=title.getBoundingClientRect().left;
    });
    if(!mascotFits)throw Error(width+'px: fifth tile clips TrakBot or overlaps its label');
    await botShortcut.click();
    await page.getByRole('dialog',{name:'TrakBot — личный помощник'}).waitFor();
    if(!page.url().endsWith('/#/')) throw Error('TrakBot shortcut navigated off 617 landing');
    if(await page.locator('.trakbot-dock-panel').count()!==1) throw Error('Duplicate TrakBot panels');
    await page.locator('.trakbot-dock-close').click();
    if(await page.locator('.trakbot-dock-panel').count()!==0) throw Error('TrakBot shortcut did not close');
   if(width===1536){
    // All native drop-downs are mutually exclusive, including keyboard Escape.
    const menus=page.locator('.owner20-topnav details');
    await menus.nth(0).locator('summary').click();
    if(!(await menus.nth(0).evaluate(el=>el.open))) throw Error('Platform menu did not open');
    await menus.nth(1).locator('summary').click();
    if((await menus.nth(0).evaluate(el=>el.open)) ||
      !(await menus.nth(1).evaluate(el=>el.open)))
      throw Error('Top menus overlap rather than switching');
    await menus.nth(1).locator('summary').press('Escape');
    if(await menus.nth(1).evaluate(el=>el.open)) throw Error('Escape did not close services menu');
    for(const key of ['van','tow','sto','ecu','consult','tech','parts','insurance','inspection','air','club']){
     await page.goto(BASE+'/#/',{waitUntil:'domcontentloaded'});
     const link=page.locator('.owner20-home a[href="#/explore/'+key+'"]:visible').first();
     await link.waitFor();await link.click();
     await page.waitForURL('**/#/explore/'+key);
     await page.getByRole('dialog',{name:'Вход по номеру телефона'}).waitFor();
     if(!await page.locator('.owner20-home').isVisible())throw Error(key+': lost approved 617 home in service auth');
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
