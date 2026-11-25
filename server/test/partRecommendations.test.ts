import test from 'node:test';
import assert from 'node:assert/strict';
import { partRefsForCard, samePart } from '../src/domain/techbasePartRefs.ts';
import { TECHBASE_ILLUSTRATED } from '../src/domain/techbaseIllustrated.ts';
test('catalogue references are exact identities, not VIN matches',()=>{
 assert.equal(partRefsForCard('scania-r-check-valve')[0].article,'1912297');
 assert.equal(partRefsForCard('scania-r-pressure-limit')[0].article,'1914109');
 assert.equal(partRefsForCard('scania-r-air-reservoir').length,2);
 assert.equal(partRefsForCard('ebs-modulator').length,0);
 for(const c of TECHBASE_ILLUSTRATED)for(const ref of partRefsForCard(c.id)){
  assert.equal(ref.fitment,'unknown');assert.equal(new URL(ref.source).protocol,'https:');
 }
 assert.equal(samePart({brand:' Scania ',article:'1912297'},{brand:'SCANIA',article:'1912297'}),true);
 assert.equal(samePart({brand:'Scania',article:'1912297'},{brand:'Volvo',article:'1912297'}),false);
 assert.equal(samePart({brand:'Scania',article:'1912297'},{brand:'Scania',article:'19122970'}),false);
 assert.equal(samePart({brand:'Scania',article:'001-2'},{brand:'Scania',article:'0012'}),false);
});

