import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';
import {ReservationAgreement} from '../src/services/reservationAgreement.ts';
import {ReservationAlerts} from '../src/services/reservationAlerts.ts';
import {ReservationDeadlineSweep} from '../src/services/reservationDeadlineSweep.ts';

let t:T,agreement:ReservationAgreement,sweep:ReservationDeadlineSweep,alerts:ReservationAlerts;
let client:{id:string;token:string},master:typeof client,other:typeof client;
const day={startsAt:'2026-12-03T08:00:00Z',endsAt:'2026-12-03T10:00:00Z'};
const later={startsAt:'2026-12-03T11:00:00Z',endsAt:'2026-12-03T12:00:00Z'};
const code=(c:string)=>(e:any)=>e?.code===c;
before(async()=>{
  t=await setup();
  client=await t.login('+79997810601');
  master=await t.login('+79997810602','master');
  other=await t.login('+79997810603');
  ok(await t.api('PUT','/api/performer/profile',{kind:'master',name:'Мастер',specialties:['electric']},master.token));
  agreement=new ReservationAgreement(t.db,t.app.orders,t.clock.now);
  sweep=new ReservationDeadlineSweep(t.db,t.clock.now);
  alerts=new ReservationAlerts(t.db,t.app.notifier,t.clock.now);
});
after(()=>t?.close());
const read=(id:string)=>t.db.one<any>('select * from performer_time_reservations where id=$1',[id]);
const events=(id:string,type:string)=>t.db.query<any>('select * from performer_time_reservation_events where reservation_id=$1 and event_type=$2',[id,type]);
const inbox=(id:string)=>t.db.query<any>("select user_id,body from notifications where kind='reservation' and data->>'reservationId'=$1",[id]);
async function confirm(input:typeof day,key:string){
  const a=await agreement.request(client,master.id,input,key);
  await agreement.select(master,a.id,1,input);
  return agreement.confirm(client,a.id,2);
}

test('two workers expire a pending proposal exactly once; both parties receive the same durable outcome',async()=>{
  const a=await agreement.request(client,master.id,day,'deadline_request_01');
  await agreement.select(master,a.id,1,day);
  t.clock.set(day.startsAt);
  await assert.rejects(agreement.select(master,a.id,2,later),code('reservation_expired'));
  await assert.rejects(agreement.confirm(client,a.id,2),code('reservation_expired'));
  const counts=await Promise.all([sweep.sweep(),sweep.sweep()]);
  assert.equal(counts.reduce((n,x)=>n+x.expiredProposals,0),1);
  assert.equal((await read(a.id))?.status,'cancelled');
  assert.equal((await events(a.id,'proposal_expired')).length,1);
  assert.equal(await alerts.flush(),2);
  assert.deepEqual((await inbox(a.id)).map(x=>x.user_id).sort(),[client.id,master.id].sort());
  assert.equal(await alerts.flush(),0);
  await assert.rejects(agreement.confirm(client,a.id,2),code('reservation_changed'));
});

test('expiry of a pending move does not cancel original confirmed appointment',async()=>{
  t.clock.set('2026-12-01T10:00:00Z');
  const a=await confirm(later,'deadline_request_02');
  await agreement.proposeMove(master,a.id,3,day);
  t.clock.set(day.startsAt);
  assert.equal((await sweep.sweep()).expiredMoves,1);
  const row=await read(a.id);
  assert.equal(row.status,'confirmed');
  assert.equal(row.move_state,null);
  assert.equal(row.review_required_at,null);
  assert.equal(new Date(row.starts_at).toISOString(),'2026-12-03T11:00:00.000Z');
  assert.equal((await events(a.id,'move_expired')).length,1);
  assert.equal(await alerts.flush(),2);
  assert.equal((await inbox(a.id)).length,2);
  await agreement.cancel(client,a.id,5,'Тест завершён');
  await alerts.flush();
});

test('passed confirmed interval only requests review; no fabricated completion, cancellation or payment',async()=>{
  t.clock.set('2026-12-01T10:00:00Z');
  const a=await confirm(day,'deadline_request_03');
  await agreement.proposeMove(master,a.id,3,later);
  t.clock.set(day.endsAt);
  assert.equal((await sweep.sweep()).reviewRequired,1);
  const row=await read(a.id);
  assert.equal(row.status,'confirmed');
  assert.ok(row.review_required_at);
  assert.equal(row.move_state,null);
  assert.equal(row.cancelled_at,null);
  assert.equal(row.decided_by,client.id);
  assert.equal((await events(a.id,'review_required')).length,1);
  assert.deepEqual(await sweep.sweep(),{expiredProposals:0,expiredMoves:0,reviewRequired:0});
  assert.equal(await alerts.flush(),2);
  assert.ok((await inbox(a.id)).every(x=>x.body.includes('выполнение не подтверждено')));
  await assert.rejects(agreement.confirm(client,a.id,4),code('reservation_changed'));
  await agreement.cancel(client,a.id,5,'Тест завершён');
  await alerts.flush();
});

test('failed system outbox write rolls back expiration and audit; legacy rows are untouched',async()=>{
  t.clock.set('2026-12-01T10:00:00Z');
  const a=await agreement.request(client,master.id,day,'deadline_request_04');
  const legacy=await t.db.one<any>("insert into performer_time_reservations(performer_id,client_id,starts_at,ends_at) values($1,$2,$3,$4) returning id",[master.id,other.id,day.startsAt,day.endsAt]);
  t.clock.set(day.startsAt);
  // Reject NEW intents only, leaving the existing request intent intact.
  await t.db.exec("alter table performer_reservation_alerts add constraint test_deadline_alert_failure check (agreement_version<2) not valid");
  try{
    await assert.rejects(sweep.sweep());
    assert.equal((await read(a.id))?.status,'proposed');
    assert.equal((await events(a.id,'proposal_expired')).length,0);
  }finally{await t.db.exec('alter table performer_reservation_alerts drop constraint test_deadline_alert_failure');}
  assert.equal((await sweep.sweep(1)).expiredProposals,1);
  assert.equal((await read(legacy.id))?.status,'proposed');
  assert.equal((await events(a.id,'proposal_expired')).length,1);
  assert.equal(await alerts.flush(),2);
});
