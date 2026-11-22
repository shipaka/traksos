// Public TrakSOS routes and safety: design-independent tests of working links and protections.
 // Do not make these checks enforce a superseded 19 November visual reference.
import { chromium } from 'playwright';
const BASE=process.env.BASE_URL??'http://127.0.0.1:8080';
if (!['127.0.0.1','localhost'].includes(new URL(BASE).hostname)) throw Error('Local CI only');
const browser=await chromium.launch();
try {
  for (const [width,height] of [[390,844],[1440,900]]) {
    const context=await browser.newContext({viewport:{width,height},locale:'ru-RU'});
    const page=await context.newPage();
    const jsErrors=[];
    page.on('pageerror',e=>jsErrors.push(e.message));
    await page.goto(BASE+'/#/');
    if(width>=900){
      await page.locator('.owner20-home').waitFor();
      const links=page.locator('.owner20-quick>a');
      if(await links.count()!==5)throw Error('Nov20 PC primary services row changed');
      for(const key of ['van','tow','sto','ecu','consult']){
        const link=links.locator('a[href="#/explore/'+key+'"]');
        // The owning <a> is itself in the list; scope route query to the full page.
        const entry=page.locator('.owner20-quick>a[href="#/explore/'+key+'"]');
        if(await entry.count()!==1)throw Error('Missing PC service route '+key);
        await entry.click();
        await page.waitForURL('**/#/explore/'+key);
        await page.locator('.guest-explore-hero h1').waitFor();
        // Every service has its own scene, never the homepage road truck.
        // Preserve photo layering and contrast with readable HTML captions.
        const artwork=await page.locator('.guest-explore-hero').evaluate(el=>{
          const image=getComputedStyle(el,'::before');
          const text=getComputedStyle(el.querySelector('h1'));
          return {isolation:getComputedStyle(el).isolation,image:image.backgroundImage,
            imageLayer:image.zIndex,textLayer:text.zIndex};
        });
        const expectedScene=['van','tow','sto','consult'].includes(key)
          ? 'traksos-service-scenes-desktop-hq.webp' : 'linear-gradient';
        if(artwork.isolation!=='isolate'||artwork.imageLayer!=='0'||
           artwork.textLayer!=='1'||!artwork.image.includes(expectedScene)||
           artwork.image.includes('owner20-photo-background-approved.webp'))
          throw Error(key+': incorrect service illustration, layering or old homepage truck: '+JSON.stringify(artwork));
        await page.goto(BASE+'/#/');
      }
      await page.locator('.owner20-region>summary').click();
      if(!await page.locator('.owner20-region-menu').isVisible())throw Error('PC region disclosure failed');
      if(jsErrors.length)throw Error('PC JS errors '+jsErrors.join('; '));
      await context.close();continue;
    }
    await page.getByRole('heading',{name:/TrakSOS.*помощь.*в пути/i}).waitFor();

    // Only public guest actions are visible in the bottom menu, not protected workflows.
    const bottom=page.getByRole('navigation',{name:'Гостевая навигация TrakSOS'});
    if(width<900){
      for(const missing of ['Заявки','Помощь','Запчасти','SOS'])
        if(await bottom.getByText(missing,{exact:true}).count())throw Error('Protected guest tab '+missing);
      if(await bottom.locator('a').count()!==4)throw Error('Guest tabbar count incorrect');
    }
    // Every currently rendered service tile must open a real,
    // readable preview, not silently return to the initial guest homepage.
    for(const id of ['sos','air','sto','ecu','parts','insurance']) {
      await page.goto(BASE+'/#/');
      const card=page.locator('.public-service-tile.public-service-'+id);
      await card.waitFor({state:'visible'});
      await card.click();
      await page.waitForURL('**/#/explore/'+id);
      await page.locator('.guest-explore-hero h1').waitFor({state:'visible'});
      const next=page.locator('.guest-explore-cta');
      await next.waitFor({state:'visible'});
      if(await next.getAttribute('href')!=='#/register')
        throw Error(id+': protected action did not route to registration');
    }
    // Supplemental public services must stay navigable.
    // The platform guide is in the hero action, not a retired seventh tile.
    for(const [selector,destination,heading] of [
      ['.public-track-parts','parts','Запчасти'],
      ['.public-track-inspection','inspection','Техосмотр грузового транспорта'],
      ['.public-button-outline','guide','Как работает TrakSOS'],
    ]) {
      await page.goto(BASE+'/#/');
      const card=destination==='guide'
        ? page.locator('.public-actions').getByRole('link',{name:'Как это работает'})
        : page.locator(selector).first();
      await card.click();
      await page.waitForURL('**/#/explore/'+destination);
      await page.getByRole('heading',{name:heading,exact:destination!=='parts'}).waitFor();
      if(!await page.locator('.guest-explore-section').count())
        throw Error(destination+': no informational content behind approved route');
    }
    await page.goto(BASE+'/#/');
    await page.locator('.public-track-insurance').click();
    await page.waitForURL('**/#/register');
    await page.getByRole('heading',{name:'Регистрация в TrakSOS'}).waitFor();
    if(await page.evaluate(()=>sessionStorage.getItem('traksos.pendingLandingAction'))!=='insurance')
      throw Error('Insurance request intent lost while opening registration');

    // Hero navigation changes live service content; this test must not enforce an older image file.
    await page.goto(BASE+'/#/');
    const bgImage=()=>page.locator('.public-hero-visual').evaluate(el=>getComputedStyle(el).backgroundImage);
    const firstPhoto=await bgImage();
    if(!firstPhoto || firstPhoto==='none')throw Error('Public hero photo failed to load: '+firstPhoto);
    if(firstPhoto.includes('traksos-final-hero'))throw Error('First slide has baked-in fake carousel controls');
    const photoGeometry=await page.evaluate(()=>{
      const hero=document.querySelector('.public-brand-hero')?.getBoundingClientRect();
      const visual=document.querySelector('.public-hero-visual')?.getBoundingClientRect();
      return hero&&visual?{heroWidth:hero.width,heroHeight:hero.height,photoWidth:visual.width,photoHeight:visual.height}:null;
    });
    // Desktop keeps the approved full-bleed photographic banner.
    // Mobile Chrome deliberately shows a separate uncropped photo above
    // the heading and CTAs; it must not be rejected by the old desktop gate.
    if(width>=900){
      if(!photoGeometry||Math.abs(photoGeometry.heroWidth-photoGeometry.photoWidth)>3||
         Math.abs(photoGeometry.heroHeight-photoGeometry.photoHeight)>3)
        throw Error('Desktop hero image is not full bleed: '+JSON.stringify(photoGeometry));
    }else{
      const mobilePhoto=await page.locator('.public-hero-visual').evaluate(el=>({
        fit:getComputedStyle(el).backgroundSize,
        browserOnly:document.documentElement.classList.contains('traksos-browser')
      }));
      if(!photoGeometry||!mobilePhoto.browserOnly||mobilePhoto.fit!=='contain'||
         photoGeometry.photoWidth>photoGeometry.heroWidth+2||
         photoGeometry.photoHeight<135||
         photoGeometry.photoHeight>=photoGeometry.heroHeight)
        throw Error('Mobile browser hero must show a separate uncropped photograph: '+
          JSON.stringify({photoGeometry,mobilePhoto}));
    }
    if(await page.locator('.public-hero-dots button').count()!==3)throw Error('Hero must show three selectable service states');
    await page.getByRole('button',{name:'Следующее фото'}).click();
    const secondPhoto=await bgImage();
    await page.getByRole('heading',{name:/Эвакуация грузовиков/}).waitFor();
    await page.getByRole('button',{name:'Узнать об эвакуации'}).waitFor();
    if(!secondPhoto || secondPhoto==='none')
      throw Error('Second hero service state lost the photograph');
    if(await page.locator('.public-hero-dot[aria-pressed="true"]').count()!==1)
      throw Error('Hero active dot state not updated');
    await page.getByRole('button',{name:'Следующее фото'}).click();
    const thirdPhoto=await bgImage();
    await page.getByRole('heading',{name:/Ремонт и запись в СТО/}).waitFor();
    await page.getByRole('button',{name:'Узнать о СТО'}).waitFor();
    if(!thirdPhoto || thirdPhoto==='none')
      throw Error('Third hero service state lost the photograph');
    await page.getByRole('button',{name:'Предыдущее фото'}).click();
    if(await page.getByRole('heading',{name:/Эвакуация грузовиков/}).count()!==1)throw Error('Hero previous arrow did not restore previous service copy');
    await page.getByRole('button',{name:/Показать фото 1:/}).click();
    if(await bgImage()!==firstPhoto)throw Error('Hero dot did not select original photograph');

    // The benefit section may change with the newly approved visual composition.
    const approvedBenefits=page.locator('.public-why-strip .public-benefit');
    const benefitCount=await approvedBenefits.count();
    if(benefitCount>0 && await approvedBenefits.locator('svg').count()<benefitCount)
      throw Error('Public benefit cards have broken vector icons');
    if(width<900) {
      // Retired decorative art should not cover a service's label.
      if(await page.locator('.public-track-extra-art, .public-track-insurance-art').count())
        throw Error('Retired decorative art still occupies the new 19 Nov service cards');
      for(const tile of ['parts','inspection','techbase']) {
        const selector=tile==='techbase'?'.public-track-techbase':'.public-track-'+tile;
        const geometry=await page.locator(selector).evaluate(el=>{
          const card=el.getBoundingClientRect();
          const label=el.querySelector('b')?.getBoundingClientRect();
          return label ? {inside:label.left>=card.left-2 && label.right<=card.right+2,
            visible:label.height>=12,text:el.querySelector('b')?.textContent} : null;
        });
        if(!geometry?.inside || !geometry.visible)
          throw Error('Current 19 Nov service text is clipped in '+tile+': '+JSON.stringify(geometry));
      }
    }

    const map=page.locator('.public-map-static-link');
    if(!(await map.getAttribute('href')).includes('yandex.ru/maps/'))throw Error('Static map is not linked to Yandex Maps');
    if(!(await map.getAttribute('target'))?.includes('_blank'))throw Error('Map must open an external tab');
    await page.getByText('Пример расположения услуг.',{exact:false}).waitFor();
    const mapGeo=await page.evaluate(()=>{
      const how=document.querySelector('.public-how')?.getBoundingClientRect();
      const map=document.querySelector('.public-demo-map')?.getBoundingClientRect();
      const image=document.querySelector('.public-map-wrap')?.getBoundingClientRect();
      return how&&map&&image?{howX:how.x,mapX:map.x,howY:how.y,mapY:map.y,mapWidth:map.width,mapImageRatio:image.width/image.height}:null;
    });
    // This is a routing/security smoke check; the approved late-November
    // desktop map can span the full page rather than sit to the right.
    if(!mapGeo || !Number.isFinite(mapGeo.mapImageRatio) ||
       mapGeo.mapWidth<250 || mapGeo.mapImageRatio<=0)
      throw Error('Public map failed to render: '+JSON.stringify(mapGeo));
    if(width<900 && mapGeo.mapY<=mapGeo.howY)
      throw Error('Mobile map must stack after process');

    // The retired PIN-based public demo must not offer fake role copies.
    // All real test cabinets now require authenticated admin access and
    // a one-time ticket to the isolated full-fidelity instance.
    for(const path of ['#/preview','#/admin/test-center']){
      await page.goto(BASE+'/'+path);
      await page.getByRole('heading',{name:'Старый демонстрационный просмотр закрыт'}).waitFor();
      if(await page.locator('.sandbox-role-card,.sandbox-cabinet,#operator-demo-code').count())
        throw Error('Obsolete guest demo UI leaked into '+path);
      if(!await page.locator('.tr-approved-route-unavailable a[href="#/login"]').isVisible())
        throw Error('Retired preview has no real sign-in destination '+path);
    }

    await page.goto(BASE+'/#/company');
    await page.getByRole('heading',{name:'Компания TrakSOS'}).waitFor();
    await page.goto(BASE+'/#/offers');
    await page.getByRole('heading',{name:'Оферты и документы'}).waitFor();
    for(const path of ['#/offer/client','#/offer/performer','#/offer/privacy']){
      if(!(await page.locator('a[href="'+path+'"]').count()))throw Error('Missing legal document '+path);
    }

    await page.goto(BASE+'/#/');
    const buttons=page.locator('.public-actions .public-button');
    if(await buttons.count()!==2)throw Error('Approved hero must have registration and guide actions');
    if(!await page.locator('.public-actions').getByRole('button',{name:'Зарегистрироваться',exact:true}).count())throw Error('Hero registration missing');
    if(!await page.locator('.public-actions').getByRole('link',{name:'Как это работает'}).count())throw Error('Hero guide missing');
    await buttons.first().click();
    await page.waitForURL(/#\/register$/);
    await page.getByRole('heading',{name:'Регистрация в TrakSOS'}).waitFor();
    if(await page.getByText('Помогите — нужна помощь').count())throw Error('Legacy help on entry');

    await page.goto(BASE+'/#/register');
    await page.getByRole('button',{name:'Владелец / автопарк'}).waitFor();
    await page.getByRole('button',{name:'Водитель автопарка'}).waitFor();
    if(await page.getByRole('button',{name:'Мастер',exact:true}).count())throw Error('Partner listed in client registration');

    const registrationKind=page.getByRole('navigation',{name:'Тип регистрации'});
    await registrationKind.getByRole('link',{name:'Клиент',exact:true}).waitFor();
    await registrationKind.getByRole('link',{name:'Зарегистрироваться как партнёр'}).click();
    await page.waitForURL('**/#/join');
    await page.getByRole('heading',{name:'Работать с TrakSOS'}).waitFor();
    if(await page.getByRole('navigation',{name:'Тип регистрации'}).count())
      throw Error('Partner registration must not repeat the client selector');
    for(const forbidden of ['Все услуги','Регистрация клиента','Для бизнеса']){
      if(await page.locator('.desktop-sidebar').getByText(forbidden,{exact:true}).count())
        throw Error('Redundant auth sidebar entry: '+forbidden);
    }
    for(const label of ['Мастер','Эвакуаторщик','СТО','Страховой агент'])
      await page.getByRole('button',{name:new RegExp('^'+label)}).waitFor();
    if(await page.locator('.auth-desktop-form .opt').count()!==4)throw Error('Partner categories must be exactly four');
    // No role is forced on initial opening; the fixed right-side image is Scania.
    const showcaseImage=width>=900?'.auth-desktop-showcase-photo':'.guest-partner-mobile-preview';
    const visual=page.locator(showcaseImage);
    await visual.waitFor();
    const photo=()=>visual.evaluate(el=>getComputedStyle(el).backgroundImage);
    if((await photo())==='none')throw Error('Partner signup artwork is missing');
    const fixedPosition=width>=900 ? await page.locator('.partner-showcase').evaluate(el=>{
      const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};
    }) : null;
    for(const [roleName,asset] of [
      ['Эвакуаторщик','linear-gradient'],
      ['Мастер','linear-gradient'],
      ['СТО','linear-gradient'],
      ['Страховой агент','linear-gradient'],
    ]){
      await page.getByRole('button',{name:roleName,exact:true}).click();
      if(!(await photo()).includes(asset))throw Error('Wrong cinematic showcase when choosing '+roleName);
      if(width>=900 && fixedPosition) {
        const next=await page.locator('.partner-showcase').evaluate(el=>{
          const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};
        });
        if(Math.abs(next.x-fixedPosition.x)>3 || Math.abs(next.width-fixedPosition.width)>3 ||
           Math.abs(next.height-fixedPosition.height)>3)
          throw Error('Desktop partner illustration shifts layout when switching '+roleName+': '+JSON.stringify({fixedPosition,next}));
      }
    }
    await page.getByRole('button',{name:/^Мастер/}).click();
    for(const specialty of ['Электрик','Автономщик']){
      const button=page.getByRole('button',{name:specialty,exact:true});
      await button.waitFor();await button.click();
      if(await button.getAttribute('aria-pressed')!=='true')throw Error('Specialty selection not persisted: '+specialty);
    }
    // The master role has an explicit "выездного" label in the approved
    // registration form. Compare selected button state and count, not obsolete copy.
    const specialtySummary=page.locator('.guest-master-specialties > summary');
    if(!/Специализации (выездного )?мастера\s*·\s*выбрано:\s*2/.test(await specialtySummary.innerText()))
      throw Error('Partner specialty accordion did not retain multiple choices');
    if(!await page.locator('.guest-partner-role-master').evaluate(el=>!getComputedStyle(el).backgroundImage.includes('tracksos-photo-master')))
      throw Error('Retired Nov 14 signup card image returned');

    // Latest 'Возможности' menu keeps all other approved functions discoverable.
    await page.goto(BASE+'/#/');
    if(width>=900){
      // The entire PC site uses ONE owner-approved 617 header, including
      // service, support, login and company routes. The old guest-site-nav
      // is deliberately not rendered at desktop widths.
      const nav=page.locator('.owner20-topnav');
      const services=nav.locator('details').nth(1);
      await services.locator('summary').click();
      for(const route of ['#/explore/van','#/explore/tow',
        '#/explore/ecu','#/explore/parts','#/explore/insurance']) {
        if(!(await services.locator('a[href="'+route+'"]').count()))
          throw Error('Missing approved desktop service route '+route);
      }
      // Exclusive groups must not pile dropdowns on top of one another.
      const company=nav.locator('details').first();
      await company.locator('summary').click();
      if(await services.getAttribute('open')!==null)
        throw Error('Approved menu left services dropdown layered under company menu');
      await company.locator('summary').press('Escape');
      if(await company.getAttribute('open')!==null)
        throw Error('Approved 617 menu Escape did not close');
      await company.locator('summary').click();
      await company.locator('a[href="#/company"]').click();
      await page.getByRole('heading',{name:'Компания TrakSOS'}).waitFor();
      // All public subpages preserve the exact approved header, not a 19 Nov
      // replacement, and topic-specific art, never the homepage truck.
      await page.locator('header.owner20-top').waitFor();
      if(await page.locator('header.top, .guest-site-nav').count())
        throw Error('A retired desktop guest header mounted on inner company page');
      await page.goto(BASE+'/#/');
      const pricing=page.locator('.owner20-topnav details').first();
      await pricing.locator('summary').click();
      await pricing.locator('a[href="#/explore/pricing"]').click();
      await page.getByRole('heading',{name:'Комиссии и тарифы TrakSOS'}).waitFor();
        } else {
      await page.locator('.guest-mobile-catalog > summary').click();
      const nav=page.getByRole('navigation',{name:'Возможности TrakSOS'});
      if(!(await nav.getByRole('link',{name:'ТехБаза и справочник'}).count()))
        throw Error('TechBase hidden from mobile capabilities');
      await nav.getByRole('link',{name:'О платформе'}).click();
      await page.getByRole('heading',{name:'Компания TrakSOS'}).waitFor();
    }
    if(jsErrors.length)throw Error('JS exceptions: '+jsErrors.join('; '));
    await context.close();
  }
} finally {await browser.close();}
console.log('PASS: public service routes, authorization gates, partner signup and capability menus');
