import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';
import { overdueOrderStage } from '../src/services/orderSla.ts';

let t:T;
let admin:{token:string;id:string};
let customer:{token:string;id:string};
let master:{token:string;id:string};
before(async()=>{
  t=await setup();
  admin=await t.login('+79990000001');
  customer=await t.login('+79991117771');
  master=await t.login('+79991117772','master');
});
after(()=>t.close());

test('stage detector ignores pending dispatch and live auction',()=>{
  const now=new Date('2026-12-01T10:00:00Z');
  const order:any={status:'searching',is_sos:true,dispatch_started_at:null,auction_until:null};
  assert.equal(overdueOrderStage(order,now),null);
  order.dispatch_started_at='2026-12-01T09:50:00Z';
  order.auction_until='2026-12-01T10:01:00Z';
  assert.equal(overdueOrderStage(order,now),null);
  order.auction_until=null;
  assert.equal(overdueOrderStage(order,now)?.stage,'searching');
  order.status='accepted';
  assert.equal(overdueOrderStage(order,now),null);
});

test('stalled accepted stage creates one durable alert, admin-only review, no state mutation',async()=>{
  const then=new Date(t.clock.now().getTime()-40*60_000);
  const id=(await t.db.one<{id:string}>(
    "insert into orders(client_id,created_by,performer_id,service,zone_id,status,created_at,accepted_at)" +
    " values ($1,$1,$2,'electric','spb','accepted',$3,$3) returning id",
    [customer.id,master.id,then]))!.id;
  assert.equal(await t.app.orderSla.tick(),1);
  assert.equal(await t.app.orderSla.tick(),0);
  assert.equal((await t.db.query('select id from order_sla_incidents where order_id=$1',[id])).length,1);
  const notices=await t.db.query(
    "select id from notifications where user_id=$1 and kind='order_sla' and data->>'orderId'=$2",
    [customer.id,id]);
  assert.equal(notices.length,1);
  assert.equal((await t.api('GET','/api/admin/order-sla',undefined,customer.token)).status,403);
  const report=ok(await t.api('GET','/api/admin/order-sla',undefined,admin.token));
  const incident=report.incidents.find((x:any)=>x.order_id===id);
  assert.ok(incident);
  assert.equal((await t.api('PUT','/api/admin/order-sla/'+incident.id+'/review',
    {state:'confirmed',note:'ok'},admin.token)).status,400);
  ok(await t.api('PUT','/api/admin/order-sla/'+incident.id+'/review',
    {state:'confirmed',note:'Проверено по времени и диалогу'},admin.token));
  const afterReview=ok(await t.api('GET','/api/admin/order-sla',undefined,admin.token));
  assert.equal(afterReview.repeat.find((x:any)=>x.performer_id===master.id)?.confirmed,1);
  const enRoute=new Date(t.clock.now().getTime()-130*60_000);
  await t.db.query("update orders set status='en_route',en_route_at=$2 where id=$1",[id,enRoute]);
  assert.equal(await t.app.orderSla.tick(),1);
  assert.equal((await t.db.query('select id from order_sla_incidents where order_id=$1',[id])).length,2);
  assert.equal((await t.db.one<{status:string}>('select status from orders where id=$1',[id]))?.status,'en_route');
});
