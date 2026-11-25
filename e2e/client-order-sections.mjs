// #36: active orders and STO bookings must be visibly separate on mobile/PC.
// Uses fictitious accounts created by the immediately preceding e2e/flow.mjs,
// with genuine registration, consent and workflow, on disposable CI PostgreSQL.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';

const BASE=process.env.BASE_URL??'http://localhost:8080';
const OUT=process.argv[2]??'e2e/shots';
await mkdir(OUT,{recursive:true});
const response=await fetch(BASE+'/api/auth/login',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({phone:'+79991112233',password:'TrakSOS-Test-2026!'})
});
assert.equal(response.status,200,'only existing E2E client can be used here');
const auth=await response.json();
const get=async(path)=>{
  const r=await fetch(BASE+path,{headers:{authorization:'Bearer '+auth.token}});
  assert.equal(r.status,200,path);
  return r.json();
};
const orders=await get('/api/orders?as=client');
const bookings=await get('/api/bookings');
const isOpenOrder=x=>!['completed','cancelled','no_performer'].includes(x.status);
const isOpenBooking=x=>!['closed','declined','cancelled'].includes(x.status);
const activeOrders=orders.filter(isOpenOrder);
const archivedOrders=orders.filter(x=>!isOpenOrder(x));
const activeBookings=bookings.filter(isOpenBooking);
const closedBookings=bookings.filter(x=>!isOpenBooking(x));
assert.ok(archivedOrders.length>0,'the preceding E2E must produce a completed client order');

const browser=await chromium.launch();
try{
  for(const [width,height,device] of [[390,844,'mobile'],[1440,900,'desktop']]){
    const ctx=await browser.newContext({viewport:{width,height},locale:'ru-RU'});
    try{
      await ctx.addInitScript(token=>localStorage.setItem('traksos.token',token),auth.token);
      const page=await ctx.newPage();
      await page.goto(BASE+'/#/orders');
      await page.getByRole('heading',{name:`Текущие обращения и заявки на подтверждении · ${activeOrders.length}`})
        .waitFor({timeout:15000});
      const sto=page.getByRole('region',{name:'Активные записи на СТО'});
      await sto.getByRole('heading',{name:`Записи на СТО · ${activeBookings.length}`})
        .waitFor({timeout:15000});
      for(const o of archivedOrders){
        assert.equal(await page.locator(`a[href="#/order/${o.id}"]`).count(),0,
          device+': archived order cannot appear under the current tab');
      }
      const visibleOrders=page.locator('main.client-orders-page > .rows a[href^="#/order/"]');
      assert.equal(await visibleOrders.count(),activeOrders.length,
        device+': current order counter and cards disagree');
      const openSto=sto.locator('a[href^="#/booking/"]');
      assert.equal(await openSto.count(),activeBookings.length,
        device+': STO booking counter and cards disagree');
      for(const b of closedBookings){
        assert.equal(await sto.locator(`a[href="#/booking/${b.id}"]`).count(),0,
          device+': closed booking cannot appear in current list');
      }
      if(activeBookings.length>0&&activeOrders.length===0)
        assert.equal(await page.getByText('Активных выездов и записей на СТО сейчас нет').count(),0,
          'STO booking means no global empty state');
      await page.screenshot({path:`${OUT}/client-orders-now-${device}.png`});

      await page.getByRole('tab',{name:'История',exact:true}).click();
      for(const o of archivedOrders){
        await page.locator(`a[href="#/order/${o.id}"]`).first().waitFor({timeout:15000});
      }
      assert.equal(await page.getByRole('region',{name:'Активные записи на СТО'}).count(),0,
        device+': current-only STO section must not appear in History');
      await page.screenshot({path:`${OUT}/client-orders-history-${device}.png`});

      // Real calendar API on the same authenticated customer; fixture only
      // for deterministic UI states and failed/late network responses below.
      const real=await get('/api/client/calendar?from=2026-12-02&to=2026-12-08');
      assert.equal(real.timezone,'Europe/Moscow');
      assert.ok(Array.isArray(real.items));
      let failCalendar=false;
      await page.route('**/api/client/calendar?*',async route=>{
        if(failCalendar)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Тестовый отказ'})});
        const q=new URL(route.request().url()).searchParams;
        const day=q.get('from');
        return route.fulfill({json:{timezone:'Europe/Moscow',from:day,to:q.get('to'),truncated:false,items:[
          {id:'test-sto',kind:'service',number:999,service:'electric',day,brand:'DAF',model:'XF',requested_time:'11:00',confirmed_time:null,confirmation:'pending'},
          {id:'test-reservation',kind:'roadside',number:archivedOrders[0].number,service:archivedOrders[0].service,day,brand:'DAF',model:'XF',starts_at:day+'T09:00:00Z',ends_at:day+'T10:00:00Z',order_id:archivedOrders[0].id,confirmation:'confirmed'}
        ]}});
      });
      await page.getByRole('tab',{name:'Календарь',exact:true}).click();
      const calendar=page.getByRole('region',{name:'Календарь заявок'});
      await calendar.getByLabel('Начало периода').fill('2026-12-02');
      await page.waitForURL('**/#/orders/calendar/2026-12-02');
      await calendar.getByText('Желаемое время: 11:00').waitFor();
      await calendar.getByText('Ожидает подтверждения',{exact:true}).waitFor();
      await calendar.getByText('Подтверждено',{exact:true}).waitFor();
      await calendar.getByRole('button',{name:'7 дней →',exact:true}).click();
      await page.waitForURL('**/#/orders/calendar/2026-12-09');
      await calendar.getByText('Подтверждено',{exact:true}).waitFor();
      await calendar.locator('a[href="#/order/'+archivedOrders[0].id+'"]').click();
      await page.waitForURL('**/#/order/'+archivedOrders[0].id);
      await page.goBack();
      await page.waitForURL('**/#/orders/calendar/2026-12-09');
      await calendar.getByText('Подтверждено',{exact:true}).waitFor();
      failCalendar=true;
      await calendar.getByRole('button',{name:'Обновить календарь'}).click();
      await calendar.getByRole('alert').waitFor();
      assert.equal(await calendar.getByText('Подтверждено',{exact:true}).count(),0,'failed read must clear old private results');
      failCalendar=false;
      await calendar.getByRole('button',{name:'Повторить загрузку календаря'}).click();
      await calendar.getByText('Подтверждено',{exact:true}).waitFor();
      await page.screenshot({path:`${OUT}/client-calendar-${device}.png`});

    }finally{await ctx.close()}
  }
  console.log('PASS: current SOS and STO bookings separated with real counts; closed orders only in history.');
}finally{await browser.close()}
