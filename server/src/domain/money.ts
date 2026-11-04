// Деньги по агентской схеме. Все суммы — копейки.
//
// Клиент платит: сумма исполнителю + сервисный сбор (clientFeePct).
// Исполнитель получает: сумма − вознаграждение агента (performerCommissionPct).
// ТракSOS (агент) получает: сбор + вознаграждение. Налог ИП — только с этой части.

import type { Settings } from './defaults.ts';

export function pct(amount: number, p: number) {
  return Math.round((amount * p) / 100);
}

export interface CommissionCtx {
  isPriority: boolean;
  at?: Date;
}

export function commissionPct(fees: Settings['fees'], ctx: CommissionCtx) {
  if (ctx.isPriority) return fees.priorityCommissionPct;
  if (fees.freeUntil && (ctx.at ?? new Date()) <= new Date(fees.freeUntil + 'T23:59:59+03:00')) return 0;
  return fees.performerCommissionPct;
}

export function split(fees: Settings['fees'], amount: number, ctx: CommissionCtx) {
  const clientFee = pct(amount, fees.clientFeePct);
  const commission = pct(amount, commissionPct(fees, ctx));
  return {
    amount,
    clientFee,
    total: amount + clientFee,
    commission,
    toPerformer: amount - commission,
    toPlatform: clientFee + commission,
  };
}

// Шкала отмены: этап — по статусу и GPS, а не по часам.

export type CancelStage =
  | 'searching' | 'accepted' | 'en_route_first_half' | 'en_route_second_half' | 'arrived' | 'performer_fault';

export function cancelStage(
  status: string,
  opts: { byPerformer?: boolean; startKm?: number | null; leftKm?: number | null } = {},
): CancelStage {
  if (opts.byPerformer) return 'performer_fault';
  if (status === 'searching' || status === 'no_performer') return 'searching';
  if (status === 'accepted') return 'accepted';
  if (status === 'en_route') {
    if (opts.startKm && opts.leftKm != null && opts.startKm > 0) {
      return opts.leftKm <= opts.startKm / 2 ? 'en_route_second_half' : 'en_route_first_half';
    }
    return 'en_route_first_half';
  }
  return 'arrived';
}

/**
 * Сколько из оплаченного выезда уходит исполнителю, сколько остаётся площадке, сколько вернуть клиенту.
 * Сбор площадки остаётся в той же доле, что получил исполнитель.
 */
export function cancelSplit(scale: Record<string, number>, stage: CancelStage, callOut: number, clientFee: number) {
  const share = scale[stage] ?? 0;
  const toPerformer = Math.round(callOut * share);
  const platformKeeps = Math.round(clientFee * share);
  const refund = callOut + clientFee - toPerformer - platformKeeps;
  return { share, toPerformer, platformKeeps, refund };
}
