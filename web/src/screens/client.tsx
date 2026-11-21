import { useEffect, useState, type ReactNode } from 'react';
import { get, post, postOrder, put, patch, del, rub, fmtTime, fmtPhone } from '../api.ts';
import { SERVICES, SYMPTOMS, TIERS, STATUS, CONSULT_CONF, ON_SITE, seriesHint } from '../dict.ts';
import { useLoad, useAction, useMe, go, Loading, Field, Chips, Back, VehicleFields, LiveStrip, type VehicleValue } from '../ui.tsx';
import { BookingRows, BookingList, isOpenBooking } from './base.tsx';
import { DriverRules } from './fleet.tsx';
import { VehicleServiceApplication, VehicleServiceHistory } from './vehicleServices.tsx';
import { native } from '../native.ts';
import { saveNewOrderDraft, readNewOrderDraft, clearNewOrderDraft, type SavedNewOrderDraft } from '../orderDraft.ts';
import { insurancePresentation, isOpenInsuranceRequest } from '../insurancePresentation.ts';
import { VehiclePhotoLink } from '../vehicleVisual.tsx';
import { APPROVED_VISUALS } from '../approvedVisuals.ts';
import { ApprovedEmptyScene } from '../approvedEmptyScene.tsx';
import { ApprovedServiceIllustration } from '../approvedServiceIllustration.tsx';
import { ApprovedOrderTruck } from '../approvedOrderTruck.tsx';
import { AndroidClientWorkspace, useMobileWorkspace } from './androidWorkspaces.tsx';

// Главная: «Что случилось?» и услуги — как в демо --------------------------

/** Подставляет цены площадки в подсказки: {consult}, {eco}, {pro}, {tow} */
export function usePrices() {
  const pricing = useLoad(() => get('/api/pricing'), []);
  const p = pricing.data;
  const fill = (t: string) => !p ? t.replace(/\{\w+\}/g, '…') : t
    .replace('{consult}', rub(p.consult?.price ?? 70_000))
    .replace('{eco}', rub(p.tiers.eco.callOut)).replace('{pro}', rub(p.tiers.pro.callOut))
    .replace('{tow}', rub(p.towBase ?? 3_000_000));
  return { pricing: p, fill };
}


/** Same cabinet, but owner-disabled non-emergency actions are visibly unavailable. */
function FleetShortcut({href,locked,className,children}:{
  href:string; locked:boolean; className:string; children:ReactNode;
}) {
  return <a href={locked ? undefined : href} role={locked ? 'group' : undefined}
    className={className+(locked ? ' fleet-limited' : '')} aria-disabled={locked || undefined}>
    {children}
  </a>;
}

export function Home() {
  const { me } = useMe();
  const mobileWorkspace = useMobileWorkspace();
  const fleetRules = useLoad(() => me?.owner_id ? get('/api/fleet/rules') : Promise.resolve(null),[me?.owner_id]);
  const restricted = (permission:'repair'|'tow'|'service'|'consult'|'insurance'|'inspection'|'shop') =>
    !!me?.owner_id && (!fleetRules.data || fleetRules.data.allow?.[permission] === false);
  const active = useLoad(() => get('/api/orders'), [], (e) => e.type === 'order');
  const services = useLoad(() => get<any[]>('/api/vehicle-service-requests'), [],
    e => e.type === 'vehicle_service' || e.type === 'connection_restored');
  const insuranceInProgress = (services.data ?? []).filter(r =>
    r.kind === 'insurance' && isOpenInsuranceRequest(r.status));
  const live = (active.data ?? []).filter((o: any) => !['completed', 'cancelled'].includes(o.status));
  // The same approved Android-sized workspace is the ONLY signed-in phone UI,
  // both in the APK WebView and the mobile browser. Previously the browser
  // silently fell through to the obsolete desktop hero and widgets.
  // Keep fleet permissions and real order data identical across both.
  if (mobileWorkspace) return <main className="client-home client-dashboard">
    <AndroidClientWorkspace orders={live} loading={!active.data && !active.error} error={active.error}
      retry={active.reload} me={me} insuranceInProgress={insuranceInProgress}
      disabledServices={{repair:restricted('repair'),tow:restricted('tow'),service:restricted('service'),consult:restricted('consult'),shop:restricted('shop')}} />
  </main>;
  return (
    <main className="client-home client-dashboard">
      <section className="desktop-hero" aria-label="Помощь грузовому транспорту">
        <div className="desktop-hero-copy">
          <span className="desktop-eyebrow">TRAKSOS · САНКТ-ПЕТЕРБУРГ И ЛЕНОБЛАСТЬ</span>
          <h1>Помощь грузовикам в пути <span>24/7</span></h1>
          <p>Выездной мастер, эвакуатор, грузовые СТО и консультации. Заявки, страхование и запчасти — в одном кабинете.</p>
          <div className="desktop-hero-buttons">
            <a className="desktop-primary-action" href="#/sos">SOS · Помощь в дороге ↗</a>
            <a className="desktop-outline-action" href="#/orders">Мои заявки</a>
          </div>
          <div className="launch-region" role="note">Зона запуска: Санкт-Петербург и Ленинградская область</div>
        </div>
        <img className="client-hero-scania" src={APPROVED_VISUALS.workspaceTruck} alt="Иллюстрация грузовика на дороге, не транспорт клиента" loading="eager" />
      </section>

      {insuranceInProgress.length>0&&(()=>{
        const urgent=insuranceInProgress.find(r =>
          insurancePresentation(r.insurance_stage,r.status).tone==='action') ?? insuranceInProgress[0];
        const state=insurancePresentation(urgent.insurance_stage,urgent.status);
        return <section className="client-insurance-mobile-quick" aria-label="Быстрый статус страховой заявки">
          <a className={'client-insurance-mobile-strip tone-'+state.tone}
            href={urgent.insurance_stage?`#/insurance/request/${urgent.id}`:'#/garage'}>
            <span className="client-insurance-mobile-icon" aria-hidden="true">◇</span>
            <span className="client-insurance-mobile-info">
              <span className="client-insurance-mobile-eyebrow">СТРАХОВАНИЕ · {urgent.brand} {urgent.model??''}</span>
              <strong>{state.label}</strong>
              <small>{state.next}</small>
            </span>
            <span className="client-insurance-mobile-arrow" aria-hidden="true">›</span>
          </a>
        </section>;
      })()}
      <section className="desktop-quick-links" aria-label="Выберите помощь">
        <FleetShortcut href="#/sos" locked={false} className="desktop-quick-card"><span className="desktop-quick-icon">⚡</span><span><b>Выездной мастер</b><small>Электрика, диагностика, пневматика, шиномонтаж</small></span><ApprovedServiceIllustration kind="repair" /><span aria-hidden="true">↗</span></FleetShortcut>
        <FleetShortcut href="#/new/tow" locked={restricted("tow")} className="desktop-quick-card"><span className="desktop-quick-icon">↗</span><span><b>Эвакуатор</b><small>{restricted("tow") ? "Ограниченный доступ · разрешает владелец" : "Тягач, полуприцеп или сцепка"}</small></span><ApprovedServiceIllustration kind="tow" /><span aria-hidden="true">↗</span></FleetShortcut>
        <FleetShortcut href="#/services" locked={restricted("service")} className="desktop-quick-card"><span className="desktop-quick-icon">▤</span><span><b>СТО грузовых автомобилей</b><small>{restricted("service") ? "Ограниченный доступ · разрешает владелец" : "Выбор сервиса и запись на ремонт"}</small></span><ApprovedServiceIllustration kind="service" /><span aria-hidden="true">↗</span></FleetShortcut>
        <FleetShortcut href="#/new/consult" locked={restricted("consult")} className="desktop-quick-card"><span className="desktop-quick-icon">☎</span><span><b>Консультация по телефону</b><small>{restricted("consult") ? "Ограниченный доступ · разрешает владелец" : "Обсудить проблему со специалистом"}</small></span><ApprovedServiceIllustration kind="consult" /><span aria-hidden="true">↗</span></FleetShortcut>
      </section>

      <div className="desktop-home-columns">
        <section className="desktop-home-main">
          <div className="mobile-home-heading">
            <h1>{me?.name ? `${me.name}, что случилось?` : 'Что случилось?'}</h1>
            <div className="sub">Выберите проблему — подскажем, к кому обратиться. Работаем в Санкт-Петербурге и Ленинградской области.</div>
          </div>
          <div className="desktop-section-heading"><h2>Мои активные заявки</h2><a href="#/orders">Все заявки →</a></div>
          <div className="desktop-active-orders">
            {active.error ? <div className="desktop-empty-orders">Не удалось загрузить заявки. <a href="#/orders">Открыть раздел</a></div> : !active.data ? <div className="desktop-empty-orders">Загружаем заявки…</div> : live.length === 0 ? <div className="desktop-empty-orders tr-approved-empty-card">
               <ApprovedEmptyScene kind="orders" />
               <strong>Активных заявок пока нет</strong>
               <span>Выберите помощь — здесь появится ход реальной заявки, связь с исполнителем и статусы.</span>
               <a className="tr-approved-empty-action" href="#/sos">Создать заявку на помощь →</a>
               <small>Иллюстрация маршрута — пример, не выполняемая заявка. Страховые заявки отображаются отдельно.</small>
             </div> : null}
            {live.map((o: any) => (
              <a key={o.id} href={`#/order/${o.id}`} className="card hi" style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="between">
                  <b>Заявка №{o.number} · {SERVICES[o.service]?.name ?? o.service}</b>
                  <span className={`pill ${o.unilateral_status==='disputed'?'warn':STATUS[o.status]?.tone}`}>
                {o.unilateral_status==='pending_client'?'Работа сдана · нужен ваш ответ'
                  :o.unilateral_status==='disputed'?'На разбирательстве'
                  :STATUS[o.status]?.name}
              </span>
                </div>
                {o.service!=='consult' && <ApprovedOrderTruck order={o} />}
                <span className="note">{o.service === 'consult' ? 'по телефону' : o.address ?? o.estimate?.zoneName} · открыть →</span>
              </a>
            ))}
          </div>
          {insuranceInProgress.length>0&&<section className="client-insurance-home stack" aria-label="Мои активные страховые заявки">
            <div className="client-insurance-home-heading">
              <span><span className="insurance-step-title">TRAKSOS · СТРАХОВАНИЕ</span>
                <h2>Активные страховые заявки</h2>
              </span>
              <a href="#/garage">Все страховки →</a>
            </div>
            <div className="client-insurance-home-list">
              {insuranceInProgress.slice(0,3).map(r=>{
                const state=insurancePresentation(r.insurance_stage,r.status);
                return <a key={r.id} className={'client-insurance-home-card tone-'+state.tone}
                  href={r.insurance_stage?`#/insurance/request/${r.id}`:'#/garage'}>
                  <span className="client-insurance-home-vehicle">{r.brand} {r.model??''} · {r.plate||'номер не указан'}</span>
                  <strong>{state.label}</strong>
                  <span className="client-insurance-home-next">{state.next}</span>
                  <span className="client-insurance-home-open">Открыть заявку →</span>
                </a>;
              })}
            </div>
            {insuranceInProgress.length>3&&<span className="note">
              Ещё {insuranceInProgress.length-3} активных заявок — в разделе «Мой транспорт»
            </span>}
          </section>}
          <div className="desktop-section-heading"><h2>Сервисы TrakSOS</h2></div>
          <section className="client-dashboard-hubs" aria-label="Разделы кабинета">
            <FleetShortcut href="#/garage" locked={restricted("insurance") && restricted("inspection")} className="client-dashboard-hub"><span className="client-dashboard-hub-icon">◇</span><b>Страхование и техосмотр</b><small>{restricted("insurance") && restricted("inspection") ? "Ограниченный доступ · разрешает владелец" : "Документы и оформление для вашей техники"}</small><em>К автомобилям →</em></FleetShortcut>
            <FleetShortcut href="#/shop" locked={restricted("shop")} className="client-dashboard-hub"><span className="client-dashboard-hub-icon">▧</span><b>Грузовые запчасти</b><small>{restricted("shop") ? "Ограниченный доступ · разрешает владелец" : "Поиск, аналоги и история покупок. Магазин пока закрыт"}</small><em>Открыть раздел →</em></FleetShortcut>
            <a href="#/garage"><span className="client-dashboard-hub-icon">▤</span><b>Мой транспорт</b><small>Грузовики, прицепы и история обслуживания</small><em>Мой гараж →</em></a>
            <a href="#/support"><span className="client-dashboard-hub-icon">☏</span><b>Поддержка</b><small>Обращения и помощь по вашим заявкам</small><em>Написать →</em></a>
          </section>
        </section>
        <aside className="desktop-home-aside">
          <div className="desktop-aside-card">
            <div className="desktop-aside-symbol">24/7</div>
            <h2>Поддержка в дороге</h2>
            <p>Экстренный вызов мастера или эвакуатора, консультация и поиск сервиса.</p>
            <a href="#/sos" className="desktop-aside-cta">Перейти к SOS →</a>
          </div>
          <div className="desktop-aside-card"><h2>Ваш кабинет</h2><p>Профиль и уведомления доступны в личном кабинете.</p><a href="#/profile" className="desktop-aside-cta">Открыть профиль →</a></div>
        </aside>
      </div>

    </main>
  );
}

