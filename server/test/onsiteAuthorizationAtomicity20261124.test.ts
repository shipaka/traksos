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


test('parallel wait/resume calls charge waiting only once and preserve one system message',async()=>{
  await t.db.query("update orders set status='arrived',wait_started_at=null,wait_minutes=0,part_mode=null where id=$1",[orderId]);
  const waiting=await Promise.all(Array.from({length:10},()=>t.api(
    'POST',`/api/orders/${orderId}/part`,{mode:'wait'},master.token)));
  assert.ok(waiting.every(x=>x.status===200),JSON.stringify(waiting.map(x=>[x.status,x.body?.error])));
  const count=await t.db.one<{n:number}>(`select count(*)::int as n from order_events
    where order_id=$1 and type='part' and data->>'mode'='wait'`,[orderId]);
  assert.equal(count?.n,1,'repeated wait does not issue repeated financial events');
  const messages=await t.db.one<{n:number}>(`select count(*)::int as n
    from chat_messages where order_id=$1 and kind='system'
      and body like 'Нужна запчасть — мастер ждёт.%'`,[orderId]);
  assert.equal(messages?.n,1,'one durable system message per actual transition');
  const resumed=await Promise.all(Array.from({length:8},()=>t.api(
    'POST',`/api/orders/${orderId}/part`,{mode:'resume'},master.token)));
  assert.equal(resumed.filter(x=>x.status===200).length,1);
  assert.ok(resumed.filter(x=>x.status!==200).every(x=>x.status===409&&x.body.error==='not_waiting'));
  const order=await t.db.one<{wait_minutes:number;wait_started_at:Date|null}>(
    'select wait_minutes,wait_started_at from orders where id=$1',[orderId]);
  assert.equal(order?.wait_started_at,null);
  assert.equal(order?.wait_minutes,1,'parallel resume never charges the same wait twice');
});

test('system-message failure rolls back waiting timer, audit and all state',async()=>{
  const before=await t.db.one<any>(
    'select wait_minutes,wait_started_at,part_mode from orders where id=$1',[orderId]);
  const eventCount=await events();
  await t.db.exec(`create function refuse_onsite_chat() returns trigger as $$
    begin if NEW.kind='system' and NEW.body like 'Нужна запчасть%' then
      raise exception 'test-only forced chat failure';
    end if;return NEW;end $$ language plpgsql;
    create trigger test_refuse_part_chat before insert on chat_messages
      for each row execute function refuse_onsite_chat();`);
  try{
    const failed=await t.api('POST',`/api/orders/${orderId}/part`,{mode:'wait'},master.token);
    assert.equal(failed.status,500);
    assert.deepEqual(await t.db.one<any>(
      'select wait_minutes,wait_started_at,part_mode from orders where id=$1',[orderId]),before);
    assert.deepEqual(await events(),eventCount);
  }finally{
    await t.db.exec('drop trigger test_refuse_part_chat on chat_messages; drop function refuse_onsite_chat();');
  }
});
