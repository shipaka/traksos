// Role-aware first-run education. Read-only: no test order or financial API writes.
import { useEffect, useState } from 'react';
import { rub } from '../api.ts';
import { useMe } from '../ui.tsx';
import { usePrices } from './client.tsx';
import './training.css';

type Role = 'owner' | 'driver' | 'master' | 'tow' | 'consultant' | 'service' | 'insurer' | 'inspection' | 'courier' | 'moderator' | 'admin';
type Lesson = { title: string; purpose: string; steps: string; path: string; href?: string; caution?: string };
const lessons: Record<Role, Lesson[]> = {
  owner: [
    { title: 'Ваш рабочий стол', purpose: 'Здесь только ближайшие действия и активные заявки.', steps: 'Главная → выберите помощь. В Android история, документы и настройки доступны через нижнее «Меню»; на ПК — через меню кабинета.', path: 'Главная', href: '#/' },
    { title: 'Добавьте машину', purpose: 'Одна карточка автомобиля связывает ремонты, заявки и страховки.', steps: 'Мой гараж → автомобиль → марка, модель, год; VIN можно добавить позже.', path: 'Мой гараж', href: '#/garage' },
    { title: 'Помощь в дороге', purpose: 'SOS ведёт к мастеру, эвакуатору или СТО.', steps: 'Выберите услугу, транспорт, место и проблему. Перед подтверждением проверьте исполнителя и всю цену.', path: 'SOS', href: '#/sos', caution: 'Отправка заявки — настоящее действие. В обучении заявку не создаём.' },
    { title: 'Водители и ограничения', purpose: 'Водитель видит только свою машину; управление бюджетом остаётся у владельца.', steps: 'Мой автопарк → настройте QR-доступ, права и лимиты. Дорогостоящий заказ требует вашего решения.', path: 'Мой автопарк', href: '#/fleet' },
    { title: 'Счёт и продолжение', purpose: 'Каждый следующий этап ремонта — отдельная согласованная услуга.', steps: 'В заявке сверяйте цену, работу и материалы. При предложении эвакуации или СТО отдельно соглашайтесь на новый этап.', path: 'Заявки', href: '#/orders', caution: 'Продолжение не разрешает исполнителю списывать деньги без вашего согласия.' },
    { title: 'Деньги, споры, правила', purpose: 'Все суммы, комиссии, отмена и спор должны быть понятны до оплаты.', steps: 'Откройте финальную сумму и оферту. Если услуга выполнена неправильно — сообщите из заявки или в поддержку.', path: 'Условия', href: '#/offer/client' },
  ],
  driver: [
    { title: 'Доступ к машине', purpose: 'Водителя подключает владелец, а не открытая регистрация.', steps: 'Откройте QR-наклейку на автомобиле и завершите вход. Вы увидите только назначенную технику.', path: 'Мой гараж', href: '#/garage' },
    { title: 'Срочная помощь', purpose: 'При поломке не нужно разбираться в кабинетах.', steps: 'Нажмите SOS, выберите мастер/эвакуатор/СТО, проверьте место и опишите неисправность.', path: 'SOS', href: '#/sos' },
    { title: 'Ожидание согласования', purpose: 'Некоторые суммы подтверждает только владелец парка.', steps: 'Если лимит превышен, смотрите статус разрешения в заявке; не подтверждайте расходы от имени владельца.', path: 'Заявки', href: '#/orders' },
    { title: 'Следите за исполнителем', purpose: 'В заявке видны изменения статуса и связь по делу.', steps: 'Откройте текущую заявку. Уточните место, пропуск и детали для мастера.', path: 'Заявки', href: '#/orders' },
    { title: 'Что вам недоступно', purpose: 'Деньги компании и другие машины не показываются.', steps: 'Вы не закрываете работы за исполнителя и не меняете цену без нужного согласования.', path: 'Правила', href: '#/rules' },
  ],
  master: [
    { title: 'Подготовьте профиль', purpose: 'Клиенту и алгоритму важно знать ваш профиль и оборудование.', steps: 'Откройте «Меню» → Профиль исполнителя: специализации, машины, график и документы.', path: 'Профиль', href: '#/work/me' },
    { title: 'Выйдите на линию', purpose: 'Заявки приходят только при подходящем статусе и доступности.', steps: 'Рабочий стол → выберите статус доступности. Один активный выезд за раз.', path: 'Линия', href: '#/work' },
    { title: 'Примите и ведите заявку', purpose: 'Клиент всегда понимает, где мастер.', steps: 'Принять → Выехал → На месте → Начать работу → расчёт и завершение. В активной заявке кнопка «Фото» прикрепляет снимок ремонта к заказу; владелец видит его в карточке заявки. Фото не передаются в общий эфир.', path: 'Мои заявки', href: '#/work/jobs' },
    { title: 'Согласуйте каждый рубль', purpose: 'Цена выезда, работа по времени и материалы — разные строки.', steps: 'Укажите согласованную стоимость до работы. Любое дополнительное изменение согласуйте с клиентом.', path: 'Финансы', href: '#/work/me/money' },
    { title: 'Если нужна следующая услуга', purpose: 'Продолжение заявки помогает клиенту не пересказывать проблему.', steps: 'Предложите эвакуатор, СТО, ЭБУ или дополнительный выезд. Новая платная заявка возможна только после согласия клиента.', path: 'Заявки', href: '#/work/jobs', caution: 'Продолжение — отдельный заказ, а не увеличение старого чека.' },
    { title: 'Возвраты и репутация', purpose: 'Спор решается по фактам заявки, а не автоматически в пользу одной стороны.', steps: 'Сохраните описание работ, статусы, чек и переписку. Проверяйте комиссии и выплаты в финансах.', path: 'Финансы', href: '#/work/me/money' },
  ],
  tow: [
    { title: 'Карточка эвакуатора', purpose: 'Заявка должна подходить вашей технике.', steps: 'Укажите тип платформы, допустимую массу, регион выезда и рабочее время.', path: 'Профиль', href: '#/work/me' },
    { title: 'Работа на линии', purpose: 'Вы самостоятельно решаете, какую заявку принять.', steps: 'Откройте рабочий стол, выставьте доступность и изучите точки подачи и назначения.', path: 'Линия', href: '#/work' },
    { title: 'Зафиксируйте стоимость', purpose: 'Стоимость перевозки согласуют до начала выполнения.', steps: 'Проверьте транспорт, маршрут, ограничения по габаритам и полную сумму с клиентом.', path: 'Заявки', href: '#/work/jobs' },
    { title: 'Меняйте статусы', purpose: 'Клиент видит движение заказа.', steps: 'Принять → Выехал → На месте → Завершить по фактическому исполнению.', path: 'Заявки', href: '#/work/jobs' },
    { title: 'Передайте автомобиль дальше', purpose: 'После эвакуации может понадобиться ремонт в СТО.', steps: 'Предложите продолжение → клиент отдельно согласует исполнителя, цену и условия новой заявки.', path: 'Заявки', href: '#/work/jobs' },
    { title: 'Комиссии и спор', purpose: 'Все удержания должны иметь основание.', steps: 'Смотрите финансы и историю. При разногласиях прикрепляйте подтверждение выполнения.', path: 'Финансы', href: '#/work/me/money' },
  ],
  consultant: [
    { title: 'Консультация — отдельная работа', purpose: 'Помогаем разобраться удалённо, без обещания ремонта по телефону.', steps: 'Примите запрос консультации, уточните модель, симптомы и безопасность проверки.', path: 'Заявки', href: '#/work/jobs' },
    { title: 'Что можно советовать', purpose: 'Сначала безопасные проверки, затем диагностика.', steps: 'Не требуйте опасных действий на дороге. Фиксируйте рекомендации и результат в заявке.', path: 'Рабочий стол', href: '#/work' },
    { title: 'Из консультации — в мультизаявку', purpose: 'Нужная помощь не обрывается на звонке.', steps: 'Предложите выезд, эвакуатор, СТО или специалиста ЭБУ. Клиент выбирает предложение и подтверждает новую стоимость.', path: 'Заявки', href: '#/work/jobs' },
    { title: 'Несколько этапов — одна история', purpose: 'Каждый этап учитывается отдельно, но привязан к общей поломке.', steps: 'Покажите клиенту итог по делу: консультация + выезд + СТО, без двойного списания за один этап.', path: 'Заявки', href: '#/work/jobs' },
    { title: 'Вознаграждение', purpose: 'Цена консультации и возможная скидка на выезд должны быть показаны до заказа.', steps: 'Проверьте тариф, срок действия скидки и действующие условия начисления комиссии.', path: 'Условия', href: '#/offer/performer' },
  ],
  service: [
    { title: 'Заполните карточку СТО', purpose: 'Клиенты должны знать, какой ремонт вы выполняете.', steps: 'Рембаза → карточка СТО → марки, профиль, график и доступность записи.', path: 'Настройки СТО', href: '#/base/me' },
    { title: 'Принимайте автомобили', purpose: 'Новая заявка отделена от текущего ремонта.', steps: 'Откройте запрос, назначьте время и согласуйте список диагностических работ.', path: 'Рабочий стол СТО', href: '#/base' },
    { title: 'Показывайте этап ремонта', purpose: 'Клиент видит состояние автомобиля и что сделано.', steps: 'Ведите статус, выполненные работы и необходимые согласования.', path: 'Ремонты', href: '#/base' },
    { title: 'Согласуйте счёт', purpose: 'Новые работы и материалы нельзя бесконтрольно прибавлять к смете.', steps: 'Отдельно показывайте работу, запчасти, согласованные изменения и итог.', path: 'Финансы', href: '#/base/money' },
    { title: 'Продолжение в экосистеме', purpose: 'СТО может предложить дополнительную диагностику или выезд.', steps: 'Создайте предложение продолжения только с подтверждением клиента, отдельной ценой и новым исполнителем.', path: 'Ремонты', href: '#/base' },
    { title: 'Гарантии и расчёты', purpose: 'При претензии важны описание дефекта и результат.', steps: 'Сохраняйте доказательства работ. Возврат и рекламация — через оформленный спор.', path: 'Финансы', href: '#/base/money' },
  ],
  courier: [
    { title: 'Курьерская смена', purpose: 'Вы видите только назначенные вам доставки.', steps: 'Рабочий стол → проверяйте назначение и список посылок. Переключатель доступности влияет на готовность к новым рейсам.', path: 'Курьер', href: '#/courier' },
    { title: 'Порядок остановок', purpose: 'Статусы всегда отражают факт, а не намерение.', steps: 'Назначен → Забрал → В пути → На месте. Не пропускайте этапы.', path: 'Рейсы', href: '#/courier/jobs' },
    { title: 'Код вручения', purpose: 'Код получаете лично у получателя; в приложении курьера он никогда не показывается.', steps: 'После прибытия введите шесть цифр из истории покупок клиента. После пяти ошибок код блокируется. Администратор может восстановить его по записанной причине не более трёх раз; новый код видит только покупатель.', path: 'Доставка', href: '#/courier/jobs' },
    { title: 'Отдельное подтверждение', purpose: 'Верный код ещё не завершает заказ.', steps: 'Покупатель отдельно подтверждает фактическое получение, только после этого статус будет «Вручено».', path: 'Рейсы', href: '#/courier/jobs', caution: 'Курьер не завершает заказ от имени покупателя.' },
    { title: 'Вопросы и связь', purpose: 'Не раскрывайте личные телефоны получателей.', steps: 'При проблемах с выдачей, кодом или маршрутом напишите в поддержку TrakSOS.', path: 'Связь', href: '#/support' },
  ],
  insurer: [
    { title: 'Полученные заявки', purpose: 'Страховые запросы отображаются отдельно от ремонтов.', steps: 'Откройте карточку, проверьте документы клиента и параметры автомобиля.', path: 'Страхование', href: '#/insurance' },
    { title: 'Подбор предложений', purpose: 'Клиент сравнивает страховщиков и условия.', steps: 'Добавляйте только реальные предложения с компанией, условиями, стоимостью и сроком действия.', path: 'Страхование', href: '#/insurance' },
    { title: 'Цена полиса и услуги', purpose: 'Премия страховщика и отдельное вознаграждение должны быть различимы.', steps: 'Не добавляйте автоматические 5% к премии, пока юридическая и партнёрская модель не утверждена.', path: 'Документы', href: '#/offers' },
    { title: 'Полис и завершение', purpose: 'Документ прикрепляют после реального оформления.', steps: 'Проверьте платежную ссылку уполномоченного партнёра и корректность полиса.', path: 'Страхование', href: '#/insurance', caution: 'Тестовые предложения не являются настоящими полисами.' },
    { title: 'Споры и персональные данные', purpose: 'Страховые сведения требуют особой аккуратности.', steps: 'Передавайте данные только уполномоченным лицам. Вопросы по полису и оформлению отправляйте в поддержку.', path: 'Поддержка', href: '#/support' },
  ],
  inspection: [
    { title: 'Рабочий стол техосмотра', purpose: 'Технические осмотры — отдельное направление от страхования.', steps: 'Откройте очередь, проверьте статус оператора и правомерность оказания услуги.', path: 'Техосмотры', href: '#/inspections' },
    { title: 'Данные транспорта', purpose: 'Ошибка в идентификации делает результат непригодным.', steps: 'Сверьте ТС и документы в рамках полномочий и установленной процедуры.', path: 'Техосмотры', href: '#/inspections' },
    { title: 'Стоимость и документы', purpose: 'Тариф и правовое основание должны быть доступны до записи.', steps: 'Не обещайте диагностическую карту или услугу, пока процедура и внешняя интеграция не подтверждены.', path: 'Техосмотры', href: '#/inspections' },
  ],
  moderator: [
    { title: 'Очередь модерации', purpose: 'Начните с ожидающих решений и обращений.', steps: 'Выберите кейс, проверьте факты и приложенные документы.', path: 'Модерация', href: '#/moderation' },
    { title: 'Заявки и споры', purpose: 'Решение должно опираться на этапы заявки, согласования и доказательства.', steps: 'Проверьте историю и чат. Избегайте автоматического наказания по одной жалобе.', path: 'Обращения', href: '#/support' },
    { title: 'Обоснование решения', purpose: 'Участникам требуется понятное объяснение и способ оспорить.', steps: 'Запишите основание, уведомите стороны, сохраните историю действий.', path: 'Модерация', href: '#/moderation' },
    { title: 'Финансы и доступы', purpose: 'Модератор не должен менять тарифы и деньги без отдельных прав.', steps: 'Эскалируйте спорные выплаты и юридические вопросы администратору.', path: 'Поддержка', href: '#/support' },
  ],
  admin: [
    { title: 'Рабочая сводка', purpose: 'Сначала просрочки, неисполненные и спорные заявки.', steps: 'Главная админки → проверьте заявки и очередь поддержки.', path: 'Админка', href: '#/admin' },
    { title: 'Проверяйте партнёров', purpose: 'Нельзя выдавать непроверенных исполнителей за подтверждённых.', steps: 'Документы, реквизиты, специализация и права доступа проходят отдельную проверку.', path: 'Проверка исполнителей', href: '#/admin/section/verify' },
    { title: 'Единая база участников', purpose: 'Компании, мастера, эвакуаторщики и СТО учитываются в одном месте.', steps: 'Откройте реестр, выберите регион и роль, найдите участника, проверьте источник региональной привязки, добавьте служебные теги и выгрузите только нужную выборку CSV.', path: 'Единая база', href: '#/admin/section/registry', caution: 'Доступ к базе и выгрузке — только у админа. Регион последней заявки не равен адресу компании.' },
    { title: 'Деньги и тарифы', purpose: 'Изменения ставок должны соответствовать договорам.', steps: 'В настройках проверяйте комиссию, скидки, выплаты и бонусы до публикации.', path: 'Настройки', href: '#/admin/section/settings' },
    { title: 'Оферты и согласия', purpose: 'Каждая принятая редакция хранится с версией и датой.', steps: 'Публикуйте только проверенные тексты и соблюдайте сроки уведомления партнёров.', path: 'Оферты', href: '#/admin/section/offers' },
    { title: 'Тестовый центр', purpose: 'Проверьте кабинеты без настоящих SMS, оплат и заказов.', steps: 'Выберите роль, пройдите учебный сценарий, проверьте навигацию и возврат к админке.', path: 'Песочница', href: '#/admin/test-center' },
    { title: 'Курьерские доставки', purpose: 'Получение подтверждает именно покупатель.', steps: 'Назначайте курьера из собранного заказа магазина. После пяти неверных попыток либо истечения срока восстанавливайте код только по документированной причине — максимум три раза; ни курьер, ни администратор сам код не видят.', path: 'Админка', href: '#/admin' },
    { title: 'Выпуск без риска', purpose: 'Рабочий сервер не обновляем только по готовности интерфейса.', steps: 'После PR требуются CI, изолированная проверка, резервная копия и отдельное разрешение на prod.', path: 'Заявки', href: '#/admin/section/orders' },
  ],
};

