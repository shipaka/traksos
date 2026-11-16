import { z } from 'zod';
import type { Db } from '../db/index.ts';
import type { Router, AuthedCtx, AuthUser } from '../http/router.ts';
import { parse, bad, conflict, forbidden, notFound, HttpError } from '../http/router.ts';
import type { Notifier } from './notify.ts';

/**
 * TrakSOS community backend. Isolated from the private, order-scoped ChatService.
 * No GPS, private phone or account name is selected into community responses.
 * Media upload, private messages and smart service suggestions are deliberately
 * NOT exposed until their security/availability checks are implemented.
 */
type Room = { id:string; slug:string; title:string; kind:string; audience:string;
  specialty:string|null; locality_label:string|null; active:boolean };
const isStaff = (u: AuthUser) => u.roles.some(r => r === 'admin' || r === 'moderator');
const professional = (u: AuthUser) => u.roles.some(r => ['master','tow','service'].includes(r));
const nickSchema = z.string().trim().min(3).max(24)
  .regex(/^[\p{L}][\p{L}\p{N}_-]{2,23}$/u, 'Только буквы, цифры, дефис и подчёркивание')
  .refine(n => !/(?:track\s?sos|traksos|admin|support|модератор|админ|поддержка)/iu.test(n), 'Служебные имена недоступны');
const roomIdSchema = z.string().uuid();
const clientNonce = z.string().uuid();
const textSchema = z.string().trim().min(1).max(2000);
const phonePattern = /(?:\+?\d[\s().-]*){10,}/u;
const contactPattern = /(?:[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:t\.me|wa\.me|telegram\.me)\/)/iu;
const profanity = /(?:бляд|сука|хуй|пизд|ебан|ёбан|fuck)/iu;

async function verifiedProfile(db: Db, user: AuthUser) {
  if (!professional(user)) return null;
  return db.one<{ kind:string; specialties:string[]; verification:string }>(
    'select kind,specialties,verification from performer_profiles where user_id=$1', [user.id]);
}
async function roomAllowed(user: AuthUser, room: Room, profile: Awaited<ReturnType<typeof verifiedProfile>>) {
  if (!room.active && !isStaff(user)) return false;
  if (isStaff(user)) return true;
  if (room.audience === 'all') return true;
  if (room.audience === 'driver') return user.roles.includes('driver');
  if (room.audience !== 'professional' || profile?.verification !== 'approved') return false;
  if (!room.specialty) return true;
  if (room.specialty === 'tow') return profile.kind === 'tow';
  if (room.specialty === 'service') return profile.kind === 'service';
  return profile.specialties.includes(room.specialty);
}
async function ensureNick(db: Db, user: AuthUser) {
  // No additional registration: assign a neutral pseudonym upon first use.
  const nickname = 'Участник_' + user.id.replace(/-/g, '').slice(0, 12);
  try {
    await db.query(
      `insert into community_profiles(user_id,nickname) values($1,$2)
       on conflict (user_id) do nothing`, [user.id,nickname]);
  } catch (error: any) {
    // Do not log identifiers, SQL values or profile data.
    console.error('[community_nickname_initialization_failed]', error?.code ?? 'unknown', error?.constraint ?? '');
    throw error;
  }
}
async function mustRoom(db: Db, c: AuthedCtx) {
  const id = parse(roomIdSchema, c.params.id);
  const room = await db.one<Room>('select * from community_rooms where id=$1', [id]);
  if (!room) throw notFound('Чат не найден');
  const profile = await verifiedProfile(db,c.user);
  // 404 instead of 403 avoids advertising private room membership to outsiders.
  if (!await roomAllowed(c.user,room,profile)) throw notFound('Чат не найден');
  return room;
}
async function requireKnowledgeAccess(db: Db, u: AuthUser) {
  if (isStaff(u)) return;
  const p = await verifiedProfile(db,u);
  if (p?.verification !== 'approved') throw forbidden('ТехБаза доступна только подтверждённым специалистам');
}

