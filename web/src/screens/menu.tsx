// Единая навигация для всех ролей: частые действия наверху, остальное по разделам.
import { useMe } from '../ui.tsx';

export function CommonMenu() {
  const { me, mode } = useMe();
  const isDriver = !!me?.owner_id;
  const isOwner = mode === 'client' && !isDriver;
  const finances = mode === 'performer'
    ? { href: '#/work/me/money', title: 'Финансы', description: 'Начисления, комиссия, выплаты и история операций' }
    : mode === 'service'
      ? { href: '#/base/money', title: 'Финансы', description: 'Счета, выплаты и спорные суммы' }
      : mode === 'admin'
        ? { href: '#/admin', title: 'Управление финансами', description: 'Раздел «Деньги» в кабинете администратора' }
        : { href: '#/orders', title: isDriver ? 'Мои заявки' : 'Заявки и расходы', description: isDriver ? 'Только ваши обращения, без расходов компании' : 'История обращений и итоговые суммы по выполненным работам' };
  return (
    <main>
      <h1>Меню</h1>
      <div className="sub">Важные разделы под рукой. Дополнительные настройки не мешают повседневной работе.</div>
      <div className="rows">
        <a className="list-item" href={finances.href}><div className="stack" style={{ gap: 2 }}><b>{finances.title}</b><span className="note">{finances.description}</span></div><span aria-hidden="true">›</span></a>
        {(mode === 'client') && <a className="list-item" href="#/shop"><div className="stack" style={{ gap: 2 }}><b>Магазин</b><span className="note">Запчасти, товары для дороги и мои покупки</span></div><span aria-hidden="true">›</span></a>}
        {(mode === 'client') && <a className="list-item" href="#/garage"><div className="stack" style={{ gap: 2 }}><b>{isDriver ? 'Моя машина' : 'Мой гараж'}</b><span className="note">Карточки автомобилей, заявки и история работ</span></div><span aria-hidden="true">›</span></a>}
        {isOwner && <a className="list-item" href="#/fleet"><div className="stack" style={{ gap: 2 }}><b>Управление автопарком</b><span className="note">Водители, разрешения, лимиты и QR-наклейки</span></div><span aria-hidden="true">›</span></a>}
        <a className="list-item" href="#/support"><div className="stack" style={{ gap: 2 }}><b>Помощь и обращения</b><span className="note">Написать в поддержку или посмотреть ответы модератора</span></div><span aria-hidden="true">›</span></a>
        <a className="list-item" href="#/support/new?topic=improvement"><div className="stack" style={{ gap: 2 }}><b>Предложить улучшение</b><span className="note">Сообщить, чего не хватает или что неудобно</span></div><span aria-hidden="true">›</span></a>
        <a className="list-item" href="#/help"><div className="stack" style={{ gap: 2 }}><b>Как работать с ТракSOS</b><span className="note">Инструкции, тарифы, условия и ответы на вопросы</span></div><span aria-hidden="true">›</span></a>
      </div>
      <details className="card">
        <summary><b>Документы и условия</b></summary>
        <div className="stack">
          <a href="#/offer/client">Условия для клиентов</a>
          {(mode === 'performer' || mode === 'service') && <a href="#/offer/performer">Агентский договор для партнёров</a>}
          <a href="#/rules">Правила площадки</a>
          <a href="#/privacy">Персональные данные</a>
        </div>
      </details>
      <a className="linkrow" href="#/profile"><span><b>Мой аккаунт</b><small>Данные, роли, настройки и выход</small></span><span aria-hidden="true">›</span></a>
    </main>
  );
}
