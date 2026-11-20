import { rememberGuestService } from '../guestCatalog.ts';
import './ownerDesktopHome20261120.css';

/** The 20 November owner-approved desktop layout. Mobile stays on its separately approved view. */
const primary = [
  ['⚒','Выездной мастер','Диагностика и ремонт на месте','van'],
  ['↗','Эвакуация','Быстрая и безопасная','tow'],
  ['⌂','СТО','Ремонт и обслуживание','sto'],
  ['▦','ЭБУ','Диагностика и ремонт электронных блоков','ecu'],
  ['◉','Консультация','Профессиональная помощь онлайн','consult']
] as const;
const features = [
  ['▤','ТехБаза','Техническая библиотека и практический опыт','tech','Перейти'],
  ['▦','Специалисты ЭБУ','Диагностика, ремонт и программирование','ecu','Подобрать'],
  ['⚙','Запчасти','Подбор и поставка для грузовой техники','parts','В каталог'],
  ['◇','Страхование','ОСАГО, КАСКО, грузы и автопарк','insurance','Подробнее'],
  ['▤','Техосмотр','Для грузового транспорта','inspection','Подробнее']
] as const;
function rememberAllowed(key:string){
  if(key==='van'||key==='tow'||key==='sto'||key==='consult'||key==='parts'||key==='insurance'||key==='inspection') rememberGuestService(key);
}
function route(key:string) { return '#/explore/' + key; }
function TruckLogo() {
  return <svg viewBox="0 0 64 42" fill="none" stroke="currentColor" strokeWidth="2.1" aria-hidden="true">
    <path d="M3 32V16l13-8 27 3 9 9v13H3m8-15h13l3-6m-1 6h16V13M3 37h56M8 6h14M45 22h12m-8 5h11"/>
    <circle cx="15" cy="34" r="4"/><circle cx="43" cy="34" r="4"/>
  </svg>;
}
function Feature({item,index}:{item:typeof features[number];index:number}) {
  const [symbol,title,description,key,action] = item;
  return <a href={route(key)} className={'owner20-feature owner20-feature-'+key} onClick={() => rememberAllowed(key)}>
    <div className="owner20-feature-title"><span aria-hidden="true">{symbol}</span><b>{title}</b></div>
    <p>{description}</p>
    <span className="owner20-feature-illustration" aria-hidden="true">{index === 0 ? '▤' : index===1?'▦':index===2?'⚙':index===3?'◇':'✓'}</span>
    <span className="owner20-feature-cta">{action}　→</span>
  </a>;
}
export function OwnerDesktopHome20261120() {
  return <main className="owner20-home" id="public-home">
    <header className="owner20-top">
      <a href="#/" className="owner20-mark" aria-label="TrakSOS — главная"><TruckLogo/><span>Trak<strong>SOS</strong></span></a>
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
          <a href="#/explore/van" onClick={() => rememberGuestService('van')} className="owner20-alert"><span aria-hidden="true">⚠</span><span><strong>SOS</strong><small>Экстренная помощь</small></span></a>
          <a href="#/explore/air" className="owner20-broadcast"><span aria-hidden="true">◉</span><span><strong>Эфир</strong><small>Связь, опыт, помощь коллег</small></span></a>
        </div>
      </div>
      <aside className="owner20-map" aria-label="Покрытие сервисов">
        <h2>Покрытие сервисов TrakSOS</h2>
        <div className="owner20-map-inner">
          <div className="owner20-map-shape" role="img" aria-label="Демонстрационная схема карты России из утверждённого макета, не подтверждение фактического покрытия."><img src="/owner20-russia-coverage-reference.svg" alt="" aria-hidden="true" loading="eager"/><span className="owner20-map-demo-tag">ДЕМО</span></div>
          <div className="owner20-map-legend"><p><i className="teal"/>Пример зоны покрытия</p><p><i/>Планируемое расширение</p><small>Доступность услуг зависит от региона и партнёрской сети.</small></div>
        </div>
        <a href="#/explore/guide">Подробнее о покрытии →</a>
      </aside>
    </section>
    <nav className="owner20-quick" aria-label="Основные услуги" id="public-services">
      {primary.map(([symbol,title,hint,key])=><a href={route(key)} key={key} onClick={() => rememberAllowed(key)}><span className="owner20-quick-icon" aria-hidden="true">{symbol}</span><span><b>{title}</b><small>{hint}</small></span></a>)}
    </nav>
    <section className="owner20-features" aria-label="Дополнительные сервисы">
      {features.map((item,index)=><Feature key={item[3]} item={item} index={index}/>)}
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
