import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';

test('partial supplier receipts reconcile to full order and gate only opted-in courier dispatch',async()=>{
 const t=await setup();
 try{
  const admin=await t.login('+79990000001');
  const customer=await t.login('+79994608101','client');
  const courier=await t.login('+79994608102','client');
  ok(await t.api('PUT','/api/shop/region',{city:'Санкт-Петербург'},customer.token));
  ok(await t.api('PUT','/api/admin/settings/shop',{enabled:true,delivery:true},admin.token));
  const product=ok(await t.api('POST','/api/admin/shop/products',{
    name:'Тестовый электронный датчик тормозной системы',
    brand:'TestBrand',article:'OEM-TR901',
    category:'sensors',price:160000,stock:10
  },admin.token));
  ok(await t.api('PUT','/api/admin/shop/products/'+product.id+'/costing',{
    purchaseCostKopecks:80000,markupBps:3000,
    costSourceNote:'Закупочная цена для испытания ручной накладной поставщика'
  },admin.token));
  const order=ok(await t.api('POST','/api/shop/orders',{
    items:[{productId:product.id,qty:3}],delivery:'delivery',
    address:'Санкт-Петербург, проверочный адрес поставки 51'
  },customer.token));
  const orderId=order.id;
  const receiptRoot='/api/admin/shop/supplier-receipts';
  const orderReceipt='/api/admin/shop/orders/'+orderId+'/supplier-receipts';
  const beforeMapping=await t.api('POST',receiptRoot,{
    orderId,documentRef:'AC-2026-0901',
    documentDate:'2026-11-16',
    evidenceNote:'Оператор сверил бумажную накладную с заказом, но артикул ещё не подтверждён'
  },admin.token);
  assert.equal(beforeMapping.status,409,
    'unverified supplier article cannot generate an accepted physical receipt');
  ok(await t.api('PUT','/api/admin/shop/products/'+product.id+'/supplier',{
    article:'AK-BR901',brand:'TestBrand',verified:true,
    sourceNote:'Артикул поставщика проверен вручную по официальной карточке каталога'
  },admin.token));
  const docDate='2026-11-16';
  const initial={orderId,documentRef:'AC-2026-0901',documentDate:docDate,
    evidenceNote:'Накладная поставщика сверена по номеру заказа, артикулам и дате вручную'};
  assert.equal((await t.api('POST',receiptRoot,initial,customer.token)).status,403);
  const first=ok(await t.api('POST',receiptRoot,initial,admin.token));
  assert.equal(first.created,true);
  assert.equal(first.stockMovementRecorded,false);
  const repeated=ok(await t.api('POST',receiptRoot,initial,admin.token));
  assert.equal(repeated.id,first.id);
  assert.equal(repeated.created,false);
  assert.equal((await t.api('POST',receiptRoot,{
    ...initial,evidenceNote:'Другое основание для той же накладной запрещено после регистрации'
  },admin.token)).status,409);
  assert.equal((await t.api('GET',receiptRoot+'/'+first.id,undefined,customer.token)).status,403);
  const detail=ok(await t.api('GET',receiptRoot+'/'+first.id,undefined,admin.token));
  assert.equal(detail.lines.length,1);
  assert.equal(detail.lines[0].expected_article,'AK-BR901');
  assert.equal(detail.lines[0].expected_qty,3);
  const itemPath=receiptRoot+'/'+first.id+'/lines/0';
  assert.equal((await t.api('PUT',itemPath,{
    observedArticle:'OEM-TR901',observedQty:2,condition:'intact',inspectionNote:''
  },admin.token)).status,409,'compare physical supplier SKU, not catalog public SKU');
  assert.equal((await t.api('PUT',itemPath,{
    observedArticle:'AK-BR901',observedQty:2,condition:'damaged',inspectionNote:''
  },admin.token)).status,400,'damaged goods require written cause');
  ok(await t.api('PUT',itemPath,{
    observedArticle:'AK-BR901',observedQty:2,condition:'damaged',
    inspectionNote:'На коробке повреждена пломба, проверка до приёмки обязательна'
  },admin.token));
  assert.equal((await t.api('POST',receiptRoot+'/'+first.id+'/accept',{
    note:'Повреждённый товар не должен поступать в разрешённый маршрут'
  },admin.token)).status,409,'damaged goods cannot be accepted silently');
  ok(await t.api('PUT',itemPath,{
    observedArticle:'AK-BR901',observedQty:2,condition:'intact',
    inspectionNote:'Два неповреждённых датчика получены по маркировке'
  },admin.token));
  const saved=ok(await t.api('POST',receiptRoot+'/'+first.id+'/accept',{
    note:'Оператор повторно сверил фактические два датчика с заводской маркировкой'
  },admin.token));
  assert.equal(saved.status,'accepted');
  assert.equal(saved.partial,true);
  assert.equal(saved.stockMovementRecorded,false);
  assert.equal((await t.api('PUT',itemPath,{
    observedArticle:'AK-BR901',observedQty:3,condition:'intact',inspectionNote:''
  },admin.token)).status,409,'accepted batch is immutable');

  for(const status of ['confirmed','ready'])
    ok(await t.api('POST','/api/admin/shop/orders/'+orderId+'/status',{status},admin.token));
  ok(await t.api('POST','/api/admin/shop/delivery-addresses/'+orderId+'/verify',{
    cityCode:'spb',
    evidence:'Адрес вручную проверен диспетчером для тестовой приёмки поставки'
  },admin.token));
  ok(await t.api('POST','/api/admin/shop/couriers',{
    userId:courier.id,displayName:'Курьер приёмки поставщика',
    vehicleLabel:'Тестовый фургон доставки'
  },admin.token));
  assert.equal((await t.api('POST','/api/admin/shop/courier-runs',{
    courierId:courier.id,pickupAddress:'Санкт-Петербург, складская база 50',
    orderIds:[orderId],packingRequired:false,supplierReceiptRequired:true
  },admin.token)).status,400,'cannot enable receiving without packing verification');
  const run=ok(await t.api('POST','/api/admin/shop/courier-runs',{
    courierId:courier.id,pickupAddress:'Санкт-Петербург, складская база 50',
    orderIds:[orderId],packingRequired:true,supplierReceiptRequired:true
  },admin.token));
  assert.equal(run.supplierReceiptRequired,true);
  const check='/api/admin/shop/courier-runs/'+run.id+'/warehouse';
  const stopId=ok(await t.api('GET',check,undefined,admin.token)).stops[0].id;
  ok(await t.api('POST',check+'/stops/'+stopId+'/verify',{
    lineIndex:0,article:'OEM-TR901',quantity:3,method:'scanner'
  },admin.token));
  const budget=ok(await t.api('PUT','/api/admin/shop/courier-runs/'+run.id+'/budget',{
    courierPayKopecks:2000,fuelKopecks:1000,packingKopecks:1000,
    acquiringKopecks:0,taxesKopecks:0,otherKopecks:0,
    note:'Смета для проверки допуска партии после поставки'
  },admin.token));
  assert.equal(budget.supplierReceiptRequired,true);
  assert.equal(budget.supplierReceiptReady,false);
  assert.equal(budget.canApprove,false);
  assert.equal((await t.api('POST','/api/admin/shop/courier-runs/'+run.id+
    '/approve-dispatch',{},admin.token)).status,409);
  const orders=ok(await t.api('GET',orderReceipt,undefined,admin.token));
  assert.equal(orders.readiness.lines[0].acceptedQty,2);
  assert.equal(orders.readiness.lines[0].remainingQty,1);
  assert.equal(orders.readiness.ready,false);

  const second=ok(await t.api('POST',receiptRoot,{
    orderId,documentRef:'AC-2026-0902',documentDate:docDate,
    evidenceNote:'Вторая партия вручную сверена с реальной маркировкой поставщика'
  },admin.token));
  const secondItem=receiptRoot+'/'+second.id+'/lines/0';
  ok(await t.api('PUT',secondItem,{
    observedArticle:'AK-BR901',observedQty:2,condition:'intact',
    inspectionNote:'Попытка лишнего количества на следующем приходе'
  },admin.token));
  assert.equal((await t.api('POST',receiptRoot+'/'+second.id+'/accept',{
    note:'Превышение подтверждённого заказа не может быть принято'
  },admin.token)).status,409);
  ok(await t.api('PUT',secondItem,{
    observedArticle:'AK-BR901',observedQty:1,condition:'intact',
    inspectionNote:'Последний датчик получил склад после повторной проверки'
  },admin.token));
  const accepted=ok(await t.api('POST',receiptRoot+'/'+second.id+'/accept',{
    note:'Проверена полная итоговая поставка трёх датчиков без отклонений'
  },admin.token));
  assert.equal(accepted.status,'accepted');
  const full=ok(await t.api('GET',orderReceipt,undefined,admin.token));
  assert.equal(full.readiness.ready,true);
  assert.equal(full.readiness.lines[0].acceptedQty,3);
  const stats=ok(await t.api('GET','/api/admin/shop/courier-runs/'+run.id+'/economics',
    undefined,admin.token));
  assert.equal(stats.supplierReceiptReady,true);
  assert.equal(stats.canApprove,true);
  const dispatch=ok(await t.api('POST','/api/admin/shop/courier-runs/'+run.id+
    '/approve-dispatch',{},admin.token));
  assert.equal(dispatch.approved,true);
  const voided=ok(await t.api('POST',receiptRoot+'/'+first.id+'/void',{
    reason:'Поставщик обнаружил неверный документ после подписания, требуется расследование'
  },admin.token));
  assert.equal(voided.status,'void');
  assert.equal(voided.supplierIssueOpened,true);
  assert.equal(voided.refundAutomaticallyConfirmed,false);
  assert.equal(ok(await t.api('GET',orderReceipt,undefined,admin.token)).readiness.ready,false);
  assert.equal((await t.api('POST','/api/courier/runs/'+run.id+'/accept',
    {},courier.token)).status,409,'voided accepted evidence blocks pickup');
  const stock=await t.db.one<{stock:number}>('select stock from shop_products where id=$1',[product.id]);
  assert.ok(stock&&stock.stock>=0,'no invented restocking or supplier balancing');
  const audits=await t.db.query<{action:string}>(`
    select action from audit_log where action like 'shop.supplier_receipt_%'`);
  assert.ok(audits.some(x=>x.action==='shop.supplier_receipt_created'));
  assert.ok(audits.some(x=>x.action==='shop.supplier_receipt_line_checked'));
  assert.ok(audits.some(x=>x.action==='shop.supplier_receipt_accepted'));
  assert.ok(audits.some(x=>x.action==='shop.supplier_receipt_voided'));
 }finally{await t.close()}
});
