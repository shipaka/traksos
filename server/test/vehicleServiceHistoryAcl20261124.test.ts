import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';
import {VehicleServiceRequests} from '../src/services/vehicleServiceRequests.ts';

test('vehicle service history and notification recipients follow live fleet/vehicle ACL, not a stale first read', {timeout:60000}, async()=>{
  const t=await setup();
  try{
    const owner=await t.login('+79997763211');
    const driver=await t.login('+79997763212','driver');
    const other=await t.login('+79997763213','driver');
    const vehicle=ok(await t.api('POST','/api/vehicles',{
      brand:'Scania',model:'R',year:2018,plate:'А921АА178',
    },owner.token));
    const second=ok(await t.api('POST','/api/vehicles',{
      brand:'Scania',model:'G',year:2017,plate:'А922АА178',
    },owner.token));
    ok(await t.api('PUT','/api/fleet',{
      mode:'limit',allow:{insurance:true,inspection:true},
    },owner.token));
    const fleet=ok(await t.api('GET','/api/fleet',undefined,owner.token));
    const qr=fleet.cars.find((v:any)=>v.id===vehicle.id)?.qrCode;
    assert.ok(qr);
    ok(await t.api('POST',`/api/qr/${qr}/join`,{},driver.token));

    const request=ok(await t.api('POST','/api/vehicle-service-requests',{
      vehicleId:vehicle.id,kind:'inspection',comment:'Проверить документы и подготовить осмотр грузовика',
    },owner.token));
    const historyUrl=`/api/vehicles/${vehicle.id}/service-history`;
    const valid=ok(await t.api('GET',historyUrl,undefined,driver.token));
    assert.equal(valid.length,1,'current driver may inspect assigned vehicle service history');
    assert.equal(valid[0].id,request.id);
    assert.ok(ok(await t.api('GET','/api/vehicle-service-requests',undefined,driver.token))
      .some((r:any)=>r.id===request.id));

    // Manufacture a revocation precisely BETWEEN the preliminary vehicle
    // lookup and the history query. A second SQL snapshot must independently
    // reject the old driver rather than trust an earlier successful read.
    let reassigned=false;
    const scopedDb={
      one:async (sql:string,args:unknown[])=>{
        const result=await t.db.one(sql,args);
        if(sql.startsWith('select id, driver_id from vehicles')&&!reassigned){
          reassigned=true;
          await t.db.query('update vehicles set driver_id=null,driver_since=null where id=$1',[vehicle.id]);
        }
        return result;
      },
      query:(sql:string,args:unknown[])=>t.db.query(sql,args),
    } as any;
    const oldDriver={
      id:driver.id,owner_id:owner.id,roles:['driver'],
      status:'active',phone:'+79997763212',name:null,
    };
    const raced=await new VehicleServiceRequests(scopedDb).history(oldDriver,vehicle.id);
    assert.equal(reassigned,true);
    assert.deepEqual(raced,[],'a revoked driver must not receive the preauthorized private history');

    assert.equal((await t.api('GET',historyUrl,undefined,driver.token)).status,404);
    assert.equal(ok(await t.api('GET','/api/vehicle-service-requests',undefined,driver.token))
      .some((r:any)=>r.id===request.id),false);
    const original=ok(await t.api('GET',historyUrl,undefined,owner.token));
    assert.equal(original.length,1,'fleet owner retains history');
    assert.equal(original[0].id,request.id);
    assert.equal((await t.api('GET',historyUrl,undefined,other.token)).status,404);

    // Vehicle association alone is not sufficient if the account has lost its
    // driver role. It must not receive insurance/inspection notifications.
    await t.db.query('update vehicles set driver_id=$2 where id=$1',[vehicle.id,driver.id]);
    await t.db.query("update users set roles=array['client']::text[] where id=$1",[driver.id]);
    const denied=await t.api('GET',historyUrl,undefined,driver.token);
    if(denied.status===200)assert.deepEqual(denied.body,[],
      'a current driver role is required by the history SQL');
    else assert.equal(denied.status,403);
    const events=await new VehicleServiceRequests(t.db).recipients({
      vehicle_id:vehicle.id,owner_id:owner.id,requested_by:driver.id,kind:'inspection',
    } as any);
    assert.deepEqual(events,[owner.id],'former driver role cannot receive private notifications');

    // Restore the legitimate role, assign a different car and verify that
    // the old vehicle's records cannot be read through shared fleet owner_id.
    await t.db.query("update users set roles=array['driver']::text[] where id=$1",[driver.id]);
    ok(await t.api('POST',`/api/vehicles/${second.id}/driver`,
      {phone:'+79997763212'},owner.token));
    assert.equal((await t.api('GET',historyUrl,undefined,driver.token)).status,404);
    assert.equal(ok(await t.api('GET','/api/vehicle-service-requests',undefined,driver.token))
      .some((r:any)=>r.id===request.id),false);
  }finally{await t.close();}
});
