// SUPPORT-ATOMIC-LIFECYCLE-20261124
// Disposable PostgreSQL/HTTP tests: no real customer, SMS, push or payment data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ok } from './helpers.ts';
import { SupportService } from '../src/services/support.ts';

const phone=(n:number)=>'+7999777'+String(n).padStart(4,'0');
const vehicle=(n:number)=>({brand:'Scania',model:'R',year:2018,plate:'А'+String(n).padStart(3,'0')+'АА178'});
const orderBody=(vehicleId:string)=>({
  service:'electric',isSos:true,problem:'no_start',
  description:'Проблема запуска двигателя на стоянке',
  zoneId:'spb',regionId:'spb',address:'Санкт-Петербург, тестовая стоянка',
  lat:59.95,lng:30.35,vehicleId,
});

test('HTTP/PG: first message and ticket roll back together for standalone AND order-linked requests',async()=>{
  const t=await setup();
  try{
    const owner=await t.login(phone(4101));
    const v=ok(await t.api('POST','/api/vehicles',vehicle(441),owner.token));
    const order=ok(await t.api('POST','/api/orders',orderBody(v.id),owner.token)).order;
    assert.ok(order.id);
    const topic='Атомарность поддержки '+Date.now();
    await t.db.exec(`
      create function reject_support_first_20261124() returns trigger
      language plpgsql as $$ begin
        if new.sender_id is not null then raise exception 'synthetic first message write failure'; end if;
        return new;
      end; $$;
      create trigger reject_support_first_20261124 before insert on support_messages
        for each row execute function reject_support_first_20261124();
    `);
    for(const args of [
      {topic,text:'Самостоятельное обращение с аварийной сетью'},
      {topic,text:'Обращение по заявке при нестабильной сети',orderId:order.id},
    ]){
      const result=await t.api('POST','/api/support',args,owner.token);
      assert.ok(result.status>=400,'message insert failure must fail the request');
    }
    const orphan=await t.db.one<{n:number}>(`
      select count(*)::int as n from support_tickets where user_id=$1 and topic=$2`,
      [owner.id,topic]);
    assert.equal(orphan?.n,0,'a failed message insert must not leave empty tickets');
    await t.db.exec(`
      drop trigger reject_support_first_20261124 on support_messages;
      drop function reject_support_first_20261124();
    `);
    const standalone=ok(await t.api('POST','/api/support',
      {topic,text:'Самостоятельное обращение успешно создано'},owner.token));
    const linked=ok(await t.api('POST','/api/support',
      {topic,text:'Обращение по заявке успешно создано',orderId:order.id},owner.token));
    for(const row of [standalone,linked]){
      assert.equal(row.messages.length,1,'new ticket must contain its first message');
      assert.equal(row.status,'open');
    }
    assert.equal(linked.order?.id,order.id);
  }finally{await t.close();}
});

