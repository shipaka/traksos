import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';
import {workshopOpenNow} from '../src/services/realNearbyHelp.ts';
import {slot,type Schedule} from '../src/domain/schedule.ts';

let t:T,admin:any,driver:any,client:any,master:any,tow:any,workshop:any,centerId:string;
const MOSCOW={lat:55.7558,lng:37.6173,accuracyMeters:30};
const query=(user:any,body:any=MOSCOW)=>t.api('POST','/api/community/nearby-help',body,user?.token);
const schedule=(timeZone:string):Schedule=>({
  on:true,timeZone,from:'08:00',to:'18:00',phoneTo:'19:00',
  days:{mon:true,tue:true,wed:true,thu:true,fri:true,sat:true,sun:true}
});
before(async()=>{
  t=await setup();
  admin=await t.login('+79990000001');
  driver=await t.login('+79996661001','driver');
  client=await t.login('+79996661002');
  master=await t.login('+79996661003','master');
  tow=await t.login('+79996661004','tow');
  workshop=await t.login('+79996661005','service');
  t.clock.set('2026-12-01T09:00:00Z'); // 12:00 Moscow; 19:00 Vladivostok
});
after(()=>t.close());

test('nationwide time zones: no presumed Moscow, closed days and overnight shifts',()=>{
  const at=new Date('2026-12-01T09:00:00Z');
  assert.equal(workshopOpenNow({time_zone:null,hours:'24/7',closed_days:[]},at),false);
  assert.equal(workshopOpenNow({time_zone:'Europe/Moscow',hours:'08:00–18:00',closed_days:[]},at),true);
  assert.equal(workshopOpenNow({time_zone:'Asia/Vladivostok',hours:'08:00–18:00',closed_days:[]},at),false);
  assert.equal(workshopOpenNow({time_zone:'Europe/Moscow',hours:'24/7',closed_days:['2026-12-01']},at),false);
  assert.equal(workshopOpenNow({time_zone:'Europe/Moscow',hours:'22:00–06:00',closed_days:[]},
    new Date('2026-11-30T21:00:00Z')),true);
  assert.equal(slot(schedule('Europe/Moscow'),at),'work');
  assert.equal(slot(schedule('Asia/Vladivostok'),at),'off');
  assert.equal(slot(schedule('Asia/Vladivostok'),at,
    new Date('2026-12-01T10:00:00Z')),'work','manual override uses absolute until timestamp');
});

test('driver privacy, strict GPS accuracy and empty region cannot create ads',async()=>{
  assert.equal((await t.api('POST','/api/community/nearby-help',MOSCOW)).status,401);
  assert.equal((await query(client)).status,403,'only real drivers can access community promotions');
  assert.equal((await query(driver,{...MOSCOW,accuracyMeters:900})).status,400);
  assert.equal((await query(driver,{lat:55.7,lng:37.6})).status,400,'GPS accuracy is required');
  assert.equal((await query(driver,{...MOSCOW,lat:200})).status,400);
  const none=ok(await query(driver));
  assert.equal(none.hasMatches,false);
  assert.deepEqual(none.cards,[]);
  assert.match(none.noMatchesText,/нет подтверждённых доступных партнёров/);
  assert.ok(!('lat' in none) && !('lng' in none));
});

test('approved masters, tow trucks and local-time workshop appear with factual capabilities only',async()=>{
  ok(await t.api('PUT','/api/performer/profile',{
    kind:'master',name:'Реальный электрик',specialties:['electric','diag'],
    taxStatus:'self_employed',inn:'780000001234'
  },master.token));
  ok(await t.api('PUT','/api/performer/profile',{
    kind:'tow',name:'Подтверждённый эвакуатор',specialties:[],
    taxStatus:'self_employed',inn:'780000001235'
  },tow.token));
  for(const p of [master,tow]){
    ok(await t.api('POST','/api/admin/performers/'+p.id+'/verify',{decision:'approved'},admin.token));
    ok(await t.api('PUT','/api/performer/schedule',schedule('Europe/Moscow'),p.token));
    ok(await t.api('POST','/api/performer/line',{lineStatus:'online'},p.token));
    ok(await t.api('POST','/api/performer/location',{lat:MOSCOW.lat+0.01,lng:MOSCOW.lng+0.01},p.token));
    await t.db.query('update performer_profiles set location_at=$2 where user_id=$1',[p.id,t.clock.now()]);
  }
  const created=ok(await t.api('PUT','/api/base',{
    name:'Реальное СТО',address:'Москва, тестовое шоссе, 15',lat:55.77,lng:37.63,
    timeZone:'Europe/Moscow',hours:'08:00–18:00',staff:{electric:'own'},
    accepts:['quick','day'],paused:false
  },workshop.token));
  centerId=created.center.id;
  ok(await t.api('POST','/api/admin/services/'+centerId+'/verify',{decision:'approved'},admin.token));
  await t.db.query('update service_centers set accepts_confirmed_at=$2 where id=$1',[centerId,t.clock.now()]);
  const found=ok(await query(driver));
  assert.deepEqual(found.cards.map((c:any)=>c.kind),['master','tow','service']);
  assert.equal(found.cards[0].count,1);
  assert.deepEqual(found.cards[0].capabilities,['Электрика','Диагностика']);
  assert.equal(found.cards[1].providers[0].detail,'Эвакуация');
  assert.equal(found.cards[2].providers[0].id,centerId);
  assert.equal(found.cards[2].providers[0].distanceBand,'до 10 км');
  assert.ok(!JSON.stringify(found).includes(master.id),'worker personal ID not exposed');
  assert.ok(!JSON.stringify(found).includes(tow.id),'worker personal ID not exposed');
  assert.ok(!JSON.stringify(found).includes('780000001234'),'worker tax ID not exposed');
  assert.ok(!('lat' in found.cards[2].providers[0])&&!('lng' in found.cards[2].providers[0]));
  assert.ok(!('distanceKm' in found.cards[0].providers[0]),'precise worker distance must not enable triangulation');
});

