import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

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
