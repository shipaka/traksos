import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';

test('six concurrent moderation resolutions commit one decision, one audit and one durable inbox message',
  {timeout:90000},async()=>{
    const t=await setup();
    try {
      const admin=await t.login('+79990000001');
      const client=await t.login('+79998891011');
      const opened=ok(await t.api('POST','/api/appeals',
        {text:'Прошу проверить ограничение; это синтетическое обращение для теста.'},client.token));
      assert.ok(opened.id);
      const id=opened.id as string;
      const attempts=await Promise.all(Array.from({length:6},()=>t.api('POST',
        `/api/mod/cases/${id}/decide`,{decision:'rejected',note:'Проверка конкурентных решений'},admin.token)));
      assert.equal(attempts.filter(x=>x.status===200).length,1,
        JSON.stringify(attempts.map(x=>({status:x.status,error:x.body?.error}))));
      assert.ok(attempts.filter(x=>x.status!==200)
        .every(x=>x.status===409 && x.body?.error==='resolved'));
      const stored=await t.db.one<{status:string;decision:string}>(
        'select status,decision from mod_cases where id=$1',[id]);
      assert.equal(stored?.status,'resolved');
      assert.equal(stored?.decision,'rejected');
      const audits=await t.db.one<{n:number}>(
        "select count(*)::int as n from audit_log where target=$1 and action='mod.decide'",[id]);
      assert.equal(audits?.n,1,'repeated clicks must not duplicate a legal decision');
      const inbox=await t.db.one<{n:number}>(`
        select count(*)::int as n from notifications where user_id=$1
          and kind='mod_case' and data->>'caseId'=$2`,[client.id,id]);
      assert.equal(inbox?.n,1,'the persisted notification is in the decision transaction');

      const priorityDenied=await t.api('POST',`/api/mod/cases/${id}/priority`,
        {priority:1},admin.token);
      assert.equal(priorityDenied.status,409,'resolved cases cannot get new priority');
      const reopened=await Promise.all(Array.from({length:3},()=>t.api('POST',
        `/api/mod/cases/${id}/reopen`,{},admin.token)));
      assert.equal(reopened.filter(x=>x.status===200).length,1);
      assert.ok(reopened.filter(x=>x.status!==200).every(x=>x.status===409));
      assert.equal((await t.db.one<{n:number}>(
        "select count(*)::int as n from audit_log where target=$1 and action='mod.reopen'",[id]))?.n,1);

      const priority=await Promise.all(Array.from({length:4},()=>t.api('POST',
        `/api/mod/cases/${id}/priority`,{priority:1},admin.token)));
      assert.ok(priority.every(x=>x.status===200));
      assert.equal((await t.db.one<{priority:number}>(
        'select priority from mod_cases where id=$1',[id]))?.priority,1);
      assert.equal((await t.db.one<{n:number}>(
        "select count(*)::int as n from audit_log where target=$1 and action='mod.priority'",[id]))?.n,1);
      assert.equal((await t.api('POST',`/api/mod/cases/${id}/decide`,
        {decision:'hide'},admin.token)).status,400,'wrong-kind decision rejected without mutation');
      assert.equal((await t.db.one<{n:number}>(
        "select count(*)::int as n from audit_log where target=$1 and action='mod.decide'",[id]))?.n,1);
    }finally{await t.close();}
  });

test('moderator order-chat entry is accompanied by exactly the same durable audit transaction',
  {timeout:90000},async()=>{
    const t=await setup();
    try {
      const admin=await t.login('+79990000001');
      const client=await t.login('+79998891012');
      const o=ok(await t.api('POST','/api/orders',{
        service:'electric',description:'Тестовый SOS для модерации'
      },client.token)).order;
      const m=await t.db.one<{id:string}>(`
        insert into mod_cases(kind,title,text,opened_by,target_id,order_id,priority)
        values ('dispute','Вопрос по заявке','Синтетический разбор',$1,$1,$2,1)
        returning id`,[client.id,o.id]);
      assert.ok(m?.id);
      const entered=ok(await t.api('POST',`/api/mod/cases/${m!.id}/enter-chat`,{},admin.token));
      assert.equal(entered.orderId,o.id);
      assert.equal((await t.db.one<{n:number}>(
        "select count(*)::int as n from audit_log where target=$1 and action='mod.chat_open'",[m!.id]))?.n,1);
      assert.equal((await t.db.one<{n:number}>(
        "select count(*)::int as n from chat_messages where order_id=$1 and kind='system' and body='Модератор подключился к чату'",
        [o.id]))?.n,1);
      const denied=await t.api('POST',`/api/mod/cases/${m!.id}/enter-chat`,{},client.token);
      assert.equal(denied.status,403);
    }finally{await t.close();}
  });


test('resolved order case notifies the actual owner, never a formerly attached driver',
  {timeout:90000},async()=>{
    const t=await setup();
    try{
      const admin=await t.login('+79990000001');
      const owner=await t.login('+79998891021');
      const formerDriver=await t.login('+79998891022','driver');
      const vehicle=ok(await t.api('POST','/api/vehicles',
        {brand:'Volvo',year:2013,plate:'А545АА78'},owner.token));
      const order=ok(await t.api('POST','/api/orders',
        {service:'electric',description:'Синтетическое обращение'},owner.token)).order;
      // Simulate an old snapshot: the driver originally created this order,
      // but is no longer assigned to the vehicle of the fleet owner.
      await t.db.query('update orders set created_by=$2, vehicle_id=$3 where id=$1',
        [order.id,formerDriver.id,vehicle.id]);
      const c=await t.db.one<{id:string}>(`insert into mod_cases
        (kind,title,text,opened_by,target_id,order_id,priority)
        values ('dispute','Старое обращение','Выполнено другим водителем',$1,$1,$2,1)
        returning id`,[formerDriver.id,order.id]);
      assert.ok(c?.id);
      ok(await t.api('POST',`/api/mod/cases/${c!.id}/decide`,
        {decision:'agreed',note:'Решение для владельца'},admin.token));
      const count=async(userId:string)=>(await t.db.one<{n:number}>(`
        select count(*)::int as n from notifications
         where user_id=$1 and kind='mod_case' and data->>'caseId'=$2`,
        [userId,c!.id]))?.n??0;
      assert.equal(await count(formerDriver.id),0,
        'historical opened_by/target_id must not override revoked vehicle access');
      assert.equal(await count(owner.id),1);
      assert.equal(t.app.hub.log.some(e=>e.userId===formerDriver.id&&
        e.event.type==='mod_case'&&e.event.caseId===c!.id),false);
    }finally{await t.close();}
  });
