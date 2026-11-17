import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';
import {normalizeGtin,traceInputIsHardwareAttested} from '../src/services/shopGtin.ts';

const bodyGtin=(body:string)=>{
  let sum=0;
  for(let i=body.length-1,weight=3;i>=0;i--,weight=weight===3?1:3)
    sum+=Number(body[i])*weight;
  return body+String((10-sum%10)%10);
};

test('GTIN-8, UPC-12, EAN-13 and GTIN-14 check digit excludes invalid barcodes',()=>{
  for(const digits of ['9638507','03600029145','400638133393','1001234567890']){
    const candidate=bodyGtin(digits);
    assert.equal(normalizeGtin(candidate),candidate);
    const wrong=candidate.slice(0,-1)+String((Number(candidate.at(-1))+1)%10);
    assert.equal(normalizeGtin(wrong),null);
  }
  assert.equal(normalizeGtin('400638133393'),null);
  assert.equal(normalizeGtin('4006381333931?x=y'),null);
  assert.equal(normalizeGtin('http://example.org'),null);
  assert.equal(traceInputIsHardwareAttested,false);
});

test('opt-in traceability requires checked SKU/count, GTIN and lot or unique per-unit serials',async()=>{
  const t=await setup();
  try{
    const admin=await t.login('+79990000001');
    const client=await t.login('+79995871001','client');
    const courier=await t.login('+79995871002','client');
    ok(await t.api('PUT','/api/shop/region',{city:'Санкт-Петербург'},client.token));
    ok(await t.api('PUT','/api/admin/settings/shop',{enabled:true,delivery:true},admin.token));
    const productId=ok(await t.api('POST','/api/admin/shop/products',{
      name:'Контрольный датчик ABS с серийными номерами',brand:'TestBrand',
      article:'ABS-GTIN-402',category:'sensors',price:135000,stock:10
    },admin.token)).id;
    ok(await t.api('PUT','/api/admin/shop/products/'+productId+'/costing',{
      purchaseCostKopecks:60000,markupBps:3000,
      costSourceNote:'Контрольная закупка для теста сквозной идентификации товара'
    },admin.token));
    const orderId=ok(await t.api('POST','/api/shop/orders',{
      items:[{productId,qty:2}],delivery:'delivery',
      address:'Санкт-Петербург, тестовый адрес проверки 50'
    },client.token)).id;
    for(const status of ['confirmed','ready'])
      ok(await t.api('POST','/api/admin/shop/orders/'+orderId+'/status',{status},admin.token));
    ok(await t.api('POST','/api/admin/shop/delivery-addresses/'+orderId+'/verify',{
      cityCode:'spb',evidence:'Тестовый адрес проверен диспетчером вручную'
    },admin.token));
    ok(await t.api('POST','/api/admin/shop/couriers',{
      userId:courier.id,displayName:'Тестовый курьер GTIN',
      vehicleLabel:'Тестовый автомобиль склада'
    },admin.token));
    const create='/api/admin/shop/courier-runs';
    const routeData={
      courierId:courier.id,pickupAddress:'Санкт-Петербург, склад испытания 30',
      orderIds:[orderId],traceabilityRequired:true
    };
    assert.equal((await t.api('POST',create,{...routeData,packingRequired:false},
      admin.token)).status,400);
    const run=ok(await t.api('POST',create,{...routeData,packingRequired:true},
      admin.token));
    assert.equal(run.traceabilityRequired,true);
    const base='/api/admin/shop/courier-runs/'+run.id+'/warehouse';
    const first=ok(await t.api('GET',base,undefined,admin.token));
    assert.equal(first.traceabilityRequired,true);
    const stopId=first.stops[0].id;
    const traceUrl=base+'/stops/'+stopId+'/trace';
    const gtin=bodyGtin('400638133393');
    const payload={lineIndex:0,gtin,lot:'BATCH-2026-11',
      serials:['SER0001','SER0002'],inputMethod:'keyboard_wedge'};
    assert.equal((await t.api('POST',traceUrl,payload,client.token)).status,403);
    assert.equal((await t.api('POST',traceUrl,payload,courier.token)).status,403);
    assert.equal((await t.api('POST',traceUrl,payload,admin.token)).status,409,
      'trace evidence cannot precede a physical count');
    const verify=base+'/stops/'+stopId+'/verify';
    ok(await t.api('POST',verify,{
      lineIndex:0,article:'ABS-GTIN-402',quantity:2,method:'scanner'
    },admin.token));
    assert.equal(ok(await t.api('GET',base,undefined,admin.token)).ready,false,
      'old scan-only logic must not bypass selected strict GTIN tracing');
    assert.equal((await t.api('POST',traceUrl,{
      ...payload,gtin:gtin.slice(0,-1)+String((Number(gtin.at(-1))+1)%10)
    },admin.token)).status,400);
    assert.equal((await t.api('POST',traceUrl,{
      ...payload,lot:null,serials:[]
    },admin.token)).status,400);
    assert.equal((await t.api('POST',traceUrl,{
      ...payload,serials:['SER0001']
    },admin.token)).status,400);
    assert.equal((await t.api('POST',traceUrl,{
      ...payload,serials:['SER0001','ser0001']
    },admin.token)).status,400);
    assert.equal((await t.api('POST',traceUrl,{
      ...payload,inputMethod:'manual'
    },admin.token)).status,400);
    const result=ok(await t.api('POST',traceUrl,payload,admin.token));
    assert.equal(result.traceRecorded,true);
    assert.equal(result.hardwareScannerAttested,false);
    assert.equal(result.supplierOrOemAuthenticityConfirmed,false);
    assert.equal(result.financialChanges,false);
    const complete=ok(await t.api('GET',base,undefined,admin.token));
    assert.equal(complete.ready,true);
    assert.equal(complete.remainingLines,0);
    assert.equal(complete.stops[0].lines[0].traceabilityVerified,true);
    assert.deepEqual(complete.stops[0].lines[0].trace.serials,['SER0001','SER0002']);
    assert.equal(complete.stops[0].lines[0].trace.lot,'BATCH-2026-11');

    ok(await t.api('POST',verify,{
      lineIndex:0,article:'ABS-GTIN-402',quantity:2,method:'manual',
      manualReason:'Повторная проверка количества и артикула после пересчёта'
    },admin.token));
    const invalidated=ok(await t.api('GET',base,undefined,admin.token));
    assert.equal(invalidated.ready,false);
    assert.equal(invalidated.stops[0].lines[0].traceabilityVerified,false);
    assert.equal(invalidated.stops[0].lines[0].trace,null);
    assert.equal((await t.db.query(
      'select * from shop_warehouse_line_traces where stop_id=$1',[stopId])).length,0);

    ok(await t.api('POST',traceUrl,{
      ...payload,serials:[],inputMethod:'manual',
      manualReason:'Перепроверена заводская партия по маркировке коробки'
    },admin.token));
    const withLot=ok(await t.api('GET',base,undefined,admin.token));
    assert.equal(withLot.ready,true);
    assert.equal(withLot.stops[0].lines[0].traceabilityVerified,true);
    assert.equal(withLot.stops[0].lines[0].trace.serials.length,0);

    ok(await t.api('POST',base+'/stops/'+stopId+'/discrepancies',{
      lineIndex:0,kind:'seal_broken',observedArticle:'ABS-GTIN-402',
      observedQty:2,note:'На коробке повреждена пломба после сверки GTIN, выдача запрещена'
    },admin.token));
    const broken=ok(await t.api('GET',base,undefined,admin.token));
    assert.equal(broken.ready,false);
    assert.equal(broken.stops[0].lines[0].trace,null,
      'damage invalidates both physical scan and all recorded trace identifiers');
    assert.equal((await t.api('POST',traceUrl,payload,admin.token)).status,409);
    const traceAudit=await t.db.query<{action:string}>(
      "select action from audit_log where action='shop.warehouse_trace_recorded'");
    assert.equal(traceAudit.length,2);
  }finally{await t.close()}
});

