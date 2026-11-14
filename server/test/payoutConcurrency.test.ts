import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';

// Parallel admins and scheduled processors must not pay the same performer twice.
let t:T,admin:{id:string;token:string},client:{id:string;token:string},worker:{id:string;token:string};

before(async()=>{
  t=await setup();
  admin=await t.login('+79990000001');
  client=await t.login('+79995887701');
  worker=await t.login('+79995887702','master');
  ok(await t.api('PUT','/api/performer/profile',{
    kind:'master',name:'Тестовый мастер',specialties:['electric'],taxStatus:'self_employed',inn:'780000000001',
  },worker.token));
  await t.db.query("update performer_profiles set tax_status='self_employed',inn='780000000001' where user_id=$1",[worker.id]);
});
after(async()=>{if(t)await t.close();});

async function createPayout(amount=100000){
  const order=await t.db.one<{id:string}>(
    "insert into orders(client_id,created_by,performer_id,service,zone_id,status) values ($1,$1,$2,'electric','spb','completed') returning id",
    [client.id,worker.id]);
  assert.ok(order);
  await t.db.query("insert into ledger_entries(order_id,performer_id,account,amount,kind) values ($1,$2,'performer',$3,'earning'),($1,null,'client',$4,'payment')",[order.id,worker.id,amount,-amount]);
  const payout=await t.db.one<{id:string}>(
    "insert into payouts(order_id,performer_id,amount,commission,provider) values ($1,$2,$3,0,'mock') returning id",
    [order.id,worker.id,amount]);
  assert.ok(payout);
  return {id:payout.id,orderId:order.id,amount};
}

test('12 parallel payout runs deliver exactly one provider payout and balanced ledger',{timeout:60000},async()=>{
 const p=await createPayout();
 const calls=await Promise.all(Array.from({length:12},()=>t.api('POST','/api/admin/payouts/run',{},admin.token)));
 assert.ok(calls.every(x=>x.status===200),'concurrent workers must not trigger a server error');
 const sent=t.payments.payouts.filter(x=>x.metadata.payoutId===p.id);
 assert.equal(sent.length,1,'NEVER transmit a duplicate payout to the external provider');
 const dbPayout=await t.db.one<{status:string}>('select status from payouts where id=$1',[p.id]);
 assert.equal(dbPayout?.status,'paid');
 const postings=await t.db.query(
   "select account,amount from ledger_entries where order_id=$1 and kind='payout'",[p.orderId]);
 assert.equal(postings.length,2,'one pair of payout postings');
 assert.equal(postings.reduce((n,x)=>n+Number(x.amount),0),0,'double-entry payout stays balanced');
 const balance=ok(await t.api('GET','/api/performer/balance',undefined,worker.token));
 assert.equal(balance.to_pay,0,'performer balance is not paid twice');
});

test('unknown provider response is quarantined; retries do not reissue payout',{timeout:60000},async()=>{
 const p=await createPayout();
 const provider=t.payments;
 const original=provider.payout.bind(provider);
 let sends=0;
 provider.payout=async(arg)=>{
   if(arg.metadata.payoutId===p.id){sends++;throw new Error('network timeout after possible provider acceptance');}
   return original(arg);
 };
 try{
   const failure=await t.api('POST','/api/admin/payouts/run',{},admin.token);
   assert.ok(failure.status>=500,'unknown response must not be shown as paid');
   const state=await t.db.one<{status:string}>('select status from payouts where id=$1',[p.id]);
   assert.equal(state?.status,'processing','do not retry a potentially completed transfer');
   const retry=await t.api('POST','/api/admin/payouts/run',{},admin.token);
   assert.equal(retry.status,200);
   assert.equal(sends,1,'no second provider transfer without reconciliation');
 }finally{
   provider.payout=original;
 }
});
