import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {setup,ok} from './helpers.ts';

const image=()=> 'data:image/jpeg;base64,'+
 Buffer.concat([Buffer.from([0xff,0xd8,0xff]),randomBytes(1800)]).toString('base64');

test('repair photos: an acknowledged upload can be retried after all 12 photo slots are used', {timeout:60000},async()=>{
 const t=await setup();
 try{
  const owner=await t.login('+79996568001');
  const worker=await t.login('+79996568002','master');
  const order=ok(await t.api('POST','/api/orders',{
   service:'electric',zoneId:'spb',description:'Фото ремонтной диагностики',
  },owner.token)).order;
  await t.db.query("update orders set performer_id=$2,status='accepted' where id=$1",
   [order.id,worker.id]);
  const url=`/api/orders/${order.id}/photos`;
  const first=image();
  const created=ok(await t.api('POST',url,{dataUrl:first},worker.token));
  for(let n=0;n<11;n++)
   ok(await t.api('POST',url,{dataUrl:image()},worker.token));
  assert.equal((await t.db.query('select id from order_photos where order_id=$1',
   [order.id])).length,12);
  const retry=ok(await t.api('POST',url,{dataUrl:first},worker.token));
  assert.equal(retry.id,created.id);
  assert.equal(retry.duplicate,true,'a lost ACK must not turn into photos_limit');
  assert.equal((await t.api('POST',url,{dataUrl:image()},worker.token)).status,409);
  assert.equal((await t.db.query('select id from order_photos where order_id=$1',
   [order.id])).length,12);
 }finally{await t.close();}
});

test('repair photos: revoked driver loses private file even when assigned to another car in same fleet', {timeout:60000},async()=>{
 const t=await setup();
 try{
  const owner=await t.login('+79996568101');
  const oldDriver=await t.login('+79996568102','driver');
  const worker=await t.login('+79996568103','master');
  const a=ok(await t.api('POST','/api/vehicles',{
   brand:'Scania',model:'R',year:2018,plate:'А332АА178'},owner.token));
  const b=ok(await t.api('POST','/api/vehicles',{
   brand:'Scania',model:'G',year:2019,plate:'А333АА178'},owner.token));
  const qr=ok(await t.api('GET','/api/fleet',undefined,owner.token))
   .cars.find((v:any)=>v.id===a.id)?.qrCode;
  assert.ok(qr);
  ok(await t.api('POST','/api/qr/'+qr+'/join',{},oldDriver.token));
  const order=ok(await t.api('POST','/api/orders',{
   service:'electric',isSos:true,vehicleId:a.id,zoneId:'spb',regionId:'spb',
   address:'Санкт-Петербург, КАД, тестовая остановка',lat:59.95,lng:30.35,
   problem:'no_start',description:'Стартер не крутит после остановки',
  },oldDriver.token)).order;
  await t.db.query("update orders set performer_id=$2,status='accepted' where id=$1",
   [order.id,worker.id]);
  const photo=ok(await t.api('POST',`/api/orders/${order.id}/photos`,
   {dataUrl:image()},worker.token));
  const listUrl=`/api/orders/${order.id}/photos`;
  const fileUrl=listUrl+'/'+photo.id+'/file';
  assert.equal((await t.api('GET',listUrl,undefined,oldDriver.token)).status,200);
  assert.equal((await t.api('GET',fileUrl,undefined,oldDriver.token)).status,200);
  ok(await t.api('POST',`/api/vehicles/${b.id}/driver`,{
   phone:'+79996568102'},owner.token));
  assert.equal((await t.db.one<{owner_id:string}>(
   'select owner_id from users where id=$1',[oldDriver.id]))?.owner_id,owner.id);
  assert.equal((await t.api('GET',listUrl,undefined,oldDriver.token)).status,403);
  assert.equal((await t.api('GET',fileUrl,undefined,oldDriver.token)).status,403);
  assert.equal((await t.api('GET',listUrl,undefined,owner.token)).status,200);
  assert.equal((await t.api('GET',fileUrl,undefined,worker.token)).status,200);
  assert.equal((await t.db.query('select id from order_photos where order_id=$1',
   [order.id])).length,1,'revocation never destroys owner evidence');
 }finally{await t.close();}
});
