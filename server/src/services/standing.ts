// Исполнитель: уровень (Новичок / Проверенный / Лучший), точность подсказок по телефону, что происходит рядом.

import type { Db } from '../db/index.ts';
import type { AuthUser } from '../http/router.ts';
import { haversineKm } from '../domain/geo.ts';
import { performerKindFor, rankCandidates, type Candidate } from '../domain/dispatch.ts';
import { slot } from '../domain/schedule.ts';
import type { SettingsService } from './settings.ts';

export const LEVEL = { newbieJobs: 10, bestJobs: 50, bestRating: 4.7, minHintCases: 20, windowDays: 90 };
const SCORE: Record<string, number> = { yes: 1, part: 0.5, no: 0 };

/** Incomplete coordinates and 0/0 are not evidence of a nearby truck. */
function validPoint(lat: unknown, lng: unknown): boolean {
  return typeof lat === 'number' && typeof lng === 'number' &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 &&
    !(lat === 0 && lng === 0);
}

export class StandingService {
  constructor(private db: Db, private now: () => Date, private settings?: SettingsService) {}

  async standing(user: AuthUser) {
    const since = new Date(this.now().getTime() - LEVEL.windowDays * 86400_000);
    const s = await this.db.one<any>(
      `select (select count(*)::int from orders where performer_id=$1 and status='completed') as jobs,
              (select rating::float from users where id=$1) as rating,
              (select count(*)::int from order_events e where e.actor_id=$1 and e.type='performer_dropped' and e.created_at >= $2) as drops,
              (select count(*)::int from mod_cases m where m.target_id=$1 and m.kind='dispute' and m.decision='client' and m.decided_at >= $2) as lost`,
      [user.id, since]);
    const jobs = s.jobs ?? 0;
    const clean = (s.drops ?? 0) === 0 && (s.lost ?? 0) === 0;
    const level = jobs < LEVEL.newbieJobs ? 'newbie' : jobs >= LEVEL.bestJobs && (s.rating ?? 0) >= LEVEL.bestRating && clean ? 'best' : 'verified';
    const toBest = level === 'best' ? null : {
      jobs: Math.max(0, LEVEL.bestJobs - jobs), rating: LEVEL.bestRating, ratingOk: (s.rating ?? 0) >= LEVEL.bestRating, clean,
    };

    // Точность: подсказка по телефону против отметки мастера на выезде («подтвердилось / частично / нет»)
    const mine = await this.db.query<{ hint_check: string; brand: string | null }>(
      `select f.hint_check, c.brand from orders c join orders f on f.consult_of=c.id
        where c.performer_id=$1 and c.service='consult' and f.hint_check is not null and f.performer_id <> $1`, [user.id]);
    const all = await this.db.one<{ v: number | null; n: number }>(
      `select avg(case f.hint_check when 'yes' then 1 when 'part' then 0.5 else 0 end)::float as v, count(*)::int as n
         from orders c join orders f on f.consult_of=c.id where c.service='consult' and f.hint_check is not null and f.performer_id <> c.performer_id`);
    const acc = mine.length ? mine.reduce((a, r) => a + (SCORE[r.hint_check] ?? 0), 0) / mine.length : null;
    const byBrand: Record<string, { n: number; v: number }> = {};
    for (const r of mine) if (r.brand) { const b = (byBrand[r.brand] ??= { n: 0, v: 0 }); b.n++; b.v += SCORE[r.hint_check] ?? 0; }
    const norm = all?.v ?? null;
    const strong = Object.entries(byBrand).filter(([, b]) => b.n >= 5 && norm != null && b.v / b.n > norm + 0.1).map(([k]) => k);
    return {
      level, jobs, rating: s.rating, drops: s.drops, lostDisputes: s.lost, toBest, thresholds: LEVEL,
      accuracy: { cases: mine.length, value: acc, norm, counted: mine.length >= LEVEL.minHintCases, strongIn: strong },
    };
  }

