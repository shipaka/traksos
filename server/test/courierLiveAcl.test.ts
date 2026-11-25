import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';
import {ShopCourierDeliveries} from '../src/services/shopCourierDeliveries.ts';
import type {AuthUser} from '../src/http/router.ts';

// Actual disposable PostgreSQL, real order/assignment HTTP, then stale
// authenticated service actors to exercise revocation past the router.
test('courier handoff enforces current courier, buyer and fleet access', {timeout:120000},async()=>{
  const t=await setup();
  try{
    const admin=await t.login('+79990000001');
    const owner=await t.login('+79997810511');
    const driver=await t.login('+79997810512');
    const courier=await t.login('+79997810513');
    const other=await t.login('+79997810514');
    await t.db.query("update users set roles=array['courier']::text[] where id=any($1::uuid[])",[[courier.id,other.id]]);
    const actor=async(id:string)=>{
      const user=await t.db.one<AuthUser>('select id,phone,name,roles,status,owner_id from users where id=$1',[id]);
      assert.ok(user);return user;
    };
    const service=new ShopCourierDeliveries(t.db,t.app.notifier);
    const adminActor=await actor(admin.id), ownerActor=await actor(owner.id), courierActor=await actor(courier.id);
    const vehicle=ok(await t.api('POST','/api/vehicles',{brand:'DAF',model:'XF',plate:'а482км178'},owner.token)).id;
    const qr=ok(await t.api('GET','/api/fleet',undefined,owner.token)).cars[0].qrCode;
    ok(await t.api('POST','/api/qr/'+qr+'/join',{},driver.token));
    const driverActor=await actor(driver.id);
    const p=ok(await t.api('POST','/api/admin/shop/products',{name:'Учебный насос',price:9000,stock:10},admin.token));
    ok(await t.api('PUT','/api/admin/settings/shop',{enabled:true,delivery:true},admin.token));
    const create=async(token:string,vehicleId?:string)=>{
      const o=ok(await t.api('POST','/api/shop/orders',{
        items:[{productId:p.id,qty:1}],delivery:'delivery',address:'Учебная доставка',...(vehicleId?{vehicleId}:{})
      },token));
      for(const status of ['confirmed','ready'])
        ok(await t.api('POST','/api/admin/shop/orders/'+o.id+'/status',{status},admin.token));
      return o.id as string;
    };
    const direct=await create(owner.token);
    const fleet=await create(driver.token,vehicle);
    const linked=await t.db.one('select client_id,created_by,vehicle_id from shop_orders where id=$1',[fleet]);
    assert.equal(linked?.client_id,owner.id);
    assert.equal(linked?.created_by,driver.id);
    assert.equal(linked?.vehicle_id,vehicle);
    const assign=async(id:string)=>ok(await t.api('POST','/api/admin/shop/orders/'+id+'/courier',{courierId:courier.id},admin.token)).id as string;
    const d1=await assign(direct),d2=await assign(fleet);
    // A deleted courier with a stale active flag cannot read, take a stage,
    // change availability or be assigned another job.
    await t.db.query('update users set deleted_at=now() where id=$1',[courier.id]);
    assert.deepEqual(await service.list(courierActor),[]);
    await assert.rejects(service.one(courierActor,d1),{code:'not_found'});
    await assert.rejects(service.presence(courierActor),{code:'forbidden'});
    await assert.rejects(service.setPresence(courierActor,true),{code:'forbidden'});
    await assert.rejects(service.progress(courierActor,d1,'picked_up'),{code:'forbidden'});
    await assert.rejects(service.assign(adminActor,direct,courier.id),{code:'invalid_courier'});
    assert.ok(!(await service.candidates()).some(x=>x.id===courier.id));
    await t.db.query('update users set deleted_at=null where id=$1',[courier.id]);
    const notices=async(orderId:string)=>await t.db.query<{user_id:string}>(
      "select user_id from notifications where data->>'shopOrderId'=$1 and title='Доставка запчастей: новый этап' order by id",[orderId]);
    // Progress may still be recorded for dispatch/support, but revoked
    // recipients must not receive new durable business notifications.
    await t.db.query("update users set status='blocked' where id=$1",[owner.id]);
    await service.progress(courierActor,d1,'picked_up');
    assert.deepEqual(await notices(direct),[]);
    await t.db.query("update users set status='active' where id=$1",[owner.id]);
    await t.db.query('update vehicles set driver_id=null where id=$1',[vehicle]);
    await service.progress(courierActor,d2,'picked_up');
    assert.deepEqual((await notices(fleet)).map(x=>x.user_id),[owner.id]);
    await t.db.query('update vehicles set driver_id=$2 where id=$1',[vehicle,driver.id]);
    for(const delivery of [d1,d2])
      for(const stage of ['en_route','arrived'] as const)
        await service.progress(courierActor,delivery,stage);
    const directCode=await service.receiptCode(ownerActor,direct);
    const fleetCode=await service.receiptCode(driverActor,fleet);
    await assert.rejects(service.receiptCode(ownerActor,fleet),{code:'not_found'});
    // No receipt code, verification, reset or completion from stale identity.
    const deny=async(buyer:AuthUser,orderId:string,deliveryId:string,code:string)=>{
      await assert.rejects(service.receiptCode(buyer,orderId),{code:'not_found'});
      await assert.rejects(service.verify(courierActor,deliveryId,code),{code:'receipt_buyer_unavailable'});
      await assert.rejects(service.resetReceipt(adminActor,orderId,'Учебное восстановление после отзыва'),{code:'receipt_buyer_unavailable'});
      await assert.rejects(service.confirmReceived(buyer,orderId),{code:'not_found'});
      const state=await t.db.one('select status,code_attempts from shop_courier_deliveries where id=$1',[deliveryId]);
      assert.equal(state?.status,'arrived');assert.equal(state?.code_attempts,0);
    };
    await t.db.query("update users set roles=array['insurer']::text[] where id=$1",[owner.id]);
    await deny(ownerActor,direct,d1,directCode.code);
    await t.db.query('update users set roles=$2 where id=$1',[owner.id,ownerActor.roles]);
    await t.db.query("update users set status='blocked' where id=$1",[owner.id]);
    await deny(driverActor,fleet,d2,fleetCode.code);
    await t.db.query("update users set status='active',deleted_at=now() where id=$1",[owner.id]);
    await deny(driverActor,fleet,d2,fleetCode.code);
    await t.db.query('update users set deleted_at=null where id=$1',[owner.id]);
    await t.db.query('update users set deleted_at=now() where id=$1',[driver.id]);
    await deny(driverActor,fleet,d2,fleetCode.code);
    await t.db.query('update users set deleted_at=null where id=$1',[driver.id]);
    await t.db.query("update users set roles=array['client']::text[] where id=$1",[driver.id]);
    await deny(driverActor,fleet,d2,fleetCode.code);
    await t.db.query('update users set roles=$2 where id=$1',[driver.id,driverActor.roles]);
    await service.verify(courierActor,d2,fleetCode.code);
    await t.db.query('update vehicles set driver_id=null where id=$1',[vehicle]);
    await assert.rejects(service.confirmReceived(driverActor,fleet),{code:'not_found'});
    await assert.rejects(service.receiptCode(driverActor,fleet),{code:'not_found'});
    assert.equal((await t.db.one('select status from shop_orders where id=$1',[fleet]))?.status,'shipped');
    // Legitimate direct buyer still completes exactly once.
    await service.verify(courierActor,d1,directCode.code);
    assert.equal((await service.confirmReceived(ownerActor,direct)).customerConfirmed,true);
    assert.equal((await t.db.one('select status from shop_orders where id=$1',[direct]))?.status,'done');
  }finally{await t.close();}
});
