import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';

let t:T,admin:any,driver:any,client1:any,client2:any,outsider:any;
let order1:string,order2:string,runId:string,itemId:string,stops:any[];

before(async()=>{
 t=await setup();
 admin=await t.login('+79990000001');
 driver=await t.login('+79993332220');
 client1=await t.login('+79993332221');
 client2=await t.login('+79993332222');
 outsider=await t.login('+79993332223');
 for(const u of [client1,client2])ok(await t.api('PUT','/api/shop/region',{city:'Санкт-Петербург'},u.token));
 ok(await t.api('PUT','/api/admin/settings/shop',{enabled:true,delivery:true},admin.token));
 itemId=ok(await t.api('POST','/api/admin/shop/products',{
   name:'Позиция тестовой доставки',category:'sensors',price:110000,stock:5
 },admin.token)).id;
 ok(await t.api('PUT','/api/admin/shop/products/'+itemId+'/costing',{
   purchaseCostKopecks:50000,markupBps:3000,
   costSourceNote:'Тестовый подтверждённый закупочный счёт дистрибьютора'
 },admin.token));
 order1=ok(await t.api('POST','/api/shop/orders',{
   items:[{productId:itemId,qty:1}],delivery:'delivery',address:'Санкт-Петербург, тестовая улица 1'
 },client1.token)).id;
 order2=ok(await t.api('POST','/api/shop/orders',{
   items:[{productId:itemId,qty:1}],delivery:'delivery',address:'Санкт-Петербург, тестовая улица 2'
 },client2.token)).id;
 for(const oid of [order1,order2]){
   ok(await t.api('POST','/api/admin/shop/orders/'+oid+'/status',{status:'confirmed'},admin.token));
   ok(await t.api('POST','/api/admin/shop/orders/'+oid+'/status',{status:'ready'},admin.token));
 }
});
after(()=>t.close());

test('buyer tracking starts with an honest awaiting-assignment state; other buyers get 404',async()=>{
 const own=ok(await t.api('GET','/api/shop/orders/'+order1+'/courier',undefined,client1.token));
 assert.equal(own.status,'awaiting_assignment');
 assert.equal(own.live,false);
 assert.equal(own.location,null);
 assert.equal(own.etaMinutes,null);
 assert.equal((await t.api('GET','/api/shop/orders/'+order2+'/courier',undefined,client1.token)).status,404);
 assert.equal((await t.api('GET','/api/shop/orders/'+order1+'/courier',undefined,outsider.token)).status,404);
 const timeline=ok(await t.api('GET','/api/shop/orders/'+order1+'/delivery-history',undefined,client1.token));
 assert.deepEqual(timeline.events,[]);
});

test('courier role admin-only, not self-registering or regular cargo carrier',async()=>{
 assert.equal((await t.api('GET','/api/courier/runs',undefined,driver.token)).status,403);
 assert.equal((await t.api('POST','/api/admin/shop/couriers',
   {userId:driver.id,displayName:'Курьер тест'},client1.token)).status,403);
 assert.equal((await t.api('POST','/api/admin/shop/couriers',
   {userId:client1.id,displayName:'Нельзя перевести клиента с заказами'},admin.token)).status,409);
 ok(await t.api('POST','/api/admin/shop/couriers',
   {userId:driver.id,displayName:'Курьер тест',vehicleLabel:'Малотоннажный автомобиль'},admin.token));
 const me=ok(await t.api('GET','/api/me',undefined,driver.token));
 assert.ok(me.roles.includes('courier'));
 assert.ok(!me.roles.includes('master') && !me.roles.includes('driver'));
 const courierProfile=ok(await t.api('GET','/api/courier/profile',undefined,driver.token));
 assert.equal(courierProfile.displayName,'Курьер тест');
 assert.equal(courierProfile.locationConsent,false);
 assert.equal((await t.api('GET','/api/courier/profile',undefined,client1.token)).status,403);
});

