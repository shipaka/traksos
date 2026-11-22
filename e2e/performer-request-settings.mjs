// #35: request preferences are a page, not an automated "advanced search".
// Runs in the isolated CI browser flow after e2e/flow.mjs.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const BASE=process.env.BASE_URL??'http://localhost:8080';
const OUT=process.argv[2]??'e2e/shots';
await mkdir(OUT,{recursive:true});
async function request(path,method='GET',token,body){
  const response=await fetch(BASE+path,{
    method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
    body:body===undefined?undefined:JSON.stringify(body),
  });
  if(!response.ok)throw Error(method+' '+path+' returned '+response.status+' '+await response.text());
  return response.json();
}
const auth=await request('/api/auth/login','POST',undefined,{
  phone:'+79992223344',password:'TrakSOS-Test-2026!',
});
assert.ok(auth.token,'the preceding E2E must register a verified master');
const browser=await chromium.launch();
try{
  for(const [width,height,label] of [[390,844,'phone'],[1440,900,'desktop']]){
    const context=await browser.newContext({viewport:{width,height},locale:'ru-RU'});
    try{
      await context.addInitScript(token=>localStorage.setItem('traksos.token',token),auth.token);
      const page=await context.newPage();
      await page.goto(BASE+'/#/work/filter');
      await page.getByRole('heading',{name:'Настройки заявок'}).waitFor({timeout:15000});
      await page.getByText(/не повышают очередь/).waitFor();
      await page.getByRole('button',{name:'С собой'}).click();
      await page.getByText(/наличие инструмента не меняет очередь/).waitFor();
      const scanner=page.getByRole('button',{name:/Сканер под марку/});
      if (await scanner.getAttribute('aria-pressed') !== 'true') await scanner.click();
      await page.getByRole('button',{name:'Сохранить всё'}).click();
      await page.getByText('Настройки заявок сохранены').waitFor({timeout:12000});
      let p=await request('/api/performer/profile','GET',auth.token);
      assert.equal(p.kind,'master');
      assert.ok(p.extras?.stock?.includes('Сканер под марку'),'server must save stock and profile together');
      await page.screenshot({path:OUT+'/request-settings-'+label+'.png'});
      await page.goto(BASE+'/#/work');
      await page.goto(BASE+'/#/work/filter');
      await page.getByRole('heading',{name:'Настройки заявок'}).waitFor();
      await page.getByRole('button',{name:'С собой'}).click();
      await page.getByRole('button',{name:/Сканер под марку/}).waitFor();
      assert.equal(await page.getByRole('button',{name:/Сканер под марку/}).getAttribute('aria-pressed'),'true',
        'previous selection remains after navigation');
      await page.getByRole('button',{name:'Цены'}).click();
      await page.getByText(/не прибавляются автоматически к цене заявки/).waitFor();
      await page.screenshot({path:OUT+'/request-settings-prices-'+label+'.png'});

      // Owner-approved phone UX: short expandable schedule, gold selected
      // days, real save/restore through the existing performer API.
      await page.goto(BASE+'/#/work/me/schedule');
      await page.getByRole('heading',{name:'Распорядок',exact:true}).waitFor();
      const scheduleToggle=page.locator('.performer-schedule-enabled').first();
      const initiallyOn=await scheduleToggle.getAttribute('aria-pressed');
      if(initiallyOn!=='true') await scheduleToggle.click();
      const sections=page.locator('.performer-schedule-accordion');
      assert.equal(await sections.count(),2,'working days and hours must each be a distinct disclosure');
      if(width<900){
        assert.equal(await sections.nth(0).evaluate(e=>e.open),false,
          'mobile workday list must start collapsed');
        assert.equal(await sections.nth(1).evaluate(e=>e.open),false,
          'mobile hours list must start collapsed');
      }
      if(!await sections.nth(0).evaluate(e=>e.open)) await sections.nth(0).locator('summary').click();
      const saturday=page.getByRole('button',{name:'Сб',exact:true});
      const initialDay=await saturday.getAttribute('aria-pressed');
      await saturday.click();
      assert.notEqual(await saturday.getAttribute('aria-pressed'),initialDay,
        'tapping a day must change its state');
      if(await saturday.getAttribute('aria-pressed')==='true'){
        const selected=await saturday.evaluate(el=>getComputedStyle(el).backgroundColor);
        assert.equal(selected,'rgb(232, 173, 81)',
          'selected workdays must use the approved gold, not pink');
      }
      await page.getByRole('button',{name:'Сохранить',exact:true}).click();
      await page.getByText('Распорядок сохранён').waitFor();
      await page.reload({waitUntil:'domcontentloaded'});
      await page.getByRole('heading',{name:'Распорядок',exact:true}).waitFor();
      const refreshed=page.locator('.performer-schedule-accordion').first();
      if(!await refreshed.evaluate(e=>e.open)) await refreshed.locator('summary').click();
      assert.notEqual(await page.getByRole('button',{name:'Сб',exact:true}).getAttribute('aria-pressed'),initialDay,
        'workday selection must persist after saving/reloading');
      await page.getByRole('button',{name:'Сб',exact:true}).click();
      if(initiallyOn!=='true') await page.locator('.performer-schedule-enabled').first().click();
      await page.getByRole('button',{name:'Сохранить',exact:true}).click();
      await page.getByText('Распорядок сохранён').waitFor();
      await page.screenshot({path:OUT+'/schedule-accordion-'+label+'.png'});
      if(width<900){
        await page.goto(BASE+'/#/menu');
        const menu=page.locator('.tr-mobile-menu-page');
        await menu.waitFor({state:'visible'});
        const groups=menu.locator('details.tr-mobile-menu-section');
        assert.equal(await groups.count(),4,'mobile menu must have four semantic sections');
        assert.equal(await groups.nth(0).evaluate(e=>e.open),true,
          'quick actions should be visible first');
        for(const i of [1,2,3])assert.equal(await groups.nth(i).evaluate(e=>e.open),false,
          'secondary mobile groups must stay collapsed until requested');
        await groups.nth(3).locator('summary').click();
        assert.ok(await groups.nth(3).getByRole('link',{name:/Профиль и настройки/}).isVisible(),
          'account settings must open on tap');
        assert.ok(await groups.nth(3).getByRole('button',{name:'Выйти из аккаунта'}).isVisible(),
          'logout must remain accessible inside the account menu');
        await groups.nth(1).locator('summary').click();
        assert.ok(await groups.nth(1).getByRole('navigation',{name:'Разделы кабинета'}).isVisible(),
          'work sections must expand on tap');
        await page.screenshot({path:OUT+'/menu-accordion-phone.png'});
      }
    } finally {await context.close();}
  }
  console.log('PASS: performer request settings save together and remain visible after navigation, phone and desktop.');
} finally {await browser.close();}
