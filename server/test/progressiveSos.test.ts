import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';
import {validStages,withinStage,policyFor} from '../src/domain/progressiveSos.ts';

const stages=[
  {radiusKm:2,maxRoadEtaMinutes:45,waitSeconds:10},
  {radiusKm:25,maxRoadEtaMinutes:100,waitSeconds:10},
];

test('SOS stage limits are monotonic, bounded and never assume straight-line road ETA',async()=>{
  assert.equal(validStages(stages),true);
  assert.equal(validStages([]),false);
  assert.equal(validStages([{radiusKm:200,maxRoadEtaMinutes:400,waitSeconds:8}]),false);
  assert.equal(validStages([stages[1],stages[0]]),false);
  assert.equal(validStages([{...stages[0]},{...stages[1],maxRoadEtaMinutes:44}]),false);
  assert.equal(policyFor({is_sos:true,service:'electric'}, {enabled:false,stages}),null);
  assert.equal(policyFor({is_sos:true,service:'consult'},{enabled:true,stages}),null);
  assert.deepEqual(policyFor({is_sos:true,service:'electric'},{enabled:true,stages}),stages,
    'route outage must keep the restrictive stages rather than fall back to 220km');
  const from={lat:59.99,lng:30.32},to={lat:59.94,lng:30.34};
  assert.equal(await withinStage(stages[0],from,to,5,5,async()=>15),null,
    'even fast route is outside 2km first ring');
  assert.equal(await withinStage(stages[1],from,to,5,5,undefined),null,
    'no route provider means NEVER fabricate an ETA');
  assert.equal(await withinStage(stages[1],from,to,5,5,async()=>null),null);
  assert.equal(await withinStage(stages[1],from,to,5,5,async()=>180),null,
    '180 minute drive is not automatically invited');
  assert.deepEqual(await withinStage(stages[1],from,to,5,10,async()=>40),
    {travelMinutes:40,totalMinutes:50});
});

test('no staged SOS dispatch activation via admin while real road routing is missing',{timeout:60000},async()=>{
  const t=await setup();
  try{
    const admin=await t.login('+79990000001');
    const denied=await t.api('PUT','/api/admin/settings/dispatch',{
      priorityFirst:false,sosProgressive:{enabled:true,stages},
    },admin.token);
    assert.equal(denied.status,400);
    assert.equal(denied.body.error,'road_eta_not_ready');
    const s=ok(await t.api('GET','/api/admin/settings',undefined,admin.token));
    assert.equal(s.dispatch.sosProgressive.enabled,false);
    assert.equal(await t.db.query<any>(
      "select data from audit_log where action='settings.update' and target='dispatch'").then(x=>x.length),0);
  }finally{await t.close()}
});