import { setup,ok } from './helpers.ts';
import { PartRecommendations } from '../src/services/partRecommendations.ts';
test('repair recommendation is private, owner controlled, exact and idempotent through checkout',async()=>{
 const t=await setup();
 try{
  const admin=await t.login('+79990000001'),owner=await t.login('+79997808001'),master=await t.login('+79997808002','master'),other=await t.login('+79997808003');
  await t.db.query("update performer_profiles set verification='approved' where user_id=$1",[master.id]);
  const o=ok(await t.api('POST','/api/orders',{service:'consult',zoneId:'phone',brand:'Scania',description:'Диагностика клапана давления',paymentMethod:'cash'},owner.token)).order;
  await t.db.query("update orders set performer_id=$2,status='awaiting_confirmation' where id=$1",[o.id,master.id]);
  assert.equal((await t.api('GET','/api/techbase/parts/scania-r-check-valve',undefined,owner.token)).status,403);
  assert.equal(ok(await t.api('GET','/api/techbase/parts/scania-r-check-valve',undefined,master.token)).refs[0].article,'1912297');
  assert.equal(ok(await t.api('GET','/api/shop/exact-part?brand=Scania&article=1912297',undefined,master.token)).enabled,false);
  ok(await t.api('PUT','/api/admin/settings/shop',{enabled:true},admin.token));
  const product=ok(await t.api('POST','/api/admin/shop/products',{name:'Тестовый обратный клапан',category:'air',brand:'Scania',article:'1912297',price:120000,stock:3},admin.token));
  ok(await t.api('POST','/api/admin/shop/products',{name:'Другой производитель',category:'air',brand:'Other',article:'1912297',price:100000,stock:3},admin.token));
  assert.deepEqual(ok(await t.api('GET','/api/shop/exact-part?brand=Scania&article=1912297',undefined,master.token)).products.map((p:any)=>p.id),[product.id]);
  const path='/api/orders/'+o.id+'/part-recommendations';
  const proposal={brand:'Scania',article:'1912297',name:'Обратный клапан',qty:1,reason:'Подтверждена неисправность клапана',productId:product.id,cardId:'scania-r-check-valve',fitmentConfirmed:true};
  assert.equal((await t.api('POST',path,proposal,other.token)).status,403);
  const first=ok(await t.api('POST',path,proposal,master.token));
  assert.equal(first.created,true);
  assert.equal(ok(await t.api('POST',path,proposal,master.token)).created,false);
  const rid=first.item.id;
  assert.equal(Object.hasOwn(first.item,'tech_card_id'),false);
  assert.equal((await t.api('GET',path,undefined,other.token)).status,403);
  assert.equal((await t.api('POST',path+'/'+rid+'/decision',{accept:true},master.token)).status,403);
  assert.equal((await t.api('GET','/api/shop/part-recommendations/'+rid+'/checkout',undefined,owner.token)).status,403);
  const cart={items:[{productId:product.id,qty:1}],delivery:'pickup',partRecommendationId:rid,expectedPartPrice:120000};
  assert.equal((await t.api('POST','/api/shop/orders',cart,owner.token)).status,403);
  ok(await t.api('POST',path+'/'+rid+'/decision',{accept:true},owner.token));
  assert.equal((await t.db.query('select id from shop_orders where client_id=$1',[owner.id])).length,0);
  assert.equal(ok(await t.api('GET','/api/shop/part-recommendations',undefined,owner.token)).items[0].status,'accepted');
  assert.equal(ok(await t.api('GET','/api/shop/part-recommendations/'+rid+'/checkout',undefined,owner.token)).product.id,product.id);
  assert.equal((await t.api('POST','/api/shop/orders',{...cart,expectedPartPrice:1},owner.token)).status,409);
  const purchased=ok(await t.api('POST','/api/shop/orders',cart,owner.token));
  assert.equal(purchased.partRecommendationId,rid);
  assert.equal(ok(await t.api('POST','/api/shop/orders',cart,owner.token)).id,purchased.id);
  assert.equal((await t.db.one<any>('select stock from shop_products where id=$1',[product.id]))?.stock,2);

  // Independent missing article in the same assigned repair.
  const missing=ok(await t.api('POST',path,{...proposal,brand:'Fixture',article:'MISSING-42',name:'Тестовая деталь',productId:null,cardId:null},master.token)).item;
  const mid=missing.id, request='/api/shop/part-recommendations/'+mid+'/sourcing', queue='/api/admin/shop/part-sourcing', resolve=queue+'/'+mid+'/resolve';
  assert.equal((await t.api('POST',request,{},owner.token)).status,409);
  ok(await t.api('POST',path+'/'+mid+'/decision',{accept:true},owner.token));
  assert.equal((await t.api('POST',request,{},other.token)).status,404);
  assert.equal((await t.api('GET',queue,undefined,master.token)).status,403);
  assert.equal(ok(await t.api('POST',request,{},owner.token)).changed,true);
  assert.equal(ok(await t.api('POST',request,{},owner.token)).changed,false);
  assert.ok(ok(await t.api('GET',queue,undefined,admin.token)).items.some((x:any)=>x.id===mid));
  assert.equal(ok(await t.api('GET',queue+'/'+mid+'/candidates',undefined,admin.token)).products.length,0);
  assert.equal((await t.api('POST',resolve,{status:'resolved',productId:product.id},admin.token)).status,409);
  assert.equal(ok(await t.api('POST',resolve,{status:'unavailable',note:'Пока нет точного артикула'},admin.token)).item.sourcing_status,'unavailable');
  assert.equal(ok(await t.api('POST',request,{},owner.token)).changed,true);
  const exact=ok(await t.api('POST','/api/admin/shop/products',{name:'Точная тестовая деталь',category:'air',brand:'Fixture',article:'MISSING-42',price:22000,stock:2},admin.token));
  assert.deepEqual(ok(await t.api('GET',queue+'/'+mid+'/candidates',undefined,admin.token)).products.map((p:any)=>p.id),[exact.id]);
  assert.equal(ok(await t.api('POST',resolve,{status:'resolved',productId:exact.id},admin.token)).item.product_id,exact.id);
  assert.equal(ok(await t.api('POST',resolve,{status:'resolved',productId:exact.id},admin.token)).changed,false);
  assert.equal((await t.db.query('select id from shop_orders where part_recommendation_id=$1',[mid])).length,0);
  assert.equal((await t.db.one<any>('select stock from shop_products where id=$1',[exact.id]))?.stock,2);
  assert.equal(ok(await t.api('GET','/api/shop/part-recommendations/'+mid+'/checkout',undefined,owner.token)).product.id,exact.id);
  // Direct service calls retain the previously authenticated role snapshot.
  const ownerSnapshot=await t.app.auth.authenticate(owner.token),adminSnapshot=await t.app.auth.authenticate(admin.token);
  assert.ok(ownerSnapshot&&adminSnapshot);
  const svc=new PartRecommendations(t.db,t.app.settings,t.app.notifier);
  await t.db.query("update users set roles='{driver}'::text[] where id=$1",[owner.id]);
  await assert.rejects(svc.history(ownerSnapshot,null,0),{status:403});
  await assert.rejects(svc.checkout(ownerSnapshot,rid),{status:403});
  await assert.rejects(svc.requestSourcing(ownerSnapshot,mid),{status:403});
  await t.db.query("update users set roles='{client}'::text[],deleted_at=now() where id=$1",[owner.id]);
  await assert.rejects(svc.history(ownerSnapshot,null,0),{status:403});
  await t.db.query("update users set deleted_at=null where id=$1",[owner.id]);
  assert.equal((await svc.checkout(ownerSnapshot,rid)).order.id,purchased.id);
  await t.db.query("update users set roles='{moderator}'::text[] where id=$1",[admin.id]);
  await assert.rejects(svc.sourcingQueue(adminSnapshot,0,'resolved'),{status:403});
  await assert.rejects(svc.sourcingCandidates(adminSnapshot,mid),{status:403});
  await assert.rejects(svc.resolveSourcing(adminSnapshot,mid,{status:'resolved',productId:exact.id}),{status:403});
  await t.db.query("update users set roles='{admin}'::text[],deleted_at=now() where id=$1",[admin.id]);
  await assert.rejects(svc.sourcingQueue(adminSnapshot,0,'resolved'),{status:403});
  await t.db.query("update users set deleted_at=null where id=$1",[admin.id]);
  assert.ok((await svc.sourcingQueue(adminSnapshot,0,'resolved')).items.some((x:any)=>x.id===mid));

 }finally{await t.close();}
});

