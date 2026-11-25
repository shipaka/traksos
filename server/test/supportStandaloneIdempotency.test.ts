import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setup,ok} from './helpers.ts';

test('standalone support: atomic intake, explicit staff preference, scoped idempotent retry',async()=>{
  const t=await setup();
  try {
    const owner=await t.login('+79997774201');
    const other=await t.login('+79997774202');
    const admin=await t.login('+79990000001');
    const moderator=await t.login('+79997774203');
    await t.db.query("update users set roles='{moderator}'::text[] where id=$1",[moderator.id]);
    const requestKey=randomUUID();
    const payload={topic:'Другое',text:'Учебное личное обращение',requestKey,requestedRole:'admin'};
    const results=await Promise.all(Array.from({length:5},()=>t.api('POST','/api/support',payload,owner.token)));
    const tickets=results.map(ok);
    assert.ok(tickets.every(x=>x.id===tickets[0].id&&x.messages.length===1));
    const id=tickets[0].id;
    assert.equal(tickets[0].requestedRole,'admin');
    const counts=await t.db.query<{user_id:string;n:number}>(
      "select user_id,count(*)::int n from notifications where kind='support' and data->>'ticketId'=$1 group by user_id",[id]);
    assert.deepEqual(counts,[{user_id:admin.id,n:1}]);
    assert.equal((await t.api('POST','/api/support',{...payload,text:'Иное обращение'},owner.token)).status,409);
    assert.equal((await t.api('GET','/api/support/'+id,undefined,other.token)).status,403);
    const independent=ok(await t.api('POST','/api/support',payload,other.token));
    assert.notEqual(independent.id,id);
    const distinct=ok(await t.api('POST','/api/support',{...payload,requestKey:randomUUID(),requestedRole:'moderator'},owner.token));
    assert.notEqual(distinct.id,id);
    const modInbox=await t.db.query<{user_id:string}>("select user_id from notifications where kind='support' and data->>'ticketId'=$1",[distinct.id]);
    assert.deepEqual(modInbox,[{user_id:moderator.id}]);
    await t.db.query("update users set status='blocked' where id=$1",[moderator.id]);
    const fallback=ok(await t.api('POST','/api/support',{...payload,requestKey:randomUUID(),requestedRole:'moderator'},owner.token));
    const fallbackInbox=await t.db.query<{user_id:string}>("select user_id from notifications where kind='support' and data->>'ticketId'=$1",[fallback.id]);
    assert.deepEqual(fallbackInbox,[{user_id:admin.id}]);
    await t.db.exec(`create function reject_test_support_inbox() returns trigger language plpgsql as $$ begin
      if new.kind='support' then raise exception 'synthetic inbox failure'; end if;
      return new; end $$;
      create trigger reject_test_support_inbox before insert on notifications for each row execute function reject_test_support_inbox();`);
    const failureKey=randomUUID();
    assert.notEqual((await t.api('POST','/api/support',{...payload,requestKey:failureKey},owner.token)).status,200);
    const absent=await t.db.one("select id from support_tickets where user_id=$1 and client_request_key=$2",[owner.id,failureKey]);
    assert.equal(absent??null,null,'inbox failure must roll back ticket and message');
    await t.db.exec('drop trigger reject_test_support_inbox on notifications; drop function reject_test_support_inbox();');
    const recovered=ok(await t.api('POST','/api/support',{...payload,requestKey:failureKey},owner.token));
    assert.equal(recovered.messages.length,1);
    ok(await t.api('POST','/api/support/'+id+'/close',{},owner.token));
    const closed=ok(await t.api('POST','/api/support',payload,owner.token));
    assert.equal(closed.id,id);
    assert.equal(closed.status,'closed','replay must not create a replacement closed ticket');
  } finally {await t.close();}
});
