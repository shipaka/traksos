// Исполнитель: уровень (Новичок / Проверенный / Лучший), точность подсказок по телефону, что происходит рядом.

import type { Db } from '../db/index.ts';
import type { AuthUser } from '../http/router.ts';
import { haversineKm } from '../domain/geo.ts';
import { performerKindFor, rankCandidates, type Candidate } from '../domain/dispatch.ts';
import type { SettingsService } from './settings.ts';

export const LEVEL = { newbieJobs: 10, bestJobs: 50, bestRating: 4.7, minHintCases: 20, windowDays: 90 };
const SCORE: Record<string, number> = { yes: 1, part: 0.5, no: 0 };

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
    const p = await this.db.one<any>('select kind, specialties, lat, lng from performer_profiles where user_id=$1', [user.id]);
    if (!p) return null;
    const open = await this.db.query<{ service: string; lat: number | null; lng: number | null }>(
      `select service, lat, lng from orders where status='searching' and created_by<>$1`, [user.id]);
    const mineKind = open.filter((o) => performerKindFor(o.service) === p.kind && (p.kind !== 'master' || o.service === 'consult' || (p.specialties ?? []).includes(o.service)));
    const near = mineKind.filter((o) => o.lat == null || p.lat == null || haversineKm({ lat: p.lat, lng: p.lng }, { lat: o.lat!, lng: o.lng! }) <= 50);
    // «Перед вами»: свободные коллеги того же вида, которые к этим заявкам ближе вас
    const others = await this.db.query<{ lat: number | null; lng: number | null }>(
      `select lat, lng from performer_profiles where kind=$1 and user_id<>$2 and verification='approved' and line_status='online' and lat is not null`, [p.kind, user.id]);
    let ahead = 0;
    if (p.lat != null) {
      for (const c of others) {
        if (near.some((o) => o.lat != null && haversineKm({ lat: c.lat!, lng: c.lng! }, { lat: o.lat, lng: o.lng! }) < haversineKm({ lat: p.lat, lng: p.lng }, { lat: o.lat, lng: o.lng! }))) ahead++;
      }
    }
    return { openNearby: near.length, ahead };
  }

  /** Клиенту до вызова: сколько мастеров на линии, сколько свободны и подходят, и кто ближе всего — без контактов */
  async mastersNearby(user: AuthUser, p: { service: string; lat?: number; lng?: number; brand?: string }) {
    const all = await this.settings!.all();
    const kind = performerKindFor(p.service);
    const list = await this.db.query<Candidate & { name: string | null; tier: string; call_out_price: number | null; created_at: Date; jobs: number; busy: boolean }>(
      `select p.user_id, p.kind, p.specialties, p.brands, p.is_priority, p.paused, p.line_status, p.verification, p.tier, p.call_out_price,
              p.lat, p.lng, u.rating, p.accepts_group, u.status as user_status, p.schedule, p.off_schedule_until, p.extras, u.name, p.prep_minutes,
              (select count(*)::int from orders o where o.performer_id=p.user_id and o.status='completed') as jobs,
              exists (select 1 from orders x where x.performer_id=p.user_id and x.status in ('accepted','en_route','arrived','working')) as busy,
              0 as cash_debt
         from performer_profiles p join users u on u.id=p.user_id
        where p.kind=$1 and p.user_id<>$2 and p.verification='approved' and p.line_status in ('online','on_call','on_job')`, [kind, user.id]);
    const order = { service: p.service, brand: p.brand ?? null, lat: p.lat ?? null, lng: p.lng ?? null, group_trip: false };
    const free = list.filter((c) => !c.busy && c.line_status !== 'on_job');
    const ranked = rankCandidates(order as any, free, { radiusKm: all.dispatch.radiusKm, maxCandidates: 20, cashDebtLimit: Number.MAX_SAFE_INTEGER, now: this.now() });
    const byId = new Map(free.map((c) => [c.user_id, c]));
    const speed = all.dispatch.citySpeedKmh || 40;
    const LEVEL: Record<string, number> = { excellent: 3, good: 2, last_resort: 1 };
    const items = ranked.slice(0, 8).map((r) => {
      const c = byId.get(r.user_id)!;
      const tierPrice = (all.pricing.tiers as any)[c.tier]?.callOut ?? null;
      return {
        name: (c.name ?? 'Мастер').split(/[\s(]/)[0], tier: c.tier, rating: c.rating == null ? null : Number(c.rating), jobs: (c as any).jobs,
        distanceKm: r.distanceKm, etaMin: r.distanceKm == null ? null : Math.max(10, Math.round((r.distanceKm * 1.3) / speed * 60) + ((c as any).prep_minutes ?? 0)),
        brandStars: p.brand ? LEVEL[(c.brands as any)?.[p.brand] ?? 'good'] ?? 2 : null,
        callOut: c.call_out_price ?? tierPrice,
      };
    });
    return { online: list.length, free: free.length, match: ranked.length, items };
  }
}