test('approved workshop shares recommendation history and sourcing without altering repair invoice',async()=>{
 const t=await setup();
 try{
  const owner=await t.login('+79997808101'),workshop=await t.login('+79997808102','service'),other=await t.login('+79997808103','service'),admin=await t.login('+79990000001');
  const vehicle=ok(await t.api('POST','/api/vehicles',{brand:'Scania',model:'R',year:2014,plate:'А401АА178'},owner.token));
  const center=ok(await t.api('PUT','/api/base',{name:'СТО для теста',address:'Санкт-Петербург, Московское шоссе, 20',staff:{air:'own'},accepts:['quick','long']},workshop.token)).center;
  ok(await t.api('POST','/api/admin/services/'+center.id+'/verify',{decision:'approved'},admin.token));
  const booking=ok(await t.api('POST','/api/services/'+center.id+'/book',{vehicleId:vehicle.id,need:'air',day:'2026-12-02',arrival:'self'},owner.token));
  const path='/api/bookings/'+booking.id+'/part-recommendations';
  const proposal={brand:'Fixture',article:'STO-42',name:'Тестовый клапан СТО',qty:1,reason:'Диагностика подтвердила неисправность клапана',productId:null,cardId:null,fitmentConfirmed:true};
  assert.equal((await t.api('POST',path,proposal,workshop.token)).status,409);
  assert.equal((await t.api('GET',path,undefined,other.token)).status,403);
  ok(await t.api('POST','/api/base/bookings/'+booking.id+'/respond',{action:'accept'},workshop.token));
  ok(await t.api('POST','/api/base/bookings/'+booking.id+'/status',{status:'diagnostics'},workshop.token));
  const initial=await t.db.one<any>('select amount,status from service_bookings where id=$1',[booking.id]);
  assert.equal(ok(await t.api('GET',path,undefined,workshop.token)).canSuggest,true);
  assert.equal(ok(await t.api('GET','/api/techbase?audience=master',undefined,workshop.token)).audiences.includes('master'),true);
  const first=ok(await t.api('POST',path,proposal,workshop.token));
  const rid=first.item.id;
  assert.equal(first.item.source_booking_id,booking.id);
  assert.equal(first.item.source_order_id,null);
  assert.equal(ok(await t.api('POST',path,proposal,workshop.token)).created,false);
  assert.equal((await t.api('POST',path+'/'+rid+'/decision',{accept:true},workshop.token)).status,403);
  ok(await t.api('POST',path+'/'+rid+'/decision',{accept:true},owner.token));
  const request='/api/shop/part-recommendations/'+rid+'/sourcing';
  assert.equal(ok(await t.api('POST',request,{},owner.token)).item.sourcing_status,'requested');
  assert.ok(ok(await t.api('GET','/api/shop/part-recommendations?vehicleId='+vehicle.id,undefined,owner.token)).items.some((x:any)=>x.id===rid&&x.source_booking_id===booking.id));
  const after=await t.db.one<any>('select amount,status from service_bookings where id=$1',[booking.id]);
  assert.deepEqual(after,initial);
  assert.equal((await t.db.query('select id from shop_orders where part_recommendation_id=$1',[rid])).length,0);
  await t.db.query("update service_centers set verification='rejected' where id=$1",[center.id]);
  assert.equal((await t.api('POST',path,{...proposal,article:'STO-43'},workshop.token)).status,403);
  assert.equal((await t.api('GET',path,undefined,workshop.token)).status,403);
  assert.equal(ok(await t.api('GET',path,undefined,owner.token)).items[0].id,rid);
  // Keep own historical records after a synthetic transfer; never initiate
  // sourcing or checkout on the transferred truck or read it by garage filter.
  const newOwner=await t.login('+79997808104');
  await t.db.query('update vehicles set owner_id=$2 where id=$1',[vehicle.id,newOwner.id]);
  assert.ok(ok(await t.api('GET','/api/shop/part-recommendations',undefined,owner.token)).items.some((x:any)=>x.id===rid));
  assert.equal((await t.api('GET','/api/shop/part-recommendations?vehicleId='+vehicle.id,undefined,owner.token)).status,403);
  assert.equal((await t.api('POST',request,{},owner.token)).status,403);
  assert.equal((await t.api('GET','/api/shop/part-recommendations/'+rid+'/checkout',undefined,owner.token)).status,403);
  assert.equal((await t.api('POST',request,{},newOwner.token)).status,404);
  assert.equal(ok(await t.api('GET','/api/shop/part-recommendations?vehicleId='+vehicle.id,undefined,newOwner.token)).items.length,0);

 }finally{await t.close();}
});

