// Тексты и справочники, общие для экранов.

export const SERVICES: Record<string, { name: string; hint: string }> = {
  electric: { name: 'Электрик', hint: 'Свет, розетки, проводка, не заводится' },
  diag: { name: 'Диагност', hint: 'Ошибки ЭБУ, аварийный режим, сканер' },
  air: { name: 'Воздушник', hint: 'Пневма, тормоза, ABS/EBS' },
  autonomy: { name: 'Автономщик', hint: 'Автономка, печка, отопитель' },
  tyre: { name: 'Шиномонтаж', hint: 'Выездной, колесо, прокол' },
  tow: { name: 'Эвакуатор', hint: 'Не на ходу, ДТП' },
  consult: { name: 'Консультация по телефону', hint: 'Голос и чат с мастером, без выезда' },
};

/** «Что случилось?» — как в демо: у каждой поломки свой совет и варианты, первый — главный */
export type SymOption = { to: string; name: string; hint: string };
export const SYMPTOMS: { id: string; name: string; sub: string; note: string; opts: SymOption[] }[] = [
  { id: 'no_start', name: 'Не заводится', sub: 'стартер, АКБ, масса',
    note: 'Чаще всего это электрика: АКБ, масса, предохранители, проводка. Если вышел из строя агрегат — стартер, компрессор, блок управления, — на месте его обычно не заменить. Тогда мастер продиагностирует и подскажет: везти за запчастью или звать эвакуатор.',
    opts: [{ to: 'consult', name: 'Консультация по телефону', hint: '{consult} · часто решается за 10 минут' },
      { to: 'electric', name: 'Электрик или диагност на выезд', hint: 'выезд от {eco} + час работы' },
      { to: 'tow', name: 'Эвакуатор', hint: 'если на месте не завести' }] },
  { id: 'light', name: 'Свет, розетка, проводка', sub: 'прицеп, фары, разъёмы',
    note: 'Обычно чинится на месте за час-два, часто с запчастью из машины мастера.',
    opts: [{ to: 'electric', name: 'Электрик на выезд', hint: 'выезд от {eco} + час работы' },
      { to: 'consult', name: 'Консультация по телефону', hint: '{consult} · если хотите попробовать сами' }] },
  { id: 'error', name: 'Ошибка, аварийный режим', sub: 'горит чек, нет тяги',
    note: 'По коду ошибки мастер часто скажет, ехать ли дальше. Для точного ответа нужен диагност со сканером под вашу машину.',
    opts: [{ to: 'consult', name: 'Консультация по коду ошибки', hint: '{consult}' },
      { to: 'diag', name: 'Диагност на выезд', hint: 'со сканером · выезд от {pro}' }] },
  { id: 'heater', name: 'Автономка, печка', sub: 'Webasto, Eberspächer',
    note: 'Многие неисправности автономок разбираются по телефону. Если нет — выездной автономщик.',
    opts: [{ to: 'consult', name: 'Консультация по телефону', hint: '{consult}' },
      { to: 'autonomy', name: 'Автономщик на выезд', hint: 'выезд от {eco} + работа' }] },
  { id: 'wheel', name: 'Колесо', sub: 'прокол, замена',
    note: 'Выездных шиномонтажей для грузовых немного — покажем, кто рядом.',
    opts: [{ to: 'tyre', name: 'Выездной шиномонтаж', hint: 'если есть рядом' }] },
  { id: 'air', name: 'Воздух, тормоза', sub: 'не качает, ABS/EBS',
    note: 'Пневмосистема — отдельная профессия: воздушник. Электрик поможет, только если дело в датчиках и проводке.',
    opts: [{ to: 'air', name: 'Воздушник на выезд', hint: 'пневма, ABS/EBS · выезд от {eco}' },
      { to: 'consult', name: 'Консультация по телефону', hint: '{consult}' }] },
  { id: 'other', name: 'Другое', sub: 'не знаю, что это',
    note: 'Опишите, что случилось, — мастер по телефону подскажет, к кому обращаться.',
    opts: [{ to: 'consult', name: 'Консультация по телефону', hint: '{consult}' }] },
  { id: 'accident', name: 'Не на ходу, ДТП', sub: 'нужно тянуть',
    note: 'Сначала безопасность: аварийка, знак, жилет. Эвакуаторщики рядом предложат цену.',
    opts: [{ to: 'tow', name: 'Эвакуатор', hint: 'торги в ценовом коридоре · от {tow}' }] },
];

/** Подсказка мастера после консультации */
export const CONSULT_HINTS = ['Проводка', 'Масса', 'АКБ', 'Стартер', 'Предохранители', 'Кнопка / замок', 'Блок управления', 'Топливная', 'Пневма', 'Другое'];
export const CONSULT_CONF: Record<string, string> = { sure: 'Уверен', likely: 'Вероятно', guess: 'Один из вариантов' };

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

/** Марки и модели тягачей и грузовиков, которые чаще всего ездят в СПб и ЛО. Год и модель — по желанию, мастер на месте перепроверит. */
export const MODELS: Record<string, string[]> = {
  Scania: ['R-серия', 'S-серия', 'G-серия', 'P-серия', '4-серия (R/P/124/114)', 'T-серия'],
  Volvo: ['FH', 'FH16', 'FM', 'FMX'],
  DAF: ['XF', 'XG', 'CF', 'LF'],
  MAN: ['TGX', 'TGS', 'TGA', 'TGM', 'TGL'],
  'Mercedes-Benz': ['Actros', 'Arocs', 'Axor', 'Atego'],
  Renault: ['T', 'C', 'K', 'Premium', 'Magnum', 'Kerax'],
  Iveco: ['S-Way', 'Stralis', 'Trakker', 'Eurocargo'],
  'КАМАЗ': ['54901 (К5)', '5490', '65207', '6520', '65115', '65801', '43118', '5320 / 5410'],
  'МАЗ': ['5440', '6430', '6312', '5432', '6501'],
  Shacman: ['X6000', 'X5000', 'X3000', 'F3000', 'M3000'],
  Sitrak: ['C7H', 'G7'],
  FAW: ['J7', 'J6', 'CA4250'],
  Howo: ['TX', 'T5G', 'TH7', 'A7', 'Max'],
  Dongfeng: ['GX', 'KX', 'KL'],
  JAC: ['K7', 'K5', 'N-серия'],
  Foton: ['Auman EST', 'Auman'],
};
export const BRANDS = [...Object.keys(MODELS), 'Прочие'];
export const YEARS = Array.from({ length: new Date().getFullYear() - 1989 }, (_, i) => new Date().getFullYear() - i);

const BRAND_ALIASES: Record<string, string> = {
  скания: 'Scania', скан: 'Scania', даф: 'DAF', вольво: 'Volvo', ман: 'MAN', мерс: 'Mercedes-Benz', мерседес: 'Mercedes-Benz',
  рено: 'Renault', ивеко: 'Iveco', камаз: 'КАМАЗ', шакман: 'Shacman', ситрак: 'Sitrak', фав: 'FAW', хово: 'Howo',
  маз: 'МАЗ', донгфенг: 'Dongfeng', джак: 'JAC', фотон: 'Foton',
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
  consult: 'Консультация',
};

export const LINE: Record<string, string> = {
  online: 'Свободен', on_call: 'На звонке', on_job: 'На выезде', busy: 'Занят', offline: 'Не на линии',
};
