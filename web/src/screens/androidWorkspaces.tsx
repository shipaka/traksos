/* Android workspaces approved 19.11.2026. Only real API-backed values. */
import { useEffect, useState } from 'react';
import { get, post, rub } from '../api.ts';
import { SERVICES, STATUS } from '../dict.ts';
import { useLoad, useAction } from '../ui.tsx';
import { OfferForm } from './search.tsx';
import { insurancePresentation } from '../insurancePresentation.ts';

import { ApprovedEmptyScene } from '../approvedEmptyScene.tsx';
import { ApprovedServiceIllustration } from '../approvedServiceIllustration.tsx';
import { ApprovedOrderTruck } from '../approvedOrderTruck.tsx';
import { vehicleReferencePhoto } from '../vehiclePhotoCatalog.ts';
import { NavGlyph } from '../navGlyph.tsx';
import { OrderPhotoCapture } from './orderPhotos.tsx';

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

function stageTime(value: unknown): string | null {
  if (!value || (typeof value !== 'string' && !(value instanceof Date))) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null :
    new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit'}).format(date);
}
function MobileTimeline({ order }: { order: any }) {
  const status = order.status as string;
  const current = stage(status);
  const recorded = [order.created_at, order.accepted_at, order.en_route_at,
    order.arrived_at, order.completed_at];
  return <ol className="and19-timeline" aria-label="Ход выполнения заявки">
    {MILESTONES.map((title, index) => {
      const moment = stageTime(recorded[index]);
      return <li key={title} className={index < current ? 'passed' : index === current ? 'current' : ''}
        aria-current={index === current ? 'step' : undefined}>
        <span aria-hidden="true">{index < current || status === 'completed'
          ? <NavGlyph glyph="check" />
          : index === 2 ? <NavGlyph glyph="truck" /> : index === 3 ? <NavGlyph glyph="pin" />\n          : index === 4 ? <NavGlyph glyph="check" /> : index + 1}</span>
        <small>{title}</small>
        {moment && <time dateTime={new Date(recorded[index]).toISOString()}>{moment}</time>}
      </li>;
    })}
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

function OrderTitle({ order, client = false }: { order: any; client?: boolean }) {
  return <div className="and19-panel-title">
    <strong>{client ? 'Активная заявка' : 'Заявка'} №{order.number ?? '—'}</strong>
    <span className="and19-status">{STATUS[order.status]?.name || 'Статус уточняется'}</span>
  </div>;
}

function OrderFacts({ order }: { order: any }) {
  return <div className="and19-facts">
    {Boolean(order.description || order.problem) &&
      <p className="and19-issue"><NavGlyph glyph="alert"/><span>{order.description || order.problem}</span></p>}
    <p className="and19-order-address"><NavGlyph glyph="pin"/>
      <span>{order.service === 'consult' ? 'Консультация без выезда'
        : (order.address || order.estimate?.zoneName || 'Адрес — в карточке заявки')}</span></p>
    <VehicleLine order={order} />
  </div>;
}
/** A genuine Yandex road route only when a saved destination exists.
 * Without coordinates, route detail is the safe fallback; never invent ETA. */
function orderNavigationHref(order: any):string {
  const lat=Number(order.lat), lng=Number(order.lng);
  if(order.lat != null && order.lng != null && Number.isFinite(lat) &&
     Number.isFinite(lng) && Math.abs(lat)<=90 && Math.abs(lng)<=180) {
    return 'https://yandex.ru/maps/?rtext=~'+encodeURIComponent(lat+','+lng)+'&rtt=auto';
  }
  return '#/order/'+order.id;
}
function OrderRoute({order,role}:{order:any;role:'client'|'performer'}) {
  if(order.service==='consult')return null;
  const href=orderNavigationHref(order);
  const external=href.startsWith('https:');
  // Native WebView delegates non-TrakSOS HTTPS URLs via ACTION_VIEW.
  // It intentionally disables popup windows, so never use target=_blank there.
  const openNewTab=external && !document.documentElement.classList.contains('traksos-native');
  const eta=Number(order.dispatch_eta_minutes);
  return <div className="and19-order-route">
    <a href={href} className="and19-route-button"
      {...(openNewTab?{target:'_blank',rel:'noopener noreferrer'}:{})}
      aria-label={external?'Открыть дорожную навигацию по адресу заявки':'Открыть расположение и маршрут в заявке'}>
      <NavGlyph glyph="navigation"/>{role==='performer'?'Навигация':'Маршрут'}
    </a>
    <span className="and19-route-eta"><NavGlyph glyph="clock"/>
      {Number.isFinite(eta)&&eta>0&&eta<1441
        ? <span>ETA ≈ {Math.round(eta)} мин <small>расчёт при подборе</small></span>
        : <span>Время прибытия уточняется</span>}
    </span>
  </div>;
}

export function AndroidClientWorkspace({ orders, loading, error, me, retry, insuranceInProgress, disabledServices }: {
  orders: any[]; loading: boolean; error: string | null; me: any; retry: () => void;
  insuranceInProgress: any[];
  disabledServices?: {repair:boolean; tow:boolean; service:boolean; consult:boolean; shop:boolean};
}) {
  const current = orders.find(o => IN_PROGRESS.includes(o.status));
  const isDriver = !!me?.owner_id || me?.roles?.includes('driver');
  const vehicleBrand = current?.vehicle?.brand || current?.v_brand || current?.brand;
  const vehicleModel = current?.vehicle?.model || current?.v_model || current?.model;
  const vehicleYear = current?.vehicle?.year || current?.v_year || current?.year;
  const currentVehiclePhoto = current?.vehicle_id
    ? vehicleReferencePhoto(vehicleBrand, vehicleModel, vehicleYear) : null;
  const currentVehicleName = [vehicleBrand,vehicleModel,vehicleYear].filter(Boolean).join(' ');
  return <div className="and19-workspace and19-client" aria-label="Android рабочий стол клиента">
    <a className="and19-role and19-client-role" href="#/profile" aria-label="Открыть профиль и настройки кабинета">
      <span className="and19-role-caption"><NavGlyph glyph="◉" />{isDriver ? 'Водитель автопарка' : 'Клиент · Владелец автопарка'}</span>
      <span className="and19-role-chevron" aria-hidden="true">⌄</span>
    </a>
    <div className="and19-cover"><h1>Рабочий стол</h1></div>
    <div className="and19-services" aria-label="Вызвать помощь">
      <a href={disabledServices?.repair ? undefined : '#/sos'} aria-disabled={disabledServices?.repair || undefined}><span className="and19-service-symbol"><NavGlyph glyph="wrench"/></span><span className="and19-service-label">Выездной мастер</span><ApprovedServiceIllustration kind="repair" /></a>
      <a href={disabledServices?.tow ? undefined : '#/new/tow'} aria-disabled={disabledServices?.tow || undefined}><span className="and19-service-symbol"><NavGlyph glyph="tow"/></span><span className="and19-service-label">Эвакуатор</span><ApprovedServiceIllustration kind="tow" /></a>
      <a href={disabledServices?.service ? undefined : '#/services'} aria-disabled={disabledServices?.service || undefined}><span className="and19-service-symbol"><NavGlyph glyph="garage"/></span><span className="and19-service-label">СТО</span><ApprovedServiceIllustration kind="service" /></a>
      <a href={disabledServices?.consult ? undefined : '#/new/consult'} aria-disabled={disabledServices?.consult || undefined}><span className="and19-service-symbol"><NavGlyph glyph="headset"/></span><span className="and19-service-label">Консультация</span><ApprovedServiceIllustration kind="consult" /></a>
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
        <div className="and19-order-open">
          <a className="and19-order-heading-link" href={'#/order/' + current.id}
            aria-label={'Открыть заявку №' + current.number}>
            <OrderTitle order={current} client />
          </a>
          {current.service!=='consult' && <a className="and19-order-photo-link"
            href={current.vehicle_id ? '#/garage/' + current.vehicle_id : '#/order/' + current.id}
            aria-label={current.vehicle_id ? 'История и карточка автомобиля по заявке' : 'Открыть заявку и данные автомобиля'}>
            <ApprovedOrderTruck order={current} />
            {current.status === 'en_route' && <span className="and19-photo-badge">{current.service==='tow'?'Эвакуатор в пути':'Мастер в пути'}</span>}
          </a>}
          <OrderFacts order={current} />
          <OrderRoute order={current} role="client"/>
          {current.status !== 'searching' && <MobileTimeline order={current} />}
          {current.status === 'searching' && <p className="and19-search-active"><span className="and19-pulse" aria-hidden="true" />Поиск исполнителя продолжается · открыть отклики</p>}
        </div>

      </section>
      : <section className="and19-panel and19-empty"><strong>Активных заявок нет</strong><ApprovedEmptyScene kind="orders" /><p>Выберите необходимую помощь — здесь появятся только реальные этапы поиска и отклики в заявке.</p></section>}
    {current?.performer_name && <div className="and19-assigned-performer">
      <span className="and19-assigned-icon" aria-hidden="true"><NavGlyph glyph="◉"/></span>
      <span className="and19-assigned-copy">
        <strong>{current.performer_name}
          {current.performer_rating != null && Number.isFinite(Number(current.performer_rating)) &&
            <span className="and19-performer-rating" aria-label={'Рейтинг исполнителя ' + Number(current.performer_rating).toFixed(1)}>
              ★ {Number(current.performer_rating).toFixed(1).replace('.', ',')}
              {Number.isInteger(current.performer_rating_count) && current.performer_rating_count > 0 &&
                <small> ({current.performer_rating_count})</small>}
            </span>}
        </strong>
        <small>{SERVICES[current.service]?.name || 'Исполнитель'} · заявка №{current.number}</small>
      </span>
      <a href={'#/order/'+current.id} aria-label="Контакты исполнителя и подробности заявки"><NavGlyph glyph="phone"/></a>
      <a href={'#/order/'+current.id+'?chat=1'} aria-label="Открыть чат с исполнителем"><NavGlyph glyph="chat"/></a>
    </div>}
    {current && current.status !== 'searching' && Number.isFinite(current.money?.total) &&
      <div className="and19-price and19-client-cost" aria-label="Стоимость активной заявки">
        <NavGlyph glyph="wallet"/>
        <span>
          <strong>{['awaiting_confirmation','completed'].includes(current.status) ?
            'Сумма к подтверждению' : 'Итоговая стоимость'}</strong>
          {Number.isFinite(current.money?.amount) && Number.isFinite(current.money?.clientFee) &&
            <small>Работы {rub(current.money.amount)} + сервис TrakSOS {rub(current.money.clientFee)}</small>}
        </span>
        <strong>{rub(current.money.total)}</strong>
      </div>}
    {orders.length > 1 && <a href="#/orders" className="and19-row-link">Все мои заявки <span>{orders.length} ›</span></a>}
    <a href={current?.vehicle_id ? '#/garage/'+current.vehicle_id : '#/garage'} className="and19-equipment and19-equipment-vehicle">
      {currentVehiclePhoto ? <img className="and19-equipment-model" src={currentVehiclePhoto.src}
        alt={currentVehiclePhoto.description} loading="lazy" />
        : <span className="and19-equipment-icon" aria-hidden="true">▤</span>}
      <span><strong>{isDriver ? 'Моя машина' : 'Моя техника'}</strong>
        {current?.vehicle_id && currentVehicleName && <small className="and19-equipment-title">{currentVehicleName}</small>}
        <small>История обслуживания, заявки, документы</small></span>
      <span aria-hidden="true">›</span>
    </a>

    <a href="#/sos" className="and19-action and19-sos"><NavGlyph glyph="✚"/> Новая заявка на сервис</a>
  </div>;
}

