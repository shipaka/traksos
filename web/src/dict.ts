// Тексты и справочники, общие для экранов.

export const SERVICES: Record<string, { name: string; hint: string }> = {
  electric: { name: 'Электрик', hint: 'Свет, розетки, проводка, не заводится' },
  diag: { name: 'Диагност', hint: 'Ошибки ЭБУ, аварийный режим, сканер' },
  air: { name: 'Воздушник', hint: 'Пневма, тормоза, ABS/EBS' },
  autonomy: { name: 'Автономщик', hint: 'Автономка, печка, отопитель' },
  tyre: { name: 'Шиномонтаж', hint: 'Выездной, колесо, прокол' },
  tow: { name: 'Эвакуатор', hint: 'Не на ходу, ДТП' },
  consult: { name: 'Консультация', hint: 'Звонок и чат с мастером' },
};

export const SOS_PROBLEMS: { id: string; name: string; service: string; hint: string }[] = [
  { id: 'no_start', name: 'Не заводится', service: 'electric', hint: 'Электрик — чаще всего АКБ, масса, стартер' },
  { id: 'light', name: 'Свет, розетка, проводка', service: 'electric', hint: 'Электрик чинит на месте за час-два' },
  { id: 'error', name: 'Ошибка, аварийный режим', service: 'diag', hint: 'Диагност со сканером под вашу машину' },
  { id: 'air', name: 'Воздух, тормоза', service: 'air', hint: 'Воздушник: пневма, ABS/EBS' },
  { id: 'heater', name: 'Автономка, печка', service: 'autonomy', hint: 'Автономщик' },
  { id: 'wheel', name: 'Колесо', service: 'tyre', hint: 'Выездной шиномонтаж' },
  { id: 'accident', name: 'Не на ходу, ДТП', service: 'tow', hint: 'Эвакуатор' },
  { id: 'other', name: 'Другое', service: 'consult', hint: 'Консультация — мастер подскажет, кого звать' },
];

export const BRANDS = ['Scania', 'DAF', 'Volvo', 'MAN', 'Mercedes-Benz', 'Renault', 'Iveco', 'КАМАЗ', 'Shacman', 'Sitrak', 'FAW', 'Howo', 'Прочие'];

const BRAND_ALIASES: Record<string, string> = {
  скания: 'Scania', скан: 'Scania', даф: 'DAF', вольво: 'Volvo', ман: 'MAN', мерс: 'Mercedes-Benz', мерседес: 'Mercedes-Benz',
  рено: 'Renault', ивеко: 'Iveco', камаз: 'КАМАЗ', шакман: 'Shacman', ситрак: 'Sitrak', фав: 'FAW', хово: 'Howo',
};
export function matchBrand(input: string) {
  const s = input.trim().toLowerCase();
  if (!s) return [];
  const alias = Object.entries(BRAND_ALIASES).filter(([k]) => k.startsWith(s)).map(([, v]) => v);
  const direct = BRANDS.filter((b) => b.toLowerCase().startsWith(s));
  return [...new Set([...alias, ...direct])];
}

export const BRAND_LEVELS: { id: string; name: string }[] = [
  { id: 'excellent', name: 'Отлично' },
  { id: 'good', name: 'Хорошо' },
  { id: 'last_resort', name: 'В крайнем' },
  { id: 'refuse', name: 'Не берусь' },
];

export const TIERS: Record<string, { name: string; hint: string }> = {
  eco: { name: 'Эконом', hint: 'Ближайший свободный мастер' },
  comfort: { name: 'Комфорт', hint: 'Рейтинг от 4,8, знает вашу марку' },
  pro: { name: 'Профи', hint: 'Диагност с оборудованием' },
};

export const STATUS: Record<string, { name: string; tone: 'good' | 'warn' | 'bad' | 'accent' | '' }> = {
  searching: { name: 'Ищем исполнителя', tone: 'accent' },
  accepted: { name: 'Принял заявку', tone: 'good' },
  en_route: { name: 'В пути', tone: 'good' },
  arrived: { name: 'На месте', tone: 'good' },
  working: { name: 'Работает', tone: 'good' },
  awaiting_confirmation: { name: 'Подтвердите сумму', tone: 'warn' },
  completed: { name: 'Готово', tone: '' },
  cancelled: { name: 'Отменена', tone: 'bad' },
  no_performer: { name: 'Никто не взял', tone: 'bad' },
};

export const STEPS = ['searching', 'accepted', 'en_route', 'arrived', 'working', 'awaiting_confirmation', 'completed'];
export const STEP_NAMES: Record<string, string> = {
  searching: 'Ищем исполнителя', accepted: 'Принял заявку', en_route: 'В пути', arrived: 'На месте',
  working: 'Работа', awaiting_confirmation: 'Сумма', completed: 'Готово',
};

export const RESULTS: Record<string, string> = {
  solved: 'Решено',
  cause_found: 'Причина найдена, на месте не исправить',
  not_found: 'Причина не найдена',
};

export const LINE: Record<string, string> = {
  online: 'Свободен', on_call: 'На звонке', on_job: 'На выезде', busy: 'Занят', offline: 'Не на линии',
};
