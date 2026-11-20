import {z} from 'zod';
import type {Db} from '../db/index.ts';
import type {Router,AuthUser,AuthedCtx} from '../http/router.ts';
import {forbidden,notFound,parse} from '../http/router.ts';

const DAY=86_400_000;
const WEEK=7*DAY;
const ALLOWED=['master','tow','service'];

type Presence={line_status:string;paused:boolean;observed_at:Date;id:string};
type OfferWeek={week_start:Date;offered:number;completed:number;observed_online_offers:number};
function weekStart(when:number){
  const d=new Date(when);const weekday=(d.getUTCDay()+6)%7;
  return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-weekday);
}
function r1(n:number){return Math.round(n*10)/10}

/**
 * Personal evidence of availability and real invitations, not a ranking.
 * "Available hours" are reconstructed from DECLARED status transitions.
 * They cannot prove physical presence, precise location, comparable demand,
 * or the opportunity to receive all orders in the wider local market.
 */
export async function partnerActivity(db:Db,userId:string,now=new Date()){
  const end=now.getTime(),begin=end-90*DAY,first=weekStart(begin);
  const rows:Record<string,{weekStart:string;declaredAvailableHours:number;
    personallyOffered:number;completedFromOffers:number;offersWhileDeclaredOnline:number}>={};
  for(let at=first;at<end;at+=WEEK){
    const key=new Date(at).toISOString().slice(0,10);
    rows[key]={weekStart:key,declaredAvailableHours:0,personallyOffered:0,
      completedFromOffers:0,offersWhileDeclaredOnline:0};
  }
  const [history,offers]=await Promise.all([
    db.query<Presence>(
      'select id::text as id,line_status,paused,observed_at from partner_presence_events '+
      'where user_id=$1 and observed_at <=$2 order by observed_at,id',[userId,now]),
    db.query<OfferWeek>(
      `select date_trunc('week',d.sent_at at time zone 'UTC') as week_start,
       count(distinct d.order_id)::int as offered,
       count(distinct d.order_id) filter(where o.performer_id=$1
         and o.status='completed')::int as completed,
       count(distinct d.order_id) filter(where exists(
         select 1 from (
           select e.line_status,e.paused from partner_presence_events e
           where e.user_id=$1 and e.observed_at<=d.sent_at
           order by e.observed_at desc,e.id desc limit 1) active
         where active.line_status in ('online','on_call') and not active.paused
       ))::int as observed_online_offers
       from order_dispatch d left join orders o on o.id=d.order_id
       where d.performer_id=$1 and d.sent_at>=$2 and d.sent_at<=$3
       group by date_trunc('week',d.sent_at at time zone 'UTC')
       order by week_start`,[userId,new Date(begin),now])
  ]);
  for(const [index,e] of history.entries()){
    if(e.paused || !['online','on_call'].includes(e.line_status))continue;
    let start=Math.max(begin,new Date(e.observed_at).getTime());
    const stop=Math.min(end,index+1<history.length
      ?new Date(history[index+1].observed_at).getTime():end);
    while(start<stop){
      const bucket=weekStart(start);
      const key=new Date(bucket).toISOString().slice(0,10);
      const next=Math.min(stop,bucket+WEEK);
      if(rows[key])rows[key].declaredAvailableHours+=(next-start)/3_600_000;
      start=next;
    }
  }
  for(const o of offers){
    const key=new Date(o.week_start).toISOString().slice(0,10);
    if(!rows[key])continue;
    rows[key].personallyOffered=o.offered;
    rows[key].completedFromOffers=o.completed;
    rows[key].offersWhileDeclaredOnline=o.observed_online_offers;
  }
  const weeks=Object.values(rows).sort((a,b)=>a.weekStart.localeCompare(b.weekStart));
  weeks.forEach(w=>{w.declaredAvailableHours=r1(w.declaredAvailableHours)});
  const total={
    personallyOffered:weeks.reduce((n,w)=>n+w.personallyOffered,0),
    completedFromOffers:weeks.reduce((n,w)=>n+w.completedFromOffers,0),
    declaredAvailableHours:r1(weeks.reduce((n,w)=>n+w.declaredAvailableHours,0)),
    offersWhileDeclaredOnline:weeks.reduce((n,w)=>n+w.offersWhileDeclaredOnline,0),
  };
  const firstObservedAt=history[0]?.observed_at??null;
  return {
    windowDays:90,windowStart:new Date(begin).toISOString(),windowEnd:now.toISOString(),
    weeks,total,firstObservedAt,
    partialHistory:!firstObservedAt||new Date(firstObservedAt).getTime()>begin,
    sampleSufficient:total.personallyOffered>=5,
    note:'Только лично полученные предложения; отсутствие предложений не считается отказом от работы.',
    availabilityCaveat:'Часы рассчитаны по серверным сменам статуса online/on_call без паузы. Это не непрерывная GPS-телеметрия и не подтверждение физического присутствия.',
    comparisonCaveat:'Данных о сопоставимом спросе других специалистов, сезонности, районе или всех подходящих заказах в этом отчёте нет. Никого нельзя понижать по этим значениям автоматически.',
    changesLevel:false,changesDispatch:false,changesCommission:false
  };
}

export function registerPartnerActivityRoutes(r:Router,db:Db,now:()=>Date){
  r.get('/api/partner/activity',true,async(c:AuthedCtx)=>{
    if(!c.user.roles.some(r=>ALLOWED.includes(r)))throw forbidden('Только исполнитель');
    if(!await db.one('select 1 from performer_profiles where user_id=$1',[c.user.id]))
      throw notFound('Профиль исполнителя не найден');
    return partnerActivity(db,c.user.id,now());
  });
  r.get('/api/admin/partner/activity/:id',['admin'],async(c:AuthedCtx)=>{
    const id=parse(z.string().uuid(),c.params.id);
    if(!await db.one('select 1 from performer_profiles where user_id=$1',[id]))
      throw notFound('Профиль исполнителя не найден');
    return partnerActivity(db,id,now());
  });
}
