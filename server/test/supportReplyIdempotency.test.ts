import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setup,ok} from './helpers.ts';

test('support reply UUID deduplicates concurrent retries, including after closure, without duplicate inbox',async()=>{
  const t=await setup();
  try {
    const owner=await t.login('+79997774401');
    const other=await t.login('+79997774402');
    const admin=await t.login('+79990000001');
    const ticket=ok(await t.api('POST','/api/support',{topic:'Другое',text:'Учебное обращение'},owner.token));
    const path='/api/support/'+ticket.id+'/messages';
    const inbox=async()=>(await t.db.one<{n:number}>(
      "select count(*)::int n from notifications where user_id=$1 and data->>'ticketId'=$2",[owner.id,ticket.id]))!.n;
    const before=await inbox();
    const payload={body:'Ответ по учебному обращению',requestKey:randomUUID()};
    const responses=await Promise.all(Array.from({length:6},()=>t.api('POST',path,payload,admin.token)));
    for(const r of responses)assert.equal(ok(r).messages.length,2);
    assert.equal(await inbox(),before+1);
    assert.equal((await t.api('POST',path,{...payload,body:'Другой ответ'},admin.token)).status,409);
    assert.equal((await t.api('POST',path,payload,other.token)).status,403);
    // Same UUID from a different actor is an independent legitimate request.
    assert.equal(ok(await t.api('POST',path,payload,owner.token)).messages.length,3);
    assert.equal(ok(await t.api('POST',path,{...payload,requestKey:randomUUID()},admin.token)).messages.length,4);
    const closed=ok(await t.api('POST','/api/support/'+ticket.id+'/close',{},owner.token));
    const replay=ok(await t.api('POST',path,payload,admin.token));
    assert.equal(replay.status,'closed');
    assert.equal(replay.messages.length,closed.messages.length);
    assert.equal(await inbox(),before+2);
    assert.equal((await t.api('POST',path,{...payload,requestKey:randomUUID()},admin.token)).status,409);
    assert.equal((await t.api('POST',path,{body:'Старый клиент'},admin.token)).status,409);
    const stale=(await t.db.one<any>('select id,phone,name,roles,status,owner_id from users where id=$1',[admin.id]))!;
    await t.db.query("update users set roles='{client}'::text[] where id=$1",[admin.id]);
    await assert.rejects(()=>t.app.support.post(stale,ticket.id,payload.body,payload.requestKey),(e:any)=>e.status===403);
  } finally {await t.close();}
});