export function registerCommunityRoutes(r: Router, db: Db, notifier: Notifier) {
  r.get('/api/community/me', true, async (c: AuthedCtx) => {
    await ensureNick(db,c.user);
    return db.one(`select nickname, case when share_city then city_label else null end as public_city,
      city_label, share_city from community_profiles where user_id=$1`,[c.user.id]);
  });
  r.put('/api/community/me', true, async (c: AuthedCtx) => {
    const b = parse(z.object({
      nickname: nickSchema,
      cityLabel: z.string().trim().min(2).max(80).regex(/^[\p{L}\p{M} .'-]{2,80}$/u).nullable().optional(),
      shareCity: z.boolean().default(false),
    }), c.body);
    if (phonePattern.test(b.nickname) || contactPattern.test(b.nickname) || profanity.test(b.nickname))
      throw bad('nickname_rejected','Этот псевдоним недопустим');
    if (b.cityLabel && (phonePattern.test(b.cityLabel) || contactPattern.test(b.cityLabel) || /(?:улиц|проспект|квартир|дом\\s|house|street)/iu.test(b.cityLabel)))
      throw bad('city_rejected','Укажите только населённый пункт');
    await ensureNick(db,c.user);
    try {
      await db.query(`update community_profiles set nickname=$2,city_label=$3,share_city=$4,updated_at=now()
         where user_id=$1`,[c.user.id,b.nickname,b.cityLabel ?? null,b.shareCity]);
    } catch (e:any) {
      if (e?.code === '23505') throw conflict('nickname_taken','Этот псевдоним уже занят');
      throw e;
    }
    return { nickname:b.nickname, publicCity:b.shareCity ? (b.cityLabel ?? null) : null };
  });

  r.get('/api/community/rooms', true, async (c: AuthedCtx) => {
    const [rooms,profile] = await Promise.all([
      db.query<Room>('select * from community_rooms where active=true order by created_at,id limit 200'),
      verifiedProfile(db,c.user),
    ]);
    return { rooms: rooms.filter(room => {
      // Synchronous equivalent of roomAllowed for filtering (verification already queried).
      if (isStaff(c.user) || room.audience === 'all') return true;
      if (room.audience === 'driver') return c.user.roles.includes('driver');
      if (profile?.verification !== 'approved') return false;
      return !room.specialty || (room.specialty === 'tow' && profile.kind === 'tow')
        || (room.specialty === 'service' && profile.kind === 'service')
        || profile.specialties.includes(room.specialty);
    }).map(({id,slug,title,kind,audience,locality_label}) =>
      ({id,slug,title,kind,audience,locality:locality_label})) };
  });

  r.post('/api/admin/community/rooms', ['admin'], async (c: AuthedCtx) => {
    const b = parse(z.object({
      slug:z.string().regex(/^[a-z0-9-]{4,60}$/), title:z.string().trim().min(3).max(100),
      kind:z.enum(['general','regional','city','route','technical','professional']),
      audience:z.enum(['all','driver','professional']),
      specialty:z.string().regex(/^[a-z_]{2,35}$/).nullable().optional(),
      locality:z.string().trim().min(2).max(80).nullable().optional(),
    }),c.body);
    if (b.kind === 'professional' && b.audience !== 'professional')
      throw bad('invalid_audience','Закрытый клуб должен иметь закрытую аудиторию');
    try { return await db.one(`insert into community_rooms(slug,title,kind,audience,specialty,locality_label)
      values($1,$2,$3,$4,$5,$6) returning id,slug,title,kind,audience,locality_label`,
      [b.slug,b.title,b.kind,b.audience,b.specialty ?? null,b.locality ?? null]); }
    catch(e:any) { if(e?.code==='23505') throw conflict('room_exists','Чат с таким адресом уже есть');throw e; }
  });

  r.post('/api/community/rooms/:id/join', true, async (c: AuthedCtx) => {
    const room = await mustRoom(db,c);
    await ensureNick(db,c.user);
    await db.query(`insert into community_memberships(room_id,user_id) values($1,$2)
      on conflict do nothing`,[room.id,c.user.id]);
    return { joined:true,roomId:room.id };
  });
  r.get('/api/community/rooms/:id/messages', true, async (c: AuthedCtx) => {
    const room = await mustRoom(db,c);
    const afterStr = c.query.get('after') ?? '0';
    if (!/^\d{1,16}$/.test(afterStr)) throw bad('cursor','Некорректный курсор');
    const after = Number(afterStr);
    if (!Number.isSafeInteger(after)) throw bad('cursor','Некорректный курсор');
    const limit = Math.min(100,Math.max(1,Math.trunc(Number(c.query.get('limit')) || 50)));
    const rows = await db.query<{
      id:string; body:string; created_at:Date; moderation_state:string;
      sender_id:string; nickname:string|null; public_city:string|null;
    }>(`select m.id::text as id, m.body,m.created_at,m.moderation_state,m.sender_id,
       coalesce(p.nickname,'Участник') as nickname,
       case when p.share_city then p.city_label else null end as public_city
       from community_messages m left join community_profiles p on p.user_id=m.sender_id
       where m.room_id=$1 and m.id>$2 and
        (m.moderation_state='published' or m.sender_id=$3 or $4::boolean)
       order by m.id limit $5`,
       [room.id,afterStr,c.user.id,isStaff(c.user),limit]);
    return { messages: rows.map(({sender_id,...m})=>({...m,isMine:sender_id===c.user.id})),
      nextCursor:rows.length ? rows[rows.length-1].id : afterStr };
  });

  r.post('/api/community/rooms/:id/messages', true, async (c: AuthedCtx) => {
    const room = await mustRoom(db,c);
    const b = parse(z.object({ text:textSchema,clientNonce }),c.body);
    if (phonePattern.test(b.text)) throw bad('contacts_forbidden','Номера телефонов нельзя публиковать в Эфире');
    const pending = profanity.test(b.text) || contactPattern.test(b.text);
    await ensureNick(db,c.user);
    const saved = await db.tx(async q => {
      // Serialize messages from one account: duplicate retries and 15s quota are atomic.
      await q.query('select pg_advisory_xact_lock(hashtext($1::text))',[c.user.id]);
      const prior=await q.one<any>('select id::text as id,room_id,body,moderation_state,created_at from community_messages where sender_id=$1 and client_nonce=$2',
        [c.user.id,b.clientNonce]);
      if(prior) {
        if(prior.room_id!==room.id || prior.body!==b.text)
          throw conflict('nonce_reused','Этот идентификатор уже использован для другого сообщения');
        return prior;
      }
      const count=await q.one<{n:number}>(`select count(*)::int as n from community_messages
        where sender_id=$1 and created_at>now()-interval '15 seconds'`,[c.user.id]);
      if((count?.n ?? 0)>=5) throw new HttpError(429,'slow_down','Слишком много сообщений. Попробуйте позже');
      return q.one<any>(`insert into community_messages(room_id,sender_id,body,client_nonce,moderation_state)
        values($1,$2,$3,$4,$5) returning id::text as id,room_id,body,moderation_state,created_at`,
        [room.id,c.user.id,b.text,b.clientNonce,pending?'pending':'published']);
    });
    if(!saved) throw new Error('community message insert did not return a row');
    if(saved.moderation_state==='published') {
      // Recheck room access at delivery time: revoked professional roles must not
      // continue receiving private-club events from stale subscriptions.
      const members=await db.query<{user_id:string}>(`select cm.user_id from community_memberships cm
        join users u on u.id=cm.user_id
        left join performer_profiles p on p.user_id=u.id
        where cm.room_id=$1 and cm.user_id<>$2 and u.status='active'
          and (
            'admin'=any(u.roles) or 'moderator'=any(u.roles)
            or $3::text='all'
            or ($3::text='driver' and 'driver'=any(u.roles))
            or ($3::text='professional' and p.verification='approved'
                and ('master'=any(u.roles) or 'tow'=any(u.roles) or 'service'=any(u.roles))
                and ($4::text is null
                  or ($4='tow' and p.kind='tow')
                  or ($4='service' and p.kind='service')
                  or $4=any(p.specialties)))
          ) limit 2000`,
        [room.id,c.user.id,room.audience,room.specialty]);
      notifier.live(members.map(x=>x.user_id),{type:'community_message',roomId:room.id,id:saved.id});
    }
    return { id:saved.id,roomId:room.id,createdAt:saved.created_at,
      status:saved.moderation_state,moderationNotice: pending?'Сообщение ожидает проверки':null };
  });

  r.post('/api/community/messages/:id/report', true, async (c: AuthedCtx) => {
    if (!/^\d{1,16}$/.test(c.params.id)) throw notFound('Сообщение не найдено');
    const b = parse(z.object({reason:z.string().trim().min(3).max(240)}),c.body);
    const m=await db.one<{room_id:string;sender_id:string}>(
      'select room_id,sender_id from community_messages where id=$1 and moderation_state=\'published\'',[c.params.id]);
    if(!m) throw notFound('Сообщение не найдено');
    const room=await db.one<Room>('select * from community_rooms where id=$1',[m.room_id]);
    if(!room || !await roomAllowed(c.user,room,await verifiedProfile(db,c.user))) throw notFound('Сообщение не найдено');
    if (m.sender_id===c.user.id) throw bad('own_report','Для своего сообщения используйте обращение к модератору');
    await db.query(`insert into community_reports(message_id,reporter_id,reason) values($1,$2,$3)
      on conflict(message_id,reporter_id) do nothing`,[c.params.id,c.user.id,b.reason]);
    return {ok:true};
  });
  r.get('/api/admin/community/moderation', ['admin','moderator'], async () => ({
    pending:await db.query(`select m.id::text as id,m.room_id,m.body,m.created_at from community_messages m
      where m.moderation_state='pending' order by m.created_at limit 100`),
    reports:await db.query(`select r.id::text as id,r.message_id::text as message_id,r.reason,r.created_at
      from community_reports r where r.status='open' order by r.created_at limit 100`),
  }));
  r.post('/api/admin/community/messages/:id/moderate', ['admin','moderator'], async (c: AuthedCtx) => {
    if (!/^\d{1,16}$/.test(c.params.id)) throw notFound('Сообщение не найдено');
    const {status}=parse(z.object({status:z.enum(['published','hidden'])}),c.body);
    const changed=await db.one(`update community_messages set moderation_state=$2 where id=$1
      returning id::text as id,moderation_state`,[c.params.id,status]);
    if(!changed) throw notFound('Сообщение не найдено');
    await db.query('update community_reports set status=\'reviewed\' where message_id=$1',[c.params.id]);
    await db.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
      [c.user.id,'community.message_moderate',c.params.id,{status}]);
    return changed;
  });

  // TechBase: metadata first, NEVER accept unreviewed copied OEM files for public serving.
  r.post('/api/community/knowledge/propose', true, async (c: AuthedCtx) => {
    await requireKnowledgeAccess(db,c.user);
    const b = parse(z.object({
      title:z.string().trim().min(5).max(160),
      make:z.string().trim().min(2).max(80),model:z.string().trim().max(80).optional(),
      modelYear:z.number().int().min(1985).max(2026).optional(),
      subsystem:z.string().trim().min(2).max(70),
      description:z.string().trim().min(30).max(12000),
      sourceUrl:z.string().url().refine(x=>new URL(x).protocol==='https:').optional(),
      rightsBasis:z.enum(['own','permission','open_license','unknown']),
      rightsReference:z.string().trim().max(1000).optional(),
    }),c.body);
    return db.one(`insert into community_knowledge
      (author_id,title,make,model,model_year,subsystem,description,source_url,rights_basis,rights_reference)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      returning id,title,rights_review,technical_review,created_at`,
      [c.user.id,b.title,b.make,b.model??null,b.modelYear??null,b.subsystem,b.description,
       b.sourceUrl??null,b.rightsBasis,b.rightsReference??null]);
  });
  r.get('/api/community/knowledge', true, async (c: AuthedCtx) => {
    await requireKnowledgeAccess(db,c.user);
    const make=(c.query.get('make')??'').slice(0,80);
    const subsystem=(c.query.get('subsystem')??'').slice(0,70);
    return { articles:await db.query(`select id,title,make,model,model_year,subsystem,source_url,created_at
      from community_knowledge
      where rights_review='approved' and technical_review='approved'
        and ($1::text='' or lower(make)=lower($1))
        and ($2::text='' or lower(subsystem)=lower($2))
      order by created_at desc limit 100`,[make,subsystem]) };
  });
  r.get('/api/community/knowledge/mine', true, async (c: AuthedCtx) => {
    await requireKnowledgeAccess(db,c.user);
    return {articles:await db.query(`select id,title,rights_review,technical_review,created_at
      from community_knowledge where author_id=$1 order by created_at desc limit 100`,[c.user.id])};
  });
  r.get('/api/community/knowledge/:id', true, async (c: AuthedCtx) => {
    await requireKnowledgeAccess(db,c.user);
    const id=parse(roomIdSchema,c.params.id);
    const article=await db.one(`select id,title,make,model,model_year,subsystem,description,
      source_url,rights_basis,created_at,updated_at
      from community_knowledge where id=$1 and rights_review='approved' and technical_review='approved'`,[id]);
    if(!article) throw notFound('Материал не найден');
    return article;
  });
  r.post('/api/admin/community/knowledge/:id/review', ['admin'], async (c: AuthedCtx) => {
    const id=parse(roomIdSchema,c.params.id);
    const b=parse(z.object({
      scope:z.enum(['rights','technical']),
      decision:z.enum(['approved','rejected']),
      reference:z.string().trim().min(10).max(1000).optional(),
    }),c.body);
    const article=await db.one<{rights_basis:string}>('select rights_basis from community_knowledge where id=$1',[id]);
    if(!article) throw notFound('Материал не найден');
    if(b.scope==='rights' && b.decision==='approved' &&
       (article.rights_basis==='unknown' || !b.reference))
       throw bad('rights_unverified','Для разрешения публикации нужно подтвердить право и документ-основание');
    const column=b.scope==='rights'?'rights_review':'technical_review';
    const reviewer=b.scope==='rights'?'rights_reviewer':'technical_reviewer';
    const result=await db.one(`update community_knowledge set ${column}=$2,${reviewer}=$3,
      rights_reference=case when $5::boolean and $4::text is not null then $4 else rights_reference end,
      technical_review_note=case when not $5::boolean and $4::text is not null then $4 else technical_review_note end,
      updated_at=now() where id=$1 returning id,rights_review,technical_review`,
      [id,b.decision,c.user.id,b.reference??null,b.scope==='rights']);
    await db.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
      [c.user.id,'community.knowledge_review',id,b]);
    return result;
  });
}
