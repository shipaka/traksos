import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Db} from '../src/db/index.ts';
import {Notifier} from '../src/services/notify.ts';
import {sendInsuranceReminders} from '../src/services/insuranceReminders.ts';
import {setup,ok} from './helpers.ts';

test('insurance expiry reminders: a consent withdrawal between scan and claim never creates an alert', {timeout:60000},async()=>{
 const t=await setup();
 try{
  const owner=await t.login('+79996672101');
  const vehicle=ok(await t.api('POST','/api/vehicles',{
   brand:'Scania',model:'R',year:2018,plate:'А554АА178',
  },owner.token));
  const request=ok(await t.api('POST','/api/vehicle-service-requests',{
   vehicleId:vehicle.id,kind:'insurance',comment:'Контроль напоминаний перед обновлением ОСАГО',
  },owner.token));
  await t.db.query(
   "update vehicle_service_requests set status='completed',policy_expires_on=current_date + 30 where id=$1",
   [request.id]);
  await t.db.query('update users set insurance_reminders_enabled=true where id=$1',[owner.id]);
  let flipped=false;
  const raced={
   query:async(sql:string,params?:any[])=>{
    const result=await t.db.query(sql,params);
    if(!flipped&&sql.includes('from vehicle_service_requests r')&&params?.[0]===30){
     flipped=true;
     await t.db.query('update users set insurance_reminders_enabled=false where id=$1',[owner.id]);
    }
    return result;
   },
   one:(sql:string,params?:any[])=>t.db.one(sql,params),
   tx:t.db.tx.bind(t.db),
  } as unknown as Db;
  const notifier=new Notifier(t.db,t.app.hub,t.push);
  await sendInsuranceReminders(raced,notifier);
  assert.equal(flipped,true,'the scan reached a matching due policy');
  assert.equal((await t.db.one<{n:number}>(
   "select count(*)::int as n from notifications where user_id=$1 and kind='insurance_expiry'",
   [owner.id]))?.n,0,'the claim must re-evaluate the live consent flag');
  assert.equal((await t.db.one<{reminder_30_sent_at:Date|null}>(
   'select reminder_30_sent_at from vehicle_service_requests where id=$1',
   [request.id]))?.reminder_30_sent_at,null,'a failed claim never marks the reminder sent');

  await t.db.query('update users set insurance_reminders_enabled=true where id=$1',[owner.id]);
  await sendInsuranceReminders(t.db,notifier);
  await sendInsuranceReminders(t.db,notifier);
  assert.equal((await t.db.one<{n:number}>(
   "select count(*)::int as n from notifications where user_id=$1 and kind='insurance_expiry'",
   [owner.id]))?.n,1,'once reenabled, one notification is delivered and retries are idempotent');
 }finally{await t.close();}
});

test('insurance expiry reminders: pagination processes beyond the first 500 due policies', {timeout:120000},async()=>{
 const t=await setup();
 try{
  const owner=await t.login('+79996672102');
  const vehicle=ok(await t.api('POST','/api/vehicles',{
   brand:'MAN',model:'TGX',year:2019,plate:'А555АА178',
  },owner.token));
  await t.db.query('update users set insurance_reminders_enabled=true where id=$1',[owner.id]);
  // Synthetic completed policy fixtures on a disposable test database.
  await t.db.query(`
   insert into vehicle_service_requests
     (owner_id,requested_by,vehicle_id,kind,status,policy_expires_on)
   select $1,$1,$2,'insurance','completed',current_date + 30
   from generate_series(1,501)`,[owner.id,vehicle.id]);
  const notifier=new Notifier(t.db,t.app.hub,t.push);
  await sendInsuranceReminders(t.db,notifier);
  const delivered=await t.db.one<{n:number}>(
   "select count(*)::int as n from notifications where user_id=$1 and kind='insurance_expiry'",
   [owner.id]);
  assert.equal(delivered?.n,501,'UUID cursor must reach all 501 completed due records');
  assert.equal((await t.db.one<{n:number}>(`
   select count(*)::int as n from vehicle_service_requests
   where owner_id=$1 and reminder_30_sent_at is not null`,[owner.id]))?.n,501);
  await sendInsuranceReminders(t.db,notifier);
  assert.equal((await t.db.one<{n:number}>(
   "select count(*)::int as n from notifications where user_id=$1 and kind='insurance_expiry'",
   [owner.id]))?.n,501,'a second scheduler call is not a second reminder');
 }finally{await t.close();}
});