const names: Record<Role, string> = {
  owner: 'Владелец автопарка', driver: 'Водитель', master: 'Выездной мастер',
  tow: 'Эвакуаторщик', consultant: 'Технический консультант', service: 'СТО',
  insurer: 'Страховой партнёр', inspection: 'Техосмотр', courier: 'Курьер запчастей', moderator: 'Модератор', admin: 'Администратор',
};
export function trainingRole(mode: string, roles: string[] = [], ownerId?: string | null): Role {
  if (mode === 'admin') return 'admin';
  if (mode === 'moderator') return 'moderator';
  if (mode === 'insurer') return 'insurer';
  if (mode === 'inspection') return 'inspection';
  if (mode === 'courier') return 'courier';
  if (mode === 'service') return 'service';
  if (mode === 'performer') return roles.includes('tow') && !roles.includes('master') ? 'tow' : 'master';
  return ownerId || roles.includes('driver') ? 'driver' : 'owner';
}
function localFlag(userId: string, role: string) { return 'traksos.training.v1.' + userId + '.' + role; }

export function TrainingInvite() {
  const { me, mode } = useMe();
  const role = trainingRole(mode, me?.roles ?? [], me?.owner_id);
  const key = me ? localFlag(me.id, role) : '';
  const [hidden, setHidden] = useState(false);
  useEffect(() => { try { setHidden(!key || !!localStorage.getItem(key)); } catch { setHidden(!key); } }, [key]);
  if (!me || hidden) return null;
  return <section className="tr-training-invite" aria-label="Знакомство с кабинетом">
    <div><strong>Впервые здесь?</strong><span>Покажем основные действия в вашем кабинете — без настоящих заказов и оплаты.</span></div>
    <div className="tr-training-invite-actions">
      <a href="#/training">Начать обучение</a>
      <button type="button" onClick={() => window.dispatchEvent(new Event('traksos-tour-start'))}>Показать кнопки</button>
      <button type="button" onClick={() => { try { localStorage.setItem(key, 'later'); } catch {} setHidden(true); }}>Позже</button>
    </div>
  </section>;
}