test('HTTP/PG: parallel close is idempotent; failed closure event rolls back status',async()=>{
  const t=await setup();
  try{
    const owner=await t.login(phone(4102));
    const admin=await t.login('+79990000001');
    const ticket=ok(await t.api('POST','/api/support',
      {topic:'Не работает приложение',text:'Возникла ошибка при входе'},
      owner.token));
    const id=ticket.id as string;
    await t.db.exec(`
      create function reject_support_close_20261124() returns trigger
      language plpgsql as $$ begin
        if new.sender_id is null then raise exception 'synthetic closure event failure'; end if;
        return new;
      end; $$;
      create trigger reject_support_close_20261124 before insert on support_messages
        for each row execute function reject_support_close_20261124();
    `);
    const failed=await t.api('POST','/api/support/'+id+'/close',{},admin.token);
    assert.ok(failed.status>=400,'synthetic closure event failure should fail');
    const unchanged=ok(await t.api('GET','/api/support/'+id,undefined,owner.token));
    assert.equal(unchanged.status,'open','status must roll back if closure message fails');
    assert.equal(unchanged.messages.filter((x:any)=>!x.sender_id).length,0);
    await t.db.exec(`
      drop trigger reject_support_close_20261124 on support_messages;
      drop function reject_support_close_20261124();
    `);
    // Closing as staff also creates the owner's durable inbox entry. A DB
    // failure in that entry must roll back BOTH closed status and system event.
    await t.db.exec(`
      create function reject_support_inbox_20261124() returns trigger
      language plpgsql as $$ begin
        if new.kind='support' and new.title like '%закрыто%' then
          raise exception 'synthetic support inbox failure';
        end if;
        return new;
      end; $$;
      create trigger reject_support_inbox_20261124 before insert on notifications
        for each row execute function reject_support_inbox_20261124();
    `);
    const noInbox=await t.api('POST','/api/support/'+id+'/close',{},admin.token);
    assert.ok(noInbox.status>=400,'closing without a durable owner inbox entry must roll back');
    const stillOpen=ok(await t.api('GET','/api/support/'+id,undefined,owner.token));
    assert.equal(stillOpen.status,'open');
    assert.equal(stillOpen.messages.filter((x:any)=>!x.sender_id).length,0,
      'failed inbox insert must not commit a terminal system event');
    await t.db.exec(`
      drop trigger reject_support_inbox_20261124 on notifications;
      drop function reject_support_inbox_20261124();
    `);
    const response=await Promise.all([
      t.api('POST','/api/support/'+id+'/close',{},admin.token),
      t.api('POST','/api/support/'+id+'/close',{},owner.token),
      t.api('POST','/api/support/'+id+'/close',{},admin.token),
      t.api('POST','/api/support/'+id+'/close',{},owner.token),
    ]);
    response.forEach(x=>assert.equal(x.status,200,'concurrent authorized close should be idempotent'));
    const closed=ok(await t.api('GET','/api/support/'+id,undefined,owner.token));
    assert.equal(closed.status,'closed');
    assert.equal(closed.messages.filter((x:any)=>!x.sender_id).length,1,
      'only one closure system message can be committed');
    const ticketRow=await t.db.one<{closed_by:string}>(
      'select closed_by from support_tickets where id=$1',[id]);
    assert.ok([owner.id,admin.id].includes(ticketRow!.closed_by));
    const received=await t.db.one<{n:number}>(`
      select count(*)::int as n from notifications where user_id=$1
        and kind='support' and data->>'ticketId'=$2 and title like '%закрыто%'`,
      [owner.id,id]);
    assert.ok((received?.n??0)<=1,'duplicate close must not duplicate final notification');
    const after=await t.api('POST','/api/support/'+id+'/messages',
      {body:'Сообщение после закрытия'},owner.token);
    assert.equal(after.status,409,'cannot append after serialized closure');
  }finally{await t.close();}
});

test('HTTP/PG: support push and inbox previews redact client phone numbers',async()=>{
  const t=await setup();
  try{
    const owner=await t.login(phone(4103));
    const admin=await t.login('+79990000001');
    const external='+7 999 222-11-44';
    const created=ok(await t.api('POST','/api/support',{
      topic:'Не работает приложение',
      text:'Прошу проверить номер '+external+' при ошибке входа',
    },owner.token));
    const initial=await t.db.query<{body:string}>(`
      select body from notifications where user_id=$1 and kind='support'
        and data->>'ticketId'=$2 order by id`,[admin.id,created.id]);
    assert.ok(initial.length>0,'staff inbox should contain support intake');
    assert.ok(initial.every(x=>!x.body.includes(external)),
      'initial notifications must never contain a raw user phone number');
    ok(await t.api('POST','/api/support/'+created.id+'/messages',{
      body:'Дополнительный номер '+external+' для проверки',
    },owner.token));
    const all=await t.db.query<{body:string}>(`
      select body from notifications where user_id=$1 and kind='support'
        and data->>'ticketId'=$2 order by id`,[admin.id,created.id]);
    assert.ok(all.length>=2,'follow-up should notify intake team');
    assert.ok(all.every(x=>!x.body.includes(external)),
      'follow-up inbox must not leak raw phone numbers');
    const thread=ok(await t.api('GET','/api/support/'+created.id,undefined,owner.token));
    assert.ok(thread.messages.every((x:any)=>!String(x.body).includes(external)),
      'client phone was redacted from persisted messages');
  }finally{await t.close();}
});

