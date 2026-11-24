import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {AuthUser} from '../src/http/router.ts';
import type {Notifier} from '../src/services/notify.ts';
import {OrderSlaService} from '../src/services/orderSla.ts';
import {setup,ok} from './helpers.ts';

test('SLA preserves incidents but excludes disabled recipients and rejects revoked reviewers', {timeout:60000},async()=>{
 const t=await setup();
 try{
  const owner=await t.login('+79996566301');
  const driver=await t.login('+79996566302','driver');
  const master=await t.login('+79996566303','master');
  const admin=await t.login('+79990000001');
  const actor=await t.db.one<AuthUser>('select id,phone,name,roles,status,owner_id from users where id=$1',[admin.id]);
  assert.ok(actor);
  const car=ok(await t.api('POST','/api/vehicles',{
   brand:'Scania',model:'R',year:2018,plate:'А663АА178',
  },owner.token));
  const fleet=ok(await t.api('GET','/api/fleet',undefined,owner.token));
  const qr=fleet.cars.find((v:any)=>v.id===car.id)?.qrCode;
  assert.ok(qr);
  ok(await t.api('POST','/api/qr/'+qr+'/join',{},driver.token));
  const order=await t.db.one<{id:string}>(`
   insert into orders(client_id,created_by,performer_id,vehicle_id,service,zone_id,status,created_at,accepted_at)
   values($1,$2,$3,$4,'electric','spb','accepted',$5,$5) returning id`,
   [owner.id,driver.id,master.id,car.id,new Date(t.clock.now().getTime()-60*60_000)]);
  assert.ok(order);
  await t.db.query("update users set status='blocked' where id=$1",[driver.id]);
  await t.db.query("update users set deleted_at=now() where id=$1",[master.id]);
  const delivered:string[]=[];
  const notifier={deliverStored:async(ids:string[])=>{delivered.push(...ids);}} as unknown as Notifier;
  const sla=new OrderSlaService(t.db,t.app.orders,notifier,t.clock.now);
  assert.equal(await sla.tick(),1);
  const inbox=await t.db.query<{user_id:string}>(
   "select user_id from notifications where kind='order_sla' and data->>'orderId'=$1",[order.id]);
  const ids=inbox.map(x=>x.user_id);
  assert.ok(ids.includes(owner.id));
  assert.ok(ids.includes(admin.id));
  assert.ok(!ids.includes(driver.id));
  assert.ok(!ids.includes(master.id));
  assert.deepEqual([...delivered].sort(),[...ids].sort());
  const incident=await t.db.one<{id:string;review_state:string}>(
   'select id,review_state from order_sla_incidents where order_id=$1',[order.id]);
  assert.ok(incident);
  await t.db.query("update users set roles=array['client']::text[] where id=$1",[admin.id]);
  await assert.rejects(sla.review(actor,incident.id,'confirmed','Проверка обстоятельств'),(e:any)=>e?.status===403);
  assert.equal((await t.db.one<{review_state:string}>('select review_state from order_sla_incidents where id=$1',[incident.id]))?.review_state,incident.review_state);
  await t.db.query('update users set roles=$2 where id=$1',[admin.id,actor.roles]);
  await sla.review(actor,incident.id,'confirmed','Проверка обстоятельств');
  assert.equal((await t.db.one<{review_state:string}>('select review_state from order_sla_incidents where id=$1',[incident.id]))?.review_state,'confirmed');
  assert.equal(await sla.tick(),0);
 }finally{await t.close();}
});
