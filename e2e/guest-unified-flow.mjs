// Approved guest flow: all browser actions stay above the owner-approved home.
// Interactions use local CI only; no SMS or production accounts are created.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE=process.env.BASE_URL??'http://127.0.0.1:8080';
if(!['localhost','127.0.0.1'].includes(new URL(BASE).hostname))
  throw Error('Approved guest route smoke is local CI only');
const browser=await chromium.launch();
await mkdir('e2e/shots/guest-unified',{recursive:true});

try {
  for(const width of [390,1024,1440]){
    const context=await browser.newContext({
      viewport:{width,height:width===390?844:900},locale:'ru-RU',
      reducedMotion:'reduce'
    });
    const page=await context.newPage();
    const jsErrors=[];
    page.on('pageerror',e=>jsErrors.push(e.message));
    const home=page.locator(width>=900?'.owner20-home':'.public-landing');
    const visit=async (path,heading) => {
      await page.goto(BASE+'/#/'+path);
      const panel=page.getByRole('dialog',{name:heading});
      await panel.waitFor();
      if(!await home.isVisible() || await home.getAttribute('aria-hidden')!=='true')
        throw Error(width+'/'+path+': approved home hidden or still accessible');
      if(await page.locator('.guest-explore-hero:visible,.guest-info-page:visible').count())
        throw Error(width+'/'+path+': obsolete intermediary page mounted');
      if(await page.locator('.auth-desktop-showcase:visible').count())
        throw Error(width+'/'+path+': duplicate truck illustration returned');
      const viewport=await page.evaluate(()=>({w:document.documentElement.clientWidth,s:document.documentElement.scrollWidth}));
      if(viewport.s>viewport.w+2) throw Error(width+'/'+path+': horizontal overflow '+JSON.stringify(viewport));
      return panel;
    };
    await page.goto(BASE+'/#/');
    if(width>=900){
      await page.locator('.owner20-signin').waitFor();
      if(!await page.locator('.owner20-signup').isVisible())
        throw Error('Desktop signup is not visible directly beneath sign in');
      await page.locator('.owner20-feature-ecu').click();
      await page.waitForURL('**/#/explore/ecu');
    }else{
      await page.locator('.public-service-tile.public-service-ecu').click();
      await page.waitForURL('**/#/explore/ecu');
    }
    const auth=page.getByRole('dialog',{name:'Вход по номеру телефона'});
    await auth.waitFor();
    if(!await auth.getByText('Вы выбрали: Специалисты ЭБУ').isVisible())
      throw Error(width+': selected ECU specialist was not remembered in auth');
    if(!await home.isVisible())throw Error(width+': initial homepage replaced by ECU preview');
    if(!await auth.getByRole('button',{name:'Нет аккаунта? Зарегистрироваться'}).isVisible())
      throw Error(width+': client signup missing beneath login');
    if(!await auth.getByRole('button',{name:/Регистрация партнёра/}).isVisible())
      throw Error(width+': separate partner signup path missing');
    await page.screenshot({path:`e2e/shots/guest-unified/ecu-login-${width}.png`,animations:'disabled'});

    await auth.getByRole('button',{name:'Нет аккаунта? Зарегистрироваться'}).click();
    await page.waitForURL('**/#/register');
    const signup=page.getByRole('dialog',{name:'Регистрация в TrakSOS'});
    await signup.waitFor();
    if(!await home.isVisible())throw Error(width+': signup left approved homepage');
    await signup.getByRole('button',{name:'Владелец / автопарк'}).waitFor();
    await signup.getByRole('button',{name:'Водитель автопарка'}).waitFor();

    // Legal text should open within the same dialog, then return to the same
    // registration step with its selected role and phone, never a new tab.
    await signup.getByRole('link',{name:'офертой'}).click();
    const legal=page.getByRole('dialog',{name:'Оферта для клиентов'});
    await legal.waitFor();
    await legal.getByRole('button',{name:'Вернуться к регистрации'}).click();
    await page.getByRole('dialog',{name:'Регистрация в TrakSOS'}).waitFor();

    await visit('join','Работать с TrakSOS');
    await page.getByRole('dialog').getByRole('button',{name:'СТО',exact:true}).click();
    await page.screenshot({path:`e2e/shots/guest-unified/partner-${width}.png`,animations:'disabled'});
    await visit('offers','Оферты и документы');
    const offers=page.getByRole('dialog',{name:'Оферты и документы'});
    await offers.getByRole('link',{name:/Договор с исполнителями и СТО/}).click();
    await page.waitForURL('**/#/offer/performer');
    await page.getByRole('dialog',{name:'Договор с исполнителями и СТО'}).waitFor();
    await visit('help','Поддержка TrakSOS');
    await page.getByRole('dialog',{name:'Поддержка TrakSOS'}).getByRole('link',{name:/Я мастер, СТО/}).click();
    await page.waitForURL('**/#/join');
    await page.getByRole('dialog',{name:'Работать с TrakSOS'}).waitFor();
    await visit('company','О платформе TrakSOS');
    await visit('explore/guide','Как работает TrakSOS');
    await visit('explore/pricing','Комиссии TrakSOS');

    for(const id of ['van','tow','sto','ecu','consult','parts','insurance','inspection','air','club','tech']){
      const panel=await visit('explore/'+id,'Вход по номеру телефона');
      if(!await panel.getByText('Вы выбрали:',{exact:false}).isVisible())
        throw Error(width+': no contextual label for '+id);
    }

    await page.keyboard.press('Escape');
    await page.waitForURL('**/#/');
    if(await page.getByRole('dialog').count())throw Error('Escape did not close service panel');
    if(jsErrors.length)throw Error(width+': JS exceptions '+jsErrors.join('; '));
    await context.close();
  }
  console.log('PASS: unified approved guest routing 390, 1024, 1440 — direct service login, client/partner, offers, help, legal, close');
} finally {await browser.close();}
