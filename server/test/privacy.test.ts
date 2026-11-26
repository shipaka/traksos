import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';

// Персональные данные: выгрузка, запрос на удаление, обезличивание через 30 дней.

let t: T;
let u: { token: string; id: string };

before(async () => {
  t = await setup();
  u = await t.login('+79991112233');
  ok(await t.api('POST', '/api/vehicles', { brand: 'DAF', model: 'XF', plate: 'а482км178' }, u.token));
});
after(() => t.close());

test('выгрузка «всё о себе»', async () => {
  const e = ok(await t.api('GET', '/api/me/export', undefined, u.token));
  assert.equal(e.account.phone, '+79991112233');
  assert.equal(e.vehicles.length, 1);
  assert.ok(Array.isArray(e.sessions) && e.sessions.length >= 1);
});

test('выгрузка Эфира и уведомлений ограничена своим аккаунтом и явно сообщает о неполном списке', async () => {
  const other = await t.login('+79993334455');
  const moderator = await t.login('+79990000001');
  const stamp = t.clock.now();
  const beforeOwn = ok(await t.api('GET','/api/me/export',undefined,u.token));
  const beforeOther = ok(await t.api('GET','/api/me/export',undefined,other.token));
  await t.db.query(`insert into notifications(user_id,kind,title,body,created_at)
    select $1,'test','Уведомление '||n,'Своё', $2 from generate_series(1,503) n order by n`, [u.id, stamp]);
  await t.db.query(`insert into notifications(user_id,kind,title,body,created_at)
    values($1,'test','FOREIGN_NOTIFICATION','Чужое',$2)`, [other.id,stamp]);
  await t.db.query(`insert into driver_air_messages(user_id,author_label,body,origin,created_at)
    values($1,'Учебный автор','Своё открытое','human',$3),
          ($2,'Другой автор','FOREIGN_AIR','human',$3),
          (null,'TrakBot','FOREIGN_BOT','bot',$3)`, [u.id,other.id,stamp]);
  await t.db.query(`insert into driver_air_messages(user_id,author_label,body,origin,created_at,hidden_at,hidden_by)
    values($1,'Учебный автор','Своё скрытое','human',$2,$2,$3)`, [u.id,stamp,moderator.id]);
  const e = ok(await t.api('GET','/api/me/export',undefined,u.token));
  assert.deepEqual(e.exportLimits.notifications,{total:beforeOwn.exportLimits.notifications.total+503,included:500,limit:500,truncated:true});
  assert.equal(e.notifications.length,500);
  assert.equal(e.notifications[0].title,'Уведомление 503');
  assert.equal(e.notifications.at(-1).title,'Уведомление 4');
  assert.ok(e.notifications.every((n:any)=>n.body==='Своё' && !('total' in n)));
  assert.deepEqual(e.exportLimits.driverAirMessages,{total:2,included:2,limit:500,truncated:false});
  assert.deepEqual(e.driverAirMessages.map((m:any)=>[m.body,m.hidden]),[
    ['Своё скрытое',true],['Своё открытое',false],
  ]);
  assert.ok(e.driverAirMessages.every((m:any)=>!('hidden_by' in m) && !('user_id' in m)));
  const foreign = ok(await t.api('GET','/api/me/export',undefined,other.token));
  const otherTotal = beforeOther.exportLimits.notifications.total+1;
  assert.deepEqual(foreign.exportLimits.notifications,{total:otherTotal,included:Math.min(500,otherTotal),limit:500,truncated:otherTotal>500});
  assert.deepEqual(foreign.driverAirMessages.map((m:any)=>m.body),['FOREIGN_AIR']);
  const staff = ok(await t.api('GET','/api/me/export',undefined,moderator.token));
  assert.deepEqual(staff.exportLimits.driverAirMessages,{total:0,included:0,limit:500,truncated:false});
  assert.equal(staff.driverAirMessages.length,0);
});

test('удаление: не при открытой заявке; отмена запроса; через 30 дней — обезличен, вход закрыт', async () => {
  const o = ok(await t.api('POST', '/api/orders', { service: 'consult' }, u.token)).order;
  if (!['no_performer', 'cancelled'].includes(o.status)) {
    assert.equal((await t.api('POST', '/api/me/delete', {}, u.token)).status, 409);
    ok(await t.api('POST', `/api/orders/${o.id}/cancel`, { reason: 'тест' }, u.token));
  }
  const s = ok(await t.api('POST', '/api/me/delete', {}, u.token));
  assert.ok(s.deleteAt);
  assert.equal(ok(await t.api('DELETE', '/api/me/delete', undefined, u.token)).deleteRequestedAt, null);
  ok(await t.api('POST', '/api/me/delete', {}, u.token));
  t.clock.advance(29 * 86400);
  assert.equal(await t.app.privacy.processDeletions(), 0, 'срок ещё не вышел');
  t.clock.advance(2 * 86400);
  assert.equal(await t.app.privacy.processDeletions(), 1);
  assert.equal((await t.api('GET', '/api/me', undefined, u.token)).status, 401, 'сессии удалены');
  const row = await t.db.one<any>('select phone, name, status from users where id=$1', [u.id]);
  assert.match(row.phone, /^deleted-/);
  assert.equal(row.status, 'blocked');
  const again = await t.login('+79991112233');
  assert.notEqual(again.id, u.id, 'тот же номер — уже новый аккаунт');
});