/** Direction-first SOS workflow is the single active customer help entry point. */
export function Sos() {
  const [direction, setDirection] = useState<'master' | 'tow' | 'service' | null>(null);
  const options = [
    { id: 'master', name: 'Выездной мастер', icon: '⚡', detail: 'Электрик, диагност, пневматика, отопители, шиномонтаж' },
    { id: 'tow', name: 'Эвакуатор', icon: '↗', detail: 'Тягач, прицеп или сцепка — перевозка и подача' },
    { id: 'service', name: 'Грузовая СТО', icon: '▤', detail: 'Найти сервис, записаться, согласовать ремонт' },
  ] as const;
  const specialties = [
    { href: '#/new/electric?sos=light', icon: '⚡', name: 'Электрик', note: 'Проводка, запуск, освещение' },
    { href: '#/new/diag?sos=error', icon: '▣', name: 'Диагност', note: 'Ошибки ЭБУ, аварийный режим' },
    { href: '#/new/air?sos=air', icon: '◉', name: 'Пневматика и тормоза', note: 'ABS/EBS, воздух, тормоза' },
    { href: '#/new/autonomy?sos=heater', icon: '≋', name: 'Автономные отопители', note: 'Отопитель, печка' },
    { href: '#/new/tyre?sos=wheel', icon: '◎', name: 'Шиномонтаж', note: 'Колесо и проколы' },
  ];
  const chosen = options.find((item) => item.id === direction);
  return (
    <main className="client-sos-directions">
      <Back to="" />
      <div className="client-sos-intro">
        <span className="label">TRAKSOS · СРОЧНАЯ ПОМОЩЬ</span>
        <h1>Помощь в дороге</h1>
        <p>Выберите направление. Затем укажете машину, местоположение и детали заявки.</p>
      </div>
      {!direction ? (
        <section className="client-sos-choices" aria-label="Направление помощи">
          {options.map((item) => (
            <button key={item.id} type="button" className="client-sos-choice" onClick={() => setDirection(item.id)}>
              <span className="client-sos-choice-icon" aria-hidden="true">{item.icon}</span>
              <span><b>{item.name}</b><small>{item.detail}</small></span>
              <span aria-hidden="true">↗</span>
            </button>
          ))}
          <a href="#/new/consult" className="client-sos-consult-link">
            <span className="client-sos-choice-icon" aria-hidden="true">☏</span>
            <span><b>Консультация</b><small>Помощь специалиста по телефону, без выезда</small></span>
            <span aria-hidden="true">↗</span>
          </a>
        </section>
      ) : (
        <section className="client-sos-selected">
          <div className="client-sos-selected-header">
            <div><span className="label">ВЫБРАНО НАПРАВЛЕНИЕ</span><h2>{chosen?.name}</h2></div>
            <button type="button" className="chip" onClick={() => setDirection(null)}>Изменить</button>
          </div>
          {direction === 'master' ? <>
            <p className="note">Выберите специализацию. Описание поломки можно будет уточнить своими словами.</p>
            <div className="client-sos-specialties">
              {specialties.map((item) => (
                <a key={item.href} href={item.href} className="client-sos-specialty">
                  <span className="client-sos-specialty-icon" aria-hidden="true">{item.icon}</span>
                  <span><b>{item.name}</b><small>{item.note}</small></span>
                  <span aria-hidden="true">↗</span>
                </a>
              ))}
            </div>
          </> : direction === 'tow' ? <>
            <p className="note">Для эвакуации укажете тип машины или сцепки, откуда и куда её везти.</p>
            <a className="btn" href="#/new/tow?sos=accident">Оформить вызов эвакуатора →</a>
          </> : <>
            <p className="note">В каталоге грузовых СТО выберите подходящий сервис и отправьте запрос на запись.</p>
            <a className="btn" href="#/services">Выбрать СТО →</a>
          </>}
        </section>
      )}
      {direction && <div className="client-sos-secondary"><span>Не знаете, кто нужен?</span><a href="#/new/consult">Консультация по телефону →</a></div>}
      <MyPlace />
    </main>
  );
}

/** «Ваше место: по GPS · Изменить» — место подставится в заявку само */
function MyPlace() {
  const { pricing } = usePrices();
  const [pos, setPos] = useState<{ lat: number; lng: number; acc: number } | null>(null);
  const [state, setState] = useState<'wait' | 'ok' | 'fail'>('wait');
  const [edit, setEdit] = useState(false);
  const [addr, setAddr] = useState(() => { try { return JSON.parse(sessionStorage.getItem('traksos.prefill') ?? '{}').address ?? ''; } catch { return ''; } });
  useEffect(() => {
    if (!navigator.geolocation) { setState('fail'); return; }
    navigator.geolocation.getCurrentPosition((p) => { setPos({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }); setState('ok'); }, () => setState('fail'), { timeout: 8000, maximumAge: 120_000 });
  }, []);
  const km = pos ? Math.round(Math.hypot((pos.lat - 59.9343) * 111, (pos.lng - 30.3351) * 111 * Math.cos(pos.lat * Math.PI / 180))) : null;
  const zones = [...(pricing?.zones ?? [])].sort((a: any, b: any) => (a.km ?? 0) - (b.km ?? 0));
  const zone = km == null ? null : zones.find((z: any) => km <= (z.km || 20)) ?? zones[zones.length - 1];
  const save = () => { try { const v = JSON.parse(sessionStorage.getItem('traksos.prefill') ?? '{}'); sessionStorage.setItem('traksos.prefill', JSON.stringify({ ...v, address: addr })); } catch { /* */ } setEdit(false); };
  return (
    <div className="card">
      <div className="between">
        <span className="stack" style={{ gap: 0 }}>
          <span>Ваше место: <b style={{ color: 'var(--accent)' }}>{addr || (state === 'ok' ? (zone ? zone.name : 'по GPS') : state === 'wait' ? 'определяю…' : 'не определено')}</b></span>
          <small className="note">{addr ? 'указано вами' : state === 'ok' ? `по GPS · точность ~${Math.round(pos!.acc)} м${km != null ? ` · ${km} км от центра` : ''}` : state === 'fail' ? 'разрешите геолокацию или укажите вручную' : ''}</small>
        </span>
        <button type="button" className="btn ghost small" onClick={() => setEdit(!edit)}>Изменить</button>
      </div>
      {edit && (
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input className="field" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Адрес, стоянка или км трассы" />
          <button type="button" className="btn small" onClick={save}>OK</button>
        </div>
      )}
    </div>
  );
}

// Консультация по телефону — отдельная услуга: фиксированная цена, без выезда ----

export function Consult() {
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const sym = SYMPTOMS.find((p) => p.id === params.get('p'));
  const { busy, run } = useAction();
  const { me } = useMe();
  const { pricing } = usePrices();
  const vehicles = useLoad(() => get('/api/vehicles'), []);
  const [vehicleId, setVehicleId] = useState('');
  const [car, setCar] = useState<VehicleValue>({ brand: '', model: '', year: '' });
  const [description, setDescription] = useState(sym ? sym.name + '. ' : '');
  const [agree, setAgree] = useState(false);
  useEffect(() => { if (vehicles.data?.length && !vehicleId) setVehicleId(vehicles.data[0].id); }, [vehicles.data]); // eslint-disable-line
  const [tried, setTried] = useState(false);
  const consultMethod = pricing?.payments?.online ? 'online' : pricing?.payments?.invoice ? 'invoice'
    : pricing?.payments?.cash ? 'cash' : null;
  const needC = { car: !!vehicleId || car.brand.trim().length >= 2 };
  const missingC = [
    !needC.car && { id: 'f-car', name: 'марка машины' },
    !agree && { id: 'f-agree', name: 'согласие' },
    !consultMethod && { id: 'f-pay', name: 'безналичный способ оплаты' },
  ].filter(Boolean) as { id: string; name: string }[];
  if (!pricing) return <main><Loading /></main>;
  const c = pricing.consult ?? { price: 70_000, backDiscount: 20_000, backHours: 48 };

  async function submit() {
    const r = await run(() => postOrder( {
      service: 'consult', problem: sym?.id, description: description.trim() || undefined,
      vehicleId: vehicleId || undefined, ...carBody(vehicleId, car), paymentMethod: consultMethod ?? 'online',
    }));
    if (r) go(`order/${r.order.id}`);
  }

  return (
    <main>
      <Back to="" />
      <div><h1>Консультация по телефону</h1><div className="sub">Мастер ответит голосом и в чате, откуда бы вы ни звонили. Выезда нет — только разговор.</div></div>
      <SelfOrderWarning me={me} />
      <DriverRules />
      <div className="card flat">
        <div className="sum total"><span>Стоимость консультации</span><span>{rub(c.price)}</span></div>
        <div className="banner good"><span>Если в течение {c.backHours} часов понадобится выезд — к этому или другому мастеру, — <b>{rub(c.backDiscount)} вернутся скидкой</b> на него.</span></div>
      </div>

      <Step n={1} id="f-car" title="Машина" req done={needC.car} missing={tried && !needC.car}>
        {vehicles.data?.length ? (
          <select className="field" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            {vehicles.data.map((v: any) => <option key={v.id} value={v.id}>{v.brand} {v.model ?? ''} {v.year ?? ''} {v.plate ?? ''}</option>)}
            <option value="">Другая машина</option>
          </select>
        ) : null}
        {!vehicleId && <VehicleFields value={car} onChange={setCar} />}
        <span className="note">Нужна только марка: ответит мастер, который хорошо её знает. Откуда вы звоните — не важно, консультация работает по всей России.</span>
      </Step>

      <Step n={2} id="f-what" title="Что случилось · по желанию">
        <textarea className="field" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Можно не писать — расскажете мастеру по телефону. Код ошибки, если есть." />
      </Step>

      <div className="card">
        <b>Как это работает</b>
        <ol className="howto">
          <li>Мастер берёт заявку и связывается с вами через TrakSOS: звонок и чат, вся переписка сохраняется.</li>
          <li>В конце мастер оставляет подсказку: что подозревает и насколько уверен.</li>
          <li>Вы нажимаете «Вопрос решён» — или «Нужен выезд»: подсказка перейдёт мастеру на выезде, а вам скидка.</li>
          <li>Консультация — предварительное мнение, а не диагностика. Деньги вернём, только если помощи не было: мастер не ответил или бросил разговор.</li>
          <li>Не нажали «Вопрос решён» — консультация закроется сама через сутки.</li>
        </ol>
      </div>

      <label className={`agree card ${tried && !agree ? 'missing' : ''}`} id="f-agree">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>Согласен со стоимостью {rub(c.price)} и <a href="#/offer/client">офертой TrakSOS</a></span>
      </label>
      {!consultMethod && <div id="f-pay" className="banner warn">Консультация будет доступна после подключения безналичной оплаты. Наличные не принимаются.</div>}
      <CallBar busy={busy} missing={missingC} price={rub(c.price)} label={`Заказать консультацию · ${rub(c.price)}`}
        onGo={() => { setTried(true); if (missingC.length) jump(missingC[0].id); else submit(); }} />
    </main>
  );
}

