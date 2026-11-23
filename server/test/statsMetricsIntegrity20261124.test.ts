import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';

async function profile(t: Awaited<ReturnType<typeof setup>>, admin:{token:string},
  phone:string, kind:'master'|'tow', approved=true) {
  const worker=await t.login(phone,kind);
  ok(await t.api('PUT','/api/performer/profile',{
    kind,name:'Проверка честной статистики',specialties:kind==='master'?['electric']:[],
    taxStatus:'self_employed',inn:'780000000555',
  },worker.token));
  if(approved)ok(await t.api('POST',`/api/admin/performers/${worker.id}/verify`,
    {decision:'approved'},admin.token));
  ok(await t.api('POST','/api/performer/line',{lineStatus:'online'},worker.token));
  return worker;
}

test('live, summary and overview exclude paused, holiday, blocked and unverified workers from online figures',
  {timeout:60000},async()=>{
  const t=await setup();
  try{
    const admin=await t.login('+79990000001');
    const active=await profile(t,admin,'+79996663001','master');
    const paused=await profile(t,admin,'+79996663002','master');
    const holiday=await profile(t,admin,'+79996663003','master');
    const blocked=await profile(t,admin,'+79996663004','master');
    const pending=await profile(t,admin,'+79996663005','master',false);
    const tow=await profile(t,admin,'+79996663006','tow');
    await t.db.query('update performer_profiles set paused=true where user_id=$1',[paused.id]);
    await t.db.query(`update performer_profiles
      set extras=coalesce(extras,'{}'::jsonb)||'{"vacation":true}'::jsonb
      where user_id=$1`,[holiday.id]);
    await t.db.query("update users set status='blocked' where id=$1",[blocked.id]);

    const live=ok(await t.api('GET','/api/live',undefined,admin.token));
    assert.equal(live.masters_online,1,'only the usable specialist is online');
    assert.equal(live.tow_online,1,'a genuine approved tow is online');
    const summary=ok(await t.api('GET','/api/admin/summary',undefined,admin.token));
    assert.equal(summary.today.mastersOnline,1);
    assert.equal(summary.today.towOnline,1);
    const overview=ok(await t.api('GET','/api/admin/stats?days=30',undefined,admin.token));
    assert.equal(overview.people.performers_online,2,
      'whole-platform statistics must use same live worker definition');
    assert.ok(overview.people.performers_approved>=5,
      'approval history is separate from operational availability');
    assert.ok(active.id && pending.id && tow.id);
  } finally {await t.close();}
});

test('stats reject impossible periods and include awaiting-owner orders in active counters',
  {timeout:60000},async()=>{
  const t=await setup();
  try{
    const admin=await t.login('+79990000001');
    const client=await t.login('+79996663101');
    const created=ok(await t.api('POST','/api/orders',{
      service:'electric',zoneId:'spb',paymentMethod:'cash',
    },client.token));
    await t.db.query("update orders set status='awaiting_owner' where id=$1",
      [created.order.id]);
    const stats=ok(await t.api('GET','/api/admin/stats?days=30',undefined,admin.token));
    assert.ok(stats.totals.active>=1,'a draft awaiting fleet owner approval is still active');
    for (const badDays of ['nope','2.5','NaN']) {
      const response=await t.api('GET',`/api/admin/stats?days=${badDays}`,undefined,admin.token);
      assert.equal(response.status,400,'invalid day window must not leak a SQL 500');
    }
    assert.equal((await t.api('GET','/api/admin/stats',
      undefined,client.token)).status,403,'full fleet analytics are admin-only');
  }finally{await t.close();}
});

test('admin live orders prioritize SOS and show newest working orders first',
  {timeout:60000},async()=>{
  const t=await setup();
  try{
    const admin=await t.login('+79990000001');
    const client=await t.login('+79996663201');
    const ids:string[]=[];
    for(let i=0;i<3;i++){
      const created=ok(await t.api('POST','/api/orders',{
        service:'electric',zoneId:'spb',paymentMethod:'cash',
        description:'Проверка порядка служебного диспетчерского списка',
      },client.token));
      const id=created.order.id as string;
      ids.push(id);
      await t.db.query(`update orders set status='searching',is_sos=$2,
        created_at=now()-$3::int*interval '1 minute' where id=$1`,
        [id,i===1,[120,10,5][i]]);
    }
    const list=ok(await t.api('GET','/api/admin/live',undefined,admin.token));
    assert.deepEqual(list.slice(0,3).map((x:any)=>x.id),[ids[1],ids[2],ids[0]],
      'highest priority first; newer orders before older within that priority');
  }finally{await t.close();}
});
