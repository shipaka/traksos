import {z} from 'zod';
import type {Db} from '../db/index.ts';
import type {Router,AuthedCtx} from '../http/router.ts';
import {bad,conflict,notFound,parse} from '../http/router.ts';
import {requireTechBaseAccess} from './communityKnowledgeReferences.ts';

const uuid=z.string().uuid();
type PublishedKnowledge={id:string;make:string;model:string|null;model_year:number|null;title:string;
  rights_review:string;technical_review:string};
type Variant={
  id:string;knowledge_id:string;make:string;model:string;year_from:number;
  year_to:number;engine_code:string|null;ecu_variant:string|null;
  evidence_url:string;source_revision:string;verification_note:string;
  reviewed_at:Date;status:string
};
const tag=z.string().trim().min(2).max(80);
const addSchema=z.object({
  make:tag,model:tag,yearFrom:z.number().int().min(1985).max(2026),
  yearTo:z.number().int().min(1985).max(2026),
  engineCode:z.string().trim().min(2).max(60).nullable().optional(),
  ecuVariant:z.string().trim().min(2).max(60).nullable().optional(),
  evidenceUrl:z.string().trim().url().max(1200).refine(x=>x.startsWith('https://'),
    'Только HTTPS-документы и ссылки'),
  sourceRevision:z.string().trim().min(2).max(80),
  verificationNote:z.string().trim().min(30).max(1500)
});

