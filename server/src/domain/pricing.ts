// Цены по расстоянию — та же формула, что в демо:
// за КАД: км × 1,5 (туда и половина обратно) × ставка за км; ночью × 1,5; округление до 50 ₽;
// совместный выезд дальше 30 км — каждый платит 70%.

import type { Settings } from './defaults.ts';

export type Tier = 'eco' | 'comfort' | 'pro';

export interface TripInput {
  base: number; // копейки
  km: number;
  rate: number; // копейки за км
  night: boolean;
}

export function trip(p: Settings['pricing'], t: TripInput) {
  const roadKm = Math.round(t.km * p.roadFactor);
  const road = Math.round(t.km * p.roadFactor * t.rate);
  const sub = t.base + road;
  const total = roundTo(t.night ? sub * p.nightK : sub, p.roundTo);
  return { roadKm, road, total };
}

export function roundTo(v: number, step: number) {
  return Math.round(v / step) * step;
}

export interface EstimateInput {
  service: string;
  tier: Tier;
  zoneId: string;
  night: boolean;
  group: boolean;
  /** Индивидуальные цены конкретного исполнителя, если он уже известен */
  performer?: { callOut?: number | null; hour?: number | null; kmRate?: number | null };
}

export interface Estimate {
  zoneId: string;
  zoneName: string;
  km: number;
  roadKm: number;
  base: number;
  road: number;
  callOut: number; // выезд, который платит клиент (с учётом ночи и совместного)
  hour: number | null; // час работы, null для эвакуатора
  night: boolean;
  group: boolean;
  /** Консультация по телефону: фиксированная цена, без выезда */
  consult?: boolean;
}

export function estimate(p: Settings['pricing'], i: EstimateInput): Estimate {
  if (i.service === 'consult') {
    const price = p.consult?.price ?? 70_000;
    return { zoneId: 'phone', zoneName: 'По телефону', km: 0, roadKm: 0, base: price, road: 0, callOut: price, hour: null, night: false, group: false, consult: true };
  }
  const zone = p.zones.find((z) => z.id === i.zoneId);
  if (!zone) throw new Error(`Неизвестная зона: ${i.zoneId}`);
  const isTow = i.service === 'tow';
  const tier = p.tiers[i.tier] ?? p.tiers.eco;
  const base = isTow ? p.towBase : i.performer?.callOut ?? tier.callOut;
  const rate = isTow ? p.towKmRate : i.performer?.kmRate ?? p.kmRate;
  const r = trip(p, { base, km: zone.km, rate, night: i.night });
  const group = !isTow && i.group && zone.km >= p.groupMinKm;
  const callOut = group ? roundTo(r.total * p.groupShare, p.roundTo) : r.total;
  const hourBase = isTow ? null : i.performer?.hour ?? tier.hour;
  const hour = hourBase === null ? null : roundTo(i.night ? hourBase * p.nightK : hourBase, p.roundTo);
  return { zoneId: zone.id, zoneName: zone.name, km: zone.km, roadKm: r.roadKm, base, road: r.road, callOut, hour, night: i.night, group };
}

/** Ночь по московскому времени */
export function isNight(p: Settings['pricing'], at: Date = new Date()) {
  const h = Number(new Intl.DateTimeFormat('ru-RU', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Moscow' }).format(at));
  return h >= p.nightFromHour || h < p.nightToHour;
}

/** Цена за время работы: округляем вверх до 6 минут, как принято у мастеров */
export function workCost(hourPrice: number, minutes: number) {
  const units = Math.ceil(minutes / 6);
  return Math.round((hourPrice * units) / 10);
}
