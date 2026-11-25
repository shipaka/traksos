import {test} from 'node:test';
import assert from 'node:assert/strict';
import {staffRecipient} from '../src/domain/airIntent.ts';
import {setup,ok} from './helpers.ts';

test('explicit staff address is private, ordinary discussion remains public',()=>{
  for(const text of ['@админ, помогите','Администратор, нужен ответ','Позовите админа','@ADMIN test'])
    assert.equal(staffRecipient(text),'admin',text);
  for(const text of ['@модератор, помогите','Модератор, ответьте','Вызови модератора','@moderator test'])
    assert.equal(staffRecipient(text),'moderator',text);
  for(const text of ['Вчера модератор помог','Администратор ответил вчера','Обсуждали работу модератора','@TrakBot расскажи шутку'])
    assert.equal(staffRecipient(text),null,text);
});

test('legacy Air API refuses private staff requests before storing any public messages',async()=>{
  const t=await setup();
  try{
    const a=await t.login('+79994440001');
    const b=await t.login('+79994440002');
    const before=await t.db.one<{n:number}>('select count(*)::int n from driver_air_messages');
    for(const body of ['@админ, PRIVATE_A','Модератор, PRIVATE_B','Позовите админа PRIVATE_C']){
      const r=await t.api('POST','/api/air/messages',{body},a.token);
      assert.equal(r.status,400);
      assert.equal(r.body.error,'air_private_support');
    }
    const after=await t.db.one<{n:number}>('select count(*)::int n from driver_air_messages');
    assert.equal(after?.n,before?.n);
    const publicResult=ok(await t.api('POST','/api/air/messages',{body:'Вчера модератор помог разобраться'},a.token));
    assert.equal(publicResult.supportSuggested,false);
    const visible=ok(await t.api('GET','/api/air/messages',undefined,b.token));
    assert.ok(visible.messages.some((m:any)=>m.body==='Вчера модератор помог разобраться'));
    assert.ok(visible.messages.every((m:any)=>!m.body.includes('PRIVATE_')));
    const tickets=await t.db.one<{n:number}>('select count(*)::int n from support_tickets where user_id=$1',[a.id]);
    assert.equal(tickets?.n,0,'private handoff must not create an unconfirmed ticket');
  }finally{await t.close();}
});
