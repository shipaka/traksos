import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';

test('unknown payment provider response stays in review and never repeats transfer',{timeout:60000},async()=>{
 const t=await setup();
 try{
   const admin=await t.login('+79990000001');
   const customer=await t.login('+79995551211');
   const worker=await t.login('+79995551212','master');
   ok(await t.api('PUT','/api/performer/profile',{
     kind:'master',name:'Исполнитель в тесте обрыва связи',
     specialties:['electric'],taxStatus:'self_employed',inn:'780000000002',
   },worker.token));
   await t.db.query(
     "update performer_profiles set tax_status='self_employed' where user_id=$1",[worker.id]);
   const order=await t.db.one<{id:string}>(
     "insert into orders(client_id,created_by,performer_id,service,zone_id,status) values ($1,$1,$2,'electric','spb','completed') returning id",
     [customer.id,worker.id]);
   assert.ok(order);
   await t.db.query(
     "insert into ledger_entries(order_id,performer_id,account,amount,kind) values ($1,$2,'performer',100000,'earning'),($1,null,'client',-100000,'payment')",
     [order.id,worker.id]);
   const payout=await t.db.one<{id:string}>(
     "insert into payouts(order_id,performer_id,amount,commission,provider) values ($1,$2,100000,0,'mock') returning id",
     [order.id,worker.id]);
   assert.ok(payout);
   const service=t.payments;
   const real=service.payout.bind(service);
   let calls=0;
   service.payout=async p=>{
     if(p.metadata.payoutId===payout.id){
       calls++;
       throw new Error('ambiguous transport timeout after possible acceptance');
     }
     return real(p);
   };
   try{
     const uncertain=await t.api('POST','/api/admin/payouts/run',{},admin.token);
     assert.ok(uncertain.status>=500,'unknown status must not be acknowledged as a completed transfer');
     assert.equal((await t.db.one<{status:string}>(
       'select status from payouts where id=$1',[payout.id]))?.status,'processing');
     const retry=await t.api('POST','/api/admin/payouts/run',{},admin.token);
     assert.equal(retry.status,200);
     assert.equal(calls,1,'never resend an uncertain transfer automatically');
     const logs=await t.db.query(
       "select id from audit_log where action='payout.unknown_status' and target=$1",[payout.id]);
     assert.equal(logs.length,1,'an uncertain payout must have an audit marker');
   }finally{
     service.payout=real;
   }
 }finally{
   await t.close();
 }
});
