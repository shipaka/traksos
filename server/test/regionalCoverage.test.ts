import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertRegionalTariff,CoverageError} from '../src/domain/regionalCoverage.ts';
import {setup,ok} from './helpers.ts';

const spb = {service:'electric',regionId:'spb' as const,zoneId:'spb',address:'Санкт-Петербург, Лиговский проспект, 12'};
const lo = {service:'tow',regionId:'lo' as const,zoneId:'gat',address:'Гатчина, Ленинградская область, улица Ленина, 1'};
const deny=(request:Parameters<typeof assertRegionalTariff>[0],code:string,requireSite=true)=>{
  assert.throws(()=>assertRegionalTariff(request,requireSite),(err:unknown)=>{
    assert.ok(err instanceof CoverageError);
    assert.equal(err.code,code);
    return true;
  });
};

test('SPb and Leningrad addresses without GPS are explicit and separately zoned',()=>{
  assert.doesNotThrow(()=>assertRegionalTariff(spb,true));
  assert.doesNotThrow(()=>assertRegionalTariff(lo,true));
  assert.doesNotThrow(()=>assertRegionalTariff({...lo,zoneId:'tos',address:'Тосно, улица Ленина, 3'},true));
  assert.doesNotThrow(()=>assertRegionalTariff({...lo,zoneId:'kad30',address:'Ленинградская область, стоянка на 11 км шоссе'},true));
  deny({...spb,regionId:undefined},'region_required');
  deny({...spb,zoneId:'gat'},'region_zone_mismatch');
  deny({...lo,regionId:'spb'},'region_zone_mismatch');
  deny({...spb,address:'улица Ленина 1'},'location_unverified');
  deny({...lo,address:'неизвестное место за КАД'},'location_unverified');
  deny({...lo,zoneId:'gat',address:'Тосно, улица Ленина'},'location_unverified');
  deny({...lo,zoneId:'kad30',address:'Ленинградская область, Выборг'},'address_zone_mismatch');
  deny({...spb,address:'Санкт-Петербург, Московский проспект 1',city:'Москва'},'address_region_mismatch');
  assert.doesNotThrow(()=>assertRegionalTariff({...spb,address:'Санкт-Петербург, Московский проспект 1'},true));
  deny({...spb,address:'Санкт-Петербург, улица Ленина',lat:59.94},'invalid_location');
  deny({...spb,address:'',lat:undefined,lng:undefined},'location_required');
});

test('no federal SPb/KAD tariff by IP, city spoof or GPS: Moscow Kaliningrad Vladivostok',()=>{
  for(const loc of [
    {city:'Москва',lat:55.7558,lng:37.6173},
    {city:'Калининград',lat:54.7104,lng:20.4522},
    {city:'Владивосток',lat:43.1155,lng:131.8855},
  ]) {
    deny({...spb,address:'',lat:loc.lat,lng:loc.lng},'outside_coverage');
    deny({...spb,city:loc.city,lat:59.94,lng:30.32},'address_region_mismatch');
    deny({...lo,regionId:'other',address:loc.city},'manual_quote_required');
  }
  // The coordinate on the conservative envelope edge is accepted as possible,
  // the point immediately outside is NEVER accepted, regardless of zoneId.
  assert.doesNotThrow(()=>assertRegionalTariff({
    ...spb,address:'',lat:59.65,lng:30.32,
  },true));
  deny({...spb,address:'',lat:59.64999,lng:30.32},'outside_coverage');
  // Client chooses Gatchina but GPS is in Luga: cannot bypass by changing city text.
  deny({...lo,address:'',lat:58.735,lng:29.846},'zone_location_mismatch');
  assert.doesNotThrow(()=>assertRegionalTariff({...lo,address:'',lat:59.575,lng:30.127},true));
  // A location can be entered by GPS alone, but NO zone is derived from it.
  deny({...lo,address:'',lat:59.575,lng:30.127,zoneId:undefined},'region_zone_mismatch');
  // Phone advice is geography-independent, without fictitious travel charges.
  assert.doesNotThrow(()=>assertRegionalTariff({
    service:'consult',regionId:'other',zoneId:'phone',address:'Москва',
  },true));
});