test('dispatch requires verified SPb delivery addresses and never assigns unverified goods',async()=>{
 assert.equal((await t.api('POST','/api/admin/shop/courier-runs',{
   courierId:driver.id,pickupAddress:'Санкт-Петербург, тестовый склад 1',orderIds:[order1,order2]
 },admin.token)).status,409);
 assert.equal((await t.api('POST','/api/admin/shop/delivery-addresses/'+order1+'/verify',{
   cityCode:'moscow',evidence:'Район указан в заказе'},admin.token)).status,400);
 for(const oid of [order1,order2]){
   assert.equal((await t.api('POST','/api/admin/shop/delivery-addresses/'+oid+'/verify',{
     cityCode:'spb',evidence:'Адрес проверен по заявке и карте Санкт-Петербурга'
   },client1.token)).status,403);
   ok(await t.api('POST','/api/admin/shop/delivery-addresses/'+oid+'/verify',{
     cityCode:'spb',evidence:'Адрес проверен по заявке и карте Санкт-Петербурга'
   },admin.token));
 }
 const run=ok(await t.api('POST','/api/admin/shop/courier-runs',{
   courierId:driver.id,pickupAddress:'Санкт-Петербург, тестовый склад 1',orderIds:[order1,order2]
 },admin.token));
 runId=run.id;
 assert.equal((await t.api('POST','/api/admin/shop/courier-runs',{
   courierId:driver.id,pickupAddress:'Санкт-Петербург, тестовый склад 1',
   orderIds:[order1]
 },admin.token)).status,409,'нельзя создать второй рейс для одного курьера');
 assert.equal((await t.api('GET','/api/courier/runs/'+runId,undefined,driver.token)).status,404,
   'неутверждённый рейс курьеру не доступен');
 assert.equal((await t.api('POST','/api/courier/runs/'+runId+'/accept',{},driver.token)).status,404);
 const budgetPath='/api/admin/shop/courier-runs/'+runId+'/budget';
 assert.equal((await t.api('POST','/api/admin/shop/courier-runs/'+runId+'/approve-dispatch',{},admin.token)).status,409,
   'без проверенной сметы рейс не выпускается');
 let forecast=ok(await t.api('PUT',budgetPath,{
   courierPayKopecks:300000,fuelKopecks:20000,packingKopecks:2000,
   acquiringKopecks:3000,taxesKopecks:3000,otherKopecks:1000,
   note:'Пессимистичный бюджет тестового рейса до оптимизации'
 },admin.token));
 assert.equal(forecast.profitable,false);
 assert.equal((await t.api('POST','/api/admin/shop/courier-runs/'+runId+'/approve-dispatch',
   {},admin.token)).status,409,'убыточный рейс не отправляется без явного решения');
 forecast=ok(await t.api('PUT',budgetPath,{
   courierPayKopecks:40000,fuelKopecks:20000,packingKopecks:2000,
   acquiringKopecks:3000,taxesKopecks:3000,otherKopecks:1000,
   note:'Расчёт на два заказа и общий рейс, затраты проверены'
 },admin.token));
 assert.equal(forecast.profitable,true);
 assert.equal(forecast.platformCommissionBookedKopecks,0,
   'потенциальные 5% не включаются в прибыль запчастей');
 ok(await t.api('POST','/api/admin/shop/courier-runs/'+runId+'/approve-dispatch',
   {},admin.token));
 const info=ok(await t.api('GET','/api/courier/runs/'+runId,undefined,driver.token));
 stops=info.stops;
 assert.equal(stops.length,2);
 assert.equal(info.activeStopId,null,'до выезда нет активной остановки');
 assert.equal(stops[0].items[0].name,'Позиция тестовой доставки');
 assert.equal(stops[0].items[0].qty,1);
 assert.ok(!('price' in stops[0].items[0])&&!('inStock' in stops[0].items[0]),
   'курьеру виден товар и количество, не розничная цена и закупка');
 assert.equal((await t.api('GET','/api/courier/runs/'+runId,undefined,client1.token)).status,403);
 assert.equal((await t.api('GET','/api/courier/runs/'+runId,undefined,outsider.token)).status,403);
 assert.equal((await t.api('GET','/api/shop/orders/'+order2+'/courier',undefined,client1.token)).status,404);
});

