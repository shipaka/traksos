// Public TrackSOS routing contract, tested on mobile and desktop without real registrations.
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
    await page.getByRole('heading',{name:/TrakSOS.*помощь.*в пути/i}).waitFor();

    // Only public guest actions are visible in the bottom menu, not protected workflows.
    const bottom=page.getByRole('navigation',{name:'Гостевая навигация TrakSOS'});
    if(width<900){
      for(const missing of ['Заявки','Помощь','Запчасти','SOS'])
        if(await bottom.getByText(missing,{exact:true}).count())throw Error('Protected guest tab '+missing);
      if(await bottom.locator('a').count()!==4)throw Error('Guest tabbar count incorrect');
    }
    // Owner-approved 19 Nov public row. Every tile must open a real,
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
    // Owner-approved 19 Nov has only two supplementary lower cards.
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

    // Hero navigation changes the live service copy and selected dot; all slides use the same approved 19 Nov source photo.
    await page.goto(BASE+'/#/');
    const bgImage=()=>page.locator('.public-hero-visual').evaluate(el=>getComputedStyle(el).backgroundImage);
    const firstPhoto=await bgImage();
    if(!firstPhoto.includes('tracksos-approved-hero-owner-20261119'))throw Error('Unapproved first hero photo: '+firstPhoto);
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
    if(!secondPhoto.includes('tracksos-approved-hero-owner-20261119'))
      throw Error('Hero next arrow did not keep current owner-approved photograph: '+secondPhoto);
    if(await page.locator('.public-hero-dot[aria-pressed="true"]').count()!==1)
      throw Error('Hero active dot state not updated');
    await page.getByRole('button',{name:'Следующее фото'}).click();
    const thirdPhoto=await bgImage();
    await page.getByRole('heading',{name:/Ремонт и запись в СТО/}).waitFor();
    await page.getByRole('button',{name:'Узнать о СТО'}).waitFor();
    if(!thirdPhoto.includes('tracksos-approved-hero-owner-20261119'))
      throw Error('Third hero slide uses obsolete or missing photo');
    await page.getByRole('button',{name:'Предыдущее фото'}).click();
    if(await page.getByRole('heading',{name:/Эвакуация грузовиков/}).count()!==1)throw Error('Hero previous arrow did not restore previous service copy');
    await page.getByRole('button',{name:/Показать фото 1:/}).click();
    if(await bgImage()!==firstPhoto)throw Error('Hero dot did not select original photograph');

    // Benefit cards use recognizable vector artwork, no unexplained square glyph.
    if(await page.locator('.public-benefit-verified svg').count()!==1 ||
       await page.locator('.public-benefit-unified svg').count()!==1)
      throw Error('Second and third benefit illustrations are not vectors');
    if(width<900) {
      for(const tile of ['parts','inspection']) {
        const geometry=await page.locator('.public-track-'+tile).evaluate(el=>{
          const art=el.querySelector('.public-track-extra-art')?.getBoundingClientRect();
          const label=el.querySelector('b')?.getBoundingClientRect();
          return art&&label ? {artBottom:art.bottom,labelTop:label.top} : null;
        });
        if(!geometry || geometry.artBottom>geometry.labelTop+3)
          throw Error('Art overlaps text in '+tile+': '+JSON.stringify(geometry));
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
    if(!mapGeo || mapGeo.mapImageRatio<1.7 || mapGeo.mapImageRatio>2.6)
      throw Error('Map intrinsic composition distorted: '+JSON.stringify(mapGeo));
    if(width>=900 && mapGeo.mapX<=mapGeo.howX)throw Error('Desktop map must be to the right of process');
    if(width<900 && mapGeo.mapY<=mapGeo.howY)throw Error('Mobile map must stack after process');

    // Temporary demo cannot be entered or impersonate an admin without the VPS code.
    await page.goto(BASE+'/#/preview');
    await page.getByRole('heading',{name:'Проверка тестовых кабинетов'}).waitFor();
    if(await page.locator('.sandbox-role-card').count())
      throw Error('Anonymous visitor bypassed the PC preview code');
    await page.goto(BASE+'/#/admin/test-center');
    await page.getByRole('heading',{name:'Проверка тестовых кабинетов'}).waitFor();
    if(await page.locator('.sandbox-role-card').count())
      throw Error('Anonymous visitor entered admin test center directly');

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
    if(!(await photo()).includes('tracksos-approved-hero-owner-20261119'))
      throw Error('Partner page must initially display the generic Scania hero');
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
    if(!await page.getByText('Специализации мастера · выбрано: 2').count())
      throw Error('Partner specialty accordion did not retain multiple choices');
    if(!await page.locator('.guest-partner-role-master').evaluate(el=>!getComputedStyle(el).backgroundImage.includes('tracksos-photo-master')))
      throw Error('Retired Nov 14 signup card image returned');

    // Latest 'Возможности' menu keeps all other approved functions discoverable.
    await page.goto(BASE+'/#/');
    if(width>=900){
      const nav=page.locator('.guest-site-nav');
      const all=nav.locator('.guest-nav-group');
      await all.locator('summary').click();
      for(const route of ['#/explore/van','#/explore/tow','#/explore/tech',
        '#/explore/air','#/explore/ecu','#/explore/parts','#/explore/insurance']) {
        if(!(await all.locator('a[href="'+route+'"]').count()))
          throw Error('Missing actual capability '+route);
      }
      await all.locator('summary').press('Escape');
      if(await all.getAttribute('open')!==null)throw Error('Escape did not close capabilities');
      await nav.getByRole('link',{name:'О платформе'}).click();
      await page.getByRole('heading',{name:'Компания TrakSOS'}).waitFor();
      await page.goto(BASE+'/#/');
      await nav.getByRole('link',{name:'Тарифы'}).click();
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
console.log('PASS: 19 Nov public services, previews, restricted actions, partner roles and real capability menus');
