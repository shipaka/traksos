import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';
import {publishedEcuWorkshop} from './ecuWorkshopFixture.ts';

test('customer direct ECU retry has one order and one idempotency identity',async()=>{
  const t=await setup();
  try{
    const customer=await t.login('+79998194001','client');
    const expert=await publishedEcuWorkshop(t,'+79998194002');
    const vehicle=ok(await t.api('POST','/api/vehicles',{
      brand:'Renault',model:'Premium',year:2010
    },customer.token));
    const body={
      service:'ecu',zoneId:'ecu_station',ecuSpecialistId:expert.id,vehicleId:vehicle.id,
      description:'Отдельная диагностика электронного блока управления EBS',
      address:'Санкт-Петербург, парковка у Московского шоссе'
    };
    const headers={'idempotency-key':'customer-direct-ecu-case-001'};
    const first=ok(await t.api('POST','/api/orders',body,customer.token,headers));
    assert.ok(first.order?.id);
    assert.equal(first.order.service,'ecu');
    assert.equal(first.order.additionalTo,null,'direct ECU order has no invented source');
    const retry=ok(await t.api('POST','/api/orders',body,customer.token,headers));
    assert.equal(retry.order.id,first.order.id,
      'same mobile submission must reuse the completed/ongoing order');
    const duplicates=await t.db.query<{id:string}>(`
      select id from orders where created_by=$1 and create_request_key=$2
    `,[customer.id,headers['idempotency-key']]);
    assert.equal(duplicates.length,1,'double tapping does not create a second order');
    assert.equal((await t.api('POST','/api/orders',{
      ...body,description:body.description+' Изменённая заявка'
    },customer.token,headers)).status,409,
    'changed body cannot be smuggled under an already-used request key');
    assert.equal((await t.api('GET','/api/orders/'+first.order.id,
      undefined,customer.token)).status,200);
  }finally{await t.close()}
});
