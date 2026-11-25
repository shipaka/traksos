// Порядок, в котором заявка «звонит» исполнителям:
// 1) приоритетные (вы с отцом), если не на паузе и марка не «не берусь»;
// 2) по уровню марки: отлично → хорошо → в крайнем случае;
// 3) внутри уровня — ближе, потом выше рейтинг.

import { haversineKm } from './geo.ts';
import { slot, type Schedule } from './schedule.ts';

export type BrandLevel = 'excellent' | 'good' | 'last_resort' | 'refuse';

export interface Candidate {
  user_id: string;
  kind: string;
  specialties: string[];
  brands: Record<string, BrandLevel>;
  is_priority: boolean;
  paused: boolean;
  line_status: string;
  verification: string;
  lat: number | null;
  lng: number | null;
  prep_minutes?: number | null;
  rating: number | string | null;
  accepts_group: boolean;
  user_status: string;
  cash_debt?: number;
  schedule?: Schedule | null;
  /** Отпуск, что берёт эвакуатор и т. п. */
  extras?: { vacation?: boolean; takes?: string[] } | null;
  off_schedule_until?: string | Date | null;
}

export interface DispatchOrder {
  service: string;
  brand: string | null;
  lat: number | null;
  lng: number | null;
  group_trip: boolean;
  verified_only?: boolean;
  cargo?: string | null;
}

const brandRank: Record<BrandLevel, number> = { excellent: 0, good: 1, last_resort: 2, refuse: 99 };

function ownBrandLevel(brands: Candidate['brands'], brand: string | null): BrandLevel {
  const level = brand && brands && Object.hasOwn(brands, brand) ? brands[brand] : undefined;
  return typeof level==='string' && Object.hasOwn(brandRank,level) ? level : 'good';
}
function knownPosition(lat: number|null, lng: number|null): boolean {
  return typeof lat==='number' && typeof lng==='number' && Number.isFinite(lat) && Number.isFinite(lng) &&
    Math.abs(lat)<=90 && Math.abs(lng)<=180 && !(lat===0 && lng===0);
}

export function performerKindFor(service: string) {
  if (service === 'tow') return 'tow';
  if (service === 'ecu') return 'ecu';
  return 'master';
}

export interface RankOptions {
  radiusKm: number;
  maxCandidates: number;
  cashDebtLimit: number;
  exclude?: Set<string>;
  /** Текущее время — для распорядка исполнителей */
  now?: Date;
}

export interface Ranked {
  user_id: string;
  distanceKm: number | null;
  reason: string;
}

export function rankCandidates(order: DispatchOrder, list: Candidate[], o: RankOptions): Ranked[] {
  const kind = performerKindFor(order.service);
  const now = o.now ?? new Date();
  const orderLocated=knownPosition(order.lat,order.lng);
  const rows = list
    .filter((c) => c.kind === kind && c.user_status === 'active' && !c.paused)
    // Owner/driver preference persists on the order and applies to EVERY dispatch stage.
    .filter((c) => !order.verified_only || c.verification === 'approved')
    .filter((c) => kind !== 'master' || order.service === 'consult' || (Array.isArray(c.specialties) && c.specialties.includes(order.service)))
    .filter((c) => c.line_status === 'online' || c.line_status === 'on_call')
    // Распорядок: вне рабочего времени не звоним; в часы «на телефоне» — только консультации
    .filter((c) => { const s = slot(c.schedule, now, c.off_schedule_until); return s === 'work' || (s === 'phone' && order.service === 'consult'); })
    .filter((c) => !o.exclude?.has(c.user_id))
    // В отпуске — не звоним; эвакуатор не берёт такой груз — не звоним
    .filter((c) => !c.extras?.vacation)
    .filter((c) => kind !== 'tow' || !order.cargo || !c.extras?.takes?.length || (Array.isArray(c.extras.takes) && c.extras.takes.includes(order.cargo)))
    .filter((c) => !order.group_trip || c.accepts_group)
    .filter((c) => (c.cash_debt ?? 0) <= o.cashDebtLimit)
    .map((c) => {
      const level = ownBrandLevel(c.brands,order.brand);
      const distanceKm =
        orderLocated && knownPosition(c.lat,c.lng)
          ? haversineKm({ lat: order.lat!, lng: order.lng! }, { lat: c.lat!, lng: c.lng! })
          : null;
      const rating=Number(c.rating ?? 0);
      return { c, level, distanceKm, rating: Number.isFinite(rating) ? rating : 0 };
    })
    .filter((r) => r.level !== 'refuse')
    .filter((r) => r.distanceKm === null || r.distanceKm <= o.radiusKm);

  rows.sort((a, b) =>
    Number(b.c.is_priority) - Number(a.c.is_priority) ||
    brandRank[a.level] - brandRank[b.level] ||
    // A verified badge improves ranking, but not eligibility for work.
    Number(b.c.verification === 'approved') - Number(a.c.verification === 'approved') ||
    // «на звонке» — виден, но ниже в очереди
    Number(a.c.line_status === 'on_call') - Number(b.c.line_status === 'on_call') ||
    (a.distanceKm ?? 1e6) - (b.distanceKm ?? 1e6) ||
    b.rating - a.rating,
  );

  return rows.slice(0, o.maxCandidates).map((r) => ({
    user_id: r.c.user_id,
    distanceKm: r.distanceKm == null ? null : Math.round(r.distanceKm * 10) / 10,
    reason: r.c.is_priority ? 'priority' : r.level,
  }));
}