export function registerKnowledgeApplicabilityRoutes(r:Router,db:Db){
  async function article(id:string){
    const row=await db.one<PublishedKnowledge>(
      'select id,make,model,model_year,title,rights_review,technical_review '+
      'from community_knowledge where id=$1',[id]);
    if(!row)throw notFound('Технический материал не найден');
    return row;
  }
  r.get('/api/community/knowledge/applicability/:id',true,async(c:AuthedCtx)=>{
    await requireTechBaseAccess(db,c);
    const id=parse(uuid,c.params.id);
    const item=await article(id);
    if(item.rights_review!=='approved'||item.technical_review!=='approved')
      throw notFound('Технический материал не опубликован');
    const make=(c.query.get('make')??'').trim().slice(0,80);
    const model=(c.query.get('model')??'').trim().slice(0,80);
    const yearString=(c.query.get('year')??'').trim();
    const year=yearString?Number(yearString):null;
    if(yearString&&(!Number.isInteger(year)||year!<1985||year!>2026))
      throw bad('year_invalid','Укажите год выпуска 1985–2026');
    const engine=(c.query.get('engineCode')??'').trim().slice(0,60);
    const ecu=(c.query.get('ecuVariant')??'').trim().slice(0,60);
    const entries=await db.query<Variant>(`
      select id,knowledge_id,make,model,year_from,year_to,engine_code,
        ecu_variant,evidence_url,source_revision,verification_note,reviewed_at,status
      from community_knowledge_applicability
      where knowledge_id=$1 and status='active'
      order by year_from desc,model,id limit 100`,[id]);
    const complete=make.length>=2&&model.length>=2&&year!==null;
    const variantMatches=complete?entries.filter(e=>
      e.make.toLocaleLowerCase()===make.toLocaleLowerCase()&&
      e.model.toLocaleLowerCase()===model.toLocaleLowerCase()&&
      year!>=e.year_from&&year!<=e.year_to
    ):[];
    // A missing engine or ECU version must NEVER produce a complete match if
    // the reviewed evidence explicitly targets a specific powertrain or ECU.
    const evidenceMatches=variantMatches.filter(e=>
      (!e.engine_code||(engine&&e.engine_code.toLowerCase()===engine.toLowerCase()))&&
      (!e.ecu_variant||(ecu&&e.ecu_variant.toLowerCase()===ecu.toLowerCase()))
    );
    const pendingVariant=variantMatches.length>0&&evidenceMatches.length===0;
    const status=!complete?'vehicle_details_required':
      evidenceMatches.length?'documented_variant':
      pendingVariant?'engine_or_ecu_details_required':'unknown';
    return {
      knowledgeId:id,status,
      documentedVariants:evidenceMatches.map(({status,knowledge_id,...e})=>e),
      recordedVariantCount:entries.length,
      evidenceExists:entries.length>0,
      matchIsVinVerified:false,
      vinNeverStored:true,
      warning:status==='documented_variant'
        ?'Совпадает только документированная модификация. Это НЕ подтверждение по VIN, комплектации и ревизии ECU: перед ремонтом проверьте оригинал у производителя.'
        :status==='engine_or_ecu_details_required'
          ?'Для проверки этой версии документа необходимо уточнить двигатель и/или блок управления. Без них применимость неизвестна.'
          :status==='unknown'
            ?'Подтверждённой применимости для этих параметров пока нет. Отсутствие записи НЕ означает несовместимость.'
            :'Укажите марку, модель и год. Для конкретной схемы дополнительно сверяйте двигатель, ECU и VIN по OEM-документу.'
    };
  });
  r.get('/api/admin/community/knowledge/applicability-candidates',['admin'],async()=>{
    const entries=await db.query<PublishedKnowledge>(`
      select id,title,make,model,model_year,rights_review,technical_review
      from community_knowledge
      where rights_review='approved' and technical_review='approved'
      order by updated_at desc limit 100`);
    return {articles:entries,verifiedVinCoverage:false};
  });
  r.get('/api/admin/community/knowledge/applicability/:id',['admin'],async(c:AuthedCtx)=>{
    const id=parse(uuid,c.params.id);
    const item=await article(id);
    const entries=await db.query<Variant>(`
      select id,knowledge_id,make,model,year_from,year_to,engine_code,
        ecu_variant,evidence_url,source_revision,verification_note,reviewed_at,status
      from community_knowledge_applicability where knowledge_id=$1
      order by reviewed_at desc limit 100`,[id]);
    return {article:item,entries};
  });
  r.post('/api/admin/community/knowledge/applicability/:id',['admin'],async(c:AuthedCtx)=>{
    const id=parse(uuid,c.params.id);
    const b=parse(addSchema,c.body);
    if(b.yearFrom>b.yearTo)throw bad('invalid_year_range','Начало периода должно быть не позже конца');
    const a=await article(id);
    if(a.rights_review!=='approved'||a.technical_review!=='approved')
      throw conflict('article_unapproved','Для доказательства применимости требуется материал, проверенный по правам и технике');
    if(a.make.toLocaleLowerCase()!==b.make.toLocaleLowerCase())
      throw bad('wrong_make','Марка в доказательстве должна соответствовать опубликованному материалу');
    if(a.model&&a.model.toLocaleLowerCase()!==b.model.toLocaleLowerCase())
      throw bad('wrong_model','Модель в доказательстве не соответствует материалу');
    if(a.model_year&&(a.model_year<b.yearFrom||a.model_year>b.yearTo))
      throw bad('wrong_year','Период не охватывает год опубликованного материала');
    const record=await db.tx(async q=>{
      const saved=await q.one<Variant>(`
        insert into community_knowledge_applicability
        (knowledge_id,make,model,year_from,year_to,engine_code,ecu_variant,
          evidence_url,source_revision,verification_note,reviewed_by)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
        [id,b.make,b.model,b.yearFrom,b.yearTo,b.engineCode??null,
          b.ecuVariant??null,b.evidenceUrl,b.sourceRevision,b.verificationNote,c.user.id]);
      await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
        [c.user.id,'community.knowledge_variant_verified',saved!.id,
          {knowledgeId:id,source:b.evidenceUrl,revision:b.sourceRevision,note:b.verificationNote}]);
      return saved;
    });
    return {id:record?.id,status:record?.status,knowledgeId:id,
      vinVerified:false,needsOemCheck:true};
  });
  r.post('/api/admin/community/knowledge/applicability/:id/records/:recordId/status',
    ['admin'],async(c:AuthedCtx)=>{
      const id=parse(uuid,c.params.id),recordId=parse(uuid,c.params.recordId);
      const b=parse(z.object({status:z.enum(['active','withdrawn']),
        note:z.string().trim().min(15).max(1000)}),c.body);
      const result=await db.tx(async q=>{
        const record=await q.one<Variant>(
          'select * from community_knowledge_applicability where knowledge_id=$1 and id=$2 for update',
          [id,recordId]);
        if(!record)throw notFound('Доказательство не найдено');
        if(b.status==='active'){
          const a=await article(id);
          if(a.rights_review!=='approved'||a.technical_review!=='approved')
            throw conflict('article_unapproved','Повторная проверка материала ещё не завершена');
        }
        const saved=await q.one<{id:string;status:string}>(
          'update community_knowledge_applicability set status=$3 where knowledge_id=$1 and id=$2 '+
          'returning id,status',[id,recordId,b.status]);
        await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
          [c.user.id,'community.knowledge_variant_status',recordId,
            {knowledgeId:id,status:b.status,note:b.note}]);
        return saved;
      });
      return result;
    });
}
