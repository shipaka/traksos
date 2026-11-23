import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

// Isolated real PostgreSQL + HTTP API, never production: opt-in is explicit,
// old partners and live mobile GPS must not leak into a public map.
let t:T;
let service:{token:string;id:string},master:{token:string;id:string},admin:{token:string;id:string},client:{token:string;id:string};
let centerId:string;

before(async()=>{
  t=await setup();
  admin=await t.login('+79990000001');
  client=await t.login('+79991234560');
  service=await t.login('+79991234561','service');
  master=await t.login('+79991234562','master');
  const saved=ok(await t.api('PUT','/api/base',{
    name:'Учебная СТО на карте',address:'Санкт-Петербург, проспект Испытателей, дом 1',
    lat:59.97,lng:30.31,brands:['Scania'],staff:{electric:'own'},accepts:['quick']
  },service.token));
  centerId=saved.center.id;
  ok(await t.api('PUT','/api/performer/profile',{
    kind:'master',name:'Мастер без карты',specialties:['electric'],lat:55.75,lng:37.62,
    taxStatus:'self_employed',inn:'780000000001',
  },master.token));
});
after(()=>t.close());

test('no map points before independently approved map consent',async()=>{
  assert.deepEqual(ok(await t.api('GET','/api/public/partner-map')).points,[]);
  assert.equal((await t.api('PUT','/api/service/public-map',{enabled:true},service.token)).status,400,
    'a pending station may not opt-in');
  assert.equal((await t.api('PUT','/api/service/public-map',{enabled:true},client.token)).status,403);
  assert.equal((await t.api('PUT','/api/service/public-map',{enabled:true},master.token)).status,403);
  assert.deepEqual(ok(await t.api('GET','/api/public/partner-map')).points,[],
    'even mobile master with valid GPS must never appear');
});

test('approved stationary center requires explicit opt-in, then public lists exact known fields only',async()=>{
  ok(await t.api('POST',`/api/admin/services/${centerId}/verify`,{decision:'approved'},admin.token));
  assert.deepEqual(ok(await t.api('GET','/api/public/partner-map')).points,[],
    'approval alone never consents to public exact station coordinates');
  const consent=ok(await t.api('PUT','/api/service/public-map',{enabled:true},service.token));
  assert.equal(consent.enabled,true);
  assert.ok(consent.optedAt);
  const result=ok(await t.api('GET','/api/public/partner-map'));
  assert.equal(result.source,'verified_stationary_opt_in');
  assert.deepEqual(result.points,[{
    id:centerId,kind:'service',name:'Учебная СТО на карте',lat:59.97,lng:30.31,
  }],'no phone, tax ID, owner ID or mobile GPS ever appears in public payload');
});

test('changing stationary address revokes old opt-in and public coordinate proof',async()=>{
  ok(await t.api('PUT','/api/base',{
    address:'Санкт-Петербург, другой въезд, дом 3',lat:59.96,lng:30.32
  },service.token));
  const after=ok(await t.api('GET','/api/base',undefined,service.token)).center;
  assert.equal(after.public_map_opt_in,false);
  assert.equal(after.public_map_location_verified_at,null);
  assert.deepEqual(ok(await t.api('GET','/api/public/partner-map')).points,[]);
  assert.equal((await t.api('PUT','/api/service/public-map',{enabled:true},service.token)).status,400,
    'no republishing edited location before renewed moderator approval');
  ok(await t.api('POST',`/api/admin/services/${centerId}/verify`,{decision:'approved'},admin.token));
  ok(await t.api('PUT','/api/service/public-map',{enabled:true},service.token));
  assert.equal(ok(await t.api('GET','/api/public/partner-map')).points[0].lat,59.96);
});

test('two independently consented stations appear; unapproved or no-GPS entries never appear',async()=>{
  const second=await t.login('+79991234563','service');
  const setup=ok(await t.api('PUT','/api/base',{
    name:'Вторая проверенная мастерская',address:'Гатчина, проверенный тестовый въезд, 4',
    lat:59.57,lng:30.14,accepts:['day'],staff:{engine:'own'}
  },second.token));
  const secondId=setup.center.id;
  assert.equal(ok(await t.api('GET','/api/public/partner-map')).points.length,1);
  ok(await t.api('POST',`/api/admin/services/${secondId}/verify`,{decision:'approved'},admin.token));
  assert.equal(ok(await t.api('GET','/api/public/partner-map')).points.length,1,
    'mod approval does not itself opt-in');
  ok(await t.api('PUT','/api/service/public-map',{enabled:true},second.token));
  const both=ok(await t.api('GET','/api/public/partner-map')).points;
  assert.equal(both.length,2);
  assert.ok(both.some((p:any)=>p.id===centerId));
  assert.ok(both.some((p:any)=>p.id===secondId));
  assert.ok(!both.some((p:any)=>p.kind==='master'),'mobile performer GPS may never appear');
  ok(await t.api('PUT','/api/service/public-map',{enabled:false},second.token));
  assert.equal(ok(await t.api('GET','/api/public/partner-map')).points.length,1);
});

test('blocked, paused, revoked, absent and invalid locations disappear without cached pins',async()=>{
  await t.db.query('update service_centers set paused=true where id=$1',[centerId]);
  assert.deepEqual(ok(await t.api('GET','/api/public/partner-map')).points,[]);
  await t.db.query('update service_centers set paused=false where id=$1',[centerId]);
  await t.db.query('update users set status=$2 where id=$1',[service.id,'blocked']);
  assert.deepEqual(ok(await t.api('GET','/api/public/partner-map')).points,[]);
  await t.db.query('update users set status=$2 where id=$1',[service.id,'active']);
  await t.db.query('update service_centers set lat=0,lng=0 where id=$1',[centerId]);
  assert.deepEqual(ok(await t.api('GET','/api/public/partner-map')).points,[]);
  await t.db.query('update service_centers set lat=59.97,lng=30.31 where id=$1',[centerId]);
  assert.equal(ok(await t.api('GET','/api/public/partner-map')).points.length,1);
  ok(await t.api('PUT','/api/service/public-map',{enabled:false},service.token));
  assert.deepEqual(ok(await t.api('GET','/api/public/partner-map')).points,[],
    'revocation must remove already-published data immediately');
});
