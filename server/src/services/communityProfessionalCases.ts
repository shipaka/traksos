import {z} from 'zod';
import type {Db} from '../db/index.ts';
import type {Router,AuthUser,AuthedCtx} from '../http/router.ts';
import {parse,bad,forbidden,notFound,conflict,HttpError} from '../http/router.ts';

type ProRoom={id:string;active:boolean;audience:string;specialty:string|null};
type CaseRow={
  id:string;room_id:string;author_id:string;status:string;make:string|null;
  model:string|null;model_year:number|null;subsystem:string;symptoms:string;
  dtc_codes:string[];diagnostic_context:string|null;origin:string;
  accepted_reply_id:string|null;knowledge_proposal_id:string|null;
  created_at:Date;updated_at:Date;resolved_at:Date|null
};
const uid=z.string().uuid();
const nonce=z.string().uuid();
const safeLabel=z.string().trim().max(80);
const codes=z.array(z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,12}$/)).max(8).default([]);
const unsafeText=[
  /(?:\+?\d[\s().-]*){10,}/u,
  /[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu,
  /\b[A-HJ-NPR-Z0-9]{17}\b/u,
  /(?:t\.me|wa\.me|telegram\.me|https?:\/\/)/iu,
  /\b\d{1,2}\.\d{5,}\s*[,;]\s*\d{1,3}\.\d{5,}\b/u,
  /\b[АВЕКМНОРСТУХABEKMHOPCTYX]\d{3}[АВЕКМНОРСТУХABEKMHOPCTYX]{2}\d{2,3}\b/iu,
];
function safeText(value:string){
  if(unsafeText.some(x=>x.test(value)))
    throw bad('sensitive_technical_text',
      'Уберите VIN, телефоны, госномера, ссылки и точные координаты. Коллегам нужны только технические признаки неисправности');
  return value;
}
function safeMeta(value:string|null|undefined){
  const candidate=value?.trim().slice(0,80)??'';
  return candidate&&unsafeText.every(r=>!r.test(candidate))?candidate:null;
}

async function access(db:Db,u:AuthUser,roomId:string,write=false){
  const room=await db.one<ProRoom>('select id,active,audience,specialty from community_rooms where id=$1',[roomId]);
  if(!room||room.audience!=='professional'||!room.active)throw notFound('Клуб не найден');
  const staff=u.roles.includes('admin')||u.roles.includes('moderator');
  if(!staff){
    if(!u.roles.some(r=>['master','tow','service'].includes(r)))
      throw notFound('Клуб не найден');
    const p=await db.one<{kind:string;verification:string;specialties:string[]}>(
      'select kind,verification,specialties from performer_profiles where user_id=$1',[u.id]);
    if(p?.verification!=='approved'||!p||
      (room.specialty!==null &&
        !(room.specialty==='tow'&&p.kind==='tow') &&
        !(room.specialty==='service'&&p.kind==='service') &&
        !p.specialties.includes(room.specialty)))
      throw notFound('Клуб не найден');
    if(write&&!await db.one(
      'select 1 from community_memberships where room_id=$1 and user_id=$2',[roomId,u.id]))
      throw forbidden('Сначала присоединитесь к профессиональному клубу');
  }
  return room;
}
async function openCase(db:Db,c:AuthedCtx,write=false){
  const id=parse(uid,c.params.id);
  const row=await db.one<CaseRow>('select * from community_technical_cases where id=$1',[id]);
  if(!row)throw notFound('Техническая карточка не найдена');
  await access(db,c.user,row.room_id,write);
  return row;
}
async function orderPreview(db:Db,user:AuthUser,orderId:string){
  const row=await db.one<{performer_id:string|null;status:string;make:string|null;model:string|null;year:number|null;service:string}>(
    "select o.performer_id,o.status,coalesce(v.brand,o.brand) as make,v.model,v.year,o.service "+
    "from orders o left join vehicles v on v.id=o.vehicle_id where o.id=$1",[orderId]);
  if(!row||row.performer_id!==user.id||
    ['completed','cancelled','canceled','rejected'].includes(row.status))
    throw notFound('Активная заявка специалиста не найдена');
  return {make:safeMeta(row.make),model:safeMeta(row.model),
    modelYear:row.year&&row.year>=1985&&row.year<=2026?row.year:null,
    subsystem:safeMeta(row.service),
    note:'Только технические поля; адрес, VIN, номер заявки и данные клиента не передаются в клуб'};
}

const mainSchema=z.object({
  roomId:uid,clientNonce:nonce,orderId:uid.optional(),
  make:safeLabel.nullable().optional(),model:safeLabel.nullable().optional(),
  modelYear:z.number().int().min(1985).max(2026).nullable().optional(),
  subsystem:z.string().trim().min(2).max(80),
  symptoms:z.string().trim().min(40).max(2500),
  dtcCodes:codes,
  diagnosticContext:z.string().trim().max(1500).nullable().optional(),
});
type CreateCase=z.infer<typeof mainSchema>;

function publicCase(row:CaseRow & {nickname?:string|null},userId:string){
  const {author_id,knowledge_proposal_id,...visible}=row;
  return {...visible,nickname:row.nickname??'Участник',
    isAuthor:author_id===userId,
    hasKnowledgeProposal:Boolean(knowledge_proposal_id)};
}
export function registerProfessionalCasesRoutes(r:Router,db:Db){
  // Preview never exposes an order identifier to the professional room.
  r.get('/api/community/pro-cases/order-preview/:id',true,async(c:AuthedCtx)=>{
    const id=parse(uid,c.params.id);
    return orderPreview(db,c.user,id);
  });
  r.get('/api/community/pro-cases/rooms/:id',true,async(c:AuthedCtx)=>{
    const roomId=parse(uid,c.params.id);
    await access(db,c.user,roomId);
    const page=Number(c.query.get('page')??'0');
    if(!Number.isSafeInteger(page)||page<0||page>100)
      throw bad('page','Недопустимая страница');
    const system=(c.query.get('subsystem')??'').trim().slice(0,80);
    const status=c.query.get('status')??'';
    if(status&&!['open','resolved'].includes(status))throw bad('status','Недопустимый статус');
    const found=await db.query<CaseRow & {nickname:string|null}>(`
      select t.*,p.nickname from community_technical_cases t
      left join community_profiles p on p.user_id=t.author_id
      where t.room_id=$1 and ($2::text='' or lower(t.subsystem)=lower($2))
        and ($3::text='' or t.status=$3)
      order by t.created_at desc,t.id desc limit 21 offset $4`,
      [roomId,system,status,page*20]);
    return {cases:found.slice(0,20).map(row=>publicCase(row,c.user.id)),
      page,hasMore:found.length>20};
  });
  r.get('/api/community/pro-cases/:id',true,async(c:AuthedCtx)=>{
    const row=await openCase(db,c);
    const nick=await db.one<{nickname:string}>(
      'select nickname from community_profiles where user_id=$1',[row.author_id]);
    return publicCase({...row,nickname:nick?.nickname},c.user.id);
  });
  r.post('/api/community/pro-cases',true,async(c:AuthedCtx)=>{
    const b=parse(mainSchema,c.body);
    await access(db,c.user,b.roomId,true);
    const inputs=[b.symptoms,b.diagnosticContext??'',b.make??'',b.model??'',b.subsystem];
    inputs.forEach(safeText);
    const uniqueCodes=[...new Set(b.dtcCodes)];
    const fromOrder=b.orderId?await orderPreview(db,c.user,b.orderId):null;
    const make=fromOrder?.make??safeMeta(b.make);
    const model=fromOrder?.model??safeMeta(b.model);
    const year=fromOrder?.modelYear??b.modelYear??null;
    // Advisory lock across retries protects the nonce and rate limit.
    const result=await db.tx(async q=>{
      await q.query('select pg_advisory_xact_lock(hashtext($1))',['tech-case:'+c.user.id]);
      const previous=await q.one<CaseRow>(
        'select * from community_technical_cases where author_id=$1 and client_nonce=$2',
        [c.user.id,b.clientNonce]);
      if(previous){
        if(previous.room_id!==b.roomId||previous.symptoms!==b.symptoms)
          throw conflict('nonce_reused','Этот идентификатор уже занят другим вопросом');
        return {record:previous,created:false};
      }
      const recent=await q.one<{n:number}>(`
        select count(*)::int as n from community_technical_cases
        where author_id=$1 and created_at>now()-interval '1 hour'`,[c.user.id]);
      if((recent?.n??0)>=5)throw new HttpError(429,'slow_down','Слишком много технических вопросов');
      const record=await q.one<CaseRow>(`
        insert into community_technical_cases
        (room_id,author_id,client_nonce,make,model,model_year,subsystem,
          symptoms,dtc_codes,diagnostic_context,origin)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
        [b.roomId,c.user.id,b.clientNonce,make,model,year,b.subsystem,
          b.symptoms,uniqueCodes,b.diagnosticContext??null,b.orderId?'order_preview':'manual']);
      if(!record)throw new Error('case insert returned no row');
      return {record,created:true};
    });
    return {case:publicCase(result.record,c.user.id),created:result.created,
      sharingNotice:'В клубе публикуются только технические сведения без идентификаторов заказа и клиента'};
  });
  r.get('/api/community/pro-cases/:id/replies',true,async(c:AuthedCtx)=>{
    const row=await openCase(db,c);
    const after=c.query.get('after')??'0';
    if(!/^\d{1,16}$/.test(after))throw bad('cursor','Неверный курсор');
    const replies=await db.query<{id:string;body:string;created_at:Date;nickname:string|null;author_id:string}>(`
      select r.id::text as id,r.body,r.created_at,p.nickname,r.author_id
      from community_technical_case_replies r
      left join community_profiles p on p.user_id=r.author_id
      where r.case_id=$1 and r.id>$2::bigint order by r.id limit 51`,[row.id,after]);
    return {replies:replies.slice(0,50).map(x=>({
      id:x.id,body:x.body,created_at:x.created_at,nickname:x.nickname??'Участник',
      isMine:x.author_id===c.user.id,
      accepted:x.id===row.accepted_reply_id
    })),nextCursor:replies.slice(0,50).at(-1)?.id??after,hasMore:replies.length>50};
  });
  r.post('/api/community/pro-cases/:id/replies',true,async(c:AuthedCtx)=>{
    const row=await openCase(db,c,true);
    if(row.status!=='open')throw conflict('case_resolved','Вопрос закрыт автором');
    const b=parse(z.object({clientNonce:nonce,body:z.string().trim().min(10).max(2000)}),c.body);
    safeText(b.body);
    const result=await db.tx(async q=>{
      await q.query('select pg_advisory_xact_lock(hashtext($1))',['tech-reply:'+c.user.id]);
      const previous=await q.one<{id:string;case_id:string;body:string}>(
        'select id::text as id,case_id,body from community_technical_case_replies where author_id=$1 and client_nonce=$2',
        [c.user.id,b.clientNonce]);
      if(previous){
        if(previous.case_id!==row.id||previous.body!==b.body)
          throw conflict('nonce_reused','Этот идентификатор уже использован для другого ответа');
        return {id:previous.id,created:false};
      }
      const recent=await q.one<{n:number}>(`
        select count(*)::int as n from community_technical_case_replies
        where author_id=$1 and created_at>now()-interval '1 minute'`,[c.user.id]);
      if((recent?.n??0)>=8)throw new HttpError(429,'slow_down','Ответов слишком много, повторите позже');
      await q.one('select id from community_technical_cases where id=$1 for update',[row.id]);
      const fresh=await q.one<{status:string}>(
        'select status from community_technical_cases where id=$1',[row.id]);
      if(fresh?.status!=='open')throw conflict('case_resolved','Вопрос уже закрыт');
      const saved=await q.one<{id:string}>(`
        insert into community_technical_case_replies(case_id,author_id,client_nonce,body)
        values($1,$2,$3,$4) returning id::text as id`,
        [row.id,c.user.id,b.clientNonce,b.body]);
      return {id:saved!.id,created:true};
    });
    return {id:result.id,created:result.created};
  });
  r.post('/api/community/pro-cases/:id/resolve',true,async(c:AuthedCtx)=>{
    const row=await openCase(db,c,true);
    if(row.author_id!==c.user.id&&!c.user.roles.includes('admin'))
      throw forbidden('Только автор вопроса может выбрать решение');
    const b=parse(z.object({replyId:z.string().regex(/^\d{1,16}$/).nullable().optional()}),c.body);
    return db.tx(async q=>{
      await q.one('select id from community_technical_cases where id=$1 for update',[row.id]);
      if(b.replyId){
        if(!await q.one('select 1 from community_technical_case_replies where case_id=$1 and id=$2',
          [row.id,b.replyId]))throw bad('reply_not_found','Ответ не принадлежит этому вопросу');
      }
      return q.one(`update community_technical_cases
        set status='resolved',accepted_reply_id=$2,resolved_at=coalesce(resolved_at,now()),
          updated_at=now() where id=$1
        returning id,status,accepted_reply_id,resolved_at`,[row.id,b.replyId??null]);
    });
  });
  r.post('/api/community/pro-cases/:id/propose-knowledge',true,async(c:AuthedCtx)=>{
    const row=await openCase(db,c,true);
    if(row.author_id!==c.user.id)throw forbidden('Только автор может передать свой текст на проверку');
    if(row.status!=='resolved')throw conflict('case_not_resolved','Сначала отметьте решение вопроса');
    if(!row.make||row.make.length<2)
      throw bad('vehicle_unknown','Для технического справочника необходима уточнённая марка автомобиля');
    const b=parse(z.object({title:z.string().trim().min(5).max(160),
      authorNotes:z.string().trim().min(30).max(2000),
      rightsConfirmation:z.literal(true)}),c.body);
    safeText(b.title);safeText(b.authorNotes);
    return db.tx(async q=>{
      const current=await q.one<CaseRow>(
        'select * from community_technical_cases where id=$1 for update',[row.id]);
      if(current?.knowledge_proposal_id)
        return {id:current.knowledge_proposal_id,created:false,rightsReview:'pending',technicalReview:'pending'};
      const text=`Технический вопрос автора:\n${row.symptoms}\n\nСобственные выводы автора:\n${b.authorNotes}`;
      // NEVER copy colleagues' replies, even if they were marked accepted.
      // Their copyright/permission is a distinct legal review.
      const knowledge=await q.one<{id:string}>(`
        insert into community_knowledge
        (author_id,title,make,model,model_year,subsystem,description,
         rights_basis,rights_reference) values($1,$2,$3,$4,$5,$6,$7,'own',$8)
        returning id`,
        [c.user.id,b.title,row.make,row.model,row.model_year,row.subsystem,text,
         'Автор подтверждает права только на собственный текст, ответы коллег не скопированы']);
      await q.query('update community_technical_cases set knowledge_proposal_id=$2 where id=$1',
        [row.id,knowledge!.id]);
      return {id:knowledge!.id,created:true,rightsReview:'pending',technicalReview:'pending'};
    });
  });
}
