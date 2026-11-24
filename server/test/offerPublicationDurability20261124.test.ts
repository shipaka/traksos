import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';

const BODY='# Изолированная проверка публикации\n\nТестовая юридическая редакция для проверки транзакции PostgreSQL. Не настоящий документ.';

test('offer, audit and all inbox rows roll back together on notification failure', {timeout:60000}, async()=>{
  const t=await setup();
  try{
    const admin=await t.login('+79990000001');
    const client=await t.login('+79998880711','client');
    await t.db.exec("create function fail_offer_inbox_qa() returns trigger language plpgsql as $$ begin if NEW.kind='offer' then raise exception 'qa inbox failure'; end if; return NEW; end; $$; create trigger fail_offer_inbox_qa before insert on notifications for each row execute function fail_offer_inbox_qa();");
    const payload={audience:'client',version:'durability-qa',body:BODY};
    const failed=await t.api('POST','/api/admin/offers',payload,admin.token);
    assert.ok(failed.status>=400);
    assert.equal((await t.db.one<{n:number}>("select count(*)::int n from offers where audience='client' and version=$1",[payload.version]))?.n,0);
    assert.equal((await t.db.one<{n:number}>("select count(*)::int n from audit_log where action='offer.publish' and data->>'version'=$1",[payload.version]))?.n,0);
    await t.db.exec('drop trigger fail_offer_inbox_qa on notifications; drop function fail_offer_inbox_qa();');
    const created=ok(await t.api('POST','/api/admin/offers',payload,admin.token));
    assert.equal((await t.db.one<{n:number}>("select count(*)::int n from audit_log where action='offer.publish' and target=$1",[created.id]))?.n,1);
    assert.equal((await t.db.one<{n:number}>("select count(*)::int n from notifications where user_id=$1 and kind='offer' and data->>'offerId'=$2",[client.id,created.id]))?.n,1);
    const again=await t.api('POST','/api/admin/offers',payload,admin.token);
    assert.equal(again.status,400);
    assert.equal(again.body.error,'version_exists');
  }finally{await t.close();}
});

test('concurrent first partner editions cannot both bypass advance notice', {timeout:60000}, async()=>{
  const t=await setup();
  try{
    const admin=await t.login('+79990000001');
    // Disposable fixture: no previous offer for this audience.
    await t.db.query("delete from consents where offer_id in (select id from offers where audience='performer')");
    await t.db.query("delete from offers where audience='performer'");
    const date=t.clock.now().toISOString();
    const replies=await Promise.all(['concurrent-qa-a','concurrent-qa-b'].map(version=>
      t.api('POST','/api/admin/offers',{audience:'performer',version,body:BODY,effectiveAt:date},admin.token)));
    assert.equal(replies.filter(r=>r.status===200).length,1);
    assert.equal(replies.filter(r=>r.status===400&&r.body.error==='notice_too_short').length,1);
    assert.equal((await t.db.one<{n:number}>("select count(*)::int n from offers where audience='performer'"))?.n,1);
  }finally{await t.close();}
});