export function AndroidPerformerWorkspace({ performer, active, auctions, online, busy, setLine, balance,
  reloadAuctions, reloadJobs, todayCount=0, pendingReview=0, reviewOnly=false }: {
  performer: any; active: any[]; auctions: any[]; online: boolean; busy: boolean;
  setLine: (status: string) => void; balance: any; reloadAuctions: () => void;
  reloadJobs?: () => void; todayCount?: number; pendingReview?: number; reviewOnly?:boolean;
}) {
  const tow = performer.kind === 'tow';
  const inJob = performer.line_status === 'on_job';
  const current=active[0];
  const { busy: stageBusy, run: runStage } = useAction();
  const stepForStatus: Record<string, {action:'depart'|'arrive'|'start_work';label:string}> = {
    accepted:{action:'depart',label:'Выехал'},
    en_route:{action:'arrive',label:'Я на месте'},
    arrived:{action:'start_work',label:'Начать работу'}
  };
  const nextStep=current ? stepForStatus[current.status] : null;
  const confirmStep=async()=>{
    if(!current || !nextStep || stageBusy || busy)return;
    if(!window.confirm('Подтвердить этап «'+nextStep.label+'» по заявке №'+current.number+'?'))return;
    const changed=await runStage(()=>post('/api/orders/'+current.id+'/step',
      {action:nextStep.action}), 'Этап заявки обновлён');
    if(changed)reloadJobs?.();
  };
  return <div className="and19-workspace and19-performer" aria-label="Android рабочий стол исполнителя">
    <div className="and19-role and19-line">
      <span className="and19-role-caption"><NavGlyph glyph="⚙" />{tow ? 'Эвакуаторщик' : 'Выездной мастер'}</span>
      <button type="button" disabled={busy || inJob} className={online ? 'and19-online' : 'and19-offline'}
        aria-label={inJob ? 'На выезде — нельзя сменить статус' : 'Изменить статус доступности'}
        onClick={() => setLine(online ? 'offline' : 'online')}>
        <i />{inJob ? 'На выезде' : online ? 'На линии' : 'Не на линии'}
        <span aria-hidden="true" className="and19-toggle" />
      </button>
    </div>
    <div className="and19-cover"><h1>Рабочий стол</h1></div>
    <div className="and19-metrics">
      <a href="#/work/jobs"><NavGlyph glyph="clipboard"/><span><small>Сегодня</small><strong>{todayCount} заяв.</strong></span></a>
      <a href="#/work/me/level"><NavGlyph glyph="star"/><span><small>Рейтинг</small><strong>{performer.rating != null ? Number(performer.rating).toFixed(1).replace('.',',') : '—'}</strong></span></a>
      <a href="#/work/me/money"><NavGlyph glyph="coins"/><span><small>К выплате</small><strong>{balance?.to_pay != null ? rub(balance.to_pay) : '—'}</strong></span></a>
    </div>
    {active.length ? <section className="and19-panel and19-main-order">
      <div className="and19-order-open">
        <a href={'#/order/'+current.id} className="and19-order-heading-link"
          aria-label={'Открыть заявку №'+current.number}><OrderTitle order={current}/></a>
        {current.service!=='consult' && <a className="and19-order-photo-link"
          href={'#/order/'+current.id+'/vehicle'} aria-label="Открыть технику и историю работ по заявке">
          <ApprovedOrderTruck order={current} />
        </a>}
        <OrderFacts order={current} />
        {current.client_name && <div className="and19-assigned-performer and19-client-contact">
          <span className="and19-assigned-icon" aria-hidden="true"><NavGlyph glyph="◉"/></span>
          <span className="and19-assigned-copy"><strong>{current.client_name}</strong>
            <small>Клиент по заявке №{current.number}</small></span>
          <a href={'#/order/'+current.id+'/client'} aria-label="Контакты клиента по заявке"><NavGlyph glyph="phone"/></a>
          <a href={'#/order/'+current.id+'/chat'} aria-label="Открыть чат заявки"><NavGlyph glyph="chat"/></a>
        </div>}
        <OrderRoute order={current} role="performer"/>
        <MobileTimeline order={current}/>
      </div>
      <div className="and19-stage-actions">
        {nextStep ? <button type="button" className="and19-stage-primary"
          disabled={stageBusy||busy} onClick={()=>{void confirmStep()}}>
          <NavGlyph glyph={current.status==='en_route'?'pin':'check'}/>
          {nextStep.label}
        </button> : <a className="and19-stage-primary"
          href={'#/order/'+current.id+'/finance'}>
          {current.status==='working'?'Оформить результат':'Проверить заявку'}
        </a>}
        {current.status==='working'
          ? <a href={'#/order/'+current.id+'/finance'} className="and19-stage-complete">
              <NavGlyph glyph="check"/>Завершить
            </a>
          : <span className="and19-stage-complete is-disabled" aria-disabled="true">
              <NavGlyph glyph="check"/>Завершить
            </span>}
      </div>
      {active.length>1 && <a className="and19-row-link" href="#/work/jobs">
        Другие активные заявки: {active.length-1} ›</a>}
    </section> : <section className="and19-panel and19-empty">
      <strong>{online ? 'Ожидаем подходящую заявку' : 'Вы не на линии'}</strong>
      <ApprovedEmptyScene kind="shift" />
      <p>{online ? 'Когда заявка поступит, вы получите входящий вызов. Приложение не нужно держать открытым.' : 'Включите статус «На линии», чтобы получать заявки. При необходимости настройте график.'}</p>
      <a href="#/work/filter" className="and19-link">Настройки заявок ›</a>
    </section>}
    {current && current.money && Number.isFinite(current.money.amount) &&
      <a href={'#/order/'+current.id+'/finance'} className="and19-performer-finance"
        aria-label="Открыть реальный расчёт стоимости, комиссии и выплаты">
        <span><NavGlyph glyph="coins"/><small>Стоимость работ</small>
          <strong>{rub(current.money.amount)}</strong></span>
        <span><NavGlyph glyph="₽"/><small>Комиссия платформы</small>
          <strong>{Number.isFinite(current.money.commission)?rub(current.money.commission):'—'}
            {Number.isFinite(current.money.commissionPct) &&
              <em> ({current.money.commissionPct}%)</em>}</strong></span>
        <span><NavGlyph glyph="wallet"/><small>К получению</small>
          <strong>{Number.isFinite(current.money.payout)?rub(current.money.payout):'—'}</strong></span>
      </a>}
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
    {current ? <nav className="and19-quick" aria-label="Дополнительные действия заявки">
      <OrderPhotoCapture orderId={current.id} reviewOnly={reviewOnly}/>
      <a href={'#/order/'+current.id+'/finance'}><NavGlyph glyph="filetext"/>Отчёт</a>
      <a href="#/shop"><NavGlyph glyph="⚙"/>Запчасти</a>
    </nav> : <nav className="and19-quick" aria-label="Действия специалиста">
      <a href="#/work/jobs"><NavGlyph glyph="clipboard"/>Заявки</a>
      <a href="#/work/me/money"><NavGlyph glyph="wallet"/>Финансы</a>
      <a href="#/work/filter"><NavGlyph glyph="⚙"/>Фильтры</a>
    </nav>}
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
