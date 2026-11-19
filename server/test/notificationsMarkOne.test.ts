import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok,type T} from './helpers.ts';

let t:T;
let a:{id:string;token:string},b:{id:string;token:string};
before(async()=>{
  t=await setup();
  a=await t.login('+79997809301');
  b=await t.login('+79997809302');
});
after(()=>t.close());

test('one notification is read only by its recipient, retries do not change other unread rows',async()=>{
  const first=await t.db.one<{id:number}>(
    "insert into notifications(user_id,kind,title,body,data) values ($1,'order','Один','Текст','{}'::jsonb) returning id",[a.id]);
  const second=await t.db.one<{id:number}>(
    "insert into notifications(user_id,kind,title,body,data) values ($1,'order','Два','Текст','{}'::jsonb) returning id",[a.id]);
  const foreign=await t.db.one<{id:number}>(
    "insert into notifications(user_id,kind,title,body,data) values ($1,'order','Чужое','Текст','{}'::jsonb) returning id",[b.id]);
  assert.ok(first&&second&&foreign);
  const route='/api/me/notifications/'+first!.id+'/read';
  const initial=ok(await t.api('GET','/api/me/notifications',undefined,a.token));
  assert.equal(initial.unread,2);
  assert.equal((await t.api('POST',route,{},b.token)).status,404);
  assert.equal((await t.api('POST','/api/me/notifications/'+foreign!.id+'/read',{},a.token)).status,404);
  assert.equal((await t.api('POST',route,{})).status,401);
  assert.equal((await t.api('POST','/api/me/notifications/bad/read',{},a.token)).status,400);
  assert.equal(ok(await t.api('POST',route,{},a.token)).ok,true);
  assert.equal(ok(await t.api('POST',route,{},a.token)).ok,true);
  const partial=ok(await t.api('GET','/api/me/notifications',undefined,a.token));
  assert.equal(partial.unread,1);
  assert.equal(partial.items.find((n:any)=>n.id===first!.id)?.read_at!==null,true);
  assert.equal(partial.items.find((n:any)=>n.id===second!.id)?.read_at,null);
  assert.equal(ok(await t.api('GET','/api/me/notifications',undefined,b.token)).unread,1);
  ok(await t.api('POST','/api/me/notifications/read',{},a.token));
  assert.equal(ok(await t.api('GET','/api/me/notifications',undefined,a.token)).unread,0);
  assert.equal(ok(await t.api('GET','/api/me/notifications',undefined,b.token)).unread,1);
});
