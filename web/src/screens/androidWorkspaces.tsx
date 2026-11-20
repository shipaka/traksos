/* Android workspaces approved 19.11.2026. Only real API-backed values. */
import { useEffect, useState } from 'react';
import { get, rub } from '../api.ts';
import { SERVICES, STATUS } from '../dict.ts';
import { useLoad } from '../ui.tsx';
import { OfferForm } from './search.tsx';
import { insurancePresentation } from '../insurancePresentation.ts';
import { APPROVED_VISUALS } from '../approvedVisuals.ts';
import { ApprovedEmptyScene } from '../approvedEmptyScene.tsx';
import { ApprovedServiceIllustration } from '../approvedServiceIllustration.tsx';
import { ApprovedOrderTruck } from '../approvedOrderTruck.tsx';

/** Render a single role dashboard per viewport, rather than hiding a live component tree with CSS. */
export function useMobileWorkspace() {
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 899px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 899px)');
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  return mobile;
}

const IN_PROGRESS = ['searching', 'accepted', 'en_route', 'arrived', 'working', 'awaiting_confirmation'];
const MILESTONES = ['Получено', 'Принято', 'В пути', 'На месте', 'Завершено'];

function stage(status: string) {
  if (status === 'completed') return 4;
  if (status === 'awaiting_confirmation' || status === 'working' || status === 'arrived') return 3;
  if (status === 'en_route') return 2;
  if (status === 'accepted') return 1;
  return 0;
}

function MobileTimeline({ status }: { status: string }) {
  const current = stage(status);
  return <ol className="and19-timeline" aria-label="Ход выполнения заявки">
    {MILESTONES.map((title, index) =>
      <li key={title} className={index < current ? 'passed' : index === current ? 'current' : ''}
        aria-current={index === current ? 'step' : undefined}>
        <span aria-hidden="true">{index < current || status === 'completed' ? '✓' : index + 1}</span><small>{title}</small>
      </li>)}
  </ol>;
}

function performerNextStep(status: string): string {
  // This CTA ONLY opens the authorized order: server validates every status change.
  switch (status) {
    case 'accepted': return 'Открыть · подтвердить выезд';
    case 'en_route': return 'Открыть · отметить прибытие';
    case 'arrived': return 'Открыть · начать работу';
    case 'working': return 'Оформить результат и расчёт';
    case 'awaiting_confirmation': return 'Проверить подтверждение клиента';
    default: return 'Открыть заявку';
  }
}

function MobileLoading({ label }: { label: string }) {
  return <div className="and19-loading" role="status" aria-label={label} aria-busy="true">
    <span className="and19-skeleton big" /><span className="and19-skeleton" /><span className="and19-skeleton short" />
    <small>{label}</small>
  </div>;
}

function VehicleLine({ order }: { order: any }) {
  const name = [order.vehicle?.brand || order.v_brand || order.brand, order.vehicle?.model || order.v_model || order.model,
    order.vehicle?.year || order.v_year || order.year].filter(Boolean).join(' ');
  return name ? <p className="and19-vehicle"><span aria-hidden="true">▤</span> {name}</p> : null;
}

function OrderTitle({ order }: { order: any }) {
  return <div className="and19-panel-title">
    <strong>Заявка №{order.number ?? '—'}</strong>
    <span className="and19-status">{STATUS[order.status]?.name || 'Статус уточняется'}</span>
  </div>;
}

function OrderFacts({ order }: { order: any }) {
  return <div className="and19-facts">
    <VehicleLine order={order} />
    {order.description && <p className="and19-issue"><span aria-hidden="true">⚠</span>{order.description}</p>}
    <p><span aria-hidden="true">⌖</span> {order.service === 'consult' ? 'Консультация без выезда' : (order.address || order.estimate?.zoneName || 'Адрес в подробностях заявки')}</p>
    <p className="and19-service">{SERVICES[order.service]?.name || 'Выездная помощь'}</p>
  </div>;
}

