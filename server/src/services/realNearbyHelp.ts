import {z} from 'zod';
import type {Db} from '../db/index.ts';
import type {Router,AuthedCtx} from '../http/router.ts';
import {parse} from '../http/router.ts';
import {haversineKm} from '../domain/geo.ts';
import {slot,type Schedule} from '../domain/schedule.ts';

const radiusKm=50;
const accuracyLimit=500;
const maxFixAgeMinutes=15;
type ServiceKind='master'|'tow'|'service';
type Candidate={
  user_id:string;kind:string;name:string|null;specialties:string[];
  line_status:string;paused:boolean;location_at:Date|null;
  lat:number|null;lng:number|null;verification:string;user_status:string;
  schedule:Schedule|null;off_schedule_until:Date|null;extras:{vacation?:boolean}|null;busy:boolean;
};
type Workshop={
  id:string;name:string;address:string;lat:number|null;lng:number|null;
  hours:string;time_zone:string|null;closed_days:Array<string|Date>;paused:boolean;
  accepts:string[];staff:Record<string,string>;accepts_confirmed_at:Date|null;
};
const capabilities:Record<string,string>={
  electric:'Электрика',diag:'Диагностика',air:'Пневматика и тормоза',
  autonomy:'Автономные отопители',tyre:'Шиномонтаж',
  ecu:'Электронные блоки',brakes:'Тормоза',engine:'Двигатель',
  gearbox:'КПП',chassis:'Ходовая часть',tires:'Шины',heater:'Отопители',
};
type Card={
  kind:ServiceKind;title:string;count:number;capabilities:string[];
  providers:Array<{name:string;distanceKm:number;id?:string;detail:string}>;
  note:string;action:string;
};
function near(lat:number,lng:number,c:{lat:number|null;lng:number|null}){
  if(c.lat==null||c.lng==null||!Number.isFinite(c.lat)||!Number.isFinite(c.lng))return null;
  const distance=haversineKm({lat,lng},{lat:c.lat,lng:c.lng});
  return Number.isFinite(distance)&&distance<=radiusKm?Math.round(distance*10)/10:null;
}
function dateValue(v:string|Date):string {
  if(v instanceof Date)return v.toISOString().slice(0,10);
  return String(v).slice(0,10);
}
function localClock(at:Date,timeZone:string){
  try{
    const parts=new Intl.DateTimeFormat('en-GB',{
      timeZone,year:'numeric',month:'2-digit',day:'2-digit',
      hour:'2-digit',minute:'2-digit',hourCycle:'h23'
    }).formatToParts(at);
    const val=(n:string)=>parts.find(x=>x.type===n)?.value??'';
    return {day:val('year')+'-'+val('month')+'-'+val('day'),
      minutes:Number(val('hour'))*60+Number(val('minute'))};
  }catch{return null}
}
/** Missing region time zone is NEVER interpreted as Moscow in nationwide discovery. */
export function workshopOpenNow(w:Pick<Workshop,'time_zone'|'hours'|'closed_days'>,at:Date){
  if(!w.time_zone)return false;
  const local=localClock(at,w.time_zone);
  if(!local||w.closed_days?.some(day=>dateValue(day)===local.day))return false;
  if(/кругл|24\s*\/\s*7|24 ч/iu.test(w.hours))return true;
  const time=w.hours.match(/(\d{1,2})[:.](\d{2})\s*[–—-]\s*(\d{1,2})[:.](\d{2})/);
  if(!time)return false;
  const start=Number(time[1])*60+Number(time[2]),end=Number(time[3])*60+Number(time[4]);
  if(start>=1440||end>=1440)return false;
  return start<=end?local.minutes>=start&&local.minutes<end:
    local.minutes>=start||local.minutes<end;
}
/** Published only after a deliberate one-time GPS action in the driver interface.
 * No location persistence, no hidden IP lookup, no GPS streaming, and no fake 0->offer.
 * The existing SOS dispatch independently rechecks eligibility when booked.
 */
