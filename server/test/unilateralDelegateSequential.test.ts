// #172: real PostgreSQL/HTTP sequential delegation acceptance.
// Complement the concurrent vehicle-detachment regression, without sharing
// fixtures or changing live business/payment rules.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';
import type {AuthUser} from '../src/http/router.ts';

test('emergency notices and disputes respect current driver delegation', {timeout:120000}, async()=>{
  const t=await setup();
  try{
    assert.equal(t.db.driver,'pg');
    const performer=await t.login('+79997809310','master');
    const scenarios=['active_then_revoked','blocked','soft_deleted','detached'] as const;
    for(const [i,scenario] of scenarios.entries()){
      const owner=await t.login('+7999780932'+i);
      const driver=await t.login('+7999780933'+i);
      const vehicleId=ok(await t.api('POST','/api/vehicles',{
        brand:'DAF',model:'XF',plate:'а32'+i+'км178'
      },owner.token)).id;
      const fleet=ok(await t.api('GET','/api/fleet',undefined,owner.token));
      const qr=fleet.cars[0].qrCode;
      ok(await t.api('POST','/api/qr/'+qr+'/join',{},driver.token));
      const actor=await t.db.one<AuthUser>(
        'select id,phone,name,roles,status,owner_id from users where id=$1',[driver.id]);
      assert.ok(actor?.roles.includes('driver'));
      const order=ok(await t.api('POST','/api/orders',{
        service:'electric',zoneId:'spb',vehicleId,paymentMethod:'cash',
        description:'Учебная диагностика для проверки полномочий'
      },driver.token)).order;
      // Actual API-created order, with only the dispatch/quote state seeded
      // as in the existing emergency-flow integration fixture.
      await t.db.query(
        "update orders set performer_id=$2,status='awaiting_confirmation',work_amount=240000,amount_proposed_at=$3 where id=$1",
        [order.id,performer.id,t.clock.now()]);
      const original=await t.db.one('select client_id,created_by,vehicle_id from orders where id=$1',[order.id]);
      assert.equal(original?.client_id,owner.id);
      assert.equal(original?.created_by,driver.id);
      assert.equal(original?.vehicle_id,vehicleId);
      const paymentsBefore=await t.db.query('select id,status from payments where order_id=$1 order by id',[order.id]);
      if(scenario==='blocked')
        await t.db.query("update users set status='blocked' where id=$1",[driver.id]);
      if(scenario==='soft_deleted')
        // Deliberately retain active status and link to test deleted_at itself.
        await t.db.query('update users set deleted_at=$2 where id=$1',[driver.id,t.clock.now()]);
      if(scenario==='detached')
        ok(await t.api('POST','/api/fleet/vehicles/'+vehicleId+'/new-qr',{},owner.token));
      const close=ok(await t.api('POST','/api/orders/'+order.id+'/emergency-close',{
        requestKey:'delegate-sequential-20261125-'+i,reason:'client_offline',
        note:'Диагностика завершена, заказчик вне зоны связи',workFinished:true
      },performer.token));
      assert.equal(close.status,'pending_client',scenario);
      const recipients=async(kind:string)=>(await t.db.query<{user_id:string}>(
        "select user_id from notifications where kind=$1 and data->>'orderId'=$2 order by user_id",
        [kind,order.id])).map(x=>x.user_id);
      assert.deepEqual(await recipients('unilateral_pending'),
        (scenario==='active_then_revoked'?[owner.id,driver.id]:[owner.id]).sort(),scenario);
      if(scenario==='active_then_revoked')
        ok(await t.api('POST','/api/fleet/vehicles/'+vehicleId+'/new-qr',{},owner.token));
      // A request that already authenticated before revocation must be
      // denied by the service itself, not just by the HTTP auth gate.
      assert.ok(actor);
      await assert.rejects(t.app.unilateral.disagree(actor,order.id,
        'Проверка старых полномочий водителя после отзыва'),{code:'forbidden'},scenario);
      assert.equal((await t.db.one('select status from order_unilateral_closures where order_id=$1',[order.id]))?.status,'pending_client');
      t.clock.advance(3601);
      assert.deepEqual(await t.app.unilateral.tickSla({reminderHours:1,escalationHours:2}),
        {reminded:1,escalated:0},scenario);
      assert.deepEqual(await recipients('unilateral_reminder'),[owner.id],scenario);
      const dispute=ok(await t.api('POST','/api/orders/'+order.id+'/emergency-dispute',{
        reason:'Владелец просит модерацию проверить результат диагностики'
      },owner.token));
      assert.equal(dispute.status,'disputed');
      assert.equal((await t.db.one<{n:number}>(
        "select count(*)::int n from mod_cases where order_id=$1 and kind='dispute'",[order.id]))?.n,1);
      const state=await t.db.one('select status,amount_confirmed_at,completed_at from orders where id=$1',[order.id]);
      assert.equal(state?.status,'awaiting_confirmation');
      assert.equal(state?.amount_confirmed_at,null);
      assert.equal(state?.completed_at,null);
      assert.deepEqual(await t.db.query('select id,status from payments where order_id=$1 order by id',[order.id]),paymentsBefore);
    }
  }finally{await t.close();}
});
