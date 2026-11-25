// Actual disposable PostgreSQL and admin HTTP read/export. No payment writes.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';

test('admin evidence windows keep recent history and independent latest stage itemization', {timeout:60000},async()=>{
  const t=await setup();
  try{
    const admin=await t.login('+79990000001');
    const client=await t.login('+79997809531');
    const order=ok(await t.api('POST','/api/orders',{
      service:'electric',zoneId:'spb',description:'Синтетическая история обращения'
    },client.token)).order;
    const endpoint='/api/admin/cases/'+order.id;
    const read=async()=>ok(await t.api('GET',endpoint,undefined,admin.token));
    const initial=await read();
    assert.equal(initial.history_windows.events.hasOlder,false);
    assert.equal(initial.history_windows.chat.hasOlder,false);
    await t.db.query("update orders set work_amount=250000,status='completed' where id=$1",[order.id]);
    const insertBill=async(when:string,bill:unknown)=>t.db.query(
      "insert into order_events(order_id,actor_id,type,data,created_at) values($1,$2,'amount_proposed',$3::jsonb,$4)",
      [order.id,client.id,JSON.stringify({bill}),when]);
    await insertBill('2026-12-02T01:00:00Z',{time:100000,wait:0,extras:[],total:100000});
    await t.db.query(`insert into order_events(order_id,actor_id,type,data,created_at)
      select $1,$2,'history_fixture','{}'::jsonb,'2026-12-02T02:00:00Z'::timestamptz+n*interval '1 second'
      from generate_series(1,610) n`,[order.id,client.id]);
    await insertBill('2026-12-02T03:00:00Z',{
      time:200000,wait:10000,extras:[{name:'  =unsafe()',amount:40000}],total:250000
    });
    await t.db.query(`insert into chat_messages(order_id,sender_id,kind,body,created_at)
      select $1,null,'system','Синтетическое сообщение '||n,'2026-12-02T03:00:00Z'::timestamptz+n*interval '1 second'
      from generate_series(1,510) n`,[order.id]);
    const current=await read();
    assert.equal(current.events.length,600);
    assert.equal(current.chat.length,500);
    assert.equal(current.history_windows.events.hasOlder,true);
    assert.equal(current.history_windows.chat.hasOlder,true);
    assert.equal(current.events.at(-1).type,'amount_proposed');
    assert.equal(current.chat.at(-1).body,'Синтетическое сообщение 510');
    assert.equal(current.chat[0].body,'Синтетическое сообщение 11');
    const checkBill=(detail:any)=>{
      const items=detail.stages.find((s:any)=>s.id===order.id).recorded_items;
      assert.equal(items.workVerified,true);
      assert.deepEqual(items.lines.filter((l:any)=>l.kind!=='callout').map((l:any)=>l.amount),[200000,10000,40000]);
    };
    checkBill(current);
    // Even the latest proposal may age out of the displayed timeline. The
    // latest financial source must remain independently accessible.
    await t.db.query(`insert into order_events(order_id,actor_id,type,data,created_at)
      select $1,$2,'history_fixture','{}'::jsonb,'2026-12-02T04:00:00Z'::timestamptz+n*interval '1 second'
      from generate_series(1,610) n`,[order.id,client.id]);
    const aged=await read();
    assert.equal(aged.events.length,600);
    assert.ok(aged.events.every((e:any)=>e.type!=='amount_proposed'));
    checkBill(aged);
    const exported=ok(await t.api('GET',endpoint+'/export',undefined,admin.token));
    assert.ok(exported.csv.includes("'  =unsafe()"));
    assert.ok(exported.csv.includes('40000'));
    assert.match(exported.notice,/Не является/);
    assert.equal((await t.api('GET',endpoint,undefined,client.token)).status,403);
    assert.equal((await t.api('GET',endpoint+'/export',undefined,client.token)).status,403);
    const audits=await t.db.query("select action from audit_log where target=$1 and action in ('admin.case_view','admin.case_export')",[order.id]);
    assert.ok(audits.some((x:any)=>x.action==='admin.case_export'));
    assert.ok(audits.some((x:any)=>x.action==='admin.case_view'));
  }finally{await t.close();}
});
