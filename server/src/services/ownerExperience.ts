import {z} from 'zod';
import type {Db} from '../db/index.ts';
import type {Router,AuthedCtx,AuthUser} from '../http/router.ts';
import {bad,forbidden,notFound,parse} from '../http/router.ts';
import {PublicVehicleDirectory} from './publicVehicleDirectory.ts';
import {publicVehicleCard} from './vehicleOwnerShelf.ts';

/** Owner and driver experiences: stand-alone moderated cards, NOT a forum and NOT repair docs. */
const uid=z.string().uuid();
const category=z.enum(['truck','trailer','van','bus','passenger']);
const topic=z.enum(['operations','economy','daily-checks','ownership','road']);
const key=z.string().min(1).max(100).regex(/^[a-z0-9][a-z0-9_-]*$/);
const textTitle=z.string().trim().min(8).max(130);
const textBody=z.string().trim().min(40).max(5000);
const newPost=z.object({
  vehicleId:uid.optional(),catalogCategory:category.optional(),
  brandKey:key.optional(),modelKey:key.optional(),
  modelYear:z.number().int().min(1970).max(2100).optional(),
  topic,title:textTitle,body:textBody,clientNonce:uid
});
const editedPost=z.object({title:textTitle,body:textBody,topic});
const exposePattern=[
  /(?:\+?\d[\s().-]*){10,}/u,
  /[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu,
  /\b[A-HJ-NPR-Z0-9]{17}\b/u,
  /(?:https?:\/\/|t\.me\/|wa\.me\/|telegram\.me\/)/iu,
  /\b\d{1,2}\.\d{5,}\s*[,;]\s*\d{1,3}\.\d{5,}\b/u,
  /(?<![\p{L}\p{N}])[АВЕКМНОРСТУХABEKMHOPCTYX]\d{3}[АВЕКМНОРСТУХABEKMHOPCTYX]{2}\d{2,3}(?![\p{L}\p{N}])/iu
];
function safeBody(title:string,body:string){
  if(exposePattern.some(r=>r.test(title)||r.test(body)))
    throw bad('personal_identifiers_in_experience',
      'Уберите из публикации VIN, госномера, телефоны, ссылки, электронную почту и координаты');
}
function userReader(u:AuthUser){
  if(!u.roles.some(r=>r==='client'||r==='driver'))
    throw forbidden('Раздел доступен водителям и владельцам транспорта');
}
type Exp = {
  id:string;author_id:string;vehicle_id:string|null;catalog_category:string;
  catalog_brand_key:string;catalog_model_key:string;display_brand:string;display_model:string;
  model_year:number|null;topic:string;title:string;body:string;review_state:string;
  created_at:Date;updated_at:Date;save_count:number;saved:boolean;
};
const visibleSelect=(actorId:string)=>`
  select p.*,coalesce(s.saves,0)::int as save_count,
    exists(select 1 from vehicle_owner_experience_saves us
      where us.experience_id=p.id and us.user_id='${actorId}'::uuid) as saved
  from vehicle_owner_experiences p
  left join lateral (
    select count(*)::int as saves from vehicle_owner_experience_saves s
    where s.experience_id=p.id
  ) s on true`;
// Avoid interpolating any client-supplied values in SQL. Use a query parameter instead.
const publicCols=`p.id,p.author_id,p.vehicle_id,p.catalog_category,p.catalog_brand_key,
p.catalog_model_key,p.display_brand,p.display_model,p.model_year,p.topic,p.title,p.body,
p.review_state,p.created_at,p.updated_at,
(select count(*)::int from vehicle_owner_experience_saves s where s.experience_id=p.id) as save_count,
exists(select 1 from vehicle_owner_experience_saves s
where s.experience_id=p.id and s.user_id=$1) as saved`;
function safeExp(r:Exp,me:string){
  return {id:r.id,vehicleId:r.author_id===me?r.vehicle_id:null,category:r.catalog_category,
    brandKey:r.catalog_brand_key,modelKey:r.catalog_model_key,brand:r.display_brand,
    model:r.display_model,year:r.model_year,topic:r.topic,title:r.title,body:r.body,
    reviewState:r.author_id===me?r.review_state:'published',
    mine:r.author_id===me,saved:r.saved,saveCount:Number(r.save_count),
    createdAt:r.created_at,updatedAt:r.updated_at};
}
export function registerOwnerExperienceRoutes(r:Router,db:Db){
  const dir=new PublicVehicleDirectory();
  async function read(c:AuthedCtx,id:string){
    const row=await db.one<Exp>(`select ${publicCols} from vehicle_owner_experiences p
       where p.id=$2 and p.deleted_at is null
         and (p.review_state='published' or p.author_id=$1)`,[c.user.id,id]);
    if(!row)throw notFound('Запись не найдена');
    return row;
  }
  // Categories and topics remain strictly separate from protected professional content.
  r.get('/api/owner-experience/topics',true,(c:AuthedCtx)=>{
    userReader(c.user);
    return {topics:[
      {key:'operations',title:'Особенности эксплуатации'},
      {key:'economy',title:'Расходы и экономичность'},
      {key:'daily-checks',title:'Ежедневные проверки'},
      {key:'ownership',title:'Владение и обслуживание'},
      {key:'road',title:'Дорога и рейсы'}
    ],separateFromAir:true,moderationRequired:true};
  });
  r.get('/api/owner-experience',true,async(c:AuthedCtx)=>{
    userReader(c.user);
    const q=parse(z.object({
      category:category.optional(),brandKey:key.optional(),modelKey:key.optional(),
      topic:topic.optional(),q:z.string().trim().max(80).optional(),
      page:z.coerce.number().int().min(0).max(100).default(0),
      mine:z.enum(['true']).optional(),saved:z.enum(['true']).optional()
    }),Object.fromEntries(c.query));
    const rows=await db.query<Exp>(`select ${publicCols} from vehicle_owner_experiences p
      where p.deleted_at is null
      and ( ( $8::bool and p.author_id=$1 ) or
            ( not $8::bool and p.review_state='published' ) )
      and ($2::text is null or p.catalog_category=$2)
      and ($3::text is null or p.catalog_brand_key=$3)
      and ($4::text is null or p.catalog_model_key=$4)
      and ($5::text is null or p.topic=$5)
      and ($6::text is null or
         (p.title ilike '%' || $6 || '%' or p.body ilike '%' || $6 || '%'))
      and (not $9::bool or exists(
        select 1 from vehicle_owner_experience_saves b
        where b.experience_id=p.id and b.user_id=$1))
      order by p.created_at desc,p.id desc limit 21 offset $7`,
      [c.user.id,q.category??null,q.brandKey??null,q.modelKey??null,
        q.topic??null,q.q??null,q.page*20,q.mine==='true',q.saved==='true']);
    const items=rows.slice(0,20).map(x=>safeExp(x,c.user.id));
    // The photo may illustrate a vehicle family, never a VIN-specific variant.
    const photos=await Promise.all(items.map(async x=>{
      const card=await publicVehicleCard(x.category,x.brandKey,x.modelKey);
      return card.photo?{src:card.photo.src,caption:card.photo.caption,sourcePage:card.photo.sourcePage,
        author:card.photo.author,license:card.photo.license,licenseUrl:card.photo.licenseUrl}:null;
    }));
    return {items:items.map((x,i)=>({...x,photo:photos[i]})),page:q.page,hasMore:rows.length>20};
  });
  r.get('/api/owner-experience/:id',true,async(c:AuthedCtx)=>{
    userReader(c.user);return {post:safeExp(await read(c,parse(uid,c.params.id)),c.user.id)};
  });
  r.post('/api/owner-experience',true,async(c:AuthedCtx)=>{
    userReader(c.user);
    const b=parse(newPost,c.body);safeBody(b.title,b.body);
    let cat=b.catalogCategory,make=b.brandKey,model=b.modelKey,year=b.modelYear;
    let vehicleId=b.vehicleId??null;
    if(vehicleId){
      const v=await db.one<{id:string;catalog_category:string|null;catalog_brand_key:string|null;
        catalog_model_key:string|null;year:number|null}>(`select id,catalog_category,catalog_brand_key,catalog_model_key,year
         from vehicles where id=$1 and (owner_id=$2 or driver_id=$2)`,[vehicleId,c.user.id]);
      if(!v)throw notFound('Машина не найдена в вашем гараже');
      if(!v.catalog_category||!v.catalog_brand_key||!v.catalog_model_key)
        throw bad('vehicle_needs_catalog','Уточните марку и модель машины по справочнику');
      cat=parse(category,v.catalog_category);make=parse(key,v.catalog_brand_key);model=parse(key,v.catalog_model_key);
      year=v.year??undefined;
    }
    if(!cat||!make||!model)throw bad('model_required','Выберите марку и модель из справочника');
    const resolved=await dir.resolve(cat,make,model);
    const row=await db.one<Exp>(`
      insert into vehicle_owner_experiences(author_id,vehicle_id,catalog_category,catalog_brand_key,
        catalog_model_key,display_brand,display_model,model_year,topic,title,body,client_nonce)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      on conflict(author_id,client_nonce) do update
        set author_id=vehicle_owner_experiences.author_id
        where vehicle_owner_experiences.catalog_category=excluded.catalog_category
          and vehicle_owner_experiences.catalog_brand_key=excluded.catalog_brand_key
          and vehicle_owner_experiences.catalog_model_key=excluded.catalog_model_key
          and vehicle_owner_experiences.topic=excluded.topic
          and vehicle_owner_experiences.title=excluded.title
          and vehicle_owner_experiences.body=excluded.body
      returning id,author_id,vehicle_id,catalog_category,catalog_brand_key,catalog_model_key,
        display_brand,display_model,model_year,topic,title,body,review_state,
        created_at,updated_at,0::int as save_count,false as saved`,
      [c.user.id,vehicleId,cat,make,model,resolved.brand,resolved.model,year??null,
        b.topic,b.title,b.body,b.clientNonce]);
    if(!row)throw bad('client_nonce_conflict','Повторный ключ публикации с другими данными');
    return {post:safeExp(row,c.user.id),publication:'pending_moderation'};
  });
  r.put('/api/owner-experience/:id',true,async(c:AuthedCtx)=>{
    userReader(c.user);const b=parse(editedPost,c.body);safeBody(b.title,b.body);
    const id=parse(uid,c.params.id);
    const row=await db.one<Exp>(`update vehicle_owner_experiences p set
        title=$3,body=$4,topic=$5,review_state='pending',reviewed_at=null,review_note=null,updated_at=now()
      where p.id=$2 and p.author_id=$1 and p.deleted_at is null
      returning ${publicCols}`,[c.user.id,id,b.title,b.body,b.topic]);
    if(!row)throw notFound('Запись не найдена');
    return {post:safeExp(row,c.user.id),publication:'pending_moderation'};
  });
  r.delete('/api/owner-experience/:id',true,async(c:AuthedCtx)=>{
    userReader(c.user);
    const out=await db.query('update vehicle_owner_experiences set deleted_at=now(),updated_at=now() where id=$1 and author_id=$2 and deleted_at is null returning id',
      [parse(uid,c.params.id),c.user.id]);
    if(!out.length)throw notFound('Запись не найдена');return {deleted:true};
  });
  r.post('/api/owner-experience/:id/save',true,async(c:AuthedCtx)=>{
    userReader(c.user);const post=await read(c,parse(uid,c.params.id));
    if(post.review_state!=='published')throw notFound('Запись не опубликована');
    const b=parse(z.object({saved:z.boolean()}),c.body);
    if(b.saved)await db.query(`insert into vehicle_owner_experience_saves(experience_id,user_id)
      values($1,$2) on conflict do nothing`,[post.id,c.user.id]);
    else await db.query('delete from vehicle_owner_experience_saves where experience_id=$1 and user_id=$2',
      [post.id,c.user.id]);
    return {saved:b.saved};
  });
  r.post('/api/owner-experience/:id/report',true,async(c:AuthedCtx)=>{
    userReader(c.user);
    const post=await read(c,parse(uid,c.params.id));
    if(post.review_state!=='published'||post.author_id===c.user.id)
      throw notFound('Запись не найдена');
    const b=parse(z.object({reason:z.string().trim().min(15).max(500)}),c.body);
    const row=await db.one<{id:string}>(`
      insert into vehicle_owner_experience_reports(experience_id,reporter_id,reason)
      values($1,$2,$3) on conflict(experience_id,reporter_id)
      do update set reason=excluded.reason where vehicle_owner_experience_reports.review_state='pending'
      returning id`,[post.id,c.user.id,b.reason]);
    return {reported:!!row,alreadyReviewed:!row};
  });
  r.get('/api/admin/owner-experience/queue',['admin','moderator'],async()=>{
    const items=await db.query(`select p.id,p.display_brand,p.display_model,p.model_year,p.topic,
       p.title,p.body,p.review_state,p.created_at,
       (select count(*)::int from vehicle_owner_experience_reports x
        where x.experience_id=p.id and x.review_state='pending') as pending_reports
      from vehicle_owner_experiences p
      where p.deleted_at is null and (p.review_state='pending'
         or exists(select 1 from vehicle_owner_experience_reports x
            where x.experience_id=p.id and x.review_state='pending'))
      order by p.created_at asc limit 80`);
    return {items,manualReview:true};
  });
  r.post('/api/admin/owner-experience/:id/review',['admin','moderator'],async(c:AuthedCtx)=>{
    const b=parse(z.object({
      decision:z.enum(['publish','hide','reject']),
      note:z.string().trim().min(12).max(600)
    }),c.body);
    const id=parse(uid,c.params.id);
    const result=await db.tx(async q=>{
      const row=await q.one<{id:string;review_state:string}>(`select id,review_state from
        vehicle_owner_experiences where id=$1 and deleted_at is null for update`,[id]);
      if(!row)throw notFound('Запись не найдена');
      const state=b.decision==='publish'?'published':b.decision==='hide'?'hidden':'rejected';
      const r=await q.one(`update vehicle_owner_experiences set review_state=$2,
        review_note=$3,reviewed_by=$4,reviewed_at=now(),updated_at=now()
        where id=$1 returning id,review_state`,[id,state,b.note,c.user.id]);
      await q.query(`update vehicle_owner_experience_reports set
        review_state='reviewed',reviewed_by=$2,reviewed_at=now(),review_note=$3
        where experience_id=$1 and review_state='pending'`,[id,c.user.id,b.note]);
      await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
        [c.user.id,'owner_experience.review',id,{decision:b.decision,previous:row.review_state,note:b.note}]);
      return r;
    });
    return {reviewed:true,post:result};
  });
}
