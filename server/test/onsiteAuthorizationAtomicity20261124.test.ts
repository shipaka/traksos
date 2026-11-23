import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

let t:T;
let owner:{id:string;token:string};
let otherOwner:{id:string;token:string};
let master:{id:string;token:string};
let stranger:{id:string;token:string};
let orderId:string;
let vehicleId:string;
const events=async()=>t.db.one<{n:number}>(
  'select count(*)::int as n from order_events where order_id=$1',[orderId]);

before(async()=>{
  t=await setup();
  owner=await t.login('+79994421001');
  otherOwner=await t.login('+79994421002');
  master=await t.login('+79994421003','master');
  stranger=await t.login('+79994421004','master');
  vehicleId=ok(await t.api('POST','/api/vehicles',{
    brand:'Scania',model:'R',year:2018,plate:'Р321МН178',
  },owner.token)).id;
  orderId=ok(await t.api('POST','/api/orders',{
    service:'electric',zoneId:'spb',vehicleId,description:'Требуется ремонт в тестовом гараже',
  },owner.token)).order.id;
  await t.db.query(
    "update orders set performer_id=$2,status='accepted',accepted_at=now() where id=$1",
    [orderId,master.id]);
});
after(()=>t.close());

test('any unrelated worker must NOT blacklist an owner using a known order UUID',async()=>{
  const bad=await t.api('POST',`/api/orders/${orderId}/block-client`,{
    on:true,reason:'Чужое ложное обращение',
  },stranger.token);
  assert.equal(bad.status,403);
  const row=await t.db.one<{n:number}>(`select count(*)::int as n
    from performer_blocks where performer_id=$1 and client_id=$2`,
    [stranger.id,owner.id]);
  assert.equal(row?.n,0);
  const assigned=ok(await t.api('POST',`/api/orders/${orderId}/block-client`,{
    on:true,reason:'Не брать новых заявок',
  },master.token));
  assert.equal(assigned.blocked,true);
  assert.equal(ok(await t.api('GET','/api/performer/blacklist',
    undefined,master.token)).length,1);
  ok(await t.api('POST',`/api/orders/${orderId}/block-client`,{on:false},master.token));
});

test('vehicle correction requires a current active job, never a stale completed order',async()=>{
  const early=await t.api('POST',`/api/orders/${orderId}/vehicle`,{
    model:'R 500',year:2017,
  },master.token);
  assert.equal(early.status,409);
  await t.db.query("update orders set status='arrived',arrived_at=now() where id=$1",[orderId]);
  const corrected=ok(await t.api('POST',`/api/orders/${orderId}/vehicle`,{
    model:'R 500',year:2017,axles:3,
  },master.token));
  assert.equal(corrected.vehicle.year,2017);
  assert.equal(corrected.vehicle.axles,3);
  assert.equal((await t.db.one<{model:string}>(
    'select model from vehicles where id=$1',[vehicleId]))?.model,'R 500');
  await t.db.query("update orders set status='completed',completed_at=now() where id=$1",[orderId]);
  const before=await events();
  const after=await t.api('POST',`/api/orders/${orderId}/vehicle`,{
    model:'Wrong update',year:2000,
  },master.token);
  assert.equal(after.status,409);
  assert.equal((await t.db.one<{year:number}>(
    'select year from vehicles where id=$1',[vehicleId]))?.year,2017);
  assert.deepEqual(await events(),before);
});

test('a transferred truck must not be edited through its historical order',async()=>{
  await t.db.query("update orders set status='arrived' where id=$1",[orderId]);
  await t.db.query('update vehicles set owner_id=$2 where id=$1',
    [vehicleId,otherOwner.id]);
  const old=await t.db.one<{model:string;year:number}>(
    'select model,year from vehicles where id=$1',[vehicleId]);
  const eventsBefore=await events();
  const denied=await t.api('POST',`/api/orders/${orderId}/vehicle`,{
    model:'Cross-fleet corruption',year:1999,
  },master.token);
  assert.equal(denied.status,409);
  assert.deepEqual(await t.db.one<{model:string;year:number}>(
    'select model,year from vehicles where id=$1',[vehicleId]),old);
  assert.deepEqual(await events(),eventsBefore);
  await t.db.query('update vehicles set owner_id=$2 where id=$1',[vehicleId,owner.id]);
});

test('failed audit INSERT rolls back both vehicle and order state',async()=>{
  await t.db.exec(`create function refuse_onsite_audit() returns trigger as $$
    begin if NEW.type='vehicle_fixed' then
      raise exception 'intentional audit storage failure';
    end if;return NEW;end $$ language plpgsql;
    create trigger test_refuse_vehicle_audit before insert on order_events
      for each row execute function refuse_onsite_audit();`);
  const beforeVehicle=await t.db.one<any>(
    'select brand,model,year,axles,fixed_by from vehicles where id=$1',[vehicleId]);
  const beforeOrder=await t.db.one<any>(
    'select brand,model,year from orders where id=$1',[orderId]);
  try{
    const failed=await t.api('POST',`/api/orders/${orderId}/vehicle`,{
      brand:'Volvo',model:'Changed only if audit commits',year:2020,
    },master.token);
    assert.equal(failed.status,500);
    assert.deepEqual(await t.db.one<any>(
      'select brand,model,year,axles,fixed_by from vehicles where id=$1',[vehicleId]),
      beforeVehicle);
    assert.deepEqual(await t.db.one<any>(
      'select brand,model,year from orders where id=$1',[orderId]),beforeOrder);
  }finally{
    await t.db.exec('drop trigger test_refuse_vehicle_audit on order_events; drop function refuse_onsite_audit();');
  }
});