test('courier consent + stop-by-stop GPS, customer signs handoff, last fix is erased on route switch',async()=>{
 ok(await t.api('POST','/api/courier/runs/'+runId+'/accept',{},driver.token));
 for(const stop of stops)ok(await t.api('POST','/api/courier/runs/'+runId+'/stops/'+stop.id+'/collect',{},driver.token));
 ok(await t.api('POST','/api/courier/runs/'+runId+'/start',{},driver.token));
 assert.equal(ok(await t.api('GET','/api/courier/runs/'+runId,undefined,driver.token)).activeStopId,stops[0].id);
 assert.equal((await t.api('PUT','/api/courier/runs/'+runId+'/position',{
   lat:59.9,lng:30.3,accuracyMeters:20},driver.token)).status,403);
 ok(await t.api('PUT','/api/courier/location-consent',{enabled:true},driver.token));
 ok(await t.api('PUT','/api/courier/runs/'+runId+'/position',{
   lat:59.9,lng:30.3,accuracyMeters:20},driver.token));
 let one=ok(await t.api('GET','/api/shop/orders/'+order1+'/courier',undefined,client1.token));
 let two=ok(await t.api('GET','/api/shop/orders/'+order2+'/courier',undefined,client2.token));
 assert.equal(one.live,true);
 assert.equal(two.live,false);
 assert.ok(!('stops' in one)&&!('customerPhone' in one)&&!('otherAddress' in one));
 assert.equal((await t.api('POST','/api/courier/runs/'+runId+'/stops/'+stops[1].id+'/arrive',
   {},driver.token)).status,409,'cannot serve another customer before current stop');
 ok(await t.api('POST','/api/courier/runs/'+runId+'/stops/'+stops[0].id+'/arrive',{},driver.token));
 assert.equal((await t.api('POST','/api/shop/orders/'+order1+'/confirm-delivery',
   {},client2.token)).status,404);
 assert.equal((await t.api('POST','/api/shop/orders/'+order1+'/confirm-delivery',
   {},client1.token)).status,409,'arrival alone cannot prove handoff');
 assert.equal((await t.api('POST','/api/shop/orders/'+order1+'/delivery-code',
   {},client2.token)).status,404,'other buyer cannot issue the code');
 const firstCode=ok(await t.api('POST','/api/shop/orders/'+order1+'/delivery-code',{},client1.token));
 assert.match(firstCode.code,/^\d{6}$/);
 assert.equal((await t.api('POST','/api/courier/runs/'+runId+'/stops/'+stops[1].id+
   '/verify-handoff',{code:firstCode.code},driver.token)).status,409);
 assert.equal((await t.api('POST','/api/courier/runs/'+runId+'/stops/'+stops[0].id+
   '/verify-handoff',{code:'wrong'},driver.token)).status,400);
 assert.equal((await t.api('POST','/api/courier/runs/'+runId+'/stops/'+stops[0].id+
   '/verify-handoff',{code:firstCode.code==='999999'?'000000':'999999'},driver.token)).status,409);
 const proof=await t.db.one<{attempts:number;code_hash:string}>(
   'select attempts,code_hash from shop_delivery_handoffs where stop_id=$1',[stops[0].id]);
 assert.equal(proof?.attempts,1,'wrong code must consume one attempt even if the API returns 409');
 assert.ok(proof?.code_hash&&proof.code_hash!==firstCode.code,'raw code must not persist');
 ok(await t.api('POST','/api/courier/runs/'+runId+'/stops/'+stops[0].id+
   '/verify-handoff',{code:firstCode.code},driver.token));
 assert.equal((await t.api('POST','/api/courier/runs/'+runId+'/stops/'+stops[0].id+
   '/verify-handoff',{code:firstCode.code},driver.token)).status,409,'code cannot be reused');
 assert.equal(ok(await t.api('GET','/api/shop/orders/'+order1+'/courier',undefined,client1.token)).handoffVerified,true);
 ok(await t.api('POST','/api/shop/orders/'+order1+'/confirm-delivery',{},client1.token));
 const secondLeg=ok(await t.api('GET','/api/courier/runs/'+runId,undefined,driver.token));
 assert.equal(secondLeg.activeStopId,stops[1].id);
 assert.equal(secondLeg.stops[0].recipientName,null,'после вручения имя прежнего получателя больше не раскрывается');
 assert.equal(secondLeg.stops[0].address,null,'адрес прежнего получателя скрыт');
 one=ok(await t.api('GET','/api/shop/orders/'+order1+'/courier',undefined,client1.token));
 two=ok(await t.api('GET','/api/shop/orders/'+order2+'/courier',undefined,client2.token));
 assert.equal(one.live,false);
 assert.equal(two.live,false,'location from first recipient must not leak into second leg');
 ok(await t.api('PUT','/api/courier/runs/'+runId+'/position',{
   lat:59.8,lng:30.4,accuracyMeters:15},driver.token));
 two=ok(await t.api('GET','/api/shop/orders/'+order2+'/courier',undefined,client2.token));
 assert.equal(two.live,true);
 ok(await t.api('PUT','/api/courier/location-consent',{enabled:false},driver.token));
 assert.equal((await t.api('PUT','/api/courier/runs/'+runId+'/position',{
   lat:59.8,lng:30.4,accuracyMeters:15},driver.token)).status,403,
   'после отзыва согласия координаты повторно записывать нельзя');
 assert.equal(ok(await t.api('GET','/api/shop/orders/'+order2+'/courier',
   undefined,client2.token)).live,false);
 ok(await t.api('PUT','/api/courier/location-consent',{enabled:true},driver.token));
 ok(await t.api('POST','/api/courier/runs/'+runId+'/stops/'+stops[1].id+'/arrive',{},driver.token));
 assert.equal((await t.api('POST','/api/shop/orders/'+order2+'/confirm-delivery',{},client2.token)).status,409);
 const secondCode=ok(await t.api('POST','/api/shop/orders/'+order2+'/delivery-code',{},client2.token));
 assert.equal((await t.api('POST','/api/shop/orders/'+order2+'/delivery-code',{},client2.token)).status,409,
   'new buyer PIN must not be reissued immediately');
 const verifySecond='/api/courier/runs/'+runId+'/stops/'+stops[1].id+'/verify-handoff';
 const incorrect=secondCode.code==='000000'?'999999':'000000';
 for(let i=0;i<5;i++)assert.equal(
   (await t.api('POST',verifySecond,{code:incorrect},driver.token)).status,409);
 assert.equal((await t.api('POST',verifySecond,{code:secondCode.code},driver.token)).status,409,
   'even correct PIN is locked out after five invalid tries');
 assert.equal((await t.db.one<{attempts:number}>('select attempts from shop_delivery_handoffs where stop_id=$1',
   [stops[1].id]))?.attempts,5);
 await t.db.query("update shop_delivery_handoffs set issued_at=now()-interval '31 seconds' where stop_id=$1",
   [stops[1].id]);
 const replacement=ok(await t.api('POST','/api/shop/orders/'+order2+'/delivery-code',{},client2.token));
 assert.equal((await t.db.one<{attempts:number}>('select attempts from shop_delivery_handoffs where stop_id=$1',
   [stops[1].id]))?.attempts,0,'new PIN resets attempt counter');
 ok(await t.api('POST',verifySecond,{code:replacement.code},driver.token));
 ok(await t.api('POST','/api/shop/orders/'+order2+'/confirm-delivery',{},client2.token));
 two=ok(await t.api('GET','/api/shop/orders/'+order2+'/courier',undefined,client2.token));
 assert.equal(two.live,false);
 assert.equal((await t.db.query('select * from shop_courier_live_positions where run_id=$1',[runId])).length,0);
 const history=ok(await t.api('GET','/api/shop/orders/'+order1+'/delivery-history',undefined,client1.token)).events;
 assert.equal(history[0].status,'planned');
 assert.equal(history[history.length-1].status,'delivered');
 assert.ok(history.some((x:any)=>x.status==='arrived'));
 assert.equal((await t.api('GET','/api/shop/orders/'+order2+'/delivery-history',undefined,client1.token)).status,404,
   'другой покупатель не видит чужой трек доставки');
});


