// Распорядок исполнителя. По нему решается, звонить ли ему сейчас:
//   выезды (from–to) — все заявки; «на телефоне» (to–phoneTo) — только консультации; остальное и выходные — ничего.
// Вышел на линию вручную вне графика — график не мешает до конца дня (offScheduleUntil).

export type Day = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export interface Schedule {
  on: boolean;
  days: Record<Day, boolean>;
  from: string; // 'HH:MM' — начало выездов
  to: string; // конец выездов
  phoneTo: string; // до скольких отвечает на консультации (>= to)
}
export type Slot = 'work' | 'phone' | 'off';

export const DAYS: Day[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const defaultSchedule: Schedule = {
  on: false,
  days: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false },
  from: '09:00', to: '18:00', phoneTo: '20:00',
};

const validTime = (t: unknown): t is string => typeof t==='string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };

/** День недели и минуты от полуночи по Москве */
export function moscowNow(now: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const day = get('weekday').toLowerCase().slice(0, 3) as Day;
  return { day, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

export function slot(s: Schedule | null | undefined, now: Date, offScheduleUntil?: Date | string | null): Slot {
  if (!Number.isFinite(now.getTime())) return 'off';
  if (!s || s.on===false) return 'work';
  if (s.on!==true) return 'off';
  if (offScheduleUntil && new Date(offScheduleUntil) > now) return 'work';
  // Historical or malformed JSON must not crash dispatch for everyone.
  // Preserve the legacy missing phoneTo fallback but reject invalid hours.
  const phoneEnd=s.phoneTo ?? s.to;
  if (!s.days || !validTime(s.from) || !validTime(s.to) || !validTime(phoneEnd) ||
      toMin(s.from)>=toMin(s.to) || toMin(phoneEnd)<toMin(s.to)) return 'off';
  const { day, minutes } = moscowNow(now);
  if (s.days[day]!==true) return 'off';
  const from = toMin(s.from), to = toMin(s.to), phoneTo = toMin(phoneEnd);
  if (minutes >= from && minutes < to) return 'work';
  if (minutes >= to && minutes < phoneTo) return 'phone';
  return 'off';
}

/** Конец текущих суток по Москве — до этого момента действует ручной выход на линию вне графика */
export function endOfMoscowDay(now: Date) {
  const { minutes } = moscowNow(now);
  return new Date(now.getTime() + (24 * 60 - minutes) * 60_000 - now.getUTCSeconds() * 1000 - now.getUTCMilliseconds());
}

export function validSchedule(s: Schedule) {
  const re = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (![s.from, s.to, s.phoneTo].every((t) => re.test(t))) return 'Время — в формате ЧЧ:ММ';
  if (toMin(s.from) >= toMin(s.to)) return 'Конец выездов должен быть позже начала';
  if (toMin(s.phoneTo) < toMin(s.to)) return '«На телефоне до» — не раньше конца выездов';
  return null;
}
