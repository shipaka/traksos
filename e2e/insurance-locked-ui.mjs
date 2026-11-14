// Local-only UI test: the private insurance number cannot accidentally sign up
// as owner/driver/master. Simulates the server's explicit 403, never sends SMS.
import { chromium } from 'playwright';
const BASE=process.env.BASE_URL??'http://localhost:8080';
if(!['localhost','127.0.0.1'].includes(new URL(BASE).hostname))
  throw Error('Insurance restriction UI smoke is restricted to localhost');
const browser=await chromium.launch();
try {
  for (const wrongChoice of ['Владелец / автопарк','Я мастер']) {
    const ctx=await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU'});
    const page=await ctx.newPage();
    const errors=[];
    const requests=[];
    page.on('pageerror', e=>errors.push(e.message));
    await page.route('**/api/auth/code',async route=>{
      requests.push(route.request().postDataJSON());
      await route.fulfill({status:403,contentType:'application/json',
        body:JSON.stringify({error:'insurer_only',message:
          'Этот номер закреплён за страховым агентом. Доступна только регистрация в страховом кабинете.'})});
    });
    await page.goto(BASE+'/#/register');
    if(wrongChoice==='Я мастер') await page.getByRole('button',{name:'Я мастер'}).click();
    await page.getByRole('heading',{name:wrongChoice==='Я мастер'?'Работать с TrakSOS':'Регистрация в TrakSOS'}).waitFor();
    if(wrongChoice==='Я мастер') await page.getByRole('button',{name:'Я мастер'}).waitFor();
    await page.locator('input[type=tel]').fill('+79990000444');
    await page.locator('input[type=checkbox]').check();
    await page.getByRole('button',{name:'Получить код'}).click();
    await page.getByRole('alert').getByText('Для этого номера доступен только страховой кабинет').waitFor();
    if(requests.length!==1 || requests[0].accountType!==(wrongChoice==='Я мастер'?'master':'owner'))
      throw Error('Wrong accountType was sent in SMS request '+JSON.stringify(requests));
    await page.getByRole('button',{name:'Перейти к регистрации страхового агента'}).click();
    const insurerChoice=page.getByRole('button',{name:'Я представитель страховой компании'});
    await insurerChoice.waitFor();
    if(await insurerChoice.getAttribute('aria-pressed')!=='true')
      throw Error('The insurance-only suggestion did not choose the insurer role');
    if(errors.length)throw Error(errors.join('; '));
    console.log('Insurance-only guidance for '+wrongChoice+' OK');
    await ctx.close();
  }
} finally {await browser.close();}
