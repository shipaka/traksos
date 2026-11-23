import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';

const profile = (name:string) => ({kind:'master',name,specialties:['electric'],
  taxStatus:'self_employed',inn:'780000000555'});

test('verified partners, including paused ones, receive exactly one inbox notice despite 12 clicks', {timeout:60000},async()=>{
  const t=await setup();
  try{
    const admin=await t.login('+79990000001');
    const approved=await t.login('+79995536001','master');
    const pending=await t.login('+79995536002','master');
    const paused=await t.login('+79995536003','master');
    for(const [u,name] of [[approved,'Approved'],[pending,'Pending'],[paused,'Paused']] as const)
      ok(await t.api('PUT','/api/performer/profile',profile(name),u.token));
    for(const u of [approved,paused])
      ok(await t.api('POST',`/api/admin/performers/${u.id}/verify`,
        {decision:'approved'},admin.token));
    await t.db.query('update performer_profiles set paused=true where user_id=$1',[paused.id]);
    const now=t.clock.now().getTime();
    const created=ok(await t.api('POST','/api/admin/announcements',{
      audience:'master',service:'electric',title:'Дежурство электриков',
      body:'Информация доступна только проверенным и действующим партнёрам.',
      startsAt:new Date(now-60_000).toISOString(),
      endsAt:new Date(now+3600_000).toISOString(),published:true,
    },admin.token));
    const path=`/api/admin/announcements/${created.id}/notify`;
    const replies=await Promise.all(Array.from({length:12},()=>t.api('POST',path,{},admin.token)));
    assert.equal(replies.filter(r=>r.status===200).length,1,JSON.stringify(replies));
    assert.ok(replies.every(r=>r.status===200 ||
      (r.status===400&&r.body?.error==='already_notified')),JSON.stringify(replies));
    const notifications=await t.db.query<{user_id:string}>(`
      select user_id from notifications where kind='announcement'
      and data->>'announcementId'=$1`,[created.id]);
    assert.deepEqual(notifications.map(x=>x.user_id).sort(),[approved.id,paused.id].sort());
    const report=await t.db.one<{notified_count:number;notified_at:Date|null}>(
      'select notified_count,notified_at from worker_announcements where id=$1',[created.id]);
    assert.equal(report?.notified_count,2);
    assert.ok(report?.notified_at);
    const audit=await t.db.one<{n:number}>(`select count(*)::int as n from audit_log
      where action='ops.announcement.notify' and target=$1`,[created.id]);
    assert.equal(audit?.n,1);
  }finally{await t.close();}
});

test('no verified partners: no false delivered status, may notify after verification', {timeout:60000},async()=>{
  const t=await setup();
  try{
    const admin=await t.login('+79990000001');
    const candidate=await t.login('+79995537001','master');
    ok(await t.api('PUT','/api/performer/profile',profile('Candidate'),candidate.token));
    const now=t.clock.now().getTime();
    const created=ok(await t.api('POST','/api/admin/announcements',{
      audience:'master',service:'electric',title:'Доступность новых мастеров',
      body:'Объявление без проверенных исполнителей не должно считаться отправленным.',
      startsAt:new Date(now-60_000).toISOString(),
      endsAt:new Date(now+3600_000).toISOString(),published:true,
    },admin.token));
    const path=`/api/admin/announcements/${created.id}/notify`;
    const denied=await t.api('POST',path,{},admin.token);
    assert.equal(denied.status,400);
    assert.equal(denied.body.error,'no_recipients');
    assert.equal((await t.db.one<{notified_at:Date|null}>(
      'select notified_at from worker_announcements where id=$1',[created.id]))?.notified_at,null);
    ok(await t.api('POST',`/api/admin/performers/${candidate.id}/verify`,
      {decision:'approved'},admin.token));
    assert.equal(ok(await t.api('POST',path,{},admin.token)).recipients,1);
  }finally{await t.close();}
});
