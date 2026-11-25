import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';

let t:T,client:{id:string;token:string},master:typeof client,other:typeof client;
before(async()=>{
  t=await setup();
  client=await t.login('+79997810901');
  master=await t.login('+79997810902','master');
  other=await t.login('+79997810903','master');
});
after(()=>t?.close());
const state=(id:string)=>t.db.one<any>('select * from performer_time_reservations where id=$1',[id]);
const audit=(id:string)=>t.db.query<any>("select * from performer_time_reservation_events where reservation_id=$1 and event_type='linked_order_terminal'",[id]);
const create=async()=>ok(await t.api('POST','/api/orders',{service:'electric',zoneId:'spb'},client.token)).order.id as string;
async function reserve(order:string|null,performer:string,status='confirmed',offset=60){
  const start=new Date(t.clock.now().getTime()+offset*60_000);
  const end=new Date(start.getTime()+30*60_000);
  return (await t.db.one<any>(`insert into performer_time_reservations
    (performer_id,client_id,order_id,starts_at,ends_at,status,decision_at,decided_by)
    values($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [performer,client.id,order,start,end,status,status==='confirmed'?t.clock.now():null,status==='confirmed'?client.id:null]))!.id;
}

test('real customer cancellation closes only its linked reservations and releases their capacity',async()=>{
  const id=await create();
  const a=await reserve(id,master.id);
  const p=await reserve(id,other.id,'proposed');
  const unrelated=await reserve(null,other.id,'confirmed',180);
  assert.equal(await t.app.orders.hasUpcomingReservation(t.db,master.id),true);
  ok(await t.api('POST',`/api/orders/${id}/cancel`,{reason:'Тест отмены записи'},client.token));
  assert.equal((await state(a))?.status,'cancelled');
  assert.equal((await state(p))?.status,'cancelled');
  assert.equal((await state(unrelated))?.status,'confirmed');
  assert.equal(await t.app.orders.hasUpcomingReservation(t.db,master.id),false);
  assert.equal((await audit(a)).length,1);
  assert.equal((await audit(p)).length,1);
  assert.equal((await audit(unrelated)).length,0);
  assert.equal((await audit(a))[0].details.source,'explicit_order_transition');
  await t.db.query("update orders set status='cancelled' where id=$1",[id]);
  assert.equal((await audit(a)).length,1,'same status cannot duplicate audit');
  await t.db.query("update performer_time_reservations set status='cancelled',cancelled_at=$2,cancellation_reason='Очистка тестовой записи' where id=$1",[unrelated,t.clock.now()]);
});

test('terminal completion never marks unconfirmed alternatives completed',async()=>{
  const id=await create();
  const a=await reserve(id,master.id);
  const p=await reserve(id,other.id,'selected');
  // Isolated database integration test of the trigger's real order transition.
  // This does not simulate customer payment or exercise completion checkout.
  await t.db.query("update orders set status='accepted',performer_id=$2 where id=$1",[id,master.id]);
  await t.db.query("update orders set status='completed',completed_at=$2 where id=$1",[id,t.clock.now()]);
  assert.equal((await state(a))?.status,'completed');
  assert.equal((await state(p))?.status,'cancelled');
  assert.equal((await audit(a))[0].after_status,'completed');
  assert.equal((await audit(p))[0].after_status,'cancelled');
  assert.equal(await t.app.orders.hasUpcomingReservation(t.db,master.id),false);
});

test('rollback preserves reservation, order and audit; failed search does not silently release a confirmed slot',async()=>{
  const id=await create();
  const a=await reserve(id,master.id);
  await t.db.query("update orders set status='no_performer' where id=$1",[id]);
  assert.equal((await state(a))?.status,'confirmed');
  assert.equal((await audit(a)).length,0);
  await assert.rejects(t.db.tx(async q=>{
    await q.query("update orders set status='cancelled' where id=$1",[id]);
    throw new Error('rollback test');
  }),/rollback test/);
  assert.equal((await t.db.one<any>('select status from orders where id=$1',[id]))?.status,'no_performer');
  assert.equal((await state(a))?.status,'confirmed');
  assert.equal((await audit(a)).length,0);
  await t.db.query("update orders set status='cancelled' where id=$1",[id]);
  assert.equal((await state(a))?.status,'cancelled');
  assert.equal((await audit(a)).length,1);
});