export function AndroidClientWorkspace({ orders, loading, error, me, retry, insuranceInProgress, disabledServices }: {
  orders: any[]; loading: boolean; error: string | null; me: any; retry: () => void;
  insuranceInProgress: any[];
  disabledServices?: {repair:boolean; tow:boolean; service:boolean; consult:boolean; shop:boolean};
}) {
  const current = orders.find(o => IN_PROGRESS.includes(o.status));
  const isDriver = !!me?.owner_id || me?.roles?.includes('driver');
  return <div className="and19-workspace and19-client" aria-label="Android рабочий стол клиента">
    <div className="and19-role">{isDriver ? 'Водитель' : 'Клиент · Владелец автопарка'}</div>
    <div className="and19-cover">
      <div><small>TRAKSOS · ПОМОЩЬ В ДОРОГЕ</small><h1>Рабочий стол</h1></div>
      <img src={APPROVED_VISUALS.workspaceTruck} alt="" aria-hidden="true" />
    </div>
    <div className="and19-services" aria-label="Вызвать помощь">
      <a href={disabledServices?.repair ? undefined : '#/sos'} aria-disabled={disabledServices?.repair || undefined}><span aria-hidden="true">⚒</span><span className="and19-service-label">Выездной мастер</span><ApprovedServiceIllustration kind="repair" /></a>
      <a href={disabledServices?.tow ? undefined : '#/new/tow'} aria-disabled={disabledServices?.tow || undefined}><span aria-hidden="true">↗</span><span className="and19-service-label">Эвакуатор</span><ApprovedServiceIllustration kind="tow" /></a>
      <a href={disabledServices?.service ? undefined : '#/services'} aria-disabled={disabledServices?.service || undefined}><span aria-hidden="true">▤</span><span className="and19-service-label">СТО</span><ApprovedServiceIllustration kind="service" /></a>
      <a href={disabledServices?.consult ? undefined : '#/new/consult'} aria-disabled={disabledServices?.consult || undefined}><span aria-hidden="true">◉</span><span className="and19-service-label">Консультация</span><ApprovedServiceIllustration kind="consult" /></a>
    </div>
    {insuranceInProgress.length > 0 && <section className="and19-insurance" role="region"
      aria-label="Мои активные страховые заявки">
      <div className="and19-insurance-header"><strong>Активные страховые заявки</strong><a href="#/garage">Все страховки ›</a></div>
      {insuranceInProgress.slice(0, 3).map(request => {
        const presentation = insurancePresentation(request.insurance_stage, request.status);
        return <a className={'and19-insurance-card tone-' + presentation.tone} key={request.id}
          href={request.insurance_stage ? '#/insurance/request/' + request.id : '#/garage'}>
          <small>СТРАХОВАНИЕ · {[request.brand, request.model].filter(Boolean).join(' ') || 'Транспорт'}</small>
          <strong>{presentation.label}</strong>
          <span>{presentation.next}</span>
          <em>Открыть заявку ›</em>
        </a>;
      })}
      {insuranceInProgress.length > 3 && <a className="and19-insurance-more" href="#/garage">
        Остальные {insuranceInProgress.length - 3} — в разделе «Моя техника» ›
      </a>}
    </section>}
    {loading ? <MobileLoading label="Проверяем активные заявки" /> : error && !current
      ? <section className="and19-panel" role="alert"><strong>Не удалось обновить заявки</strong><p>{error}</p><button className="and19-action" onClick={retry}>Повторить</button></section>
      : current ? <section className="and19-panel and19-main-order">
        <a className="and19-order-open" href={'#/order/' + current.id} aria-label={'Открыть заявку №' + current.number}>
          <OrderTitle order={current} />
          {current.service!=='consult' && <ApprovedOrderTruck order={current} />}
          <OrderFacts order={current} />
          {current.status !== 'searching' && Number.isFinite(current.money?.total) &&
            <div className="and19-price">
              <small>{['awaiting_confirmation', 'completed'].includes(current.status) ? 'Сумма к подтверждению' : 'Предварительный расчёт'}</small>
              <strong>{rub(current.money.total)}</strong>
            </div>}
          {current.status !== 'searching' && <MobileTimeline status={current.status} />}
          {current.status === 'searching' && <p className="and19-search-active"><span className="and19-pulse" aria-hidden="true" />Поиск исполнителя продолжается · открыть отклики</p>}
          <span className="and19-link">Открыть заявку и связь с исполнителем <span aria-hidden="true">›</span></span>
        </a>
        {current.status !== 'searching' &&
          <nav className="and19-order-shortcuts" aria-label="Действия по активной заявке">
            <a href={'#/order/' + current.id + '/chat'}>Чат заявки</a>
            <a href={'#/order/' + current.id}>Подробности</a>
          </nav>}
      </section>
      : <section className="and19-panel and19-empty"><strong>Активных заявок нет</strong><ApprovedEmptyScene kind="orders" /><p>Выберите необходимую помощь — здесь появятся только реальные этапы поиска и отклики в заявке.</p></section>}
    {orders.length > 1 && <a href="#/orders" className="and19-row-link">Все мои заявки <span>{orders.length} ›</span></a>}
    <a href="#/garage" className="and19-equipment">
      <span className="and19-equipment-icon" aria-hidden="true">▤</span><span><strong>{isDriver ? 'Моя машина' : 'Моя техника'}</strong><small>История ремонта, документы и обслуживание</small></span><span aria-hidden="true">›</span>
    </a>
    <a href={disabledServices?.shop ? undefined : "#/shop"} aria-disabled={disabledServices?.shop || undefined} className="and19-equipment and19-parts-shortcut" aria-label="Магазин запчастей">
      <span className="and19-equipment-icon" aria-hidden="true">⚙</span>
      <span><strong>Магазин запчастей</strong><small>{disabledServices?.shop ? 'Доступ ограничен владельцем автопарка' : 'По названию и артикулу · магазин пока закрыт'}</small></span>
      <span aria-hidden="true">›</span>
    </a>
    <a href="#/sos" className="and19-action and19-sos">＋ Новая заявка / SOS-помощь</a>
  </div>;
}

