import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';

test('account-deletion retries, cancellation and concurrent workers are durable and idempotent',
  { timeout: 60000 }, async () => {
    const t = await setup();
    try {
      const admin = await t.login('+79990000001');
      const user = await t.login('+79998880178');
      const getCount = async (action: string) => {
        const row = await t.db.one<{ n: number }>(
          'select count(*)::int as n from audit_log where actor_id=$1 and action=$2',
          [user.id, action]);
        return row?.n ?? 0;
      };
      const notices = async () => (await t.db.one<{ n: number }>(
        `select count(*)::int as n from notifications
         where user_id=$1 and kind='privacy' and title='Запрос на удаление данных'`,
        [admin.id]))?.n ?? 0;

      const original = ok(await t.api('GET', '/api/me/privacy', undefined, user.token));
      assert.equal(original.deleteRequestedAt, null);
      assert.equal(original.graceDays, 30);
      assert.equal(await getCount('privacy.delete_requested'), 0);

      // Repeated taps and concurrent HTTP requests must create one durable
      // request, one audit entry and one alert to staff, not eight.
      const requests = await Promise.all(Array.from({length: 8},
        () => t.api('POST', '/api/me/delete', {}, user.token)));
      assert.ok(requests.every(x => x.status === 200), JSON.stringify(requests));
      assert.equal(new Set(requests.map(x => x.body.deleteRequestedAt)).size, 1);
      assert.equal(await getCount('privacy.delete_requested'), 1);
      assert.equal(await notices(), 1);
      assert.ok(requests[0].body.deleteAt);

      const cancels = await Promise.all(Array.from({length: 5},
        () => t.api('DELETE', '/api/me/delete', undefined, user.token)));
      assert.ok(cancels.every(x => x.status === 200), JSON.stringify(cancels));
      assert.ok(cancels.every(x => x.body.deleteRequestedAt === null));
      assert.equal(await getCount('privacy.delete_cancelled'), 1);
      assert.equal(await getCount('privacy.delete_requested'), 1);

      // A genuine second request after cancellation creates one new audit
      // and notification, not a continuation of the cancelled request.
      const again = await Promise.all(Array.from({length: 3},
        () => t.api('POST', '/api/me/delete', {}, user.token)));
      assert.ok(again.every(x => x.status === 200), JSON.stringify(again));
      assert.equal(await getCount('privacy.delete_requested'), 2);
      assert.equal(await notices(), 2);

      // Two scheduled processes can select the same due account. Only one
      // must win its row-conditional UPDATE, scrub and audit the deletion.
      t.clock.advance(31 * 86400);
      const processed = await Promise.all(Array.from({length: 3},
        () => t.app.privacy.processDeletions()));
      assert.equal(processed.reduce((a,b) => a + b,0), 1,
        'concurrent privacy workers must process one account exactly once');
      assert.equal(await t.app.privacy.processDeletions(), 0);
      const deleted = await t.db.one<any>(
        'select phone,name,status,deleted_at,delete_requested_at from users where id=$1',
        [user.id]);
      assert.ok(deleted?.phone?.startsWith('deleted-'));
      assert.equal(deleted.name, null);
      assert.equal(deleted.status, 'blocked');
      assert.ok(deleted.deleted_at);
      assert.equal((await t.db.one<{n:number}>(
        'select count(*)::int as n from sessions where user_id=$1',[user.id]))?.n,0);
      assert.equal((await t.db.one<{n:number}>(
        "select count(*)::int as n from audit_log where action='privacy.deleted' and target=$1",
        [user.id]))?.n,1);
      const lateCancel = await t.api('DELETE', '/api/me/delete', undefined, user.token);
      assert.equal(lateCancel.status,401,'session cannot cancel after account erasure');
      assert.equal(await getCount('privacy.delete_cancelled'),1);
    } finally {
      await t.close();
    }
  });

test('requesting deletion while there is an active SOS remains forbidden',
  {timeout:60000}, async () => {
    const t=await setup();
    try {
      const customer=await t.login('+79998880179');
      const created=ok(await t.api('POST','/api/orders',{
        service:'electric',description:'Тест удаления и активного SOS',
        address:'Санкт-Петербург, тестовый сервис',regionId:'spb',zoneId:'spb',
      },customer.token));
      assert.ok(created?.order?.id,'real order fixture was not created');
      // No online synthetic partner can end the search immediately with
      // no_performer. This test needs a genuinely open order lifecycle.
      await t.db.query("update orders set status='searching' where id=$1",[created.order.id]);
      const denied=await t.api('POST','/api/me/delete',{},customer.token);
      assert.equal(denied.status,409);
      assert.equal(denied.body.error,'active_orders');
      const status=ok(await t.api('GET','/api/me/privacy',undefined,customer.token));
      assert.equal(status.deleteRequestedAt,null);
      assert.equal((await t.db.one<{n:number}>(
        "select count(*)::int as n from audit_log where actor_id=$1 and action='privacy.delete_requested'",
        [customer.id]))?.n,0);
    } finally {await t.close();}
  });
