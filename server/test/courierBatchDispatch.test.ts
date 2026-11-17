import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';

test('bulk auto-dispatch reserves only confirmed coordinate-ready parcels, atomically',async()=>{
 const t=await setup();
 try{
  const admin=await t.login('+79990000001');
  const other=await t.login('+79995558000','client');
  const drivers=[
   await t.login('+79995558001'),
   await t.login('+79995558002')
  ];
  const clients=[
   await t.login('+79995558003','client'),
   await t.login('+79995558004','client')
  ];
  ok(await t.api('PUT','/api/admin/settings/shop',{
   enabled:true,delivery:true
  },admin.token));
  for(const client of clients)
   ok(await t.api('PUT','/api/shop/region',{city:'Санкт-Петербург'},client.token));
  const itemId=ok(await t.api('POST','/api/admin/shop/products',{
   name:'Датчик маршрутов для тестирования',category:'sensors',price:110000,stock:20
  },admin.token)).id;
  ok(await t.api('PUT','/api/admin/shop/products/'+itemId+'/costing',{
   purchaseCostKopecks:50000,markupBps:3000,
   costSourceNote:'Первичный тестовый документ закупочной стоимости запчасти'
  },admin.token));
  for(const [i,u] of drivers.entries())
   ok(await t.api('POST','/api/admin/shop/couriers',{
    userId:u.id,displayName:'Курьер '+(i+1),vehicleLabel:'Фургон тест'
   },admin.token));
  const orders:string[]=[];
  const coordinates=[
   {lat:59.910,lng:30.31},{lat:59.935,lng:30.36},
   {lat:59.940,lng:30.33},{lat:59.920,lng:30.35}
  ];
  for(let i=0;i<5;i++){
   const u=clients[i%2];
   const order=ok(await t.api('POST','/api/shop/orders',{
    items:[{productId:itemId,qty:1}],delivery:'delivery',
    address:'Санкт-Петербург, маршрутная тестовая улица '+(i+1)
   },u.token));
   orders.push(order.id);
   for(const status of ['confirmed','ready'])
    ok(await t.api('POST','/api/admin/shop/orders/'+order.id+'/status',{
      status
    },admin.token));
   ok(await t.api('POST','/api/admin/shop/delivery-addresses/'+order.id+'/verify',{
    cityCode:'spb',evidence:'Тестовая физическая сверка города, адреса и координат',
    ...(i<4?coordinates[i]:{})
   },admin.token));
  }
  const input={
   courierIds:drivers.map(x=>x.id),maxStops:2,
   pickupAddress:'Санкт-Петербург, тестовый распределительный склад 1',
   pickupLat:59.9,pickupLng:30.3
  };
  assert.equal((await t.api('POST','/api/admin/shop/courier-dispatch/preview',
   input,other.token)).status,403);
  assert.equal((await t.api('POST','/api/admin/shop/courier-dispatch/preview',{
   ...input,courierIds:[drivers[0].id,drivers[0].id]
  },admin.token)).status,400);
  const first=ok(await t.api('POST','/api/admin/shop/courier-dispatch/preview',
   input,admin.token));
  assert.equal(first.batches.length,2);
  assert.equal(first.plannedOrders,4);
  assert.equal(first.eligibleScanned,4,'unverified GPS not silently geocoded');
  assert.ok(first.requiresApproval&&first.warehouseCheckRequired&&first.supplierReceiptRequired);
  assert.equal((await t.db.query('select id from shop_courier_runs')).length,0,
   'preview cannot reserve a customer or create a paid assignment');
  assert.equal((await t.api('POST','/api/admin/shop/courier-dispatch/create',{
   ...input,expectedSignature:first.signature,capacityConfirmed:false
  },admin.token)).status,400,'the operator must attest vehicle capacity');
  // Rechecking an address invalidates the preview even when ready status stays.
  ok(await t.api('POST','/api/admin/shop/delivery-addresses/'+orders[0]+'/verify',{
   cityCode:'spb',evidence:'Координаты исправлены после повторной проверки склада',
   lat:59.913,lng:30.312
  },admin.token));
  assert.equal((await t.api('POST','/api/admin/shop/courier-dispatch/create',{
   ...input,expectedSignature:first.signature,capacityConfirmed:true
  },admin.token)).status,409,'stale preview must not silently assign new addresses');
  assert.equal((await t.db.query('select id from shop_courier_runs')).length,0);
  const preview=ok(await t.api('POST','/api/admin/shop/courier-dispatch/preview',
   input,admin.token));
  assert.notEqual(preview.signature,first.signature);
  const made=ok(await t.api('POST','/api/admin/shop/courier-dispatch/create',{
   ...input,expectedSignature:preview.signature,capacityConfirmed:true
  },admin.token));
  assert.equal(made.draftRuns.length,2);
  assert.equal(made.plannedOrders,4);
  assert.equal(made.courierNotified,false);
  assert.equal(made.requiresManualFinancialApproval,true);
  const routes=made.draftRuns.map((x:any)=>x.id);
  const stops=await t.db.query<{run_id:string;shop_order_id:string;seq:number}>(
   'select run_id,shop_order_id,seq from shop_courier_stops order by run_id,seq');
  assert.equal(stops.length,4);
  assert.equal(new Set(stops.map(s=>s.shop_order_id)).size,4);
  assert.ok(!stops.some(s=>s.shop_order_id===orders[4]));
  for(const route of made.draftRuns){
   const details=await t.db.one<{dispatch_approved_at:Date|null;
    packing_required:boolean;supplier_receipt_required:boolean}>(
    'select dispatch_approved_at,packing_required,supplier_receipt_required '+ 
    'from shop_courier_runs where id=$1',[route.id]);
   assert.equal(details?.dispatch_approved_at,null);
   assert.equal(details?.packing_required,true);
   assert.equal(details?.supplier_receipt_required,true);
   const ordered=stops.filter(x=>x.run_id===route.id);
   assert.deepEqual(ordered.map(s=>s.seq),[1,2]);
   const driver=drivers.find(x=>x.id===route.courierId)!;
   assert.equal((await t.api('GET','/api/courier/runs/'+route.id,
    undefined,driver.token)).status,404,
    'draft must be invisible until financial and warehouse approval');
   assert.equal((await t.api('POST','/api/admin/shop/courier-runs/'+route.id+
    '/approve-dispatch',{},admin.token)).status,409);
  }
  const customer=ok(await t.api('GET','/api/shop/orders/'+orders[0]+'/courier',
   undefined,clients[0].token));
  assert.equal(customer.status,'awaiting_assignment',
   'unapproved route must not make a false promise to the customer');
  assert.equal(customer.live,false);
  assert.equal((await t.api('POST','/api/admin/shop/delivery-addresses/'+orders[0]+
   '/verify',{cityCode:'spb',evidence:'Повторная попытка подменить назначенный адрес',
    lat:59.91,lng:30.33},admin.token)).status,409,
    'a confirmed route must lock the address and coordinates');
  assert.equal((await t.api('POST','/api/admin/shop/courier-dispatch/create',{
   ...input,expectedSignature:preview.signature,capacityConfirmed:true
  },admin.token)).status,409,'retry cannot duplicate assignments');
  const total=await t.db.one<{n:number}>(
   'select count(*)::int as n from shop_courier_stops');
  assert.equal(total?.n,4,'failed retry must not create partial duplicate routes');
  assert.equal((await t.api('POST','/api/admin/shop/courier-dispatch/preview',
   input,admin.token)).status,409,'busy couriers cannot receive another batch');
  for(const routeId of routes){
   ok(await t.api('POST','/api/admin/shop/courier-runs/'+routeId+'/cancel',{
    reason:'Плановый тестовый рейс отменён до выдачи со склада'
   },admin.token));
  }
  assert.equal((await t.db.query('select id from shop_courier_stops')).length,0,
   'cancelled drafts release orders without fake payments or delivery');
  const restored=ok(await t.api('POST','/api/admin/shop/courier-dispatch/preview',
   input,admin.token));
  assert.equal(restored.plannedOrders,4);
 }finally{await t.close()}
});
