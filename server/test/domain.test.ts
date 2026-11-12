import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings as S } from '../src/domain/defaults.ts';
import { estimate, trip, isNight } from '../src/domain/pricing.ts';
import { authorWeight, weightedRating } from '../src/domain/rating.ts';
import { transition, TransitionError } from '../src/domain/orderState.ts';
import { rankCandidates, type Candidate } from '../src/domain/dispatch.ts';
import { split, cancelSplit, cancelStage } from '../src/domain/money.ts';

const rub = (k: number) => k / 100;

test('цена по расстоянию совпадает с демо', () => {
  // Усть-Луга, 160 км: 240 км × 50 ₽ + выезд 1 500 ₽ = 13 500 ₽
  assert.equal(rub(trip(S.pricing, { base: 150_000, km: 160, rate: 5_000, night: false }).total), 13_500);
  // Эвакуатор, Кириши 150 км: 30 000 + 225 × 110 = 54 750 ₽, ночью ×1,5 → 82 150 ₽
  assert.equal(rub(trip(S.pricing, { base: 3_000_000, km: 150, rate: 11_000, night: false }).total), 54_750);
  assert.equal(rub(trip(S.pricing, { base: 3_000_000, km: 150, rate: 11_000, night: true }).total), 82_150);
});

test('по городу — только выезд; совместный выезд за 30 км — 70%', () => {
  const city = estimate(S.pricing, { service: 'electric', tier: 'eco', zoneId: 'spb', night: false, group: false });
  assert.equal(rub(city.callOut), 1_500);
  assert.equal(rub(city.hour!), 1_500);
  const tosno = estimate(S.pricing, { service: 'electric', tier: 'eco', zoneId: 'tos', night: false, group: true });
  // 1 500 + 83 км × 50 = 5 650 → ×0,7 = 3 955 → 3 950
  assert.equal(rub(tosno.callOut), 3_950);
  const near = estimate(S.pricing, { service: 'electric', tier: 'eco', zoneId: 'kad30', night: false, group: true });
  assert.equal(near.group, false, 'до 30 км совместного выезда нет');
});

test('ночь по Москве', () => {
  assert.equal(isNight(S.pricing, new Date('2026-12-01T20:30:00Z')), true); // 23:30 МСК
  assert.equal(isNight(S.pricing, new Date('2026-12-01T09:00:00Z')), false); // 12:00 МСК
});

test('вес отзыва: 4,8 → 0,9; 3,8 → 0,4; новичок → 0,3', () => {
  assert.equal(authorWeight(S.reviews, 4.8, 10), 0.9);
  assert.equal(authorWeight(S.reviews, 3.8, 10), 0.4);
  assert.equal(authorWeight(S.reviews, 4.9, 2), 0.3);
  assert.equal(authorWeight(S.reviews, 2.5, 10), 0.1);
  const r = weightedRating([
    { stars: 5, weight: 0.9 },
    { stars: 5, weight: 0.9 },
    { stars: 1, weight: 0.4 },
    { stars: 1, weight: 1, disputed: true },
  ]);
  assert.equal(r.count, 3);
  assert.equal(r.rating, 4.27);
});

test('статусы: нельзя перепрыгнуть и нельзя чужой ролью', () => {
  assert.equal(transition('searching', 'accept', 'performer'), 'accepted');
  assert.equal(transition('arrived', 'propose_amount', 'performer'), 'awaiting_confirmation');
  assert.equal(transition('awaiting_confirmation', 'confirm_amount', 'client'), 'completed');
  assert.throws(() => transition('searching', 'arrive', 'performer'), TransitionError);
  assert.throws(() => transition('awaiting_confirmation', 'confirm_amount', 'performer'), TransitionError);
});

const cand = (id: string, over: Partial<Candidate> = {}): Candidate => ({
  user_id: id, kind: 'master', specialties: ['electric'], brands: {}, is_priority: false, paused: false,
  line_status: 'online', verification: 'approved', lat: 59.93, lng: 30.31, rating: '4.5', accepts_group: true,
  user_status: 'active', ...over,
});

