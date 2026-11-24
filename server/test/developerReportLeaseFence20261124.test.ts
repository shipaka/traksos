import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';
import {DeveloperReportDelivery,type DeveloperReportNotice} from '../src/services/developerReportDelivery.ts';

test('developer report: expired sender cannot acknowledge or reschedule a new worker lease', {timeout:60000},async()=>{
 const t=await setup();
 try{
  const admin=await t.login('+79990000001');
  const entry=ok(await t.api('POST','/api/admin/developer-reports',{
   category:'registration',phone:'+79998889912',
   details:'Нужна проверка задержанной служебной доставки отчёта',
  },admin.token));
  let releaseOld!:()=>void,releaseNew!:()=>void;
  let oldStarted!:()=>void,newStarted!:()=>void;
  const firstStarted=new Promise<void>(r=>{oldStarted=r});
  const secondStarted=new Promise<void>(r=>{newStarted=r});
  const oldPending=new Promise<void>(r=>{releaseOld=r});
  const newPending=new Promise<void>(r=>{releaseNew=r});
  const seen:DeveloperReportNotice[]=[];
  const firstWorker=new DeveloperReportDelivery(t.db,async item=>{
   seen.push(item);oldStarted();await oldPending;
  });
  const secondWorker=new DeveloperReportDelivery(t.db,async item=>{
   seen.push(item);newStarted();await newPending;
  });
  const firstRun=firstWorker.tick(1);
  await firstStarted;
  const initial=await t.db.one<{delivery_lease_until:Date}>(
   'select delivery_lease_until from admin_developer_reports where id=$1',[entry.id]);
  assert.ok(initial?.delivery_lease_until);
  // Reproduce a worker running beyond its lease. Its HTTP ACK can arrive after
  // another worker has already started the *same* idempotency-key.
  await t.db.query(
   "update admin_developer_reports set delivery_lease_until=now()-interval '1 second' where id=$1",
   [entry.id]);
  const secondRun=secondWorker.tick(1);
  await secondStarted;
  releaseOld();
  assert.equal(await firstRun,1);
  let current=await t.db.one<any>(
   'select delivery_sent_at,delivery_lease_until,delivery_attempts,delivery_last_error from admin_developer_reports where id=$1',
   [entry.id]);
  assert.equal(current?.delivery_sent_at,null,'stale success cannot mark as delivered');
  assert.equal(current?.delivery_attempts,0,'stale success cannot affect attempt count');
  assert.ok(new Date(current.delivery_lease_until).getTime()>Date.now(),
   'new worker must retain its active lease');
  releaseNew();
  assert.equal(await secondRun,1);
  current=await t.db.one<any>(
   'select delivery_sent_at,delivery_attempts,delivery_lease_until from admin_developer_reports where id=$1',[entry.id]);
  assert.ok(current?.delivery_sent_at,'the current owner acknowledges receipt');
  assert.equal(current.delivery_attempts,1,'only current owner increments the counter');
  assert.equal(current.delivery_lease_until,null);
  assert.equal(seen.length,2,'receiver can deduplicate retries by immutable reportId');
  assert.ok(seen.every(v=>v.reportId===entry.id&&!JSON.stringify(v).includes('+79998889912')));
 }finally{await t.close();}
});

test('developer report: stale failed sender does not move newer lease back to retry', {timeout:60000},async()=>{
 const t=await setup();
 try{
  const admin=await t.login('+79990000001');
  const report=ok(await t.api('POST','/api/admin/developer-reports',{
   category:'other',phone:'+79998889913',
   details:'Проверка потери позднего отрицательного HTTP ответа',
  },admin.token));
  let rejectFirst!:(reason:Error)=>void,releaseSecond!:()=>void;
  let startedFirst!:()=>void,startedSecond!:()=>void;
  const aStarted=new Promise<void>(r=>{startedFirst=r});
  const bStarted=new Promise<void>(r=>{startedSecond=r});
  const firstWait=new Promise<void>((_,reject)=>{rejectFirst=reject});
  const secondWait=new Promise<void>(resolve=>{releaseSecond=resolve});
  const slow=new DeveloperReportDelivery(t.db,async()=>{startedFirst();await firstWait});
  const current=new DeveloperReportDelivery(t.db,async()=>{startedSecond();await secondWait});
  const a=slow.tick(1);await aStarted;
  await t.db.query(
   "update admin_developer_reports set delivery_lease_until=now()-interval '1 second' where id=$1",
   [report.id]);
  const b=current.tick(1);await bStarted;
  rejectFirst(new Error('injected remote failure'));
  assert.equal(await a,1);
  let row=await t.db.one<any>(
   'select delivery_attempts,delivery_last_error,delivery_lease_until from admin_developer_reports where id=$1',
   [report.id]);
  assert.equal(row.delivery_attempts,0,'old failed attempt does not change backoff');
  assert.equal(row.delivery_last_error,null);
  assert.ok(new Date(row.delivery_lease_until).getTime()>Date.now());
  releaseSecond();
  assert.equal(await b,1);
  row=await t.db.one<any>(
   'select delivery_attempts,delivery_sent_at,delivery_last_error from admin_developer_reports where id=$1',
   [report.id]);
  assert.equal(row.delivery_attempts,1);
  assert.ok(row.delivery_sent_at);
  assert.equal(row.delivery_last_error,null);
 }finally{await t.close();}
});
