import {z} from 'zod';
import type {Db} from '../db/index.ts';
import type {Router,AuthedCtx,AuthUser} from '../http/router.ts';
import {parse,forbidden,notFound,conflict} from '../http/router.ts';

type Level='start'|'active'|'priority';
const professional=(u:AuthUser)=>u.roles.some(r=>['master','tow','service'].includes(r));
type Counts={offered:number;completedFromOffers:number;completedTotal:number;
  approvedKnowledge:number;complaints:number;drops:number;rating:number|null;ratingCount:number};
type Presence={line_status:string;paused:boolean;observed_at:Date};

/** Only genuine observed ONLINE periods since migration activation; no retroactive hours. */
function presenceSummary(events:Presence[],since:Date,now:Date){
  if(!events.length)return {observedHours:0,firstObservedAt:null as Date|null,partialHistory:true};
  let ms=0;
  for(let i=0;i<events.length;i++){
    const from=Math.max(since.getTime(),events[i].observed_at.getTime());
    const until=Math.min(now.getTime(),(events[i+1]?.observed_at??now).getTime());
    if(until>from&&!events[i].paused&&['online','on_call'].includes(events[i].line_status))
      ms+=until-from;
  }
  return {observedHours:Math.round(ms/360000)/10,
    firstObservedAt:events[0].observed_at,partialHistory:events[0].observed_at>since};
}
/** Recommendation is not an entitlement, quality penalty or dispatch weight. */
export function suggestPartnerLevel(m:Counts,verified:boolean){
  if(!verified)return {candidate:'start' as Level,confidence:'limited' as const,
    reasons:['Требуется подтверждение профиля'],manualReviewRequired:true};
  const share=m.offered>0?m.completedFromOffers/m.offered:null;
  const clean=m.complaints===0&&m.drops===0;
  const work=m.completedTotal>0,knowledge=m.approvedKnowledge>0;
  const candidate:Level=clean&&(
    (m.rating!=null&&m.rating>=4.7&&m.ratingCount>=2&&work&&share!=null&&share>=0.5)
    ||(m.approvedKnowledge>=2&&work))?'priority':work||knowledge?'active':'start';
  const reasons=[
    ...(m.offered<5?['Слишком мало личных предложений для надёжной статистики. Низкий спрос не считается нарушением']:[]),
    ...(knowledge?['Учтены только проверенные юридически и технически материалы']:[]),
    ...(!clean?['Спорные случаи требуют ручной проверки, не автоматического наказания']:[]),
    'Рекомендация справочная. Уровень вручную утверждается администратором; нет автоматического изменения комиссий и заявок'
  ];
  return {candidate,confidence:m.offered>=5?'observed' as const:'limited' as const,
    reasons,manualReviewRequired:true};
}

