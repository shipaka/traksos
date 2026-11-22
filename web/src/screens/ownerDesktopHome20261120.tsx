import { rememberGuestService } from '../guestCatalog.ts';
import { APPROVED_VISUALS } from '../approvedVisuals.ts';
import './ownerDesktopHome20261120.css';

/** The 20 November owner-approved desktop layout. Mobile stays on its separately approved view. */
const primary = [
  ['⚒','Выездной мастер','Диагностика и ремонт на месте','van'],
  ['↗','Эвакуация','Быстрая и безопасная','tow'],
  ['⌂','СТО','Ремонт и обслуживание','sto'],
  ['◉','Шиномонтаж','Выездной ремонт колёс','tyre'],
  ['◉','Консультация','Профессиональная помощь онлайн','consult']
] as const;
const features = [
  ['▤','ТехБаза','Техническая библиотека и практический опыт','tech','Перейти'],
  ['▦','Специалисты ЭБУ','Диагностика, ремонт и программирование','ecu','Подобрать'],
  ['⚙','Запчасти','Подбор и поставка для грузовой техники','parts','В каталог'],
  ['◇','Страхование','ОСАГО, КАСКО, грузы и автопарк','insurance','Подробнее'],
  ['▤','Техосмотр','Оформление и прохождение для грузового транспорта','inspection','Записаться']
] as const;
function rememberAllowed(key:string){
  if(key==='tyre') { rememberGuestService('van','tyre'); return; }
  if(key==='van'||key==='tow'||key==='sto'||key==='consult'||key==='parts'||key==='insurance'||key==='inspection') rememberGuestService(key);
}
function route(key:string) { return '#/explore/' + (key === 'tyre' ? 'van' : key); }
function OwnerIcon({kind}:{kind:string}) {
  const props={viewBox:'0 0 48 48',fill:'none',stroke:'currentColor',strokeWidth:2.8,strokeLinecap:'round' as const,strokeLinejoin:'round' as const,'aria-hidden':true as const};
  let lines;
  switch(kind){
    case 'van': lines=<><path d="M30 5a12 12 0 0 0-10 18L7 36a5 5 0 0 0 7 7l13-13A12 12 0 0 0 43 15l-9 9-9-3-3-9Z"/><circle cx="10.5" cy="39.5" r="1"/></>;break;
    case 'tow': lines=<><path d="M4 34h29l8 6v4H4V34Z"/><path d="M9 34V23h14l8 11M12 23V12h15l6 11M23 12l-6-7M29 8h11v8l-5 5h-5"/><circle cx="13" cy="43" r="3.4"/><circle cx="35" cy="43" r="3.4"/><path d="M40 21v6m-4 0h8"/></>;break;
    case 'sto': lines=<><path d="M3 19 24 5l21 14v25H3V19Z"/><path d="M13 44V25h22v19M13 33h22"/></>;break;
    case 'tyre': lines=<><circle cx="24" cy="24" r="19"/><circle cx="24" cy="24" r="12"/><circle cx="24" cy="24" r="5"/><path d="M24 5v7m0 24v7M5 24h7m24 0h7M10 10l5 5m18 18 5 5M38 10l-5 5M15 33l-5 5"/></>;break;
    case 'ecu': lines=<><rect x="10" y="10" width="28" height="28" rx="3"/><path d="M16 4v6m8-6v6m8-6v6M16 38v6m8-6v6m8-6v6M4 16h6m-6 8h6m-6 8h6m28-16h6m-6 8h6m-6 8h6"/><rect x="17" y="17" width="14" height="14" rx="2"/></>;break;
    case 'consult': lines=<><path d="M5 25V23a19 19 0 0 1 38 0v3M5 25v10c0 5 4 8 8 8h4V27h-4a8 8 0 0 0-8 8m38-10v10c0 5-4 8-8 8h-4V27h4a8 8 0 0 1 8 8"/></>;break;
    case 'tech': lines=<><path d="M8 7h27a5 5 0 0 1 5 5v29H13a5 5 0 0 0 0-10h27"/><path d="M8 7v29a5 5 0 0 0 5 5m5-26h15m-15 6h15m-15 6h11"/></>;break;
    case 'parts': lines=<><circle cx="24" cy="24" r="8"/><path d="M19 4h10l2 6 5 3 6-2 4 9-5 5 1 6 4 4-5 9-6-2-6 2-2 6H18l-2-6-6-2-6 2-4-9 5-4v-7l-5-5 4-9 6 2 6-3Z" transform="translate(2,-2) scale(.9)"/></>;break;
    case 'insurance': lines=<><path d="M24 4 42 11v13c0 12-7 19-18 22C13 43 6 36 6 24V11Z"/><path d="m14 25 7 7 14-16"/></>;break;
    case 'inspection': lines=<><rect x="10" y="7" width="27" height="37" rx="4"/><path d="M17 4h13v6H17zm1 17 3 3 6-7m-9 17 3 3 6-7M30 23h4m-4 10h4"/></>;break;
    case 'warning': lines=<><path d="M20 7a5 5 0 0 1 8 0l18 30a5 5 0 0 1-4 8H6a5 5 0 0 1-4-8Z"/><path d="M24 18v12m0 7v1"/></>;break;
    case 'air': lines=<><circle cx="24" cy="25" r="4" fill="currentColor" stroke="none"/><path d="M15 16a12 12 0 0 0 0 18m18-18a12 12 0 0 1 0 18M9 10a20 20 0 0 0 0 30m30-30a20 20 0 0 1 0 30"/></>;break;
    default: lines=<><circle cx="24" cy="24" r="18"/><path d="M16 24h16m-8-8v16"/></>;
  }
  return <svg {...props}>{lines}</svg>;
}