test('source ACL rechecks live fleet assignments, worker approval and stale actor roles',async()=>{
 const t=await setup();
 try{
  const owner=await t.login('+79997808201'),driver=await t.login('+79997808202'),replacement=await t.login('+79997808203'),master=await t.login('+79997808204','master'),admin=await t.login('+79990000001');
  const vehicle=ok(await t.api('POST','/api/vehicles',{brand:'Scania',model:'R',year:2014,plate:'А402АА178'},owner.token));
  const qr=ok(await t.api('GET','/api/fleet',undefined,owner.token)).cars[0].qrCode;
  ok(await t.api('POST','/api/qr/'+qr+'/join',{},driver.token));
  await t.db.query("update performer_profiles set verification='approved' where user_id=$1",[master.id]);
  const o=ok(await t.api('POST','/api/orders',{service:'consult',vehicleId:vehicle.id,description:'Тестовый подбор детали'},driver.token)).order;
  await t.db.query("update orders set performer_id=$2,status='awaiting_confirmation' where id=$1",[o.id,master.id]);
  const svc=new PartRecommendations(t.db,t.app.settings,t.app.notifier);
  const oldDriver=await t.app.auth.authenticate(driver.token),oldMaster=await t.app.auth.authenticate(master.token),oldOwner=await t.app.auth.authenticate(owner.token),oldAdmin=await t.app.auth.authenticate(admin.token);
  assert.ok(oldDriver&&oldMaster&&oldOwner&&oldAdmin);
  const path='/api/orders/'+o.id+'/part-recommendations';
  const proposal={brand:'Fixture',article:'ACL-42',name:'Тестовый клапан',qty:1,reason:'Диагностика подтвердила неисправность детали',fitmentConfirmed:true};
  const rec=ok(await t.api('POST',path,proposal,master.token)).item;
  assert.equal((await svc.list(oldDriver,o.id)).items[0].id,rec.id);
  assert.equal((await svc.list(oldDriver,o.id)).canDecide,false);
  assert.equal((await svc.list(oldAdmin,o.id)).canSuggest,false);
  assert.equal((await svc.list(oldAdmin,o.id)).canDecide,false);
  await assert.rejects(svc.decide(oldAdmin,o.id,rec.id,true),{status:403});
  ok(await t.api('POST','/api/qr/'+qr+'/join',{},replacement.token));
  await assert.rejects(svc.list(oldDriver,o.id),{status:403});
  assert.equal((await t.api('GET',path,undefined,driver.token)).status,403);
  assert.equal((await t.api('GET',path,undefined,replacement.token)).status,403);
  ok(await t.api('POST','/api/qr/'+qr+'/join',{},driver.token));
  assert.equal((await svc.list(oldDriver,o.id)).items[0].id,rec.id);
  await t.db.query("update users set roles='{service}'::text[] where id=$1",[master.id]);
  await assert.rejects(svc.list(oldMaster,o.id),{status:403});
  await assert.rejects(svc.propose(oldMaster,o.id,{...proposal,article:'REVOKED'}),{status:403});
  await t.db.query("update users set roles='{master}'::text[] where id=$1",[master.id]);
  await t.db.query("update performer_profiles set verification='rejected' where user_id=$1",[master.id]);
  await assert.rejects(svc.list(oldMaster,o.id),{status:403});
  await t.db.query("update performer_profiles set verification='approved' where user_id=$1",[master.id]);
  await t.db.query("update users set deleted_at=now() where id=$1",[master.id]);
  await assert.rejects(svc.propose(oldMaster,o.id,{...proposal,article:'DELETED'}),{status:403});
  await t.db.query("update users set deleted_at=null where id=$1",[master.id]);
  // An owner status update holds the same row lock needed by source ACL.
  // Start the stale-actor operation while the revocation is uncommitted;
  // after commit it must see the blocked row, not the prior active snapshot.
  let concurrentRead:Promise<unknown>|undefined;
  await t.db.tx(async q=>{
   await q.query("update users set status='blocked' where id=$1",[owner.id]);
   concurrentRead=svc.list(oldDriver,o.id).then(value=>({value}),error=>({error}));
  });
  assert.ok(concurrentRead);
  const concurrent=await concurrentRead as {value?:unknown;error?:{status:number}};
  assert.equal(concurrent.error?.status,403);
  await assert.rejects(svc.list(oldDriver,o.id),{status:403});
  await assert.rejects(svc.list(oldMaster,o.id),{status:403});
  await assert.rejects(svc.decide(oldOwner,o.id,rec.id,true),{status:403});
  assert.equal((await svc.list(oldAdmin,o.id)).items[0].status,'pending');
  await t.db.query("update users set status='active' where id=$1",[owner.id]);
  assert.equal((await svc.decide(oldOwner,o.id,rec.id,true)).status,'accepted');
  assert.equal((await t.db.query('select id from part_recommendations where source_order_id=$1',[o.id])).length,1);
 }finally{await t.close();}
});
