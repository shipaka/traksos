import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendInsuranceReminders } from '../src/services/insuranceReminders.ts';
import type { Db } from '../src/db/index.ts';
import type { Notifier } from '../src/services/notify.ts';

test('insurance reminders: 30/7/1 days, no duplicates and owner only', async () => {
  const sent: Array<{ ids: string[]; days: number }> = [];
  const claimed = new Set<string>();
  const due = [
    { id: 'policy30', owner_id: 'owner', plate: 'A123AA', policy_expires_on: '2026-12-11', days: 30 },
    { id: 'policy7', owner_id: 'owner', plate: 'A123AA', policy_expires_on: '2026-11-18', days: 7 },
    { id: 'policy1', owner_id: 'owner', plate: 'A123AA', policy_expires_on: '2026-11-12', days: 1 },
  ];
  const db = {
    async query(_sql: string, params: unknown[]) { return due.filter(x => x.days === params[0] && !claimed.has(x.id)); },
    async one(_sql: string, params: unknown[]) {
      const id = String(params[0]);
      if (claimed.has(id)) return null;
      claimed.add(id);
      return { id };
    },
  } as unknown as Db;
  const notifier = {
    async notify(ids: string[], event: { days: number }) { sent.push({ ids, days: event.days }); },
  } as unknown as Notifier;
  await sendInsuranceReminders(db, notifier);
  await sendInsuranceReminders(db, notifier);
  assert.deepEqual(sent, [
    { ids: ['owner'], days: 30 },
    { ids: ['owner'], days: 7 },
    { ids: ['owner'], days: 1 },
  ]);
});

test('insurance reminders: opted-out owners have no due records', async () => {
  let notifications = 0;
  const db = { async query() { return []; } } as unknown as Db;
  const notifier = { async notify() { notifications++; } } as unknown as Notifier;
  await sendInsuranceReminders(db, notifier);
  assert.equal(notifications, 0);
});

test('failed insurance notification releases only its own claim', async () => {
  const claimedAt = new Date('2026-11-11T00:00:00Z');
  const item = { id: 'policy30', owner_id: 'owner', plate: 'A123AA', policy_expires_on: '2026-12-11' };
  const updates: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    async query(_sql: string, params: unknown[]) { return params[0] === 30 ? [item] : []; },
    async one(sql: string, params: unknown[]) {
      updates.push({ sql, params });
      return sql.includes(' as claimed_at') ? { claimed_at: claimedAt } : { id: item.id };
    },
  } as unknown as Db;
  const notifier = {
    async notify() { throw new Error('notification store unavailable'); },
  } as unknown as Notifier;
  await assert.rejects(sendInsuranceReminders(db, notifier), /notification store unavailable/);
  assert.equal(updates.length, 2);
  assert.match(updates[1].sql, /set reminder_30_sent_at=null/);
  assert.match(updates[1].sql, /reminder_30_sent_at=\$2/);
  assert.match(updates[1].sql, /policy_expires_on=\$3::date/);
  assert.deepEqual(updates[1].params, [item.id, claimedAt, item.policy_expires_on]);
});

test('concurrently claimed insurance reminder does not send duplicate notifications', async () => {
  let notifications = 0;
  const item = { id: 'policy30', owner_id: 'owner', plate: 'A123AA', policy_expires_on: '2026-12-11' };
  const db = {
    async query(_sql: string, params: unknown[]) { return params[0] === 30 ? [item] : []; },
    async one() { return null; },
  } as unknown as Db;
  const notifier = { async notify() { notifications++; } } as unknown as Notifier;
  await sendInsuranceReminders(db, notifier);
  assert.equal(notifications, 0);
});
