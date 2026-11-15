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
    for(const id of ['tow','van','sto','insurance','parts','consult']) {
      await page.goto(BASE+'/#/');
      const card=page.locator('.public-service-tile.public-service-'+id);
      await card.getByText('Далее').waitFor();
      await card.click();
      await page.waitForURL(new RegExp('#/explore/'+id+'$'));
      await page.locator('.guest-explore-hero h1').waitFor({state:'visible'});
      const saved=await page.evaluate(()=>sessionStorage.getItem('traksos.pendingLandingAction'));
      if(saved!==id)throw Error(id+': selected service lost: '+saved);
      const next=page.locator('.guest-explore-cta');
      await next.waitFor({state:'visible'});
      if(await next.count()!==1)throw Error(id+': missing registration CTA');
      if(await next.getAttribute('href')!=='#/register')throw Error(id+': wrong registration destination');
    }
    // Three lower tiles have real information pages, not blind registration.
    for(const [selector,destination,heading] of [
      ['.public-track-parts','parts','Запчасти'],
      ['.public-track-inspection','inspection','Техосмотр грузового транспорта'],
      ['.public-track-guide','guide','Как работает TrakSOS'],
    ]) {
      await page.goto(BASE+'/#/');
      await page.locator(selector).click();
      await page.waitForURL('**/#/explore/'+destination);
      await page.getByRole('heading',{name:heading,exact:destination!=='parts'}).waitFor();
      if(!await page.locator('.guest-explore-section').count())
        throw Error(destination+': no informational content behind landing tile');
    }
    await page.goto(BASE+'/#/');
    await page.locator('.public-track-insurance').click();
    await page.waitForURL('**/#/register');
    await page.getByRole('heading',{name:'Регистрация в TrakSOS'}).waitFor();
    if(await page.evaluate(()=>sessionStorage.getItem('traksos.pendingLandingAction'))!=='insurance')
      throw Error('Insurance request intent lost while opening registration');

    // The hero controls must actually change photographs and selected dot.
    await page.goto(BASE+'/#/');
    const bgImage=()=>page.locator('.public-hero-visual').evaluate(el=>getComputedStyle(el).backgroundImage);
    const firstPhoto=await bgImage();
    if(!firstPhoto.includes('tracksos-approved-scenic-hero'))throw Error('Unapproved first hero photo: '+firstPhoto);
    if(firstPhoto.includes('traksos-final-hero'))throw Error('First slide has baked-in fake carousel controls');
    const photoGeometry=await page.evaluate(()=>{
      const hero=document.querySelector('.public-brand-hero')?.getBoundingClientRect();
      const visual=document.querySelector('.public-hero-visual')?.getBoundingClientRect();
      return hero&&visual?{heroWidth:hero.width,heroHeight:hero.height,photoWidth:visual.width,photoHeight:visual.height}:null;
    });
    if(!photoGeometry||Math.abs(photoGeometry.heroWidth-photoGeometry.photoWidth)>3||
       Math.abs(photoGeometry.heroHeight-photoGeometry.photoHeight)>3)
      throw Error('Hero image is not full bleed: '+JSON.stringify(photoGeometry));
    if(await page.locator('.public-hero-dots button').count()!==3)throw Error('Hero must show three selectable photographs');
    await page.getByRole('button',{name:'Следующее фото'}).click();
    const secondPhoto=await bgImage();
    await page.getByRole('heading',{name:/Эвакуация грузовиков/}).waitFor();
    await page.getByRole('button',{name:'Узнать об эвакуации'}).waitFor();
    if(!secondPhoto.includes('tracksos-hero-rescue-hq') || secondPhoto===firstPhoto)
      throw Error('Hero next arrow does not change photograph: '+secondPhoto);
    if(await page.locator('.public-hero-dot[aria-pressed="true"]').count()!==1)
      throw Error('Hero active dot state not updated');
    await page.getByRole('button',{name:'Следующее фото'}).click();
    const thirdPhoto=await bgImage();
    await page.getByRole('heading',{name:/Ремонт и запись в СТО/}).waitFor();
    await page.getByRole('button',{name:'Узнать о СТО'}).waitFor();
    if(!thirdPhoto.includes('tracksos-hero-service-hq') || thirdPhoto===secondPhoto)
      throw Error('Hero next arrow does not show third photograph');
    await page.getByRole('button',{name:'Предыдущее фото'}).click();
    if(await bgImage()!==secondPhoto)throw Error('Hero previous arrow did not reverse photograph');
    await page.getByRole('button',{name:/Показать фото 1:/}).click();
    if(await bgImage()!==firstPhoto)throw Error('Hero dot did not select original photograph');

    // Benefit cards use recognizable vector artwork, no unexplained square glyph.
    if(await page.locator('.public-benefit-verified svg').count()!==1 ||
       await page.locator('.public-benefit-unified svg').count()!==1)
      throw Error('Second and third benefit illustrations are not vectors');
    if(width<900) {
      for(const tile of ['parts','inspection','guide']) {
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
    const buttons=page.locator('.public-actions button');
    if(await buttons.count()!==2)throw Error('Hero must have 2 call-to-action buttons');
    if(!await page.getByRole('button',{name:'Войти',exact:true}).count())throw Error('Hero login missing');
    await buttons.first().click();
    await page.waitForURL(/#\/login$/);
    await page.getByRole('heading',{name:'Вход по номеру телефона'}).waitFor();
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
    if(!(await photo()).includes('tracksos-approved-scania-r520'))
      throw Error('Partner page must initially display the generic Scania hero');
    const fixedPosition=width>=900 ? await page.locator('.partner-showcase').evaluate(el=>{
      const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};
    }) : null;
    for(const [roleName,asset] of [
      ['Эвакуаторщик','tracksos-partner-tow-approved'],
      ['Мастер','tracksos-partner-master-approved'],
      ['СТО','tracksos-partner-sto-approved'],
      ['Страховой агент','tracksos-partner-insurer-approved'],
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
    if(!await page.locator('.guest-partner-role-master').evaluate(el=>getComputedStyle(el).backgroundImage.includes('tracksos-photo-master')))
      throw Error('Master signup role card is not photographic');

    // Every public parts category opens a descriptive premium preview, not direct login.
    await page.goto(BASE+'/#/');
    if(width>=900){
      const nav=page.locator('.guest-site-nav');
      const parts=nav.locator('.guest-nav-group').filter({has:page.locator('summary',{hasText:'Запчасти'})});
      await parts.locator('summary').click();
      for(const a of await parts.locator('.guest-nav-dropdown a').all()){
        const href=await a.getAttribute('href');
        if(!href?.startsWith('#/explore/parts/'))throw Error('Parts entry jumps to login: '+href);
      }
      await parts.locator('summary').hover();
      await page.locator('.guest-nav-group').filter({has:page.locator('summary',{hasText:'СТО и сервисы'})}).locator('summary').hover();
      if(await parts.getAttribute('open')!==null)throw Error('Previous desktop dropdown did not close');
      await page.locator('.top .logo').hover();
      if(await nav.locator('.guest-nav-group[open]').count())throw Error('Guest dropdown remains open after pointer leaves nav');
      const sto=nav.locator('.guest-nav-group').filter({has:page.locator('summary',{hasText:'СТО и сервисы'})});
      await sto.locator('summary').click();
      if(!(await sto.locator('.guest-nav-dropdown a').first().innerText()).includes('Запись в СТО'))
        throw Error('STO first public option must be booking');
      await sto.locator('summary').press('Escape');
      if(await sto.getAttribute('open')!==null)throw Error('Escape did not close desktop dropdown');
      const consult=nav.locator('.guest-nav-group').filter({has:page.locator('summary',{hasText:'Консультации'})});
      await consult.locator('summary').click();
      if(await consult.locator('.guest-nav-dropdown a').count()!==2)throw Error('Consultations should display two simple choices');
      await page.locator('.top .logo').hover();
    }
    await page.goto(BASE+'/#/');
    if(width>=900){
      const nav=page.locator('.guest-site-nav');
      for(const title of ['Помощь в дороге','Страхование','Запчасти','СТО и сервисы','Консультации'])
        await nav.locator('details').filter({has:page.locator('summary', {hasText:title})}).first().count();
      await nav.getByRole('link',{name:'Компания'}).click();
      await page.getByRole('heading',{name:'Компания TrakSOS'}).waitFor();
      await nav.getByRole('link',{name:'Оферты'}).click();
      await page.getByRole('heading',{name:'Оферты и документы'}).waitFor();
    } else {
      await page.locator('.guest-mobile-catalog > summary').click();
      await page.getByRole('navigation',{name:'Каталог услуг TrakSOS'}).getByRole('link',{name:'Компания'}).click();
      await page.getByRole('heading',{name:'Компания TrakSOS'}).waitFor();
    }
    if(jsErrors.length)throw Error('JS exceptions: '+jsErrors.join('; '));
    await context.close();
  }
} finally {await browser.close();}
console.log('PASS: responsive photo carousel, contextual auth, 6 service previews, partner roles, exclusive menus, compact map and legal pages');