function Feature({item}:{item:typeof features[number]}) {
  const [symbol,title,description,key,action] = item;
  return <a href={route(key)} className={'owner20-feature owner20-feature-'+key} onClick={() => rememberAllowed(key)}>
    <div className="owner20-feature-title"><span aria-hidden="true"><OwnerIcon kind={key}/></span><b>{title}</b></div>
    <p>{description}</p>
    <span className="owner20-feature-illustration" aria-hidden="true" />
    <span className="owner20-feature-cta">{action}　→</span>
  </a>;
}
export function OwnerDesktopHome20261120() {
  return <main className="owner20-home" id="public-home">
    <header className="owner20-top">
      <a href="#/" className="owner20-mark" aria-label="TrakSOS — главная"><img src={APPROVED_VISUALS.logo} alt="TrakSOS" width="235" height="39" /></a>
      <span className="owner20-tagline">Платформа помощи и сервисов<br/>для грузового транспорта</span>
      <nav className="owner20-topnav" aria-label="Основные разделы">
        <details><summary>О платформе</summary><div><a href="#/company">О нас</a><a href="#/explore/guide">Как работает</a><a href="#/explore/pricing">Комиссии</a></div></details>
        <details><summary>Сервисы</summary><div>{primary.map(item=><a href={route(item[3])} key={item[3]}>{item[1]}</a>)}<a href="#/explore/parts">Запчасти</a><a href="#/explore/insurance">Страхование</a></div></details>
        <details><summary>Сообщество</summary><div><a href="#/explore/air">Эфир</a><a href="#/explore/club">Клуб TrakSOS</a></div></details>
        <details><summary>Партнёрам</summary><div><a href="#/join">Хотим работать</a><a href="#/offers">Оферты</a></div></details>
        <a href="#/help">Поддержка</a>
      </nav>
      <details className="owner20-compact-menu">
        <summary>☰ Разделы</summary>
        <nav aria-label="Разделы сайта на небольшом экране ПК">
          <a href="#/company">О платформе</a><a href="#/explore/van">Сервисы</a>
          <a href="#/explore/air">Эфир</a><a href="#/explore/club">Клуб TrakSOS</a>
          <a href="#/join">Партнёрам</a><a href="#/help">Поддержка</a>
        </nav>
      </details>
      <details className="owner20-region"><summary>⌖ Выбрать регион</summary><div className="owner20-region-menu"><b>Регион запуска</b><p>Санкт-Петербург и Ленинградская область</p><small>В остальных регионах сервисы появятся по мере подключения партнёров.</small><a href="#/help">Уточнить доступность →</a></div></details>
      <a href="#/login" className="owner20-signin">♙　Войти</a>
    </header>
    <section className="owner20-hero" aria-labelledby="owner20-heading">
      <div className="owner20-photo" aria-hidden="true"/>
      <div className="owner20-lead">
        <h1 id="owner20-heading">Помощь в дороге.<br/>Сервис и поддержка<br/><em>для грузового транспорта</em></h1>
        <p>Единая платформа для водителей, владельцев<br/>и автопарков по всей России</p>
        <div className="owner20-hero-links">
          <a href="#/explore/van" onClick={() => rememberGuestService('van')} className="owner20-alert"><span aria-hidden="true"><OwnerIcon kind="warning"/></span><span><strong>SOS</strong><small>Экстренная помощь</small></span></a>
          <a href="#/explore/air" className="owner20-broadcast"><span aria-hidden="true"><OwnerIcon kind="air"/></span><span><strong>Эфир</strong><small>Связь, опыт, помощь коллег</small></span></a>
        </div>
      </div>
      <aside className="owner20-map" aria-label="Покрытие сервисов">
        <h2>Покрытие сервисов TrakSOS</h2>
        <div className="owner20-map-inner">
          <div className="owner20-map-shape" role="img" aria-label="Иллюстрация России из утверждённого макета, не подтверждение фактического покрытия."><span className="owner20-map-source" aria-hidden="true" /><span className="owner20-map-demo-tag">ДЕМО</span></div>
          <div className="owner20-map-legend"><p><i className="teal"/>Пример зоны покрытия</p><p><i/>Планируемое расширение</p><small>Доступность услуг зависит от региона и партнёрской сети.</small></div>
        </div>
        <a href="#/explore/guide">Подробнее о покрытии →</a>
      </aside>
    </section>
    <nav className="owner20-quick" aria-label="Основные услуги" id="public-services">
      {primary.map(([symbol,title,hint,key])=><a href={route(key)} key={key} onClick={() => rememberAllowed(key)}><span className="owner20-quick-icon" aria-hidden="true"><OwnerIcon kind={key}/></span><span><b>{title}</b><small>{hint}</small></span></a>)}
    </nav>
    <section className="owner20-features" aria-label="Дополнительные сервисы">
      {features.map(item=><Feature key={item[3]} item={item}/>)}
    </section>
    <section className="owner20-bottom" aria-label="Сообщество и приложение">
      <a href="#/explore/air" className="owner20-bottom-card owner20-bottom-air"><b>◉　Эфир TrakSOS</b><p>Живое сообщество водителей и специалистов. Регионы, маршруты, опыт и помощь в пути.</p><span>Войти в Эфир　→</span></a>
      <a href="#/explore/club" className="owner20-bottom-card owner20-bottom-club"><b>♧　Клуб TrakSOS</b><p>Профессиональное сообщество. Обсуждения, советы, разборы, проекты.</p><span>О Клубе　→</span></a>
      <div className="owner20-bottom-card owner20-bottom-why"><b>Почему TrakSOS</b><ul><li>Реальная помощь в дороге</li><li>Проверенные исполнители</li><li>Профессиональное сообщество</li><li>Техническая база знаний</li><li>Развитие сервисов по регионам</li></ul></div>
      <div className="owner20-bottom-card owner20-bottom-app"><b>▯　Приложение TrakSOS</b><p>Все сервисы платформы в вашем телефоне</p><span className="owner20-store">Готовится к публикации в RuStore</span></div>
    </section>
    <p className="owner20-disclaimer">Демонстрационный режим. Наличие исполнителей, доступность регионов и услуг уточняется после входа.</p>
  </main>;
}
