// Single source of public service catalogue for desktop, mobile and Android WebView.
// Showcase items describe capabilities, not current supply or guaranteed availability.
export const SERVICE_TILES = [
  { id: 'tow', icon: '↗', title: 'Эвакуация', hint: 'Доставка грузового автомобиля в сервис' },
  { id: 'van', icon: '⚒', title: 'Выездной мастер', hint: 'Диагностика и ремонт на месте' },
  { id: 'sto', icon: '▤', title: 'СТО и сервисы', hint: 'Ремонт, ТО, диагностика, шиномонтаж' },
  { id: 'insurance', icon: '◇', title: 'Страхование', hint: 'ОСАГО, КАСКО, грузы и ответственность' },
  { id: 'parts', icon: '⚙', title: 'Запчасти', hint: 'Оригиналы и аналоги для грузовиков' },
  { id: 'consult', icon: '☏', title: 'Консультации', hint: 'Техническая помощь по телефону' },
] as const;
// Owner-approved PUBLIC six tiles of 19 Nov 2026. Keep SERVICE_TILES
// as the underlying technical catalogue: services not in this promotional
// row (master, tow, consultation) must continue to work elsewhere.
export const PUBLIC_HOME_TILES = [
  { id:'sos', icon:'⚠', title:'SOS', hint:'Экстренная помощь на дороге', href:'#/sos' },
  { id:'air', icon:'◉', title:'Эфир', hint:'Общение и помощь водителей', href:'#/air' },
  { id:'sto', icon:'⚒', title:'СТО', hint:'Проверенные сервисы и ремонт', href:'#/explore/sto' },
  { id:'ecu', icon:'▣', title:'ЭБУ', hint:'Диагностика и решения', href:'#/new/ecu' },
  { id:'parts', icon:'⚙', title:'Запчасти', hint:'Поиск и подбор деталей', href:'#/explore/parts' },
  { id:'insurance', icon:'◇', title:'Страхование', hint:'Подбор полиса для грузовика', href:'#/explore/insurance' },
] as const;

// Working secondary navigation. Not appearing in the six-tile banner must
// NEVER make an existing function disappear from the product.
export const PUBLIC_CAPABILITIES = [
  { title:'Помощь SOS', href:'#/sos' },
  { title:'Выездной мастер', href:'#/explore/van' },
  { title:'Эвакуатор', href:'#/explore/tow' },
  { title:'СТО и ремонт', href:'#/explore/sto' },
  { title:'Ремонт ЭБУ', href:'#/new/ecu' },
  { title:'Консультация', href:'#/explore/consult' },
  { title:'Эфир водителей', href:'#/air' },
  { title:'ТехБаза и справочник', href:'#/tech' },
  { title:'Мой гараж', href:'#/garage' },
  { title:'Запчасти', href:'#/explore/parts' },
  { title:'Страхование', href:'#/explore/insurance' },
  { title:'Обучение', href:'#/training' },
  { title:'TrakBot', href:'#/trakbot' },
  { title:'Партнёрам', href:'#/join' },
] as const;

