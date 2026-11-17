import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';

test('warehouse discrepancies block dispatch until physical recount, audited resolution and do not alter payments',async()=>{
 const t=await setup();
 try{
  const admin=await t.login('+79990000001');
  const customer=await t.login('+79995608101','client');
  const courier=await t.login('+79995608102','client');
  ok(await t.api('PUT','/api/shop/region',{city:'Санкт-Петербург'},customer.token));
  ok(await t.api('PUT','/api/admin/settings/shop',{enabled:true,delivery:true},admin.token));
  const productId=ok(await t.api('POST','/api/admin/shop/products',{
    name:'Датчик прицепной EBS тестовый',brand:'TestBrand',
    article:'EBS-AX701',category:'sensors',price:130000,stock:10
  },admin.token)).id;
  ok(await t.api('PUT','/api/admin/shop/products/'+productId+'/costing',{
    purchaseCostKopecks:60000,markupBps:3000,
    costSourceNote:'Проверка себестоимости тестового датчика для изолированной складской сборки'
  },admin.token));
  const orderId=ok(await t.api('POST','/api/shop/orders',{
    items:[{productId,qty:2}],delivery:'delivery',
    address:'Санкт-Петербург, контрольный адрес получения 25'
  },customer.token)).id;
  for(const status of ['confirmed','ready'])
    ok(await t.api('POST','/api/admin/shop/orders/'+orderId+'/status',{status},admin.token));
  ok(await t.api('POST','/api/admin/shop/delivery-addresses/'+orderId+'/verify',{
    cityCode:'spb',evidence:'Адрес получателя в СПб подтверждён диспетчером без автоматической геолокации'
  },admin.token));
  ok(await t.api('POST','/api/admin/shop/couriers',{
    userId:courier.id,displayName:'Тестовый курьер склада',
    vehicleLabel:'Контрольный фургон'
  },admin.token));
  const runId=ok(await t.api('POST','/api/admin/shop/courier-runs',{
    courierId:courier.id,pickupAddress:'Санкт-Петербург, складская проверка 55',
    orderIds:[orderId],packingRequired:true
  },admin.token)).id;
  const root='/api/admin/shop/courier-runs/'+runId+'/warehouse';
  const stopId=ok(await t.api('GET',root,undefined,admin.token)).stops[0].id;
  const scan=root+'/stops/'+stopId+'/verify';
  const report=root+'/stops/'+stopId+'/discrepancies';
  const correct={lineIndex:0,article:'EBS-AX701',quantity:2,method:'scanner'};

  // A prior successful check cannot override subsequent physical damage.
  ok(await t.api('POST',scan,correct,admin.token));
  assert.equal(ok(await t.api('GET',root,undefined,admin.token)).ready,true);
  assert.equal((await t.api('POST',report,{
    lineIndex:0,kind:'shortage',observedArticle:'EBS-AX701',
    observedQty:2,note:'No shortage with a full count is invalid'
  },admin.token)).status,400);
  assert.equal((await t.api('POST',report,{
    lineIndex:0,kind:'wrong_article',observedArticle:'EBS-AX701',
    observedQty:2,note:'Matching article cannot be a wrong-article discrepancy'
  },admin.token)).status,400);
  const payload={lineIndex:0,kind:'shortage',observedArticle:'EBS-AX701',
    observedQty:1,note:'Фактически на складе обнаружен один датчик вместо двух; посылку задержали'};
  assert.equal((await t.api('POST',report,payload,customer.token)).status,403);
  assert.equal((await t.api('GET',root+'/discrepancies',undefined,courier.token)).status,403);
  const opened=ok(await t.api('POST',report,payload,admin.token));
  assert.equal(opened.status,'open');
  assert.equal(opened.dispatchBlocked,true);
  assert.equal(opened.financialChanges,false);
  assert.equal((await t.api('POST',report,payload,admin.token)).status,409,
    'only one open discrepancy per physical line');
  const progress=ok(await t.api('GET',root,undefined,admin.token));
  assert.equal(progress.ready,false);
  assert.equal(progress.remainingLines,1);
  assert.equal(progress.openDiscrepancies,1);
  assert.equal(progress.stops[0].lines[0].verified,false);
  assert.equal(progress.stops[0].lines[0].openDiscrepancy.id,opened.id);
  assert.equal(progress.stops[0].lines[0].recheckedAfterDiscrepancy,false);
  assert.equal((await t.db.query(
    'select 1 from shop_warehouse_line_checks where stop_id=$1',[stopId])).length,0,
    'the previously approved packing scan must be invalidated');
  const list=ok(await t.api('GET',root+'/discrepancies',undefined,admin.token));
  assert.equal(list.discrepancies.length,1);
  assert.equal(list.privateToDispatcher,true);
  for(const confidential of ['recipient_name','client_id','address','purchase_cost','latitude','longitude'])
    assert.ok(!JSON.stringify(list).includes(confidential),
      'warehouse incident history must not reveal client or price: '+confidential);

  const resolution=report+'/'+opened.id+'/resolve';
  assert.equal((await t.api('POST',resolution,{
    note:'Новая партия не проверена, закрыть пока нельзя'
  },admin.token)).status,409,'fresh physical recount is required');
  assert.equal((await t.api('POST',resolution,{
    note:'Исправлено без повторной проверки — не допускается'
  },customer.token)).status,403);
  const budget=ok(await t.api('PUT',
    '/api/admin/shop/courier-runs/'+runId+'/budget',{
      courierPayKopecks:1000,fuelKopecks:1000,packingKopecks:1000,
      acquiringKopecks:0,taxesKopecks:0,otherKopecks:0,
      note:'Проверка себестоимости рейса при выявленном недовложении'
    },admin.token));
  assert.ok(budget.canApprove);
  assert.equal((await t.api('POST','/api/admin/shop/courier-runs/'+runId+
    '/approve-dispatch',{},admin.token)).status,409,
    'dispatch remains blocked by the discrepancy, not just the original scan');

  ok(await t.api('POST',scan,{
    ...correct,method:'manual',
    manualReason:'Повторно пересчитано на складе после обнаружения недовложения'
  },admin.token));
  const rescanned=ok(await t.api('GET',root,undefined,admin.token));
  assert.equal(rescanned.stops[0].lines[0].recheckedAfterDiscrepancy,true);
  assert.equal(rescanned.ready,false,'fresh recount does not silently close an incident');
  const resolved=ok(await t.api('POST',resolution,{
    note:'Недостающая вторая позиция добавлена и пересчитана по маркировке новой коробки'
  },admin.token));
  assert.equal(resolved.status,'resolved');
  assert.equal(resolved.financialChanges,false);
  assert.equal((await t.api('POST',resolution,{
    note:'Не допускаем повторной ревизии уже закрытого случая'
  },admin.token)).status,409);
  const ready=ok(await t.api('GET',root,undefined,admin.token));
  assert.equal(ready.ready,true);
  assert.equal(ready.openDiscrepancies,0);
  const history=ok(await t.api('GET',root+'/discrepancies',undefined,admin.token));
  assert.equal(history.discrepancies[0].status,'resolved');
  assert.ok(history.discrepancies[0].resolution_note);
  const approved=ok(await t.api('POST','/api/admin/shop/courier-runs/'+runId+
    '/approve-dispatch',{},admin.token));
  assert.equal(approved.approved,true);
  assert.equal((await t.api('POST',report,{
    lineIndex:0,kind:'damaged',observedArticle:'EBS-AX701',observedQty:2,
    note:'После утверждения склад уже не должен менять выданную посылку'
  },admin.token)).status,409);
  const audits=await t.db.query<{action:string}>(
    "select action from audit_log where action like 'shop.warehouse_discrepancy_%'");
  assert.equal(audits.filter(x=>x.action==='shop.warehouse_discrepancy_reported').length,1);
  assert.equal(audits.filter(x=>x.action==='shop.warehouse_discrepancy_resolved').length,1);
 }finally{await t.close()}
});