const MIN_WHAT = 10;

/** Шаг анкеты: номер, «обязательно» / «по желанию», галочка, когда заполнен; подсвечивается, если пропущен */
function Step({ n, id, title, req, done, missing, children }: { n: number; id: string; title: string; req?: boolean; done?: boolean; missing?: boolean; children: React.ReactNode }) {
  return (
    <section id={id} className={`step-card ${missing ? 'missing' : ''}`}>
      <div className="step-head">
        <span className={`step-n ${done ? 'done' : ''}`}>{done ? '✓' : n}</span>
        <b>{title}</b>
        <span className={`pill ${req ? (done ? 'good' : 'warn') : ''}`}>{req ? (done ? 'готово' : 'обязательно') : 'можно не менять'}</span>
      </div>
      {children}
    </section>
  );
}

/** Нижняя панель вызова: всегда видна, говорит, чего не хватает; нажали раньше времени — ведёт к пропущенному */
function CallBar({ busy, missing, price, label, onGo }: { busy: boolean; missing: { id: string; name: string }[]; price: string; label: string; onGo: () => void }) {
  return (
    <div className="callbar">
      <div className="callbar-in">
        <span className="note">{missing.length ? <>Осталось: <b style={{ color: 'var(--warn)' }}>{missing.map((m) => m.name).join(', ')}</b></> : <>Всё заполнено · {price}</>}</span>
        <button className={`btn ${missing.length ? 'pending' : ''}`} disabled={busy} onClick={onGo}>{missing.length ? `${label} · заполнить ${missing.length}` : label}</button>
      </div>
    </div>
  );
}