test('admin cannot overwrite orders in courier route; cancelled planned route releases reservations safely',async()=>{
 const third=ok(await t.api('POST','/api/shop/orders',{
   items:[{productId:itemId,qty:1}],delivery:'delivery',
   address:'Санкт-Петербург, тестовая улица 11'},client1.token)).id;
 ok(await t.api('POST','/api/admin/shop/orders/'+third+'/status',{status:'confirmed'},admin.token));
 ok(await t.api('POST','/api/admin/shop/orders/'+third+'/status',{status:'ready'},admin.token));
 ok(await t.api('POST','/api/admin/shop/delivery-addresses/'+third+'/verify',{
   cityCode:'spb',evidence:'Адрес в СПб подтверждён оператором склада'
 },admin.token));
 const created=ok(await t.api('POST','/api/admin/shop/courier-runs',{
   courierId:driver.id,pickupAddress:'Санкт-Петербург, склад тестовый, 1',orderIds:[third]
 },admin.token));
 assert.equal((await t.api('POST','/api/admin/shop/orders/'+third+'/status',
   {status:'cancelled',note:'Покупатель просил отменить'},admin.token)).status,409);
 assert.equal((await t.api('POST','/api/admin/shop/courier-runs/'+created.id+'/cancel',
   {reason:'коротко'},admin.token)).status,400);
 const cancelled=ok(await t.api('POST','/api/admin/shop/courier-runs/'+created.id+'/cancel',
   {reason:'Клиент отменил заявку до назначения курьера и забора груза'},admin.token));
 assert.equal(cancelled.releasedOrders,1);
 assert.equal(cancelled.status,'cancelled');
 assert.equal((await t.api('POST','/api/admin/shop/courier-runs/'+created.id+'/cancel',
   {reason:'Повторная попытка отменить уже отменённый курьерский маршрут'},admin.token)).status,409);
 const finished=ok(await t.api('POST','/api/admin/shop/orders/'+third+'/status',
   {status:'cancelled',note:'По просьбе клиента'},admin.token));
 assert.equal(finished.status,'cancelled');
 assert.equal((await t.api('POST','/api/admin/shop/orders/'+third+'/status',
   {status:'cancelled'},admin.token)).status,409);
});