export type ServiceId = typeof SERVICE_TILES[number]['id'];
export type CatalogueItem = { label: string; key: string };
export const CATALOGUE: Record<ServiceId,{
  description: string; services: CatalogueItem[];
  client: string[]; provider: string[];
}> = {
  tow: {
    description: 'Заявка на эвакуацию грузовика, тягача или прицепа с указанием маршрута и техники.',
    services: [
      { label: 'Эвакуация грузовика', key:'truck' },
      { label: 'Эвакуация тягача с прицепом', key:'semi' },
      { label: 'Перевозка до СТО', key:'workshop' },
      { label: 'Эвакуация при ДТП', key:'accident' },
    ],
    client:['Оформление заявки','Выбор предложения','Статус и история обращений','Документы по заказу'],
    provider:['Заявки на эвакуацию','Маршруты и сведения о транспорте','Финансы и выплаты','История выполненных заказов'],
  },
  van: {
    description:'Специалист для диагностики или ремонта грузовика непосредственно на дороге.',
    services: [
      {label:'Автоэлектрика',key:'electric'}, {label:'Компьютерная диагностика',key:'diag'},
      {label:'Пневматика и тормоза',key:'air'}, {label:'Автономные отопители',key:'autonomy'},
      {label:'Выездной шиномонтаж',key:'tyre'},
    ],
    client:['Оформление заявки','Выбор специализации мастера','Контроль этапов работы','История ремонтов'],
    provider:['Настройка специализаций','Приём заявок и статус линии','График выездов','Финансовый раздел'],
  },
  sto: {
    description:'Грузовые станции технического обслуживания и запись на ремонт.',
    services: [
      {label:'Запись в СТО',key:'booking'}, {label:'Ремонт грузовиков',key:'repair'}, {label:'Техническое обслуживание',key:'maintenance'},
      {label:'Компьютерная диагностика',key:'diagnostics'}, {label:'Ремонт прицепов',key:'trailer'},
      {label:'Шиномонтаж',key:'tyre'},
    ],
    client:['Поиск и запись в СТО','История обслуживания','Документы и счета','Запчасти для ремонта'],
    provider:['Календарь записей','Рабочие заявки и ремонты','Раздел финансов','Магазин запчастей'],
  },
  insurance: {
    description:'Страховые обращения по грузовому транспорту и перевозкам.',
    services: [
      {label:'ОСАГО',key:'osago'}, {label:'КАСКО',key:'kasko'},
      {label:'Страхование грузов',key:'cargo'}, {label:'Ответственность перевозчика',key:'liability'},
      {label:'Страхование транспорта юридических лиц',key:'business'},
    ],
    client:['Выбор страхового продукта','Оформление заявки','Предложения и переписка','Документы и история полисов'],
    provider:['Заявки клиентов','Расчёты и предложения','Документы и полисы','Рабочие финансы'],
  },
  parts: {
    description:'Поиск и подбор грузовых запчастей с проверкой применяемости к вашей технике.',
    services: [
      {label:'Поиск по артикулу / OEM',key:'oem'}, {label:'Подбор по грузовику',key:'vehicle'},
      {label:'Двигатель и трансмиссия',key:'engine'}, {label:'Электрика',key:'electric'},
      {label:'Тормоза и пневматика',key:'brakes'}, {label:'Ходовая часть',key:'suspension'},
      {label:'Прицепы и полуприцепы',key:'trailer'}, {label:'Оригиналы и аналоги',key:'analogs'},
    ],
    client:['Поиск и сравнение аналогов','Цена и наличие','Корзина и заказы','Повторная покупка'],
    provider:['Подбор деталей для ремонта','Поиск аналогов','Заказы в магазине','История закупок'],
  },
  consult: {
    description:'Технические консультации по проблемам грузового автомобиля и прицепа.',
    services: [
      {label:'Консультация по ошибкам и диагностике',key:'diag'},
      {label:'Помощь в выборе специалиста',key:'choice'},
    ],
    client:['Заявка на консультацию','Описание неисправности','Связь со специалистом','История рекомендаций'],
    provider:['Входящие консультации','История обращений','Финансовый раздел','Рабочий график'],
  },
};

export const TOP_CATALOGUE: { title: string; serviceIds: ServiceId[]; direct?: boolean }[] = [
  { title:'Помощь в дороге', serviceIds:['tow','van'] },
  { title:'Страхование', serviceIds:['insurance'] },
  { title:'Запчасти', serviceIds:['parts'], direct:true },
  { title:'СТО и сервисы', serviceIds:['sto'] },
  { title:'Консультации', serviceIds:['consult'] },
];

export const MASTER_SPECIALTIES = [
  { id:'electric', name:'Электрик' }, {id:'diag',name:'Диагност'},
  {id:'air',name:'Пневматика и тормоза'}, {id:'autonomy',name:'Автономщик'},
  {id:'tyre',name:'Шиномонтаж'}, {id:'consult',name:'Консультации'},
] as const;

/** Short-lived client-side navigation hint; never grants a role or access. */
export function rememberGuestService(service: ServiceId | 'inspection', item?: string) {
  try {
    sessionStorage.setItem('traksos.pendingLandingAction', service);
    if (item) sessionStorage.setItem('traksos.pendingCatalogChoice', service + '/' + item);
    else sessionStorage.removeItem('traksos.pendingCatalogChoice');
  } catch { /* unavailable in strict private browsing */ }
}