test('going offline, busy, holiday or stale GPS removes advertisements immediately',async()=>{
  ok(await t.api('POST','/api/performer/line',{lineStatus:'offline'},master.token));
  ok(await t.api('PUT','/api/base',{paused:true},workshop.token));
  await t.db.query('update performer_profiles set location_at=$2 where user_id=$1',
    [tow.id,new Date(t.clock.now().getTime()-16*60000)]);
  const none=ok(await query(driver));
  assert.deepEqual(none.cards,[]);
  ok(await t.api('POST','/api/performer/line',{lineStatus:'online'},master.token));
  // A worker with a declared out-of-hours time zone must not be presented as on shift.
  ok(await t.api('PUT','/api/performer/schedule',schedule('Asia/Vladivostok'),master.token));
  const outOfHours=ok(await query(driver));
  assert.equal(outOfHours.hasMatches,false);
  ok(await t.api('PUT','/api/performer/schedule',schedule('Europe/Moscow'),master.token));
  ok(await t.api('POST','/api/performer/line',{lineStatus:'offline'},master.token));
});

test('STO with no explicitly confirmed local timezone never advertises itself as open',async()=>{
  ok(await t.api('PUT','/api/base',{paused:false},workshop.token));
  await t.db.query('update service_centers set time_zone=null,accepts_confirmed_at=$2 where id=$1',[centerId,t.clock.now()]);
  assert.equal(ok(await query(driver)).hasMatches,false);
  assert.equal((await t.api('PUT','/api/base',{timeZone:'Mars/Olympus_Mons'},workshop.token)).status,400);
  ok(await t.api('PUT','/api/base',{timeZone:'Asia/Vladivostok'},workshop.token));
  assert.equal(ok(await query(driver)).hasMatches,false,'same UTC time falls outside far-east workshop schedule');
  ok(await t.api('PUT','/api/base',{timeZone:'Europe/Moscow'},workshop.token));
  assert.deepEqual(ok(await query(driver)).cards.map((x:any)=>x.kind),['service']);
  // The same known workshop must not magically appear 1500+ kilometres away.
  assert.deepEqual(ok(await query(driver,{lat:59.94,lng:30.3,accuracyMeters:30})).cards,[]);
});


test('workshop booking compares date to facility local calendar, not Moscow default',async()=>{
  t.clock.set('2026-11-30T20:30:00Z'); // Nov 30 23:30 Moscow but Dec 1 06:30 Vladivostok
  ok(await t.api('PUT','/api/base',{timeZone:'Asia/Vladivostok',closedDays:['2026-12-01']},workshop.token));
  const endpoint='/api/services/'+centerId+'/book';
  assert.equal((await t.api('POST',endpoint,{
    need:'electric',day:'2026-11-30',arrival:'self'
  },client.token)).status,400,'yesterday in Vladivostok cannot be booked');
  assert.equal((await t.api('POST',endpoint,{
    need:'electric',day:'2026-12-01',arrival:'self'
  },client.token)).status,400,'center-defined day off is respected in its region');
  ok(await t.api('PUT','/api/base',{closedDays:[]},workshop.token));
  const booked=ok(await t.api('POST',endpoint,{
    need:'electric',day:'2026-12-01',arrival:'self'
  },client.token));
  assert.equal(booked.status,'new');
});
