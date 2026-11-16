import { z } from 'zod';
import type { Db } from '../db/index.ts';
import type { Router, AuthedCtx } from '../http/router.ts';
import { parse, bad, forbidden, notFound, HttpError } from '../http/router.ts';
import type { Notifier } from './notify.ts';

const uuid=z.string().uuid();
const phone=/(?:\+?\d[\s().-]*){10,}/u;
const contacts=/(?:https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:t\.me|wa\.me)\/|@\w{4,})/iu;
const abuse=/(?:бляд|сука|хуй|пизд|ебан|ёбан|fuck)/iu;
function driver(c:AuthedCtx){
  if(!c.user.roles.includes('driver'))throw forbidden('Дорожные события доступны водителям');
}
async function room(db:Db,c:AuthedCtx) {
  driver(c);
  const id=parse(uuid,c.params.id);
  const r=await db.one<{id:string;kind:string;audience:string}>(
    'select id,kind,audience from community_rooms where id=$1 and active=true',[id]);
  if(!r || r.audience!=='driver' || !['general','regional','city','route'].includes(r.kind))
    throw notFound('Водительский чат не найден');
  return r;
}
export function registerCommunityRoadRoutes(r:Router,db:Db,notifier:Notifier) {
  r.get('/api/community/rooms/:id/road-events',true,async(c:AuthedCtx)=>{
    const group=await room(db,c);
    const rows=await db.query<{id:string;category:string;description:string;locality:string|null;
      nickname:string;created_at:Date;expires_at:Date;moderation_state:string;author_id:string}>(
      "select e.id,e.category,e.description,e.locality,e.created_at,e.expires_at,e.moderation_state,e.author_id, "+
      "coalesce(p.nickname,'Участник') as nickname from community_road_events e "+
      "left join community_profiles p on p.user_id=e.author_id "+
      "where e.room_id=$1 and e.expires_at>now() and (e.moderation_state='published' or (e.moderation_state='pending' and e.author_id=$2)) "+
      "order by e.created_at desc limit 100",[group.id,c.user.id]);
    return {events:rows.map(({author_id,...x})=>({...x,isMine:author_id===c.user.id,
      verifiedByRoadServices:false}))};
  });
  r.post('/api/community/rooms/:id/road-events',true,async(c:AuthedCtx)=>{
    const group=await room(db,c);
    const joined=await db.one('select 1 from community_memberships where room_id=$1 and user_id=$2',[group.id,c.user.id]);
    if(!joined)throw forbidden('Сначала присоединитесь к водительскому чату');
    const b=parse(z.object({
      category:z.enum(['traffic','parking','roadworks','weather','question']),
      description:z.string().trim().min(10).max(500),
      locality:z.string().trim().min(2).max(80).regex(/^[\p{L}\p{M} .'-]{2,80}$/u).optional(),
      hours:z.number().int().min(1).max(12).default(3),
    }),c.body);
    if(phone.test(b.description))throw bad('contacts_forbidden','Контактные телефоны запрещены');
    if(b.locality&&/(?:улиц|проспект|квартир|дом\s|house|street)/iu.test(b.locality))
      throw bad('location_too_precise','Укажите населённый пункт, а не точный адрес');
    const state=abuse.test(b.description)||contacts.test(b.description)?'pending':'published';
    const event=await db.tx(async q=>{
      await q.query('select pg_advisory_xact_lock(hashtext($1))',['road:'+c.user.id]);
      const count=await q.one<{n:number}>(
        "select count(*)::int as n from community_road_events where author_id=$1 and created_at>now()-interval '24 hours'",
        [c.user.id]);
      if((count?.n??0)>=5)throw new HttpError(429,'daily_limit','Слишком много дорожных сообщений');
      return q.one<{id:string;moderation_state:string;expires_at:Date}>(
        "insert into community_road_events(room_id,author_id,category,description,locality,expires_at,moderation_state) "+
        "values($1,$2,$3,$4,$5,now()+($6::integer*interval '1 hour'),$7) "+
        "returning id,moderation_state,expires_at",
        [group.id,c.user.id,b.category,b.description,b.locality??null,b.hours,state]);
    });
    if(!event)throw new Error('Failed to save road event');
    if(state==='published'){
      const users=await db.query<{user_id:string}>(
        "select m.user_id from community_memberships m join users u on u.id=m.user_id "+
        "where m.room_id=$1 and m.user_id<>$2 and u.status='active' and 'driver'=any(u.roles) limit 2000",
        [group.id,c.user.id]);
      notifier.live(users.map(x=>x.user_id),{type:'community_road_event',roomId:group.id,id:event.id});
    }
    return {id:event.id,status:event.moderation_state,expiresAt:event.expires_at,
      verifiedByRoadServices:false};
  });
  r.post('/api/community/road-events/:id/report',true,async(c:AuthedCtx)=>{
    driver(c);
    const id=parse(uuid,c.params.id);
    const {reason}=parse(z.object({reason:z.string().trim().min(3).max(240)}),c.body);
    const e=await db.one<{author_id:string;room_id:string}>(
      "select e.author_id,e.room_id from community_road_events e join community_rooms r on r.id=e.room_id "+
      "where e.id=$1 and r.audience='driver' and r.active=true and e.moderation_state='published' and e.expires_at>now()",
      [id]);
    if(!e)throw notFound('Дорожное сообщение не найдено');
    if(e.author_id===c.user.id)throw bad('own_report','Нельзя жаловаться на своё сообщение');
    await db.query('insert into community_road_event_reports(event_id,reporter_id,reason) values($1,$2,$3) on conflict(event_id,reporter_id) do nothing',
      [id,c.user.id,reason]);
    return {ok:true};
  });
  r.get('/api/admin/community/road/moderation',['admin','moderator'],async()=>({
    pending:await db.query("select id,category,description,created_at from community_road_events where moderation_state='pending' order by created_at limit 100"),
    reports:await db.query("select r.id::text as id,r.event_id,e.description,r.reason,r.created_at from community_road_event_reports r join community_road_events e on e.id=r.event_id where r.status='open' order by r.created_at limit 100"),
  }));
  r.post('/api/admin/community/road-events/:id/moderate',['admin','moderator'],async(c:AuthedCtx)=>{
    const id=parse(uuid,c.params.id);
    const {status}=parse(z.object({status:z.enum(['published','hidden'])}),c.body);
    const value=await db.one('update community_road_events set moderation_state=$2 where id=$1 returning id,moderation_state',[id,status]);
    if(!value)throw notFound('Дорожное сообщение не найдено');
    await db.query("update community_road_event_reports set status='reviewed' where event_id=$1",[id]);
    await db.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
      [c.user.id,'community.road_event_moderate',id,{status}]);
    return value;
  });
}
