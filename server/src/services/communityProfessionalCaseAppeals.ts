import {z} from 'zod';
import type {Db} from '../db/index.ts';
import type {Router,AuthedCtx} from '../http/router.ts';
import {bad,conflict,forbidden,notFound,parse} from '../http/router.ts';
import type {Notifier} from './notify.ts';
import {roomLiveRecipients} from './community.ts';

const numeric=z.string().regex(/^\d{1,16}$/);
const reasons=z.string().trim().min(30).max(1500);
type AppealReport={
  id:string;case_id:string;reply_id:string|null;decision:string|null;
  status:string;reviewed_by:string|null;reviewed_at:Date|null;reporter_id:string;
  room_id:string;case_author:string;reply_author:string|null;
  case_state:string;reply_state:string|null
};

export function registerProfessionalCaseAppeals(r:Router,db:Db,notifier:Notifier){
  async function reportDetails(reportId:string){
    const row=await db.one<AppealReport>(`
      select x.id::text as id,x.case_id,x.reply_id::text as reply_id,
        x.decision,x.status,x.reviewed_by,x.reviewed_at,x.reporter_id,t.room_id,
        t.author_id as case_author,r.author_id as reply_author,
        t.moderation_state as case_state,r.moderation_state as reply_state
      from community_technical_case_reports x
      join community_technical_cases t on t.id=x.case_id
      left join community_technical_case_replies r on r.id=x.reply_id
      where x.id=$1`,[reportId]);
    if(!row)throw notFound('Решение модератора не найдено');
    return row;
  }
  // An author who lost professional verification can still appeal an earlier
  // action against their own contribution. Never return reporter identities.
  r.get('/api/community/pro-cases/my-moderation',true,async(c:AuthedCtx)=>{
    const rows=await db.query<{
      report_id:string;case_id:string;reply_id:string|null;
      reviewed_at:Date;review_note:string|null;
      appeal_id:string|null;appeal_status:string|null
    }>(`
      select x.id::text as report_id,x.case_id,x.reply_id::text as reply_id,
        x.reviewed_at,x.review_note,
        a.id::text as appeal_id,a.status as appeal_status
      from community_technical_case_reports x
      join community_technical_cases t on t.id=x.case_id
      left join community_technical_case_replies r on r.id=x.reply_id
      left join community_technical_case_appeals a
        on a.report_id=x.id and a.appellant_id=$1
      where x.status='reviewed' and x.decision='hide'
        and (case when x.reply_id is null then t.author_id
                  else r.author_id end)=$1
      order by x.reviewed_at desc,x.id desc limit 100`,[c.user.id]);
    return {decisions:rows,reporterIdentityHidden:true};
  });
  r.post('/api/community/pro-cases/appeals',true,async(c:AuthedCtx)=>{
    const b=parse(z.object({reportId:numeric,grounds:reasons}),c.body);
    const report=await reportDetails(b.reportId);
    const owner=report.reply_id?report.reply_author:report.case_author;
    if(owner!==c.user.id)throw notFound('Решение модератора не найдено');
    if(report.decision!=='hide'||report.status!=='reviewed'||!report.reviewed_at)
      throw conflict('no_hidden_decision','Обжаловать можно только решение о скрытии');
    const pending=report.reply_id?report.reply_state==='hidden':report.case_state==='hidden';
    if(!pending)throw conflict('already_visible','Материал уже доступен, обжалование не требуется');
    const result=await db.tx(async q=>{
      // Guard duplicate concurrent submissions and keep an existing appeal
      // unchanged if the author presses the button twice after a lost reply.
      const old=await q.one<{id:string;status:string;grounds:string}>(
        'select id::text as id,status,grounds from community_technical_case_appeals '+
        'where report_id=$1 and appellant_id=$2',[b.reportId,c.user.id]);
      if(old){
        if(old.grounds!==b.grounds)
          throw conflict('appeal_exists','Обжалование уже подано. Редактирование требует отдельного обращения');
        return {id:old.id,status:old.status,created:false};
      }
      const recent=await q.one<{n:number}>(`
        select count(*)::int as n from community_technical_case_appeals
        where appellant_id=$1 and created_at>now()-interval '1 day'`,[c.user.id]);
      if((recent?.n??0)>=5)throw conflict('appeal_rate_limit','Достигнут дневной лимит обжалований');
      const saved=await q.one<{id:string;status:string}>(`
        insert into community_technical_case_appeals(report_id,case_id,appellant_id,grounds)
        values($1,$2,$3,$4)
        on conflict(report_id,appellant_id) do nothing
        returning id::text as id,status`,[report.id,report.case_id,c.user.id,b.grounds]);
      if(saved)return {...saved,created:true};
      const concurrent=await q.one<{id:string;status:string}>(
        'select id::text as id,status from community_technical_case_appeals '+
        'where report_id=$1 and appellant_id=$2',[b.reportId,c.user.id]);
      return {...concurrent!,created:false};
    });
    return {...result,reportId:report.id,reviewIsIndependent:true};
  });
  r.get('/api/admin/community/pro-cases/appeals',['admin','moderator'],async()=>{
    const appeals=await db.query<{
      id:string;report_id:string;case_id:string;reply_id:string|null;
      grounds:string;created_at:Date;status:string;
      moderator_id:string|null;moderator_note:string|null;
      source_text:string;club_title:string
    }>(`
      select a.id::text as id,a.report_id::text as report_id,a.case_id,
        x.reply_id::text as reply_id,a.grounds,a.created_at,a.status,
        x.reviewed_by as moderator_id,x.review_note as moderator_note,
        coalesce(r.body,t.symptoms) as source_text,room.title as club_title
      from community_technical_case_appeals a
      join community_technical_case_reports x on x.id=a.report_id
      join community_technical_cases t on t.id=a.case_id
      left join community_technical_case_replies r on r.id=x.reply_id
      join community_rooms room on room.id=t.room_id
      where a.status='pending'
      order by a.created_at,a.id limit 100`);
    return {appeals,originalReviewerCannotResolve:true};
  });
  r.post('/api/admin/community/pro-cases/appeals/:id/review',
    ['admin','moderator'],async(c:AuthedCtx)=>{
      const id=parse(numeric,c.params.id);
      const b=parse(z.object({decision:z.enum(['upheld','overturned']),
        note:z.string().trim().min(15).max(1500)}),c.body);
      const outcome=await db.tx(async q=>{
        const a=await q.one<{id:string;report_id:string;case_id:string;appellant_id:string;status:string}>(
          'select id::text as id,report_id::text as report_id,case_id,appellant_id,status '+
          'from community_technical_case_appeals where id=$1 for update',[id]);
        if(!a)throw notFound('Обжалование не найдено');
        if(a.status!=='pending')throw conflict('appeal_reviewed','Обжалование уже рассмотрено');
        const r=await q.one<AppealReport>(`
          select x.id::text as id,x.case_id,x.reply_id::text as reply_id,
            x.decision,x.status,x.reviewed_by,x.reviewed_at,x.reporter_id,
            t.room_id,t.author_id as case_author,y.author_id as reply_author,
            t.moderation_state as case_state,y.moderation_state as reply_state
          from community_technical_case_reports x
          join community_technical_cases t on t.id=x.case_id
          left join community_technical_case_replies y on y.id=x.reply_id
          where x.id=$1`,[a.report_id]);
        if(!r)throw notFound('Решение по жалобе не найдено');
        if(r.reviewed_by===c.user.id||r.reporter_id===c.user.id||a.appellant_id===c.user.id)
          throw conflict('independent_review_required',
            'Пересматривать собственное решение должен другой модератор или администратор');
        const parent=await q.one<{knowledge_proposal_id:string|null}>(
          'select knowledge_proposal_id from community_technical_cases where id=$1 for update',
          [a.case_id]);
        if(!parent)throw notFound('Карточка не найдена');
        let restored=false;
        if(b.decision==='overturned'){
          // Do not undo another independent hide decision for the same text.
          const other=await q.one<{n:number}>(`
            select count(*)::int as n from community_technical_case_reports other
            where other.case_id=$1 and other.id<>$3 and
              coalesce(other.reply_id,0)=coalesce($2::bigint,0)
              and other.status='reviewed' and other.decision='hide'
              and not exists (
                select 1 from community_technical_case_appeals oa
                where oa.report_id=other.id and oa.status='overturned')`,
            [a.case_id,r.reply_id,r.id]);
          if((other?.n??0)>0)
            throw conflict('other_hide_decisions',
              'Есть другие решения о скрытии этого текста. Их нужно рассмотреть отдельно');
          if(r.reply_id){
            // A hidden case stays hidden, even if one answer's appeal succeeds.
            await q.query(
              "update community_technical_case_replies set moderation_state='published' "+
              'where case_id=$1 and id=$2',[a.case_id,r.reply_id]);
          }else{
            await q.query(
              "update community_technical_cases set moderation_state='published',updated_at=now() "+
              'where id=$1',[a.case_id]);
          }
          restored=true;
          // Never re-approve knowledge or reinstate a detached accepted reply.
        }
        await q.query(`
          update community_technical_case_appeals set status=$2,reviewed_by=$3,
            reviewed_at=now(),review_note=$4 where id=$1`,
          [id,b.decision,c.user.id,b.note]);
        await q.query(
          'insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
          [c.user.id,'community.technical_appeal_review',id,
            {caseId:a.case_id,reportId:a.report_id,decision:b.decision,
              restorationPerformed:restored,note:b.note}]);
        return {id,caseId:a.case_id,roomId:r.room_id,decision:b.decision,
          restored,knowledgeRequiresReview:Boolean(parent.knowledge_proposal_id)};
      });
      if(outcome.restored){
        const room=await db.one<{id:string;audience:string;specialty:string|null;active:boolean}>(
          'select id,audience,specialty,active from community_rooms where id=$1',[outcome.roomId]);
        if(room?.active){
          const recipients=await roomLiveRecipients(db,room);
          notifier.live(recipients,{type:'community_technical_case',roomId:room.id,
            caseId:outcome.caseId,kind:'moderation'});
        }
      }
      return {id:outcome.id,decision:outcome.decision,restored:outcome.restored,
        knowledgeRequiresReview:outcome.knowledgeRequiresReview};
    });
}
