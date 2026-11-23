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
