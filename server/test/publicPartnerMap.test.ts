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
    'normal business approval never verifies self-reported location');
  assert.equal((await t.api('PUT','/api/service/public-map',{enabled:true},service.token)).status,400,
    'ordinary approval cannot authorize a public real-GPS pin');
  const locationRoute=`/api/admin/services/${centerId}/verify-location`;
  assert.equal((await t.api('POST',locationRoute,{
    kind:'verified_document',reference:'TEST-ONLY-STATIONARY-ADDRESS-DOCUMENT',confirmed:true
  },service.token)).status,403,'station may not approve its own coordinates');
  assert.equal((await t.api('POST',locationRoute,{
    kind:'verified_document',reference:'TEST-ONLY-STATIONARY-ADDRESS-DOCUMENT',confirmed:true
  },client.token)).status,403,'a customer cannot certify station coordinates');
  assert.equal((await t.api('POST',locationRoute,{
    kind:'verified_document',reference:'TEST-ONLY-STATIONARY-ADDRESS-DOCUMENT',confirmed:false
  },admin.token)).status,400,'explicit documentary match is mandatory');
  const verified=ok(await t.api('POST',locationRoute,{
    kind:'verified_document',reference:'TEST-ONLY-STATIONARY-ADDRESS-DOCUMENT',confirmed:true
  },admin.token));
  assert.ok(verified.public_map_location_verified_at);
  const audit=await t.db.query<any>(`select actor_id,data from audit_log
    where action='service.public_location.verify' and target=$1`,[centerId]);
  assert.equal(audit.length,1);
  assert.equal(audit[0].actor_id,admin.id);
  assert.equal(audit[0].data.reference,'TEST-ONLY-STATIONARY-ADDRESS-DOCUMENT');
  assert.equal(audit[0].data.lat,59.97);
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
  assert.equal((await t.api('PUT','/api/service/public-map',{enabled:true},service.token)).status,400,
    'second ordinary verification cannot silently certify changed coordinates');
  ok(await t.api('POST',`/api/admin/services/${centerId}/verify-location`,{
    kind:'site_visit',reference:'TEST-ONLY-SECOND-SITE-VISIT-ADDRESS-B',confirmed:true
  },admin.token));
  ok(await t.api('PUT','/api/service/public-map',{enabled:true},service.token));
  assert.equal(ok(await t.api('GET','/api/public/partner-map')).points[0].lat,59.96);
});

test('explicitly cleared stationary GPS is persisted and immediately unpublished; omitted keys preserve it',async()=>{
  const map=async()=>ok(await t.api('GET','/api/public/partner-map')).points;
  const cabinet=async()=>ok(await t.api('GET','/api/base',undefined,service.token)).center;
  const checkPublished=async()=>{
    const c=await cabinet();
    assert.equal(c.lat,59.96);
    assert.equal(c.lng,30.32);
    assert.equal(c.public_map_opt_in,true);
    assert.ok(c.public_map_location_verified_at);
    assert.equal((await map()).some((p:any)=>p.id===centerId),true);
  };
  const restore=async(label:string)=>{
    ok(await t.api('PUT','/api/base',{lat:59.96,lng:30.32},service.token));
    ok(await t.api('POST',`/api/admin/services/${centerId}/verify-location`,{
      kind:'site_visit',reference:'TEST-ONLY-RECHECK-AFTER-'+label,confirmed:true
    },admin.token));
    ok(await t.api('PUT','/api/service/public-map',{enabled:true},service.token));
    await checkPublished();
  };
  await checkPublished();
  ok(await t.api('PUT','/api/base',{},service.token));
  await checkPublished(); // no update fields supplied = no change and no revocation
  for(const [label,body,wantLat,wantLng] of [
    ['BOTH',{lat:null,lng:null},null,null],
    ['LAT',{lat:null},null,30.32],
    ['LNG',{lng:null},59.96,null],
  ] as const){
    ok(await t.api('PUT','/api/base',body,service.token));
    const cleared=await cabinet();
    assert.equal(cleared.lat,wantLat,label+' lat cleared by nullable API');
    assert.equal(cleared.lng,wantLng,label+' lng cleared by nullable API');
    assert.equal(cleared.public_map_opt_in,false,label+' old consent revoked');
    assert.equal(cleared.public_map_opted_at,null,label+' opt-in timestamp revoked');
    assert.equal(cleared.public_map_location_verified_at,null,label+' old geo proof revoked');
    assert.equal((await map()).some((p:any)=>p.id===centerId),false,label+' stale pin removed');
    assert.equal((await t.api('PUT','/api/service/public-map',{enabled:true},service.token)).status,400,
      label+' cannot re-publish without GPS and independent verification');
    await restore(label);
  }
  ok(await t.api('PUT','/api/base',{lat:59.96,lng:30.32},service.token));
  await checkPublished(); // same coordinates do not invalidate valid approval
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
    'mod approval does not certify coordinates or opt-in');
  assert.equal((await t.api('PUT','/api/service/public-map',{enabled:true},second.token)).status,400);
  ok(await t.api('POST',`/api/admin/services/${secondId}/verify-location`,{
    kind:'official_registry',reference:'TEST-ONLY-OFFICIAL-LOCATION-RECORD-2',confirmed:true
  },admin.token));
  ok(await t.api('PUT','/api/service/public-map',{enabled:true},second.token));
  const both=ok(await t.api('GET','/api/public/partner-map')).points;
  assert.equal(both.length,2);
  assert.ok(both.some((p:any)=>p.id===centerId));
  assert.ok(both.some((p:any)=>p.id===secondId));
  assert.ok(!both.some((p:any)=>p.kind==='master'),'mobile performer GPS may never appear');
  ok(await t.api('PUT','/api/service/public-map',{enabled:false},second.token));
  assert.equal(ok(await t.api('GET','/api/public/partner-map')).points.length,1);
});

test('weekly confirmation expires public pin; real confirmation restores the same verified consent',async()=>{
  // Calendar aging in the disposable PostgreSQL test database, no fake API
  // response and no manipulation of the approved location or opted-in flag.
  await t.db.query(`update service_centers
    set accepts_confirmed_at=now()-interval '6 days' where id=$1`,[centerId]);
  assert.equal(ok(await t.api('GET','/api/public/partner-map')).points.length,1,
    'six-day-old confirmation is still current');
  await t.db.query(`update service_centers
    set accepts_confirmed_at=now()-interval '8 days' where id=$1`,[centerId]);
  assert.deepEqual(ok(await t.api('GET','/api/public/partner-map')).points,[],
    'eight-day-old workshop must not be advertised as currently confirmed');
  assert.equal((await t.api('PUT','/api/service/public-map',{enabled:true},service.token)).status,400,
    'expired workshop cannot renew public consent without confirming services');
  ok(await t.api('POST','/api/base/confirm-accepts',{},service.token));
  const renewed=ok(await t.api('GET','/api/public/partner-map')).points;
  assert.equal(renewed.length,1);
  assert.equal(renewed[0].id,centerId,
    'actual weekly confirmation immediately restores previously consented, verified station');
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
