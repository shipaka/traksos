import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';
import {checkLegacyPricingLocation,legacyPricingWarning,legacyTariffZoneMismatch} from '../src/domain/pricingRegion.ts';

const knownOutside=[
  {name:'Москва',lat:55.7558,lng:37.6173,address:'Москва, Тверская 1'},
  {name:'Калининград',lat:54.7104,lng:20.4522,address:'Калининград, проспект Мира 1'},
  {name:'Владивосток',lat:43.1155,lng:131.8855,address:'Владивосток, Океанский проспект 1'},
  {name:'Ижевск',lat:56.8527,lng:53.2115,address:'Ижевск, улица Пушкинская 1'},
  {name:'Псков',lat:57.8194,lng:28.3318,address:'Псков, Октябрьский проспект 1'},
  // Coordinates are deliberately inside the broad legacy box: a declared other
  // Russian federal subject must still override a misleading/spoofed GPS point.
  {name:'Республика Карелия',lat:61.7849,lng:34.3469,address:'Республика Карелия, Петрозаводск, проспект Ленина 1'},
  {name:'Приморский край',lat:59.9343,lng:30.3351,address:'Приморский край, Владивосток, улица Светланская 1'}
];
test('pure region safety never turns KAD prices into a federal price',()=>{
  for(const x of knownOutside){
    assert.equal(checkLegacyPricingLocation(x),'outside',x.name);
    assert.equal(checkLegacyPricingLocation({address:x.address}),'outside',x.name);
  }
  assert.equal(checkLegacyPricingLocation({lat:59.9343,lng:30.3351,address:'Санкт-Петербург, Лиговский 1'}),'possible');
  assert.equal(checkLegacyPricingLocation({lat:58.7376,lng:29.8453,address:'Луга, улица Смоленская 2'}),'possible');
  assert.equal(checkLegacyPricingLocation({address:'Санкт-Петербургское шоссе, 1'}),'unknown',
    'street name is not a geocoder');
  assert.equal(checkLegacyPricingLocation({address:'Москва, Тверская 1',
    lat:59.93,lng:30.3}),'outside','contradictory address cannot be excused by fake GPS');
  assert.equal(checkLegacyPricingLocation({lat:91,lng:20}),'outside');
  assert.equal(checkLegacyPricingLocation({lat:59.93}),'outside');
  assert.equal(checkLegacyPricingLocation({}),'unknown');
  assert.notEqual(checkLegacyPricingLocation({address:'Ленинградская область, Гатчина, Соборная 1'}),'outside',
    'do not treat the supported federal subject as remote');
  const unknown=legacyPricingWarning({});
  assert.equal(unknown.manualConfirmationRequired,true);
  assert.equal(unknown.validatedByGeocoder,false);
  assert.equal(unknown.available,true);
  assert.equal(legacyPricingWarning({address:'Москва, дом 1'}).available,false);
});
test('named local town cannot silently use a different legacy tariff zone',()=>{
  const place={address:'Ленинградская область, г. Гатчина, улица Соборная 1'};
  assert.deepEqual(legacyTariffZoneMismatch(place,'spb'),{place:'гатчина',expectedZoneId:'gat'});
  assert.deepEqual(legacyTariffZoneMismatch({address:'Россия, Выборг, Советская 1'},'kad30'),
    {place:'выборг',expectedZoneId:'vyb'});
  assert.equal(legacyTariffZoneMismatch(place,'gat'),null);
  assert.equal(legacyTariffZoneMismatch({address:'Выборгское шоссе, Санкт-Петербург'},'spb'),null,
    'a street named after a city must not be treated as that city');
  assert.equal(legacyTariffZoneMismatch({address:'Санкт-Петербург, Лиговский 1'},'spb'),null);
  assert.equal(legacyTariffZoneMismatch({},'spb'),null,
    'without evidence this helper cannot claim a tariff is valid');
});
let t:T,customer:any,admin:any;
before(async()=>{
  t=await setup();
  customer=await t.login('+79996667771');
  admin=await t.login('+79990000001');
});
after(()=>t.close());
test('public estimates reject far-away GPS and explicit other cities without inventing fares',async()=>{
  const route='/api/pricing/estimate';
  const base={service:'electric',regionId:'spb',zoneId:'spb',tier:'eco'};
  for(const location of knownOutside){
    const reply=await t.api('POST',route,{...base,...location});
    assert.equal(reply.status,400,JSON.stringify(location));
    assert.ok(['address_region_mismatch','outside_coverage','location_unverified'].includes(reply.body.error),
      JSON.stringify({location,error:reply.body.error}));
    const adr=await t.api('POST',route,{...base,address:location.address});
    assert.equal(adr.status,400);
    assert.ok(['address_region_mismatch','location_unverified'].includes(adr.body.error),
      JSON.stringify({location,error:adr.body.error}));
  }
  const local=ok(await t.api('POST',route,{...base,address:'Санкт-Петербург, Невский проспект 1'}));
  assert.ok(local.callOut>0);
  assert.equal(local.provisional,true);
  assert.match(local.coverageNote,/координаты не подтверждают точную границу КАД/i,
    'API must not claim that the address or pricing was geocoded');
  // Bypass legacy fixture enrichment to exercise the real production API contract.
  const omitted=await fetch(t.base+route,{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({service:'electric',zoneId:'spb',tier:'eco'})
  });
  assert.equal(omitted.status,400,'region must be explicitly declared in production API');
  assert.equal((await omitted.json()).error,'region_required');
  const blind=ok(await t.api('POST',route,base));
  assert.equal(blind.provisional,true);
  assert.ok(blind.coverageNote,'without location a preview is still explicitly preliminary');
  assert.equal(blind.regionValidation,undefined,
    'the current response does not invent a validated region status');
  const phone=ok(await t.api('POST',route,{service:'consult',zoneId:'spb',address:'Калининград'}));
  assert.equal(phone.consult,true,'remote consultation is independent of region');
  assert.equal(phone.coverageNote,null);
  assert.equal(phone.provisional,false);
});
test('clearly outside locations cannot create orders or bank holds, including direct API call',async()=>{
  ok(await t.api('PUT','/api/admin/settings/payments',{online:true},admin.token));
  for(const location of knownOutside){
    const result=await t.api('POST','/api/orders',{
      service:'electric',isSos:true,regionId:'spb',zoneId:'spb',
      paymentMethod:'online',description:'Проблема с тормозами',...location
    },customer.token);
    assert.equal(result.status,400,JSON.stringify(location));
    assert.ok(['address_region_mismatch','outside_coverage','location_unverified'].includes(result.body.error),
      JSON.stringify({location,error:result.body.error}));
  }
  const after=await t.db.query('select id from orders where created_by=$1',[customer.id]);
  assert.equal(after.length,0,'no order is entered before real pricing');
  assert.equal((await t.db.query('select id from payments')).length,0,'no bank payment / hold');
  assert.equal((await t.db.query('select id from order_dispatch')).length,0,'no dispatch invitations');
  assert.equal(t.payments.payments.size,0,'external provider never called');
  const local=ok(await t.api('POST','/api/orders',{
    service:'electric',zoneId:'spb',address:'Санкт-Петербург, Невский проспект 1',
    lat:59.9343,lng:30.3351,paymentMethod:'cash',
    description:'Проблема с тормозами'
  },customer.token));
  assert.equal(local.order.estimate.regionValidation.tariffScope,'Санкт-Петербург и Ленинградская область');
  assert.equal(local.order.estimate.regionValidation.validatedByGeocoder,false,
    'a regional bounding box is not genuine geocoding');
});