test('insurance expiry reminders: inbox failure rolls back marker, parallel retry stores exactly once', {timeout:60000},async()=>{
 const t=await setup();
 try{
  const owner=await t.login('+79996672103');
  const vehicle=ok(await t.api('POST','/api/vehicles',{
   brand:'Scania',model:'R',year:2018,plate:'А556АА178',
  },owner.token));
  const request=ok(await t.api('POST','/api/vehicle-service-requests',{
   vehicleId:vehicle.id,kind:'insurance',comment:'Проверка атомарного напоминания ОСАГО',
  },owner.token));
  await t.db.query("update vehicle_service_requests set status='completed',policy_expires_on=current_date + 7 where id=$1",[request.id]);
  await t.db.query('update users set insurance_reminders_enabled=true where id=$1',[owner.id]);
  const notifier=new Notifier(t.db,t.app.hub,t.push);
  // Fail the actual SQL inbox write after the reminder marker has been set.
  await t.db.exec(`create function fail_insurance_reminder_inbox() returns trigger language plpgsql as $$
   begin
    if new.kind='insurance_expiry' then raise exception 'insurance inbox fault'; end if;
    return new;
   end; $$;
   create trigger fail_insurance_reminder_inbox before insert on notifications
   for each row execute function fail_insurance_reminder_inbox();`);
  await assert.rejects(sendInsuranceReminders(t.db,notifier),/insurance inbox fault/);
  assert.equal((await t.db.one<{reminder_7_sent_at:Date|null}>(
   'select reminder_7_sent_at from vehicle_service_requests where id=$1',[request.id]))?.reminder_7_sent_at,null);
  assert.equal((await t.db.one<{n:number}>(
   "select count(*)::int as n from notifications where user_id=$1 and kind='insurance_expiry'",[owner.id]))?.n,0);
  await t.db.exec('drop trigger fail_insurance_reminder_inbox on notifications; drop function fail_insurance_reminder_inbox();');
  await Promise.all(Array.from({length:6},()=>sendInsuranceReminders(t.db,notifier)));
  assert.equal((await t.db.one<{n:number}>(
   "select count(*)::int as n from notifications where user_id=$1 and kind='insurance_expiry'",[owner.id]))?.n,1);
  assert.ok((await t.db.one<{reminder_7_sent_at:Date|null}>(
   'select reminder_7_sent_at from vehicle_service_requests where id=$1',[request.id]))?.reminder_7_sent_at);
 }finally{await t.close();}
});

test('insurance expiry reminders: lost live delivery never duplicates the durable inbox', {timeout:60000},async()=>{
 const t=await setup();
 try{
  const owner=await t.login('+79996672104');
  const vehicle=ok(await t.api('POST','/api/vehicles',{
   brand:'MAN',model:'TGX',year:2019,plate:'А557АА178',
  },owner.token));
  const request=ok(await t.api('POST','/api/vehicle-service-requests',{
   vehicleId:vehicle.id,kind:'insurance',comment:'Проверка сбоя доставки напоминания',
  },owner.token));
  await t.db.query("update vehicle_service_requests set status='completed',policy_expires_on=current_date + 1 where id=$1",[request.id]);
  await t.db.query('update users set insurance_reminders_enabled=true where id=$1',[owner.id]);
  const notifier=new Notifier(t.db,t.app.hub,t.push);
  let attempts=0;
  const broken={deliverStored:async()=>{attempts++;throw new Error('simulated live failure');}} as unknown as Notifier;
  await sendInsuranceReminders(t.db,broken);
  await sendInsuranceReminders(t.db,notifier);
  assert.equal(attempts,1);
  assert.equal((await t.db.one<{n:number}>(
   "select count(*)::int as n from notifications where user_id=$1 and kind='insurance_expiry'",[owner.id]))?.n,1);
  assert.ok((await t.db.one<{reminder_1_sent_at:Date|null}>(
   'select reminder_1_sent_at from vehicle_service_requests where id=$1',[request.id]))?.reminder_1_sent_at);
 }finally{await t.close();}
});

test('insurance expiry reminders: scan never freezes a previous vehicle plate', {timeout:60000},async()=>{
 const t=await setup();
 try{
  const owner=await t.login('+79996672105');
  const vehicle=ok(await t.api('POST','/api/vehicles',{
   brand:'MAN',model:'TGX',year:2019,plate:'А558АА178',
  },owner.token));
  const request=ok(await t.api('POST','/api/vehicle-service-requests',{
   vehicleId:vehicle.id,kind:'insurance',comment:'Проверка актуального номера машины',
  },owner.token));
  await t.db.query("update vehicle_service_requests set status='completed',policy_expires_on=current_date + 30 where id=$1",[request.id]);
  await t.db.query('update users set insurance_reminders_enabled=true where id=$1',[owner.id]);
  let changed=false;
  const raced={
   query:async(sql:string,params?:any[])=>{
    const result=await t.db.query(sql,params);
    if(!changed&&sql.includes('from vehicle_service_requests r')&&params?.[0]===30){
     changed=true;
     await t.db.query('update vehicles set plate=$2 where id=$1',[vehicle.id,'А559АА178']);
    }
    return result;
   },
   tx:t.db.tx.bind(t.db),
  } as unknown as Db;
  await sendInsuranceReminders(raced,new Notifier(t.db,t.app.hub,t.push));
  assert.equal(changed,true);
  const row=await t.db.one<{body:string}>(
   "select body from notifications where user_id=$1 and kind='insurance_expiry'",[owner.id]);
  assert.ok(row);
  assert.match(row.body,/А559АА178/);
  assert.doesNotMatch(row.body,/А558АА178/);
 }finally{await t.close();}
});
