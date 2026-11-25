import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';

test('ECU handoff revokes former vehicle driver from detail, route and technical notes', {timeout:60000},async()=>{
 const t=await setup();
 try {
  const owner=await t.login('+79996564001');
  const driver=await t.login('+79996564002','driver');
  const replacement=await t.login('+79996564003','driver');
  const expert=await t.login('+79996564004','master');
  const a=ok(await t.api('POST','/api/vehicles',{
   brand:'Scania',model:'R',year:2018,plate:'А221АА178'},owner.token));
  const b=ok(await t.api('POST','/api/vehicles',{
   brand:'Scania',model:'G',year:2017,plate:'А222АА178'},owner.token));
  const fleet=ok(await t.api('GET','/api/fleet',undefined,owner.token));
  const qr=fleet.cars.find((v:any)=>v.id===a.id)?.qrCode;
  assert.ok(qr);
  ok(await t.api('POST','/api/qr/'+qr+'/join',{},driver.token));
  const order=ok(await t.api('POST','/api/orders',{
   service:'electric',vehicleId:a.id,isSos:true,zoneId:'spb',regionId:'spb',
   address:'Санкт-Петербург, КАД, тестовая стоянка',lat:59.95,lng:30.35,
   problem:'no_start',description:'Стартер не запускает двигатель, блок ЭБУ недоступен',
  },driver.token)).order;
  await t.db.query("update orders set status='completed',performer_id=$2 where id=$1",
   [order.id,expert.id]);
  const handoff=ok(await t.api('POST',`/api/orders/${order.id}/ecu-handoff`,{
   summary:'После тестирования питания и массы требуется отдельная диагностика ЭБУ',
  },owner.token));
  assert.ok(handoff.id);
  assert.equal((await t.api('GET',`/api/orders/${order.id}/ecu-handoff`,
   undefined,driver.token)).status,200);
  assert.equal((await t.api('GET',`/api/ecu/handoffs/${handoff.id}`,
   undefined,driver.token)).status,200);
  // Authorise the private note phase without introducing any payment; the
  // existing service test independently exercises the real quote/choose path.
  await t.db.query("update ecu_handoffs set state='selected', selected_performer_id=$2 where id=$1",
   [handoff.id,expert.id]);
  ok(await t.api('POST',`/api/ecu/handoffs/${handoff.id}/notes`,{
   body:'Старая карточка ещё принадлежит активному водителю машины',
  },driver.token));
  const baseline=await t.db.one<{n:number}>(
   "select count(*)::int n from notifications where user_id=$1 and kind='ecu_handoff'",
   [driver.id]);

  // A new car within the SAME fleet deliberately keeps owner_id unchanged;
  // created_by and handoff participants still contain the old driver's UUID.
  ok(await t.api('POST',`/api/vehicles/${b.id}/driver`,
   {phone:'+79996564002'},owner.token));
  assert.equal((await t.db.one<{owner_id:string}>(
   'select owner_id from users where id=$1',[driver.id]))?.owner_id,owner.id);
  assert.equal((await t.db.one<{driver_id:string|null}>(
   'select driver_id from vehicles where id=$1',[a.id]))?.driver_id,null);

  assert.equal((await t.api('GET',`/api/orders/${order.id}/ecu-handoff`,
   undefined,driver.token)).status,403);
  assert.equal((await t.api('GET',`/api/ecu/handoffs/${handoff.id}`,
   undefined,driver.token)).status,403);
  assert.equal((await t.api('POST',`/api/ecu/handoffs/${handoff.id}/notes`,{
   body:'Не должен записать сообщение в чужую цепочку ЭБУ',
  },driver.token)).status,403);
  assert.equal((await t.api('GET',`/api/ecu/handoffs/${handoff.id}`,
   undefined,replacement.token)).status,403,'unrelated driver is not original participant');
  assert.equal((await t.api('GET',`/api/ecu/handoffs/${handoff.id}`,
   undefined,owner.token)).status,200);
  assert.equal((await t.api('GET',`/api/ecu/handoffs/${handoff.id}`,
   undefined,expert.token)).status,200);
  ok(await t.api('POST',`/api/ecu/handoffs/${handoff.id}/notes`,{
   body:'Владелец сохраняет право продолжить выбранную техническую передачу',
  },owner.token));
  const updated=await t.db.one<{n:number}>(
   "select count(*)::int n from notifications where user_id=$1 and kind='ecu_handoff'",
   [driver.id]);
  assert.equal(updated?.n,baseline?.n,'private notes must not ping the former driver');
  assert.equal((await t.db.query('select id from payments where order_id=$1',[order.id])).length,0,
   'technical handoff never creates a payment');
 }finally{await t.close();}
});