export class PartnerLevelsService{
  constructor(private db:Db,private now:()=>Date){}
  private async metrics(id:string){
    const now=this.now(),since=new Date(now.getTime()-90*86400000);
    const sql=[
      'select',
      '(select count(distinct d.order_id)::int from order_dispatch d where d.performer_id=$1 and d.sent_at between $2 and $3) as "offered",',
      '(select count(distinct d.order_id)::int from order_dispatch d join orders o on o.id=d.order_id',
      "where d.performer_id=$1 and d.sent_at between $2 and $3 and o.performer_id=$1 and o.status='completed') as \"completedFromOffers\",",
      "(select count(*)::int from orders where performer_id=$1 and status='completed' and coalesce(completed_at,created_at) between $2 and $3) as \"completedTotal\",",
      "(select count(*)::int from community_knowledge where author_id=$1 and rights_review='approved'",
      "and technical_review='approved' and updated_at between $2 and $3) as \"approvedKnowledge\",",
      "(select count(*)::int from mod_cases where target_id=$1 and kind='dispute'",
      "and decision='client' and decided_at between $2 and $3) as \"complaints\",",
      "(select count(*)::int from order_events where actor_id=$1 and type='performer_dropped'",
      'and created_at between $2 and $3) as "drops",',
      '(select rating::float from users where id=$1) as "rating",',
      '(select rating_count from users where id=$1) as "ratingCount"'
    ].join(' ');
    const [stats,events]=await Promise.all([
      this.db.one<Counts>(sql,[id,since,now]),
      this.db.query<Presence>('select line_status,paused,observed_at from partner_presence_events where user_id=$1 and observed_at<=$2 order by observed_at,id',[id,now])
    ]);
    const p=presenceSummary(events,since,now);
    return {offered:stats?.offered??0,completedFromOffers:stats?.completedFromOffers??0,
      completedTotal:stats?.completedTotal??0,approvedKnowledge:stats?.approvedKnowledge??0,
      complaints:stats?.complaints??0,drops:stats?.drops??0,
      rating:stats?.rating??null,ratingCount:stats?.ratingCount??0,...p};
  }
  async view(user:AuthUser){
    if(!professional(user)&&!user.roles.includes('admin'))throw forbidden('Только для специалистов');
    const [profile,decision,appeal,metrics]=await Promise.all([
      this.db.one<{verification:string;kind:string;specialties:string[]}>(
        'select verification,kind,specialties from performer_profiles where user_id=$1',[user.id]),
      this.db.one<{level:Level;reason:string;review_due_at:Date;created_at:Date}>(
        'select level,reason,review_due_at,created_at from partner_level_decisions where user_id=$1 and current=true',[user.id]),
      this.db.one<{id:string;message:string;status:string;resolution:string|null;created_at:Date;resolved_at:Date|null}>(
        'select id,message,status,resolution,created_at,resolved_at from partner_level_appeals '+
        'where user_id=$1 order by created_at desc limit 1',[user.id]),
      this.metrics(user.id)
    ]);
    if(!profile)throw notFound('Профиль исполнителя не найден');
    const {observedHours,firstObservedAt,partialHistory,...counts}=metrics;
    return {
      program:'TrakSOS Партнёр',level:decision?.level??'start',
      effectiveAt:decision?.created_at??null,reviewDueAt:decision?.review_due_at??null,
      lastDecisionReason:decision?.reason??null,
      verification:profile.verification,kind:profile.kind,specialties:profile.specialties,
      metrics:{...counts,
        opportunityCompletionRate:metrics.offered?
          Math.round(100*Math.min(1,metrics.completedFromOffers/metrics.offered)):null,
        observedHours,firstObservedAt,partialHistory,windowDays:90,
        opportunityDefinition:'Только персонально предложенные заказы, а не все заказы региона',
        availabilityDefinition:'Часы онлайн считаются с начала журнала, прежние периоды не восстановлены'},
      recommendation:suggestPartnerLevel(counts,profile.verification==='approved'),
      privileges:{priorityDispatch:false,reducedCommission:false,acceleratedPayout:false,
        note:'Права и комиссии ещё не активированы; уровень информационный'},
      appeal:appeal?.status==='open'?appeal:null,
      lastAppeal:appeal??null,automaticDemotion:false
    };
  }
  async appeal(user:AuthUser,message:string){
    if(!professional(user))throw forbidden('Доступно только специалистам');
    if(!await this.db.one('select 1 from performer_profiles where user_id=$1',[user.id]))
      throw notFound('Профиль исполнителя не найден');
    try{return await this.db.one(
      'insert into partner_level_appeals(user_id,message) values($1,$2) returning id,status,created_at',[user.id,message]);}
    catch(e:any){if(e?.code==='23505')throw conflict('appeal_pending','Обращение уже открыто');throw e}
  }
  async queue(){
    const [appeals,reviewDue,ecuSpecialists]=await Promise.all([
      this.db.query("select a.id,a.user_id,a.message,a.created_at,d.level from partner_level_appeals a "+
        "left join partner_level_decisions d on d.user_id=a.user_id and d.current=true "+
        "where a.status='open' order by a.created_at limit 100"),
      this.db.query('select user_id,level,review_due_at from partner_level_decisions where current=true and review_due_at<=$1 order by review_due_at limit 100',[this.now()]),
      // Admin-only shortlist of ECU specialists; names and explicitly reviewed
      // levels, never private phone numbers, VINs or location history.
      this.db.query(
        "select p.user_id,u.name,p.verification,coalesce(d.level,'start') as level "+
        "from performer_profiles p join users u on u.id=p.user_id "+
        "left join partner_level_decisions d on d.user_id=p.user_id and d.current=true "+
        "where p.kind='ecu' order by u.name nulls last,p.user_id limit 100")
    ]);
    return {appeals,reviewDue,ecuSpecialists,automaticDemotion:false};
  }
  async decide(admin:AuthUser,userId:string,level:Level,reason:string){
    const now=this.now(),due=new Date(now.getTime()+90*86400000);
    return this.db.tx(async q=>{
      const p=await q.one<{verification:string}>(
        'select verification from performer_profiles where user_id=$1 for update',[userId]);
      if(!p)throw notFound('Исполнитель не найден');
      if(level!=='start'&&p.verification!=='approved')
        throw conflict('not_verified','Повышать можно только подтверждённого исполнителя');
      await q.query('update partner_level_decisions set current=false where user_id=$1 and current=true',[userId]);
      const result=await q.one(
        'insert into partner_level_decisions(user_id,level,reason,decided_by,created_at,review_due_at) values($1,$2,$3,$4,$5,$6) returning id,level,review_due_at',
        [userId,level,reason,admin.id,now,due]);
      await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
        [admin.id,'partner.level_decision',userId,{level,reason,decisionId:result?.id}]);
      return {...result,automaticFeeChange:false,automaticDispatchChange:false};
    });
  }
  async resolveAppeal(admin:AuthUser,id:string,resolution:string){
    return this.db.tx(async q=>{
      const r=await q.one(
        "update partner_level_appeals set status='resolved',resolution=$2,reviewer_id=$3,resolved_at=$4 "+
        "where id=$1 and status='open' returning id,user_id,status",[id,resolution,admin.id,this.now()]);
      if(!r)throw conflict('appeal_closed','Обращение уже закрыто');
      await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
        [admin.id,'partner.appeal_resolved',r.user_id,{appealId:id,resolution}]);
      return r;
    });
  }
}
export function registerPartnerLevelRoutes(r:Router,db:Db,now:()=>Date){
  const service=new PartnerLevelsService(db,now);
  r.get('/api/partner/level',true,(c:AuthedCtx)=>service.view(c.user));
  r.post('/api/partner/level/appeal',true,(c:AuthedCtx)=>
    service.appeal(c.user,parse(z.object({message:z.string().trim().min(20).max(1500)}),c.body).message));
  r.get('/api/admin/partner/levels',['admin'],()=>service.queue());
  r.post('/api/admin/partner/levels/:id/decision',['admin'],(c:AuthedCtx)=>{
    const id=parse(z.string().uuid(),c.params.id);
    const b=parse(z.object({level:z.enum(['start','active','priority']),
      reason:z.string().trim().min(20).max(1200)}),c.body);
    return service.decide(c.user,id,b.level,b.reason);
  });
  r.post('/api/admin/partner/appeals/:id/resolve',['admin'],(c:AuthedCtx)=>{
    const id=parse(z.string().uuid(),c.params.id);
    const b=parse(z.object({resolution:z.string().trim().min(20).max(1200)}),c.body);
    return service.resolveAppeal(c.user,id,b.resolution);
  });
}
