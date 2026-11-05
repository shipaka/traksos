// Настройки площадки по умолчанию. Всё меняется админом в «Настройках площадки»
// (таблица settings), код читает актуальные значения через settings.ts.
// Деньги — в копейках.

export const defaultSettings = {
  pricing: {
    zones: [
      { id: 'spb', name: 'Санкт-Петербург, в пределах КАД', km: 0 },
      { id: 'kad30', name: 'До 30 км за КАД', km: 30 },
      { id: 'gat', name: 'Гатчина', km: 45 },
      { id: 'tos', name: 'Тосно', km: 55 },
      { id: 'vyb', name: 'Выборг', km: 135 },
      { id: 'lug', name: 'Луга', km: 140 },
      { id: 'kir', name: 'Кириши', km: 150 },
      { id: 'ust', name: 'Усть-Луга', km: 160 },
    ],
    tiers: {
      eco: { callOut: 150_000, hour: 150_000 },
      comfort: { callOut: 250_000, hour: 250_000 },
      pro: { callOut: 400_000, hour: 400_000 },
    },
    /** Мастер: ₽ за км за КАД, копейки */
    kmRate: 5_000,
    /** Эвакуатор: база и ₽ за км */
    towBase: 3_000_000,
    towKmRate: 11_000,
    /** За КАД считаем дорогу туда и половину обратно */
    roadFactor: 1.5,
    nightK: 1.5,
    nightFromHour: 22,
    nightToHour: 7,
    /** Округление итоговой цены, копейки (50 ₽) */
    roundTo: 5_000,
    /** Совместный выезд (дальше groupMinKm): каждый клиент платит долю */
    groupShare: 0.7,
    groupMinKm: 31,
    /** Консультация по телефону: цена для клиента, скидка на выезд после неё и сколько часов она действует */
    consult: { price: 70_000, backDiscount: 20_000, backHours: 48, autoCloseHours: 24 },
    /** Коридор цен для мастеров */
    corridor: { callOutMin: 150_000, callOutMax: 700_000, hourMin: 150_000, hourMax: 700_000 },
  },
  dispatch: {
    /** Сначала звоним приоритетным (вы с отцом). Выключить — заявки сразу идут на общие торги */
    priorityFirst: true,
    /** Сколько секунд «звонит» заявка приоритетным исполнителям (вы с отцом), прежде чем уйти на торги */
    ringSeconds: 30,
    /** Пропущенных подряд звонков — и статус «Не на линии» */
    missedToOffline: 3,
    maxCandidates: 30,
    /** Приоритетным звоним всем сразу */
    parallel: 10,
    parallelSos: 10,
    radiusKm: 220,
    /** Торги: сколько минут принимаем отклики на обычную заявку */
    auctionMinutes: 10,
    /** SOS: через столько секунд назначаем лучшего из «Рекомендуем», если клиент не выбрал */
    sosAuctionSeconds: 90,
    /** Коридор цены отклика — доля от обычной цены зоны: пол и потолок */
    offerFloor: 0.85,
    offerCeil: 1.3,
    /** Средняя скорость для расчёта подачи, км/ч */
    citySpeedKmh: 40,
    towSpeedKmh: 45,
    /** Веса «Рекомендуем» (сумма = 1): цена — лишь часть, чтобы дешевизной в топ не выйти */
    weights: { rating: 0.35, brand: 0.2, eta: 0.2, price: 0.15, experience: 0.1 },
  },
  fees: {
    /** Сервисный сбор с клиента, % */
    clientFeePct: 5,
    /** Вознаграждение агента с исполнителя, % */
    performerCommissionPct: 5,
    /** Для исполнителей с is_priority (вы с отцом) */
    priorityCommissionPct: 0,
    /** Долг по комиссии с наличных — выше этого новые заявки на паузе */
    cashDebtLimit: 300_000,
    /** При наличных мастер берёт с клиента и сервисный сбор, а площадке должен сбор + вознаграждение */
    cashChargesClientFee: true,
    /** Первый месяц без комиссии (до этой даты включительно) */
    freeUntil: null as string | null,
  },
  payments: {
    /** Наличные мастеру — работает всегда */
    cash: true,
    /** Безнал на сайте и в приложении (агентская схема) — включается после юриста и бухгалтера */
    online: false,
    /** Счёт для компаний по ИНН */
    invoice: false,
    defaultMethod: 'sbp' as 'sbp' | 'card',
    /** Передавать в платёжный сервис чек 54-ФЗ с признаком агента (после настройки кассы) */
    sendReceipts: false,
    /** Выплачивать исполнителю автоматически после подтверждения суммы (иначе — кнопкой админа) */
    autoPayout: false,
  },
  cancel: {
    /** Доля выезда исполнителю по этапу отмены (сбор площадки — в той же доле) */
    scale: {
      searching: 0,
      accepted: 0.25,
      en_route_first_half: 0.5,
      en_route_second_half: 1,
      arrived: 1,
      performer_fault: 0,
    } as Record<string, number>,
  },
  amount: {
    /** Если итог больше подтверждённой суммы на столько %, клиент подтверждает заново */
    reconfirmAbovePct: 15,
  },
  reviews: {
    newbieMinRatings: 3,
    newbieWeight: 0.3,
    minWeight: 0.1,
    maxWeight: 1,
  },
  verification: {
    /** Одобрить исполнителя можно только после того, как приняты все обязательные фото */
    requireDocs: true,
  },
  chat: {
    suspiciousWords: ['напрямую', 'мимо приложения', 'наличкой мимо', 'без приложения', 'без комиссии', 'скинь номер'],
  },
};

export type Settings = typeof defaultSettings;
export type SettingsKey = keyof Settings;
