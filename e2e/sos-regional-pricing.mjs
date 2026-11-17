// #113: customer has to declare region and tariff zone separately.
// Run after e2e/flow.mjs on disposable CI database. No external geocoder/SMS/bank.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';

const BASE=process.env.BASE_URL??'http://localhost:8080';
const OUT=process.argv[2]??'e2e/shots';
await mkdir(OUT,{recursive:true});
const login=await fetch(BASE+'/api/auth/login',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({phone:'+79991112233',password:'TrakSOS-Test-2026!'}),
});
assert.equal(login.status,200,'use existing verified disposable E2E client');
const {token}=await login.json();
assert.ok(token);

const browser=await chromium.launch();
try{
  for(const [w,h,name] of [[390,844,'mobile'],[1440,900,'desktop']]){
    const ctx=await browser.newContext({viewport:{width:w,height:h},locale:'ru-RU'});
    try{
      await ctx.addInitScript(t=>localStorage.setItem('traksos.token',t),token);
      const page=await ctx.newPage();
      await page.goto(BASE+'/#/new/electric');
      await page.getByText('Регион местонахождения машины').waitFor();
      assert.equal(await page.locator('#f-agree').count(),0,
        'no default Petersburg price before region confirmation');
      assert.equal(await page.getByRole('button',{name:'Использовать мою GPS-точку'}).count(),1,
        'location must be opt-in, not silently guessed');

      await page.getByRole('button',{name:'Другой регион',exact:true}).click();
      await page.getByText(/Тарифы выезда для других регионов пока не подтверждены/).waitFor();
      assert.equal(await page.locator('#f-agree').count(),0);
      assert.equal(await page.getByRole('button',{name:'Вызвать мастера'}).count(),0,
        'outside tariff coverage must not allow initiating billable dispatch');
      await page.screenshot({path:OUT+'/sos-other-region-'+name+'.png'});

      await page.getByRole('button',{name:'Санкт-Петербург',exact:true}).click();
      assert.equal(await page.locator('#f-agree').count(),0,
        'region change must not automatically assign an SPb price zone');
      await page.getByRole('button',{name:/Санкт-Петербург, в пределах КАД/}).click();
      await page.locator('#f-where input.field').first().fill('Санкт-Петербург, Лиговский проспект 10');
      await page.getByText(/Тариф предварительный/).waitFor({timeout:15000});
      assert.equal(await page.locator('#f-agree').count(),1);
      await page.screenshot({path:OUT+'/sos-spb-provisional-'+name+'.png'});

      await page.locator('#f-where input.field').first().fill('Москва, улица Тверская');
      await page.getByText(/Адрес находится за пределами действующих тарифных зон/).waitFor({timeout:15000});
      assert.equal(await page.locator('#f-agree').count(),0,
        'spoofed Moscow address cannot inherit cached Petersburg price');

      await page.getByRole('button',{name:'Ленинградская область',exact:true}).click();
      assert.equal(await page.locator('#f-agree').count(),0);
      await page.getByRole('button',{name:/Тосно/}).click();
      await page.locator('#f-where input.field').first().fill('Тосно, Ленинградская область, улица Ленина 2');
      await page.getByText(/Тариф предварительный/).waitFor({timeout:15000});
      await page.screenshot({path:OUT+'/sos-lo-provisional-'+name+'.png'});
      await page.getByRole('button',{name:'Другой регион',exact:true}).click();
      assert.equal(await page.locator('#f-agree').count(),0);
    }finally{await ctx.close()}
  }
  console.log('PASS: no SPb default; distinct region/zone; manual quote outside coverage; no stale price on change.');
}finally{await browser.close()}
