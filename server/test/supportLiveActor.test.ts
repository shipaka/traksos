import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ok} from './helpers.ts';
import type {AuthUser} from '../src/http/router.ts';

test('private support rechecks live owner and staff authorization inside reads and mutations',async()=>{
  const t=await setup();
  try {
    const owner=await t.login('+79997774301');
    const outsider=await t.login('+79997774302');
    const admin=await t.login('+79990000001');
    const moderator=await t.login('+79997774303');
    await t.db.query("update users set roles='{moderator}'::text[] where id=$1",[moderator.id]);
    const snapshot=async(id:string)=>(await t.db.one<AuthUser>(
      'select id,phone,name,roles,status,owner_id from users where id=$1',[id]))!;
    const ownerActor=await snapshot(owner.id);
    const adminActor=await snapshot(admin.id);
    const modActor=await snapshot(moderator.id);
    const otherActor=await snapshot(outsider.id);
    const support=t.app.support;
    const ticket=ok(await t.api('POST','/api/support',{
      topic:'Другое',text:'Синтетическое личное обращение',requestedRole:'moderator'
    },owner.token));
    const id=ticket.id;
    const denied=(e:any)=>e?.status===403;
    assert.equal((await support.thread(modActor,id)).id,id);
    assert.ok((await support.queue(modActor)).some(row=>row.id===id));
    await assert.rejects(()=>support.queue(otherActor),denied);
    await assert.rejects(()=>support.thread(otherActor,id),denied);
    await assert.rejects(()=>support.close(otherActor,id),denied);
    await support.post(modActor,id,'Синтетический ответ сотрудника');
    await t.db.query("update users set roles='{client}'::text[] where id=$1",[moderator.id]);
    const count=await t.db.one('select count(*)::int n from support_messages where ticket_id=$1',[id]);
    await assert.rejects(()=>support.thread(modActor,id),denied);
    await assert.rejects(()=>support.queue(modActor),denied);
    await assert.rejects(()=>support.post(modActor,id,'Запрещённое сообщение'),denied);
    await assert.rejects(()=>support.close(modActor,id),denied);
    assert.deepEqual(await t.db.one('select count(*)::int n from support_messages where ticket_id=$1',[id]),count);
    assert.equal((await support.thread(ownerActor,id)).status,'open');
    const inbox=async(userId:string)=>(await t.db.one<{n:number}>(
      "select count(*)::int n from notifications where user_id=$1 and data->>'ticketId'=$2",[userId,id]))!.n;
    const previousModeratorNotices=await inbox(moderator.id);
    const previousAdminNotices=await inbox(admin.id);
    await support.post(ownerActor,id,'PRIVATE_SYNTHETIC_REPLY');
    assert.equal(await inbox(moderator.id),previousModeratorNotices,'revoked assignee receives no new notice');
    assert.equal(await inbox(admin.id),previousAdminNotices+1,'live fallback receives notice');
    const notice=await t.db.one<{body:string}>(
      "select body from notifications where user_id=$1 and data->>'ticketId'=$2 order by id desc limit 1",[admin.id,id]);
    assert.doesNotMatch(notice!.body,/PRIVATE_SYNTHETIC_REPLY/);
    await t.db.query("update users set status='blocked' where id=$1",[owner.id]);
    await assert.rejects(()=>support.mine(ownerActor),denied);
    await assert.rejects(()=>support.thread(ownerActor,id),denied);
    await assert.rejects(()=>support.post(ownerActor,id,'Запрещено'),denied);
    await assert.rejects(()=>support.close(ownerActor,id),denied);
    await assert.rejects(()=>support.open(ownerActor,{topic:'Другое',text:'Запрещено'}),denied);
    const beforeOwnerNotices=await inbox(owner.id);
    await support.post(adminActor,id,'Ответ в историю обращения');
    assert.equal((await support.close(adminActor,id)).status,'closed');
    assert.equal(await inbox(owner.id),beforeOwnerNotices,'blocked recipient gets no new private notice');
    await t.db.query("update users set deleted_at=now() where id=$1",[admin.id]);
    await assert.rejects(()=>support.thread(adminActor,id),denied);
    await assert.rejects(()=>support.queue(adminActor,'closed'),denied);
    await assert.rejects(()=>support.close(adminActor,id),denied);
    await t.db.query("update users set status='active' where id=$1",[owner.id]);
    assert.equal((await support.thread(ownerActor,id)).status,'closed','own complaint history remains accessible after restoration');
  }finally{await t.close();}
});
