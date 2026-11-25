// #222: exercise the actual seed SQL and HTTP responses, not mocked offer bodies.
// Only the existing disposable integration DB helper is used.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setup, ok } from './helpers.ts';
import { DEMO, seed } from '../src/seed.ts';

test('legacy privacy consent is preserved while separate seeded revision requires fresh acceptance', async () => {
  const t = await setup();
  try {
    assert.equal(t.db.driver, 'pg', 'this regression requires real PostgreSQL');
    // seed uses the database clock; keep the injected HTTP clock after it.
    t.clock.set(new Date(Math.max(Date.now(), t.clock.now().getTime()) + 600_000).toISOString());
    const driver = await t.login(DEMO.driver);
    await seed(t.db);
    const client = await t.db.one<{id:string;body:string;summary:string}>(
      "select id,body,summary from offers where audience='client' and version='0.2-черновик'");
    assert.ok(client);
    const oldBody = client.body.replace('# Оферта для клиентов', '# Согласие на обработку персональных данных');
    assert.notEqual(oldBody, client.body);
    // Recreate exactly the historical bad privacy seed, before anyone has
    // accepted the freshly generated fixture. All data is disposable.
    await t.db.query("delete from offers where audience='privacy'");
    const legacy = await t.db.one<{id:string}>(
      "insert into offers(audience,version,body,summary,effective_at) values ('privacy','0.2-черновик',$1,$2,now()-interval '1 day') returning id",
      [oldBody, client.summary]);
    assert.ok(legacy);
    const status = async () => ok(await t.api('GET','/api/me/offers',undefined,driver.token)) as any[];
    const getPrivacy = (rows:any[]) => rows.find(r => r.audience==='privacy');
    const getClient = (rows:any[]) => rows.find(r => r.audience==='client');
    const initial = await status();
    assert.equal(getPrivacy(initial)?.current.id, legacy.id);
    assert.equal(getClient(initial)?.current.id, client.id);
    ok(await t.api('POST','/api/offers/'+legacy.id+'/accept',{},driver.token));
    assert.equal(getPrivacy(await status())?.accepted,true);
    const oldConsent = await t.db.one('select * from consents where user_id=$1 and offer_id=$2',[driver.id,legacy.id]);
    assert.ok(oldConsent);

    await seed(t.db);
    const revised = await status();
    const p = getPrivacy(revised);
    const c = getClient(revised);
    assert.ok(p?.current && c?.current);
    assert.equal(p.name,'Согласие на обработку персональных данных');
    assert.equal(c.name,'Оферта для клиентов');
    assert.equal(p.current.audience,'privacy');
    assert.equal(c.current.audience,'client');
    assert.equal(p.current.version,'0.3-черновик');
    assert.equal(c.current.version,'0.2-черновик');
    assert.notEqual(p.current.id,legacy.id);
    assert.equal(c.current.id,client.id);
    assert.notEqual(p.current.body,c.current.body);
    assert.notEqual(p.current.summary,c.current.summary);
    assert.match(p.current.body,/Тестовый образец/);
    assert.doesNotMatch(p.current.body,/Цена выезда|Баллы за приглашения|задолженность/);
    assert.equal(p.accepted,false);
    assert.equal(c.accepted,false,'accepting privacy must not accept commercial terms');

    const publicPrivacy = ok(await t.api('GET','/api/offers/current/privacy'));
    const detail = ok(await t.api('GET','/api/offers/'+p.current.id));
    assert.equal(publicPrivacy.id,p.current.id);
    assert.equal(detail.name,p.name);
    assert.equal(detail.body,p.current.body);
    assert.equal(detail.summary,p.current.summary);
    assert.equal((await t.api('POST','/api/offers/'+legacy.id+'/accept',{},driver.token)).status,409);
    assert.deepEqual(await t.db.one('select * from consents where user_id=$1 and offer_id=$2',[driver.id,legacy.id]),oldConsent);
    assert.equal((await t.db.one('select body from offers where id=$1',[legacy.id]))?.body,oldBody);

    ok(await t.api('POST','/api/offers/'+p.current.id+'/accept',{},driver.token));
    assert.equal(getPrivacy(await status())?.accepted,true);
    assert.equal(getClient(await status())?.accepted,false);
    await seed(t.db);
    assert.equal(getPrivacy(await status())?.current.id,p.current.id);
    assert.equal(getPrivacy(await status())?.accepted,true);
    assert.deepEqual(await t.db.one('select * from consents where user_id=$1 and offer_id=$2',[driver.id,legacy.id]),oldConsent);
    const rows = await t.db.query("select id from offers where audience='privacy' order by version");
    assert.deepEqual(rows.map(r=>r.id),[legacy.id,p.current.id]);
  } finally {
    await t.close();
  }
});

test('seed never replaces a separate operator-published privacy document', async () => {
  const t = await setup();
  try {
    assert.equal(t.db.driver,'pg');
    t.clock.set(new Date(Math.max(Date.now(),t.clock.now().getTime())+600_000).toISOString());
    const operator = await t.db.one<{id:string}>(
      "insert into offers(audience,version,body,summary,effective_at) values ('privacy','fixture-operator-v1',$1,$2,now()-interval '1 day') returning id",
      ['# Synthetic operator revision for local test only','Synthetic operator summary']);
    assert.ok(operator);
    const before = await t.db.one('select * from offers where id=$1',[operator.id]);
    await seed(t.db);
    await seed(t.db);
    assert.deepEqual(await t.db.one('select * from offers where id=$1',[operator.id]),before);
    assert.equal((await t.db.query("select id from offers where audience='privacy'")).length,1);
    assert.equal(ok(await t.api('GET','/api/offers/current/privacy')).id,operator.id);
  } finally {
    await t.close();
  }
});

test('commercial seed never supersedes an operator revision or fills a future-only audience', async () => {
  const t = await setup();
  try {
    assert.equal(t.db.driver,'pg');
    const at = new Date(Math.max(Date.now(),t.clock.now().getTime())+600_000);
    t.clock.set(at.toISOString());
    const client = await t.db.one<{id:string}>(
      "insert into offers(audience,version,body,summary,effective_at) values ('client','operator-client-v1',$1,$2,$3) returning id",
      ['# Local operator commercial fixture','Local current fixture',new Date(at.getTime()-86_400_000)]);
    const performer = await t.db.one<{id:string}>(
      "insert into offers(audience,version,body,summary,effective_at) values ('performer','operator-performer-v1',$1,$2,$3) returning id",
      ['# Local future operator fixture','Local future fixture',new Date(at.getTime()+86_400_000)]);
    assert.ok(client && performer);
    const before = await t.db.query("select * from offers where audience in ('client','performer') order by audience,version");
    await seed(t.db);
    await seed(t.db);
    assert.deepEqual(await t.db.query("select * from offers where audience in ('client','performer') order by audience,version"),before);
    assert.equal(ok(await t.api('GET','/api/offers/current/client')).id,client.id);
    assert.equal(ok(await t.api('GET','/api/offers/current/performer')),null);
    assert.equal(ok(await t.api('GET','/api/offers/'+performer.id)).version,'operator-performer-v1');
    assert.equal(ok(await t.api('GET','/api/offers/current/privacy')).version,'0.3-черновик');
    t.clock.advance(86_401);
    assert.equal(ok(await t.api('GET','/api/offers/current/performer')).id,performer.id);
  } finally {
    await t.close();
  }
});
