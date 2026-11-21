import { APPROVED_VISUALS } from './approvedVisuals.ts';
import { TrakBotMascot } from './trakbotMascot.tsx';

/**
 * A non-destructive approved 617/618 continuation for every authenticated
 * secondary page. This renders OUTSIDE each route's existing React page:
 * its API, form fields, permissions and event handlers remain untouched.
 * Role-specific links only point to existing authenticated routes.
 */
type RouteMeta = { title: string; subtitle: string; marker: string };
const pageCopy: Record<string, RouteMeta> = {
  profile: {title:'Профиль и настройки',subtitle:'Ваши данные, безопасность входа и параметры аккаунта — в одном месте.',marker:'ЛИЧНОЕ'},
  orders: {title:'Заявки и история',subtitle:'Статусы, этапы работы и сообщения по вашим обращениям.',marker:'ЗАЯВКИ'},
  order: {title:'Карточка заявки',subtitle:'Все действия и документы привязаны к конкретному обращению.',marker:'ЗАЯВКА'},
  garage: {title:'Мой транспорт',subtitle:'Добавьте машину один раз и выбирайте её в заявках одним нажатием. Здесь же история обслуживания.',marker:'ТЕХНИКА'},
  fleet: {title:'Управление автопарком',subtitle:'Состав парка, водители и согласованные правила доступа.',marker:'АВТОПАРК'},
  sos: {title:'Помощь в дороге',subtitle:'Выберите подходящую помощь и заполните заявку по шагам.',marker:'SOS'},
  new: {title:'Новая заявка',subtitle:'Уточните задачу и данные машины перед отправкой исполнителю.',marker:'ПОМОЩЬ'},
  shop: {title:'Запчасти',subtitle:'Поиск, применяемость и история заказов вашей техники.',marker:'КАТАЛОГ'},
  support: {title:'Обращения и поддержка',subtitle:'Ваши обращения, ответы и связь с командой TrakSOS.',marker:'СВЯЗЬ'},
  notifications: {title:'Уведомления',subtitle:'Важные события по вашим заявкам и рабочим процессам.',marker:'СОБЫТИЯ'},
  insurance: {title:'Страховые дела',subtitle:'Подбор, документы и оформление в рамках назначенных заявок.',marker:'СТРАХОВАНИЕ'},
  inspections: {title:'Технический осмотр',subtitle:'Назначенные осмотры, этапы и документы по каждому делу.',marker:'ТЕХОСМОТР'},
  courier: {title:'Доставки и маршруты',subtitle:'Задания, связь и подтверждение выполненных доставок.',marker:'ДОСТАВКА'},
  moderation: {title:'Модерация и качество',subtitle:'Проверки, обращения и решения по правилам платформы.',marker:'КОНТРОЛЬ'},
  admin: {title:'Управление TrakSOS',subtitle:'Операционные инструменты, отчёты и контроль рабочих процессов.',marker:'УПРАВЛЕНИЕ'},
  work: {title:'Рабочее место мастера',subtitle:'Профиль, график, документы, заявки и финансовые операции.',marker:'МАСТЕР'},
  base: {title:'Моя рембаза',subtitle:'Клиенты, приёмка автомобилей, документы и расчёты СТО.',marker:'СТО'},
  reviews: {title:'Отзывы и репутация',subtitle:'Обратная связь и история взаимодействий.',marker:'ОТЗЫВЫ'},
  invite: {title:'Пригласить в TrakSOS',subtitle:'Приглашения, бонусы и прозрачные условия программы.',marker:'БОНУСЫ'},
  economics: {title:'Комиссии и баллы',subtitle:'Правила расчётов и условия программы лояльности.',marker:'ФИНАНСЫ'},
  help: {title:'Помощь и подсказки',subtitle:'Ответы на частые вопросы и инструкции по рабочим действиям.',marker:'СПРАВКА'},
  techbase: {title:'Техническая база',subtitle:'Практические материалы для решения задач на дороге и в сервисе.',marker:'ТЕХБАЗА'},
  training: {title:'Обучение TrakSOS',subtitle:'Инструкции и задания, соответствующие текущим функциям сервиса.',marker:'ОБУЧЕНИЕ'},
  learn: {title:'Знакомство с TrakSOS',subtitle:'Узнайте возможности платформы в удобном темпе.',marker:'ОБУЧЕНИЕ'},
  practice: {title:'Тренажёр',subtitle:'Безопасная учебная практика без реальных заявок и списаний.',marker:'ОБУЧЕНИЕ'},
};