export function Training({ chapter }: { chapter?: string }) {
  const { me, mode } = useMe();
  const { pricing } = usePrices();
  const ownRole = trainingRole(mode, me?.roles ?? [], me?.owner_id);
  const admin = !!me?.roles.includes('admin');
  const allowed = admin ? Object.keys(names) as Role[]
    : ownRole === 'master' ? ['master', 'consultant'] as Role[]
    : [ownRole];
  const requested = chapter as Role;
  const role = allowed.includes(requested) ? requested : ownRole;
  const [index, setIndex] = useState(0);
  const [completed, setCompleted] = useState(false);
  const key = me ? localFlag(me.id, role) : '';
  useEffect(() => { setIndex(0); try { setCompleted(key ? localStorage.getItem(key) === 'done' : false); } catch { setCompleted(false); } }, [key]);
  const items = lessons[role];
  const lesson = items[Math.min(index, items.length - 1)];
  const finish = () => { if (key) { try { localStorage.setItem(key, 'done'); } catch {} } setCompleted(true); };
  const next = () => { if (index === items.length - 1) finish(); else setIndex(v => v + 1); };
  const amountNote = !pricing
    ? 'Актуальные ставки загрузятся из настроек площадки. Окончательную сумму смотрите в заявке до подтверждения.'
    : role === 'owner' || role === 'driver'
      ? `Сервисный сбор клиента: ${pricing.clientFeePct}% по действующим настройкам. Итог и условия отмены — до подтверждения заявки.`
      : role === 'service'
        ? `Комиссия СТО: ${pricing.serviceCommissionPct}% с работ, лимит ${rub(pricing.serviceCommissionMax)} за счёт — если нет отдельного тарифа.`
        : role === 'master' || role === 'tow' || role === 'consultant'
          ? `Комиссия исполнителя по общему тарифу: ${pricing.performerCommissionPct}%. Льготы, акции и персональные ставки проверяйте в счёте.`
          : 'Страховые, административные и другие специальные тарифы определяются отдельными действующими условиями.';
  return <main className="tr-training-page">
    <a href="#/help" className="note">← Справка</a>
    <section className="tr-training-hero">
      <span className="label">TRAKSOS · ОБУЧЕНИЕ</span>
      <h1>Как всё работает</h1>
      <p>Просто, по шагам. Здесь нет оформления заказов, списаний и настоящих платежей.</p>
    </section>
    {allowed.length > 1 && <nav className="tr-training-roles" aria-label="Выберите раздел обучения">
      {allowed.map(r => <a key={r} className={r === role ? 'selected' : ''} href={'#/training/' + r}
        aria-current={r === role ? 'page' : undefined}>{names[r]}</a>)}
    </nav>}
    <section className="tr-training-workspace" aria-label={'Обучение: ' + names[role]}>
      <div className="tr-training-progress">
        <div className="tr-training-progress-label"><strong>{names[role]}</strong><span>Шаг {index + 1} из {items.length}</span></div>
        <div className="tr-training-track" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={completed ? items.length : index + 1} aria-label="Прогресс обучения">
          <span style={{ width: ((completed ? items.length : index + 1) / items.length) * 100 + '%' }} />
        </div>
      </div>
      {completed && <div className="banner good" role="status">Обучение пройдено. Можно снова открыть любой шаг.</div>}
      <div className="tr-training-lesson" key={role + index}>
        <span className="label">ШАГ {index + 1}</span>
        <h2>{lesson.title}</h2>
        <p className="tr-training-purpose">{lesson.purpose}</p>
        <div className="tr-training-instruction"><strong>Что делать</strong><p>{lesson.steps}</p></div>
        {lesson.caution && <p className="tr-training-caution">{lesson.caution}</p>}
        <div className="tr-training-location"><span>Где находится: <b>{lesson.path}</b></span>
          {lesson.href && <a href={lesson.href}>Открыть раздел</a>}</div>
      </div>
      <div className="tr-training-controls">
        <button type="button" className="btn ghost" disabled={index === 0} onClick={() => setIndex(v => Math.max(0, v - 1))}>Назад</button>
        <button type="button" className="btn" onClick={next}>{index === items.length - 1 ? 'Завершить обучение' : 'Понятно, дальше'}</button>
      </div>
      <nav className="tr-training-step-links" aria-label="Все шаги">
        {items.map((item, i) => <button type="button" key={item.title} className={i === index ? 'active' : ''} aria-current={i === index ? 'step' : undefined} onClick={() => setIndex(i)}>{i + 1}. {item.title}</button>)}
      </nav>
    </section>
    <section className="tr-training-hero tr-training-practice-entry"><h2>Посмотреть свой кабинет</h2>
      <p>Подсветим основные разделы прямо на работающем экране. Никаких кнопок за вас не нажмём.</p>
      <button type="button" className="btn ghost" onClick={() => { try { sessionStorage.setItem('traksos.tour.pending','1'); } catch {} location.hash='#/'; }}>Быстрый обзор кнопок</button>
    </section>
    <section className="tr-training-hero tr-training-practice-entry"><h2>Попробовать на примере</h2>
      <p>Учебная заявка с кнопками и безопасными действиями. Всё выполняется внутри тренажёра, без реальных денег и уведомлений.</p>
      <a className="btn" href={'#/practice/' + role}>Запустить тренировку</a>
    </section>
    <section className="tr-training-reference">
      <h2>Деньги и правила</h2><p>{amountNote}</p>
      <p>Стоимость работы, сбор площадки, возможная скидка и итог должны быть показаны отдельно. Новый этап ремонта требует отдельного согласия клиента.</p>
      <div className="row"><a href="#/rules">Правила площадки</a><a href={'#/offer/' + (['master','tow','consultant','service'].includes(role) ? 'performer' : 'client')}>Действующая оферта</a><a href="#/support/new">Написать в поддержку</a></div>
    </section>
  </main>;
}
