import type { ReactNode } from 'react';
import { SERVICES, STATUS } from '../dict.ts';
import { RoadsideMap } from './roadsideMap.tsx';

/** Real client home. Approved visual system: sunset road + branded Scania + vivid
 * service illustrations + LIVE order, with no fictional ETA, route, rating or map. */
export function VisualClientHome({ me, live, help }: {
  me: { name?: string | null; company_name?: string | null; roles?: string[] } | null;
  live: any[];
  help: ReactNode;
}) {
  const current = live[0];
  const status = current ? STATUS[current.status]?.name ?? 'В обработке' : '';
  const progress = current?.status === 'searching' ? 0 :
    current?.status === 'accepted' ? 1 :
    current?.status === 'en_route' ? 2 :
    current?.status === 'arrived' || current?.status === 'working' ? 3 : 1;
  return (
    <main className="client-home tracksos-visual-home">
      <section className="desktop-hero track-road-hero" aria-label="Помощь грузовому транспорту TrackSOS">
        <div className="desktop-hero-copy track-road-copy">
          <span className="desktop-eyebrow">TRACKSOS · ДОРОЖНАЯ ПОМОЩЬ ГРУЗОВИКАМ</span>
          <h1>Помощь грузовикам<br/><span>в любой ситуации 24/7</span></h1>
          <p>Выездной ремонт, эвакуация, грузовые СТО и консультации — в одном сервисе.</p>
          <div className="track-hero-features" aria-label="Преимущества">
            <span><i aria-hidden="true">ϟ</i><b>Быстрое обращение</b></span>
            <span><i aria-hidden="true">✓</i><b>Проверка исполнителей</b></span>
            <span><i aria-hidden="true">⌖</i><b>Санкт-Петербург и Ленобласть</b></span>
            <span><i aria-hidden="true">▤</i><b>Работа с юрлицами и документами</b></span>
          </div>
        </div>
        <div className="client-hero-art track-road-art">
          <img src="/tracksos-approved-scania-r520.webp"
            alt="Грузовик Scania R520 TrackSOS на дороге" loading="eager" decoding="async"/>
        </div>
      </section>

      <div className="tracksos-dashboard-columns">
        <section className="tracksos-dashboard-services desktop-home-main" aria-label="Услуги TrackSOS">
          {help}
          <div className="tracksos-quick-options" aria-label="Дополнительные возможности">
            <a href="#/shop" className="tracksos-option tracksos-option-parts">
              <span className="tracksos-option-art" aria-hidden="true"/>
              <span><b>Запчасти для грузовиков</b><small>Каталог, аналоги и история покупок</small></span><span aria-hidden="true">›</span>
            </a>
            <a href="#/garage" className="tracksos-option tracksos-option-inspection">
              <span className="tracksos-option-art" aria-hidden="true"/>
              <span><b>Техосмотр</b><small>Ваша техника и заявки на осмотр</small></span><span aria-hidden="true">›</span>
            </a>
            <a href="#/help" className="tracksos-option tracksos-option-guide">
              <span className="tracksos-option-art" aria-hidden="true"/>
              <span><b>Полезное</b><small>Справочники, инструкции и помощь</small></span><span aria-hidden="true">›</span>
            </a>
          </div>
        </section>
        <aside className="desktop-home-aside tracksos-dashboard-aside" aria-label="Мои заявки и быстрые действия">
          <section className="desktop-aside-card tracksos-live-card" aria-label="Активная заявка">
            <div className="tracksos-live-head"><span className="tracksos-live-icon" aria-hidden="true">▥</span>
              <h2>Активная заявка</h2>
              {current && <span className="tracksos-status">{status}</span>}
            </div>
            <div className="desktop-active-orders">
              {current ? (
                <a className="tracksos-live-order" href={`#/order/${current.id}`}>
                  <span className="tracksos-order-number">Заявка №{current.number ?? current.id?.slice(0,8)}</span>
                  <strong>{SERVICES[current.service]?.name ?? 'Дорожная помощь'}</strong>
                  <span className="tracksos-order-location">{current.address ?? 'Откройте заявку для просмотра адреса'}</span>
                  {Number.isFinite(current.lat) && Number.isFinite(current.lng) && <div className="tracksos-order-real-map" onClick={e=>e.preventDefault()}>
                    <RoadsideMap point={{lat: Number(current.lat), lng: Number(current.lng)}} kind="request" address={current.address ?? undefined} />
                  </div>}
                  <div className="tracksos-progress" aria-label={`Статус: ${status}`}>
                    {['Принята','Исполнитель','В пути','На месте'].map((label,i)=>
                      <span key={label} className={i <= progress ? 'reached' : ''}>
                        <span className="tracksos-stage-dot" aria-hidden="true">{i <= progress ? '✓' : i+1}</span>
                        <small>{label}</small>
                      </span>)}
                  </div>
                  <span className="tracksos-live-open">Открыть заявку и связь с исполнителем <b aria-hidden="true">↗</b></span>
                </a>
              ) : (
                <div className="card desktop-empty-orders">
                  <span className="tracksos-empty-icon" aria-hidden="true">✓</span>
                  <b>Сейчас нет активных заявок</b>
                  <p>Когда понадобится помощь, здесь появится статус обращения и связь с исполнителем.</p>
                  <a href="#/orders" className="tracksos-live-open">Моя история заявок ›</a>
                </div>
              )}
              {live.length > 1 && <a className="tracksos-more-orders" href="#/orders">Другие активные заявки: {live.length - 1} →</a>}
            </div>
          </section>
          <a className="desktop-aside-card tracksos-primary-help" href="#/sos" aria-label="Помощь в дороге — вызвать мастера, эвакуатор или записаться на СТО">
            <span className="tracksos-primary-help-symbol" aria-hidden="true">✚</span>
            <span><b>Помощь в дороге</b><small>Вызвать мастера, эвакуатор или записаться на СТО</small></span>
            <span className="tracksos-primary-help-arrow" aria-hidden="true">›</span>
          </a>
          <section className="desktop-aside-card tracksos-account-actions">
            <h2>Мой транспорт и заявки</h2>
            <a href="#/garage"><span aria-hidden="true">▣</span> Моя техника <b aria-hidden="true">›</b></a>
            <a href="#/orders"><span aria-hidden="true">☷</span> История заявок <b aria-hidden="true">›</b></a>
            <a href="#/notifications"><span aria-hidden="true">♧</span> Уведомления <b aria-hidden="true">›</b></a>
          </section>
          <section className="desktop-aside-card tracksos-account-actions">
            <h2>{me?.company_name ? 'Кабинет компании' : 'Мой кабинет'}</h2>
            <p>{me?.company_name ?? 'Данные профиля, документы и связь с поддержкой в одном месте.'}</p>
            <a href="#/profile">Настройки и документы <b aria-hidden="true">›</b></a>
            <a href="#/support">Связаться с поддержкой <b aria-hidden="true">›</b></a>
          </section>
        </aside>
      </div>
      <a className="tracksos-insurance-strip" href="#/insurance/request/new">
        <span className="tracksos-insurance-art" aria-hidden="true"/>
        <span><b>Страхование грузового транспорта</b>
          <small>ОСАГО, КАСКО, груз, ответственность — заявка страховому агенту</small></span>
        <strong>Подобрать страхование <span aria-hidden="true">→</span></strong>
      </a>
      <div className="mobile-home-heading tracksos-mobile-intro">
        <span className="mobile-home-kicker">TRACKSOS · ВАШИ ВОЗМОЖНОСТИ</span>
        <h2>Помощь и сервисы в одном месте</h2>
      </div>
    </main>
  );
}