test('pricing API and order API reject forged location before inserting order or asking bank for hold',
  {timeout:60000},async()=>{
  const t=await setup();
  try{
    const client=await t.login('+79997771121');
    const admin=await t.login('+79990000001');
    ok(await t.api('PUT','/api/admin/settings/payments',{online:true},admin.token));
    const endpoint=t.base+'/api/orders';
    const raw=async(body:unknown)=>{
      const res=await fetch(endpoint,{
        method:'POST',headers:{authorization:'Bearer '+client.token,'content-type':'application/json'},
        body:JSON.stringify(body),
      });
      return {status:res.status,body:await res.json()};
    };
    const base={service:'electric',zoneId:'spb',address:'Санкт-Петербург, улица Ленина',paymentMethod:'online'};
    let result=await raw(base);
    assert.equal(result.status,400);
    assert.equal(result.body.error,'region_required','raw API without region is never silently SPb');
    result=await raw({...base,regionId:'other'});
    assert.equal(result.status,400);
    assert.equal(result.body.error,'manual_quote_required');
    result=await raw({...base,regionId:'spb',lat:55.75,lng:37.62});
    assert.equal(result.status,400);
    assert.equal(result.body.error,'outside_coverage');
    result=await raw({...base,regionId:'spb',city:'Москва'});
    assert.equal(result.status,400);
    assert.equal(result.body.error,'address_region_mismatch');
    result=await raw({...base,regionId:'spb',zoneId:'gat'});
    assert.equal(result.status,400);
    assert.equal(result.body.error,'region_zone_mismatch');
    assert.equal((await t.db.one<any>('select count(*)::int as n from orders'))?.n,0,
      'invalid region must never insert order');
    assert.equal((await t.db.one<any>('select count(*)::int as n from payments'))?.n,0,
      'invalid region cannot create even a pending authorization');
    assert.equal(t.payments.payments.size,0,'bank mock was never invoked');

    const noRegionEstimate=await fetch(t.base+'/api/pricing/estimate',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({service:'tow',zoneId:'spb'}),
    });
    assert.equal(noRegionEstimate.status,400);
    assert.equal((await noRegionEstimate.json()).error,'region_required');
    const coveredEstimate=ok(await t.api('POST','/api/pricing/estimate',{
      service:'electric',regionId:'spb',zoneId:'spb',address:'Санкт-Петербург, Невский проспект',
    }));
    assert.equal(coveredEstimate.provisional,true);
    assert.match(coveredEstimate.coverageNote,/предварительный/i);
    assert.ok(coveredEstimate.callOut>0);
    const outsideEstimate=await t.api('POST','/api/pricing/estimate',{
      service:'tow',regionId:'lo',zoneId:'kad30',lat:43.11,lng:131.89,
    });
    assert.equal(outsideEstimate.status,400);
    assert.equal(outsideEstimate.body.error,'outside_coverage');
    assert.equal((await t.db.one<any>('select count(*)::int as n from orders'))?.n,0);
  }finally{await t.close()}
});

test('valid new order snapshots declared region; subsequent new-order region change does not reprice old order',
  {timeout:60000},async()=>{
  const t=await setup();
  try{
    const client=await t.login('+79997771122');
    const created=ok(await t.api('POST','/api/orders',{
      service:'electric',regionId:'spb',zoneId:'spb',address:'Санкт-Петербург, улица Ленина',
      paymentMethod:'cash',description:'Электрика не работает',
    },client.token));
    const row=await t.db.one<any>('select id,location_region,zone_id,estimate from orders where id=$1',[created.order.id]);
    assert.equal(row.location_region,'spb');
    assert.equal(row.zone_id,'spb');
    assert.ok(row.estimate.callOut>0);
    const second=await t.api('POST','/api/pricing/estimate',{
      service:'electric',regionId:'lo',zoneId:'gat',address:'Гатчина, улица Ленина',
    });
    assert.equal(second.status,200);
    const retained=await t.db.one<any>('select location_region,zone_id,estimate from orders where id=$1',[row.id]);
    assert.equal(retained.location_region,'spb');
    assert.equal(retained.zone_id,'spb');
    assert.deepEqual(retained.estimate,row.estimate,'old price is an immutable snapshot');
  }finally{await t.close()}
});
