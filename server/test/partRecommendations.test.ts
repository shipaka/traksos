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
 }finally{await t.close();}
});
