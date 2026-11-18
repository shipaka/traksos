import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';

let t:T,admin:any,client:any,driver:any,master:any,unverified:any;
const ad={displayName:'Ремонт грузовых электросистем',title:'Выездная диагностика электрики',
  description:'Диагностика грузовиков и устранение неисправностей электросистем на выезде.',
  region:'Санкт-Петербург и Ленобласть'};

before(async()=>{
  t=await setup();
  admin=await t.login('+79990000001');
  client=await t.login('+79995550001');
  driver=await t.login('+79995550002','driver');
  master=await t.login('+79995550003','master');
  unverified=await t.login('+79995550004','master');
  for(const u of [master,unverified])ok(await t.api('PUT','/api/performer/profile',{
    kind:'master',name:'Электрик',specialties:['electric'],taxStatus:'self_employed',inn:'780000009999'
  },u.token));
  ok(await t.api('POST',`/api/admin/performers/${master.id}/verify`,{decision:'approved'},admin.token));
});
after(async()=>{await t.close()});

test('only approved partners may submit; advertising never grants driver-room access',async()=>{
  assert.equal((await t.api('POST','/api/community/partner-offers',ad,client.token)).status,403);
  assert.equal((await t.api('POST','/api/community/partner-offers',ad,driver.token)).status,403);
  assert.equal((await t.api('POST','/api/community/partner-offers',ad,unverified.token)).status,403);
  const rooms=ok(await t.api('GET','/api/community/rooms',undefined,master.token)).rooms;
  assert.equal(rooms.some((r:any)=>r.slug==='drivers-russia'),false);
  assert.equal((await t.api('GET','/api/community/partner-offers/mine',undefined,client.token)).status,403);
  assert.equal((await t.api('GET','/api/admin/community/partner-offers',undefined,master.token)).status,403);
});

test('partner offers require moderation and never disclose private user information',async()=>{
  const created=ok(await t.api('POST','/api/community/partner-offers',ad,master.token));
  assert.equal(created.status,'pending');
  const before=ok(await t.api('GET','/api/community/partner-offers',undefined,driver.token));
  assert.equal(before.offers.length,0);
  const mine=ok(await t.api('GET','/api/community/partner-offers/mine',undefined,master.token));
  assert.equal(mine.offers.length,1);
  const queue=ok(await t.api('GET','/api/admin/community/partner-offers',undefined,admin.token));
  assert.equal(queue.offers[0].id,created.id);
  assert.equal((await t.api('POST',`/api/admin/community/partner-offers/${created.id}/review`,
    {decision:'published',reason:'short'},admin.token)).status,400);
  assert.equal((await t.api('POST',`/api/admin/community/partner-offers/${created.id}/review`,
    {decision:'published',reason:'Проверен профиль и достоверность предложения'},client.token)).status,403);
  ok(await t.api('POST',`/api/admin/community/partner-offers/${created.id}/review`,
    {decision:'published',reason:'Проверен профиль и достоверность предложения'},admin.token));
  const published=ok(await t.api('GET','/api/community/partner-offers',undefined,driver.token));
  assert.equal(published.offers.length,1);
  assert.equal(published.offers[0].displayName,ad.displayName);
  assert.equal(published.offers[0].region,ad.region);
  for(const secret of ['partner_id','phone','email','client_id','gps','lat','lng'])
    assert.equal(secret in published.offers[0],false,secret+' leaked');
  assert.equal((await t.api('POST',`/api/admin/community/partner-offers/${created.id}/review`,
    {decision:'published',reason:'Попытка повторного одобрения'},admin.token)).status,409);
});

test('advertiser cannot bypass two-per-week limit with concurrent requests',async()=>{
  const next={...ad,title:'Выездные работы грузового электрика'};
  const responses=await Promise.all([
    t.api('POST','/api/community/partner-offers',next,master.token),
    t.api('POST','/api/community/partner-offers',next,master.token),
    t.api('POST','/api/community/partner-offers',next,master.token),
  ]);
  const successful=responses.filter(x=>x.status===200).length;
  // One ad was already submitted in preceding test.
  assert.equal(successful,1);
  assert.deepEqual(responses.filter(x=>x.status!==200).map(x=>x.status).sort(),[409,409]);
  assert.equal((await t.api('POST','/api/community/partner-offers',
    {...ad,description:'Звоните мне +79991112233'},unverified.token)).status,400,
    'forbidden external contacts are validated even before partner ACL');
});

test('published offers expire after one week; moderation can hide them',async()=>{
  let current=ok(await t.api('GET','/api/community/partner-offers',undefined,client.token)).offers;
  assert.equal(current.length,1);
  t.clock.advance(8*24*60*60);
  current=ok(await t.api('GET','/api/community/partner-offers',undefined,client.token)).offers;
  assert.equal(current.length,0);
  const listed=ok(await t.api('GET','/api/admin/community/partner-offers?status=all',undefined,admin.token)).offers;
  const item=listed.find((o:any)=>o.status==='published');
  ok(await t.api('POST',`/api/admin/community/partner-offers/${item.id}/review`,
    {decision:'hidden',reason:'Снято с показа после окончания срока'},admin.token));
  const audit=await t.db.query(`select action from audit_log where target=$1
    and action='community.partner_offer_review'`,[item.id]);
  assert.equal(audit.length,2);
});
