import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setup,ok,type T} from './helpers.ts';

let t:T;
let owner:{id:string;token:string},master:{id:string;token:string};
let outsider:{id:string;token:string},driver:{id:string;token:string};
before(async()=>{
  t=await setup();
  owner=await t.login('+79997808001');
  master=await t.login('+79997808002','master');
  outsider=await t.login('+79997808003','master');
  driver=await t.login('+79997808004');
});
after(()=>t.close());

async function frozenVisit() {
  const r=ok(await t.api('POST','/api/orders',{
    service:'electric',zoneId:'spb',regionId:'spb',brand:'Scania',
    address:'Санкт-Петербург, Софийская улица, 60',
    description:'Выездной ремонт электрической системы тягача',paymentMethod:'cash',
  },owner.token)).order;
  const bill={end:t.clock.now().toISOString(),hour:2500,step:60,units:1,time:2500,
    wait:0,waitMinutes:0,extras:[],total:2500};
  await t.db.query(
    `update orders set status='awaiting_confirmation',performer_id=$2,
       work_amount=$3,bill=$4,amount_proposed_at=$5 where id=$1`,
    [r.id,master.id,2500,bill,t.clock.now()]);
  await t.db.query("update performer_profiles set line_status='on_job' where user_id=$1",[master.id]);
  return r.id as string;
}
const request=(requestKey=randomUUID())=>({
  requestKey,reason:'no_connection',comment:'Работу закончил, клиент не отвечает на сообщение.',
  physicalWorkConfirmed:true,
});

test('server ACK separates physical handoff from money, retries are idempotent, roles are enforced',async()=>{
  const id=await frozenVisit(),key=randomUUID();
  const beforePayments=(await t.db.query('select id from payments where order_id=$1',[id])).length;
  assert.equal((await t.api('POST','/api/orders/'+id+'/unilateral-closure',request(key),outsider.token)).status,403);
  assert.equal((await t.api('POST','/api/orders/'+id+'/unilateral-closure',
    {...request(key),physicalWorkConfirmed:false},master.token)).status,400);
  const body=ok(await t.api('POST','/api/orders/'+id+'/unilateral-closure',request(key),master.token));
  assert.equal(body.status,'awaiting_confirmation');
  assert.equal(body.unilateralClosure.status,'pending_client');
  const row=await t.db.one<any>(
    'select status,amount_confirmed_at,completed_at,bill,work_amount from orders where id=$1',[id]);
  assert.equal(row?.status,'awaiting_confirmation');
  assert.equal(row?.amount_confirmed_at,null);
  assert.equal(row?.completed_at,null);
  assert.equal(row?.work_amount,2500);
  assert.equal((await t.db.query('select id from payments where order_id=$1',[id])).length,beforePayments);
  assert.equal((await t.db.one<any>(
    'select line_status from performer_profiles where user_id=$1',[master.id]))?.line_status,'online');
  const accepted=await t.db.query<any>(
    "select * from order_unilateral_closures where order_id=$1",[id]);
  assert.equal(accepted.length,1);
  const beforeEvents=(await t.db.query<any>(
    "select id from order_events where order_id=$1 and type='unilateral_work_reported'",[id])).length;
  ok(await t.api('POST','/api/orders/'+id+'/unilateral-closure',request(key),master.token));
  assert.equal((await t.db.query<any>(
    "select id from order_events where order_id=$1 and type='unilateral_work_reported'",[id])).length,beforeEvents);
  assert.equal((await t.api('POST','/api/orders/'+id+'/unilateral-closure',
    request(),master.token)).status,409);
  assert.equal((await t.api('POST','/api/orders/'+id+'/amount',
    {extras:[{name:'Новая деталь',amount:500}]},master.token)).status,409);
  assert.equal((await t.db.one<any>('select bill from orders where id=$1',[id]))?.bill.total,2500);
});

test('owner dispute keeps frozen contract unresolved, does not re-busy master or capture money',async()=>{
  const id=await frozenVisit();
  ok(await t.api('POST','/api/orders/'+id+'/unilateral-closure',request(),master.token));
  assert.equal((await t.api('POST','/api/orders/'+id+'/dispute',
    {reason:'Смета не соответствует выполненному ремонту'},outsider.token)).status,403);
  const contested=ok(await t.api('POST','/api/orders/'+id+'/dispute',
    {reason:'Смета не соответствует выполненному ремонту'},owner.token));
  assert.equal(contested.status,'awaiting_confirmation','dispute cannot resurrect physical work');
  assert.equal(contested.unilateralClosure.status,'disputed');
  assert.equal((await t.api('POST','/api/orders/'+id+'/confirm',{},owner.token)).status,409);
  assert.equal((await t.api('POST','/api/orders/'+id+'/cancel',
    {reason:'Хочу отменить заявку'},owner.token)).status,409);
  assert.equal((await t.db.one<any>(
    'select completed_at from orders where id=$1',[id]))?.completed_at,null);
  const queue=ok(await t.api('GET','/api/admin/unilateral-closures',undefined,
    (await t.login('+79990000001')).token));
  assert.ok(queue.some((v:any)=>v.order_id===id&&v.status==='disputed'));
  assert.equal((await t.api('GET','/api/admin/unilateral-closures',undefined,owner.token)).status,403);
});

test('only owner may approve; owner acceptance uses ordinary guarded financial pipeline once',async()=>{
  const id=await frozenVisit();
  await t.db.query('update orders set created_by=$2 where id=$1',[id,driver.id]);
  ok(await t.api('POST','/api/orders/'+id+'/unilateral-closure',request(),master.token));
  assert.equal((await t.api('POST','/api/orders/'+id+'/confirm',{},driver.token)).status,403,
    'driver is not the paying owner in unilateral handoff');
  const before=ok(await t.api('GET','/api/orders/'+id,undefined,owner.token));
  const approved=ok(await t.api('POST','/api/orders/'+id+'/confirm',
    {total:before.money.total},owner.token));
  assert.equal(approved.status,'completed');
  assert.equal(approved.unilateralClosure.status,'accepted');
  assert.equal((await t.api('POST','/api/orders/'+id+'/confirm',{},owner.token)).status,409);
  assert.equal((await t.db.query<any>(
    "select id from order_events where order_id=$1 and type='unilateral_accepted'",[id])).length,1);
});
