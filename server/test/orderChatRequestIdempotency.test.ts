import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setup,ok} from './helpers.ts';

test('chat request keys replay committed messages without repeated durable writes or notifications', {timeout:60000}, async()=>{
 const t=await setup();
 try{
  assert.equal(t.db.driver,'pg');
  const owner=await t.login('+79993554001');
  const master=await t.login('+79993554002','master');
  const outsider=await t.login('+79993554003');
  const order=ok(await t.api('POST','/api/orders',{
    service:'electric',zoneId:'spb',description:'Учебная проверка повторов отправки'
  },owner.token)).order;
  await t.db.query("update orders set status='accepted',performer_id=$2 where id=$1",[order.id,master.id]);
  const url='/api/orders/'+order.id+'/messages';
  const send=(payload:object,token=owner.token)=>t.api('POST',url,payload,token);
  const payload={body:'Учебное сообщение',kind:'text',requestId:randomUUID()};
  const status=(requestId:string,token=owner.token,orderId=order.id)=>t.api('GET','/api/orders/'+orderId+'/messages/request/'+requestId,undefined,token);
  const absent={state:'not_observed',messageId:null,kind:null};
  const count=async()=>Number((await t.db.one("select count(*) as n from chat_messages where order_id=$1 and sender_id=$2",[order.id,owner.id]))?.n??0);
  const notices=async()=>Number((await t.db.one("select count(*) as n from notifications where user_id=$1 and kind='chat_push'",[master.id]))?.n??0);
  const before=await count(),beforeNotices=await notices();
  assert.deepEqual(ok(await status(payload.requestId)),absent);
  assert.equal((await status('invalid')).status,400);
  assert.equal((await status(payload.requestId,outsider.token)).status,403);
  assert.equal(await count(),before);
  const responses=await Promise.all(Array.from({length:8},()=>send(payload)));
  const results=responses.map(ok);
  assert.ok(results.every(x=>x.id===results[0].id));
  assert.equal(await count(),before+1);
  assert.equal(await notices(),beforeNotices+1);
  assert.equal(Object.hasOwn(results[0],'client_request_fingerprint'),false);
  const committed={state:'committed',messageId:results[0].id,kind:'text'};
  assert.deepEqual(ok(await status(payload.requestId)),committed);
  assert.deepEqual(ok(await status(payload.requestId,master.token)),absent);
  assert.equal((await status(payload.requestId,outsider.token)).status,403);
  const other=ok(await t.api('POST','/api/orders',{service:'electric',zoneId:'spb',description:'Другой учебный заказ'},owner.token)).order;
  assert.deepEqual(ok(await status(payload.requestId,owner.token,other.id)),absent);
  assert.equal(await count(),before+1);
  assert.equal(await notices(),beforeNotices+1);
  const replay=ok(await send(payload));
  assert.equal(replay.id,results[0].id);
  assert.equal(await count(),before+1);
  assert.equal(await notices(),beforeNotices+1);
  const changed=await send({...payload,body:'Другой текст'});
  assert.equal(changed.status,409);
  assert.equal(changed.body.error,'request_id_conflict');
  assert.equal((await send({...payload,kind:'quick'})).status,409);
  assert.equal((await send({...payload,requestId:'invalid'})).status,400);
  assert.equal((await send(payload,outsider.token)).status,403);
  // Identical wording with a different request key is a legitimate new message.
  assert.notEqual(ok(await send({...payload,requestId:randomUUID()})).id,replay.id);
  // A key is scoped by sender as well as order.
  assert.notEqual(ok(await send(payload,master.token)).id,replay.id);
  // Installed clients that omit the optional UUID retain their send contract.
  const legacy={body:'Одинаковый текст без ключа'};
  assert.notEqual(ok(await send(legacy)).id,ok(await send(legacy)).id);
  const closedCount=await count(),closedNotices=await notices();
  await t.db.query("update orders set status='completed' where id=$1",[order.id]);
  assert.equal(ok(await send(payload)).id,replay.id);
  assert.deepEqual(ok(await status(payload.requestId)),committed);
  const fresh=await send({...payload,requestId:randomUUID()});
  assert.equal(fresh.status,409);
  assert.equal(fresh.body.error,'chat_closed');
  assert.equal(await count(),closedCount);
  assert.equal(await notices(),closedNotices);
  await t.db.query("update users set roles='{driver}'::text[] where id=$1",[owner.id]);
  assert.equal((await send(payload)).status,403,'revoked owner cannot replay a private message');
  assert.equal((await status(payload.requestId)).status,403,'revoked owner cannot recover private send status');
 }finally{await t.close();}
});
