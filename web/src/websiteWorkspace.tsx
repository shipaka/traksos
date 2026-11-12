import type { ReactNode } from 'react';

type PortalMode = 'client' | 'performer' | 'admin' | 'service' | 'insurer';
type Item = { href: string; title: string; hint?: string; icon: string; prefix?: boolean };

const entries: Record<PortalMode, Item[]> = {
  client: [
    { href: '#/', title: 'Обзор и услуги', icon: '◈' },
    { href: '#/sos', title: 'Срочная помощь', icon: '!', prefix: true },
    { href: '#/orders', title: 'Мои заявки', icon: '☷', prefix: true },
    { href: '#/garage', title: 'Гараж и история', icon: '▤', prefix: true },
    { href: '#/fleet', title: 'Автопарк', icon: '▦', prefix: true },
    { href: '#/fleet/finances', title: 'Финансы', icon: '₽', prefix: true },
    { href: '#/services', title: 'Рембазы', icon: '⌂', prefix: true },
    { href: '#/shop', title: 'Магазин', icon: '◫', prefix: true },
  ],
  performer: [
    { href: '#/work', title: 'Рабочая линия', icon: '◉' },
    { href: '#/work/jobs', title: 'История заявок', icon: '☷', prefix: true },
    { href: '#/work/me/money', title: 'Финансы', icon: '₽', prefix: true },
    { href: '#/work/profile', title: 'Мой профиль', icon: '▤', prefix: true },
    { href: '#/work/filter', title: 'Фильтры заказов', icon: '≡', prefix: true },
    { href: '#/work/docs', title: 'Документы', icon: '▣', prefix: true },
  ],
  service: [
    { href: '#/base', title: 'Кабинет рембазы', icon: '⌂' },
    { href: '#/base/money', title: 'Финансы', icon: '₽', prefix: true },
    { href: '#/base/me', title: 'Карточка сервиса', icon: '▤', prefix: true },
  ],
  insurer: [
    { href: '#/insurer', title: 'Мои страховые заявки', icon: '▣', prefix: true },
  ],
  admin: [
    { href: '#/admin', title: 'Администрация', icon: '▦', prefix: true },
    { href: '#/admin?tab=vehicleServices', title: 'Страхование и ТО', icon: '▣' },
    { href: '#/support', title: 'Обращения', icon: '☷', prefix: true },
  ],
};

const introductions: Record<Exclude<PortalMode, 'client'>, { eyebrow: string; title: string; copy: string; links: { href: string; label: string }[] }> = {
  performer: {
    eyebrow: 'Кабинет исполнителя', title: 'Заказы, график и расчёты — в одном месте',
    copy: 'Работайте с заявками, проверяйте историю выплат и управляйте своей доступностью без лишних экранов.',
    links: [{ href: '#/work/jobs', label: 'История заказов' }, { href: '#/work/me/money', label: 'Финансы' }],
  },
  service: {
    eyebrow: 'Кабинет рембазы', title: 'Ваша работа с сервисом под контролем',
    copy: 'Новые записи, автомобили клиентов, карточка сервиса и финансовые операции доступны из одного рабочего пространства.',
    links: [{ href: '#/base/money', label: 'Финансы' }, { href: '#/base/me', label: 'Карточка рембазы' }],
  },
  insurer: {
    eyebrow: 'Страховой партнёр', title: 'Назначенные вам страховые заявки',
    copy: 'Обрабатывайте только переданные вам обращения. Срок полиса и комментарий клиент увидит в истории автомобиля.',
    links: [{ href: '#/support', label: 'Связаться с поддержкой' }, { href: '#/help', label: 'Как работать' }],
  },
  admin: {
    eyebrow: 'Администрирование', title: 'Управление ТракSOS в одном окне',
    copy: 'Заявки, модерация, страхование, финансы и обращения разнесены по разделам. Выбирайте рабочую очередь слева.',
    links: [{ href: '#/admin?tab=vehicleServices', label: 'Страхование и ТО' }, { href: '#/support', label: 'Обращения' }],
  },
};

function isActive(href: string, hash: string) {
  if (href.includes('?')) return hash === href;
  if (href === '#/') return hash === '#/' || hash === '';
  return hash === href || (hash.startsWith(href + '/') && href !== '#/fleet');
}

export function WebsiteWorkspace({
  mode, isDriver, children,
}: {
  mode: PortalMode; isDriver: boolean; children: ReactNode;
}) {
  const hash = location.hash || '#/';
  const links = entries[mode].filter((entry) => {
    if (mode !== 'client') return true;
    if (isDriver) return entry.href !== '#/fleet' && entry.href !== '#/fleet/finances';
    return true;
  });
  const primary = links.filter((x) => !['#/fleet/finances', '#/work/me/money', '#/base/money'].includes(x.href));
  const finance = links.filter((x) => ['#/fleet/finances', '#/work/me/money', '#/base/money'].includes(x.href));
  return (
    <div className="website-workspace">
      <aside className="website-sidebar" aria-label="Навигация личного кабинета">
        <div className="website-sidebar-intro">
          <span className="label">Рабочее пространство</span>
          <b>{mode === 'client' ? isDriver ? 'Водитель' : 'Клиент / автопарк' : mode === 'performer' ? 'Исполнитель' : mode === 'service' ? 'Рембаза' : mode === 'insurer' ? 'Страховщик' : 'Администратор'}</b>
        </div>
        <nav aria-label="Разделы кабинета">
          {primary.map((x) => <a key={x.href} href={x.href} className={isActive(x.href, hash) ? 'active' : ''}><span className="sidebar-glyph" aria-hidden="true">{x.icon}</span>{x.title}</a>)}
        </nav>
        {finance.length > 0 && <>
          <span className="website-sidebar-label">Учёт и расчёты</span>
          <nav>{finance.map((x) => <a key={x.href} href={x.href} className={isActive(x.href, hash) ? 'active' : ''}><span className="sidebar-glyph" aria-hidden="true">{x.icon}</span>{x.title}</a>)}</nav>
        </>}
        <span className="website-sidebar-label">Информация</span>
        <nav>
          <a href="#/support"><span className="sidebar-glyph" aria-hidden="true">?</span>Поддержка</a>
          <a href="#/support/new?topic=improvement"><span className="sidebar-glyph" aria-hidden="true">＋</span>Предложить улучшение</a>
          <a href="#/help"><span className="sidebar-glyph" aria-hidden="true">ⓘ</span>Как это работает</a>
          <a href="#/menu"><span className="sidebar-glyph" aria-hidden="true">☰</span>Документы и настройки</a>
        </nav>
      </aside>
      <div className="website-work-area">
        {mode !== 'client' && (hash === '#/' || hash === ({ performer: '#/work', service: '#/base', insurer: '#/insurer', admin: '#/admin' } as Record<string, string>)[mode]) && (
          <section className="website-work-welcome">
            <span className="label">{introductions[mode].eyebrow}</span>
            <h2>{introductions[mode].title}</h2>
            <p>{introductions[mode].copy}</p>
            <div className="row">{introductions[mode].links.map((item) => <a href={item.href} key={item.href}>{item.label} <span aria-hidden="true">↗</span></a>)}</div>
          </section>
        )}
        {children}
      </div>
    </div>
  );
}
