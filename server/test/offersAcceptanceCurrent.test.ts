import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';

const BODY = '# Проверка действующих условий TrakSOS\n\nТестовая редакция юридического документа для изолированного PostgreSQL, не для публикации пользователям.';

test('consents are recorded only for the actual current client offer and exactly once',
  {timeout:60000}, async()=>{
    const t=await setup();
    try{
      const admin=await t.login('+79990000001');
      const client=await t.login('+79998880181');
      const master=await t.login('+79998880182','master');
      const first=ok(await t.api('POST','/api/admin/offers',{
        audience:'client',version:'accept-qa-1',body:BODY
      },admin.token));
      const firstDoc=ok(await t.api('GET',`/api/offers/${first.id}`));
      assert.equal(firstDoc.version,'accept-qa-1');
      // All legal texts remain publicly readable; acceptance is not public.
      assert.equal((await t.api('POST',`/api/offers/${first.id}/accept`,{})).status,401);

      const masterUser=ok(await t.api('GET','/api/me',undefined,master.token));
      assert.ok(masterUser.roles?.includes('master'),'fixture must use a master account');
      assert.equal(masterUser.roles?.includes('client'),false,
        'fixture must not have customer permissions when testing an unrelated contract');
      const wrongRole=await t.api('POST',`/api/offers/${first.id}/accept`,{},master.token);
      assert.equal(wrongRole.status,403);
      assert.equal((await t.db.one<{n:number}>(
        'select count(*)::int as n from consents where user_id=$1 and offer_id=$2',
        [master.id,first.id]))?.n,0);

      const accepted=ok(await t.api('POST',`/api/offers/${first.id}/accept`,{},client.token));
      assert.equal(accepted.find((o:any)=>o.audience==='client')?.accepted,true);
      const repeated=ok(await t.api('POST',`/api/offers/${first.id}/accept`,{},client.token));
      assert.equal(repeated.find((o:any)=>o.audience==='client')?.accepted,true);
      assert.equal((await t.db.one<{n:number}>(
        'select count(*)::int as n from consents where user_id=$1 and offer_id=$2',
        [client.id,first.id]))?.n,1,'repeated acceptance must be idempotent');

      // A future replacement must not be accepted, even when it exists in the
      // public offers table. Existing current edition stays effective.
      const future=ok(await t.api('POST','/api/admin/offers',{
        audience:'client',version:'accept-qa-future',body:BODY,
        effectiveAt:'2027-02-01T00:00:00Z',
      },admin.token));
      const pending=await t.api('POST',`/api/offers/${future.id}/accept`,{},client.token);
      assert.equal(pending.status,409);
      assert.equal(pending.body.error,'offer_outdated');
      assert.equal((await t.db.one<{n:number}>(
        'select count(*)::int as n from consents where user_id=$1 and offer_id=$2',
        [client.id,future.id]))?.n,0);

      // Publishing a second immediately-effective edition invalidates first
      // for new consents but does not mutate previously signed audit records.
      t.clock.advance(5);
      const second=ok(await t.api('POST','/api/admin/offers',{
        audience:'client',version:'accept-qa-2',body:BODY,
      },admin.token));
      const stale=await t.api('POST',`/api/offers/${first.id}/accept`,{},client.token);
      assert.equal(stale.status,409);
      assert.equal(stale.body.error,'offer_outdated');
      const statusBefore=ok(await t.api('GET','/api/me/offers',undefined,client.token));
      assert.equal(statusBefore.find((o:any)=>o.audience==='client')?.current?.id,second.id);
      assert.equal(statusBefore.find((o:any)=>o.audience==='client')?.accepted,false);
      const current=ok(await t.api('POST',`/api/offers/${second.id}/accept`,{},client.token));
      assert.equal(current.find((o:any)=>o.audience==='client')?.accepted,true);
      assert.equal((await t.db.one<{n:number}>(
        'select count(*)::int as n from consents where user_id=$1 and offer_id=$2',
        [client.id,first.id]))?.n,1);
      assert.equal((await t.db.one<{n:number}>(
        'select count(*)::int as n from consents where user_id=$1 and offer_id=$2',
        [client.id,second.id]))?.n,1);
    }finally{await t.close();}
  });

test('an upcoming performer contract cannot be accepted before its effective date',
  {timeout:60000}, async()=>{
    const t=await setup();
    try{
      const admin=await t.login('+79990000001');
      const master=await t.login('+79998880183','master');
      const offer=ok(await t.api('POST','/api/admin/offers',{
        audience:'performer',version:'master-future-qa',body:BODY,
        effectiveAt:'2027-01-01T00:00:00Z',
      },admin.token));
      const earlier=await t.api('POST',`/api/offers/${offer.id}/accept`,{},master.token);
      assert.equal(earlier.status,409);
      assert.equal(earlier.body.error,'offer_outdated');
      assert.equal((await t.db.one<{n:number}>(
        'select count(*)::int as n from consents where user_id=$1 and offer_id=$2',
        [master.id,offer.id]))?.n,0);
      t.clock.set('2027-01-02T00:00:00Z');
      const accepted=ok(await t.api('POST',`/api/offers/${offer.id}/accept`,{},master.token));
      assert.equal(accepted.find((o:any)=>o.audience==='performer')?.accepted,true);
      assert.equal((await t.db.one<{n:number}>(
        'select count(*)::int as n from consents where user_id=$1 and offer_id=$2',
        [master.id,offer.id]))?.n,1);
    }finally{await t.close();}
  });
