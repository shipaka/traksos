import { useEffect } from 'react';
import { CATALOGUE, SERVICE_TILES, rememberGuestService, type ServiceId } from '../guestCatalog.ts';

/** Read-only, public explanation of the selected service and its future cabinet.
 * All real workflows require authentication; no fake provider cards or live orders.
 */
export function GuestExplore({ id, itemKey }: {id: string; itemKey?: string}) {
  const tile = SERVICE_TILES.find(s => s.id === id);
  const isService = !!tile;
  const service = isService ? CATALOGUE[tile.id] : null;
  const serviceId = (tile?.id || 'van') as ServiceId;
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'auto' }); }, [id, itemKey]);
  if (id === 'inspection') {
    return <main className="guest-explore guest-explore-inspection">
      <a className="guest-explore-back" href="#/">← На главную</a>
      <section className="guest-explore-hero">
        <span className="guest-explore-eyebrow">TRAKSOS · ИНФОРМАЦИЯ ДЛЯ ВЛАДЕЛЬЦЕВ ГРУЗОВОГО ТРАНСПОРТА</span>
        <span className="guest-explore-glyph" aria-hidden="true">✓</span>
        <h1>Техосмотр грузового транспорта</h1>
        <p>Информация о техническом осмотре грузовиков и прицепов. Узнайте, что потребуется для обращения, и войдите в TrakSOS для работы с данными своего транспорта.</p>
        <div className="guest-explore-actions">
          <a className="guest-explore-cta" href="#/login" onClick={() => rememberGuestService('inspection')}>Войти в кабинет</a>
          <a className="guest-explore-secondary" href="#/register" onClick={() => rememberGuestService('inspection')}>Зарегистрироваться</a>
        </div>
      </section>
      <section className="guest-explore-section">
        <h2>Что нужно подготовить</h2>
        <div className="guest-explore-service-grid">
          <div className="guest-explore-item"><span aria-hidden="true">✓</span><strong>Данные грузовика или прицепа</strong></div>
          <div className="guest-explore-item"><span aria-hidden="true">✓</span><strong>Документы на транспорт</strong></div>
          <div className="guest-explore-item"><span aria-hidden="true">✓</span><strong>Контакты и удобный регион</strong></div>
        </div>
        <p className="guest-explore-note">Это информационная страница. Наличие станции, запись и оформление диагностической карты не подтверждаются до проверки доступности услуги — здесь нет фиктивной записи или готового документа.</p>
      </section>
    </main>;
  }
  if (id === 'guide') {
    return <main className="guest-explore guest-explore-guide">
      <a className="guest-explore-back" href="#/">← На главную</a>
      <section className="guest-explore-hero">
        <span className="guest-explore-eyebrow">TRAKSOS · ПОЛЕЗНОЕ</span>
        <span className="guest-explore-glyph" aria-hidden="true">?</span>
        <h1>Как работает TrakSOS</h1>
        <p>Выберите нужную помощь грузовику, узнайте порядок обращения и откройте соответствующий раздел. Для оформления реальной заявки нужен личный кабинет.</p>
        <div className="guest-explore-actions">
          <a className="guest-explore-cta" href="#/explore/van">Выбрать услугу</a>
          <a className="guest-explore-secondary" href="#/login">Войти</a>
        </div>
      </section>
      <section className="guest-explore-section">
        <h2>Три шага к помощи</h2>
        <div className="guest-explore-service-grid">
          <div className="guest-explore-item"><span>01</span><strong>Опишите проблему, транспорт и место</strong></div>
          <div className="guest-explore-item"><span>02</span><strong>Ознакомьтесь с доступными предложениями</strong></div>
          <div className="guest-explore-item"><span>03</span><strong>Следите за статусом заявки в кабинете</strong></div>
        </div>
      </section>
      <section className="guest-explore-section">
        <h2>Разделы сервиса</h2>
        <div className="guest-explore-service-grid">
          {SERVICE_TILES.map(item => <a href={'#/explore/' + item.id} className="guest-explore-item" key={item.id} onClick={() => rememberGuestService(item.id)}>
            <span aria-hidden="true">{item.icon}</span><strong>{item.title}</strong><span aria-hidden="true">›</span>
          </a>)}
        </div>
        <p className="guest-explore-note">Доступность исполнителей, запчастей и страховых предложений зависит от региона и состояния подключённых услуг.</p>
      </section>
    </main>;
  }
  if (!tile || !service) {
    return <main className="guest-explore"><section className="guest-explore-hero">
      <h1>Раздел не найден</h1><p>Вернитесь к каталогу услуг TrakSOS.</p><a className="guest-explore-cta" href="#/">На главную</a>
    </section></main>;
  }
  const selected = service.services.find(x => x.key === itemKey);
  const next = serviceId === 'parts' ? '#/login' : '#/register';
  return <main className={'guest-explore guest-explore-' + serviceId}>
    <a className="guest-explore-back" href="#/">← Все услуги TrakSOS</a>
    <section className="guest-explore-hero">
      <span className="guest-explore-eyebrow">TRAKSOS · ВОЗМОЖНОСТИ СЕРВИСА</span>
      <span className="guest-explore-glyph" aria-hidden="true">{tile.icon}</span>
      <h1>{selected ? selected.label : tile.title}</h1>
      <p>{service.description}</p>
      <div className="guest-explore-actions">
        <a className="guest-explore-cta" href={next} onClick={() => rememberGuestService(serviceId, selected?.key)}>
          {serviceId === 'parts' ? 'Войти и открыть магазин' : 'Зарегистрироваться'}
        </a>
        <a className="guest-explore-secondary" href={serviceId === 'parts' ? '#/register' : '#/login'}
          onClick={() => rememberGuestService(serviceId, selected?.key)}>
          {serviceId === 'parts' ? 'Нет аккаунта? Регистрация' : 'Уже есть аккаунт? Войти'}
        </a>
      </div>
    </section>
    <section className="guest-explore-section">
      <h2>Что можно выбрать</h2>
      <div className="guest-explore-service-grid">
        {service.services.map(item => <a
          key={item.key}
          href={serviceId === 'parts' ? '#/login' : '#/explore/' + serviceId + '/' + item.key}
          className={'guest-explore-item' + (selected?.key === item.key ? ' selected' : '')}
          onClick={() => rememberGuestService(serviceId, item.key)}>
          <span aria-hidden="true">✦</span><strong>{item.label}</strong><span aria-hidden="true">›</span>
        </a>)}
      </div>
      {serviceId === 'parts' && <p className="guest-explore-note">Выберите категорию — для просмотра магазина откроется вход в TrakSOS.</p>}
    </section>
    <section className="guest-explore-section">
      <h2>Что внутри личного кабинета</h2>
      <div className="guest-explore-workspaces">
        <article>
          <span>ДЛЯ КЛИЕНТА</span><h3>Личный кабинет</h3>
          {service.client.map(f => <p key={f}><span aria-hidden="true">✓</span> {f}</p>)}
        </article>
        <article>
          <span>ДЛЯ ПАРТНЁРА</span><h3>Рабочий кабинет</h3>
          {service.provider.map(f => <p key={f}><span aria-hidden="true">✓</span> {f}</p>)}
          <a href="#/join" className="guest-explore-partner">Хочу работать с TrakSOS →</a>
        </article>
      </div>
      <p className="guest-explore-note">Это обзор возможностей. Наличие конкретных исполнителей, страховых продуктов и деталей проверяется после входа; демонстрационные данные не являются реальными заявками.</p>
    </section>
  </main>;
}