test('an explicitly named outlying town is not charged at the KAD tariff',async()=>{
  const mismatched={service:'electric',tier:'eco',regionId:'lo',zoneId:'spb',
    address:'Ленинградская область, г. Гатчина, улица Соборная 1'};
  const rejected=await t.api('POST','/api/pricing/estimate',mismatched);
  assert.equal(rejected.status,400);
  assert.equal(rejected.body.error,'region_zone_mismatch');
  const correct=ok(await t.api('POST','/api/pricing/estimate',{...mismatched,zoneId:'gat'}));
  assert.equal(correct.zoneId,'gat');
  assert.equal(correct.provisional,true);
  assert.match(correct.coverageNote,/координаты не подтверждают точную границу КАД/i);
  const countBefore=(await t.db.query('select id from orders where created_by=$1',[customer.id])).length;
  const paymentsBefore=t.payments.payments.size;
  const attempt=await t.api('POST','/api/orders',{
    ...mismatched,paymentMethod:'online',description:'Ремонт на месте',isSos:true
  },customer.token);
  assert.equal(attempt.status,400);
  assert.equal(attempt.body.error,'region_zone_mismatch');
  assert.equal((await t.db.query('select id from orders where created_by=$1',[customer.id])).length,countBefore);
  assert.equal(t.payments.payments.size,paymentsBefore,'no new bank hold for misleading zone');
});
