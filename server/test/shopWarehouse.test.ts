import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';

let t:T,admin:any,customer:any,courier:any,productId:string,orderId:string,runId:string,stopId:string;
before(async()=>{
  t=await setup();
  admin=await t.login('+79990000001');
  customer=await t.login('+79995781301','client');
  courier=await t.login('+79995781302','client');
  ok(await t.api('PUT','/api/shop/region',{city:'Санкт-Петербург'},customer.token));
  ok(await t.api('PUT','/api/admin/settings/shop',{enabled:true,delivery:true},admin.token));
  productId=ok(await t.api('POST','/api/admin/shop/products',{
    name:'Тестовый датчик EBS с маркировкой',brand:'TestBrand',article:'EBS-7701',
    category:'sensors',price:130000,stock:10
  },admin.token)).id;
  ok(await t.api('PUT','/api/admin/shop/products/'+productId+'/costing',{
    purchaseCostKopecks:60000,markupBps:3000,
    costSourceNote:'Складской тест: реальная накладная поставки для проверки артикула'
  },admin.token));
  orderId=ok(await t.api('POST','/api/shop/orders',{
    items:[{productId,qty:2}],delivery:'delivery',
    address:'Санкт-Петербург, проверочный адрес склада 25'
  },customer.token)).id;
  ok(await t.api('POST','/api/admin/shop/orders/'+orderId+'/status',{status:'confirmed'},admin.token));
  ok(await t.api('POST','/api/admin/shop/orders/'+orderId+'/status',{status:'ready'},admin.token));
  ok(await t.api('POST','/api/admin/shop/delivery-addresses/'+orderId+'/verify',{
    cityCode:'spb',evidence:'Адрес в Санкт-Петербурге подтверждён диспетчером и сверкой заказчика'
  },admin.token));
  ok(await t.api('POST','/api/admin/shop/couriers',{
    userId:courier.id,displayName:'Складской тестовый курьер',
    vehicleLabel:'Тестовый малотоннажный автомобиль'
  },admin.token));
  const run=ok(await t.api('POST','/api/admin/shop/courier-runs',{
    courierId:courier.id,pickupAddress:'Санкт-Петербург, тестовый склад 55',
    orderIds:[orderId],packingRequired:true
  },admin.token));
  runId=run.id;
  assert.equal(run.packingRequired,true);
  const view=ok(await t.api('GET','/api/admin/shop/courier-runs/'+runId+'/warehouse',
    undefined,admin.token));
  stopId=view.stops[0].id;
});
after(()=>t.close());

test('warehouse list hides customer identity, finances and GPS; access is staff only',async()=>{
  const path='/api/admin/shop/courier-runs/'+runId+'/warehouse';
  assert.equal((await t.api('GET',path,undefined,customer.token)).status,403);
  assert.equal((await t.api('GET',path,undefined,courier.token)).status,403);
  const view=ok(await t.api('GET',path,undefined,admin.token));
  assert.equal(view.packingRequired,true);
  assert.equal(view.totalLines,1);
  assert.equal(view.remainingLines,1);
  assert.equal(view.ready,false);
  assert.equal(view.stops[0].lines[0].article,'EBS-7701');
  assert.equal(view.stops[0].lines[0].quantity,2);
  const stringify=JSON.stringify(view);
  for(const forbidden of ['recipientName','recipientPhone','purchaseCost','deliveryAddress','latitude','longitude']){
    assert.ok(!stringify.includes(forbidden));
  }
});

test('wrong SKU and quantity do not advance warehouse checklist',async()=>{
  const url='/api/admin/shop/courier-runs/'+runId+'/warehouse/stops/'+stopId+'/verify';
  const b={lineIndex:0,article:'EBS-7701',quantity:2,method:'scanner'};
  assert.equal((await t.api('POST',url,b,customer.token)).status,403);
  assert.equal((await t.api('POST',url,{...b,article:'FAKE-000'},admin.token)).status,409);
  assert.equal((await t.api('POST',url,{...b,quantity:3},admin.token)).status,409);
  assert.equal((await t.api('POST',url,{...b,method:'manual'},admin.token)).status,400);
  assert.equal((await t.api('POST',url,{...b,lineIndex:1},admin.token)).status,400);
  assert.equal((await t.api('GET','/api/admin/shop/courier-runs/'+runId+'/warehouse',
    undefined,admin.token)).body.ready,false);
  assert.equal((await t.api('POST','/api/admin/shop/courier-runs/'+runId+
    '/approve-dispatch',{},admin.token)).status,409,
    'dispatch approval must fail before scanned lines even if economics are otherwise ready');
});

test('correct SKU and counted quantity enable warehouse release, changes invalidate scan',async()=>{
  const path='/api/admin/shop/courier-runs/'+runId+'/warehouse';
  const url=path+'/stops/'+stopId+'/verify';
  const scan={lineIndex:0,article:'ebs-7701',quantity:2,method:'scanner'};
  assert.equal(ok(await t.api('POST',url,scan,admin.token)).verified,true);
  assert.equal(ok(await t.api('GET',path,undefined,admin.token)).ready,true);
  const original=await t.db.one<{items:any[]}>('select items from shop_orders where id=$1',[orderId]);
  assert.ok(original?.items?.length);
  const changed=original!.items.map(x=>({...x,article:'NEW-8801'}));
  await t.db.query('update shop_orders set items=$2::jsonb where id=$1',[orderId,changed]);
  assert.equal(ok(await t.api('GET',path,undefined,admin.token)).ready,false,
    'a supplier SKU substitution after scan invalidates packing readiness');
  await t.db.query('update shop_orders set items=$2::jsonb where id=$1',[orderId,original!.items]);
  assert.equal(ok(await t.api('GET',path,undefined,admin.token)).ready,true);
  const manual=ok(await t.api('POST',url,{
    lineIndex:0,article:'EBS-7701',quantity:2,method:'manual',
    manualReason:'Штрихкод повреждён, проверено по заводской упаковке и накладной'
  },admin.token));
  assert.equal(manual.method,'manual');
  const check=await t.db.one<{checked_qty:number;method:string;manual_reason:string}>(
    'select checked_qty,method,manual_reason from shop_warehouse_line_checks where stop_id=$1',[stopId]);
  assert.equal(check?.checked_qty,2);
  assert.equal(check?.method,'manual');
  assert.ok(check?.manual_reason.length);
  assert.equal(ok(await t.api('GET',path,undefined,admin.token)).ready,true);
});

test('after courier dispatch approval warehouse verification is immutable',async()=>{
  const budget=ok(await t.api('PUT','/api/admin/shop/courier-runs/'+runId+'/budget',{
    courierPayKopecks:1000,fuelKopecks:1000,packingKopecks:1000,
    acquiringKopecks:0,taxesKopecks:0,otherKopecks:0,
    note:'Проверенный малый маршрут без убыточных затрат'
  },admin.token));
  assert.ok(budget.canApprove);
  const approved=ok(await t.api('POST','/api/admin/shop/courier-runs/'+runId+
    '/approve-dispatch',{},admin.token));
  assert.equal(approved.approved,true);
  const path='/api/admin/shop/courier-runs/'+runId+'/warehouse';
  assert.equal(ok(await t.api('GET',path,undefined,admin.token)).dispatchApproved,true);
  assert.equal((await t.api('POST',path+'/stops/'+stopId+'/verify',{
    lineIndex:0,article:'EBS-7701',quantity:2,method:'scanner'
  },admin.token)).status,409);
});
