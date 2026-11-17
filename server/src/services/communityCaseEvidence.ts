import {z} from 'zod';
import type {Db} from '../db/index.ts';
import type {Router,AuthedCtx} from '../http/router.ts';
import {parse,bad,forbidden,notFound,conflict,HttpError} from '../http/router.ts';
import {openCase} from './communityProfessionalCases.ts';

const uuid=z.string().uuid();
const officialHosts=new Set([
  'commons.wikimedia.org','bodybuilder.scania.com',
  'bodybuilder.renault-trucks.com','www.volvotrucks.ca',
  'www.man.eu','rmi.daf.com','www.zf.com',
  'truckservices.knorr-bremse.com','www.haldex.com'
]);
const input=z.object({
  clientNonce:uuid,
  title:z.string().trim().min(8).max(180),
  sourceUrl:z.string().trim().min(12).max(1200),
  documentRevision:z.string().trim().min(2).max(120),
  mediaKind:z.enum(['diagram','manual','video_link']),
  rightsNote:z.string().trim().min(30).max(1000),
  applicabilityNote:z.string().trim().min(30).max(1500)
});
type Evidence={
  id:string;case_id:string;author_id:string;client_nonce:string;
  title:string;source_url:string;document_revision:string;
  media_kind:string;rights_note:string;applicability_note:string;
  rights_review:string;technical_review:string;rights_reviewer:string|null;
  technical_reviewer:string|null;rights_review_note:string|null;
  technical_review_note:string|null;status:string;
  created_at:Date;reviewed_at:Date|null
};
type SourceMetadata=Omit<Evidence,
  'author_id'|'client_nonce'|'rights_reviewer'|'technical_reviewer'>;
const columns=`e.id,e.case_id,e.author_id,e.client_nonce,e.title,
 e.source_url,e.document_revision,e.media_kind,e.rights_note,
 e.applicability_note,e.rights_review,e.technical_review,e.rights_reviewer,
 e.technical_reviewer,e.rights_review_note,e.technical_review_note,
 e.status,e.created_at,e.reviewed_at`;
const eligible=(e:Evidence)=>e.status==='active'&&
  e.rights_review==='approved'&&e.technical_review==='approved';
const staff=(c:AuthedCtx)=>c.user.roles.includes('admin')||c.user.roles.includes('moderator');