const roleCopy: Record<string,{name:string;home:string;actions:[string,string][]}> = {
  client:{name:'Кабинет клиента',home:'/',actions:[['/orders','Мои заявки'],['/garage','Моя техника'],['/support','Поддержка']]},
  performer:{name:'Кабинет специалиста',home:'/work',actions:[['/work/jobs','Мои заявки'],['/work/me/schedule','График'],['/work/me','Профиль']]},
  service:{name:'Кабинет СТО',home:'/base',actions:[['/base/inbox','Заявки СТО'],['/base/money','Финансы'],['/base/me','Профиль СТО']]},
  insurer:{name:'Страховой партнёр',home:'/insurance',actions:[['/insurance/requests','Страховые дела'],['/inspections','Техосмотры'],['/profile','Настройки']]},
  inspection:{name:'Оператор техосмотра',home:'/inspections',actions:[['/inspections/processing','Назначенные осмотры'],['/profile','Аккаунт'],['/support','Поддержка']]},
  courier:{name:'Курьер',home:'/courier',actions:[['/courier/jobs','Мои доставки'],['/courier/chat','Чат'],['/profile','Аккаунт']]},
  moderator:{name:'Модератор',home:'/moderation',actions:[['/moderation/cases','Очередь дел'],['/moderation/support','Обращения'],['/moderation/verify','Проверки']]},
  admin:{name:'Администратор',home:'/admin',actions:[['/admin/section/orders','Все заявки'],['/admin/section/diagnostics','Диагностика'],['/admin/test-center','Тестовые кабинеты']]},
};
function metaFor(path:string[], fallback:string):RouteMeta{
  // A role's technical-library route must identify the REAL audience.
  // The generic cabinet navigation label can be shared by driver/master,
  // but their technical documents and titles are deliberately different.
  if(path[0]==='techbase'&&path[1]==='master')
    return {title:'ТехБаза мастера',subtitle:'Технические материалы, диагностика и схемы с проверкой применимости к конкретной технике.',marker:'ТЕХБАЗА'};
  if(path[0]==='techbase'&&path[1]==='driver')
    return {title:'ТехБаза водителя',subtitle:'Эксплуатация, безопасные проверки и инструкции по обслуживанию грузовика.',marker:'ТЕХБАЗА'};
  if(path[0]==='base'&&path[1]==='me')
    return {title:'Карточка СТО',subtitle:'Отметьте услуги, условия приёмки и фактический адрес въезда. Стоимость согласуется после осмотра.',marker:'СТО'};
  if(path[0]==='base'&&path[1]==='money')
    return {title:'Финансы СТО',subtitle:'Каждый счёт содержит работы, комиссию и выплату. Спорные суммы и сверки отражаются отдельно.',marker:'ФИНАНСЫ'};
  const base=pageCopy[path[0]||''];
  if(!base)return {title:fallback||'Рабочий раздел',subtitle:'Важные инструменты и следующие действия находятся на этой странице.',marker:'РАЗДЕЛ'};
  if(path.length>1 && fallback && !['Рабочий раздел','Кабинет техосмотра'].includes(fallback))
    return {...base,title:fallback.length<=52?fallback:base.title};
  return base;
}
export function approvedInnerSectionCopy(route:string[],title:string):RouteMeta { return metaFor(route,title); }
export function ApprovedInnerHero({mode,route,title}:{mode:string;route:string[];title:string}){
  const role=roleCopy[mode]??roleCopy.client;
  const info=metaFor(route,title);
  return <header className="tr-inner-hero" data-traksos-inner-ui="approved-617-618" data-route={route.join('/')} key={route.join('/')}>
    <div className="tr-inner-hero-copy">
      <nav className="tr-inner-crumbs" aria-label="Навигация по разделам">
        <a href={'#'+role.home}>Рабочий стол</a><span aria-hidden="true">/</span>
        <span aria-current="page">{info.marker}</span>
      </nav>
      <span className="tr-inner-overline">TRAKSOS <span aria-hidden="true">·</span> {role.name}</span>
      <h1>{info.title}</h1>
      <p>{info.subtitle}</p>
      <a href={'#'+role.home} className="tr-inner-back"><span aria-hidden="true">←</span> На рабочий стол</a>
    </div>
    <div className="tr-inner-hero-art" aria-hidden="true">
      <img src={APPROVED_VISUALS.workspaceTruck} alt="" loading="lazy"/>
      <span className="tr-inner-art-orbit tr-inner-art-orbit-one"/><span className="tr-inner-art-orbit tr-inner-art-orbit-two"/>
    </div>
  </header>;
}
export function ApprovedInnerRail({mode,route}:{mode:string;route:string[]}){
  const role=roleCopy[mode]??roleCopy.client;
  const staff=mode==='admin'||mode==='moderator';
  const label=pageCopy[route[0]||'']?.marker||'РАЗДЕЛ';
  return <aside className="tr-inner-rail" aria-label="Быстрые действия и помощник">
    <div className="tr-inner-rail-card tr-inner-rail-tools">
      <span className="tr-inner-rail-overline">БЫСТРЫЙ ДОСТУП</span>
      <h2>Всё под рукой</h2>
      <nav aria-label="Доступные действия в кабинете">
        {role.actions.map(([href,text])=><a href={'#'+href} key={href}><span>{text}</span><span aria-hidden="true">↗</span></a>)}
      </nav>
    </div>
    {staff?<div className="tr-inner-rail-card tr-inner-rail-status">
      <span className="tr-inner-rail-overline">РАБОЧИЙ РАЗДЕЛ</span>
      <span className="tr-inner-rail-mark" aria-hidden="true">▦</span>
      <h2>Контроль без лишнего</h2>
      <p>Доступны только действия вашей роли. Все решения и проверки выполняются в соответствующем разделе.</p>
    </div>:<a className="tr-inner-rail-card tr-inner-bot-card" href="#/trakbot" aria-label="Открыть личный чат TrakBot">
      <span className="tr-inner-rail-overline">ПОМОЩНИК В КАБИНЕТЕ</span>
      <div className="tr-inner-bot-line"><TrakBotMascot reaction="hello" size="small" active/><span><b>TrakBot</b><small>Рядом, когда нужен</small></span></div>
      <p>Подскажу, как работать с разделом «{label.toLowerCase()}». Вопросы обсуждаем лично, без сообщений в общем эфире.</p>
      <strong className="tr-inner-rail-cta">Открыть личный чат <span aria-hidden="true">↗</span></strong>
    </a>}
    <div className="tr-inner-rail-footer">
      <span className="tr-inner-rail-live" aria-hidden="true"/><span>Ваши заявки и суммы загружаются из сервера, без вымышленных данных.</span>
    </div>
  </aside>;
}
