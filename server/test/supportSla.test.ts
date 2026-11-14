import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';

test('support SLA: moderator-first, 60:00 escalation once, late and timely human replies', { timeout: 60000 }, async () => {
  const t = await setup();
  try {
    const admin = await t.login('+79990000001');
    const moderator = await t.login('+79995554446');
    const client = await t.login('+79995554447');
    await t.db.query("update users set roles=ARRAY['moderator']::text[] where id=$1", [moderator.id]);

    const ticket = ok(await t.api('POST', '/api/support',
      { topic: 'Мастер не приехал', text: 'Пожалуйста, ответьте на обращение' }, client.token));
    const row = await t.db.one<any>(
      'select sla_deadline_at, first_staff_reply_at, sla_overdue_at from support_tickets where id=$1',
      [ticket.id]);
    assert.ok(row?.sla_deadline_at, 'deadline is persisted');
    assert.equal(row.first_staff_reply_at, null);
    assert.equal(row.sla_overdue_at, null);

    const inbox = async (userId: string) => (await t.db.query<any>(
      "select id from notifications where user_id=$1 and kind='support'", [userId])).length;
    assert.equal(await inbox(admin.id), 0, 'admins are not notified at first intake');
    assert.equal(await inbox(moderator.id), 1, 'moderator owns first response');
    const deadline = new Date(row.sla_deadline_at).getTime();
    t.clock.set(new Date(deadline - 1000).toISOString());
    assert.equal(await t.app.support.tickSla(), 0, '59:59 is not overdue');
    assert.equal(await inbox(admin.id), 0);

    t.clock.set(new Date(deadline).toISOString());
    const results = await Promise.all(Array.from({ length: 12 }, () => t.app.support.tickSla()));
    assert.equal(results.reduce((sum, n) => sum + n, 0), 1,
      '12 concurrent workers must escalate once');
    assert.equal(await inbox(admin.id), 1);
    assert.equal((await t.db.query(
      "select id from support_sla_events where ticket_id=$1 and kind='first_reply_overdue'",
      [ticket.id])).length, 1);
    assert.equal(await t.app.support.tickSla(), 0, 'repeat timer does not duplicate');

    const queue = ok(await t.api('GET', '/api/admin/support', undefined, admin.token));
    const active = queue.find((v: any) => v.id === ticket.id);
    assert.ok(active?.sla_overdue_at, 'admin queue shows overdue marker');
    t.clock.set(new Date(deadline + 30_000).toISOString());
    ok(await t.api('POST', `/api/support/${ticket.id}/messages`,
      { body: 'Мы проверяем заявку, первый ответ от сотрудника' }, moderator.token));
    const afterLate = await t.db.one<any>(
      'select first_staff_reply_at, sla_overdue_at from support_tickets where id=$1', [ticket.id]);
    assert.ok(afterLate?.first_staff_reply_at);
    assert.ok(afterLate?.sla_overdue_at, 'late reply does not erase breach history');
    assert.equal(await t.app.support.tickSla(), 0);
    assert.equal(await inbox(admin.id), 1);

    // Closing a ticket without replying does NOT pretend a human responded.
    const closed = ok(await t.api('POST', '/api/support',
      { topic: 'Проблема с оплатой', text: 'Это другое обращение' }, client.token));
    ok(await t.api('POST', `/api/support/${closed.id}/close`, {}, moderator.token));
    assert.equal((await t.db.one<any>(
      'select first_staff_reply_at from support_tickets where id=$1', [closed.id]))?.first_staff_reply_at, null);

    const timely = ok(await t.api('POST', '/api/support',
      { topic: 'Другое', text: 'Пожалуйста, ответьте быстро' }, client.token));
    const timeRow = await t.db.one<any>(
      'select sla_deadline_at from support_tickets where id=$1', [timely.id]);
    t.clock.set(new Date(new Date(timeRow!.sla_deadline_at).getTime() - 1000).toISOString());
    ok(await t.api('POST', `/api/support/${timely.id}/messages`,
      { body: 'Вот ответ модератора до истечения часа' }, moderator.token));
    t.clock.set(new Date(new Date(timeRow!.sla_deadline_at).getTime() + 2000).toISOString());
    await t.app.support.tickSla();
    const stillTimely = await t.db.one<any>(
      'select first_staff_reply_at, sla_overdue_at from support_tickets where id=$1', [timely.id]);
    assert.ok(stillTimely?.first_staff_reply_at);
    assert.equal(stillTimely?.sla_overdue_at, null);
    assert.equal((await t.db.query(
      "select id from support_sla_events where ticket_id=$1", [timely.id])).length, 0);

    // If all moderators disappear, intake must not become invisible to admins.
    await t.db.query("update users set roles=ARRAY['client']::text[] where id=$1", [moderator.id]);
    const adminBeforeFallback = await inbox(admin.id);
    ok(await t.api('POST', '/api/support',
      { topic: 'Не работает приложение', text: 'Модераторов сейчас нет' }, client.token));
    assert.equal(await inbox(admin.id), adminBeforeFallback + 1);
  } finally {
    await t.close();
  }
});
