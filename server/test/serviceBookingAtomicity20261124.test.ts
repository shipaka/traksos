import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';

// STO-BOOKING-STATE-ACL-20261124. Actual HTTP + temporary PostgreSQL,
// every person, truck, bank amount and center below are synthetic.
test('СТО: concurrent replies, steps, confirmation and cancellation are one-shot', {timeout:120_000}, async () => {
  const t=await setup();
  try {
    const admin=await t.login('+79996841001');
    const owner=await t.login('+79996841002');
    const service=await t.login('+79996841003','service');
    const center=ok(await t.api('PUT','/api/base',{
      name:'Контрольная рембаза конкурентных заявок',
      address:'Санкт-Петербург, учебная стоянка 12',
      staff:{electric:'own'},accepts:['quick','day']
    },service.token)).center;
    ok(await t.api('POST',`/api/admin/services/${center.id}/verify`,{
      decision:'approved'
    },(await t.login('+79990000001')).token));
    const vehicle=ok(await t.api('POST','/api/vehicles',{
      brand:'Scania',model:'R',year:2018,plate:'А911АА178'
    },owner.token));
    const day=new Date(t.clock.now().getTime()+3*3600_000).toISOString().slice(0,10);
    const create=()=>t.api('POST',`/api/services/${center.id}/book`,{
      vehicleId:vehicle.id,need:'electric',day,arrival:'self'
    },owner.token);
    const first=ok(await create());

    const dual=async(path:string,body:unknown,token:string)=>{
      const [left,right]=await Promise.all([
        t.api('POST',path,body,token),t.api('POST',path,body,token)
      ]);
      const statuses=[left.status,right.status].sort();
      assert.deepEqual(statuses,[200,409],
        path+' must have one committed state transition, not two 200s: '+
        JSON.stringify([left,right]));
      return left.status===200?left.body:right.body;
    };

    await dual(`/api/base/bookings/${first.id}/respond`,{
      action:'accept',time:'14:30'
    },service.token);
    assert.equal(ok(await t.api('GET',`/api/bookings/${first.id}`,undefined,owner.token)).status,'expected');
    await dual(`/api/base/bookings/${first.id}/status`,{status:'arrived'},service.token);
    await dual(`/api/base/bookings/${first.id}/ready`,{works:['Электрика']},service.token);
    const invoice=ok(await t.api('POST',`/api/base/bookings/${first.id}/invoice`,{
      amount:200_000,partsAmount:0
    },service.token));
    assert.equal(invoice.status,'invoiced');
    await dual(`/api/bookings/${first.id}/confirm`,{
      agree:true,stars:5,text:'Работы сверены'
    },owner.token);
    assert.equal(ok(await t.api('GET',`/api/bookings/${first.id}`,undefined,owner.token)).status,'closed');

    const second=ok(await create());
    await dual(`/api/base/bookings/${second.id}/respond`,{
      action:'clarify',q:'Уточните модель генератора'
    },service.token);
    await dual(`/api/bookings/${second.id}/answer`,{
      text:'Установлен новый генератор'
    },owner.token);
    const third=ok(await create());
    await dual(`/api/bookings/${third.id}/cancel`,{},owner.token);
    assert.equal(ok(await t.api('GET',`/api/bookings/${third.id}`,undefined,owner.token)).status,'cancelled');

    // A forged fromOrderId must NEVER silently be ignored and must not
    // grant a master-referral discount for a center the master never advised.
    const unrelated=ok(await t.api('POST','/api/orders',{
      service:'electric',vehicleId:vehicle.id,zoneId:'spb',
      description:'Учебная диагностика перед СТО'
    },owner.token)).order;
    const forged=await t.api('POST',`/api/services/${center.id}/book`,{
      vehicleId:vehicle.id,need:'electric',day,arrival:'self',
      fromOrderId:unrelated.id
    },owner.token);
    assert.equal(forged.status,403,
      'Only a real recommendation to this exact workshop can activate a referral');
    // Admin remains independent of station and customer roles. A direct
    // service-level manual payout check cannot be invoked by arbitrary users.
    await assert.rejects(
      ()=>t.app.centers.markPaidOut({id:owner.id,phone:'',name:null,
        roles:['client'],owner_id:null,status:'active'},first.id,'FORGED-PAYOUT'),
      (e:any)=>e?.status===403
    );
    void admin;
  } finally {await t.close();}
});

