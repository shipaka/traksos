import type { Db } from '../db/index.ts';
import { bad, notFound, type AuthUser } from '../http/router.ts';

type Workshop = {
  id:string; name:string; lat:number|null; lng:number|null;
  verification:string; paused:boolean; accepts_current:boolean;
  public_map_location_verified_at:string|null;
};
type PublicPoint = { id:string; kind:'service'; name:string; lat:number; lng:number };

function validStationaryPosition(lat:unknown,lng:unknown):boolean {
  const y=Number(lat),x=Number(lng);
  return lat!==null && lng!==null && Number.isFinite(y) && Number.isFinite(x) &&
    y>=-90 && y<=90 && x>=-180 && x<=180 && !(x===0 && y===0);
}

/**
 * Explicit public stationary address opt-in only. NEVER read or return
 * performer_profiles.lat/lng, route samples, clients or live mobile GPS.
 * A display name is published only after the workshop operator opts in.
 */
export class PublicPartnerMap {
  constructor(private readonly db:Db) {}

  async list():Promise<{source:'verified_stationary_opt_in';points:PublicPoint[]}> {
    const rows=await this.db.query<{id:string;name:string;lat:number;lng:number}>(`
      select c.id,c.name,c.lat,c.lng
        from service_centers c
        join users u on u.id=c.owner_id
       where c.public_map_opt_in=true
         and c.verification='approved'
         and c.paused=false
         and c.accepts_confirmed_at >= now() - interval '7 days'
         and c.public_map_location_verified_at is not null
         and u.status='active'
         and u.deleted_at is null
         and 'service'=any(u.roles)
         and c.lat between -90 and 90 and c.lng between -180 and 180
         and not(c.lat=0 and c.lng=0)
       order by c.id
       limit 10000`);
    return {source:'verified_stationary_opt_in',
      points:rows.filter(r=>validStationaryPosition(r.lat,r.lng))
        .map(r=>({id:r.id,kind:'service',name:r.name,lat:Number(r.lat),lng:Number(r.lng)}))};
  }

  async visibility(user:AuthUser,enabled:boolean) {
    const center=await this.db.one<Workshop>(`select c.id,c.name,c.lat,c.lng,
      c.verification,c.paused,
      (c.accepts_confirmed_at >= now() - interval '7 days') as accepts_current,
      c.public_map_location_verified_at
      from service_centers c
      where c.owner_id=$1`,[user.id]);
    if(!center)throw notFound('Сначала заполните карточку СТО');
    if(enabled && (center.verification!=='approved' || center.paused ||
      !center.accepts_current || !center.public_map_location_verified_at ||
      !validStationaryPosition(center.lat,center.lng)))
      throw bad('public_map_not_ready',
        'Публичная карта доступна лишь СТО с проверенным адресом, подтверждёнными за последние 7 дней услугами и согласием на публикацию.');
    const row=await this.db.one<{public_map_opt_in:boolean;public_map_opted_at:string|null}>(`
      update service_centers
         set public_map_opt_in=$2,
             public_map_opted_at=case when $2 then now() else null end
       where owner_id=$1 returning public_map_opt_in,public_map_opted_at`,[user.id,enabled]);
    return {enabled:!!row?.public_map_opt_in,optedAt:row?.public_map_opted_at??null,
      note:'Только стационарные подтверждённые координаты СТО. Текущий GPS мастеров не публикуется.'};
  }
}
