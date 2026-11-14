// Browser regression: anonymous illustrated tiles retain their selection
// for the real phone-confirmation flow. No actual registrations or live orders.
import { chromium } from 'playwright';
const BASE=process.env.BASE_URL??'http://127.0.0.1:8080';
if(!['127.0.0.1','localhost'].includes(new URL(BASE).hostname))
  throw Error('Public routing test is restricted to local CI');
const browser=await chromium.launch();
try{
  for(const [id,destination] of [
    ['van','van'],['tow','tow'],['sto','sto'],['consult','consult']
  ]){
    const context=await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU'});
    const page=await context.newPage();
    await page.goto(BASE+'/#/');
    await page.getByRole('button',{name:new RegExp({
      van:'Выездной мастер',tow:'Эвакуация',sto:'СТО и сервисы',
      consult:'Консультации'
    }[id])}).click();
    await page.getByRole('heading',{name:'Помощь на дороге'}).waitFor();
    const saved=await page.evaluate(()=>sessionStorage.getItem('traksos.pendingLandingAction'));
    if(saved!==destination)throw Error('Public '+id+' destination was lost: '+saved);
    await context.close();
  }
  for(const [css,destination] of [
    ['.public-track-insurance','insurance'],
    ['.public-track-parts','parts'],
    ['.public-track-inspection','inspection']
  ]){
    const context=await browser.newContext({viewport:{width:1440,height:900},locale:'ru-RU'});
    const page=await context.newPage();
    await page.goto(BASE+'/#/');
    await page.locator(css).click();
    await page.getByRole('heading',{name:'Регистрация в TrakSOS'}).waitFor();
    const saved=await page.evaluate(()=>sessionStorage.getItem('traksos.pendingLandingAction'));
    if(saved!==destination)throw Error(css+' destination was lost: '+saved);
    await context.close();
  }
  const context=await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU'});
  const page=await context.newPage();
  await page.goto(BASE+'/#/');
  await page.getByRole('navigation',{name:'Основные разделы TrakSOS'})
    .getByRole('link',{name:'Запчасти'}).click();
  await page.waitForURL(/#\/register$/);
  const nav=await page.evaluate(()=>sessionStorage.getItem('traksos.pendingLandingAction'));
  if(nav!=='parts')throw Error('Mobile guest dock did not preserve parts destination');
  await context.close();
}finally{await browser.close();}
console.log('Guest illustrated tiles, insurance/parts/inspection and mobile dock preserve real destination');
