import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';
import type {AuthUser} from '../src/http/router.ts';

test('chat rechecks current roles, deleted accounts and fleet assignment for reads and writes', {timeout:60000}, async()=>{
 const t=await setup();
 try{
  assert.equal(t.db.driver,'pg');
  const owner=await t.login('+79993553001');
  const driver=await t.login('+79993553002');
  const master=await t.login('+79993553003','master');
  const replacement=await t.login('+79993553004');
  const vehicleId=ok(await t.api('POST','/api/vehicles',{brand:'DAF',model:'XF',plate:'а482км178'},owner.token)).id;
  const qr=ok(await t.api('GET','/api/fleet',undefined,owner.token)).cars[0].qrCode;
  ok(await t.api('POST','/api/qr/'+qr+'/join',{},driver.token));
  const order=ok(await t.api('POST','/api/orders',{service:'electric',zoneId:'spb',vehicleId,description:'Учебная проверка прав чата'},driver.token)).order;
  await t.db.query("update orders set status='accepted',performer_id=$2 where id=$1",[order.id,master.id]);
  const snap=async(id:string)=>{
   const user=await t.db.one<AuthUser>('select id,phone,name,roles,status,owner_id from users where id=$1',[id]);
   assert.ok(user);
   return user;
  };
  const o=await snap(owner.id),d=await snap(driver.id),m=await snap(master.id);
  const list=(actor:AuthUser)=>t.app.chat.list(actor,order.id,0,{mode:'latest',limit:100});
  const denied=async(actor:AuthUser)=>{
   await assert.rejects(list(actor),{status:403});
   await assert.rejects(t.app.chat.post(actor,order.id,'Недоступное сообщение'),{status:403});
  };
  for(const actor of [o,d,m])assert.ok((await list(actor)).participants.some(p=>p.you));
  const sent=await t.app.chat.post(o,order.id,'Первое учебное сообщение');
  assert.ok(sent.id);
  await t.db.query("update users set roles='{client}'::text[] where id=$1",[master.id]);
  await denied(m);
  assert.ok(!(await list(o)).participants.some(p=>p.who==='performer'));
  await t.db.query("update users set roles=$2::text[] where id=$1",[master.id,m.roles]);
  await t.db.query("update users set deleted_at=now() where id=$1",[master.id]);
  await denied(m);
  const count=async(id:string)=>Number((await t.db.one(
    "select count(*) as n from notifications where user_id=$1 and kind='chat_push'",[id]))?.n??0);
  const before=await count(master.id);
  await t.app.chat.post(o,order.id,'Сообщение после удаления исполнителя');
  assert.equal(await count(master.id),before);
  await t.db.query("update users set deleted_at=null where id=$1",[master.id]);
  await t.db.query("update users set status='blocked' where id=$1",[owner.id]);
  await denied(o);await denied(d);
  // The currently assigned performer retains their historical case access.
  assert.ok((await list(m)).messages.some(x=>x.id===sent.id));
  await t.db.query("update users set status='active' where id=$1",[owner.id]);
  ok(await t.api('POST','/api/qr/'+qr+'/join',{},replacement.token));
  await denied(d);
  await denied(await snap(replacement.id));
  assert.ok(!(await list(o)).participants.some(p=>p.who==='driver'));
  const driverBefore=await count(driver.id);
  await t.app.chat.post(o,order.id,'Сообщение после смены водителя');
  assert.equal(await count(driver.id),driverBefore);
  const notice=await t.db.one("select body from notifications where user_id=$1 and kind='chat_push' order by id desc limit 1",[master.id]);
  assert.equal(notice?.body,'Новое сообщение. Откройте переписку в заявке.');
  await t.db.query("update orders set status='completed' where id=$1",[order.id]);
  assert.deepEqual((await list(m)).quickReplies,[]);
  await assert.rejects(t.app.chat.post(m,order.id,'Архив'),{status:409});
 }finally{await t.close();}
});
