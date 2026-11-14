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
  if (!tile || !service) {
    return <main className="guest-explore"><section className="guest-explore-hero">
      <h1>Раздел не найден</h1><p>Вернитесь к каталогу услуг TrackSOS.</p><a className="guest-explore-cta" href="#/">На главную</a>
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
