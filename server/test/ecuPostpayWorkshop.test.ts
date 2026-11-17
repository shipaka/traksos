import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';
import {publishedEcuWorkshop} from './ecuWorkshopFixture.ts';

test('stationary ECU: unpriced request, chosen expert, post-work price, explicit client consent and warranty',async()=>{
  const t=await setup();
  try{
    const customer=await t.login('+79999025001','client');
    const outsider=await t.login('+79999025002','client');
    const expert=await publishedEcuWorkshop(t,'+79999025003');
    const directory=ok(await t.api('GET','/api/ecu/stations?lat=59.94&lng=30.34',undefined,customer.token));
    assert.ok(directory.stations.some((x:any)=>x.id===expert.id));
    assert.equal(directory.radiusApplied,false);
    const vehicle=ok(await t.api('POST','/api/vehicles',{
      brand:'Scania',model:'R-серия',year:2010,plate:'А000АА177'
    },customer.token));
    const request=ok(await t.api('POST','/api/orders',{
      service:'ecu',ecuSpecialistId:expert.id,
      vehicleId:vehicle.id,zoneId:'ecu_station',paymentMethod:'cash',
      description:'Проверка координатора электронных систем грузового автомобиля',
      address:'Санкт-Петербург, тестовое местонахождение автомобиля',
      site:{ecuBlockCode:'unknown',ecuBlockNote:'Блок неизвестен, требуется диагностика'}
    },customer.token)).order;
    assert.equal(request.service,'ecu');
    assert.equal(request.isSos,false);
    assert.equal(request.money.total,0,'request is not a free service or bill');
    assert.equal(request.site?.ecuBlockCode,'unknown');
    assert.ok((await t.db.query('select id from payments where order_id=$1',[request.id])).length===0);
    assert.equal((await t.api('GET','/api/orders/'+request.id,undefined,outsider.token)).status,403);

    const open=ok(await t.api('GET','/api/performer/auctions',undefined,expert.token));
    assert.ok(open.some((x:any)=>x.order_id===request.id),'only explicitly selected expert receives inquiry');
    const bid=ok(await t.api('POST','/api/orders/'+request.id+'/offers',{},expert.token));
    assert.equal(bid.price,0,'acknowledgement is not a price quote');
    const offers=ok(await t.api('GET','/api/orders/'+request.id+'/offers',undefined,customer.token));
    assert.equal(offers.offers.length,1);
    const offerId=offers.offers[0].id;
    assert.equal((await t.api('POST','/api/orders/'+request.id+'/offers/'+offerId+'/choose',{},customer.token)).status,400,
      'no silent acceptance without explicit unpriced acknowledgement');
    const accepted=ok(await t.api('POST','/api/orders/'+request.id+'/offers/'+offerId+'/choose',
      {acceptedPrice:0},customer.token));
    assert.equal(accepted.status,'accepted');
    assert.equal(accepted.money.total,0);
    assert.ok(accepted.ecuDueAt);
    assert.ok((await t.db.query('select id from payments where order_id=$1',[request.id])).length===0);

    assert.equal((await t.api('POST','/api/orders/'+request.id+'/step',
      {action:'depart'},expert.token)).status,400,
      'stationary ECU should never have roadside travel statuses');
    ok(await t.api('POST','/api/orders/'+request.id+'/ecu/start',{},expert.token));
    const extended=ok(await t.api('POST','/api/orders/'+request.id+'/ecu/extend',{
      reason:'Необходим редкий компонент для ремонта блока управления'
    },expert.token));
    assert.equal(extended.ecuExtensionsCount,1);
    assert.ok(new Date(extended.ecuDueAt)>new Date(accepted.ecuDueAt));
    const priced=ok(await t.api('POST','/api/orders/'+request.id+'/ecu/final-price',{
      amount:180000,summary:'Диагностика и восстановление электронной платы',
      warrantyDays:14,warrantyWork:'Восстановление электронной платы'
    },expert.token));
    assert.equal(priced.status,'awaiting_confirmation');
    assert.equal(priced.money.amount,180000);
    assert.equal(priced.warrantyDays,14);
    assert.equal(priced.warrantyStartedAt,null);
    assert.ok((await t.db.query('select id from payments where order_id=$1',[request.id])).length===0);
    const baseBody={total:priced.money.total,proposalVersion:priced.amountProposalVersion};
    assert.equal((await t.api('POST','/api/orders/'+request.id+'/confirm',baseBody,customer.token)).status,400,
      'client must attest to final price rather than just visit the page');
    const wrongVersion=new Date(new Date(priced.amountProposalVersion).getTime()-1000).toISOString();
    assert.equal((await t.api('POST','/api/orders/'+request.id+'/confirm',{
      ...baseBody,proposalVersion:wrongVersion,ecuConsent:true
    },customer.token)).status,409,'outdated quote may not be paid');
    const confirmed=ok(await t.api('POST','/api/orders/'+request.id+'/confirm',{
      ...baseBody,ecuConsent:true
    },customer.token));
    assert.equal(confirmed.status,'completed');
    assert.ok(confirmed.warrantyStartedAt);
    assert.equal(confirmed.warrantyDays,14);
    assert.equal((await t.db.query(
      "select id from order_events where order_id=$1 and type='amount_confirmed'",[request.id])).length,1);
    assert.equal((await t.api('POST','/api/orders/'+request.id+'/ecu/final-price',{
      amount:100000,summary:'Попытка переписать сумму',warrantyDays:null
    },expert.token)).status,409,'accepted contract and warranty cannot be rewritten');
  }finally{await t.close()}
});