test('12 concurrent SOS ticks advance one wave, send one invitation and use verified road ETA',
  {timeout:60000},async()=>{
  let routeCalls=0;
  const t=await setup({verifiedRoadEta:async(from,to)=>{
    routeCalls++;
    assert.ok(from.lat>60,'trusted provider receives performer location');
    assert.equal(to.lat,59.94,'trusted provider receives client location');
    return 60;
  }});
  try{
    const admin=await t.login('+79990000001');
    const client=await t.login('+79995551001');
    const master=await t.login('+79995551002','master');
    ok(await t.api('PUT','/api/performer/profile',{
      name:'Тест дальней подачи',kind:'master',specialties:['electric'],prepMinutes:12,
    },master.token));
    ok(await t.api('POST',`/api/admin/performers/${master.id}/verify`,{decision:'approved'},admin.token));
    ok(await t.api('POST','/api/performer/line',{lineStatus:'online'},master.token));
    ok(await t.api('POST','/api/performer/location',{lat:60.055,lng:30.34},master.token));
    ok(await t.api('PUT','/api/admin/settings/dispatch',{
      priorityFirst:false,sosProgressive:{enabled:true,stages},
    },admin.token));
    const created=ok(await t.api('POST','/api/orders',{
      service:'electric',isSos:true,regionId:'spb',zoneId:'spb',
      lat:59.94,lng:30.34,address:'Санкт-Петербург, тестовая стоянка',
      brand:'Scania',paymentMethod:'cash',
    },client.token)).order;
    assert.equal(created.status,'searching');
    let row=await t.db.one<any>('select sos_dispatch_stage from orders where id=$1',[created.id]);
    assert.equal(Number(row.sos_dispatch_stage),0);
    assert.equal((await t.db.query<any>('select id from order_dispatch where order_id=$1',[created.id])).length,0,
      'far performer excluded from first wave before any notification');
    assert.equal(routeCalls,0,'no route API call before geometric prefilter');
    const initial=ok(await t.api('GET',`/api/orders/${created.id}`,undefined,client.token));
    assert.equal(initial.searchStage.wave,1);
    assert.equal(initial.searchStage.waves,2);

    t.clock.advance(11);
    const outcomes=await Promise.all(Array.from({length:12},()=>t.app.auction.tick()));
    assert.equal(outcomes.reduce((a,b)=>a+b,0),1,'only one timer advances the wave');
    row=await t.db.one<any>('select status,sos_dispatch_stage from orders where id=$1',[created.id]);
    assert.equal(row.status,'searching');
    assert.equal(Number(row.sos_dispatch_stage),1);
    const dispatched=await t.db.query<any>('select performer_id,status,road_eta_minutes from order_dispatch where order_id=$1',[created.id]);
    assert.equal(dispatched.length,1,'only one performer invitation');
    assert.equal(dispatched[0].performer_id,master.id);
    assert.equal(dispatched[0].status,'bidding');
    assert.equal(Number(dispatched[0].road_eta_minutes),72,'travel plus preparation');
    const expansions=await t.db.query<any>(
      "select id from order_events where order_id=$1 and type='search_expanded'",[created.id]);
    assert.equal(expansions.length,1,'one durable expansion record');

    const accepted=ok(await t.api('POST',`/api/orders/${created.id}/offers`,{},master.token));
    assert.equal(Number(accepted.eta_minutes),72,'offer must quote trusted road ETA');
    const offers=ok(await t.api('GET',`/api/orders/${created.id}/offers`,undefined,client.token));
    assert.equal(offers.offers.length,1);
    assert.equal(Number(offers.offers[0].road_eta_minutes),72);
    t.clock.advance(11);
    await t.app.auction.tick();
    row=await t.db.one<any>('select status,performer_id from orders where id=$1',[created.id]);
    assert.equal(row.status,'accepted');
    assert.equal(row.performer_id,master.id);
    assert.equal((await t.db.query('select id from order_dispatch where order_id=$1',[created.id])).length,1);
  }finally{await t.close()}
});

test('cancelled SOS stays cancelled during later staged ticks; missing route never auto-invites',
  {timeout:60000},async()=>{
  const t=await setup({verifiedRoadEta:async()=>null});
  try{
    const admin=await t.login('+79990000001');
    const client=await t.login('+79995551011');
    const master=await t.login('+79995551012','master');
    ok(await t.api('PUT','/api/performer/profile',{kind:'master',specialties:['electric']},master.token));
    ok(await t.api('POST',`/api/admin/performers/${master.id}/verify`,{decision:'approved'},admin.token));
    ok(await t.api('POST','/api/performer/line',{lineStatus:'online'},master.token));
    ok(await t.api('POST','/api/performer/location',{lat:59.95,lng:30.34},master.token));
    ok(await t.api('PUT','/api/admin/settings/dispatch',{
      priorityFirst:false,sosProgressive:{enabled:true,stages},
    },admin.token));
    const create=()=>t.api('POST','/api/orders',{
      service:'electric',isSos:true,regionId:'spb',zoneId:'spb',
      lat:59.94,lng:30.34,paymentMethod:'cash',brand:'DAF',
    },client.token);
    const first=ok(await create()).order;
    ok(await t.api('POST',`/api/orders/${first.id}/cancel`,
      {reason:'Ошибочно нажал вызов'},client.token));
    t.clock.advance(22);
    await Promise.all(Array.from({length:12},()=>t.app.auction.tick()));
    assert.equal((await t.db.one<any>('select status from orders where id=$1',[first.id])).status,'cancelled');
    assert.equal((await t.db.query('select id from order_dispatch where order_id=$1',[first.id])).length,0,
      'cancel before invitation must not produce a late call');
    const second=ok(await create()).order;
    t.clock.advance(11);
    await t.app.auction.tick();
    assert.equal(Number((await t.db.one<any>('select sos_dispatch_stage from orders where id=$1',[second.id])).sos_dispatch_stage),1);
    t.clock.advance(11);
    await t.app.auction.tick();
    assert.equal((await t.db.one<any>('select status from orders where id=$1',[second.id])).status,'no_performer');
    assert.equal((await t.db.query('select id from order_dispatch where order_id=$1',[second.id])).length,0);
    ok(await t.api('POST',`/api/orders/${second.id}/cancel`,
      {reason:'Не нашлось исполнителей'},client.token));
    assert.equal((await t.db.one<any>('select status from orders where id=$1',[second.id])).status,'cancelled');
  }finally{await t.close()}
});
