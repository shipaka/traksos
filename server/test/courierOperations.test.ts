import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';

test('admin-only courier watchlist identifies overdue drafts and assignments without exposing customers',async()=>{
 const t=await setup();
 try{
  const admin=await t.login('+79990000001');
  const client=await t.login('+79996887001','client');
  const courier1=await t.login('+79996887002');
  const courier2=await t.login('+79996887003');
  for(const [i,person] of [courier1,courier2].entries())
   ok(await t.api('POST','/api/admin/shop/couriers',{
    userId:person.id,displayName:'Тестовый курьер '+(i+1),
    vehicleLabel:'Тестовая машина'
   },admin.token));
  const draft=await t.db.one<{id:string}>(
   "insert into shop_courier_runs(courier_id,created_by,pickup_address,created_at) "+
   "values($1,$2,'Санкт-Петербург, склад тестового мониторинга',"+
   "now()-interval '3 hours') returning id",
   [courier1.id,admin.id]);
  const assigned=await t.db.one<{id:string}>(
   "insert into shop_courier_runs(courier_id,created_by,pickup_address,"+
   "created_at,dispatch_approved_at,dispatch_approved_by) "+
   "values($1,$2,'Санкт-Петербург, другой тестовый склад',"+
   "now()-interval '2 hours',now()-interval '40 minutes',$2) returning id",
   [courier2.id,admin.id]);
  assert.ok(draft&&assigned);
  assert.equal((await t.api('GET','/api/admin/shop/courier-operations',
   undefined,client.token)).status,403);
  assert.equal((await t.api('GET','/api/admin/shop/courier-operations',
   undefined,courier1.token)).status,403);
  const found=ok(await t.api('GET','/api/admin/shop/courier-operations',
   undefined,admin.token));
  assert.equal(found.totals.active,2);
  assert.equal(found.totals.drafts,1);
  assert.equal(found.totals.approved,1);
  const draftFlag=found.alerts.find((a:any)=>a.runId===draft.id);
  const approvedFlag=found.alerts.find((a:any)=>a.runId===assigned.id);
  assert.equal(draftFlag.code,'draft_waiting');
  assert.equal(approvedFlag.code,'approved_waiting');
  assert.ok(draftFlag.minutes>=120);
  assert.ok(approvedFlag.minutes>=30);
  const raw=JSON.stringify(found);
  for(const sensitive of ['phone','location','latitude','longitude',
   'customerAddress','gps','courierPayKopecks','client_id']){
   assert.ok(!raw.includes(sensitive),'operations report leaked '+sensitive);
  }
  assert.ok(!raw.includes(client.phone??'DO_NOT_MATCH'));
 }finally{await t.close()}
});