test('СТО: former fleet driver loses booking and archive on vehicle transfer', {timeout:120_000}, async () => {
  const t=await setup();
  try{
    const admin=await t.login('+79990000001');
    const ownerA=await t.login('+79996842001');
    const ownerB=await t.login('+79996842002');
    const driver=await t.login('+79996842003','driver');
    const service=await t.login('+79996842004','service');
    const center=ok(await t.api('PUT','/api/base',{
      name:'Учебная СТО для проверки отзыва',
      address:'Санкт-Петербург, учебная ремзона 45',
      staff:{electric:'own'}
    },service.token)).center;
    ok(await t.api('POST',`/api/admin/services/${center.id}/verify`,{
      decision:'approved'
    },admin.token));
    const carBody=(plate:string)=>({brand:'DAF',model:'XF',year:2016,plate});
    const carA=ok(await t.api('POST','/api/vehicles',carBody('А912АА178'),ownerA.token));
    const carB=ok(await t.api('POST','/api/vehicles',carBody('А913АА178'),ownerB.token));
    const qrA=ok(await t.api('GET','/api/fleet',undefined,ownerA.token))
      .cars.find((x:any)=>x.id===carA.id).qrCode;
    const qrB=ok(await t.api('GET','/api/fleet',undefined,ownerB.token))
      .cars.find((x:any)=>x.id===carB.id).qrCode;
    ok(await t.api('POST','/api/qr/'+qrA+'/join',{},driver.token));
    const day=new Date(t.clock.now().getTime()+3*3600_000).toISOString().slice(0,10);
    const booking=ok(await t.api('POST',`/api/services/${center.id}/book`,{
      vehicleId:carA.id,need:'electric',day,arrival:'self'
    },driver.token));
    assert.equal(booking.status,'new');
    assert.equal((await t.api('GET',`/api/bookings/${booking.id}`,undefined,driver.token)).status,200);
    assert.ok(ok(await t.api('GET','/api/bookings',undefined,driver.token))
      .some((x:any)=>x.id===booking.id));

    ok(await t.api('POST',`/api/fleet/vehicles/${carA.id}/new-qr`,{},ownerA.token));
    ok(await t.api('POST','/api/qr/'+qrB+'/join',{},driver.token));
    assert.equal((await t.api('GET',`/api/bookings/${booking.id}`,undefined,driver.token)).status,403);
    assert.equal(ok(await t.api('GET','/api/bookings',undefined,driver.token))
      .some((x:any)=>x.id===booking.id),false);
    assert.equal((await t.api('POST',`/api/bookings/${booking.id}/cancel`,{},driver.token)).status,404);
    assert.equal((await t.api('POST',`/api/bookings/${booking.id}/answer`,{
      text:'Попытка старого водителя'
    },driver.token)).status,404);
    assert.equal((await t.api('GET',`/api/bookings/${booking.id}`,undefined,ownerA.token)).status,200);
    assert.equal((await t.api('GET',`/api/bookings/${booking.id}`,undefined,ownerB.token)).status,403);
    assert.equal((await t.api('POST',`/api/services/${center.id}/book`,{
      vehicleId:carA.id,need:'electric',day,arrival:'self'
    },driver.token)).status,404,
      'new employer does not own old truck');
    assert.equal((await t.api('POST',`/api/services/${center.id}/book`,{
      need:'electric',day,arrival:'self'
    },driver.token)).status,403,
      'driver without an assigned vehicle cannot book without truck');
  }finally{await t.close()}
});
