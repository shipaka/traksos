import type {Db} from '../db/index.ts';
import {forbidden,conflict,type AuthUser} from '../http/router.ts';
import {partnerActivityReport,type PartnerOffer} from '../domain/partnerActivityReport.ts';

const DAY=86_400_000;
const MAX_ORDERS=10_000;
type EvidenceRow={
  capture_started_at:Date|null;
  order_id:string|null;
  first_observed_sent_at:Date|null;
  completed_as_of:boolean|null;
};

/** Private read model for the current account only. No public route is
 * registered until retention, coverage and product acceptance are reviewed.
 * Dispatch evidence is an invitation, not confirmation of device delivery.
 */
export async function privatePartnerDispatchReport(db:Db,user:AuthUser,now:Date){
  if(user.status!=='active'||!user.roles.some(role=>role==='master'||role==='tow'))
    throw forbidden('Отчёт доступен только выездному исполнителю');
  const end=now.getTime();
  if(!Number.isFinite(end))throw new RangeError('Invalid report clock');
  const begin=new Date(end-90*DAY);
  // Eligibility, coverage and evidence are read in the same PostgreSQL snapshot.
  // The account ID comes exclusively from authenticated server context.
  const rows=await db.query<EvidenceRow>(
    `select c.capture_started_at,e.order_id,e.first_observed_sent_at,e.completed_as_of
       from users u join performer_profiles p on p.user_id=u.id
       left join partner_dispatch_evidence_coverage c on c.singleton
       left join lateral (
         select d.order_id,d.first_observed_sent_at,
                coalesce(o.performer_id=u.id and o.status='completed' and o.completed_at<=$3,false) as completed_as_of
           from partner_dispatch_evidence d join orders o on o.id=d.order_id
          where d.performer_id=u.id and d.first_observed_sent_at>=greatest(c.capture_started_at,$2::timestamptz)
            and d.first_observed_sent_at<$3 and d.recorded_at<=$3
          order by d.first_observed_sent_at,d.order_id
          limit $4
       ) e on true
      where u.id=$1 and u.status='active' and u.deleted_at is null
        and p.kind in ('master','tow') and p.kind::text=any(u.roles)
        and p.kind::text=any($5::text[])
      order by e.first_observed_sent_at,e.order_id`,
    [user.id,begin,now,MAX_ORDERS+1,user.roles]);
  if(!rows.length)throw forbidden('Нет действующего профиля выездного исполнителя');
  const capture=rows[0].capture_started_at;
  if(!capture||!Number.isFinite(new Date(capture).getTime())||new Date(capture).getTime()>end)
    throw conflict('dispatch_evidence_unavailable','История предложений пока недоступна');
  if(rows.length>MAX_ORDERS)
    throw conflict('dispatch_report_limit','Отчёт превышает допустимый объём; требуется отдельная выгрузка');
  const offers:PartnerOffer[]=rows.flatMap(row=>row.order_id&&row.first_observed_sent_at?[{
    orderId:row.order_id,sentAtMs:new Date(row.first_observed_sent_at).getTime(),
    completedAsOf:row.completed_as_of===true
  }]:[]);
  const report=partnerActivityReport({nowMs:end,offers,boundedPresence:[],observedSinceMs:null});
  const counts=(r:{personallyOffered:number;completedFromOffers:number})=>({
    personallyOffered:r.personallyOffered,completedFromOffers:r.completedFromOffers
  });
  return {
    windowDays:report.windowDays,windowStart:report.windowStart,windowEnd:report.windowEnd,weekTimezone:report.weekTimezone,
    dispatchCoverage:{
      captureStartedAt:new Date(capture).toISOString(),
      partialWindow:new Date(capture).getTime()>begin.getTime(),
      // Pre-capture invitations can reappear as newly observed retries.
      firstEverInvitationGuaranteed:false,deviceDeliveryConfirmed:false,
      note:'Учтены только сохранённые серверные предложения с начала наблюдения; не доказательство доставки или всего рыночного спроса.'
    },
    weeks:report.weeks.map(w=>({weekStart:w.weekStart,...counts(w)})),
    total:counts(report.total),
    availability:{status:'unavailable' as const,observedAvailableHours:null,
      note:'Нет подтверждённых ограниченных интервалов; часы не рассчитываются.'},
    changesLevel:false,changesDispatch:false,changesCommission:false,
    comparisonCaveat:report.comparisonCaveat
  };
}
