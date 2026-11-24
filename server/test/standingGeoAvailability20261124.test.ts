import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';
import { StandingService } from '../src/services/standing.ts';

let t:T;
let admin:{id:string;token:string};
let client:{id:string;token:string};
let worker:{id:string;token:string};
let nearOrder:string;
let farOrder:string;

before(async()=>{
  t=await setup();
  admin=await t.login('+79990000001');
  client=await t.login('+79994330101');
  worker=await t.login('+79994330102','master');
  ok(await t.api('PUT','/api/performer/profile',{
    kind:'master',name:'Точный мастер',specialties:['electric'],
    taxStatus:'self_employed',inn:'780000000555',
  },worker.token));
  ok(await t.api('POST',`/api/admin/performers/${worker.id}/verify`,
    {decision:'approved'},admin.token));
  ok(await t.api('POST','/api/performer/line',{lineStatus:'online'},worker.token));
  const n=ok(await t.api('POST','/api/orders',{
    service:'electric',zoneId:'spb',description:'Нужен электрик рядом с трассой',
  },client.token)).order;
  const f=ok(await t.api('POST','/api/orders',{
    service:'electric',zoneId:'spb',description:'Удалённая диагностика',
  },client.token)).order;
  nearOrder=n.id;farOrder=f.id;
  // Coordinates are real PG snapshots for the fixture; no fabricated
  // distance is inserted by the service or by the nearby API.
  await t.db.query("update orders set lat=59.95,lng=30.35,status='searching' where id=$1",[nearOrder]);
  await t.db.query("update orders set lat=57.8,lng=30.35,status='searching' where id=$1",[farOrder]);
});
after(()=>t.close());

test('worker without valid GPS must not count the whole country as nearby',async()=>{
  const unknown=ok(await t.api('GET','/api/performer/nearby',undefined,worker.token));
  assert.equal(unknown.locationKnown,false);
  assert.equal(unknown.openNearby,0);
  assert.equal(unknown.ahead,0);
  await t.db.query('update performer_profiles set lat=0,lng=0 where user_id=$1',[worker.id]);
  const zero=ok(await t.api('GET','/api/performer/nearby',undefined,worker.token));
  assert.equal(zero.locationKnown,false,'0/0 is not a real truck position');
  assert.equal(zero.openNearby,0);
});

test('worker with actual GPS sees only eligible orders inside the 50 km area',async()=>{
  await t.db.query('update performer_profiles set lat=59.95,lng=30.35 where user_id=$1',[worker.id]);
  const local=ok(await t.api('GET','/api/performer/nearby',undefined,worker.token));
  assert.equal(local.locationKnown,true);
  assert.equal(local.openNearby,1,'far request must not inflate local backlog');
  assert.equal(local.ahead,0);
  await t.db.query('update orders set lat=null,lng=null where id=$1',[nearOrder]);
  const noLocation=ok(await t.api('GET','/api/performer/nearby',undefined,worker.token));
  assert.equal(noLocation.openNearby,0,'order without verified coordinates is not nearby');
});

test('customer search distinguishes network totals from location-filtered candidates',async()=>{
  const network=ok(await t.api('GET','/api/masters-nearby?service=electric&lat=0&lng=0',
    undefined,client.token));
  assert.equal(network.scope,'network');
  assert.equal(network.radiusKm,null);
  const missing=ok(await t.api('GET','/api/masters-nearby?service=electric',
    undefined,client.token));
  assert.equal(missing.scope,'network');
  const nearby=ok(await t.api('GET','/api/masters-nearby?service=electric&lat=59.95&lng=30.35',
    undefined,client.token));
  assert.equal(nearby.scope,'nearby');
  assert.ok(nearby.radiusKm>0);
  assert.ok(nearby.online>=nearby.free);
  assert.ok(nearby.free>=nearby.match);
  assert.ok(nearby.items.every((p:any)=>p.distanceKm!==null &&
    p.distanceKm<=nearby.radiusKm));
});

test('busy awaiting-confirmation jobs are not advertised as a free performer',async()=>{
  await t.db.query(`update orders set performer_id=$2,status='awaiting_confirmation'
    where id=$1`,[farOrder,worker.id]);
  const result=ok(await t.api('GET','/api/masters-nearby?service=electric&lat=59.95&lng=30.35',
    undefined,client.token));
  assert.equal(result.free,0);
  assert.equal(result.match,0);
  assert.deepEqual(result.items,[]);
});


test('closer worker counter excludes unverified, paused and busy colleagues',async()=>{
  await t.db.query("update orders set lat=59.95,lng=30.35,status='searching' where id=$1",[nearOrder]);
  await t.db.query('update performer_profiles set lat=59.97,lng=30.37 where user_id=$1',[worker.id]);
  const closer=await t.login('+79994330103','master');
  ok(await t.api('PUT','/api/performer/profile',{
    kind:'master',name:'Ближайший мастер',specialties:['electric'],
    taxStatus:'self_employed',inn:'780000000555',
  },closer.token));
  ok(await t.api('POST','/api/performer/line',{lineStatus:'online'},closer.token));
  await t.db.query('update performer_profiles set lat=59.95,lng=30.35 where user_id=$1',[closer.id]);
  const pending=ok(await t.api('GET','/api/performer/nearby',undefined,worker.token));
  assert.equal(pending.openNearby,1);
  assert.equal(pending.ahead,0,'an unverified competitor is not a dispatchable colleague');
  ok(await t.api('POST',`/api/admin/performers/${closer.id}/verify`,
    {decision:'approved'},admin.token));
  const approved=ok(await t.api('GET','/api/performer/nearby',undefined,worker.token));
  assert.equal(approved.ahead,1,'only the genuinely nearer available worker is ahead');
  await t.db.query('update performer_profiles set paused=true where user_id=$1',[closer.id]);
  assert.equal(ok(await t.api('GET','/api/performer/nearby',undefined,worker.token)).ahead,0);
});


