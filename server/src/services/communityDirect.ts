import { z } from 'zod';
import type { Db } from '../db/index.ts';
import type { Router, AuthUser, AuthedCtx } from '../http/router.ts';
import { parse, bad, forbidden, notFound, conflict, HttpError } from '../http/router.ts';
import type { Notifier } from './notify.ts';

// TrakSOS driver messaging: only nicknames are ever returned; both sides must consent.
const uuid=z.string().uuid();
const nickname=z.string().trim().min(3).max(24).regex(/^[\p{L}][\p{L}\p{N}_-]{2,23}$/u);
const body=z.string().trim().min(1).max(2000);
const numbers=/(?:\+?\d[\s().-]*){10,}/u;
const contacts=/(?:[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:t\.me|wa\.me|telegram\.me)\/)/iu;
const abuse=/(?:бляд|сука|хуй|пизд|ебан|ёбан|fuck)/iu;
type Thread={id:string;user_a:string;user_b:string;initiated_by:string;status:string;created_at:Date};
function requireDriver(user:AuthUser) {
  if(!user.roles.includes('driver'))throw forbidden('Личные сообщения доступны водителям');
}
function other(thread:Thread,id:string){return thread.user_a===id?thread.user_b:thread.user_a;}
async function mustThread(db:Db,c:AuthedCtx){
  requireDriver(c.user);
  const id=parse(uuid,c.params.id);
  const t=await db.one<Thread>('select * from community_dm_threads where id=$1',[id]);
  if(!t || (t.user_a!==c.user.id && t.user_b!==c.user.id))throw notFound('Диалог не найден');
  return t;
}
async function blocked(db:Db,a:string,b:string){
  return Boolean(await db.one('select 1 from community_user_blocks where (blocker_id=$1 and blocked_id=$2) or (blocker_id=$2 and blocked_id=$1) limit 1',[a,b]));
}
async function findPeer(db:Db,nick:string){
  return db.one<{id:string}>("select u.id from users u join community_profiles p on p.user_id=u.id where lower(p.nickname)=lower($1) and u.status='active' and u.deleted_at is null and 'driver'=any(u.roles)",[nick]);
}
function ensureAlias(db:Db,user:AuthUser){
  return db.query('insert into community_profiles(user_id,nickname) values($1,$2) on conflict(user_id) do nothing',[user.id,'Участник_'+user.id.replace(/-/g,'').slice(0,12)]);
}
function cursor(c:AuthedCtx){
  const after=c.query.get('after')??'0';
  if(!/^\d{1,16}$/.test(after)||!Number.isSafeInteger(Number(after)))throw bad('cursor','Некорректный курсор');
  const v=Number(c.query.get('limit')??50);
  const limit=Number.isFinite(v)?Math.max(1,Math.min(100,Math.trunc(v))):50;
  return {after,limit};
}
export function registerCommunityDirectRoutes(r:Router,db:Db,notifier:Notifier){
  r.post('/api/community/direct/request',true,async(c:AuthedCtx)=>{
    requireDriver(c.user);
    const b=parse(z.object({nickname}),c.body);
    const dest=await findPeer(db,b.nickname);
    if(!dest || dest.id===c.user.id || await blocked(db,c.user.id,dest.id))throw notFound('Пользователь не найден');
    await ensureAlias(db,c.user);
    const [a,recipient]=[c.user.id,dest.id].sort();
    const invitation=await db.tx(async q=>{
      await q.query('select pg_advisory_xact_lock(hashtext($1))',[a+':'+recipient]);
      const prior=await q.one<Thread>('select * from community_dm_threads where user_a=$1 and user_b=$2',[a,recipient]);
      if(prior)return {thread:prior,created:false};
      const count=await q.one<{n:number}>("select count(*)::int as n from community_dm_threads where initiated_by=$1 and created_at>now()-interval '24 hours'",[c.user.id]);
      if((count?.n??0)>=5)throw new HttpError(429,'invite_limit','Слишком много приглашений');
      const thread=await q.one<Thread>('insert into community_dm_threads(user_a,user_b,initiated_by) values($1,$2,$3) returning *',[a,recipient,c.user.id]);
      return {thread,created:true};
    });
    const t=invitation.thread;
    if(!t)throw new Error('Missing direct thread');
    // Retries return the existing thread, but must not re-notify the recipient indefinitely.
    if(invitation.created && t.initiated_by===c.user.id && t.status==='pending')
      notifier.live([dest.id],{type:'community_direct_invite',threadId:t.id});
    return {id:t.id,status:t.status,direction:t.initiated_by===c.user.id?'outgoing':'incoming'};
  });
  r.get('/api/community/direct',true,async(c:AuthedCtx)=>{
    requireDriver(c.user);
    const rows=await db.query<{id:string;status:string;initiated_by:string;nickname:string;updated_at:Date;blocked:boolean}>(
      "select t.id,t.status,t.initiated_by,coalesce(p.nickname,'Участник') as nickname,t.updated_at, "+
      "exists(select 1 from community_user_blocks b where (b.blocker_id=t.user_a and b.blocked_id=t.user_b) or (b.blocker_id=t.user_b and b.blocked_id=t.user_a)) as blocked "+
      "from community_dm_threads t left join community_profiles p on p.user_id=case when t.user_a=$1 then t.user_b else t.user_a end "+
      "where (t.user_a=$1 or t.user_b=$1) and t.status<>'declined' order by t.updated_at desc limit 100",[c.user.id]);
    return {threads:rows.map(x=>({id:x.id,status:x.status,peerNickname:x.nickname,
      direction:x.initiated_by===c.user.id?'outgoing':'incoming',blocked:x.blocked,updatedAt:x.updated_at}))};
  });
  r.post('/api/community/direct/:id/decision',true,async(c:AuthedCtx)=>{
    const t=await mustThread(db,c);
    const b=parse(z.object({decision:z.enum(['accept','decline'])}),c.body);
    if(t.initiated_by===c.user.id)throw forbidden('Приглашение подтверждает адресат');
    if(await blocked(db,t.user_a,t.user_b))throw conflict('blocked','Диалог недоступен');
    const status=b.decision==='accept'?'accepted':'declined';
    const result=await db.one('update community_dm_threads set status=$2,updated_at=now() where id=$1 and status=\'pending\' returning id,status',[t.id,status]);
    if(!result)throw conflict('invite_closed','Приглашение уже рассмотрено');
    notifier.live([other(t,c.user.id)],{type:'community_direct_decision',threadId:t.id});
    return result;
  });
  r.post('/api/community/direct/blocks',true,async(c:AuthedCtx)=>{
    requireDriver(c.user);
    const b=parse(z.object({nickname,blocked:z.boolean()}),c.body);
    const dest=await findPeer(db,b.nickname);
    if(!dest||dest.id===c.user.id)throw notFound('Пользователь не найден');
    if(b.blocked)await db.query('insert into community_user_blocks(blocker_id,blocked_id) values($1,$2) on conflict do nothing',[c.user.id,dest.id]);
    else await db.query('delete from community_user_blocks where blocker_id=$1 and blocked_id=$2',[c.user.id,dest.id]);
    return {ok:true,blocked:b.blocked};
  });
  r.get('/api/community/direct/:id/messages',true,async(c:AuthedCtx)=>{
    const t=await mustThread(db,c);
    if(t.status!=='accepted')throw forbidden('Дождитесь подтверждения переписки');
    const p=cursor(c);
    const recent=c.query.get('recent')==='1';
    // Take moderation watermark before loading messages; catch later commits.
    const epoch=await db.one<{sync_epoch:string}>(
      'select event_epoch::text as sync_epoch from community_dm_threads where id=$1',[t.id]);
    const watermark=await db.one<{cursor:string}>(
      "select coalesce(max(id),0)::text as cursor from community_dm_moderation_events where thread_id=$1",[t.id]);
    const rows=await db.query<{id:string;body:string;created_at:Date;sender_id:string;moderation_state:string;nickname:string}>(
      "select m.id::text as id,m.body,m.created_at,m.sender_id,m.moderation_state,coalesce(p.nickname,'Участник') as nickname "+
      "from community_dm_messages m left join community_profiles p on p.user_id=m.sender_id "+
      "where m.thread_id=$1 and ($5::boolean or m.id>$2) "+
      "and (m.moderation_state='published' or (m.moderation_state='pending' and m.sender_id=$3)) "+
      "order by m.id "+(recent?'desc':'asc')+" limit $4",
      [t.id,p.after,c.user.id,p.limit,recent]);
    const sorted=recent?rows.reverse():rows;
    return {messages:sorted.map(({sender_id,...m})=>({...m,isMine:sender_id===c.user.id})),nextCursor:sorted.at(-1)?.id??p.after,moderationCursor:watermark?.cursor??'0',syncEpoch:epoch?.sync_epoch??'0'};
  });
  r.get('/api/community/direct/:id/moderation-events',true,async(c:AuthedCtx)=>{
    const t=await mustThread(db,c);
    if(t.status!=='accepted')throw forbidden('Диалог не подтверждён');
    const {after,limit}=cursor(c);
    const rows=await db.query<{
      revision:string;id:string;moderation_state:string;previous_state:string;
      current_state:string;sender_id:string;body:string;created_at:Date;nickname:string;
    }>("select e.id::text as revision,e.message_id::text as id,e.moderation_state,"+
      "e.previous_state,m.moderation_state as current_state,m.sender_id,m.body,"+
      "m.created_at,coalesce(p.nickname,'Участник') as nickname "+
      "from community_dm_moderation_events e "+
      "join community_dm_messages m on m.id=e.message_id "+
      "left join community_profiles p on p.user_id=m.sender_id "+
      "where e.thread_id=$1 and e.id>$2::bigint order by e.id limit $3",
      [t.id,after,limit+1]);
    const page=rows.slice(0,limit);
    const changes=page.flatMap(e=>{
      if(e.moderation_state==='published'){
        if(e.current_state!=='published')return [];
        return [{revision:e.revision,id:e.id,moderation_state:'published',
          message:{id:e.id,body:e.body,nickname:e.nickname,public_city:null,
            isMine:e.sender_id===c.user.id,created_at:e.created_at,moderation_state:'published'}}];
      }
      if(e.previous_state!=='published'&&e.sender_id!==c.user.id)return [];
      return [{revision:e.revision,id:e.id,moderation_state:'hidden'}];
    });
    const epoch=await db.one<{sync_epoch:string}>(
      'select event_epoch::text as sync_epoch from community_dm_threads where id=$1',[t.id]);
    return {changes,nextCursor:page.at(-1)?.revision??after,hasMore:rows.length>limit,
      syncEpoch:epoch?.sync_epoch??'0'};
  });
  r.post('/api/community/direct/:id/messages',true,async(c:AuthedCtx)=>{
    const t=await mustThread(db,c);
    if(t.status!=='accepted')throw forbidden('Диалог не подтверждён');
    const b=parse(z.object({text:body,clientNonce:uuid}),c.body);
    if(numbers.test(b.text))throw bad('contacts_forbidden','Публикация номеров запрещена');
    await ensureAlias(db,c.user);
    const messageInsert=await db.tx(async q=>{
      await q.query('select pg_advisory_xact_lock(hashtext($1))',['dm:'+c.user.id]);
      const allowed=await q.one("select t.id from community_dm_threads t join users a on a.id=t.user_a join users b on b.id=t.user_b "+
        "where t.id=$1 and t.status='accepted' and a.status='active' and b.status='active' and 'driver'=any(a.roles) and 'driver'=any(b.roles) "+
        "and not exists(select 1 from community_user_blocks x where (x.blocker_id=t.user_a and x.blocked_id=t.user_b) or (x.blocker_id=t.user_b and x.blocked_id=t.user_a)) for update of t",[t.id]);
      if(!allowed)throw forbidden('Диалог недоступен');
      const prev=await q.one<{id:string;thread_id:string;body:string;moderation_state:string;created_at:Date}>(
        'select id::text as id,thread_id,body,moderation_state,created_at from community_dm_messages where sender_id=$1 and client_nonce=$2',
        [c.user.id,b.clientNonce]);
      if(prev){
        if(prev.thread_id!==t.id||prev.body!==b.text)throw conflict('nonce_reused','Идентификатор уже использован');
        return {message:prev,created:false};
      }
      const quota=await q.one<{n:number}>("select count(*)::int as n from community_dm_messages where sender_id=$1 and created_at>now()-interval '15 seconds'",[c.user.id]);
      if((quota?.n??0)>=5)throw new HttpError(429,'slow_down','Подождите перед отправкой');
      const message=await q.one<{id:string;thread_id:string;body:string;moderation_state:string;created_at:Date}>(
        'insert into community_dm_messages(thread_id,sender_id,body,client_nonce,moderation_state) values($1,$2,$3,$4,$5) returning id::text as id,thread_id,body,moderation_state,created_at',
        [t.id,c.user.id,b.text,b.clientNonce,abuse.test(b.text)||contacts.test(b.text)?'pending':'published']);
      // The SELECT FOR UPDATE OF t above serializes publications per direct
      // thread, so an older event cannot commit behind a newer cursor.
      if(message?.moderation_state==='published')await q.query(
        "insert into community_dm_moderation_events(thread_id,message_id,previous_state,moderation_state) values($1,$2,'created','published')",
        [t.id,message.id]);
      return {message,created:true};
    });
    const saved=messageInsert.message;
    if(!saved)throw new Error('Failed to store private message');
    // A repeated network request must not notify the other driver again.
    if(messageInsert.created && saved.moderation_state==='published' && !await blocked(db,t.user_a,t.user_b))
      notifier.live([other(t,c.user.id)],{type:'community_direct_message',threadId:t.id,id:saved.id});
    return {id:saved.id,status:saved.moderation_state,createdAt:saved.created_at};
  });
  r.post('/api/community/direct/messages/:id/report',true,async(c:AuthedCtx)=>{
    requireDriver(c.user);
    if(!/^\d{1,16}$/.test(c.params.id))throw notFound('Сообщение не найдено');
    const b=parse(z.object({reason:z.string().trim().min(3).max(240)}),c.body);
    const m=await db.one<{sender_id:string}>("select m.sender_id from community_dm_messages m join community_dm_threads t on t.id=m.thread_id "+
      "where m.id=$1 and (t.user_a=$2 or t.user_b=$2) and m.moderation_state='published'",[c.params.id,c.user.id]);
    if(!m)throw notFound('Сообщение не найдено');
    if(m.sender_id===c.user.id)throw bad('own_report','Нельзя жаловаться на своё сообщение');
    await db.query('insert into community_dm_reports(message_id,reporter_id,reason) values($1,$2,$3) on conflict(message_id,reporter_id) do nothing',[c.params.id,c.user.id,b.reason]);
    return {ok:true};
  });
  r.get('/api/admin/community/direct/moderation',['admin','moderator'],async()=>({
    pending:await db.query("select id::text as id,body,created_at from community_dm_messages where moderation_state='pending' order by created_at limit 100"),
    reports:await db.query("select r.id::text as id,r.message_id::text as message_id,m.body,r.reason,r.created_at from community_dm_reports r join community_dm_messages m on m.id=r.message_id where r.status='open' order by r.created_at limit 100"),
  }));
  r.post('/api/admin/community/direct/messages/:id/moderate',['admin','moderator'],async(c:AuthedCtx)=>{
    if(!/^\d{1,16}$/.test(c.params.id))throw notFound('Сообщение не найдено');
    const b=parse(z.object({status:z.enum(['published','hidden'])}),c.body);
    const result=await db.tx(async q=>{
      const item=await q.one<{thread_id:string}>(
        'select thread_id from community_dm_messages where id=$1',[c.params.id]);
      if(!item)throw notFound('Сообщение не найдено');
      // Lock thread before appending events: event IDs follow transaction commit order.
      await q.one('select id from community_dm_threads where id=$1 for update',[item.thread_id]);
      const prev=await q.one<{moderation_state:string}>(
        'select moderation_state from community_dm_messages where id=$1 for update',[c.params.id]);
      if(!prev)throw notFound('Сообщение не найдено');
      let message:{id:string;moderation_state:string};
      if(prev.moderation_state!==b.status){
        const row=await q.one<{id:string;moderation_state:string}>(
          'update community_dm_messages set moderation_state=$2 where id=$1 returning id::text as id,moderation_state',
          [c.params.id,b.status]);
        if(!row)throw notFound('Сообщение не найдено');
        message=row;
        await q.query(`insert into community_dm_moderation_events
          (thread_id,message_id,previous_state,moderation_state) values($1,$2,$3,$4)`,
          [item.thread_id,c.params.id,prev.moderation_state,b.status]);
      }else message={id:c.params.id,moderation_state:b.status};
      await q.query("update community_dm_reports set status='reviewed' where message_id=$1",[c.params.id]);
      await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
        [c.user.id,'community.direct_moderate',c.params.id,{status:b.status,previous:prev.moderation_state}]);
      return {message,threadId:item.thread_id,modified:prev.moderation_state!==b.status};
    });
    if(result.modified){
      const participants=await db.one<{user_a:string;user_b:string}>(
        'select user_a,user_b from community_dm_threads where id=$1',[result.threadId]);
      if(participants)notifier.live([participants.user_a,participants.user_b],{
        type:'community_direct_moderation',threadId:result.threadId});
    }
    return result.message;
  });
}
