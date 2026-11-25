import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

let t:T;
let admin:{id:string;token:string},client:typeof admin,master:typeof admin,backup:typeof admin;
before(async()=>{
  t=await setup();
  admin=await t.login('+79990000001');
  client=await t.login('+79997810201');
  master=await t.login('+79997810202','master');
  backup=await t.login('+79997810203','master');
  for(const m of [master,backup]){
    ok(await t.api('PUT','/api/performer/profile',{kind:'master',name:'Мастер',specialties:['electric']},m.token));
    ok(await t.api('POST',`/api/admin/performers/${m.id}/verify`,{decision:'approved'},admin.token));
    ok(await t.api('POST','/api/performer/line',{lineStatus:'online'},m.token));
  }
  ok(await t.api('POST',`/api/admin/performers/${master.id}/priority`,{isPriority:true},admin.token));
});
after(()=>t?.close());

async function reserve(status='confirmed',offset=60){
  const start=new Date(t.clock.now().getTime()+offset*60_000);
  const end=new Date(start.getTime()+30*60_000);
  return (await t.db.one<any>(`insert into performer_time_reservations
    (performer_id,client_id,starts_at,ends_at,status,decision_at,decided_by)
    values($1,$2,$3,$4,$5,$6,$7) returning id`,
    [master.id,client.id,start,end,status,status==='confirmed'?t.clock.now():null,status==='confirmed'?client.id:null]))!.id;
}
async function cancelReservation(id:string){
  await t.db.query("update performer_time_reservations set status='cancelled',cancelled_at=$2,cancellation_reason='Тест отмены записи' where id=$1",[id,t.clock.now()]);
}
async function create(){
  return ok(await t.api('POST','/api/orders',{service:'electric',zoneId:'spb',description:'Тест резерва'},client.token)).order.id as string;
}
async function cancel(id:string){
  ok(await t.api('POST',`/api/orders/${id}/cancel`,{reason:'Тест завершён'},client.token));
}
async function dispatch(id:string,who:string){
  return t.db.one<any>('select status from order_dispatch where order_id=$1 and performer_id=$2',[id,who]);
}

test('non-expired confirmed appointment excludes the master from new immediate dispatch, not other masters',async()=>{
  const reservation=await reserve();
  const id=await create();
  assert.equal(await dispatch(id,master.id),null);
  assert.equal((await dispatch(id,backup.id))?.status,'bidding');
  await cancel(id);
  await cancelReservation(reservation);
});

test('late confirmation blocks acceptance of an existing priority call without changing order or reserve',async()=>{
  const proposed=await reserve('proposed');
  const expired=await reserve('confirmed',-120);
  const id=await create();
  assert.equal((await dispatch(id,master.id))?.status,'ringing','proposed and expired intervals do not block');
  await t.db.query("update performer_time_reservations set status='confirmed',decision_at=$2,decided_by=$3 where id=$1",[proposed,t.clock.now(),client.id]);
  const result=await t.api('POST',`/api/orders/${id}/accept`,{},master.token);
  assert.equal(result.status,409);
  assert.equal(result.body.error,'performer_reserved');
  assert.equal((await dispatch(id,master.id))?.status,'ringing');
  assert.equal((await t.db.one<any>('select status from orders where id=$1',[id]))?.status,'searching');
  await cancelReservation(proposed);
  await cancelReservation(expired);
  ok(await t.api('POST',`/api/orders/${id}/accept`,{},master.token));
  await cancel(id);
});

test('auction rejects stale offers and selection after confirmation, leaves the order unassigned',async()=>{
  ok(await t.api('PUT','/api/admin/settings/dispatch',{priorityFirst:false},admin.token));
  ok(await t.api('POST','/api/performer/line',{lineStatus:'online'},master.token));
  const id=await create();
  ok(await t.api('POST',`/api/orders/${id}/offers`,{},master.token));
  const offers=ok(await t.api('GET',`/api/orders/${id}/offers`,undefined,client.token)).offers;
  const bid=offers.find((x:any)=>x.performer_id===master.id)??offers[0];
  assert.ok(bid?.id);
  const reservation=await reserve();
  const offer=await t.api('POST',`/api/orders/${id}/offers`,{},master.token);
  assert.equal(offer.status,409);
  assert.equal(offer.body.error,'performer_reserved');
  const chosen=await t.api('POST',`/api/orders/${id}/offers/${bid.id}/choose`,{},client.token);
  assert.equal(chosen.status,409);
  assert.equal(chosen.body.error,'performer_reserved');
  const state=await t.db.one<any>('select status,performer_id from orders where id=$1',[id]);
  assert.equal(state?.status,'searching');
  assert.equal(state?.performer_id,null);
  assert.equal((await t.db.one<any>('select status from bids where id=$1',[bid.id]))?.status,'withdrawn');
  assert.equal((await t.db.one<any>('select status from performer_time_reservations where id=$1',[reservation]))?.status,'confirmed');
  await cancel(id);
  await cancelReservation(reservation);
});
