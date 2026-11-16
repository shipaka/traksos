import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok, type T } from './helpers.ts';
import { DeveloperReportDelivery, type DeveloperReportNotice } from '../src/services/developerReportDelivery.ts';

let t: T;
let admin: { id: string; token: string };
before(async () => {
  t = await setup();
  admin = await t.login('+79990000001');
});
after(() => t.close());

async function report(phone: string, details: string) {
  return ok(await t.api('POST','/api/admin/developer-reports',{
    category:'registration', phone, details,
  },admin.token)) as { id:string };
}

test('delivery is disabled without an operator-configured endpoint', async () => {
  const worker = new DeveloperReportDelivery(t.db, null);
  assert.equal(worker.enabled, false);
  assert.equal(await worker.tick(), 0);
});

test('durable delivery sends only a nonpersonal report identifier and never duplicates acknowledged notices', async () => {
  const entry = await report('+79998881001', 'Сбой при вводе приватного номера: пароль 123456');
  const sent: DeveloperReportNotice[] = [];
  const worker = new DeveloperReportDelivery(t.db, async notice => { sent.push(notice); });
  assert.equal(worker.enabled, true);
  assert.equal(await worker.tick(), 1);
  assert.equal(await worker.tick(), 0);
  const item = sent[0];
  assert.equal(item.reportId,entry.id);
  assert.equal(item.category,'registration');
  assert.equal(item.event,'traksos.developer_report.created');
  const serialized = JSON.stringify(item);
  assert.ok(!serialized.includes('+79998881001'));
  assert.ok(!serialized.includes('123456'));
  assert.ok(!serialized.includes('приватного'));
  const row = await t.db.one<any>('select delivery_sent_at,delivery_attempts,delivery_last_error from admin_developer_reports where id=$1',[entry.id]);
  assert.ok(row.delivery_sent_at);
  assert.equal(row.delivery_attempts,1);
  assert.equal(row.delivery_last_error,null);
  const visible = ok(await t.api('GET','/api/admin/developer-reports',undefined,admin.token));
  assert.equal(visible.find((x:any)=>x.id===entry.id).delivery_sent_at !== null,true);
});

test('failed webhook uses bounded retry; two workers do not claim the same row', async () => {
  const entry = await report('+79998881002','Повторное обращение из за сбоя SMS');
  let attempts = 0;
  const sender = async (_n:DeveloperReportNotice) => {
    attempts++;
    if (attempts === 1) throw Error('Secret URL and personal data must never persist');
  };
  const worker = new DeveloperReportDelivery(t.db,sender);
  const competitor = new DeveloperReportDelivery(t.db,sender);
  const first = await Promise.all([worker.tick(),competitor.tick()]);
  assert.equal(first.reduce((a,b)=>a+b,0),1);
  let status = await t.db.one<any>('select delivery_sent_at,delivery_attempts,delivery_next_at,delivery_last_error from admin_developer_reports where id=$1',[entry.id]);
  assert.equal(status.delivery_sent_at,null);
  assert.equal(status.delivery_attempts,1);
  assert.match(status.delivery_last_error,/Автоматический повтор/);
  assert.ok(!status.delivery_last_error.includes('Secret URL'));
  assert.equal(await worker.tick(),0,'backoff must block immediate repeat');
  await t.db.query("update admin_developer_reports set delivery_next_at=now()-interval '1 second' where id=$1",[entry.id]);
  assert.equal(await competitor.tick(),1);
  status = await t.db.one<any>('select delivery_sent_at,delivery_attempts from admin_developer_reports where id=$1',[entry.id]);
  assert.ok(status.delivery_sent_at);
  assert.equal(status.delivery_attempts,2);
  assert.equal(attempts,2);
});

test('resolved internal reports do not produce outbound notifications', async () => {
  const entry = await report('+79998881003','Неисправность уже устранена администратором');
  ok(await t.api('POST',`/api/admin/developer-reports/${entry.id}/resolve`,{},admin.token));
  let touched = false;
  const worker = new DeveloperReportDelivery(t.db,async () => { touched=true; });
  assert.equal(await worker.tick(),0);
  assert.equal(touched,false);
});
