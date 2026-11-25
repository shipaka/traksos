import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';
import {ReservationAgreement} from '../src/services/reservationAgreement.ts';
import {ReservationAlerts} from '../src/services/reservationAlerts.ts';

let t:T,agreements:ReservationAgreement,alerts:ReservationAlerts;
let client:{id:string;token:string},master:typeof client,other:typeof client;
const first={startsAt:'2026-12-03T08:00:00Z',endsAt:'2026-12-03T10:00:00Z'};
const next={startsAt:'2026-12-03T10:00:00Z',endsAt:'2026-12-03T12:00:00Z'};
before(async()=>{
  t=await setup();
  client=await t.login('+79997810501');
  master=await t.login('+79997810502','master');
  other=await t.login('+79997810503');
  ok(await t.api('PUT','/api/performer/profile',{kind:'master',name:'Мастер',specialties:['electric']},master.token));
  agreements=new ReservationAgreement(t.db,t.app.orders,t.clock.now);
  alerts=new ReservationAlerts(t.db,t.app.notifier,t.clock.now);
});
after(()=>t?.close());

const inbox=async(id:string)=>t.db.query<any>("select user_id,kind,title,body,data from notifications where kind='reservation' and data->>'reservationId'=$1 order by id",[id]);

test('concurrent workers and duplicate requests store exactly one inbox per event for counterparty',async()=>{
  const [a,b]=await Promise.all([agreements.request(client,master.id,first,'alert_request_0001'),agreements.request(client,master.id,first,'alert_request_0001')]);
  assert.equal(a.id,b.id);
  const counts=await Promise.all([alerts.flush(),alerts.flush()]);
  assert.equal(counts.reduce((x,y)=>x+y,0),1);
  const rows=await inbox(a.id);
  assert.equal(rows.length,1);
  assert.equal(rows[0].user_id,master.id);
  assert.equal(rows[0].data.reservationId,a.id);
  assert.equal(await alerts.flush(),0);
  assert.equal((await t.db.one<any>('select outcome from performer_reservation_alerts where reservation_id=$1',[a.id]))?.outcome,'stored');
  await agreements.select(master,a.id,1,first);
  await alerts.flush();
  assert.equal((await inbox(a.id))[1].user_id,client.id);
  await agreements.cancel(client,a.id,2,'Отмена тестовой записи');
  await alerts.flush();
});

test('superseded proposals do not notify; final cancellation stays private and contains no reason',async()=>{
  const a=await agreements.request(client,master.id,first,'alert_request_0002');
  await agreements.select(master,a.id,1,first);
  await agreements.confirm(client,a.id,2);
  await agreements.proposeMove(master,a.id,3,next);
  await agreements.cancel(client,a.id,4,'Личная причина отмены 123');
  assert.equal(await alerts.flush(),1);
  const rows=await inbox(a.id);
  assert.equal(rows.length,1);
  assert.equal(rows[0].user_id,master.id);
  assert.equal(rows[0].body,'Запись отменена.');
  assert.ok(!JSON.stringify(rows).includes('Личная причина'));
  assert.ok(!rows.some(r=>r.user_id===other.id));
  const outcomes=await t.db.query<any>('select outcome from performer_reservation_alerts where reservation_id=$1',[a.id]);
  assert.equal(outcomes.filter(x=>x.outcome==='obsolete').length,4);
});

test('inbox failure leaves intent pending; retry works and push failure cannot erase stored inbox',async()=>{
  const a=await agreements.request(client,master.id,first,'alert_request_0003');
  await t.db.exec("alter table notifications add constraint test_reservation_alert_failure check (kind<>'reservation') not valid");
  try{
    await assert.rejects(alerts.flush());
    assert.equal((await inbox(a.id)).length,0);
    assert.equal((await t.db.one<any>('select handled_at from performer_reservation_alerts where reservation_id=$1',[a.id]))?.handled_at,null);
  }finally{
    await t.db.exec('alter table notifications drop constraint test_reservation_alert_failure');
  }
  const failing=new ReservationAlerts(t.db,{deliverStored:async()=>{throw new Error('test transport failure');}},t.clock.now);
  assert.equal(await failing.flush(),1);
  assert.equal((await inbox(a.id)).length,1);
  assert.equal(await alerts.flush(),0);
  await agreements.cancel(client,a.id,1,'Отмена тестовой записи');
  await alerts.flush();
});

test('expired proposed intervals and revoked roles do not deliver stale intents',async()=>{
  const a=await agreements.request(client,master.id,first,'alert_request_0004');
  t.clock.set('2026-12-03T08:01:00Z');
  assert.equal(await alerts.flush(),0);
  assert.equal((await inbox(a.id)).length,0);
  t.clock.set('2026-12-01T10:00:00Z');
  const b=await agreements.request(client,master.id,first,'alert_request_0005');
  const previous=await t.db.one<any>('select roles from users where id=$1',[master.id]);
  await t.db.query("update users set roles=array['client']::text[] where id=$1",[master.id]);
  try{
    assert.equal(await alerts.flush(),0);
    assert.equal((await inbox(b.id)).length,0);
  }finally{
    await t.db.query('update users set roles=$2 where id=$1',[master.id,previous.roles]);
  }
});