test('nearby counters exclude refused brands and profiles whose account lost its role',async()=>{
  const closer=(await t.db.one<{id:string}>('select id from users where phone=$1',['+79994330103']))!;
  await t.db.query("update orders set brand='Scania',lat=59.95,lng=30.35,status='searching' where id=$1",[nearOrder]);
  await t.db.query("update performer_profiles set paused=false,brands=$2::jsonb where user_id=$1",
    [closer.id,JSON.stringify({Scania:'refuse'})]);
  const refused=ok(await t.api('GET','/api/performer/nearby',undefined,worker.token));
  assert.equal(refused.openNearby,1);
  assert.equal(refused.ahead,0);
  await t.db.query("update performer_profiles set brands=$2::jsonb where user_id=$1",
    [worker.id,JSON.stringify({Scania:'refuse'})]);
  assert.equal(ok(await t.api('GET','/api/performer/nearby',undefined,worker.token)).openNearby,0);
  await t.db.query("update performer_profiles set brands='{}'::jsonb where user_id=any($1::uuid[])",[[worker.id,closer.id]]);
  const search='/api/masters-nearby?service=electric&lat=59.95&lng=30.35';
  const before=ok(await t.api('GET',search,undefined,client.token));
  await t.db.query("update users set roles=array_remove(roles,'master') where id=$1",[closer.id]);
  const after=ok(await t.api('GET',search,undefined,client.token));
  assert.equal(after.online,before.online-1);
  assert.equal(ok(await t.api('GET','/api/performer/nearby',undefined,worker.token)).ahead,0);
  await t.db.query("update users set roles=array_append(roles,'master') where id=$1",[closer.id]);
});

test('arbitrary legacy vehicle brand keys cannot mutate the standing aggregation prototype',async()=>{
  const closer=(await t.db.one<{id:string}>('select id from users where phone=$1',['+79994330103']))!;
  await t.db.query("update orders set service='consult',performer_id=$2,brand='__proto__' where id=$1",[nearOrder,worker.id]);
  await t.db.query("update orders set consult_of=$2,hint_check='yes',performer_id=$3 where id=$1",[farOrder,nearOrder,closer.id]);
  try {
    const result=ok(await t.api('GET','/api/performer/standing',undefined,worker.token));
    assert.equal(result.accuracy.cases,1);
    assert.equal(result.accuracy.value,1);
    assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype,'n'),false);
    assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype,'v'),false);
  } finally {
    // Prevent cross-test contamination even when run against the old implementation.
    delete (Object.prototype as any).n;
    delete (Object.prototype as any).v;
  }
});


test('preview always serializes numeric brand stars for legacy or inherited levels',async()=>{
  const closer=(await t.db.one<{id:string}>('select id from users where phone=$1',['+79994330103']))!;
  await t.db.query("update performer_profiles set paused=false,line_status='online',schedule='{\"on\":false}'::jsonb where user_id=$1",[closer.id]);
  // The preceding consultation-accuracy fixture assigned the colleague to farOrder.
  // Finish that historical stage before testing availability of the same colleague.
  await t.db.query("update orders set status='completed' where id=$1",[farOrder]);
  try {
    for(const [level,expected] of [['constructor',2],['__proto__',2],['excellent',3],['last_resort',1]] as const){
      await t.db.query('update performer_profiles set brands=$2::jsonb where user_id=$1',
        [closer.id,JSON.stringify({Scania:level})]);
      const result=ok(await t.api('GET','/api/masters-nearby?service=electric&brand=Scania&lat=59.95&lng=30.35',
        undefined,client.token));
      const card=result.items.find((p:any)=>p.name==='Ближайший');
      assert.ok(card,'eligible colleague must remain visible');
      assert.equal(card.brandStars,expected);
    }
  } finally {
    await t.db.query("update performer_profiles set brands='{}'::jsonb where user_id=$1",[closer.id]);
  }
});

test('preview takes one shift-clock snapshot and safely excludes malformed specialties',async()=>{
  const candidate={
    user_id:'valid',kind:'master',specialties:['electric'],brands:{},is_priority:false,
    paused:false,line_status:'online',verification:'approved',lat:59.95,lng:30.35,
    rating:5,accepts_group:false,user_status:'active',name:'Мастер',tier:'standard',
    call_out_price:null,busy:false,jobs:0,extras:{},cash_debt:0,
    schedule:{on:true,days:{mon:true},from:'09:00',to:'18:00',phoneTo:'20:00'},
  };
  let reads=0;
  const service=new StandingService(
    {query:async()=>[candidate,{...candidate,user_id:'legacy',specialties:null}]} as any,
    ()=>new Date(reads++===0?'2026-11-23T14:59:59Z':'2026-11-23T15:00:00Z'),
    {all:async()=>({dispatch:{radiusKm:50,citySpeedKmh:40},pricing:{tiers:{}}})} as any,
  );
  const result=await service.mastersNearby({id:'client'} as any,{service:'electric',lat:59.95,lng:30.35});
  assert.equal(reads,1,'free and match must use one shift snapshot');
  assert.equal(result.free,1);
  assert.equal(result.match,1);
  assert.equal(result.items.length,1);
});