test('routes without traceability opt-in remain unaffected',async()=>{
  const t=await setup();
  try{
    const admin=await t.login('+79990000001');
    const client=await t.login('+79995871011','client');
    const courier=await t.login('+79995871012','client');
    ok(await t.api('PUT','/api/shop/region',{city:'Санкт-Петербург'},client.token));
    ok(await t.api('PUT','/api/admin/settings/shop',{enabled:true,delivery:true},admin.token));
    const productId=ok(await t.api('POST','/api/admin/shop/products',{
      name:'Контрольная деталь без GTIN',brand:'TestBrand',
      article:'ABS-OLD-403',category:'sensors',price:120000,stock:10
    },admin.token)).id;
    ok(await t.api('PUT','/api/admin/shop/products/'+productId+'/costing',{
      purchaseCostKopecks:60000,markupBps:3000,
      costSourceNote:'Проверочная закупка для совместимости ранее запланированных рейсов'
    },admin.token));
    const orderId=ok(await t.api('POST','/api/shop/orders',{
      items:[{productId,qty:1}],delivery:'delivery',
      address:'Санкт-Петербург, адрес для совместимости старых рейсов 22'
    },client.token)).id;
    for(const status of ['confirmed','ready'])
      ok(await t.api('POST','/api/admin/shop/orders/'+orderId+'/status',{status},admin.token));
    ok(await t.api('POST','/api/admin/shop/delivery-addresses/'+orderId+'/verify',{
      cityCode:'spb',evidence:'Проверен адрес доставки тестового рейса без GTIN'
    },admin.token));
    ok(await t.api('POST','/api/admin/shop/couriers',{
      userId:courier.id,displayName:'Тестовый курьер без GTIN',
      vehicleLabel:'Проверочный грузовой автомобиль'
    },admin.token));
    const run=ok(await t.api('POST','/api/admin/shop/courier-runs',{
      courierId:courier.id,pickupAddress:'Санкт-Петербург, склад предыдущей комплектации 31',
      orderIds:[orderId],packingRequired:true
    },admin.token));
    const base='/api/admin/shop/courier-runs/'+run.id+'/warehouse';
    const before=ok(await t.api('GET',base,undefined,admin.token));
    assert.equal(before.traceabilityRequired,false);
    const stopId=before.stops[0].id;
    ok(await t.api('POST',base+'/stops/'+stopId+'/verify',{
      lineIndex:0,article:'ABS-OLD-403',quantity:1,method:'scanner'
    },admin.token));
    const after=ok(await t.api('GET',base,undefined,admin.token));
    assert.equal(after.ready,true);
    assert.equal(after.remainingLines,0);
    assert.equal((await t.api('POST',base+'/stops/'+stopId+'/trace',{
      lineIndex:0,gtin:bodyGtin('400638133393'),lot:'BATCH-2026-11',
      serials:[],inputMethod:'keyboard_wedge'
    },admin.token)).status,409);
  }finally{await t.close()}
});
