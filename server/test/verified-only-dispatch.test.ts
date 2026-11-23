import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';

let t:T,client:any,admin:any,approved:any,pending:any;
before(async()=>{
  t=await setup();
  admin=await t.login('+79990000001');
  client=await t.login('+79991110000');
  approved=await t.login('+79993339981','master');
  pending=await t.login('+79993339982','master');
  for(const [u,name] of [[approved,'Проверенный'],[pending,'Непроверенный']] as const){
    ok(await t.api('PUT','/api/performer/profile',{name,kind:'master',specialties:['electric']},u.token));
    ok(await t.api('POST','/api/performer/line',{lineStatus:'online'},u.token));
    ok(await t.api('POST','/api/performer/location',{lat:59.934,lng:30.335},u.token));
  }
  ok(await t.api('POST','/api/admin/performers/'+approved.id+'/verify',{decision:'approved'},admin.token));
});
after(()=>t.close());

test('client sees unverified masters without the filter, but only approved with it',async()=>{
  const all=ok(await t.api('GET','/api/masters-nearby?service=electric',undefined,client.token));
  assert.ok(all.items.some((x:any)=>x.verification!=='approved'),'unverified master hidden without consent');
  assert.ok(all.items.some((x:any)=>x.verification==='approved'),'approved master missing');
  assert.equal(all.items[0].verification,'approved','verified workers should rank first');
  const filtered=ok(await t.api('GET','/api/masters-nearby?service=electric&verifiedOnly=1',undefined,client.token));
  assert.ok(filtered.items.every((x:any)=>x.verification==='approved'));
  assert.ok(filtered.items.length>0);
});

test('verifiedOnly persists in order and excludes pending masters from the actual dispatch',async()=>{
  const placed=ok(await t.api('POST','/api/orders',{service:'electric',zoneId:'spb',verifiedOnly:true},client.token));
  assert.equal(placed.order.verifiedOnly,true);
  await t.app.orders.startDispatch(placed.order.id);
  const dispatch=await t.db.query<{user_id:string}>(
    "select d.performer_id as user_id from order_dispatch d where d.order_id=$1",[placed.order.id]);
  assert.ok(!dispatch.some(x=>x.user_id===pending.id),'pending partner was invited despite only-verified consent');
});