export function AndroidPerformerWorkspace({ performer, active, auctions, online, busy, setLine, balance, reloadAuctions, pendingReview=0 }: {
  performer: any; active: any[]; auctions: any[]; online: boolean; busy: boolean;
  setLine: (status: string) => void; balance: any; reloadAuctions: () => void; pendingReview?: number;
}) {
  const tow = performer.kind === 'tow';
  const inJob = performer.line_status === 'on_job';
  return <div className="and19-workspace and19-performer" aria-label="Android рабочий стол исполнителя">
    <div className="and19-role and19-line">
      <span>{tow ? 'Эвакуаторщик' : 'Выездной мастер'}</span>
      <button type="button" disabled={busy || inJob} className={online ? 'and19-online' : 'and19-offline'}
        aria-label={inJob ? 'На выезде — нельзя сменить статус' : 'Изменить статус доступности'}
        onClick={() => setLine(online ? 'offline' : 'online')}>
        <i />{inJob ? 'На выезде' : online ? 'На линии' : 'Не на линии'}
        <span aria-hidden="true" className="and19-toggle" />
      </button>
    </div>
    <div className="and19-cover">
      <div><small>TRAKSOS · {tow ? 'ЭВАКУАЦИЯ' : 'ВЫЕЗДНОЙ СЕРВИС'}</small><h1>Рабочий стол</h1></div>
      <img src={APPROVED_VISUALS.workspaceTruck} alt="" aria-hidden="true" />
    </div>
    <div className="and19-metrics">
      <a href="#/work/jobs"><small>В работе</small><strong>{active.length}</strong></a>
      <a href="#/work/me/level"><small>Рейтинг</small><strong>{performer.rating != null ? Number(performer.rating).toFixed(1) : '—'}</strong></a>
      <a href="#/work/me/money"><small>К выплате</small><strong>{balance?.to_pay != null ? rub(balance.to_pay) : '—'}</strong></a>
    </div>
    {active.length ? <section className="and19-panel and19-main-order">
      <a className="and19-order-open" href={'#/order/' + active[0].id}>
        <OrderTitle order={active[0]} />
        {active[0].service!=='consult' && <ApprovedOrderTruck order={active[0]} />}
        <OrderFacts order={active[0]} />
        <MobileTimeline status={active[0].status} />
        <span className="and19-link">{performerNextStep(active[0].status)} <span aria-hidden="true">›</span></span>
      </a>
      <nav className="and19-order-shortcuts" aria-label="Разделы текущей заявки">
        <a href={'#/order/' + active[0].id + '/chat'}>Чат</a>
        <a href={'#/order/' + active[0].id + '/client'}>Клиент и ТС</a>
        <a href={'#/order/' + active[0].id + '/finance'}>Расчёт</a>
      </nav>
      {active.length > 1 && <a className="and19-row-link" href="#/work/jobs">Другие активные заявки: {active.length - 1} ›</a>}
    </section> : <section className="and19-panel and19-empty">
      <strong>{online ? 'Ожидаем подходящую заявку' : 'Вы не на линии'}</strong>
      <ApprovedEmptyScene kind="shift" />
      <p>{online ? 'Когда заявка поступит, вы получите входящий вызов. Приложение не нужно держать открытым.' : 'Включите статус «На линии», чтобы получать заявки. При необходимости настройте график.'}</p>
      <a href="#/work/filter" className="and19-link">Настройки заявок ›</a>
    </section>}
    {pendingReview > 0 && <a className="and19-row-link" href="#/work/jobs">Работы завершены физически, ожидают решения клиента: {pendingReview} ›</a>}
    {auctions.length > 0 && <section className="and19-auctions">
      <h2>Новые подходящие заявки ({auctions.length})</h2>
      {auctions.map((a: any) => <div className="and19-panel" key={a.order_id}>
        <strong>{a.is_sos ? 'SOS · ' : ''}{SERVICES[a.service]?.name || 'Заявка'} · {a.brand || 'Грузовой транспорт'}</strong>
        <p>{a.address || a.estimate?.zoneName || 'Адрес уточняется'}</p>
        {a.description && <p>{a.description}</p>}
        <OfferForm orderId={a.order_id} limits={a.limits} myPrice={a.my_price} onDone={reloadAuctions} />
      </div>)}
    </section>}
    {balance?.cash_debt > 0 && <a href="#/work/me/money" className="and19-row-link">
      Исторические расчёты по старым заявкам <strong>{rub(balance.cash_debt)} ›</strong>
    </a>}
    {performer.verification !== 'approved' && <a href="#/work/docs" className="and19-row-link">Проверка и документы профиля ›</a>}
    <div className="and19-quick">
      <a href="#/work/jobs">Все заявки</a>
      <a href="#/work/me/money">Финансы</a>
      <a href="#/work/filter">Фильтры работ</a>
    </div>
  </div>;
}

export function AndroidMasterChats() {
  const l = useLoad<any[]>(() => get('/api/orders?as=performer'), []);
  const rows = (l.data || []).filter(o => o && o.id && ['accepted', 'en_route', 'arrived', 'working', 'awaiting_confirmation', 'completed'].includes(o.status));
  return <main className="and19-chats and19-workspace">
    <h1>Чаты по заявкам</h1>
    <p>Переписка привязана к заказу. Откройте заявку, чтобы перейти к общению.</p>
    {!l.data && !l.error && <MobileLoading label="Загружаем ваши заявки" />}
    {l.error && <div className="and19-panel" role="alert"><p>{l.error}</p><button className="and19-action" onClick={l.reload}>Повторить</button></div>}
    {l.data && !rows.length && <div className="and19-panel">Чатов по принятым заявкам пока нет.</div>}
    {rows.map(o => <a key={o.id} className="and19-row-link" href={'#/order/' + o.id + '/chat'}>
      <span>Заявка №{o.number} · {SERVICES[o.service]?.name || 'Работа'}</span><span>Открыть ›</span>
    </a>)}
  </main>;
}
