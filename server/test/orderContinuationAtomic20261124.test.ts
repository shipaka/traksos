import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';

test('continuation advice and decisions are atomic with durable inbox and current assignment', {timeout:60000},async()=>{
 const t=await setup();
 try{
  const owner=await t.login('+79996487001');
  const first=await t.login('+79996487002','master');
  const next=await t.login('+79996487003','master');
  const row=await t.db.one<{id:string}>(
   "insert into orders(client_id,created_by,performer_id,service,zone_id,status) values($1,$1,$2,'electric','spb','working') returning id",
   [owner.id,first.id]);
  assert.ok(row);
  const id=row.id;
  const url='/api/orders/'+id+'/continuations';
  const advice={target:'tow',summary:'Требуется эвакуация грузового автомобиля'};
  const proposal=()=>t.api('POST',url,advice,first.token);
  const count=async(table:string)=> (await t.db.one<{n:number}>(
   table==='notifications'
    ? "select count(*)::int as n from notifications where data->>'orderId'=$1 and data ? 'recommendationId'"
    : table==='events'
      ? "select count(*)::int as n from order_events where order_id=$1 and type in ('continuation_recommended','continuation_decided')"
      : "select count(*)::int as n from order_continuation_recommendations where source_order_id=$1",[id]))!.n;
  const inject=()=>t.db.exec(`create function reject_continuation_inbox() returns trigger language plpgsql as $$
   begin if new.data ? 'recommendationId' then raise exception 'injected inbox outage'; end if; return new; end $$;
   create trigger reject_continuation_inbox before insert on notifications
   for each row execute function reject_continuation_inbox();`);
  const remove=()=>t.db.exec('drop trigger if exists reject_continuation_inbox on notifications; drop function if exists reject_continuation_inbox()');
  await inject();
  try{
   assert.notEqual((await proposal()).status,200);
   assert.equal(await count('recommendations'),0);
   assert.equal(await count('events'),0);
   assert.equal(await count('notifications'),0);
  }finally{await remove();}
  const responses=await Promise.all([proposal(),proposal(),proposal()]);
  const results=responses.map(r=>ok(r));
  assert.equal(results.filter(r=>r.created).length,1);
  assert.equal(new Set(results.map(r=>r.id)).size,1);
  const recommendation=results[0].id;
  assert.equal(await count('recommendations'),1);
  assert.equal(await count('events'),1);
  assert.equal(await count('notifications'),1);
  const decide=()=>t.api('POST',url+'/'+recommendation+'/decision',{approve:true},owner.token);
  await inject();
  try{
   assert.notEqual((await decide()).status,200);
   assert.equal((await t.db.one<{status:string}>(
    'select status from order_continuation_recommendations where id=$1',[recommendation]))?.status,'pending');
   assert.equal(await count('events'),1);
   assert.equal(await count('notifications'),1);
  }finally{await remove();}
  // The old worker no longer has access. Owner can decide an existing
  // recommendation, but the old worker must not receive a new private alert.
  await t.db.query('update orders set performer_id=$2 where id=$1',[id,next.id]);
  assert.equal((await t.api('GET',url,undefined,first.token)).status,403);
  assert.equal((await t.api('POST',url,{target:'sto',summary:advice.summary},first.token)).status,403);
  assert.equal(ok(await decide()).status,'approved');
  assert.equal(ok(await decide()).status,'approved');
  assert.equal(await count('events'),2);
  assert.equal(await count('notifications'),1);
  assert.equal((await t.api('GET',url,undefined,owner.token)).status,200);
  assert.equal((await t.api('GET',url,undefined,next.token)).status,200);
  // The currently assigned worker still receives exactly one decision.
  const nextAdvice=ok(await t.api('POST',url,{target:'sto',summary:'Необходим ремонт в стационарном сервисе'},next.token));
  assert.equal(nextAdvice.created,true);
  const decisionUrl=url+'/'+nextAdvice.id+'/decision';
  const decisions=await Promise.all([1,2,3].map(()=>t.api('POST',decisionUrl,{approve:false},owner.token)));
  assert.ok(decisions.every(r=>r.status===200),JSON.stringify(decisions));
  assert.equal((await t.db.one<{n:number}>(
   "select count(*)::int as n from notifications where user_id=$1 and data->>'recommendationId'=$2",
   [next.id,nextAdvice.id]))?.n,1);
  assert.equal(await count('events'),4);
  assert.equal(await count('notifications'),3);
  assert.equal((await t.api('POST',decisionUrl,{approve:true},owner.token)).status,409);

 }finally{await t.close();}
});
