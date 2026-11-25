import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';

test('order chat explicit windows preserve long archives and catch-up across global ID gaps', {timeout:60000}, async()=>{
 const t=await setup();
 try {
  assert.equal(t.db.driver,'pg');
  const client=await t.login('+79993552001');
  const master=await t.login('+79993552002','master');
  const other=await t.login('+79993552003');
  const create=async(token:string)=>ok(await t.api('POST','/api/orders',{
   service:'electric',zoneId:'spb',description:'Disposable chat window fixture'
  },token)).order;
  const order=await create(client.token);
  const foreign=await create(other.token);
  await t.db.query("update orders set status='completed',performer_id=$2 where id=$1",[order.id,master.id]);
  // Include unrelated message IDs between the order's own messages. No global
  // contiguous sequence or client-side arithmetic may be assumed.
  await t.db.query(`insert into chat_messages(order_id,sender_id,kind,body)
    select case when n%2=0 then $1::uuid else $2::uuid end,
      case when n%2=0 then $3::uuid else $4::uuid end,'text','fixture '||n
      from generate_series(1,2400) n`,[order.id,foreign.id,client.id,other.id]);
  await t.app.orders.systemMessage(order.id,'Сумма 12345 ₽');
  const expected=(await t.db.query<{id:number}>(
    'select id::int as id from chat_messages where order_id=$1 order by id',[order.id])).map(x=>x.id);
  assert.ok(expected.length>1200);
  const url='/api/orders/'+order.id+'/messages';
  const read=async(query:string,token=client.token)=>ok(await t.api('GET',url+query,undefined,token));
  const ids=(r:any):number[]=>r.messages.map((m:any)=>m.id);
  const legacy=await read('');
  assert.deepEqual(ids(legacy),expected.slice(0,500));
  assert.equal(Object.hasOwn(legacy,'page'),false);
  assert.deepEqual(ids(await read('?after='+expected[499])),expected.slice(500,1000));
  const latest=await read('?window=latest&limit=100');
  assert.deepEqual(ids(latest),expected.slice(-100));
  assert.equal(latest.page.hasMore,true);
  assert.equal(latest.page.oldestId,ids(latest)[0]);
  assert.equal(latest.page.newestId,expected.at(-1));
  assert.deepEqual(latest.quickReplies,[]);
  let collected=ids(latest), page=latest.page;
  while(page.hasMore){
   const older=await read('?window=before&limit=100&cursor='+page.nextCursor);
   assert.ok(ids(older).length>0);
   collected=[...ids(older),...collected];
   page=older.page;
  }
  assert.deepEqual(collected,expected);
  assert.equal(page.nextCursor,null);
  let caught:number[]=[],cursor=expected[499],more=true;
  while(more){
   const next=await read('?window=after&limit=120&cursor='+cursor);
   caught.push(...ids(next));
   more=next.page.hasMore;
   if(more)cursor=next.page.nextCursor;
  }
  assert.deepEqual(caught,expected.slice(500));
  const empty=await read('?window=after&cursor='+expected.at(-1));
  assert.deepEqual(empty.messages,[]);
  assert.deepEqual(empty.page,{mode:'after',hasMore:false,oldestId:null,newestId:null,nextCursor:null});
  const performer=await read('?window=latest',master.token);
  assert.ok(performer.messages.some((m:any)=>m.body.includes('Клиенту доступен подробный расчёт')));
  assert.ok(!performer.messages.some((m:any)=>m.body.includes('12345')));
  for(const query of ['?window=latest','?window=before&cursor='+expected.at(-1),'?window=after&cursor=0']){
   assert.equal((await t.api('GET',url+query,undefined,other.token)).status,403);
  }
  for(const query of ['?window=unknown','?window=latest&cursor=1','?window=before&cursor=0',
   '?window=after','?window=after&cursor=-1','?window=latest&limit=501',
   '?window=latest&limit=0','?window=latest&limit=1.5','?window=after&cursor=0&after=1']){
   assert.equal((await t.api('GET',url+query,undefined,client.token)).status,400,query);
  }
 }finally{await t.close();}
});