export function registerRealNearbyHelpRoutes(r:Router,db:Db,now:()=>Date){
  r.post('/api/community/nearby-help',['driver'],async(c:AuthedCtx)=>{
    const args=parse(z.object({
      lat:z.number().min(-90).max(90),
      lng:z.number().min(-180).max(180),
      accuracyMeters:z.number().int().min(1).max(accuracyLimit)
    }),c.body);
    // Precision of a location fix limits whether any location-specific advertising is truthful.
    const checkedAt=now();
    const maxLat=radiusKm/111.2,maxLng=Math.min(180,radiusKm/(111.2*Math.max(0.15,Math.cos(args.lat*Math.PI/180))));
    const centerLon=args.lng;
    const withinLon=(lon:number|null)=>lon!=null&&Math.abs(((lon-centerLon+540)%360)-180)<=maxLng;
    const since=new Date(checkedAt.getTime()-maxFixAgeMinutes*60000);
    const [people,centers]=await Promise.all([
      db.query<Candidate>(
        "select p.user_id,p.kind,u.name,p.specialties,p.line_status,p.paused,p.location_at,"+
        "p.lat,p.lng,p.verification,p.schedule,p.off_schedule_until,p.extras,u.status as user_status,"+
        "exists(select 1 from orders o where o.performer_id=p.user_id "+
        "and o.status in ('accepted','en_route','arrived','working','awaiting_confirmation')) as busy "+
        "from performer_profiles p join users u on u.id=p.user_id "+
        "where u.status='active' and p.verification='approved' and p.kind in ('master','ecu','tow') "+
        "and p.line_status='online' and p.paused=false and p.lat between $1 and $2 "+
        "and p.location_at>=$3 order by p.location_at desc limit 2000",
        [args.lat-maxLat,args.lat+maxLat,since]),
      db.query<Workshop>(
        "select c.id,c.name,c.address,c.lat,c.lng,c.hours,c.time_zone,c.closed_days,"+
        "c.paused,c.accepts,c.staff,c.accepts_confirmed_at "+
        "from service_centers c join users u on u.id=c.owner_id "+
        "where u.status='active' and c.verification='approved' and c.paused=false "+
        "and c.lat between $1 and $2 and c.accepts_confirmed_at>=$3 "+
        "order by c.accepts_confirmed_at desc limit 2000",
        [args.lat-maxLat,args.lat+maxLat,new Date(checkedAt.getTime()-7*86400000)])
    ]);
    const eligible=people
      .filter(p=>withinLon(p.lng)&&!p.busy&&!p.extras?.vacation)
      .filter(p=>!p.schedule?.on||!!p.schedule.timeZone||
        (p.off_schedule_until!=null&&new Date(p.off_schedule_until)>checkedAt))
      .filter(p=>slot(p.schedule,checkedAt,p.off_schedule_until)==='work')
      .map(p=>({p,distance:near(args.lat,args.lng,p)}))
      .filter((x):x is {p:Candidate;distance:number}=>x.distance!=null)
      .sort((a,b)=>a.distance-b.distance);
    const types:Array<{kind:ServiceKind;title:string;which:(p:Candidate)=>boolean;note:string;action:string}>=[
      {kind:'master',title:'Выездные мастера',which:p=>p.kind==='master'||p.kind==='ecu',
        note:'Подтверждены и сейчас на линии. Специализацию и возможность выезда перепроверим при заявке.',
        action:'#/sos'},
      {kind:'tow',title:'Эвакуация',which:p=>p.kind==='tow',
        note:'Эвакуатор подтверждён и сейчас на линии. Совместимость с грузом и технику уточним по заявке.',
        action:'#/sos'}
    ];
    const cards:Card[]=types.flatMap(({kind,title,which,note,action})=>{
      const found=eligible.filter(x=>which(x.p)&&
        (x.p.kind!=='master'||(x.p.specialties??[]).some(sp=>sp!=='consult')));
      if(!found.length)return [];
      const skills=[...new Set(found.flatMap(x=>
        x.p.kind==='tow'?['Эвакуация']:
        x.p.kind==='ecu'?['Электронные блоки']:
        (x.p.specialties??[]).filter(t=>t!=='consult').map(t=>capabilities[t]??t)
      ))];
      // A phone-only consultant must not be advertised as an on-site repairer.
      if(!skills.length)return [];
      return [{kind,title,count:found.length,capabilities:skills,
        providers:found.slice(0,3).map(x=>({
          name:x.p.name?.trim().split(/\s+/)[0]??(kind==='tow'?'Эвакуатор':'Специалист'),
          distanceKm:x.distance,
          detail:x.p.kind==='tow'?'Эвакуация':
            x.p.kind==='ecu'?'Электронные блоки':
            (x.p.specialties??[]).filter(t=>t!=='consult').map(t=>capabilities[t]??t).join(', ')
        })),
        note,action}];
    });
    const workshops=centers
      .filter(w=>withinLon(w.lng)&&w.accepts?.length&&workshopOpenNow(w,checkedAt))
      .map(w=>({w,distance:near(args.lat,args.lng,w)}))
      .filter((x):x is {w:Workshop;distance:number}=>x.distance!=null)
      .sort((a,b)=>a.distance-b.distance);
    if(workshops.length)cards.push({
      kind:'service',title:'СТО рядом',count:workshops.length,
      capabilities:[...new Set(workshops.flatMap(x=>Object.entries(x.w.staff??{})
        .filter(([_,value])=>value==='own')
        .map(([k])=>capabilities[k]??k)))],
      providers:workshops.slice(0,3).map(x=>({
        id:x.w.id,name:x.w.name,distanceKm:x.distance,detail:'Открыто по местному расписанию · приём по запросу'
      })),
      note:'Реальные подтверждённые СТО, открытые по своему местному времени. Свободное место и запись уточняются.',
      action:'#/services'
    });
    return {
      radiusKm,checkedAt:checkedAt.toISOString(),accuracyMeters:args.accuracyMeters,
      cards,hasMatches:cards.length>0,region:'nearby',
      noMatchesText:'В радиусе 50 км сейчас нет подтверждённых доступных партнёров. Не показываем вымышленные предложения.',
      disclaimer:'Это наличие партнёров на момент проверки, а не гарантированная бронь или обещание прибытия. Координаты не сохраняются в профиле Эфира.'
    };
  });
}
