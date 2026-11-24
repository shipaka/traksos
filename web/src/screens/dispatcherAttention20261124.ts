// Pure event-based operational hints for the admin dispatch board.
// No account details, GPS precision, payments, or unverified route ETA.
export type LiveOrderEvent = { type: string; at: string };
export type LiveOrder = {
  id: string; number: number; service: string; status: string; is_sos: boolean;
  created_at: string; accepted_at?: string | null; arrived_at?: string | null;
  case_root_id?: string | null; address?: string | null; zone?: string | null;
  client_name?: string | null; performer_name?: string | null; events: LiveOrderEvent[];
};

export function ageMinutes(date: string | null | undefined, now: number): number {
  if (!date) return 0;
  const value = new Date(date).getTime();
  return Number.isFinite(value) ? Math.max(0, Math.floor((now - value) / 60000)) : 0;
}

export function latestEventAt(o: LiveOrder, types?: readonly string[]): string | null {
  const matching = (o.events ?? []).filter(e => !types || types.includes(e.type))
    .map(e => new Date(e.at).getTime())
    .filter(ms => Number.isFinite(ms));
  return matching.length ? new Date(Math.max(...matching)).toISOString() : null;
}

// The live endpoint returns the FIVE most recent events but does not return
// accepted_at/arrived_at. No stage anchor => no claim of a delayed stage:
// the case can still be investigated manually in its full immutable journal.
export function attention(o: LiveOrder, now: number): string | null {
  const last = latestEventAt(o);
  const searchSince = latestEventAt(o, ['dispatch_started', 'retry', 'performer_dropped']);
  if (o.status === 'searching' &&
      ageMinutes(searchSince ?? o.created_at, now) >= (o.is_sos ? 3 : 10))
    return 'Долго ищем исполнителя';
  const approval = latestEventAt(o, ['owner_approval_requested']);
  if (o.status === 'awaiting_owner' && approval && ageMinutes(approval, now) >= 10)
    return 'Ожидается решение владельца';
  const accepted = o.accepted_at ?? latestEventAt(o, ['accepted']);
  if (o.status === 'accepted' && accepted && ageMinutes(accepted, now) >= 10)
    return 'Нет отметки выезда';
  if (o.status === 'en_route' && last && ageMinutes(last, now) >= 40)
    return 'Давно нет событий в пути — проверьте ETA';
  const arrived = o.arrived_at ?? latestEventAt(o, ['arrive']);
  if (o.status === 'arrived' && arrived && ageMinutes(arrived, now) >= 30)
    return 'Давно на месте — уточнить ход работ';
  if (o.status === 'working' && last && ageMinutes(last, now) >= 90)
    return 'Давно нет обновлений о работе';
  if (o.status === 'awaiting_confirmation' && last && ageMinutes(last, now) >= 25)
    return 'Ожидается подтверждение';
  return null;
}