  /** На линии: открытых заявок рядом по вашему профилю и сколько свободных коллег ближе к ним */
  async nearby(user: AuthUser) {
    const p = await this.db.one<any>(
      'select kind,specialties,lat,lng from performer_profiles where user_id=$1',[user.id]);
    if(!p)return null;
    if(!validPoint(p.lat,p.lng))return {openNearby:0,ahead:0,locationKnown:false};
    const open=await this.db.query<{service:string;lat:number|null;lng:number|null}>(
      `select service,lat,lng from orders where status='searching' and created_by<>$1
       and lat is not null and lng is not null`,[user.id]);
    const near=open.filter(o=>validPoint(o.lat,o.lng) &&
      performerKindFor(o.service)===p.kind &&
      (p.kind!=='master'||o.service==='consult'||(p.specialties??[]).includes(o.service)) &&
      haversineKm({lat:p.lat,lng:p.lng},{lat:o.lat!,lng:o.lng!})<=50);
    // Only active, approved, available colleagues with valid positions can
    // precede this performer for a geographically verified open request.
    const others=await this.db.query<{
      kind:string;specialties:string[];lat:number|null;lng:number|null;
      schedule:any;off_schedule_until:Date|null;extras:any
    }>(`select p.kind,p.specialties,p.lat,p.lng,p.schedule,p.off_schedule_until,p.extras
         from performer_profiles p join users u on u.id=p.user_id
        where p.kind=$1 and p.user_id<>$2 and u.status='active'
          and p.verification='approved' and p.line_status='online' and not p.paused
          and p.lat is not null and p.lng is not null
          and not exists(select 1 from orders o where o.performer_id=p.user_id
             and o.status in ('accepted','en_route','arrived','working','awaiting_confirmation')
             and not (o.status='awaiting_confirmation' and
               (o.service='consult' or exists (select 1 from order_unilateral_closures uc
                 where uc.order_id=o.id and uc.status in ('pending_client','disputed')))))`,
      [p.kind,user.id]);
    const now=this.now();
    let ahead=0;
    for(const c of others){
      if(!validPoint(c.lat,c.lng)||c.extras?.vacation)continue;
      const available=slot(c.schedule,now,c.off_schedule_until);
      if(available!=='work'&&available!=='phone')continue;
      if(near.some(o=>
        (available==='work'||o.service==='consult') &&
        (c.kind!=='master'||o.service==='consult'||(c.specialties??[]).includes(o.service)) &&
        haversineKm({lat:c.lat!,lng:c.lng!},{lat:o.lat!,lng:o.lng!}) <
        haversineKm({lat:p.lat,lng:p.lng},{lat:o.lat!,lng:o.lng!})))ahead++;
    }
    return {openNearby:near.length,ahead,locationKnown:true};
  }

