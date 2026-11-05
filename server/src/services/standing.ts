// Исполнитель: уровень (Новичок / Проверенный / Лучший), точность подсказок по телефону, что происходит рядом.

import type { Db } from '../db/index.ts';
import type { AuthUser } from '../http/router.ts';
import { haversineKm } from '../domain/geo.ts';
import { performerKindFor } from '../domain/dispatch.ts';

export const LEVEL = { newbieJobs: 10, bestJobs: 50, bestRating: 4.7, minHintCases: 20, windowDays: 90 };
const SCORE: Record<string, number> = { yes: 1, part: 0.5, no: 0 };

export class StandingService {
  constructor(private db: Db, private now: () => Date) {}

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
}
