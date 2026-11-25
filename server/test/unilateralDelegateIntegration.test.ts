// #172: actual PostgreSQL race, not a mocked SQL predicate.
// A fleet owner revokes the assignment while the emergency-close HTTP
// transaction is choosing recipients. The stale driver must not be notified.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {setup,ok} from './helpers.ts';

test('emergency recipient selection waits for concurrent vehicle detachment',async()=>{
  const t=await setup();
  let pending:ReturnType<typeof t.api>|undefined;
  try{
    assert.equal(t.db.driver,'pg','requires real PostgreSQL row locks');
    const owner=await t.login('+79997809211');
    const driver=await t.login('+79997809212');
    const performer=await t.login('+79997809213','master');
    const vehicleId=ok(await t.api('POST','/api/vehicles',{
      brand:'DAF',model:'XF',plate:'а321км178'
    },owner.token)).id;
    const fleet=ok(await t.api('GET','/api/fleet',undefined,owner.token));
    const qr=fleet.cars.find((v:any)=>v.id===vehicleId)?.qrCode??fleet.cars[0].qrCode;
    ok(await t.api('POST','/api/qr/'+qr+'/join',{},driver.token));
    const order=ok(await t.api('POST','/api/orders',{
      service:'electric',zoneId:'spb',vehicleId,description:'Синтетическая диагностика'
    },driver.token)).order;
    // Isolate the completion endpoint from dispatch, GPS and billing fixtures.
    // The created order and actual fleet relationship are real API records.
    await t.db.query("update orders set performer_id=$2,status='awaiting_confirmation',work_amount=240000,amount_proposed_at=$3 where id=$1",
      [order.id,performer.id,t.clock.now()]);
    const existing=await t.db.one('select client_id,created_by,vehicle_id from orders where id=$1',[order.id]);
    assert.equal(existing?.client_id,owner.id);
    assert.equal(existing?.created_by,driver.id);
    assert.equal(existing?.vehicle_id,vehicleId);
    const endpoint='/api/orders/'+order.id+'/emergency-close';
    const payload={requestKey:'race-detachment-20261125',reason:'client_offline',
      note:'Диагностика завершена, клиент вне зоны связи',workFinished:true};
    let observedLock=false;
    await t.db.tx(async q=>{
      // This update holds the actual vehicle row until this transaction commits.
      await q.query('update vehicles set driver_id=null where id=$1 and driver_id=$2',[vehicleId,driver.id]);
      pending=t.api('POST',endpoint,payload,performer.token);
      // Wait for PostgreSQL evidence of the concurrent SELECT blocking on the
      // held row. Do not rely on an arbitrary sleep as evidence of concurrency.
      const deadline=Date.now()+10000;
      while(Date.now()<deadline){
        // PostgreSQL caches statistics snapshots within a transaction.
        await q.query('select pg_stat_clear_snapshot()');
        const waiting=await q.one("select pid from pg_stat_activity where pid<>pg_backend_pid() and wait_event_type='Lock' and query like $1 limit 1",
          ['%limit 1 for share of u,v%']);
        if(waiting){observedLock=true;break;}
        await delay(25);
      }
    }); // Commit detachment, allowing the waiting SELECT to recheck its predicate.
    assert.ok(pending);
    const result=await pending;
    assert.ok(observedLock,'did not observe emergency recipient query waiting on the vehicle row');
    const closure=ok(result);
    assert.equal(closure.status,'pending_client');
    const recipients=await t.db.query<{user_id:string}>(
      "select user_id from notifications where kind='unilateral_pending' and data->>'orderId'=$1 order by user_id",
      [order.id]);
    assert.deepEqual(recipients.map(x=>x.user_id),[owner.id]);
    assert.equal((await t.db.one('select driver_id from vehicles where id=$1',[vehicleId]))?.driver_id,null);
    assert.equal((await t.db.one('select status from orders where id=$1',[order.id]))?.status,'awaiting_confirmation');
    assert.equal((await t.db.one('select status from order_unilateral_closures where order_id=$1',[order.id]))?.status,'pending_client');
  }finally{
    if(pending)await pending.catch(()=>{});
    await t.close();
  }
});
