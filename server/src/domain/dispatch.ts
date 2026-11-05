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
  cargo?: string | null;
}

const brandRank: Record<BrandLevel, number> = { excellent: 0, good: 1, last_resort: 2, refuse: 99 };

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
  const rows = list
    .filter((c) => c.kind === kind && c.user_status === 'active' && c.verification === 'approved' && !c.paused)
    .filter((c) => kind !== 'master' || order.service === 'consult' || c.specialties.includes(order.service))
    .filter((c) => c.line_status === 'online' || c.line_status === 'on_call')
    // Распорядок: вне рабочего времени не звоним; в часы «на телефоне» — только консультации
    .filter((c) => { const s = slot(c.schedule, o.now ?? new Date(), c.off_schedule_until); return s === 'work' || (s === 'phone' && order.service === 'consult'); })
    .filter((c) => !o.exclude?.has(c.user_id))
    // В отпуске — не звоним; эвакуатор не берёт такой груз — не звоним
    .filter((c) => !c.extras?.vacation)
    .filter((c) => kind !== 'tow' || !order.cargo || !c.extras?.takes?.length || c.extras.takes.includes(order.cargo))
    .filter((c) => !order.group_trip || c.accepts_group)
    .filter((c) => (c.cash_debt ?? 0) <= o.cashDebtLimit)
    .map((c) => {
      const level: BrandLevel = order.brand ? c.brands?.[order.brand] ?? 'good' : 'good';
      const distanceKm =
        order.lat != null && order.lng != null && c.lat != null && c.lng != null
          ? haversineKm({ lat: order.lat, lng: order.lng }, { lat: c.lat, lng: c.lng })
          : null;
      return { c, level, distanceKm, rating: c.rating == null ? 0 : Number(c.rating) };
    })
    .filter((r) => r.level !== 'refuse')
    .filter((r) => r.distanceKm === null || r.distanceKm <= o.radiusKm);

  rows.sort((a, b) =>
    Number(b.c.is_priority) - Number(a.c.is_priority) ||
    brandRank[a.level] - brandRank[b.level] ||
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
