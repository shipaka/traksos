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
      await scanner.click();
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
    } finally {await context.close();}
  }
  console.log('PASS: performer request settings save together and remain visible after navigation, phone and desktop.');
} finally {await browser.close();}
