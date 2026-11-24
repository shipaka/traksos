import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';

test('private order reviews follow live fleet and performer permissions, not historical ids', {timeout:60000},async()=>{
 const t=await setup();
 try{
  const owner=await t.login('+79996565101');
  const driver=await t.login('+79996565102','driver');
  const performer=await t.login('+79996565103','master');
  const outsider=await t.login('+79996565104','master');
  const admin=await t.login('+79990000001');
  const car=ok(await t.api('POST','/api/vehicles',{
   brand:'Scania',model:'R',year:2018,plate:'А651АА178',
  },owner.token));
  const fleet=ok(await t.api('GET','/api/fleet',undefined,owner.token));
  const qr=fleet.cars.find((v:any)=>v.id===car.id)?.qrCode;
  assert.ok(qr);
  ok(await t.api('POST',`/api/qr/${qr}/join`,{},driver.token));
  const order=await t.db.one<{id:string}>(
   "insert into orders(client_id,created_by,performer_id,vehicle_id,service,zone_id,status) "+
   "values ($1,$2,$3,$4,'electric','spb','completed') returning id",
   [owner.id,driver.id,performer.id,car.id]);
  assert.ok(order);
  const path=`/api/orders/${order.id}/reviews`;
  ok(await t.api('POST',`/api/orders/${order.id}/review`,{
   stars:5,text:'Проверка приватной истории ремонта',
  },driver.token));
  assert.equal(ok(await t.api('GET',path,undefined,driver.token)).mine.text,
   'Проверка приватной истории ремонта');
  assert.equal((await t.api('GET',path,undefined,outsider.token)).status,403);
  assert.equal((await t.api('GET',path,undefined,admin.token)).status,200);
  const other=ok(await t.api('POST','/api/vehicles',{
   brand:'Scania',model:'G',year:2019,plate:'А652АА178',
  },owner.token));
  ok(await t.api('POST',`/api/vehicles/${other.id}/driver`,{phone:'+79996565102'},owner.token));
  assert.equal((await t.api('GET',path,undefined,driver.token)).status,403);
  assert.equal((await t.api('POST',`/api/orders/${order.id}/review`,{stars:5},driver.token)).status,403);
  assert.equal((await t.api('GET',path,undefined,owner.token)).status,200);
  assert.equal((await t.api('GET',path,undefined,performer.token)).status,200);
  const review=await t.db.one<{id:string}>('select id from reviews where order_id=$1',[order.id]);
  assert.ok(review);
  assert.equal((await t.api('POST',`/api/admin/reviews/${review.id}`,{hidden:true},driver.token)).status,403);
  ok(await t.api('POST',`/api/admin/reviews/${review.id}`,{hidden:true},admin.token));
  await t.db.query('update orders set performer_id=$2 where id=$1',[order.id,outsider.id]);
  assert.equal((await t.api('GET',path,undefined,performer.token)).status,403);
  assert.equal((await t.api('GET',path,undefined,outsider.token)).status,200);
 }finally{await t.close();}
});

test('reviews reject stale staff authority and disabled participants within service transaction', {timeout:60000},async()=>{
 const t=await setup();
 try{
  const owner=await t.login('+79996565201');
  const master=await t.login('+79996565202','master');
  const admin=await t.login('+79990000001');
  const capture=async(id:string)=>{
   const row=await t.db.one<import('../src/http/router.ts').AuthUser>(
    'select id,phone,name,roles,status,owner_id from users where id=$1',[id]);
   assert.ok(row);return row;
  };
  const oldAdmin=await capture(admin.id),oldOwner=await capture(owner.id),oldMaster=await capture(master.id);
  const order=await t.db.one<{id:string}>(
   "insert into orders(client_id,created_by,performer_id,service,zone_id,status) "+
   "values ($1,$1,$2,'electric','spb','completed') returning id",[owner.id,master.id]);
  assert.ok(order);
  await t.app.reviews.leave(oldOwner,order.id,{stars:5});
  const review=await t.db.one<{id:string;hidden:boolean}>('select id,hidden from reviews where order_id=$1',[order.id]);
  assert.ok(review);
  await t.db.query("update users set roles=array['client']::text[] where id=$1",[admin.id]);
  const forbidden=(e:any)=>e?.status===403;
  await assert.rejects(t.app.reviews.forOrder(oldAdmin,order.id),forbidden);
  await assert.rejects(t.app.reviews.moderate(oldAdmin,review.id,{hidden:true}),forbidden);
  await t.db.query("update users set status='blocked' where id=$1",[master.id]);
  await assert.rejects(t.app.reviews.forOrder(oldMaster,order.id),forbidden);
  await assert.rejects(t.app.reviews.leave(oldMaster,order.id,{stars:5}),forbidden);
  await t.db.query("update users set deleted_at=now() where id=$1",[owner.id]);
  await assert.rejects(t.app.reviews.forOrder(oldOwner,order.id),forbidden);
  assert.equal((await t.db.one<{hidden:boolean}>('select hidden from reviews where id=$1',[review.id]))?.hidden,false);
  assert.equal((await t.db.query('select id from reviews where order_id=$1',[order.id])).length,1);
  await t.db.query("update users set roles=$2 where id=$1",[admin.id,oldAdmin.roles]);
  await t.app.reviews.moderate(oldAdmin,review.id,{hidden:true});
  assert.equal((await t.db.one<{hidden:boolean}>('select hidden from reviews where id=$1',[review.id]))?.hidden,true);
 }finally{await t.close();}
});