  /** Клиенту до вызова: сколько мастеров на линии, сколько свободны и подходят, и кто ближе всего — без контактов */
  async mastersNearby(user: AuthUser, p: { service: string; lat?: number; lng?: number; brand?: string; verifiedOnly?: boolean; sortBy?: 'recommended'|'near'|'cheap'|'brand'|'fast' }) {
    const all = await this.settings!.all();
    const kind = performerKindFor(p.service);
    const list = await this.db.query<Candidate & { name: string | null; tier: string; call_out_price: number | null; created_at: Date; jobs: number; busy: boolean }>(
      `select p.user_id, p.kind, p.specialties, p.brands, p.is_priority, p.paused, p.line_status, p.verification, p.tier, p.call_out_price,
              p.lat, p.lng, u.rating, p.accepts_group, u.status as user_status, p.schedule, p.off_schedule_until, p.extras, u.name, p.prep_minutes,
              (select count(*)::int from orders o where o.performer_id=p.user_id and o.status='completed') as jobs,
              exists (select 1 from orders x where x.performer_id=p.user_id
                and x.status in ('accepted','en_route','arrived','working','awaiting_confirmation')
                and not (x.status='awaiting_confirmation' and (
                  x.service='consult' or exists(
                    select 1 from order_unilateral_closures uc
                     where uc.order_id=x.id and uc.status in ('pending_client','disputed')
                  )))) as busy,
              0 as cash_debt
         from performer_profiles p join users u on u.id=p.user_id
        where p.kind=$1 and p.user_id<>$2 and u.status='active' and ($3::boolean = false or p.verification='approved') and p.line_status in ('online','on_call','on_job')`, [kind, user.id, !!p.verifiedOnly]);
    // Never present nationwide performers as if they were near the truck.
    // All three counters and shown cards must cover the SAME proven geography.
    const locationKnown=validPoint(p.lat,p.lng);
    const inScope=locationKnown
      ? list.filter(c=>validPoint(c.lat,c.lng)&&
          haversineKm({lat:p.lat!,lng:p.lng!},{lat:c.lat!,lng:c.lng!})<=all.dispatch.radiusKm)
      : list;
    // With no verified search GPS, rank on a network-wide basis. Invalid 0/0
    // must not become a fictitious coordinate that hides all partners.
    const order = { service: p.service, brand: p.brand ?? null,
      lat: locationKnown ? p.lat! : null, lng: locationKnown ? p.lng! : null, group_trip: false };
    // Distinguish presence from genuine availability. Paused/vacation workers
    // must never inflate the number of colleagues who can take an assignment.
    const online=inScope.filter(c=>!c.paused&&!c.extras?.vacation);
    const now=this.now();
    const free=online.filter(c=>{
      if(c.busy||c.line_status==='on_job')return false;
      if(kind==='master'&&p.service!=='consult'&&!c.specialties.includes(p.service))
        return false;
      const available=slot(c.schedule,now,c.off_schedule_until);
      return available==='work'||(available==='phone'&&p.service==='consult');
    });
    // Preview all eligible candidates first: sorting after an arbitrary 8/20-person
    // cutoff can hide the actually cheapest/closest specialist.
    const ranked = rankCandidates(order as any, free, {
      radiusKm: all.dispatch.radiusKm, maxCandidates: free.length,
      cashDebtLimit: Number.MAX_SAFE_INTEGER, now: this.now()
    });
    const byId = new Map(free.map((c) => [c.user_id, c]));
    const speed = all.dispatch.citySpeedKmh || 40;
    const LEVEL: Record<string, number> = { excellent: 3, good: 2, last_resort: 1 };
    const items = ranked.map((r) => {
      const c = byId.get(r.user_id)!;
      const tierPrice = (all.pricing.tiers as any)[c.tier]?.callOut ?? null;
      return {
        name: (c.name ?? 'Мастер').split(/[\s(]/)[0], tier: c.tier, verification: c.verification, rating: c.rating == null ? null : Number(c.rating), jobs: (c as any).jobs,
        distanceKm: r.distanceKm, etaMin: r.distanceKm == null ? null : Math.max(10, Math.round((r.distanceKm * 1.3) / speed * 60) + ((c as any).prep_minutes ?? 0)),
        brandStars: p.brand ? LEVEL[(c.brands as any)?.[p.brand] ?? 'good'] ?? 2 : null,
        callOut: c.call_out_price ?? tierPrice,
      };
    });
    const sortBy=p.sortBy??'recommended';
    items.sort((a,b)=>{
      const verified=Number(b.verification==='approved')-Number(a.verification==='approved');
      const near=(a.distanceKm??1e9)-(b.distanceKm??1e9);
      const primary=sortBy==='cheap'?(a.callOut??1e12)-(b.callOut??1e12)
        :sortBy==='brand'?(b.brandStars??0)-(a.brandStars??0)||near
        :sortBy==='fast'?(a.etaMin??1e9)-(b.etaMin??1e9)
        :sortBy==='near'?near:verified||near;
      return primary||(sortBy==='recommended'?near:verified||near);
    });
    return { scope:locationKnown?'nearby':'network', radiusKm:locationKnown?all.dispatch.radiusKm:null,
      online: online.length, free: free.length, match: ranked.length, items:items.slice(0,8) };
  }
}
