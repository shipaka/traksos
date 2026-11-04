// Отклики на торгах и сортировка «Рекомендуем».
// Цена отклика — от пола до потолка относительно обычной цены зоны (85–130%), до дна не падает.
// В «Рекомендуем» цена весит 15%, рейтинг 35% — дешёвый новичок не обгонит проверенного мастера.

import { roundTo } from './pricing.ts';
import type { BrandLevel } from './dispatch.ts';

export interface OfferLimits { usual: number; floor: number; ceil: number }

export function offerLimits(usual: number, floorK: number, ceilK: number): OfferLimits {
  return { usual, floor: roundTo(usual * floorK, 5_000), ceil: roundTo(usual * ceilK, 5_000) };
}

export interface OfferRow {
  id: string;
  price: number;
  eta_minutes: number;
  rating: number | null;
  rating_count: number;
  completed: number;
  brand_level: BrandLevel | null;
  distance_km: number | null;
}

export type Sort = 'recommended' | 'price' | 'eta' | 'distance' | 'rating';

export function score(o: OfferRow, lim: OfferLimits, w: { rating: number; brand: number; eta: number; price: number; experience: number }) {
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  // новичок без оценок — чуть ниже среднего, но не на дне
  const rating = o.rating == null || o.rating_count < 3 ? 0.45 : clamp((o.rating - 3) / 2);
  const brand = o.brand_level === 'excellent' ? 1 : o.brand_level === 'last_resort' ? 0.2 : 0.6;
  const eta = 1 - clamp(o.eta_minutes / 120);
  const price = lim.ceil === lim.floor ? 0.5 : clamp((lim.ceil - o.price) / (lim.ceil - lim.floor));
  const experience = clamp(o.completed / 50);
  return w.rating * rating + w.brand * brand + w.eta * eta + w.price * price + w.experience * experience;
}

export function sortOffers<T extends OfferRow>(rows: T[], sort: Sort, lim: OfferLimits, w: Parameters<typeof score>[2]) {
  const withScore = rows.map((r) => ({ ...r, score: Math.round(score(r, lim, w) * 1000) / 1000 }));
  const by: Record<Sort, (a: typeof withScore[0], b: typeof withScore[0]) => number> = {
    recommended: (a, b) => b.score - a.score,
    price: (a, b) => a.price - b.price || b.score - a.score,
    eta: (a, b) => a.eta_minutes - b.eta_minutes || b.score - a.score,
    distance: (a, b) => (a.distance_km ?? 1e6) - (b.distance_km ?? 1e6) || b.score - a.score,
    rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.rating_count - a.rating_count,
  };
  return withScore.sort(by[sort]);
}

/** Подача: сборы + дорога по средней скорости */
export function etaMinutes(distanceKm: number | null, prepMinutes: number, speedKmh: number) {
  const road = distanceKm == null ? 30 : Math.round((distanceKm / speedKmh) * 60);
  return prepMinutes + Math.max(5, road);
}
