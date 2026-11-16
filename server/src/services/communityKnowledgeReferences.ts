import { z } from 'zod';
import type { Db } from '../db/index.ts';
import type { Router, AuthedCtx } from '../http/router.ts';
import { bad, forbidden, notFound, parse } from '../http/router.ts';

// Openly-licensed reference diagrams and OFFICIAL link-only manufacturer
// portals form a separate shelf. They never impersonate the specialist-reviewed
// vehicle-specific instructions stored in community_knowledge.
export type TechReference = {
  id:string;slug:string;title:string;source_kind:string;coverage:string;
  make:string|null;model:string|null;subsystem:string;
  description:string;safety_note:string;tags:string[];
  source_url:string;preview_url:string|null;attribution_author:string|null;
  license_code:string;license_url:string|null;rights_verified_on:string|null;
  technical_status:string;updated_at:string;
};

export async function requireTechBaseAccess(db:Db,c:AuthedCtx){
  if(c.user.roles.includes('admin')||c.user.roles.includes('moderator'))return;
  if(!c.user.roles.some(x=>['master','tow','service'].includes(x)))
    throw forbidden('Технические материалы доступны только подтверждённым специалистам');
  const p=await db.one<{verification:string}>(
    'select verification from performer_profiles where user_id=$1',[c.user.id]);
  if(p?.verification!=='approved')
    throw forbidden('Технические материалы доступны только подтверждённым специалистам');
}

const referenceSelect=`id,slug,title,source_kind,coverage,make,model,subsystem,
 description,safety_note,tags,source_url,preview_url,attribution_author,
 license_code,license_url,rights_verified_on,technical_status,updated_at`;

const uuid=z.string().uuid();
const facet=z.string().trim().max(80).default('');
const kind=z.enum(['','diagram','photo','document','manufacturer_portal']).default('');

export function registerKnowledgeReferenceRoutes(r:Router,db:Db){
  r.get('/api/community/knowledge/references',true,async(c:AuthedCtx)=>{
    await requireTechBaseAccess(db,c);
    const q=parse(facet,c.query.get('q')??'');
    const make=parse(facet,c.query.get('make')??'');
    const system=parse(facet,c.query.get('subsystem')??'');
    const selectedKind=parse(kind,c.query.get('kind')??'');
    const pg=Number(c.query.get('page')??'0');
    if(!Number.isSafeInteger(pg)||pg<0||pg>50)throw bad('page','Недопустимый номер страницы');
    const perPage=24;
    const rows=await db.query<TechReference>(
      `select ${referenceSelect} from community_knowledge_sources
       where active=true and technical_status<>'withdrawn'
         and ($2::text='' or coverage='generic' or lower(make)=lower($2))
         and ($3::text='' or lower(subsystem)=lower($3)
           or exists(select 1 from unnest(tags) tag where lower(tag)=lower($3)))
         and ($4::text='' or source_kind=$4)
         and ($1::text='' or position(lower($1) in
           lower(title||' '||subsystem||' '||coalesce(make,'')||' '||
             description||' '||array_to_string(tags,' ')))>0)
       order by case when lower(make)=lower($2) and make is not null then 0 else 1 end,
         case when source_kind='manufacturer_portal' then 1 else 0 end,title,id
       limit $5 offset $6`,
      [q,make,system,selectedKind,perPage+1,pg*perPage]);
    // Facets are selected from active sources only. They can be discovered
    // without obtaining access to unpublished manuals or users' data.
    const facets=await db.query<{subsystem:string}>(
      "select distinct subsystem from community_knowledge_sources "+
      "where active=true and technical_status<>'withdrawn' order by subsystem limit 100");
    return {
      references:rows.slice(0,perPage),
      hasMore:rows.length>perPage,
      page:pg,
      systems:facets.map(x=>x.subsystem),
      referenceOnly:true,
      notice:'Открытые схемы иллюстрируют принципы работы. Они НЕ подтверждают применимость к VIN, распиновку или значения для ремонта.'
    };
  });

  r.get('/api/community/knowledge/references/:id',true,async(c:AuthedCtx)=>{
    await requireTechBaseAccess(db,c);
    const id=parse(uuid,c.params.id);
    const row=await db.one<TechReference>(
      `select ${referenceSelect} from community_knowledge_sources
       where id=$1 and active=true and technical_status<>'withdrawn'`,[id]);
    if(!row)throw notFound('Источник не найден');
    return {...row,referenceOnly:row.technical_status!=='expert_approved',
      applicabilityWarning:row.coverage==='manufacturer'
        ?'Официальный портал: наличие конкретной схемы и её применимость уточняйте у производителя по VIN.'
        :'Общая учебная иллюстрация без точной модификации ТС. Для ремонта требуется оригинальная схема по VIN.'};
  });

  // Editorial takedown/technical review applies ONLY to our reference records,
  // never mirrors or modifies an external author's content.
  r.post('/api/admin/community/knowledge/references/:id/review',['admin'],
    async(c:AuthedCtx)=>{
      const id=parse(uuid,c.params.id);
      const b=parse(z.object({
        status:z.enum(['illustrative','portal_link','expert_approved','withdrawn']),
        note:z.string().trim().min(12).max(1000)
      }),c.body);
      const row=await db.one<{source_kind:string;rights_verified_on:Date|null}>(
        'select source_kind,rights_verified_on from community_knowledge_sources where id=$1',[id]);
      if(!row)throw notFound('Источник не найден');
      if(b.status==='portal_link' && row.source_kind!=='manufacturer_portal')
        throw bad('invalid_source_status','Статус официального портала доступен только для ссылок на производителя');
      if(b.status==='expert_approved' && (row.source_kind==='manufacturer_portal'||!row.rights_verified_on))
        throw bad('rights_unverified','Нужна подтверждённая лицензия и внешний эксперт для оценки иллюстрации');
      const result=await db.tx(async q=>{
        const saved=await q.one(
          `update community_knowledge_sources set technical_status=$2,
            active=$3,technical_reviewer=$4,technical_review_note=$5,
            technically_reviewed_at=now(),updated_at=now() where id=$1
            returning id,slug,technical_status,active`,
          [id,b.status,b.status!=='withdrawn',c.user.id,b.note]);
        await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
          [c.user.id,'community.knowledge_source_review',id,{status:b.status,note:b.note}]);
        return saved;
      });
      return result;
    });
}
