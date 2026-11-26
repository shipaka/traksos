// #170: stale authenticated actors cannot read private calendar entries after
// account or fleet revocation. Real disposable PostgreSQL, no external traffic.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';
import {clientCalendar} from '../src/services/clientCalendar.ts';
import type {AuthUser} from '../src/http/router.ts';

test('both calendar sources revalidate live customer identity and delegated fleet access', {timeout:60000}, async()=>{
  const t=await setup();
  try{
    assert.equal(t.db.driver,'pg');
    const owner=await t.login('+79997810421');
    const driver=await t.login('+79997810422');
    const station=await t.login('+79997810423','service');
    const master=await t.login('+79997810424','master');
    const stranger=await t.login('+79997810425');
    const vehicle=ok(await t.api('POST','/api/vehicles',{
      brand:'DAF',model:'XF',plate:'а482км178'
    },owner.token)).id;
    const qr=ok(await t.api('GET','/api/fleet',undefined,owner.token)).cars[0].qrCode;
    ok(await t.api('POST','/api/qr/'+qr+'/join',{},driver.token));
    const center=await t.db.one<any>(
      "insert into service_centers(owner_id,name,address) values($1,'Учебная СТО','Тестовый адрес') returning id",[station.id]);
    const booking=await t.db.one<any>(`insert into service_bookings
      (center_id,client_id,created_by,vehicle_id,vehicle,need,when_day,when_time)
      values($1,$2,$3,$4,'{"brand":"DAF","model":"XF"}','electric','2026-12-02','11:00') returning id`,
      [center.id,owner.id,driver.id,vehicle]);
    const order=ok(await t.api('POST','/api/orders',{
      service:'electric',zoneId:'spb',vehicleId:vehicle,description:'Учебная заявка календаря'
    },driver.token)).order.id;
    await t.db.query("update orders set status='searching' where id=$1",[order]);
    const reservation=await t.db.one<any>(`insert into performer_time_reservations
      (performer_id,client_id,order_id,starts_at,ends_at)
      values($1,$2,$3,'2026-12-01T21:30:00Z','2026-12-01T22:30:00Z') returning id`,[master.id,owner.id,order]);
    const actor=async(id:string)=>{
      const a=await t.db.one<AuthUser>(
        'select id,phone,name,roles,status,owner_id from users where id=$1',[id]);
      assert.ok(a);return a;
    };
    // Capture the authenticated objects before modifying the database.
    const oldOwner=await actor(owner.id),oldDriver=await actor(driver.id);
    const read=async(a:AuthUser)=>(await clientCalendar(t.db,a,'2026-12-02','2026-12-02')).items.map(x=>x.id).sort();
    const both=[booking.id,reservation.id].sort();
    assert.deepEqual(await read(oldOwner),both);
    assert.deepEqual(await read(oldDriver),both);
    assert.deepEqual(await read(await actor(stranger.id)),[]);
    for(const [who,old] of [[owner,oldOwner],[driver,oldDriver]] as const){
      await t.db.query("update users set status='blocked' where id=$1",[who.id]);
      assert.deepEqual(await read(old),[],'blocked stale actor');
      await t.db.query("update users set status='active',deleted_at=$2 where id=$1",[who.id,t.clock.now()]);
      assert.deepEqual(await read(old),[],'soft-deleted stale actor even with active status');
      await t.db.query("update users set deleted_at=null,roles=array['master']::text[] where id=$1",[who.id]);
      assert.deepEqual(await read(old),[],'revoked live role');
      await t.db.query('update users set roles=$2 where id=$1',[who.id,old.roles]);
      assert.deepEqual(await read(old),both,'restoring legitimate access restores both entries');
    }
    ok(await t.api('POST','/api/fleet/vehicles/'+vehicle+'/new-qr',{},owner.token));
    assert.deepEqual(await read(oldDriver),[],'detached vehicle with stale actor');
    assert.deepEqual(await read(oldOwner),both,'owner retains own history');
  }finally{await t.close();}
});
