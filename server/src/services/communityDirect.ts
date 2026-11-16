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
    const t=await db.tx(async q=>{
      await q.query('select pg_advisory_xact_lock(hashtext($1))',[a+':'+recipient]);
      const prior=await q.one<Thread>('select * from community_dm_threads where user_a=$1 and user_b=$2',[a,recipient]);
      if(prior)return prior;
      const count=await q.one<{n:number}>("select count(*)::int as n from community_dm_threads where initiated_by=$1 and created_at>now()-interval '24 hours'",[c.user.id]);
      if((count?.n??0)>=5)throw new HttpError(429,'invite_limit','Слишком много приглашений');
      return q.one<Thread>('insert into community_dm_threads(user_a,user_b,initiated_by) values($1,$2,$3) returning *',[a,recipient,c.user.id]);
    });
    if(!t)throw new Error('Missing direct thread');
    if(t.initiated_by===c.user.id && t.status==='pending')notifier.live([dest.id],{type:'community_direct_invite',threadId:t.id});
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
    const rows=await db.query<{id:string;body:string;created_at:Date;sender_id:string;moderation_state:string;nickname:string}>(
      "select m.id::text as id,m.body,m.created_at,m.sender_id,m.moderation_state,coalesce(p.nickname,'Участник') as nickname "+
      "from community_dm_messages m left join community_profiles p on p.user_id=m.sender_id "+
      "where m.thread_id=$1 and ($5::boolean or m.id>$2) "+
      "and (m.moderation_state='published' or (m.moderation_state='pending' and m.sender_id=$3)) "+
      "order by m.id "+(recent?'desc':'asc')+" limit $4",
      [t.id,p.after,c.user.id,p.limit,recent]);
    const sorted=recent?rows.reverse():rows;
    return {messages:sorted.map(({sender_id,...m})=>({...m,isMine:sender_id===c.user.id})),nextCursor:sorted.at(-1)?.id??p.after};
  });
  r.post('/api/community/direct/:id/messages',true,async(c:AuthedCtx)=>{
    const t=await mustThread(db,c);
    if(t.status!=='accepted')throw forbidden('Диалог не подтверждён');
    const b=parse(z.object({text:body,clientNonce:uuid}),c.body);
    if(numbers.test(b.text))throw bad('contacts_forbidden','Публикация номеров запрещена');
    await ensureAlias(db,c.user);
    const saved=await db.tx(async q=>{
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
        return prev;
      }
      const quota=await q.one<{n:number}>("select count(*)::int as n from community_dm_messages where sender_id=$1 and created_at>now()-interval '15 seconds'",[c.user.id]);
      if((quota?.n??0)>=5)throw new HttpError(429,'slow_down','Подождите перед отправкой');
      return q.one<{id:string;thread_id:string;body:string;moderation_state:string;created_at:Date}>(
        'insert into community_dm_messages(thread_id,sender_id,body,client_nonce,moderation_state) values($1,$2,$3,$4,$5) returning id::text as id,thread_id,body,moderation_state,created_at',
        [t.id,c.user.id,b.text,b.clientNonce,abuse.test(b.text)||contacts.test(b.text)?'pending':'published']);
    });
    if(!saved)throw new Error('Failed to store private message');
    if(saved.moderation_state==='published' && !await blocked(db,t.user_a,t.user_b))
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
    const m=await db.one('update community_dm_messages set moderation_state=$2 where id=$1 returning id::text as id,moderation_state',[c.params.id,b.status]);
    if(!m)throw notFound('Сообщение не найдено');
    await db.query("update community_dm_reports set status='reviewed' where message_id=$1",[c.params.id]);
    await db.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',[c.user.id,'community.direct_moderate',c.params.id,{status:b.status}]);
    return m;
  });
}
