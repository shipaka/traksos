import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';

test('SLA incident inbox and push exclude historical order creator after QR reassignment', {timeout:60000},async()=>{
 const t=await setup();
 try{
  const owner=await t.login('+79996566001');
  const former=await t.login('+79996566002','driver');
  const worker=await t.login('+79996566003','master');
  const admin=await t.login('+79990000001');
  const a=ok(await t.api('POST','/api/vehicles',{
   brand:'Scania',model:'R',year:2017,plate:'А311АА178'},owner.token));
  const b=ok(await t.api('POST','/api/vehicles',{
   brand:'Scania',model:'R',year:2018,plate:'А312АА178'},owner.token));
  const fleet=ok(await t.api('GET','/api/fleet',undefined,owner.token));
  const qr=fleet.cars.find((v:any)=>v.id===a.id)?.qrCode;
  assert.ok(qr);
  ok(await t.api('POST','/api/qr/'+qr+'/join',{},former.token));
  const earlier=new Date(t.clock.now().getTime()-50*60_000);
  const order=await t.db.one<{id:string}>(
   `insert into orders(client_id,created_by,performer_id,vehicle_id,service,zone_id,
     status,created_at,accepted_at)
     values($1,$2,$3,$4,'electric','spb','accepted',$5,$5) returning id`,
   [owner.id,former.id,worker.id,a.id,earlier]);
  assert.ok(order);
  ok(await t.api('POST',`/api/vehicles/${b.id}/driver`,
   {phone:'+79996566002'},owner.token));
  assert.equal((await t.db.one<{owner_id:string}>(
   'select owner_id from users where id=$1',[former.id]))?.owner_id,owner.id,
   'revoked access is per vehicle, not only per fleet');
  const before=await t.db.one<{n:number}>(
   "select count(*)::int n from notifications where user_id=$1 and kind='order_sla'",
   [former.id]);
  assert.equal(await t.app.orderSla.tick(),1);
  assert.equal(await t.app.orderSla.tick(),0);
  const after=await t.db.one<{n:number}>(
   "select count(*)::int n from notifications where user_id=$1 and kind='order_sla'",
   [former.id]);
  assert.equal(after?.n,before?.n,'former driver never gets fresh private SLA alerts');
  for(const participant of [owner,worker,admin]){
   const inbox: Array<{id:string}>=await t.db.query<{id:string}>(
    "select id from notifications where user_id=$1 and kind='order_sla' and data->>'orderId'=$2",
    [participant.id,order.id]);
   assert.equal(inbox.length,1,'current owner, performer and staff keep one alert');
  }
  assert.equal((await t.db.query('select id from order_sla_incidents where order_id=$1',
   [order.id])).length,1);
  assert.equal((await t.db.one<{status:string}>('select status from orders where id=$1',
   [order.id]))?.status,'accepted','SLA never changes paid order state');
 }finally{await t.close();}
});
