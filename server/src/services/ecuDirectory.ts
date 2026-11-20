import {z} from 'zod';
import type {Db} from '../db/index.ts';
import type {Router,AuthedCtx} from '../http/router.ts';
import {parse,bad,notFound,conflict} from '../http/router.ts';
import {haversineKm} from '../domain/geo.ts';

/** Verified published *workshop* locations, never a worker's moving GPS. */
export function registerEcuDirectoryRoutes(r:Router,db:Db){
  r.get('/api/ecu/stations',true,async(c:AuthedCtx)=>{
    const n=(x:string|null,min:number,max:number)=>{
      if(x==null||x==='')return null;
      const value=Number(x);return Number.isFinite(value)&&value>=min&&value<=max?value:null;
    };
    const lat=n(c.query.get('lat'),-90,90),lng=n(c.query.get('lng'),-180,180);
    const rows=await db.query<any>(
      "select p.user_id as id,u.name,p.extras->'ecuStation' as station, "+
      "coalesce(d.level,'start') as level from performer_profiles p "+
      "join users u on u.id=p.user_id "+
      "left join partner_level_decisions d on d.user_id=p.user_id and d.current=true "+
      "where p.kind='ecu' and p.verification='approved' and u.status='active' "+
      "and p.extras #>> '{ecuStation,published}'='true' and p.extras #>> '{ecuStation,publicationConsentConfirmed}'='true' "+
      "order by u.name nulls last,p.user_id limit 100");
    const stations=rows.map(row=>{
      const s=row.station||{};
      const stationLat=Number(s.lat),stationLng=Number(s.lng);
      if(!Number.isFinite(stationLat)||!Number.isFinite(stationLng))return null;
      return {id:row.id,name:s.name||row.name||'Мастерская ЭБУ',
        address:s.address,lat:stationLat,lng:stationLng,level:row.level,
        verified:true,distanceKm:lat!=null&&lng!=null?
          Math.round(haversineKm({lat,lng},{lat:stationLat,lng:stationLng})):null};
    }).filter(Boolean);
    if(lat!=null&&lng!=null)stations.sort((a:any,b:any)=>a.distanceKm-b.distanceKm);
    return {stations,scope:'nationwide',radiusApplied:false,locationKind:'verified_station'};
  });
  r.get('/api/admin/ecu/stations',['admin'],()=>db.query(
    "select p.user_id,u.name,p.verification,p.extras->'ecuStation' as station "+
    "from performer_profiles p join users u on u.id=p.user_id "+
    "where p.kind='ecu' order by u.name nulls last,p.user_id"));
  r.put('/api/admin/ecu/stations/:id',['admin'],async(c:AuthedCtx)=>{
    const id=parse(z.string().uuid(),c.params.id);
    const b=parse(z.object({name:z.string().trim().min(2).max(120),
      address:z.string().trim().min(8).max(300),
      lat:z.number().min(-90).max(90),lng:z.number().min(-180).max(180),
      published:z.boolean(),consentConfirmed:z.boolean().default(false),
      reason:z.string().trim().min(20).max(500)}),c.body);
    return db.tx(async q=>{
      const p=await q.one<{verification:string}>(
        "select verification from performer_profiles where user_id=$1 and kind='ecu' for update",[id]);
      if(!p)throw notFound('Специалист ЭБУ не найден');
      if(b.published&&!b.consentConfirmed)
        throw bad('ecu_no_publication_consent','Подтвердите согласие владельца мастерской на публикацию рабочего адреса');
      if(b.published&&p.verification!=='approved')
        throw conflict('ecu_not_verified','Публикация доступна только после проверки профиля');
      const station={name:b.name,address:b.address,lat:b.lat,lng:b.lng,
        published:b.published,publicationConsentConfirmed:b.published&&b.consentConfirmed,
        reviewedBy:c.user.id,reviewedAt:new Date().toISOString()};
      await q.query(
        "update performer_profiles set extras=jsonb_set(coalesce(extras,'{}'::jsonb),"+
        "'{ecuStation}',$2::jsonb,true),updated_at=now() where user_id=$1",
        [id,JSON.stringify(station)]);
      await q.query(
        "insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)",
        [c.user.id,'ecu.station_approved',id,{published:b.published,consentConfirmed:b.consentConfirmed,reason:b.reason}]);
      return {id,station};
    });
  });
}
