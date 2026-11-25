import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';

let t:T,orderId:string,masterId:string,otherId:string;
before(async()=>{
  t=await setup();
  const client=await t.login('+79995771901','client');
  for(const audience of ['client','privacy']){
    const current=ok(await t.api('GET','/api/offers/current/'+audience));
    if(current?.id)ok(await t.api('POST','/api/offers/'+current.id+'/accept',{},client.token));
  }
  // Create the request before registering performers so dispatch cannot race this fixture.
  const order=ok(await t.api('POST','/api/orders',{
    service:'electric',zoneId:'spb',regionId:'spb',paymentMethod:'cash',
    description:'Учебная заявка для проверки истории предложений'
  },client.token));
  orderId=order.order.id;
  const master=await t.login('+79995771902','master');
  const other=await t.login('+79995771903','master');
  masterId=master.id;otherId=other.id;
  for(const [worker,inn] of [[master,'780000007712'],[other,'780000007713']] as const){
    ok(await t.api('PUT','/api/performer/profile',{
      kind:'master',name:'Тестовый исполнитель',specialties:['electric'],
      taxStatus:'self_employed',inn
    },worker.token));
  }
});
after(()=>t.close());

test('prospective dispatch evidence survives retries, excludes queued rows, and isolates performers',async()=>{
  const first=new Date(t.clock.now().getTime());
  const later=new Date(first.getTime()+8*86400000);
  const evidence=()=>t.db.query<{performer_id:string;first_observed_sent_at:Date}>(
    'select performer_id,first_observed_sent_at from partner_dispatch_evidence where order_id=$1 order by performer_id',[orderId]);
  assert.equal((await evidence()).length,0);
  assert.ok(await t.db.one('select capture_started_at from partner_dispatch_evidence_coverage where singleton'));
  await t.db.query(
    "insert into order_dispatch(order_id,performer_id,rank,status) values($1,$2,1,'queued')",[orderId,masterId]);
  assert.equal((await evidence()).length,0);
  await t.db.query(
    "update order_dispatch set status='ringing',sent_at=$3 where order_id=$1 and performer_id=$2",[orderId,masterId,first]);
  assert.equal((await evidence()).length,1);
  await t.db.query(
    "update order_dispatch set status='bidding',sent_at=$3 where order_id=$1 and performer_id=$2",[orderId,masterId,later]);
  await t.db.query('delete from order_dispatch where order_id=$1 and performer_id=$2',[orderId,masterId]);
  await t.db.query(
    "insert into order_dispatch(order_id,performer_id,rank,status,sent_at) values($1,$2,1,'bidding',$3)",[orderId,masterId,later]);
  await t.db.query(
    "insert into order_dispatch(order_id,performer_id,rank,status,sent_at) values($1,$2,2,'bidding',$3)",[orderId,otherId,later]);
  const rows=await evidence();
  assert.equal(rows.length,2);
  assert.equal(new Date(rows.find(r=>r.performer_id===masterId)!.first_observed_sent_at).getTime(),first.getTime());
  assert.equal(new Date(rows.find(r=>r.performer_id===otherId)!.first_observed_sent_at).getTime(),later.getTime());
});
