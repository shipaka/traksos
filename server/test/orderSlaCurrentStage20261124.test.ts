import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Db} from '../src/db/index.ts';
import {OrderSlaService} from '../src/services/orderSla.ts';
import {setup} from './helpers.ts';

test('SLA reads current assignment and auction after scan, preserves PostgreSQL timestamp precision', {timeout:60000},async()=>{
 const t=await setup();
 try{
  const owner=await t.login('+79996566201');
  const former=await t.login('+79996566202','master');
  const current=await t.login('+79996566203','master');
  const old=new Date(t.clock.now().getTime()-60*60_000);
  const accepted=await t.db.one<{id:string}>(`
   insert into orders(client_id,created_by,performer_id,service,zone_id,status,created_at,accepted_at)
   values($1,$1,$2,'electric','spb','accepted',$3,$3::timestamptz+interval '123 microseconds') returning id`,
   [owner.id,former.id,old]);
  const searching=await t.db.one<{id:string}>(`
   insert into orders(client_id,created_by,service,zone_id,status,created_at,dispatch_started_at)
   values($1,$1,'electric','spb','searching',$2,$2) returning id`,[owner.id,old]);
  assert.ok(accepted);assert.ok(searching);
  let raced=false;
  const db={
   query:async(sql:string,params?:unknown[])=>{
    const rows=await t.db.query(sql,params);
    if(!raced&&sql.includes('select o.id from orders o')){
     raced=true;
     await t.db.query('update orders set performer_id=$2 where id=$1',[accepted.id,current.id]);
     await t.db.query('update orders set auction_until=$2 where id=$1',
      [searching.id,new Date(t.clock.now().getTime()+60_000)]);
    }
    return rows;
   },
   tx:t.db.tx.bind(t.db),
  } as unknown as Db;
  const service=new OrderSlaService(db,t.app.orders,t.app.notifier,t.clock.now);
  assert.equal(await service.tick(),1);
  assert.ok(raced);
  const incident=await t.db.one<{performer_id:string;exact:boolean}>(`
   select i.performer_id,i.stage_started_at=o.accepted_at as exact
   from order_sla_incidents i join orders o on o.id=i.order_id where o.id=$1`,[accepted.id]);
  assert.equal(incident?.performer_id,current.id);
  assert.equal(incident?.exact,true);
  const recipients=await t.db.query<{user_id:string}>(
   "select user_id from notifications where kind='order_sla' and data->>'orderId'=$1",[accepted.id]);
  assert.ok(recipients.some(x=>x.user_id===current.id));
  assert.ok(!recipients.some(x=>x.user_id===former.id));
  assert.equal((await t.db.query('select id from order_sla_incidents where order_id=$1',[searching.id])).length,0);
  assert.equal(await t.app.orderSla.tick(),0,'exact timestamp is recognized on subsequent tick');
 }finally{await t.close();}
});

test('SLA filters non-overdue backlog before the 300-order batch limit', {timeout:60000},async()=>{
 const t=await setup();
 try{
  const owner=await t.login('+79996566204');
  const worker=await t.login('+79996566205','master');
  const now=t.clock.now();
  await t.db.query(`
   insert into orders(client_id,created_by,performer_id,service,zone_id,status,created_at,work_started_at)
   select $1,$1,$2,'electric','spb','working',$3::timestamptz-interval '1 day',$3::timestamptz-interval '5 minutes'
   from generate_series(1,301)`,[owner.id,worker.id,now]);
  const late=await t.db.one<{id:string}>(`
   insert into orders(client_id,created_by,performer_id,service,zone_id,status,created_at,accepted_at)
   values($1,$1,$2,'electric','spb','accepted',$3::timestamptz-interval '40 minutes',
   $3::timestamptz-interval '40 minutes') returning id`,[owner.id,worker.id,now]);
  assert.ok(late);
  assert.equal(await t.app.orderSla.tick(),1,'fresh overdue order cannot be starved by old non-overdue rows');
  assert.equal((await t.db.one<{id:string}>('select order_id as id from order_sla_incidents'))?.id,late.id);
  assert.equal(await t.app.orderSla.tick(),0);
 }finally{await t.close();}
});
