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
      if(await next.getAttribute('href')!==(id==='parts'?'#/login':'#/register'))throw Error(id+': wrong registration destination');
    }
    await page.goto(BASE+'/#/');
    const map=page.locator('.public-map-static-link');
    if(!(await map.getAttribute('href')).includes('yandex.ru/maps/'))throw Error('Static map is not linked to Yandex Maps');
    if(!(await map.getAttribute('target'))?.includes('_blank'))throw Error('Map must open an external tab');
    await page.getByText('Пример расположения услуг.',{exact:false}).waitFor();

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

    await page.goto(BASE+'/#/join');
    for(const label of ['Мастер','Эвакуаторщик','СТО','Страховой агент'])
      await page.getByRole('button',{name:new RegExp('^'+label)}).waitFor();
    if(await page.locator('.auth-desktop-form .opt').count()!==4)throw Error('Partner categories must be exactly four');
    await page.getByRole('button',{name:/^Мастер/}).click();
    for(const specialty of ['Электрик','Автономщик'])
      await page.getByRole('button',{name:specialty,exact:true}).waitFor();

    await page.goto(BASE+'/#/');
    if(width>=900){
      const nav=page.locator('.guest-site-nav');
      for(const title of ['Услуги','Страхование','Запчасти','СТО и сервисы','Консультации'])
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
console.log('PASS: guest navigation, 6 previews, registration, 4 partner roles, legal pages and Yandex map');