function jump(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

/** Машина не из гаража: марка, модель и год — в заявку */
function carBody(vehicleId: string, car: VehicleValue) {
  if (vehicleId) return {};
  return { brand: car.brand.trim() || undefined, model: car.model.trim() || undefined, year: car.year ? Number(car.year) : undefined };
}

/** Исполнитель заказывает сам себе — свою заявку он взять не сможет */
function SelfOrderWarning({ me }: { me: any }) {
  if (!me?.roles?.some((r: string) => r === 'master' || r === 'tow')) return null;
  return (
    <div className="banner warn"><span>Вы заказываете со своего номера исполнителя. Свою заявку вы взять не сможете — её увидят другие мастера. Для проверки звонка заказывайте с другого номера.</span></div>
  );
}

// Новая заявка --------------------------------------------------------------

export function NewOrder({ service }: { service: string }) {
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const sos = SYMPTOMS.find((p) => p.id === params.get('sos'));
  const sym = sos ?? SYMPTOMS.find((p) => p.id === params.get('p'));
  const fromConsult = params.get('from');
  const parallelWith = service === 'tow' ? params.get('parallel') : null;
  const continueFrom = service === 'tow' ? params.get('continue') : null;
  const recommendationId = params.get('recommendation');
  const preferredPerformerId = params.get('preferred') ?? '';
  const { me } = useMe();
  const { busy, run } = useAction();
  const pricing = useLoad(() => get('/api/pricing'), []);
  const vehicles = useLoad(() => get('/api/vehicles'), []);
  const pastPerformers = useLoad(() => preferredPerformerId ? get('/api/my-performers') : Promise.resolve([]), [preferredPerformerId]);
  const selectedPerformer = (pastPerformers.data ?? []).find((p:any) => p.id === preferredPerformerId);
  const consult = useLoad(() => (fromConsult ? get(`/api/orders/${fromConsult}`) : Promise.resolve(null)), [fromConsult]);
  const parallelSource = useLoad(() => ((parallelWith||continueFrom) ? get(`/api/orders/${parallelWith||continueFrom}`) : Promise.resolve(null)), [parallelWith,continueFrom]);
  const [parallelAgree,setParallelAgree] = useState(false);
  const [agree, setAgree] = useState(false);

  // A region is not a tariff zone. Neither GPS nor IP must silently assign
  // the Petersburg call-out price to another part of the country.
  const [regionId, setRegionId] = useState<'' | 'spb' | 'lo' | 'other'>('');
  const [zoneId, setZoneId] = useState('');
  const [coverageError, setCoverageError] = useState('');
  const [tier, setTier] = useState<'eco' | 'comfort' | 'pro'>(service === 'diag' ? 'pro' : 'eco');
  const [night, setNight] = useState<boolean | null>(null);
  const [group, setGroup] = useState(false);
  const [vehicleId, setVehicleId] = useState<string>('');
  const [car, setCar] = useState<VehicleValue>({ brand: '', model: '', year: '' });
  const [description, setDescription] = useState(sym ? sym.name : '');
  const [prefill] = useState<{ address?: string; destination?: string }>(() => { try { const v = JSON.parse(sessionStorage.getItem('traksos.prefill') ?? '{}'); sessionStorage.removeItem('traksos.prefill'); return v; } catch { return {}; } });
  const [address, setAddress] = useState(prefill.address ?? '');
  const [roadside, setRoadside] = useState(false);
  const [roadName, setRoadName] = useState('');
  const [roadKm, setRoadKm] = useState('');
  const [roadDirection, setRoadDirection] = useState('');
  const [roadSide, setRoadSide] = useState<'right'|'left'|'unknown'>('unknown');
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [geoState, setGeoState] = useState<'idle' | 'wait' | 'ok' | 'fail'>('idle');
  const [method, setMethod] = useState<'cash' | 'online' | 'invoice'>('online');
  const [est, setEst] = useState<any>(null);
  const [destination, setDestination] = useState(prefill.destination ?? '');
  const [cargo, setCargo] = useState<'tractor' | 'semitrailer' | 'coupling' | 'truck12' | 'bus' | 'special'>('tractor');
  const [loaded, setLoaded] = useState<'empty' | 'loaded' | 'adr'>('empty');
  const [driverOnSite, setDriverOnSite] = useState(true);
  const isTow = service === 'tow';
  const isConsult = service === 'consult';

  useEffect(() => {
    if (pricing.data && night === null) setNight(pricing.data.nightNow);
  }, [pricing.data]); // eslint-disable-line
  useEffect(() => {
    if (vehicles.data?.length && !vehicleId) setVehicleId(vehicles.data[0].id);
  }, [vehicles.data]); // eslint-disable-line
  // A second tow must use the very same incident and car.
  useEffect(()=>{
    const source=parallelSource.data;
    if(!source)return;
    setAddress(source.address??'');
    setRegionId(source.locationRegion??'');
    setZoneId(source.zoneId??'');
    if(source.vehicleId)setVehicleId(source.vehicleId);
    else {setVehicleId('');setCar({brand:source.brand??'',model:source.model??'',
      year:source.year?String(source.year):''});}
    setDescription(parallelWith ? 'Эвакуация параллельно работам по заявке №'+source.number
      : 'Эвакуация после завершения заявки №'+source.number);
  },[parallelSource.data,parallelWith]);
  // Выезд после консультации: та же машина и описание
  useEffect(() => {
    const c = consult.data;
    if (!c) return;
    if (c.description && !description) setDescription(c.description);
    if (c.vehicleId) setVehicleId(c.vehicleId);
    else if (!c.vehicle && c.brand) { setVehicleId(''); setCar({ brand: c.brand, model: c.model ?? '', year: c.year ? String(c.year) : '' }); }
  }, [consult.data]); // eslint-disable-line
  useEffect(() => {
    // Cancel stale previews when the declared region, address or GPS changes.
    // A delayed response must never restore an older SPb estimate.
    let active = true;
    setEst(null);
    setCoverageError('');
    if (night === null || (!isConsult && (!regionId || regionId === 'other' || !zoneId))) return;
    const timer = window.setTimeout(() => {
      post('/api/pricing/estimate', {
        service, tier, regionId: regionId || undefined, zoneId: zoneId || 'phone',
        night, group, address: address || undefined, lat: geo?.lat, lng: geo?.lng,
      }).then(price => { if (active) setEst(price); })
        .catch(error => {
          if (active) { setEst(null); setCoverageError(error?.message || 'Не удалось проверить регион и тарифную зону'); }
        });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [service, tier, regionId, zoneId, night, group, address, geo?.lat, geo?.lng]);

  function locate() {
    if (!navigator.geolocation) return setGeoState('fail');
    setGeoState('wait');
    navigator.geolocation.getCurrentPosition(
      (p) => { setGeo({ lat: p.coords.latitude, lng: p.coords.longitude }); setGeoState('ok'); },
      () => setGeoState('fail'),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }
  // Location sharing is optional and user-initiated: an automatically
  // acquired point may be the *person's* position, not a remote truck's.

  const zones = (pricing.data?.zones ?? []).filter((z: any) =>
    regionId === 'spb' ? z.id === 'spb'
      : regionId === 'lo' ? z.id !== 'spb'
        : false);
  const zone = zones.find((z: any) => z.id === zoneId);
  const groupAllowed = service !== 'tow' && !!zone && zone.km > 30;
  const methods = pricing.data?.payments;
  useEffect(() => {
    // Old drafts may contain 'cash': only server-approved methods can be chosen.
    if (!methods || methods[method]) return;
    setMethod(methods.online ? 'online' : methods.invoice ? 'invoice' : methods.cash ? 'cash' : 'online');
  }, [methods?.online, methods?.invoice, methods?.cash, method]);

  async function submit() {
    if (!methods?.[method]) return;
    const r = await run(() => postOrder( {
      service, isSos: !!sos, problem: sos?.id, description: description || undefined, address: address || undefined,
      lat: geo?.lat, lng: geo?.lng, regionId: regionId || undefined, zoneId: zoneId || 'phone',
      tier: service === 'tow' ? undefined : tier, vehicleId: vehicleId || undefined,
      ...carBody(vehicleId, car), groupTrip: groupAllowed && group, night: night ?? undefined, paymentMethod: method,
      ...(isTow ? { destination: destination || undefined, cargo, loaded, driverOnSite } : {}),
      fromConsult: fromConsult || undefined,
      continueFrom: continueFrom || undefined,
      recommendationId: recommendationId || undefined,
      preferredPerformerId: preferredPerformerId || undefined,
      parallelWith: parallelWith || undefined,
      parallelConsent: parallelWith ? parallelAgree : undefined,
      parallelCallOut: parallelWith ? est?.callOut : undefined,
      site: (!isTow && Object.keys(site).length) || roadside ? {
        ...(!isTow ? site : {}),
        ...(!isTow ? { meet: site.meet || undefined, time: site.time || undefined } : {}),
        ...(roadside ? { road: {
          highway: roadName.trim() || undefined,
          km: roadKm.trim() && Number.isFinite(Number(roadKm.replace(',', '.'))) ? Number(roadKm.replace(',', '.')) : undefined,
          direction: roadDirection.trim() || undefined, side: roadSide,
        } } : {}),
      } : undefined,
    }));
    if (!r) return;
    clearNewOrderDraft();
    if (r.confirmationUrl) location.href = r.confirmationUrl;
    else go(`order/${r.order.id}`);
  }

  const [site, setSite] = useState<{ place?: string; pass?: string; meet?: string; state?: string; when?: string; time?: string }>({});
  const [savedDraft,setSavedDraft]=useState<SavedNewOrderDraft|null>(null);
  useEffect(()=>{
    let active=true;
    if(me?.id)void readNewOrderDraft(me.id,service).then(d=>{if(active)setSavedDraft(d)});
    return ()=>{active=false};
  },[me?.id,service]);

  async function saveDraftOnDevice(){
    if(!me?.id)return;
    const saved=await run(()=>saveNewOrderDraft(me.id,{
      service,regionId,zoneId,tier,night,group,vehicleId,car,description,address,
      destination,cargo,loaded,driverOnSite,method,site,
      roadside,roadName,roadKm,roadDirection,roadSide,
    }),'Черновик зашифрован и сохранён только на устройстве');
    if(saved)setSavedDraft(saved);
  }
  function restoreDraftFromDevice(){
    const d=savedDraft?.data;
    if(!d)return;
    setRegionId(d.regionId);setZoneId(d.zoneId);setTier(d.tier);
    setNight(d.night);setGroup(d.group);setVehicleId(d.vehicleId);
    setCar(d.car);setDescription(d.description);setAddress(d.address);
    setDestination(d.destination);setCargo(d.cargo);setLoaded(d.loaded);
    setDriverOnSite(d.driverOnSite);setMethod(d.method);setSite(d.site??{});
    setRoadside(d.roadside);setRoadName(d.roadName);setRoadKm(d.roadKm);
    setRoadDirection(d.roadDirection);setRoadSide(d.roadSide);
    setGeo(null);setGeoState('idle'); // Never treat old GPS as a current fix.
    setAgree(false);setEst(null);setTried(false);
  }

  const [tried, setTried] = useState(false);
  const need = {
    car: !!vehicleId || car.brand.trim().length >= 2,
    what: description.trim().length >= MIN_WHAT,
    where: geoState === 'ok' || address.trim().length >= 3,
    tow: !isTow || destination.trim().length >= 3,
  };
  const missing = [
    !isConsult && !regionId && { id: 'f-where', name: 'регион' },
    !isConsult && regionId !== 'other' && !zoneId && { id: 'f-where', name: 'тарифная зона' },
    !isConsult && regionId === 'other' && { id: 'f-where', name: 'индивидуальное согласование региона' },
    !est && { id: 'f-where', name: 'проверенная предварительная смета' },
    !need.car && { id: 'f-car', name: 'марка машины' },
    !need.what && { id: 'f-what', name: 'описание задачи' },
    !need.where && { id: 'f-where', name: 'где машина' },
    !need.tow && { id: 'f-tow', name: 'куда везти' },
    !agree && { id: 'f-agree', name: 'согласие с суммами' },
    !methods?.[method] && { id: 'f-pay', name: 'безналичный способ оплаты' },
    !!parallelWith && (!parallelSource.data || !parallelAgree || !!me?.owner_id) &&
      {id:'f-agree',name:'отдельное согласие владельца на второй выезд'},
  ].filter(Boolean) as { id: string; name: string }[];

  if (!pricing.data) return <main>
    <Back to="" />
    <div className="banner warn">{pricing.error ?? 'Проверяем тарифы и тарифные зоны. Без связи отправка новой заявки недоступна.'}</div>
    {savedDraft && <div className="card stack">
      <b>Ваш локальный черновик сохранён</b>
      <span className="note">Сохранён {fmtTime(new Date(savedDraft.savedAt).toISOString())}. Описание: {savedDraft.data.description.slice(0,180)||'не указано'}</span>
      <span className="note">Дождитесь проверки тарифа при восстановлении соединения. Черновик никогда не отправится без вашего нажатия.</span>
    </div>}
  </main>;
  const s = SERVICES[service];

  return (
    <main>
      <Back to={parallelWith ? `order/${parallelWith}` : continueFrom ? `order/${continueFrom}` : fromConsult ? `order/${fromConsult}` : sos ? 'sos' : ''} />
      <div>
        <h1>{sym ? sym.name : s?.name ?? 'Заявка'}</h1>
        <div className="sub">{sos ? `${s?.name} · срочный вызов` : sym ? s?.name : s?.hint}</div>
      </div>
      <SelfOrderWarning me={me} />
      <DriverRules />
      <div className="card stack" aria-label="Локальный черновик для слабого интернета">
        <b>Черновик заявки · для плохой связи</b>
        <span className="note">Сохраняется только по вашему нажатию, зашифрован на этом устройстве на срок до 48 часов. Не отправляется автоматически. Координаты GPS намеренно не сохраняем — перед вызовом проверьте положение машины.</span>
        <div className="row">
          <button type="button" className="btn ghost small" disabled={busy||!me?.id}
            onClick={saveDraftOnDevice}>Сохранить черновик</button>
          {savedDraft && <button type="button" className="chip"
            onClick={()=>{clearNewOrderDraft();setSavedDraft(null);}}>Удалить</button>}
        </div>
        {savedDraft && <div className="stack" style={{gap:4}}>
          <span className="note">Сохранён {fmtTime(new Date(savedDraft.savedAt).toISOString())} · только на этом устройстве</span>
          <button type="button" className="btn ghost small" onClick={restoreDraftFromDevice}>Восстановить поля (без GPS и согласия на оплату)</button>
        </div>}
      </div>
      {parallelWith && <div className="card stack">
        <b>Параллельный эвакуатор · отдельный оплачиваемый выезд</b>
        <span className="note">{parallelSource.data
          ? `Первая заявка №${parallelSource.data.number} остаётся у мастера. Эвакуатор может ехать одновременно, но погрузка начнётся после окончания работ мастера.`
          : 'Проверяем связь с исходной заявкой. Без неё нельзя отправить второй вызов.'}</span>
        <span className="note">Это отдельная заявка с собственной стоимостью, исполнителем, отменой и документами. Случайное повторное создание второго этапа запрещено.</span>
        {me?.owner_id && <span className="banner warn">Второй платный выезд должен отдельно подтвердить владелец автопарка.</span>}
        <label className="agree"><input type="checkbox" checked={parallelAgree}
          disabled={!parallelSource.data||!est||!!me?.owner_id}
          onChange={e=>setParallelAgree(e.target.checked)}/>
          <span>Я отдельно согласен на второй вызов эвакуатора: предварительный выезд {est ? rub(est.callOut) : 'после проверки тарифа'} (остальные расходы — по отдельной смете).</span>
        </label>
      </div>}
      {preferredPerformerId && <div className="card stack">
        <b>Повторный вызов знакомого исполнителя</b>
        <span className="note">{selectedPerformer
          ? 'Первым пригласим '+(selectedPerformer.name??'вашего специалиста')+'. Если он занят, не подходит или откажется — общий поиск продолжится автоматически.'
          : pastPerformers.data
            ? 'Специалист не найден в вашей истории. Вернитесь к списку своих мастеров или вызовите без предпочтения.'
            : 'Проверяем историю сотрудничества…'}</span>
        <a className="btn ghost small" href={'#/new/'+service}>Вызвать без предпочтения</a>
      </div>}
      {!isTow && !sos && (
        <div className="scroll-x" role="tablist" aria-label="Какой мастер нужен">
          {(['electric', 'air', 'autonomy', 'tyre', 'diag'] as const).map((k) => (
            <button key={k} type="button" className="chip" role="tab" aria-pressed={service === k} onClick={() => { if (k !== service) go(`new/${k}${location.hash.includes('?') ? '?' + location.hash.split('?')[1] : ''}`); }}>{SERVICES[k].name}</button>
          ))}
        </div>
      )}
      {consult.data?.consultHint && (
        <div className="card flat">
          <span className="label">Подсказка мастера по телефону</span>
          <b>Подозрение: {consult.data.consultHint.hints.join(', ').toLowerCase()}</b>
          <span className="note">{CONSULT_CONF[consult.data.consultHint.confidence]}{consult.data.consultHint.note ? ` · ${consult.data.consultHint.note}` : ''}. Мастер на выезде увидит её в заявке.</span>
        </div>
      )}

      <Step n={1} id="f-car" title="Машина" req done={need.car} missing={tried && !need.car}>
        {vehicles.data?.length ? (
          <select className="field" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            {vehicles.data.map((v: any) => <option key={v.id} value={v.id}>{v.brand} {v.model ?? ''} {v.year ?? ''} {v.plate ?? ''}</option>)}
            <option value="">Другая машина</option>
          </select>
        ) : null}
        {(() => { const v = vehicles.data?.find((x: any) => x.id === vehicleId); const h = v ? seriesHint(v.brand, v.year) : seriesHint(car.brand, car.year); return h ? <span className="note" style={{ color: 'var(--accent)' }}>{h}</span> : null; })()}
        {!vehicleId && <VehicleFields value={car} onChange={setCar} />}
        {!vehicleId && <span className="note">Марка — обязательно, модель и год — по желанию: так подберём мастера, который знает вашу машину.</span>}
      </Step>

      <Step n={2} id="f-what" title="Задача для специалиста" req done={need.what} missing={tried && !need.what}>
        <textarea className="field" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Коротко опишите, какая помощь нужна. Если причина неизвестна, так и напишите." />
        <span className="note">{need.what ? '✓ Хватит, чтобы специалист понял задачу' : `Хотя бы пару слов — ещё ${MIN_WHAT - description.trim().length} симв.`}</span>
      </Step>

      <Step n={3} id="f-where" title={isTow ? 'Откуда забрать' : 'Где машина'} req done={need.where} missing={tried && !need.where}>
        <input className="field" placeholder="Адрес: регион, населённый пункт, улица или км трассы" value={address} onChange={(e) => setAddress(e.target.value)} />
        <div className="row">
          <button type="button" className="chip" onClick={locate} disabled={geoState === 'wait'}>
            {geoState === 'wait' ? 'Определяем GPS…' : 'Использовать мою GPS-точку'}
          </button>
          {geo && <button type="button" className="chip" onClick={() => {
            setGeo(null); setGeoState('idle');
          }}>Использовать только адрес</button>}
        </div>
        <span className="note">
          {geoState === 'ok' ? '✓ GPS-точка указана. Проверьте, что это место машины, а не ваше текущее положение' : geoState === 'wait' ? 'Определяю место…' : geoState === 'fail'
            ? <>Не удалось определить место — напишите адрес. <button type="button" className="chip" style={{ minHeight: 30 }} onClick={locate}>Ещё раз</button></> : null}
        </span>
        <button type="button" className="opt" aria-pressed={roadside} onClick={() => setRoadside(!roadside)}>
          <b>{roadside ? '✓ ' : ''}Машина на трассе — указать километр и направление</b>
          <small>Необязательно, но очень помогает мастеру и эвакуаторщику найти правильную сторону дороги.</small>
        </button>
        {roadside && <div className="card stack" style={{gap:8}}>
          <span className="label">Трасса и дорожный ориентир (по желанию)</span>
          <div className="grid2">
            <input className="field" value={roadName} maxLength={80} onChange={e=>setRoadName(e.target.value)} placeholder="Трасса: М-10, А-181, КАД…" />
            <input className="field" value={roadKm} type="number" min="0" max="15000" step="0.1" onChange={e=>setRoadKm(e.target.value)} placeholder="Километр (например, 87,5)" />
          </div>
          <input className="field" value={roadDirection} maxLength={100} onChange={e=>setRoadDirection(e.target.value)}
            placeholder="В сторону чего: СПб / Москвы / Выборга…" />
          <span className="label">С какой стороны по ходу движения стоит машина</span>
          <div className="grid3">
            {([['unknown','Не знаю'],['right','Справа'],['left','Слева']] as const).map(([id,label])=>
              <button key={id} type="button" className="seg" aria-pressed={roadSide===id} onClick={()=>setRoadSide(id)}>{label}</button>)}
          </div>
          <span className="note">Номер километра и направление не заменяют GPS. Не угадывайте их: неправильная сторона трассы может сильно увеличить время подъезда.</span>
        </div>}
        {!isConsult && <>
          <span className="label">Регион местонахождения машины — выберите вручную</span>
          <Chips value={regionId} onChange={(value) => {
            setRegionId(value as 'spb' | 'lo' | 'other');
            setZoneId(''); setEst(null); setAgree(false);
          }} options={[
            { id: 'spb', name: 'Санкт-Петербург' },
            { id: 'lo', name: 'Ленинградская область' },
            { id: 'other', name: 'Другой регион' },
          ]} />
          {regionId === 'other' ? (
            <div className="banner warn">
              Тарифы выезда для других регионов пока не подтверждены. Мы не показываем цены КАД
              и не создаём платёж. Возможность выезда и полную смету нужно согласовать отдельно.
              <a href="#/support/new">Запросить индивидуальную помощь</a>
            </div>
          ) : regionId ? (
            <>
              <span className="label">Тарифная зона — выберите отдельно от региона</span>
              <Chips value={zoneId} onChange={(value) => {
                setZoneId(value); setEst(null); setAgree(false);
              }} options={zones.map((z: any) => ({
                id: z.id, name: z.km > 30 ? `${z.name} · ${z.km} км` : z.name,
              }))} />
              <span className="note">Зона выбирается вручную, а не по IP или GPS. За пределами согласованной зоны стоимость уточняется до заказа.</span>
            </>
          ) : (
            <span className="note">Сначала выберите регион. Сумма выезда не появится, пока не будет указана тарифная зона.</span>
          )}
          {coverageError && <div role="alert" className="banner warn">{coverageError}</div>}
        </>}
        {regionId !== 'other' && <div className="grid2">
          <button type="button" className="seg" aria-pressed={!night} onClick={() => setNight(false)}>Днём</button>
          <button type="button" className="seg" aria-pressed={!!night} onClick={() => setNight(true)}>Ночь 22–7</button>
        </div>}
        {groupAllowed && (
          <button type="button" className="opt" aria-pressed={group} onClick={() => setGroup(!group)}>
            <b>{group ? '✓ ' : ''}Совместный выезд</b>
            <small>Мастер едет к нескольким машинам рядом — вы платите 70% выезда. Может быть дольше.</small>
          </button>
        )}
      </Step>

      {!isTow && (
        <Step n={4} id="f-site" title="Место и условия" done>
          <div className="grid4">{([['parking', 'Парковка'], ['yard', 'Стоянка'], ['plant', 'Завод'], ['road', 'Трасса']] as const).map(([k, n]) => (
            <button key={k} type="button" className="seg" style={{ fontSize: 13, padding: 0 }} aria-pressed={site.place === k} onClick={() => setSite({ ...site, place: site.place === k ? undefined : k })}>{n}</button>
          ))}</div>
          {site.place === 'plant' && (
            <>
              <span className="label">Пропуск</span>
              <div className="grid3">{([['none', 'Не нужен'], ['onsite', 'Оформим на месте'], ['ahead', 'Заранее']] as const).map(([k, n]) => (
                <button key={k} type="button" className="seg" style={{ fontSize: 13 }} aria-pressed={site.pass === k} onClick={() => setSite({ ...site, pass: k })}>{n}</button>
              ))}</div>
              <input className="field" placeholder="Кто встретит на проходной — имя" value={site.meet ?? ''} onChange={(e) => setSite({ ...site, meet: e.target.value })} />
              <span className="note">Долгий въезд и досмотр оплачиваются по ставке ожидания мастера.</span>
            </>
          )}
          <span className="label">Что с машиной</span>
          <div className="grid3">{([['free', 'Свободна'], ['loading', 'Погрузка'], ['other_work', 'Другие работы']] as const).map(([k, n]) => (
            <button key={k} type="button" className="seg" style={{ fontSize: 13 }} aria-pressed={(site.state ?? 'free') === k} onClick={() => setSite({ ...site, state: k })}>{n}</button>
          ))}</div>
          {site.state && site.state !== 'free' && <span className="note">Мастеру придётся работать параллельно — это может стоить дороже, он скажет сумму до начала.</span>}
          <span className="label">Когда</span>
          <div className="grid3">{([['now', 'Сейчас'], ['today', 'Сегодня'], ['tomorrow', 'Завтра']] as const).map(([k, n]) => (
            <button key={k} type="button" className="seg" aria-pressed={(site.when ?? 'now') === k} onClick={() => setSite({ ...site, when: k })}>{n}</button>
          ))}</div>
          {site.when && site.when !== 'now' && <input className="field" placeholder="Примерно к … (например, 14:00)" value={site.time ?? ''} onChange={(e) => setSite({ ...site, time: e.target.value })} />}
        </Step>
      )}

      {!isTow && ON_SITE[service] && (
        <details className="card">
          <summary><b>Что {SERVICES[service].name.toLowerCase()} сделает на месте, а что нет</b></summary>
          <div className="stack" style={{ gap: 4, marginTop: 8 }}>
            {ON_SITE[service].yes.map((x) => <span key={x} className="note" style={{ color: 'var(--fg)' }}>✓ {x}</span>)}
            {ON_SITE[service].no.map((x) => <span key={x} className="note">✕ {x}</span>)}
            <span className="note">Если на месте не исправить — мастер поставит диагноз и посоветует сервис-партнёр, клиенту там скидка.</span>
          </div>
        </details>
      )}
      {!isTow && regionId !== 'other' && <MastersNearby service={service} geo={geo} brand={vehicles.data?.find((v: any) => v.id === vehicleId)?.brand ?? car.brand} />}

      {isTow ? (
        <Step n={4} id="f-tow" title="Куда и что везём" req done={need.tow} missing={tried && !need.tow}>
          <input className="field" placeholder="Куда везти: сервис, стоянка, адрес" value={destination} onChange={(e) => setDestination(e.target.value)} />
          <Chips value={cargo} onChange={setCargo} options={[{ id: 'tractor', name: 'Тягач' }, { id: 'semitrailer', name: 'Полуприцеп' }, { id: 'coupling', name: 'Сцепка целиком' }, { id: 'truck12', name: 'Грузовик до 12 т' }, { id: 'bus', name: 'Автобус' }, { id: 'special', name: 'Спецтехника' }]} />
          <span className="label">Груз в прицепе</span>
          <Chips value={loaded} onChange={setLoaded} options={[{ id: 'empty', name: 'Пустой' }, { id: 'loaded', name: 'Гружёный' }, { id: 'adr', name: 'Опасный ADR' }]} />
          <div className="grid2">
            <button type="button" className="seg" aria-pressed={driverOnSite} onClick={() => setDriverOnSite(true)}>Водитель на месте</button>
            <button type="button" className="seg" aria-pressed={!driverOnSite} onClick={() => setDriverOnSite(false)}>Водителя нет</button>
          </div>
        </Step>
      ) : (
        <Step n={5} id="f-tier" title="Класс мастера" done>
          {(Object.keys(TIERS) as (keyof typeof TIERS)[]).map((t) => (
            <button key={t} type="button" className="opt" aria-pressed={tier === t} onClick={() => setTier(t as any)}>
              <div className="between"><b>{TIERS[t].name}</b><span className="note">выезд {rub(pricing.data.tiers[t].callOut)}</span></div>
              <small>{TIERS[t].hint}</small>
            </button>
          ))}
        </Step>
      )}

      {regionId !== 'other' && <Step n={isTow ? 5 : 6} id="f-pay" title="Оплата" done>
        <div className="grid2">
          {methods?.cash && <button type="button" className="seg" aria-pressed={method === 'cash'} onClick={() => setMethod('cash')}>Исторический тестовый способ</button>}
          <button type="button" className="seg" aria-pressed={method === 'online'} disabled={!methods?.online} onClick={() => setMethod('online')}>СБП / карта</button>
        </div>
        {methods?.invoice && <button type="button" className="seg" aria-pressed={method === 'invoice'} onClick={() => setMethod('invoice')}>Счёт на компанию</button>}
        {!methods?.online && <span className="note">Новые платные заявки временно недоступны, пока банк не подключён. Наличную оплату TrakSOS не предлагает.</span>}
        {method === 'online' && <span className="note">Выезд оплачивается сейчас и замораживается. Мастеру деньги уйдут после того, как вы подтвердите работу.</span>}
      </Step>}

      {est && (
        <div className={`card hi ${tried && !agree ? 'missing' : ''}`} id="f-agree">
          {est.provisional && <div role="note" className="banner warn">
            {est.coverageNote || 'Предварительная смета. Проверим фактический адрес и согласуем стоимость до выезда.'}
          </div>}
          <span className="label" style={{ color: 'var(--accent)' }}>{isTow ? 6 : 7} · Проверьте перед вызовом</span>
          <div className="sum"><span>{isTow ? 'Обычная цена перевозки' : 'Вызов специалиста · выезд'}{est.km ? <small className="note" style={{ display: 'block' }}>{est.roadKm} км: туда и половина обратно</small> : null}</span><b>{rub(est.callOut)}</b></div>
          {est.hour != null && <>
            <div className="sum"><span>Первый час: диагностика <i>или</i> ремонт<small className="note" style={{ display: 'block' }}>одно из двух, не вместе</small></span><b>{rub(est.hour)}</b></div>
            <div className="sum"><span>Каждый следующий час</span><b>{rub(est.hour)}</b></div>
            <div className="sum"><span>Запчасти и расходники</span><b>по чеку, отдельной строкой</b></div>
            <span className="note">{pricing.data?.billingStep === 30 ? 'Время работы считается по получасам: начатые полчаса — полные полчаса.' : 'Каждый начатый час работы считается полным — даже если работа заняла 10 минут.'} Сумму за работу мастер не вводит руками — её считает таймер.</span>
          </>}
          {fromConsult && consult.data?.status && ['completed', 'awaiting_confirmation'].includes(consult.data.status) && (
            <div className="sum" style={{ color: 'var(--good-fg)' }}><span>Скидка после консультации</span><b>−{rub(consult.data.consultBack?.backDiscount ?? 20_000)}</b></div>
          )}
          {est.night && <span className="note">Ночной тариф уже учтён.</span>}
          {est.group && <span className="note">Совместный выезд: 70% от полной цены.</span>}
          <div className="hr" />
          <span className="note" style={{ color: 'var(--fg-2)' }}>{isTow
            ? 'Это обычная цена. Эвакуаторщики рядом предложат свою — от −15% до +30%, вы выберете по цене, подаче и рейтингу. Перевозку оплачиваете по факту.'
            : 'Мастера рядом откликнутся по этой цене или со своей — вы выберете. Работу мастер назовёт на месте, и без вашего «Да» ничего не начнётся.'}</span>
          <label className="agree">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>Согласен с суммами и <a href="#/offer/client">офертой TrakSOS</a>{me?.company_name ? `: вызов от имени ${me.company_name}` : ''}. Отказ платить за выполненную работу взыскивается по оферте.</span>
          </label>
        </div>
      )}

      {regionId !== 'other' && <CallBar busy={busy} missing={missing}
        price={est ? `предварительно: ${isTow ? 'перевозка' : 'выезд'} ${rub(est.callOut)}` : ''}
        label={isTow ? 'Вызвать эвакуатор' : 'Вызвать мастера'}
        onGo={() => { setTried(true); if (missing.length) jump(missing[0].id); else submit(); }} />}
    </main>
  );
}

// Мои заявки ----------------------------------------------------------------

export function Orders({ as }: { as: 'client' | 'performer' }) {
  const list = useLoad(() => get(`/api/orders?as=${as}`), [as], (e) => e.type === 'order');
  const bookings = useLoad<any[]>(() => as === 'client' ? get('/api/bookings') : Promise.resolve([]),
    [as], (e) => e.type === 'booking');
  const [tab, setTab] = useState<'list' | 'black' | 'cars'>('list');
  const [ctab, setCtab] = useState<'now' | 'my' | 'hist' | 'black'>('now');
  if (as === 'performer' && tab === 'black') return <main><h1>История</h1><HistoryTabs tab={tab} setTab={setTab} /><PerformerBlacklist /></main>;
  if (as === 'performer' && tab === 'cars') return <main><h1>История</h1><HistoryTabs tab={tab} setTab={setTab} />{list.data ? <JobsByCar orders={list.data} /> : <Loading error={list.error} />}</main>;
  const live = (o: any) => !['completed', 'cancelled', 'no_performer'].includes(o.status);
  const shown = as === 'performer' ? list.data : (list.data ?? []).filter((o: any) => ctab === 'now' ? live(o) : !live(o));
  const activeBookings = (bookings.data ?? []).filter(isOpenBooking);
  const showingNow = as === 'client' && ctab === 'now';
  return (
    <main className={as === 'performer' ? 'performer-orders-page' : 'client-orders-page'}>
      <h1>{as === 'performer' ? 'История' : 'Заявки'}</h1>
      {as === 'performer' && <HistoryTabs tab={tab} setTab={setTab} />}
      {as === 'client' && (
        <div className="scroll-x" role="tablist">
          {([['now', `Сейчас${list.data ? ` · ${list.data.filter(live).length}` : ''}`], ['my', 'Мои мастера'], ['hist', 'История'], ['black', 'Чёрный список']] as const).map(([k, n]) => (
            <button key={k} className="chip" role="tab" aria-pressed={ctab === k} onClick={() => setCtab(k)}>{n}</button>
          ))}
        </div>
      )}
      {showingNow && <h2>Текущие обращения и заявки на подтверждении · {(list.data ?? []).filter(live).length}</h2>}
      {as === 'client' && ctab === 'hist' && list.data && <TaskArchive orders={list.data.filter((o: any) => !live(o))} />}
      {as === 'client' && (ctab === 'my' || ctab === 'black') ? <MyPerformers black={ctab === 'black'} /> :
      as === 'client' && ctab === 'hist' ? null : !list.data ? <Loading error={list.error} /> : !shown!.length ?
        showingNow && (!bookings.data || activeBookings.length > 0)
          ? <span className="note">Активных выездов и консультаций сейчас нет.</span>
          : <div className="empty">{showingNow ? 'Активных выездов и записей на СТО сейчас нет' : 'Выездов пока нет'}</div> : (
        <div className="rows">
          {shown!.map((o: any) => (
            <a key={o.id} href={`#/order/${o.id}`} className="list-item">
              <div className="stack" style={{ gap: 2 }}>
                <b>№{o.number} · {SERVICES[o.service]?.name ?? o.service}{o.is_sos ? ' · SOS' : ''}</b>
                <span className="note">{fmtTime(o.created_at)} · {o.address ?? o.estimate?.zoneName}</span>
              </div>
              <span className={`pill ${STATUS[o.status]?.tone}`}>{STATUS[o.status]?.name}</span>
            </a>
          ))}
        </div>
      )}
      {showingNow && <section className="stack" aria-label="Активные записи на СТО">
        <h2>Записи на СТО · {activeBookings.length}</h2>
        {bookings.error ? <div className="note">Не удалось загрузить записи на СТО: {bookings.error}</div>
          : !bookings.data ? <Loading />
            : activeBookings.length > 0 ? <BookingList rows={activeBookings} />
              : <span className="note">Открытых записей на СТО сейчас нет. Завершённые — в истории.</span>}
      </section>}
    </main>
  );
}

/** «Мои мастера»: кто уже был у вас — в избранное (предлагаем первым), «не предлагать», вызвать снова */
function MyPerformers({ black }: { black: boolean }) {
  const list = useLoad(() => get('/api/my-performers'), []);
  const { busy, run } = useAction();
  if (!list.data) return <Loading error={list.error} />;
  const rows = list.data.filter((p: any) => black ? p.pref === 'hide' : p.pref !== 'hide');
  const set = async (id: string, pref: string | null, msg: string) => { if (await run(() => put(`/api/my-performers/${id}`, { pref }), msg)) list.reload(); };
  if (!rows.length) return <div className="empty">{black ? 'Список пуст. «Не предлагать» — в карточке мастера во вкладке «Мои мастера».' : 'Здесь появятся мастера и эвакуаторщики, которые у вас уже были.'}</div>;
  return (
    <div className="stack">
      {!black && <span className="note">Мастера, которые уже у вас были. Избранных предлагаем первыми.</span>}
      {rows.map((p: any) => (
        <div key={p.id} className="card" style={{ gap: 8 }}>
          <div className="between">
            <div style={{ minWidth: 0 }}><b>{p.name ?? 'Исполнитель'}</b><div className="note">{p.kind === 'tow' ? 'Эвакуатор' : 'Мастер'}{p.rating ? ` · ★ ${p.rating.toFixed(1)}` : ''}{p.jobs ? ` · у вас ${p.jobs} раз` : ''}{p.last_at ? ` · последний ${fmtTime(p.last_at)}` : ''}</div></div>
            <span className={`pill ${p.line_status === 'online' ? 'good' : ''}`}>{p.line_status === 'online' ? 'на линии' : p.line_status === 'on_job' ? 'на выезде' : 'не на линии'}</span>
          </div>
          {black ? <button className="btn ghost small" disabled={busy} onClick={() => set(p.id, null, 'Снова будем предлагать')}>Убрать из чёрного списка</button> : (
            <>
              <div className="row">
                <button className="chip" disabled={busy} aria-pressed={p.pref === 'fav'} onClick={() => set(p.id, p.pref === 'fav' ? null : 'fav', p.pref === 'fav' ? 'Убрано из избранного' : 'В избранном — предлагаем первым')}>{p.pref === 'fav' ? '★ В избранном' : '☆ В избранное'}</button>
                <button className="chip" disabled={busy} onClick={() => set(p.id, 'hide', 'Больше не предлагаем — он в чёрном списке')}>Не предлагать</button>
              </div>
              <button className="btn small" disabled={!p.jobs} onClick={() => go(`new/${p.kind === 'tow' ? 'tow' : p.last_service && p.last_service !== 'consult' ? p.last_service : 'electric'}?preferred=${encodeURIComponent(p.id)}`)}>{p.jobs ? 'Пригласить снова' : 'Нет завершённых выездов'}</button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function HistoryTabs({ tab, setTab }: { tab: string; setTab: (t: any) => void }) {
  return (
    <div className="grid3" role="tablist">
      <button className="seg" aria-pressed={tab === 'list'} onClick={() => setTab('list')}>Все заявки</button>
      <button className="seg" aria-pressed={tab === 'cars'} onClick={() => setTab('cars')}>По машинам</button>
      <button className="seg" aria-pressed={tab === 'black'} onClick={() => setTab('black')}>Чёрный список</button>
    </div>
  );
}

function PerformerBlacklist() {
  const list = useLoad(() => get('/api/performer/blacklist'), []);
  const { busy, run } = useAction();
  if (!list.data) return <Loading error={list.error} />;
  return (
    <div className="stack">
      {!list.data.length ? <div className="empty">Список пуст</div> : list.data.map((b: any) => (
        <div key={b.client_id} className="card" style={{ gap: 6 }}>
          <div className="between"><b>{b.company_name ?? b.name ?? 'Клиент'}</b><span className="note">{fmtTime(b.created_at)}</span></div>
          {b.reason && <span className="note">Причина: {b.reason}</span>}
          <button className="btn ghost small" disabled={busy} onClick={async () => { if (await run(() => del(`/api/performer/blacklist/${b.client_id}`), 'Убрано — заявки клиента снова будут приходить')) list.reload(); }}>Убрать из чёрного списка</button>
        </div>
      ))}
      <span className="note">Заявки от них к вам не приходят. Добавить — в заявке, вкладка «Клиент и машина». Причину видите только вы и модератор.</span>
    </div>
  );
}

// Гараж ---------------------------------------------------------------------

export function Garage({focusVehicleId}:{focusVehicleId?:string}={}) {
  const { me } = useMe();
  const list = useLoad(() => get('/api/vehicles'), []);
  const { busy, run } = useAction();
  const [form, setForm] = useState({ brand: '', model: '', year: '', plate: '', trailerPlate: '' });
  const [driverFor, setDriverFor] = useState<string | null>(null);
  const [driverPhone, setDriverPhone] = useState('+7 ');
  const isDriver = !!me?.owner_id;
  const [serviceHistoryVersion, setServiceHistoryVersion] = useState(0);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible' && navigator.onLine) setServiceHistoryVersion(v => v + 1); };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    return () => { document.removeEventListener('visibilitychange', refresh); window.removeEventListener('online', refresh); };
  }, []);

  async function add() {
    const r = await run(() => post('/api/vehicles', {
      brand: form.brand, model: form.model || undefined, year: form.year ? Number(form.year) : undefined,
      plate: form.plate || undefined, trailerPlate: form.trailerPlate || undefined,
    }), 'Машина добавлена');
    if (r) { setForm({ brand: '', model: '', year: '', plate: '', trailerPlate: '' }); list.reload(); }
  }

  return (
    <main className="client-garage-page">
      <div className="client-section-hero client-section-hero-garage">
        <h1>Мой гараж</h1>
        <div className="sub">Машина сохраняется один раз и выбирается одним нажатием во всех заявках.</div>
      </div>
      {!isDriver && (
        <button className="linkrow" onClick={() => go('fleet')}>
          <span><b>Мой парк</b><small>водители и лимиты, QR-наклейки, подтверждение заказов, ЭДО</small></span><span aria-hidden="true">›</span>
        </button>
      )}
      {list.data?.length===0 && <section className="tr-approved-empty-card tr-approved-garage-empty" aria-label="Транспорт пока не добавлен">
        <ApprovedEmptyScene kind="fleet" />
        <strong>{isDriver?'Транспорт пока не закреплён за вами':'Ваш автопарк пока пуст'}</strong>
        <p>{isDriver?'Попросите владельца автопарка назначить вашу машину.':'Добавьте грузовик или прицеп с помощью формы ниже. Фотография на иллюстрации не является вашей машиной.'}</p>
      </section>}
      {!list.data ? <Loading error={list.error} /> : list.data.map((v: any) => (
        <div key={v.id} id={`garage-vehicle-${v.id}`} className="card">
          <VehiclePhotoLink brand={v.brand} model={v.model} year={v.year} plate={v.plate} href={`#/garage/${v.id}`}/>
          <div className="between"><b>{v.brand} {v.model ?? ''}{v.year ? `, ${v.year}` : ''}</b><span className="pill">{v.plate ?? 'без номера'}</span></div>
          {v.trailer_plate && <span className="note">Прицеп {v.trailer_plate}</span>}
          {v.fixed_at && <span className="pill good" style={{ alignSelf: 'flex-start' }}>уточнено мастером · {fmtTime(v.fixed_at)}</span>}
          {seriesHint(v.brand, v.year) && <span className="note" style={{ color: 'var(--accent)' }}>{seriesHint(v.brand, v.year)}</span>}
          <div className="row" style={{gap:8, flexWrap:'wrap'}}>
            <a className="btn ghost small" href={`#/shop?vehicleId=${encodeURIComponent(v.id)}`}>Подобрать запчасти для этой машины</a>
            <a className="btn ghost small" href={`#/shop/history/${v.id}`}>История покупок</a>
          </div>
          <VehicleExtendedDetails vehicle={v} isDriver={isDriver} onSaved={()=>list.reload()} />
          <VehicleServiceApplication vehicleId={v.id} onCreated={() => setServiceHistoryVersion(v => v + 1)} />
          <VehicleServiceHistory id={v.id} isDriver={isDriver} refreshVersion={serviceHistoryVersion} />
          <VehicleHistory id={v.id} initialOpen={focusVehicleId===v.id} />

          {!isDriver && (driverFor === v.id ? (
            <div className="stack">
              <input className="field" type="tel" value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} />
              <div className="grid2">
                <button className="btn small" disabled={busy} onClick={async () => {
                  if (await run(() => post(`/api/vehicles/${v.id}/driver`, { phone: driverPhone }), 'Водитель закреплён. Он входит по своему номеру.')) { setDriverFor(null); list.reload(); }
                }}>Закрепить</button>
                <button className="btn ghost small" onClick={() => setDriverFor(null)}>Отмена</button>
              </div>
              <span className="note">Водитель видит только эту машину и свои заявки. SOS ему доступен всегда.</span>
            </div>
          ) : (
            <div className="row">
              <button className="btn ghost small" onClick={() => setDriverFor(v.id)}>{v.driver_id ? 'Сменить водителя' : 'Назначить водителя'}</button>
              {v.driver_id && <button className="btn ghost small" onClick={async () => { if (await run(() => post(`/api/vehicles/${v.id}/driver`, { phone: null }), 'Доступ водителя закрыт')) list.reload(); }}>Убрать водителя</button>}
              <button className="btn bad small" onClick={async () => { if (confirmDelete() && await run(() => del(`/api/vehicles/${v.id}`))) list.reload(); }}>Удалить</button>
            </div>
          ))}
        </div>
      ))}

      {!isDriver && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <b>Добавить машину</b>
          <VehicleFields value={{ brand: form.brand, model: form.model, year: form.year }} onChange={(v) => setForm({ ...form, ...v })} />
          <div className="grid2">
            <input className="field" placeholder="Госномер тягача" value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} />
            <input className="field" placeholder="Прицеп" value={form.trailerPlate} onChange={(e) => setForm({ ...form, trailerPlate: e.target.value })} />
          </div>
          <span className="note">Год влияет на подбор мастера: у разных поколений своя электрика.</span>
          <button className="btn" disabled={busy || !form.brand}>Сохранить</button>
        </form>
      )}
    </main>
  );
}

/** More accurate spare-parts matching without making SOS registration onerous. */
function VehicleExtendedDetails({vehicle:v,isDriver,onSaved}:{
  vehicle:any;isDriver:boolean;onSaved:()=>void
}) {
  const [open,setOpen]=useState(false);
  const [vin,setVin]=useState(v.vin??'');
  const [engine,setEngine]=useState(v.engine??'');
  const [notes,setNotes]=useState(v.configuration_notes??'');
  const {busy,run}=useAction();
  const fields=[v.vin,v.engine,v.configuration_notes].filter((x:any)=>!!String(x??'').trim()).length;
  const validVin=!vin.trim()||/^[A-HJ-NPR-Z0-9]{17}$/.test(vin.trim().toUpperCase());
  return <div className="stack" style={{gap:7}}>
    <button type="button" className="linkrow" onClick={()=>setOpen(x=>!x)}
      aria-expanded={open} aria-label="Дополнительные данные машины">
      <span><b>Характеристики для точного подбора запчастей</b>
        <small>{fields===3?'Заполнены VIN, двигатель и особенности комплектации'
          : 'Заполнено '+fields+' из 3. Необязательно, но желательно уточнить.'}</small>
      </span><span aria-hidden="true">{open?'˄':'˅'}</span>
    </button>
    {open && <div className="card stack" style={{gap:8}}>
      <span className="note">Уточнение VIN, двигателя и заменённых агрегатов помогает избежать ошибочного подбора. SOS и вызов мастера доступны и без этих данных.</span>
      {isDriver ? <div className="banner warn">
        <b>Ограниченный доступ</b>
        <span className="note">Вы можете посмотреть характеристики закреплённой машины, но изменяет их только владелец автопарка.</span>
        <span className="note">VIN: {v.vin??'не заполнен'} · Двигатель: {v.engine??'не заполнен'}</span>
        {v.configuration_notes&&<span className="note">{v.configuration_notes}</span>}
      </div> : <>
        <label className="stack" style={{gap:3}}>
          <span className="label">VIN (необязательно)</span>
          <input className="field" value={vin} maxLength={17} autoCapitalize="characters"
            onChange={e=>setVin(e.target.value.toUpperCase())}
            placeholder="17 символов — можно оставить пустым"/>
          {!validVin&&<span role="alert" className="note">Проверьте VIN: 17 символов, буквы I, O, Q не используются</span>}
        </label>
        <label className="stack" style={{gap:3}}>
          <span className="label">Фактический двигатель</span>
          <input className="field" maxLength={80} value={engine} onChange={e=>setEngine(e.target.value)}
            placeholder="Например, DCI 11 / D13 / двигатель заменён"/>
        </label>
        <label className="stack" style={{gap:3}}>
          <span className="label">Комплектация и замены</span>
          <textarea className="field" maxLength={500} value={notes} onChange={e=>setNotes(e.target.value)}
            placeholder="Уточнения по коробке, мостам, установленным агрегатам и изменённым деталям"/>
        </label>
        <button type="button" className="btn small" disabled={busy||!validVin}
          onClick={async()=>{
            const result=await run(()=>patch('/api/vehicles/'+v.id+'/details',
              {vin:vin.trim()||null,engine:engine.trim()||null,configurationNotes:notes.trim()||null}),
              'Характеристики обновлены');
            if(result){onSaved();setOpen(false);}
          }}>Сохранить характеристики</button>
      </>}
    </div>}
  </div>;
}

/** История машины: что и когда делали, комментарий мастера. Свёрнута, раскрывается по нажатию. */
function VehicleHistory({ id,initialOpen=false }: { id: string; initialOpen?:boolean }) {
  const [open, setOpen] = useState(initialOpen);
  useEffect(()=>{
    if(!initialOpen)return;
    setOpen(true);
    const el=document.getElementById('garage-vehicle-'+id);
    el?.scrollIntoView({block:'start',behavior:'auto'});
  },[initialOpen,id]);
  const h = useLoad(() => get(`/api/vehicles/${id}/history`), [id], (e) => e.type === 'order');
  const d = h.data;
  if (!d) return null;
  if (!d.items.length) return <span className="note">История пока пустая — здесь будут все вызовы по этой машине и что делали мастера.</span>;
  const last = d.summary.lastAt ? fmtTime(d.summary.lastAt) : '';
  return (
    <div className="stack" style={{ gap: 8 }}>
      <button type="button" className="linkrow" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span><b>История · {d.summary.total} {d.summary.total === 1 ? 'обращение' : d.summary.total < 5 ? 'обращения' : 'обращений'}</b>
          <small>последнее {last}{d.summary.spent != null && d.summary.spent > 0 ? ` · всего ${rub(d.summary.spent)}` : ''}</small></span>
        <span aria-hidden="true">{open ? '˄' : '˅'}</span>
      </button>
      {open && (
        <ol className="tl">
          {d.items.map((o: any) => (
            <li key={o.id}>
              <i className={o.status === 'completed' ? 'ok' : o.status === 'cancelled' || o.status === 'no_performer' ? 'off' : 'now'} />
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
              <a href={o.kind === 'service' ? `#/booking/${o.id}` : `#/order/${o.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'flex', flexDirection: 'column' }}>
                <b>{o.kind === 'service' ? `Ремонт на рембазе` : o.service === 'consult' ? 'Консультация по телефону' : o.service === 'tow' ? 'Эвакуатор' : `Выезд · ${SERVICES[o.service]?.name ?? o.service}`}{o.is_sos ? ' · SOS' : ''}</b>
                <small>{fmtTime(o.created_at)}{o.performer_name ? ` · ${o.performer_name}` : ''} · {STATUS[o.status]?.name ?? (o.kind === 'service' ? 'в сервисе' : o.status)}{o.amount && !o.lines?.length ? ` · ${rub(o.amount)}` : ''}</small>
                {o.description && <small>{o.kind === 'service' ? 'Сделано' : 'Было'}: {o.description}</small>}
                {o.consult_hint && <small>Подсказка по телефону: {o.consult_hint.hints.join(', ').toLowerCase()}{o.consult_hint.note ? ` — ${o.consult_hint.note}` : ''}</small>}
                {o.result_note && <small style={{ color: 'var(--fg)' }}>Мастер: {o.result_note}</small>}
              </a>
              {o.lines?.length > 0 && (
                <details style={{ marginTop: 4 }}>
                  <summary className="note" style={{ cursor: 'pointer' }}>Сумма {rub(o.amount)} — развернуть</summary>
                  <div className="stack" style={{ gap: 2, marginTop: 4 }}>
                    {o.lines.map((l: any, i: number) => <div key={i} className="sum" style={{ fontSize: 13 }}><span>{l.label}</span><span>{l.amount < 0 ? '−' : ''}{rub(Math.abs(l.amount))}</span></div>)}
                    <div className="sum" style={{ fontSize: 13, fontWeight: 700 }}><span>Итого</span><span>{rub(o.amount)}</span></div>
                  </div>
                </details>
              )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// В браузере confirm() есть всегда; в Android WebView — тоже (Capacitor показывает системный диалог)
function confirmDelete() {
  return window.confirm('Удалить машину из гаража?');
}

// Профиль -------------------------------------------------------------------

export function Profile() {
  const { me, reload, mode } = useMe();
  const { busy, run } = useAction();
  const [name, setName] = useState(me?.name ?? '');
  const [company, setCompany] = useState(me?.company_name ?? '');
  const [inn, setInn] = useState(me?.company_inn ?? '');
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [appLock, setAppLock] = useState(() => native.appLockEnabled());
  const [reducedMotion, setReducedMotion] = useState(() => localStorage.getItem('traksos.reduceMotion') === '1');
  const toggleMotion = (enabled: boolean) => {
    setReducedMotion(enabled);
    localStorage.setItem('traksos.reduceMotion', enabled ? '1' : '0');
    document.documentElement.classList.toggle('traksos-reduced-motion', enabled);
  };
  if (!me) return null;
  const isPerformer = me.roles.some((r) => r === 'master' || r === 'tow');
  const isCustomer = me.roles.some((r) => r === 'client' || r === 'driver');
  return (
    <main className="account-profile-page">
      <h1>Профиль</h1>
      {native.isApp && <div className="card">
        <b>Быстрый безопасный вход</b>
        <label className="row" style={{ alignItems: 'center' }}>
          <input type="checkbox" checked={appLock} onChange={(e) => {
            const value = e.target.checked;
            if (native.setAppLockEnabled(value)) setAppLock(value);
            else window.alert('Чтобы включить защиту, настройте отпечаток пальца или код блокировки телефона.');
          }} />
          <span>Разблокировать TrakSOS отпечатком или PIN телефона</span>
        </label>
        <span className="note">При возвращении в приложение после перерыва. Статус «На линии» и входящие вызовы не отключаются.</span>
      </div>}
      <a href="#/invite" className="card" style={{ textDecoration: 'none', color: 'inherit', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <span><b>🎁 Пригласить и получать баллы</b><small className="note" style={{ display: 'block' }}>Баллы гасят сбор и комиссию TrakSOS</small></span><span>›</span>
      </a>
      <div className="card">
        <dl className="kv">
          <dt>Телефон</dt><dd>{fmtPhone(me.phone)}</dd>
          <dt>Рейтинг</dt><dd>{me.rating ? `${me.rating.toFixed(2)} · ${me.rating_count} оценок` : 'пока нет оценок'}</dd>
          {(me as any).bonus > 0 && <><dt>Бонусы</dt><dd style={{ color: 'var(--good-fg)' }}>{rub((me as any).bonus)} — спишутся сами со следующей заявки</dd></>}
          {(me as any).personalFee && <><dt>Ваш сбор</dt><dd>{(me as any).feePct}% — персональные условия</dd></>}
        </dl>
      </div>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => (patchMe({ name, companyName: company || null, companyInn: inn || null })), 'Сохранено')) reload();
      }}>
        <Field label="Имя"><input className="field" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        {!me.owner_id && !me.roles.includes('driver') && (
          <>
            <Field label="Компания · если работаете от юрлица"><input className="field" value={company} onChange={(e) => setCompany(e.target.value)} /></Field>
            <Field label="ИНН компании" hint="Для счетов и закрывающих документов по ЭДО"><input className="field" inputMode="numeric" value={inn} onChange={(e) => setInn(e.target.value.replace(/\D/g, ''))} /></Field>
          </>
        )}
        <button className="btn" disabled={busy}>Сохранить</button>
      </form>
      <div className="card stack">
        <b>Безопасность аккаунта</b>
        <button type="button" className="btn ghost" onClick={() => {
          setPasswordOpen(value => !value);
          setPasswordError('');
          setPasswordSaved(false);
          setCurrentPassword('');
          setNewPassword('');
          setRepeatPassword('');
        }}>{passwordOpen ? 'Скрыть смену пароля' : 'Сменить пароль'}</button>
        {passwordOpen && <form className="stack" onSubmit={async (event) => {
          event.preventDefault();
          setPasswordError('');
          setPasswordSaved(false);
          if (newPassword.length < 10 || newPassword.length > 128) {
            setPasswordError('Новый пароль должен содержать от 10 до 128 символов.');
            return;
          }
          if (newPassword !== repeatPassword) {
            setPasswordError('Новый пароль и подтверждение не совпадают.');
            return;
          }
          setPasswordSaving(true);
          try {
            await post('/api/auth/change-password', { currentPassword, newPassword });
            setPasswordSaved(true);
            setPasswordOpen(false);
            setCurrentPassword('');
            setNewPassword('');
            setRepeatPassword('');
          } catch (error) {
            setPasswordError(error instanceof Error ? error.message : 'Не удалось изменить пароль.');
          } finally {
            setPasswordSaving(false);
          }
        }}>
          <label className="stack">Текущий пароль
            <input className="field" type="password" autoComplete="current-password" required maxLength={128}
              value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} />
          </label>
          <label className="stack">Новый пароль
            <input className="field" type="password" autoComplete="new-password" required minLength={10} maxLength={128}
              value={newPassword} onChange={event => setNewPassword(event.target.value)} />
          </label>
          <label className="stack">Повторите новый пароль
            <input className="field" type="password" autoComplete="new-password" required minLength={10} maxLength={128}
              value={repeatPassword} onChange={event => setRepeatPassword(event.target.value)} />
          </label>
          <small className="note">После смены пароля другие активные сеансы будут завершены. Временные ограничения административного доступа эта операция не меняет.</small>
          {passwordError && <p role="alert" className="note">{passwordError}</p>}
          <button type="submit" className="btn" disabled={passwordSaving || !currentPassword || !newPassword || !repeatPassword}>
            {passwordSaving ? 'Сохранение…' : 'Сохранить новый пароль'}
          </button>
        </form>}
        {passwordSaved && <p role="status">Пароль изменён. Другие сеансы завершены.</p>}
      </div>
      <div className="card stack">
        <b>Настройки приложения</b>
        <label className="row">
          <input type="checkbox" checked={reducedMotion} onChange={e => toggleMotion(e.target.checked)} />
          <span>Уменьшить анимацию</span>
        </label>
        <span className="note">Уменьшает эффекты и движения интерфейса на слабых устройствах.</span>
      </div>
      <div className="stack">
        {isCustomer && mode !== 'client' && <button className="btn ghost" onClick={() => go('as/client')}>Кабинет клиента</button>}
        {isPerformer && mode !== 'performer' && <button className="btn ghost" onClick={() => go('as/performer')}>Кабинет исполнителя</button>}

        {me.roles.includes('service') && mode !== 'service' && <button className="btn ghost" onClick={() => go('as/service')}>Кабинет СТО</button>}
        {me.roles.includes('insurer') && mode !== 'insurer' && <button className="btn ghost" onClick={() => go('as/insurer')}>Кабинет страхового партнёра</button>}
        {me.roles.some((r) => r === 'admin' || r === 'moderator') && mode !== 'admin' && <button className="btn ghost" onClick={() => go('as/admin')}>Кабинет администратора</button>}
        <button className="btn ghost" onClick={() => go('support')}>Поддержка</button>
        <button className="btn ghost" onClick={() => go('help')}>Справка: как всё устроено</button>
        <button className="btn ghost" onClick={() => go('privacy')}>Персональные данные и удаление аккаунта</button>
        <button className="btn ghost" onClick={() => go('reviews')}>Отзывы обо мне</button>
        <button className="btn ghost" onClick={() => go('appeal')}>Оспорить нарушение или блокировку</button>
        <button className="btn bad" onClick={() => {
          if (me.roles.some((r) => ['master','tow'].includes(r)) &&
              !window.confirm('При выходе из аккаунта статус «На линии» отключится. Просто сверните приложение, если хотите продолжать получать заявки. Выйти?')) return;
          void logout();
        }}>Выйти</button>
      </div>
    </main>
  );
}

async function patchMe(body: unknown) {
  const { patch } = await import('../api.ts');
  return patch('/api/me', body);
}

export async function logout() {
  const { post, setToken, disconnectWs } = await import('../api.ts');
  try {
    await post('/api/auth/logout');
  } catch (e) {
    // Do not silently sign a worker out while the server still marks them on a job.
    window.alert((e as Error).message || 'Не удалось завершить выход. Проверьте подключение.');
    return;
  }
  setToken(null);
  disconnectWs();
  location.hash = '#/login';
  location.reload();
}

const PRIO: [string, string][] = [['near', 'Ближе'], ['cheap', 'Дешевле'], ['brand', 'Знает марку'], ['fast', 'Быстрее приедет']];
/** До вызова: кто сейчас на линии рядом — без контактов; приоритет запоминается и сортирует отклики */
function MastersNearby({ service, geo, brand }: { service: string; geo: { lat: number; lng: number } | null; brand?: string }) {
  const [prio, setPrio] = useState<string>(() => { try { return localStorage.getItem('traksos.prio') ?? 'near'; } catch { return 'near'; } });
  const q = new URLSearchParams({ service, ...(geo ? { lat: String(geo.lat), lng: String(geo.lng) } : {}), ...(brand ? { brand } : {}) });
  const l = useLoad(() => get(`/api/masters-nearby?${q}`), [service, geo?.lat, brand]);
  if (!l.data) return null;
  const d = l.data;
  const choose = (k: string) => { setPrio(k); try { localStorage.setItem('traksos.prio', k); } catch { /* */ } };
  const items = [...d.items].sort((a: any, b: any) => prio === 'cheap' ? (a.callOut ?? 1e12) - (b.callOut ?? 1e12)
    : prio === 'brand' ? (b.brandStars ?? 0) - (a.brandStars ?? 0) || (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9)
    : prio === 'fast' ? (a.etaMin ?? 1e9) - (b.etaMin ?? 1e9) : (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
  return (
    <div className="card">
      <div className="between"><b>Поиск рядом с вами</b>{!geo && <span className="note">без GPS — по всему городу</span>}</div>
      <div className="grid3">
        <div className="stack" style={{ gap: 0, alignItems: 'center' }}><b style={{ fontSize: 22 }}>{d.online}</b><span className="note">на линии</span></div>
        <div className="stack" style={{ gap: 0, alignItems: 'center' }}><b style={{ fontSize: 22 }}>{d.free}</b><span className="note">свободны</span></div>
        <div className="stack" style={{ gap: 0, alignItems: 'center' }}><b style={{ fontSize: 22, color: 'var(--accent)' }}>{d.match}</b><span className="note">подходят вам</span></div>
      </div>
      <div className="row" style={{ gap: 6 }}>
        {PRIO.filter(([k]) => k !== 'brand' || brand).map(([k, n]) => <button key={k} type="button" className="chip" aria-pressed={prio === k} onClick={() => choose(k)}>{k === 'brand' && brand ? `Знает ${brand}` : n}</button>)}
      </div>
      {items.length ? items.slice(0, 3).map((m: any, i: number) => (
        <div key={i} className="between">
          <span className="stack" style={{ gap: 0 }}>
            <b>{i + 1} · Мастер {m.name} · {TIERS[m.tier as keyof typeof TIERS]?.name ?? ''} ✓</b>
            <small className="note">{m.distanceKm != null ? `${String(m.distanceKm).replace('.', ',')} км · ~${m.etaMin} мин` : 'расстояние уточним'}{m.brandStars ? ` · ${brand} ${'★'.repeat(m.brandStars)}` : ''}{m.rating ? ` · ★ ${m.rating.toFixed(1)}` : ''}</small>
          </span>
          {m.callOut != null && <span className="pill">{rub(m.callOut)}</span>}
        </div>
      )) : <span className="note">Свободных рядом сейчас нет — заявка уйдёт в торги, мастера откликнутся, когда освободятся.</span>}
      <span className="note">✓ — прошёл проверку TrakSOS. Порядок — по вашему приоритету; он же будет первым в списке откликов.</span>
    </div>
  );
}

/** Архив задач: одна поломка — одна задача. Консультация, выезды по ней и ремонт в сервисе по совету мастера — вместе. */
function TaskArchive({ orders }: { orders: any[] }) {
  const b = useLoad(() => get('/api/bookings'), []);
  const bookings = ((b.data ?? []) as any[]).filter((x) => !isOpenBooking(x));
  const root = (o: any) => o.consult_of ?? o.id;
  const groups = new Map<string, { orders: any[]; bookings: any[] }>();
  for (const o of [...orders].sort((x, y) => +new Date(x.created_at) - +new Date(y.created_at))) {
    const k = root(o);
    if (!groups.has(k)) groups.set(k, { orders: [], bookings: [] });
    groups.get(k)!.orders.push(o);
  }
  const loose: any[] = [];
  for (const bk of bookings) {
    const o = bk.fromOrderId && orders.find((x) => x.id === bk.fromOrderId);
    if (o && groups.has(root(o))) groups.get(root(o))!.bookings.push(bk); else loose.push(bk);
  }
  const list = [...groups.values()].sort((x, y) => +new Date(y.orders[y.orders.length - 1].created_at) - +new Date(x.orders[x.orders.length - 1].created_at));
  if (!list.length && !loose.length) return <div className="empty">Здесь появятся прошлые задачи: консультация, выезды и ремонт по одной поломке — вместе.</div>;
  const sum = (o: any) => o.status === 'completed' ? (o.call_out_amount ?? 0) + (o.work_amount ?? 0) : 0;
  return (
    <div className="stack">
      <span className="note">Одна поломка — одна задача: консультация, выезды, эвакуатор и сервис по ней собраны вместе.</span>
      {list.map((g) => {
        const first = g.orders[0];
        const total = g.orders.reduce((a, o) => a + sum(o), 0) + g.bookings.reduce((a, x) => a + (x.status === 'closed' ? x.toPay ?? 0 : 0), 0);
        const steps = g.orders.length + g.bookings.length;
        const title = first.problem ? (SYMPTOMS.find((p) => p.id === first.problem)?.name ?? first.description) : first.description || SERVICES[first.service]?.name;
        if (steps === 1) return (
          <a key={first.id} href={`#/order/${first.id}`} className="list-item">
            <div className="stack" style={{ gap: 2 }}><b>{title || `№${first.number}`}</b><span className="note">№{first.number} · {SERVICES[first.service]?.name} · {fmtTime(first.created_at)}{total ? ` · ${rub(total)}` : ''}</span></div>
            <span className={`pill ${STATUS[first.status]?.tone}`}>{STATUS[first.status]?.name}</span>
          </a>
        );
        return (
          <div key={first.id} className="card">
            <div className="between"><b>{title || 'Задача'}</b>{total > 0 && <span className="pill">{rub(total)}</span>}</div>
            <span className="note">{fmtTime(first.created_at)} · {steps} шага</span>
            <ol className="tl">
              {g.orders.map((o) => (
                <li key={o.id}><i className={o.status === 'completed' ? 'ok' : 'off'} /><a href={`#/order/${o.id}`}><b>{SERVICES[o.service]?.name ?? o.service}</b></a>
                  <small>№{o.number} · {STATUS[o.status]?.name}{sum(o) ? ` · ${rub(sum(o))}` : ''}</small></li>
              ))}
              {g.bookings.map((x) => (
                <li key={x.id}><i className={x.status === 'closed' ? 'ok' : 'off'} /><a href={`#/booking/${x.id}`}><b>Ремонт на рембазе «{x.center.name}»</b></a>
                  <small>{x.statusName}{x.toPay ? ` · ${rub(x.toPay)}` : ''}</small></li>
              ))}
            </ol>
          </div>
        );
      })}
      {loose.length > 0 && <BookingRows live={false} />}
    </div>
  );
}

/** Архив мастера по машинам: прошлые работы по каждой машине — что и когда делали */
function JobsByCar({ orders }: { orders: any[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const groups = new Map<string, any[]>();
  for (const o of orders) {
    const k = o.vehicle_id ?? `brand:${o.brand ?? '—'}:${o.client_name ?? ''}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(o);
  }
  if (!groups.size) return <div className="empty">Здесь появятся машины, на которых вы работали.</div>;
  return (
    <div className="stack">
      {[...groups.entries()].map(([k, list]) => {
        const o = list[0];
        const name = [o.v_brand ?? o.brand, o.v_model, o.v_year].filter(Boolean).join(' ') || 'Машина';
        return (
          <div key={k} className="card">
            <button className="between" style={{ background: 'none', border: 0, color: 'inherit', padding: 0, font: 'inherit', textAlign: 'left' }} onClick={() => setOpen(open === k ? null : k)} aria-expanded={open === k}>
              <span className="stack" style={{ gap: 0 }}><b>{name}{o.v_plate ? ` · ${o.v_plate}` : ''}</b><small className="note">{o.client_name ?? 'Клиент'} · последняя: {fmtTime(o.created_at)}</small></span>
              <span className="pill">{list.length} {list.length === 1 ? 'работа' : list.length < 5 ? 'работы' : 'работ'}</span>
            </button>
            {open === k && (
              <ol className="tl">
                {list.map((x) => <li key={x.id}><i className={x.status === 'completed' ? 'ok' : 'off'} /><a href={`#/order/${x.id}`}><b>{SERVICES[x.service]?.name ?? x.service} · №{x.number}</b></a><small>{fmtTime(x.created_at)}{x.description ? ` · ${x.description}` : ''} · {STATUS[x.status]?.name}</small></li>)}
              </ol>
            )}
          </div>
        );
      })}
      <span className="note">Нажмите машину — откроются все ваши работы по ней.</span>
    </div>
  );
}