test('ledger-related support also writes its first message inside the same transaction',async()=>{
  const calls:string[]=[];
  const user={id:'performer-A',roles:['master'],name:'Мастер',phone:'+79991110000'} as any;
  let notified=false;
  const db:any={
    one:async(sql:string)=>{
      calls.push('one:'+sql);
      if(sql.includes('from ledger_entries'))return {id:41,order_id:null};
      throw Error('unexpected outer query '+sql);
    },
    tx:async(fn:any)=>{
      const q={
        query:async(sql:string)=>{
          calls.push('tx-query:'+sql);
          if(sql.startsWith('insert into support_messages'))throw Error('simulated rollback');
          return [];
        },
        one:async(sql:string)=>{
          calls.push('tx-one:'+sql);
          if(sql.startsWith('select id from support_tickets'))return null;
          if(sql.includes('insert into support_tickets'))return {id:'ticket-1',number:57};
          throw Error('unexpected transaction query '+sql);
        },
      };
      return fn(q);
    },
  };
  const service=new SupportService(db,{
    notify:async()=>{notified=true;},
  } as any,{} as any,()=>new Date('2026-11-24T00:00:00Z'));
  await assert.rejects(
    service.open(user,{topic:'Вопрос по операции',text:'Не сходится начисление',ledgerEntryId:41}),
    /simulated rollback/);
  assert.ok(calls.some(x=>x.startsWith('tx-query:insert into support_messages')),
    'ledger first message must be inside the ticket transaction');
  assert.equal(notified,false,'failed atomic create must not notify staff');
});


test('HTTP/PG: reply inbox failure rolls back both message and first staff response',async()=>{
  const t=await setup();
  try{
    const owner=await t.login(phone(4104));
    const admin=await t.login('+79990000001');
    const ticket=ok(await t.api('POST','/api/support',{
      topic:'Не работает приложение',text:'Не загружается список заявок',
    },owner.token));
    const id=ticket.id;
    await t.db.exec(`
      create function reject_support_reply_inbox() returns trigger language plpgsql as $$
      begin
        if new.kind='support' then raise exception 'synthetic reply inbox failure'; end if;
        return new;
      end; $$;
      create trigger reject_support_reply_inbox before insert on notifications
        for each row execute function reject_support_reply_inbox();
    `);
    const path='/api/support/'+id+'/messages';
    for(const token of [admin.token,owner.token]){
      const failed=await t.api('POST',path,{body:'Проверка атомарного ответа'},token);
      assert.ok(failed.status>=400);
    }
    const before=ok(await t.api('GET','/api/support/'+id,undefined,owner.token));
    assert.equal(before.messages.length,1);
    assert.equal(before.firstStaffReplyAt,null);
    const assignment=await t.db.one<{assignee_id:string|null}>(
      'select assignee_id from support_tickets where id=$1',[id]);
    assert.equal(assignment?.assignee_id,null);
    await t.db.exec(`
      drop trigger reject_support_reply_inbox on notifications;
      drop function reject_support_reply_inbox();
    `);
    const after=ok(await t.api('POST',path,{body:'Ответ специалиста после восстановления'},admin.token));
    assert.equal(after.messages.length,2);
    assert.ok(after.firstStaffReplyAt);
    const inbox=await t.db.one<{n:number}>(`
      select count(*)::int as n from notifications
       where user_id=$1 and kind='support' and data->>'ticketId'=$2
         and title like 'Поддержка ответила%'`,[owner.id,id]);
    assert.equal(inbox?.n,1);
  }finally{await t.close();}
});

test('HTTP/PG: private follow-up bypasses a former moderator and reaches active staff',async()=>{
  const t=await setup();
  try{
    const owner=await t.login(phone(4105));
    const former=await t.login(phone(4106));
    const admin=await t.login('+79990000001');
    const ticket=ok(await t.api('POST','/api/support',{
      topic:'Другое',text:'Нужна помощь специалиста',
    },owner.token));
    const id=ticket.id;
    // Model an assignment that survives a staff-role revocation.
    await t.db.query('update support_tickets set assignee_id=$2 where id=$1',[id,former.id]);
    const path='/api/support/'+id+'/messages';
    const body='Конфиденциальное уточнение по обращению';
    ok(await t.api('POST',path,{body},owner.token));
    const recipients=await t.db.query<{user_id:string}>(`
      select user_id from notifications where kind='support' and data->>'ticketId'=$1
        and body=$2`,[id,body]);
    assert.deepEqual(recipients.map(row=>row.user_id),[admin.id]);
    assert.equal((await t.api('GET','/api/support/'+id,undefined,former.token)).status,403);
    ok(await t.api('POST',path,{body:'Новый ответ действующего сотрудника'},admin.token));
    const assigned=await t.db.one<{assignee_id:string}>(
      'select assignee_id from support_tickets where id=$1',[id]);
    assert.equal(assigned?.assignee_id,admin.id);
  }finally{await t.close();}
});