test('new supplier cancellation after route approval blocks courier acceptance and pickup',async()=>{
 const fourth=ok(await t.api('POST','/api/shop/orders',{
   items:[{productId:itemId,qty:1}],delivery:'delivery',
   address:'Санкт-Петербург, тестовая улица 12'},client2.token)).id;
 ok(await t.api('POST','/api/admin/shop/orders/'+fourth+'/status',{status:'confirmed'},admin.token));
 ok(await t.api('POST','/api/admin/shop/orders/'+fourth+'/status',{status:'ready'},admin.token));
 ok(await t.api('POST','/api/admin/shop/delivery-addresses/'+fourth+'/verify',{
   cityCode:'spb',evidence:'Ручная сверка адреса четвёртого заказа в Санкт-Петербурге'
 },admin.token));
 const route=ok(await t.api('POST','/api/admin/shop/courier-runs',{
   courierId:driver.id,pickupAddress:'Санкт-Петербург, склад тестовый, 1',
   orderIds:[fourth]
 },admin.token));
 ok(await t.api('PUT','/api/admin/shop/courier-runs/'+route.id+'/budget',{
   courierPayKopecks:1000,fuelKopecks:1000,packingKopecks:300,
   acquiringKopecks:300,taxesKopecks:300,otherKopecks:300,
   note:'Обоснованная смета короткого тестового маршрута'
 },admin.token));
 ok(await t.api('POST','/api/admin/shop/courier-runs/'+route.id+'/approve-dispatch',
   {},admin.token));
 ok(await t.api('POST','/api/admin/shop/orders/'+fourth+'/supplier-events',{
   status:'cancelled',rawStatus:'Отмена без объяснения причин',
   eventTime:new Date().toISOString(),
   sourceEvidence:'Сверили отмену на стороне поставщика: причина не указана'
 },admin.token));
 assert.equal((await t.api('POST','/api/courier/runs/'+route.id+'/accept',
   {},driver.token)).status,409);
 const removed=ok(await t.api('POST','/api/admin/shop/courier-runs/'+route.id+'/cancel',
   {reason:'Автоконтинент отменил заказ до передачи курьеру, маршрут расформирован'},admin.token));
 assert.equal(removed.releasedOrders,1);
 assert.equal((await t.api('GET','/api/courier/runs/'+route.id,undefined,driver.token)).status,404);
});


