import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';

let t:T;
let owner:{id:string;token:string},consultant:{id:string;token:string};
before(async()=>{
  t=await setup();
  owner=await t.login('+79997808501');
  consultant=await t.login('+79997808502','master');
});
after(()=>t.close());

test('elapsed consultation SLA never impersonates a paying customer',async()=>{
  const order=ok(await t.api('POST','/api/orders',{
    service:'consult',zoneId:'phone',brand:'MAN',
    description:'Дистанционная консультация по нестабильному питанию',
    paymentMethod:'cash'},owner.token)).order;
  await t.db.query(
    `update orders set status='awaiting_confirmation',performer_id=$2,
       work_amount=0,amount_proposed_at=$3,consult_hint=$4 where id=$1`,
    [order.id,consultant.id,new Date(t.clock.now().getTime()-48*3600_000),
      {hints:['электрика'],confidence:'likely',note:'Проверить силовую проводку'}]);
  const original=(await t.db.query<any>('select * from payments where order_id=$1',[order.id])).length;
  t.clock.advance(7*24*3600);
  await t.app.orders.tick();
  const untouched=await t.db.one<any>(
    'select status,amount_confirmed_at,completed_at from orders where id=$1',[order.id]);
  assert.equal(untouched?.status,'awaiting_confirmation');
  assert.equal(untouched?.amount_confirmed_at,null);
  assert.equal(untouched?.completed_at,null);
  assert.equal((await t.db.query<any>('select * from payments where order_id=$1',[order.id])).length,original);
  // Explicit real owner action is still permitted and uses the normal financial pipeline.
  const approved=ok(await t.api('POST','/api/orders/'+order.id+'/confirm',{},owner.token));
  assert.equal(approved.status,'completed');
});
