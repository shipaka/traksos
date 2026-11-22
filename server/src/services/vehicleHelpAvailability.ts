import { haversineKm } from '../domain/geo.ts';
import { slot } from '../domain/schedule.ts';
import type { Db } from '../db/index.ts';
import { bad, forbidden, type AuthUser } from '../http/router.ts';
import type { SettingsService } from './settings.ts';

// Availability is not a marketing claim: only verified, on-line, not busy,
// recent GPS positions within the configured radius can be called "nearby".
// Great-circle distance is explicitly NOT road distance or an ETA.
const SERVICES = ['electric','diag','air','autonomy','tyre','ecu','tow','consult'] as const;
type Service = typeof SERVICES[number];
export class VehicleHelpAvailability {
  constructor(private db:Db, private settings:SettingsService, private now:()=>Date=()=>new Date()) {}

  async nearby(user:AuthUser, args:{service:Service;lat?:number;lng?:number;brand?:string}) {
    if (!user || user.status !== 'active') throw forbidden();
    if (!SERVICES.includes(args.service)) throw bad('unknown_service','Неизвестная услуга');
    if (args.lat == null || args.lng == null) return {
      service:args.service,available:false,canRecommend:false,count:0,
      reason:'location_required',message:'Для поиска ближайшего специалиста нужна точка автомобиля.',
    };
    const {lat,lng} = args;
    if (!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)
      throw bad('invalid_coordinates','Некорректные координаты');
    const all=await this.settings.all();
    const policyRadius=Math.min(70,Math.max(3,Number(all.dispatch?.radiusKm)||35));
    const isTow=args.service==='tow', isEcu=args.service==='ecu';
    const rows=await this.db.query<any>(
      'select p.user_id,p.kind,p.specialties,p.brands,p.lat,p.lng,p.location_at,' +
      'p.line_status,p.paused,p.verification,p.schedule,p.off_schedule_until,p.extras,' +
      'u.status as user_status,' +
      "exists(select 1 from orders o where o.performer_id=p.user_id " +
      "and o.status in ('accepted','en_route','arrived','working','awaiting_confirmation')) as busy " +
      'from performer_profiles p join users u on u.id=p.user_id ' +
      "where p.verification='approved' and p.line_status='online' " +
      'and p.lat is not null and p.lng is not null and p.location_at >= $1::timestamptz ' +
      'and p.user_id<>$2 and u.status=\'active\'',
      [new Date(this.now().getTime()-15*60_000).toISOString(),user.id]);
    const eligible=rows.filter((x:any)=>{
      if(x.busy||x.paused||x.extras?.vacation) return false;
      if(isTow ? x.kind!=='tow' : isEcu?x.kind!=='ecu'&&!x.specialties?.includes('ecu') :
        x.kind!=='master')return false;
      if(!isTow&&!isEcu&&args.service!=='consult'&&!x.specialties?.includes(args.service))return false;
      if(args.brand && x.brands?.[args.brand]==='refuse')return false;
      if(slot(x.schedule,this.now(),x.off_schedule_until)!=='work')return false;
      if(!Number.isFinite(Number(x.lat))||!Number.isFinite(Number(x.lng)))return false;
      const distance=haversineKm({lat,lng},{lat:Number(x.lat),lng:Number(x.lng)});
      return Number.isFinite(distance) && distance<=policyRadius;
    }).map((x:any)=>({
      distanceKm:Math.round(haversineKm({lat,lng},{lat:Number(x.lat),lng:Number(x.lng)})*10)/10,
    })).sort((a,b)=>a.distanceKm-b.distanceKm);
    return {
      service:args.service,available:eligible.length>0,canRecommend:eligible.length>0,
      count:eligible.length,distanceKm:eligible.length?eligible[0].distanceKm:null,
      radiusKm:policyRadius,locationFreshnessMinutes:15,
      metric:'straight_line_km',etaAvailable:false,
      message:eligible.length?'Есть подтверждённые свободные специалисты поблизости. Точное время приезда уточняется при вызове.'
        :'Нет подтверждённых свободных специалистов в заданном радиусе. Показывать обещание выезда нельзя.',
    };
  }
}
