// All destinations are authored paths, never model-generated or taken from the user.
// Navigation is suggested in private chat and only happens after the user taps a link.
export interface GuideDestination { path: string; label: string }
type Intent = { test: RegExp; title: string; dest: GuideDestination; scopes?: string[] };

const catalog: Intent[] = [
  { test: /(?:где|как найти|открой|покажи|перейти|как попасть).{0,55}(?:заявк|истори[юя] заказ|мои заказ)/i,
    title: 'Твои заявки и история — в отдельном разделе. Можешь открыть его прямо отсюда.',
    dest: {path:'/orders',label:'Мои заявки'}, scopes:['client','driver'] },
  { test: /(?:где|как найти|открой|покажи|перейти).{0,55}(?:заявк|заказ)/i,
    title: 'Рабочие заявки мастера собраны в разделе «Заявки».',
    dest: {path:'/work/jobs',label:'Рабочие заявки'}, scopes:['master','tow'] },
  { test: /(?:где|как найти|открой|покажи|перейти).{0,55}(?:заявк|заказ)/i,
    title: 'Заявки рембазы находятся в рабочем кабинете СТО.',
    dest: {path:'/base',label:'Кабинет СТО'}, scopes:['service'] },
  { test: /(?:смен|поменя|измен|забыл|восстанов).{0,45}парол|парол.{0,45}(?:смен|поменя|измен|восстанов)/i,
    title: 'С паролем поможет раздел настроек аккаунта. Никому не присылай пароль и коды из SMS.',
    dest:{path:'/profile',label:'Настройки аккаунта'} },
  { test: /(?:где|как найти|открой|покажи|перейти|как попасть).{0,45}(?:профил|аккаунт|настройк)/i,
    title:'Профиль и основные настройки находятся в аккаунте.',
    dest:{path:'/profile',label:'Профиль'} },
  { test: /(?:где|как найти|открой|покажи|перейти).{0,60}(?:запчаст|магазин|артикул)/i,
    title:'Поиск запчастей находится в магазине TrakSOS.',
    dest:{path:'/shop',label:'Магазин запчастей'}, scopes:['client','master','service'] },
  { test: /(?:где|как найти|открой|покажи|перейти).{0,50}(?:транспорт|машин|гараж)/i,
    title:'Список твоих машин — в гараже.',
    dest:{path:'/garage',label:'Мой гараж'}, scopes:['client','driver'] },
  { test: /(?:где|как найти|открой|покажи|перейти).{0,50}(?:автопарк|мой парк)/i,
    title:'Управлять автопарком можно в разделе «Мой парк».',
    dest:{path:'/fleet',label:'Мой парк'}, scopes:['client'] },
  { test: /(?:где|как найти|открой|покажи|перейти|как попасть).{0,50}(?:технич.*баз|справочник|баз.*ошиб)/i,
    title:'Технический справочник ошибок доступен проверенным специалистам.',
    dest:{path:'/tech/codes',label:'Техническая база'}, scopes:['master','service'] },
  { test: /(?:где|как найти|открой|покажи|перейти|как попасть).{0,50}(?:страхован|осаго|каско)/i,
    title:'Доступные предложения по страхованию — в отдельном разделе.',
    dest:{path:'/insurance/request/new',label:'Страхование'}, scopes:['client'] },
  { test: /(?:где|как найти|открой|покажи|перейти).{0,45}(?:поддержк|обращен|пожалова)/i,
    title:'С обращениями и вопросами по площадке поможет поддержка.',
    dest:{path:'/support',label:'Поддержка'} },
  { test: /(?:как работает|как пользоваться|как устроен|инструкц|обучени|что умеет).{0,40}(?:traksos|траксос|площадк|сервис)|(?:как работает traksos)/i,
    title:'В справке собраны порядок заявок, оплата, роли и подсказки по работе с TrakSOS.',
    dest:{path:'/help',label:'Как работает TrakSOS'} },
  { test: /(?:где|открой|покажи|перейти|услови|ответствен|оферт|агентск.*договор)/i,
    title:'Условия работы и распределение ответственности описаны в офертах и правилах.',
    dest:{path:'/rules',label:'Правила площадки'} },
];

export function resolveGuideDestination(input: string, roles: string[]): { text: string; destination: GuideDestination } | null {
  const query = input.toLowerCase().trim();
  if (query.length > 180 || query.length < 4) return null;
  for (const entry of catalog) {
    if (entry.scopes && !entry.scopes.some((scope) => roles.includes(scope))) continue;
    if (!entry.test.test(query)) continue;
    return { text: entry.title, destination: entry.dest };
  }
  return null;
}

export const ASSISTANT_ADVISORY =
  'TrakBot — справочный ИИ-помощник. Его ответы могут быть неточными и не заменяют очный осмотр, измерения и решение специалиста. При риске для безопасности останови эксплуатацию и обратись к мастеру. Права сторон и ответственность определяются законом и действующими договорами.';
