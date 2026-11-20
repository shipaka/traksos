/* Android workspaces approved 19.11.2026. Only real API-backed values. */
import { useEffect, useState } from 'react';
import { get, rub } from '../api.ts';
import { SERVICES, STATUS } from '../dict.ts';
import { useLoad } from '../ui.tsx';
import { OfferForm } from './search.tsx';
import { insurancePresentation } from '../insurancePresentation.ts';
import { VehicleModelPhoto } from '../vehicleVisual.tsx';

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
      <img src="/tracksos-approved-hero-owner-20261119.webp" alt="" aria-hidden="true" />
    </div>
    <div className="and19-services" aria-label="Вызвать помощь">
      <a href={disabledServices?.repair ? undefined : '#/sos'} aria-disabled={disabledServices?.repair || undefined}><span aria-hidden="true">⚒</span>Выездной мастер</a>
      <a href={disabledServices?.tow ? undefined : '#/new/tow'} aria-disabled={disabledServices?.tow || undefined}><span aria-hidden="true">↗</span>Эвакуатор</a>
      <a href={disabledServices?.service ? undefined : '#/services'} aria-disabled={disabledServices?.service || undefined}><span aria-hidden="true">▤</span>СТО</a>
      <a href={disabledServices?.consult ? undefined : '#/new/consult'} aria-disabled={disabledServices?.consult || undefined}><span aria-hidden="true">◉</span>Консультация</a>
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
      </section>
      : <section className="and19-panel and19-empty"><strong>Активных заявок нет</strong><p>Выберите необходимую помощь — мы покажем этапы поиска и отклики в заявке.</p></section>}
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
  // Tow operators have their own approved 20.11 workspace and milestones.
  // Do not reuse the master repair card or show TechBase to a tow driver.
  if (performer.kind === 'tow') return <AndroidTowWorkspace
    performer={performer} active={active} auctions={auctions} online={online}
    busy={busy} setLine={setLine} balance={balance} reloadAuctions={reloadAuctions}
    pendingReview={pendingReview}/>;
  const tow = false;
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
      <img src="/tracksos-approved-hero-owner-20261119.webp" alt="" aria-hidden="true" />
    </div>
    <div className="and19-metrics">
      <a href="#/work/jobs"><small>В работе</small><strong>{active.length}</strong></a>
      <a href="#/work/me/level"><small>Рейтинг</small><strong>{performer.rating != null ? Number(performer.rating).toFixed(1) : '—'}</strong></a>
      <a href="#/work/me/money"><small>К выплате</small><strong>{balance?.to_pay != null ? rub(balance.to_pay) : '—'}</strong></a>
    </div>
    {active.length ? <section className="and19-panel and19-main-order">
      <a className="and19-order-open" href={'#/order/' + active[0].id}>
        <OrderTitle order={active[0]} />
        <OrderFacts order={active[0]} />
        <MobileTimeline status={active[0].status} />
        <span className="and19-link">Продолжить работу по заявке <span aria-hidden="true">›</span></span>
      </a>
      {active.length > 1 && <a className="and19-row-link" href="#/work/jobs">Другие активные заявки: {active.length - 1} ›</a>}
    </section> : <section className="and19-panel and19-empty">
      <strong>{online ? 'Ожидаем подходящую заявку' : 'Вы не на линии'}</strong>
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

/** Evacuation: only approved 20 November work actions. No fake payouts,
 * virtual phone numbers, loaded/delivered statuses or prefilled destinations. */
function AndroidTowWorkspace({ performer, active, auctions, online, busy, setLine, balance,
  reloadAuctions, pendingReview }: {
  performer: any; active: any[]; auctions: any[]; online: boolean; busy: boolean;
  setLine: (status:string)=>void; balance:any; reloadAuctions:()=>void; pendingReview:number;
}) {
  const order = active[0];
  const inJob = performer.line_status === 'on_job';
  const stages = ['Принято','В пути','На месте','Погрузка','Доставлено'];
  const stageIndex: Record<string, number> = {
    accepted:0, en_route:1, arrived:2, working:3, awaiting_confirmation:3, completed:4
  };
  const progress = order ? stageIndex[order.status] ?? 0 : 0;
  const pickup = order?.address || order?.estimate?.zoneName || '';
  const delivery = order?.destination || order?.destination_address || order?.to_address || '';
  const vehicle = order?.vehicle || {};
  const brand = vehicle.brand || order?.v_brand || order?.brand;
  const model = vehicle.model || order?.v_model || order?.model;
  const year = vehicle.year || order?.v_year || order?.year;
  const navHref = pickup ? 'https://www.google.com/maps/dir/?api=1&destination=' +
    encodeURIComponent(pickup) : null;
  return <div className="and19-workspace and19-performer and20-tow" aria-label="Android кабинет эвакуаторщика">
    <div className="and19-role and19-line">
      <span>Эвакуаторщик</span>
      <button type="button" disabled={busy || inJob}
        className={online ? 'and19-online' : 'and19-offline'}
        aria-label={inJob ? 'На задании — изменение статуса недоступно' : 'Изменить доступность для вызовов'}
        onClick={()=>setLine(online ? 'offline' : 'online')}>
        <i/>{inJob?'На задании':online?'На линии':'Не на линии'}
        <span className="and19-toggle" aria-hidden="true"/>
      </button>
    </div>
    <h1 className="and20-tow-title">Рабочий стол</h1>
    <div className="and20-tow-metrics" aria-label="Рабочие показатели">
      <a href="#/work/jobs"><small>Новые</small><strong>{auctions.length}</strong></a>
      <a href="#/work/jobs"><small>В работе</small><strong>{active.length}</strong></a>
      <a href="#/work/me/schedule"><small>График</small><strong>Открыть</strong></a>
    </div>
    {order ? <section className="and19-panel and20-tow-job">
      <div className="and19-panel-title"><strong>Заявка №{order.number ?? '—'}</strong>
        <span className="and19-status">{STATUS[order.status]?.name ?? 'Статус уточняется'}</span></div>
      <VehicleModelPhoto brand={brand} model={model} year={year} className="and20-tow-photo"/>
      {order.description && <p className="and20-tow-problem">{order.description}</p>}
      <div className="and20-tow-route">
        <p><span aria-hidden="true">⌖</span><span><small>Точка погрузки</small>{pickup || 'Откройте адрес в заявке'}</span></p>
        <p><span aria-hidden="true">⚑</span><span><small>Пункт доставки</small>{delivery || 'Уточняется в заявке'}</span></p>
      </div>
      <ol className="and20-tow-timeline" aria-label="Этапы эвакуации">
        {stages.map((name,index)=><li key={name} className={index<progress?'passed':index===progress?'current':''}
          aria-current={index===progress?'step':undefined}>
          <span aria-hidden="true">{index<progress?'✓':index+1}</span><small>{name}</small>
        </li>)}
      </ol>
      {order.status==='awaiting_confirmation' && <p className="and20-tow-disclaimer">
        Работа передана на подтверждение. Доставку и оплату нельзя считать завершёнными без проверки статуса.
      </p>}
      <div className="and20-tow-actions">
        <a className="and20-tow-primary" href={'#/order/'+encodeURIComponent(order.id)}>
          Открыть заявку и следующий этап
        </a>
        {navHref && <a className="and20-tow-navigation" href={navHref} target="_blank"
          rel="noopener noreferrer">Навигация</a>}
      </div>
      {active.length>1 && <a className="and19-row-link" href="#/work/jobs">
        Остальные активные заявки · {active.length-1} ›
      </a>}
    </section> : <section className="and19-panel and19-empty">
      <strong>{online?'Ожидаем заявку на эвакуацию':'Вы не на линии'}</strong>
      <p>{online?'Новые предложения появятся здесь после назначения.':
        'Включите доступность, когда будете готовы принимать заявки.'}</p>
    </section>}
    {pendingReview>0 && <a className="and19-row-link" href="#/work/jobs">
      Ожидают подтверждения: {pendingReview} ›
    </a>}
    {auctions.length>0 && <section className="and19-auctions" aria-label="Новые вызовы">
      <h2>Предложения эвакуации · {auctions.length}</h2>
      {auctions.filter((a:any)=>a.service==='tow').map((a:any)=><article className="and19-panel" key={a.order_id}>
        <strong>{a.is_sos?'SOS · ':''}{a.brand||'Грузовой автомобиль'}</strong>
        <p>{a.address||a.estimate?.zoneName||'Адрес уточняется'}</p>
        <OfferForm orderId={a.order_id} limits={a.limits} myPrice={a.my_price} onDone={reloadAuctions}/>
      </article>)}
    </section>}
    {balance?.to_pay!=null && <a href="#/work/me/money" className="and19-row-link">
      Проверенные начисления <strong>{rub(balance.to_pay)} ›</strong>
    </a>}
    <div className="and19-quick">
      <a href="#/work/jobs">Мои заявки</a><a href="#/work/chats">Чат</a><a href="#/work/filter">Настройки вызовов</a>
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