test('подбор: приоритетные → марка → расстояние → рейтинг', () => {
  const order = { service: 'electric', brand: 'Scania', lat: 59.93, lng: 30.31, group_trip: false };
  const list = [
    cand('far-excellent', { brands: { Scania: 'excellent' }, lat: 60.1 }),
    cand('near-good', { brands: { Scania: 'good' } }),
    cand('near-excellent', { brands: { Scania: 'excellent' } }),
    cand('father', { is_priority: true, lat: 60.3 }),
    cand('refuses', { brands: { Scania: 'refuse' } }),
    cand('offline', { line_status: 'offline' }),
    cand('not-verified', { verification: 'pending' }),
    cand('tow', { kind: 'tow' }),
    cand('debtor', { cash_debt: 999_999 }),
  ];
  const r = rankCandidates(order, list, { radiusKm: 220, maxCandidates: 10, cashDebtLimit: 300_000 });
  assert.deepEqual(r.map((x) => x.user_id), ['father', 'near-excellent', 'far-excellent', 'near-good']);
});

test('мастер с собственной СТО получает выездные заявки только по выбранным специализациям', () => {
  const specialist = cand('master-with-service', { specialties: ['electric', 'diag'] });
  const opts = { radiusKm: 220, maxCandidates: 10, cashDebtLimit: 300_000 };
  const order = (service: string) => ({ service, brand: 'Scania', lat: 59.93, lng: 30.31, group_trip: false });
  assert.deepEqual(rankCandidates(order('electric'), [specialist], opts).map(x => x.user_id), ['master-with-service']);
  assert.deepEqual(rankCandidates(order('diag'), [specialist], opts).map(x => x.user_id), ['master-with-service']);
  assert.deepEqual(rankCandidates(order('air'), [specialist], opts), [], 'не указанная выездная услуга недоступна');
  assert.deepEqual(rankCandidates(order('engine'), [specialist], opts), [], 'ремонт двигателя на СТО не делает его выездной услугой');
  assert.deepEqual(rankCandidates(order('gearbox'), [specialist], opts), [], 'КПП нельзя автоматически предлагать на парковке');
});

test('агентская схема: деньги и шкала отмены как в смете', () => {
  // Стандарт, 1 ч 24 мин: 1 500 + 2 100 = 3 600 ₽
  const s = split(S.fees, 360_000, { isPriority: false });
  assert.equal(rub(s.total), 3_780);
  assert.equal(rub(s.toPerformer), 3_420);
  assert.equal(rub(s.toPlatform), 360);
  assert.equal(split(S.fees, 360_000, { isPriority: true }).commission, 0);

  // Выезд 1 500 ₽ + сбор 75 ₽
  const at = (stage: any) => cancelSplit(S.cancel.scale, stage, 150_000, 7_500);
  assert.equal(rub(at('searching').refund), 1_575);
  assert.equal(rub(at('accepted').refund), 1_181.25);
  assert.equal(rub(at('en_route_first_half').refund), 787.5);
  assert.equal(rub(at('arrived').refund), 0);
  assert.equal(rub(at('performer_fault').refund), 1_575);
  assert.equal(cancelStage('en_route', { startKm: 20, leftKm: 8 }), 'en_route_second_half');
  assert.equal(cancelStage('accepted', { byPerformer: true }), 'performer_fault');
});

test('эвакуатор: «что беру» фильтрует по грузу; отпуск — не звоним', () => {
  const order = { service: 'tow', brand: null, lat: 59.93, lng: 30.31, group_trip: false, cargo: 'bus' };
  const list = [
    cand('any', { kind: 'tow' }),
    cand('bus', { kind: 'tow', extras: { takes: ['bus', 'tractor'] } } as any),
    cand('small', { kind: 'tow', extras: { takes: ['truck12'] } } as any),
    cand('rest', { kind: 'tow', extras: { vacation: true } } as any),
  ];
  const r = rankCandidates(order, list, { radiusKm: 220, maxCandidates: 10, cashDebtLimit: 300_000 });
  assert.deepEqual(r.map((x) => x.user_id).sort(), ['any', 'bus']);
});