test('failed delivery cannot be marked delivered; warehouse return releases order for a new run without fake refund',async()=>{
 const order=ok(await t.api('POST','/api/shop/orders',{
   items:[{productId:itemId,qty:1}],delivery:'delivery',
   address:'Санкт-Петербург, тестовая улица 13'},client1.token)).id;
 ok(await t.api('POST','/api/admin/shop/orders/'+order+'/status',{status:'confirmed'},admin.token));
 ok(await t.api('POST','/api/admin/shop/orders/'+order+'/status',{status:'ready'},admin.token));
 ok(await t.api('POST','/api/admin/shop/delivery-addresses/'+order+'/verify',{
   cityCode:'spb',evidence:'Проверили адрес пятого заказа для повторной доставки'
 },admin.token));
 const newRun=ok(await t.api('POST','/api/admin/shop/courier-runs',{
   courierId:driver.id,pickupAddress:'Санкт-Петербург, центральный склад 1',orderIds:[order]
 },admin.token));
 ok(await t.api('PUT','/api/admin/shop/courier-runs/'+newRun.id+'/budget',{
   courierPayKopecks:1000,fuelKopecks:1000,packingKopecks:300,
   acquiringKopecks:300,taxesKopecks:300,otherKopecks:300,
   note:'Полная смета возвратного рейса с запасом под неудачное вручение'
 },admin.token));
 ok(await t.api('POST','/api/admin/shop/courier-runs/'+newRun.id+'/approve-dispatch',
   {},admin.token));
 const stop=ok(await t.api('GET','/api/courier/runs/'+newRun.id,undefined,driver.token)).stops[0];
 ok(await t.api('POST','/api/courier/runs/'+newRun.id+'/accept',{},driver.token));
 ok(await t.api('POST','/api/courier/runs/'+newRun.id+'/stops/'+stop.id+'/collect',{},driver.token));
 ok(await t.api('POST','/api/courier/runs/'+newRun.id+'/start',{},driver.token));
 const failed=ok(await t.api('POST',
   '/api/courier/runs/'+newRun.id+'/stops/'+stop.id+'/report-failure',{
     reason:'Получатель не открыл складские ворота и не отвечает на звонки'
   },driver.token));
 assert.equal(failed.status,'failed');
 assert.equal(failed.runStatus,'returning');
 assert.equal((await t.api('POST','/api/admin/shop/courier-runs',{
   courierId:driver.id,pickupAddress:'Санкт-Петербург, центральный склад 1',
   orderIds:[order]
 },admin.token)).status,409,'в период возврата курьер занят');
 assert.equal((await t.api('POST','/api/shop/orders/'+order+'/confirm-delivery',
   {},client1.token)).status,409,'клиент не подтверждает не состоявшуюся доставку');
 assert.equal((await t.api('POST','/api/courier/runs/'+newRun.id+'/stops/'+stop.id+'/arrive',
   {},driver.token)).status,409,'после неудачного вручения нет фиктивного прибытия');
 const visible=ok(await t.api('GET','/api/shop/orders/'+order+'/courier',undefined,client1.token));
 assert.equal(visible.status,'failed');
 assert.equal(visible.live,false);
 assert.equal((await t.api('POST','/api/admin/shop/courier-runs/'+newRun.id+'/cancel',{
   reason:'Попытка тихой отмены при наличии не возвращённой посылки'},admin.token)).status,409);
 assert.equal((await t.api('POST','/api/admin/shop/courier-runs/'+newRun.id+'/confirm-warehouse-return',{
   evidence:'Короткая подпись'},admin.token)).status,400);
 const result=ok(await t.api('POST','/api/admin/shop/courier-runs/'+newRun.id+'/confirm-warehouse-return',{
   evidence:'Посылка возвращена физически на склад, номер пломбы и состав сверены кладовщиком'
 },admin.token));
 assert.equal(result.returnedCount,1);
 assert.equal(result.refundAutomaticallyCompleted,false);
 assert.equal(ok(await t.api('GET','/api/shop/orders',undefined,client1.token))
   .find((x:any)=>x.id===order).status,'ready');
 const newAssignment=ok(await t.api('POST','/api/admin/shop/courier-runs',{
   courierId:driver.id,pickupAddress:'Санкт-Петербург, центральный склад 1',orderIds:[order]
 },admin.token));
 assert.ok(newAssignment.id!==newRun.id,'повторный рейс возможен после подтверждения возврата');
 const deliveryHistory=ok(await t.api('GET','/api/shop/orders/'+order+'/delivery-history',undefined,client1.token)).events;
 assert.deepEqual(deliveryHistory.filter((x:any)=>['failed','returned','route_cancelled'].includes(x.status))
   .map((x:any)=>x.status),['failed','returned'],'история не пропадает после удаления остановки');
 assert.equal(deliveryHistory[deliveryHistory.length-1].status,'planned',
   'повторный маршрут фиксируется в той же истории исходного заказа');
 assert.equal((await t.api('GET','/api/shop/orders/'+order+'/delivery-history',undefined,client2.token)).status,404);
 assert.equal((await t.api('POST','/api/admin/shop/courier-runs/'+newRun.id+'/confirm-warehouse-return',{
   evidence:'Повторное неподтверждённое действие на закрытом рейсе'},admin.token)).status,409);
});
