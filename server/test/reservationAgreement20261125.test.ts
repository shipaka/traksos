import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';
import {ReservationAgreement} from '../src/services/reservationAgreement.ts';

let t:T,service:ReservationAgreement;
let admin:{id:string;token:string},client:typeof admin,master:typeof admin,other:typeof admin;
const first={startsAt:'2026-12-03T08:00:00Z',endsAt:'2026-12-03T10:00:00Z'};
const alternative={startsAt:'2026-12-03T10:00:00Z',endsAt:'2026-12-03T12:00:00Z'};
const code=(expected:string)=>(e:any)=>e?.code===expected;
before(async()=>{
  t=await setup();
  admin=await t.login('+79990000001');
  client=await t.login('+79997810401');
  master=await t.login('+79997810402','master');
  other=await t.login('+79997810403');
  ok(await t.api('PUT','/api/performer/profile',{kind:'master',name:'Мастер',specialties:['electric']},master.token));
  ok(await t.api('POST',`/api/admin/performers/${master.id}/verify`,{decision:'approved'},admin.token));
  ok(await t.api('POST','/api/performer/line',{lineStatus:'online'},master.token));
  ok(await t.api('POST',`/api/admin/performers/${master.id}/priority`,{isPriority:true},admin.token));
  service=new ReservationAgreement(t.db,t.app.orders,t.clock.now);
});
after(()=>t?.close());

test('only the two participants can agree; version and idempotency preserve the exact selected interval',async()=>{
  const [a,b]=await Promise.all([service.request(client,master.id,first,'request_000000001'),service.request(client,master.id,first,'request_000000001')]);
  assert.equal(a.id,b.id);
  assert.equal(a.status,'proposed');
  await assert.rejects(service.request(client,master.id,alternative,'request_000000001'),code('reservation_key_reused'));
  await assert.rejects(service.select(other,a.id,1,first),code('forbidden'));
  await assert.rejects(service.select(client,a.id,1,first),code('forbidden'));
  await assert.rejects(service.confirm(client,a.id,1),code('reservation_state'));
  const selected=await service.select(master,a.id,1,first);
  assert.equal(selected.status,'selected');
  assert.equal((await service.select(master,a.id,1,first)).agreement_version,2);
  const counter=await service.select(master,a.id,2,alternative);
  assert.equal(counter.agreement_version,3);
  await assert.rejects(service.confirm(client,a.id,2),code('reservation_changed'));
  await assert.rejects(service.confirm(master,a.id,3),code('forbidden'));
  const [x,y]=await Promise.all([service.confirm(client,a.id,3),service.confirm(client,a.id,3)]);
  assert.equal(x.status,'confirmed');
  assert.equal(y.agreement_version,4);
  assert.equal(new Date(x.starts_at).toISOString(),'2026-12-03T10:00:00.000Z');
  const events=await t.db.query<any>('select event_type from performer_time_reservation_events where reservation_id=$1 order by id',[a.id]);
  assert.deepEqual(events.map(e=>e.event_type),['requested','performer_selected','performer_selected','client_confirmed']);
  await assert.rejects(service.cancel(other,a.id,4,'Чужая отмена'),code('forbidden'));
  await service.cancel(client,a.id,4,'Отмена по согласованию');
  assert.equal((await service.cancel(client,a.id,4,'Отмена по согласованию')).status,'cancelled');
});

test('concurrent overlapping confirmations leave exactly one reservation and one confirmed event',async()=>{
  const a=await service.request(client,master.id,first,'request_000000002');
  const b=await service.request(other,master.id,first,'request_000000003');
  await service.select(master,a.id,1,first);
  await service.select(master,b.id,1,first);
  const result=await Promise.allSettled([service.confirm(client,a.id,2),service.confirm(other,b.id,2)]);
  assert.equal(result.filter(x=>x.status==='fulfilled').length,1);
  const loser=result.find(x=>x.status==='rejected') as PromiseRejectedResult;
  assert.equal(loser.reason.code,'reservation_overlap');
  const rows=await t.db.query<any>('select id,status,agreement_version from performer_time_reservations where id in ($1,$2)',[a.id,b.id]);
  assert.equal(rows.filter(x=>x.status==='confirmed').length,1);
  assert.equal(rows.filter(x=>x.status==='selected').length,1);
  const events=await t.db.query<any>("select id from performer_time_reservation_events where reservation_id in ($1,$2) and event_type='client_confirmed'",[a.id,b.id]);
  assert.equal(events.length,1);
  const winner=rows.find(x=>x.status==='confirmed');
  await service.cancel(master,winner.id,winner.agreement_version,'Перенос записи по согласованию');
  const remaining=rows.find(x=>x.status==='selected');
  const retry=await service.confirm(remaining.id===a.id?client:other,remaining.id,2);
  assert.equal(retry.status,'confirmed');
  await service.cancel(master,retry.id,retry.agreement_version,'Отмена тестовой записи');
});

test('master with an actual active order cannot confirm a future unbounded reservation',async()=>{
  const p=await service.request(client,master.id,first,'request_000000004');
  await service.select(master,p.id,1,first);
  const order=ok(await t.api('POST','/api/orders',{service:'electric',zoneId:'spb'},client.token)).order;
  ok(await t.api('POST',`/api/orders/${order.id}/accept`,{},master.token));
  await assert.rejects(service.confirm(client,p.id,2),code('performer_busy'));
  assert.equal((await t.db.one<any>('select status from performer_time_reservations where id=$1',[p.id]))?.status,'selected');
  ok(await t.api('POST',`/api/orders/${order.id}/cancel`,{reason:'Тест завершён'},client.token));
  const confirmed=await service.confirm(client,p.id,2);
  assert.equal(confirmed.status,'confirmed');
  await service.cancel(client,p.id,3,'Отмена тестовой записи');
});

test('invalid, past and legacy intervals fail closed',async()=>{
  for(const input of [
    {startsAt:'2026-02-30T08:00:00Z',endsAt:'2026-12-03T10:00:00Z'},
    {startsAt:'2026-12-03T08:00:00',endsAt:first.endsAt},
    {startsAt:first.endsAt,endsAt:first.startsAt},
  ])await assert.rejects(service.request(client,master.id,input,'request_000000005'),code('bad_reservation_time'));
  await assert.rejects(service.request(client,master.id,{startsAt:'2026-11-30T08:00:00Z',endsAt:'2026-11-30T10:00:00Z'},'request_000000006'),code('reservation_expired'));
  const legacy=await t.db.one<any>("insert into performer_time_reservations(performer_id,client_id,starts_at,ends_at) values($1,$2,$3,$4) returning id",[master.id,client.id,first.startsAt,first.endsAt]);
  await assert.rejects(service.select(master,legacy.id,1,first),code('not_found'));
});
