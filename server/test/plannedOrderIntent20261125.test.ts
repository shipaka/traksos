import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';
import {PlannedOrderIntentService} from '../src/services/plannedOrderIntent.ts';

let t:T,svc:PlannedOrderIntentService,owner:{id:string;token:string},driver:typeof owner,other:typeof owner,vehicle:string,qr:string;
const code=(c:string)=>(e:any)=>e?.code===c;
const input=(key:string)=>({vehicleId:vehicle,service:'electric',startsAt:'2026-12-03T08:00:00Z',endsAt:'2026-12-03T10:00:00Z',requestKey:key});
before(async()=>{
  t=await setup();
  owner=await t.login('+79997811001');
  driver=await t.login('+79997811002');
  other=await t.login('+79997811003');
  vehicle=ok(await t.api('POST','/api/vehicles',{brand:'DAF',model:'XF',plate:'А123АА178'},owner.token)).id;
  qr=ok(await t.api('GET','/api/fleet',undefined,owner.token)).cars[0].qrCode;
  ok(await t.api('POST',`/api/qr/${qr}/join`,{},driver.token));
  svc=new PlannedOrderIntentService(t.db,t.clock.now);
});
after(()=>t?.close());
async function count(table:string){return (await t.db.one<any>('select count(*)::int as n from '+table))!.n;}
test('driver request requires owner decision and never creates payable order, dispatch or reservation',async()=>{
  const tables=['orders','payments','order_dispatch','performer_time_reservations'];
  const before=await Promise.all(tables.map(count));
  const [a,b]=await Promise.all([svc.request(driver,input('planned_request_001')),svc.request(driver,input('planned_request_001'))]);
  assert.equal(a.id,b.id);
  assert.equal(a.status,'awaiting_owner');
  assert.equal(a.owner_id,owner.id);
  await assert.rejects(svc.request(other,input('planned_request_002')),code('forbidden'));
  await assert.rejects(svc.decide(driver,a.id,1,true),code('not_found'));
  const [x,y]=await Promise.all([svc.decide(owner,a.id,1,true),svc.decide(owner,a.id,1,true)]);
  assert.equal(x.status,'owner_allowed');
  assert.equal(y.version,2);
  assert.equal(await count('planned_order_intent_events'),2);
  assert.deepEqual(await Promise.all(tables.map(count)),before);
  await assert.rejects(svc.decide(owner,a.id,1,false),code('planned_changed'));
});
test('fleet restrictions, invalid times and stale keys are checked before persisting',async()=>{
  await assert.rejects(svc.request(driver,{...input('planned_request_001'),endsAt:'2026-12-03T11:00:00Z'}),code('planned_key_reused'));
  await assert.rejects(svc.request(driver,{...input('planned_request_003'),startsAt:'2026-02-30T08:00:00Z'}),code('bad_planned_time'));
  ok(await t.api('PUT','/api/fleet',{allow:{repair:false}},owner.token));
  try{await assert.rejects(svc.request(driver,input('planned_request_004')),code('forbidden'));}
  finally{ok(await t.api('PUT','/api/fleet',{allow:{repair:true}},owner.token));}
});
test('revoked vehicle access or newly forbidden work cannot be approved; owner can reject stale request',async()=>{
  const a=await svc.request(driver,input('planned_request_005'));
  const b=await svc.request(driver,input('planned_request_006'));
  ok(await t.api('PUT','/api/fleet',{allow:{repair:false}},owner.token));
  await assert.rejects(svc.decide(owner,a.id,1,true),code('forbidden'));
  ok(await t.api('PUT','/api/fleet',{allow:{repair:true}},owner.token));
  ok(await t.api('POST',`/api/qr/${qr}/join`,{},other.token));
  await assert.rejects(svc.decide(owner,b.id,1,true),code('forbidden'));
  await assert.rejects(svc.request(driver,input('planned_request_007')),code('forbidden'));
  assert.equal((await svc.decide(owner,b.id,1,false)).status,'rejected');
  assert.equal((await svc.decide(owner,b.id,1,false)).version,2);
});
test('expired request cannot be allowed even by owner, and failed audit rolls back decision',async()=>{
  const a=await svc.request(owner,input('planned_request_008'));
  await t.db.exec("alter table planned_order_intent_events add constraint test_intent_audit_fail check(event_type<>'owner_allowed') not valid");
  try{
    await assert.rejects(svc.decide(owner,a.id,1,true));
    assert.equal((await t.db.one<any>('select status from planned_order_intents where id=$1',[a.id]))?.status,'awaiting_owner');
  }finally{await t.db.exec('alter table planned_order_intent_events drop constraint test_intent_audit_fail');}
  t.clock.set('2026-12-03T08:00:00Z');
  await assert.rejects(svc.decide(owner,a.id,1,true),code('planned_expired'));
  assert.equal((await svc.decide(owner,a.id,1,false)).status,'rejected');
});