export function safeEvidenceUrl(value:string){
  // No remote HTTP request is ever made by the server. The allowlist also
  // prevents turning this role-restricted club into a public phishing index.
  let u:URL;
  try{u=new URL(value)}catch{throw bad('source_url','Некорректная ссылка на первоисточник')}
  if(u.protocol!=='https:'||u.username||u.password||u.port||
     !officialHosts.has(u.hostname.toLowerCase())||u.hash||
     Boolean(u.search)||u.pathname.includes('\\'))
    throw bad('source_host','Принимаются только HTTPS-ссылки проверенных официальных каталогов и Wikimedia Commons без параметров доступа');
  if(u.toString().length>1200)
    throw bad('source_url','Слишком длинная ссылка');
  return u.toString();
}
function publicItem(e:Evidence,owner:boolean,reviewer:boolean){
  // Unreviewed URLs, license statements and status should be available only
  // to author and staff, not to everybody in the private club.
  if(!eligible(e)&&!owner&&!reviewer)return null;
  const base={id:e.id,caseId:e.case_id,title:e.title,
    mediaKind:e.media_kind,documentRevision:e.document_revision,
    rightsReview:e.rights_review,technicalReview:e.technical_review,
    status:e.status,createdAt:e.created_at,isMine:owner};
  if(!eligible(e)&&!reviewer&&e.status!=='active')return {...base,
    sourceUrl:null,rightsNote:null,applicabilityNote:null};
  return {...base,sourceUrl:e.source_url,rightsNote:e.rights_note,
    applicabilityNote:e.applicability_note,
    rightsReviewNote:owner||reviewer?e.rights_review_note:null,
    technicalReviewNote:owner||reviewer?e.technical_review_note:null};
}
export function registerProfessionalEvidenceRoutes(r:Router,db:Db){
  r.get('/api/community/pro-cases/:id/evidence',true,async(c:AuthedCtx)=>{
    const item=await openCase(db,c);
    const rows=await db.query<Evidence>(
      `select ${columns} from community_case_evidence e where e.case_id=$1
       and (e.status='active' or e.author_id=$2 or $3)
       and (e.author_id=$2 or $3 or (e.rights_review='approved'
          and e.technical_review='approved' and e.status='active'))
       order by e.created_at,e.id limit 100`,
      [item.id,c.user.id,staff(c)]);
    return {evidence:rows.map(e=>publicItem(e,e.author_id===c.user.id,staff(c)))
      .filter(Boolean),allReviewedBeforePublication:true,linksOnly:true,
      warning:'Ссылки не подтверждают применимость к VIN и не заменяют оригинальную заводскую диагностику. Файлы не загружаются и не копируются на сервер TrackSOS.'};
  });

  r.post('/api/community/pro-cases/:id/evidence',true,async(c:AuthedCtx)=>{
    const item=await openCase(db,c,true);
    const b=parse(input,c.body);
    const url=safeEvidenceUrl(b.sourceUrl);
    const res=await db.tx(async q=>{
      await q.query('select pg_advisory_xact_lock(hashtext($1))',
        ['pro-evidence:'+c.user.id]);
      const previous=await q.one<Evidence>(
        `select ${columns} from community_case_evidence e
         where e.author_id=$1 and e.client_nonce=$2`,
         [c.user.id,b.clientNonce]);
      if(previous){
        if(previous.case_id!==item.id||previous.source_url!==url||
          previous.title!==b.title||previous.media_kind!==b.mediaKind)
          throw conflict('nonce_reused','Черновик уже был использован для другой ссылки');
        return {saved:previous,created:false};
      }
      const recent=await q.one<{n:number}>(`
        select count(*)::int as n from community_case_evidence
        where author_id=$1 and created_at>now()-interval '24 hours'`,[c.user.id]);
      if((recent?.n??0)>=5)
        throw new HttpError(429,'evidence_rate_limit','Максимум пять технических ссылок за сутки');
      const current=await q.one<{moderation_state:string}>(
        'select moderation_state from community_technical_cases where id=$1 for update',
        [item.id]);
      if(current?.moderation_state!=='published')
        throw notFound('Технический вопрос скрыт модератором');
      const saved=await q.one<Evidence>(`
        insert into community_case_evidence(case_id,author_id,client_nonce,
          title,source_url,document_revision,media_kind,rights_note,applicability_note)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
        [item.id,c.user.id,b.clientNonce,b.title,url,b.documentRevision,
          b.mediaKind,b.rightsNote,b.applicabilityNote]);
      await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
        [c.user.id,'community.evidence_submitted',saved!.id,
          {caseId:item.id,mediaKind:b.mediaKind,sourceHost:new URL(url).hostname}]);
      return {saved:saved!,created:true};
    });
    return {id:res.saved.id,created:res.created,rightsReview:res.saved.rights_review,
      technicalReview:res.saved.technical_review,published:false};
  });

  r.post('/api/community/pro-cases/:id/evidence/:evidenceId/withdraw',true,
    async(c:AuthedCtx)=>{
      const item=await openCase(db,c);
      const id=parse(uuid,c.params.evidenceId);
      return db.tx(async q=>{
        const old=await q.one<Evidence>(
          `select ${columns} from community_case_evidence e
           where e.id=$1 and e.case_id=$2 for update`,[id,item.id]);
        if(!old)throw notFound('Техническая ссылка не найдена');
        if(old.author_id!==c.user.id&&!staff(c))
          throw notFound('Техническая ссылка не найдена');
        if(old.status!=='withdrawn'){
          await q.query(
            "update community_case_evidence set status='withdrawn',updated_at=now() where id=$1",[id]);
          await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
            [c.user.id,'community.evidence_withdrawn',id,{caseId:item.id}]);
        }
        return {id,status:'withdrawn',published:false};
      });
    });

  r.get('/api/admin/community/evidence/queue',['admin','moderator'],async()=>{
    const rows=await db.query<Evidence & {subsystem:string;room_id:string}>(`
      select ${columns},c.subsystem,c.room_id
      from community_case_evidence e
      join community_technical_cases c on c.id=e.case_id
      where e.status='active' and
        (e.rights_review='pending' or
           (e.rights_review='approved' and e.technical_review='pending'))
      order by e.created_at,e.id limit 100`);
    return {evidence:rows.map(e=>({
      ...publicItem(e,false,true),subsystem:e.subsystem,roomId:e.room_id,
      needsRightsReview:e.rights_review==='pending',
      needsTechnicalReview:e.rights_review==='approved'&&e.technical_review==='pending'
    })),reviewIsHuman:true,originalFilesStored:false};
  });

  r.post('/api/admin/community/evidence/:id/review',['admin','moderator'],
    async(c:AuthedCtx)=>{
      const id=parse(uuid,c.params.id);
      const b=parse(z.object({
        stage:z.enum(['rights','technical']),
        decision:z.enum(['approved','rejected']),
        note:z.string().trim().min(20).max(1000)
      }),c.body);
      if(b.stage==='rights'&&!c.user.roles.includes('admin'))
        throw forbidden('Права проверяет администратор');
      return db.tx(async q=>{
        const e=await q.one<Evidence>(`select ${columns}
          from community_case_evidence e where e.id=$1 for update`,[id]);
        if(!e)throw notFound('Техническая ссылка не найдена');
        if(e.status!=='active')throw conflict('withdrawn','Ссылка отозвана');
        if(e.author_id===c.user.id)
          throw forbidden('Нельзя оценивать собственный материал');
        if(b.stage==='rights'&&e.rights_review!=='pending')
          throw conflict('rights_reviewed','Проверка прав уже завершена');
        if(b.stage==='technical'){
          if(e.rights_review!=='approved')
            throw conflict('rights_required','Сначала проверьте права на материал');
          if(e.technical_review!=='pending')
            throw conflict('technical_reviewed','Техническая экспертиза уже завершена');
          if(e.rights_reviewer===c.user.id)
            throw conflict('independent_review_required',
              'Техническую оценку выполняет другой сотрудник');
        }
        // Lock the case so that a concurrent hide operation cannot leave a
        // newly published external link attached to an unsafe hidden case.
        const parent=await q.one<{moderation_state:string}>(
          'select moderation_state from community_technical_cases where id=$1 for update',[e.case_id]);
        if(!parent||parent.moderation_state!=='published')
          throw conflict('case_hidden','Вопрос скрыт или удалён');
        if(b.stage==='rights'){
          await q.query(`update community_case_evidence set
            rights_review=$2,rights_reviewer=$3,rights_review_note=$4,
            reviewed_at=now(),updated_at=now() where id=$1`,
            [id,b.decision,c.user.id,b.note]);
        }else{
          await q.query(`update community_case_evidence set
            technical_review=$2,technical_reviewer=$3,technical_review_note=$4,
            reviewed_at=now(),updated_at=now() where id=$1`,
            [id,b.decision,c.user.id,b.note]);
        }
        await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
          [c.user.id,'community.evidence_reviewed',id,
            {caseId:e.case_id,stage:b.stage,decision:b.decision,note:b.note}]);
        const rights=b.stage==='rights'?b.decision:e.rights_review;
        const technical=b.stage==='technical'?b.decision:e.technical_review;
        return {id,stage:b.stage,decision:b.decision,published:
          rights==='approved'&&technical==='approved',reviewed:true};
      });
    });
}
