import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';

let t:T,admin:any,client:any,other:any,productId:string,orderId:string;
before(async()=>{
 t=await setup();
 admin=await t.login('+79990000001');
 client=await t.login('+79993331111');
 other=await t.login('+79993331112');
 ok(await t.api('PUT','/api/shop/region',{city:'Санкт-Петербург'},client.token));
 ok(await t.api('PUT','/api/admin/settings/shop',{enabled:true,delivery:true},admin.token));
 productId=ok(await t.api('POST','/api/admin/shop/products',
   {name:'Тестовый датчик давления',category:'sensors',price:100_000,stock:10},admin.token)).id;
});
after(()=>t.close());

test('default markup 30% on purchase cost, unrelated to the 5% service commission',async()=>{
 const path='/api/admin/shop/products/'+productId+'/costing';
 assert.equal((await t.api('PUT',path,{purchaseCostKopecks:100000,markupBps:1500,
   costSourceNote:'Подтвержденная закупочная цена от поставщика'},admin.token)).status,400);
 const normal=ok(await t.api('PUT',path,{purchaseCostKopecks:100000,markupBps:3000,
   costSourceNote:'Подтверждение цены Автоконтинента по накладной'},admin.token));
 assert.equal(normal.retailPriceKopecks,130000);
 assert.equal(normal.platformCommissionBps,500);
 assert.equal(normal.platformFeeIncluded,false);
 assert.equal((await t.api('PUT','/api/admin/shop/products/'+productId,{price:120000},admin.token)).status,409);
 const exception=ok(await t.api('PUT',path,{purchaseCostKopecks:100000,markupBps:2500,
   costSourceNote:'Подтвержденная закупка по накладной от дистрибьютора',
   exceptionReason:'Конкурентная цена на тот же артикул и сопоставимый срок получения',
   competitorComparison:'На складе другого магазина тот же артикул завтра',
   competitorEtaDays:1},admin.token));
 assert.equal(exception.retailPriceKopecks,125000);
 const search=ok(await t.api('GET','/api/shop/search?q=Тестовый',undefined,client.token));
 assert.equal(search.items.find((x:any)=>x.id===productId).price,125000);
});

test('confirmed purchase cost is snapshotted and 5% fee cannot be called parts margin',async()=>{
 const order=ok(await t.api('POST','/api/shop/orders',{
   items:[{productId,qty:2}],delivery:'delivery',
   address:'Санкт-Петербург, тестовый адрес 7'},client.token));
 orderId=order.id;
 assert.equal(order.goodsTotal,250000);
 assert.equal(order.total,order.goodsTotal+order.deliveryPrice);
 const a=ok(await t.api('GET','/api/admin/shop/orders/'+orderId+'/cost-analysis',undefined,admin.token));
 assert.equal(a.verifiedProcurementTotalKopecks,200000);
 assert.equal(a.grossTradingMarkupKopecks,50000);
 assert.equal(a.platformCommissionEstimateKopecks,12500);
 assert.equal(a.commissionActuallyChargedKopecks,0);
 assert.equal(a.profitVerified,false);
 assert.equal((await t.api('GET','/api/admin/shop/orders/'+orderId+'/cost-analysis',undefined,client.token)).status,403);
});

test('supplier events are visible in customer order but do not silently cancel/refund',async()=>{
 const path='/api/admin/shop/orders/'+orderId+'/supplier-events';
 const date=new Date('2026-11-16T14:00:00Z');
 assert.equal((await t.api('POST',path,{status:'accepted',rawStatus:'Принят',
   sourceEvidence:'Скриншот статуса',eventTime:date.toISOString()},client.token)).status,403);
 const first=ok(await t.api('POST',path,{status:'accepted',rawStatus:'Принят',
   sourceEvidence:'Проверили заказ в кабинете Автоконтинента',
   eventExternalId:'test-event-001',eventTime:date.toISOString()},admin.token));
 assert.equal(first.orderStatusChanged,false);
 ok(await t.api('POST',path,{status:'assembling',rawStatus:'Сборка',
   sourceEvidence:'Проверено оператором в кабинете поставщика',
   eventTime:new Date(date.getTime()+1000).toISOString()},admin.token));
 const clientView=ok(await t.api('GET','/api/shop/orders/'+orderId+'/supplier-status',undefined,client.token));
 assert.equal(clientView.status,'assembling');
 assert.equal(clientView.history.length,2);
 assert.equal(clientView.supplierApiConnected,false);
 assert.equal((await t.api('GET','/api/shop/orders/'+orderId+'/supplier-status',undefined,other.token)).status,404);
 const list=ok(await t.api('GET','/api/shop/orders',undefined,client.token));
 assert.equal(list.find((x:any)=>x.id===orderId).supplierProgress.status,'assembling');
 const cancelled=ok(await t.api('POST',path,{status:'cancelled',rawStatus:'Отменён',
   sourceEvidence:'Заказ отменен без комментария в кабинете поставщика',
   eventTime:new Date(date.getTime()+2000).toISOString()},admin.token));
 assert.equal(cancelled.refundConfirmed,false);
 assert.equal(cancelled.reasonProvided,false);
 const after=ok(await t.api('GET','/api/shop/orders/'+orderId+'/supplier-status',undefined,client.token));
 assert.equal(after.status,'cancelled');
 assert.equal(after.reasonProvided,false);
 const orders=ok(await t.api('GET','/api/shop/orders',undefined,client.token));
 assert.equal(orders.find((x:any)=>x.id===orderId).status,'new');
 assert.equal((await t.api('GET',path,undefined,other.token)).status,403);
});
