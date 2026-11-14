import { RecommendService } from './base.tsx';
import { useEffect, useRef, useState } from 'react';
import { get, post, rub, fmtTime } from '../api.ts';
import { SERVICES, STATUS, STEPS, STEP_NAMES, RESULTS, CONSULT_HINTS, CONSULT_CONF } from '../dict.ts';
import { go } from '../ui.tsx';
import { useLoad, useAction, useMe, Loading, Back, RubInput, Field, useToast, VehicleFields } from '../ui.tsx';
import { onEvent } from '../api.ts';
import { Search, OfferForm } from './search.tsx';
import { RoadsideMap } from './roadsideMap.tsx';
import { LocationSharing } from './performer.tsx';
import { RefundForm, payStatus } from './adminUser.tsx';

export function Order({ id }: { id: string }) {
  const o = useLoad(() => get(`/api/orders/${id}`), [id], (e) => e.orderId === id && (e.type === 'order' || e.type === 'payment'));
  const [perfPos, setPerfPos] = useState<{ lat: number; lng: number; at: number } | null>(null);
  useEffect(() => {
    setPerfPos(null); // Never display another order's last GPS position after switching the route.
    return onEvent(e => {
      if(e.type === 'performer_location' && e.orderId === id &&
        Number.isFinite(e.lat) && Number.isFinite(e.lng) &&
        Math.abs(e.lat) <= 90 && Math.abs(e.lng) <= 180)
        setPerfPos({lat:e.lat,lng:e.lng,at:Date.now()});
    });
  }, [id]);

  const { mode } = useMe();
  const [ptab, setPtab] = useState<'order' | 'client'>('order');
  const backTo = mode === 'admin' ? 'admin' : mode === 'performer' ? 'work' : 'orders';
  if (!o.data) return <main><Back to={backTo} /><Loading error={o.error} /></main>;
  const d = o.data;
  const isPerformer = d.you === 'performer';
  const done = ['completed', 'cancelled'].includes(d.status);
  const isConsult = d.service === 'consult';

  return (
    <main>
      <Back to={d.you === 'performer' ? 'work/jobs' : d.you === 'candidate' ? 'work' : d.you === 'admin' ? 'admin' : 'orders'} />
      <div className="between" style={{ alignItems: 'flex-start' }}>
        <div>
          <h1>№{d.number} · {SERVICES[d.service]?.name ?? d.service}</h1>
          <div className="sub">{d.isSos ? 'SOS · ' : ''}{fmtTime(d.createdAt)} · {isConsult ? 'по телефону, без выезда' : d.estimate?.zoneName}</div>
        </div>
        <span className={`pill ${STATUS[d.status]?.tone}`}>{isConsult && d.status === 'accepted' ? 'На связи' : isConsult && d.status === 'awaiting_confirmation' ? 'Ждём «Вопрос решён»' : STATUS[d.status]?.name}</span>
      </div>

      {isPerformer && ['accepted','en_route','arrived','working'].includes(d.status)
        && !location.hash.startsWith('#/admin/test-center') &&
        <section className="roadside-location-share" aria-label="Передача GPS при выезде">
          <b>GPS во время выезда</b>
          <LocationSharing />
        </section>}
      {(isPerformer || d.you === 'candidate') && <PerformerTabs tab={ptab} setTab={setPtab} />}
      {(isPerformer || d.you === 'candidate') && ptab === 'client' ? <ClientTab id={id} canEdit={isPerformer} /> : <>
      {d.status === 'awaiting_owner' && <OwnerApproval d={d} onDone={o.reload} />}
      {d.status === 'searching' && (d.you === 'client' || d.you === 'admin') && <Search d={d} onChosen={o.reload} />}
      {d.you === 'candidate' && <CandidateView d={d} onDone={o.reload} />}

      {!isConsult && !['cancelled', 'no_performer', 'searching', 'awaiting_owner'].includes(d.status) && <Steps status={d.status} service={d.service} />}
      {isConsult && !isPerformer && d.you !== 'candidate' && <ConsultClient d={d} />}
      {d.consultFrom?.hint && <ConsultHintCard from={d.consultFrom} />}
      {d.status === 'no_performer' && !isPerformer && <Retry id={id} onDone={o.reload} />}

      {d.performer && !isPerformer && <PerformerCard p={d.performer} pos={perfPos} consult={isConsult} to={d.lat != null ? { lat: d.lat, lng: d.lng } : null} moving={['accepted', 'en_route'].includes(d.status)} />}
      {isPerformer && <ClientCard d={d} />}
      {d.service === 'tow' && !isPerformer && d.you !== 'candidate' && d.destination && <TowInfo d={d} />}

      {d.you !== 'candidate' && d.status !== 'searching' && <Money d={d} />}

      {d.you === 'admin' && <AdminPanel d={d} onDone={o.reload} />}
      {(d.you === 'client' || d.you === 'admin') && d.paymentMethod !== 'cash' && <PaymentsList id={id} admin={d.you === 'admin'} />}
      {isPerformer && (isConsult ? <ConsultFinish d={d} onDone={o.reload} /> : <PerformerActions d={d} onDone={o.reload} />)}
      {!isPerformer && ['arrived', 'working'].includes(d.status) && d.service !== 'consult' && <WorkInProgress d={d} />}
      {d.you !== 'candidate' && d.you !== 'admin' && d.service !== 'tow' && d.service !== 'consult' && ['arrived', 'working'].includes(d.status) && <PartPicker d={d} onDone={o.reload} performer={isPerformer} />}
      {!isPerformer && d.status === 'awaiting_confirmation' && (isConsult ? <ConsultConfirm d={d} onDone={o.reload} /> : <ConfirmAmount d={d} onDone={o.reload} />)}
      {d.recommendedCenter && !isPerformer && d.you !== 'candidate' && (
        <div className="banner good col">
          <b>Мастер советует сервис «{d.recommendedCenter.name}»</b>
          <span className="note">{d.recommendedCenter.address} · по совету мастера — скидка в счёте.</span>
          <a className="btn small" href={`#/services/${d.recommendedCenter.id}/book?from=${d.id}`}>Записаться</a>
        </div>
      )}
      {d.status === 'completed' && <Review id={id} you={d.you} />}

      {d.status !== 'searching' && d.status !== 'no_performer' && <Chat id={id} status={d.status} />}
      </>}

      {d.you !== 'admin' && d.you !== 'candidate' && <a className="btn ghost" href={`#/support/new?order=${d.id}`}>Позвать поддержку</a>}
      {!done && d.actions.includes('cancel') && !isPerformer && !(isConsult && d.status === 'awaiting_confirmation') && <Cancel id={id} status={d.status} consult={isConsult} onDone={o.reload} />}
      {d.status === 'cancelled' && <div className="card"><b>Заявка отменена</b><span className="note">{d.cancelReason}</span></div>}
    </main>
  );
}

/** Водитель заказал дороже лимита: владелец подтверждает, водитель ждёт */
function OwnerApproval({ d, onDone }: { d: any; onDone: () => void }) {
  const { me } = useMe();
  const { busy, run } = useAction();
  const [why, setWhy] = useState('');
  if (me?.owner_id || d.you !== 'client') return <div className="banner warn col"><b>Ждёт подтверждения владельца</b><span className="note">{d.ownerNote ? `Причина: ${d.ownerNote}. ` : ''}Владельцу пришло уведомление. SOS — без подтверждения, всегда.</span></div>;
  return (
    <div className="card hi">
      <b>Водитель просит подтвердить заказ</b>
      <span className="note">{d.ownerNote} · выезд {rub(d.money?.callOut ?? d.estimate?.callOut)}</span>
      <div className="grid2">
        <button className="btn" disabled={busy} onClick={async () => { if (await run(() => post(`/api/orders/${d.id}/owner-decision`, { approve: true }), 'Подтверждено — ищем исполнителя')) onDone(); }}>Подтвердить</button>
        <button className="btn ghost" disabled={busy} onClick={async () => { if (await run(() => post(`/api/orders/${d.id}/owner-decision`, { approve: false, reason: why || undefined }), 'Отклонено — водитель увидит в чате')) onDone(); }}>Отклонить</button>
      </div>
      <input className="field" placeholder="Причина отказа — водитель увидит (по желанию)" value={why} onChange={(e) => setWhy(e.target.value)} />
    </div>
  );
}

const TOW_STEP_NAMES: Record<string, string> = { ...STEP_NAMES, accepted: 'Эвакуатор выбран', arrived: 'На месте', working: 'Погрузил', awaiting_confirmation: 'Доставил · сумма' };
const CARGO: Record<string, string> = { tractor: 'Тягач', semitrailer: 'Полуприцеп', coupling: 'Сцепка целиком', truck12: 'Грузовик до 12 т', bus: 'Автобус', special: 'Спецтехника' };
const LOADED: Record<string, string> = { empty: 'пустой', loaded: 'гружёный', adr: 'опасный груз ADR' };

function TowInfo({ d }: { d: any }) {
  return (
    <div className="card">
      <dl className="kv">
        <dt>Откуда</dt><dd>{d.address ?? d.estimate?.zoneName}</dd>
        <dt>Куда</dt><dd>{d.destination}</dd>
        {d.cargo && <><dt>Что везём</dt><dd>{CARGO[d.cargo]}{d.loaded ? `, ${LOADED[d.loaded]}` : ''}</dd></>}
        {d.driverOnSite != null && <><dt>Водитель</dt><dd>{d.driverOnSite ? 'на месте, ключи у него' : 'не на месте'}</dd></>}
      </dl>
    </div>
  );
}

/** Исполнитель, которому предложена заявка: подробности и отклик */
function CandidateView({ d, onDone }: { d: any; onDone: () => void }) {
  if (d.status !== 'searching') return <div className="card"><b>Заявка уже у другого исполнителя</b></div>;
  return (
    <div className="stack">
      <div className="card">
        <dl className="kv">
          <dt>Машина</dt><dd>{[d.brand, d.model, d.year].filter(Boolean).join(' ') || '—'}</dd>
          <dt>Где</dt><dd>{d.service === 'consult' ? 'По телефону — без выезда' : d.address ?? d.estimate?.zoneName}</dd>
          {d.destination && <><dt>Куда</dt><dd>{d.destination}</dd></>}
          {d.cargo && <><dt>Что везём</dt><dd>{CARGO[d.cargo]}{d.loaded ? `, ${LOADED[d.loaded]}` : ''}</dd></>}
          {d.description && <><dt>Что случилось</dt><dd>{d.description}</dd></>}
          {d.site && <><dt>Условия</dt><dd><SitePills site={d.site} /></dd></>}
          {d.estimate?.hour != null && <><dt>Час работы</dt><dd>{rub(d.estimate.hour)} — или по вашему профилю</dd></>}
        </dl>
      </div>
      {d.limits && <OfferForm orderId={d.id} limits={d.limits} onDone={onDone} />}
      <span className="note">Клиент видит ваш рейтинг, подачу и цену. Контакты откроются, когда он выберет вас.</span>
    </div>
  );
}

function Steps({ status, service }: { status: string; service: string }) {
  const idx = STEPS.indexOf(status);
  const names = service === 'tow' ? TOW_STEP_NAMES : STEP_NAMES;
  return (
    <ol className="steps card">
      {STEPS.filter((s) => s !== 'searching').map((s, i, arr) => (
        <li key={s} className={i + 1 < idx || status === 'completed' ? 'done' : i + 1 === idx ? 'now' : ''}>
          <div className="rail"><span className="d" />{i < arr.length - 1 && <span className="ln" />}</div>
          <span className="tx">{names[s]}</span>
        </li>
      ))}
    </ol>
  );
}

function PerformerCard({p,pos,consult,to,moving}:{
  p:any;pos:{lat:number;lng:number;at:number}|null;consult?:boolean;
  to?:{lat:number;lng:number}|null;moving?:boolean;
}){
  const previousPoint=Number.isFinite(p.lat)&&Number.isFinite(p.lng)?{lat:p.lat,lng:p.lng}:null;
  const at=consult?null:pos??previousPoint;
  const lastAt=pos?.at??(p.location_at?Date.parse(p.location_at):null);
  const ageMs=lastAt==null?null:Date.now()-lastAt;
  const fresh=ageMs!=null && ageMs>=-30000 && ageMs<=120000;
  // An estimate is NOT a routing ETA; it is omitted for old/missing GPS.
  const km=fresh&&at&&to?Math.hypot((at.lat-to.lat)*111,(at.lng-to.lng)*111*Math.cos(to.lat*Math.PI/180))*1.3:null;
  const min=km!=null?Math.max(5,Math.round(km/40*60)):null;
  return <div className="card roadside-performer-card">
    <div className="between">
      <b>{p.name??'Исполнитель'}</b>
      <span className="pill">{p.rating?`★ ${p.rating.toFixed(1)} · ${p.rating_count}`:'Новый мастер'}</span>
    </div>
    {p.car&&!consult&&<span className="note">Приедет на: {p.car.brand}{p.car.color?`, ${p.car.color}`:''}, {p.car.plate}</span>}
    {!consult&&<div className="roadside-tracking-status">
      <span aria-hidden="true">{fresh?'●':'○'}</span>
      <b>{fresh?'GPS исполнителя обновлялся недавно':at?'Последняя GPS-точка устарела':'Ждём геолокацию исполнителя'}</b>
      <small>{fresh?'Координаты обновляются, пока устройство передаёт их на сервер.':
        'Местоположение не подтверждено сейчас. Не используйте старую точку как текущую.'}</small>
    </div>}
    {moving&&min!=null&&<div className="roadside-eta">
      <b>Ориентир: около {min} мин · {String(Math.round(km!*10)/10).replace('.',',')} км</b>
      <small>Грубая оценка без учёта маршрута, трафика и ограничений для грузовиков — не обещание времени прибытия.</small>
    </div>}
    {!consult&&<RoadsideMap point={at} kind="performer" updatedAt={lastAt}
      synthetic={String(p.id??'').startsWith('demo-')}/>}
    <span className="note">Общение — через чат заявки. Личные номера скрыты.</span>
  </div>;
}

function ClientCard({ d }: { d: any }) {
  return (
    <div className="card">
      <dl className="kv">
        <dt>Клиент</dt><dd>{d.client?.company_name ?? d.client?.name ?? 'Клиент'}{d.client?.rating ? ` · ★ ${d.client.rating.toFixed(1)}` : ''}</dd>
        <dt>Машина</dt><dd>{d.vehicle ? `${d.vehicle.brand} ${d.vehicle.model ?? ''} ${d.vehicle.year ?? ''} · ${d.vehicle.plate ?? ''}` : [d.brand, d.model, d.year].filter(Boolean).join(' ') || '—'}</dd>
        <dt>Где</dt><dd>{d.service === 'consult' ? 'По телефону — без выезда' : d.address ?? d.estimate?.zoneName}</dd>
        {d.description && <><dt>Что случилось</dt><dd>{d.description}</dd></>}
        {d.site && <><dt>Условия</dt><dd><SitePills site={d.site} /></dd></>}
      </dl>
      {d.lat != null && d.service !== 'consult' && (
        <a className="btn ghost" target="_blank" rel="noreferrer" href={`https://yandex.ru/maps/?rtext=~${d.lat},${d.lng}&rtt=auto`}>Маршрут в Яндекс Картах</a>
      )}
    </div>
  );
}

/** Правило тарификации одной фразой — его видят и клиент, и мастер */
export function billingRule(step: number) {
  return step === 30
    ? 'Время работы считается по получасам: начатые полчаса — полные полчаса.'
    : 'Каждый начатый час работы считается полным — даже если работа заняла 10 минут.';
}
const hrs = (units: number, step: number) => `${String((units * step) / 60).replace('.', ',')} ч`;
const dur = (min: number) => min >= 60 ? `${Math.floor(min / 60)} ч ${min % 60} мин` : `${min} мин`;

/** Живая разбивка по таймеру — так же считает сервер */
function liveBill(d: any, now: number, extras: { name: string; amount: number }[]) {
  if (d.status === 'awaiting_confirmation' && d.bill) return { ...d.bill, extras, extrasSum: extras.reduce((s, x) => s + x.amount, 0) };
  const step = d.billingStep === 30 ? 30 : 60;
  const hour = d.service === 'tow' ? null : d.estimate?.hour ?? null;
  let waitMinutes = d.waitMinutes ?? 0;
  if (d.waitStartedAt) waitMinutes += Math.max(1, Math.round((now - new Date(d.waitStartedAt).getTime()) / 60000));
  const from = d.arrivedAt ?? d.workStartedAt;
  const work = from ? Math.max(0, Math.floor((now - new Date(from).getTime()) / 60000)) : null;
  const minutes = work == null ? 0 : Math.max(0, work - waitMinutes);
  const units = hour == null || work == null ? 0 : Math.max(1, Math.ceil(minutes / step));
  const time = hour == null ? 0 : Math.round((hour * units * step) / 60);
  const wait = d.waitRate && waitMinutes ? Math.round((d.waitRate * waitMinutes) / 60 / 100) * 100 : 0;
  const extrasSum = extras.reduce((s, x) => s + x.amount, 0);
  return { minutes, step, units, hour, time, waitMinutes, waitRate: d.waitRate, wait, extras, extrasSum, total: time + wait + extrasSum };
}

/** Строки суммы за работу: время, ожидание, каждая доп. позиция */
function BillRows({ b }: { b: any }) {
  return <>
    {b.units > 0 && <div className="sum"><span>Работа · {hrs(b.units, b.step)} × {rub(b.hour)}<small className="note" style={{ display: 'block' }}>по таймеру {dur(b.minutes)}</small></span><span>{rub(b.time)}</span></div>}
    {b.wait > 0 && <div className="sum"><span>Ожидание запчасти · {b.waitMinutes} мин</span><span>{rub(b.wait)}</span></div>}
    {(b.extras ?? []).map((x: any, i: number) => <div key={i} className="sum"><span>{x.name}</span><span>{rub(x.amount)}</span></div>)}
  </>;
}

function Money({ d }: { d: any }) {
  const m = d.money;
  const proposed = ['awaiting_confirmation', 'completed'].includes(d.status) || m.work > 0;
  if (d.service === 'consult') return (
    <div className="card">
      <div className="sum total"><span>Консультация</span><span>{rub(m.callOut)}</span></div>
      {m.discount > 0 && d.you !== 'performer' && <div className="sum" style={{ color: 'var(--good-fg)' }}><span>Скидка{d.discountReason ? ` · ${d.discountReason}` : ''}</span><span>−{rub(m.discount)}</span></div>}
      <span className="note">{d.you === 'performer' ? 'Фиксированная цена. Вам — за вычетом комиссии площадки.' : 'Фиксированная цена, сбор уже внутри. Выезд и работа сюда не входят.'}</span>
    </div>
  );
  return (
    <div className="card">
      <b>{proposed ? 'Сумма' : 'Цена'}</b>
      <div className="sum"><span>Выезд{d.groupTrip ? ' (совместный)' : ''}{d.night ? ' · ночь' : ''}</span><span>{rub(m.callOut)}</span></div>
      {proposed ? (d.bill ? <BillRows b={d.bill} /> : <div className="sum"><span>Работа</span><span>{rub(m.work)}</span></div>)
        : d.estimate?.hour != null && <div className="sum"><span>Час работы</span><span>{rub(d.estimate.hour)}</span></div>}
      {proposed && m.clientFee > 0 && <div className="sum"><span>Сервисный сбор<small className="note" style={{ display: 'block' }}>{d.you === 'performer' ? '' : 'на рекламу, поддержку и развитие платформы'}</small></span><span>{rub(m.clientFee)}</span></div>}
      {m.discount > 0 && d.you !== 'performer' && <div className="sum" style={{ color: 'var(--good-fg)' }}><span>Скидка{d.discountReason ? ` · ${d.discountReason}` : ''}</span><span>−{rub(m.discount)}</span></div>}
      {proposed && <><div className="hr" /><div className="sum total"><span>Итого</span><span>{rub(m.total)}</span></div></>}
      {d.service !== 'tow' && d.estimate?.hour != null && !proposed && <span className="note">{billingRule(d.billingStep)}</span>}
      <span className="note">
        {d.paymentMethod === 'cash' ? 'Оплата мастеру на месте. Сумму подтверждаете в приложении.' : d.paymentMethod === 'online' ? 'Оплата через ТракSOS, мастеру — после подтверждения.' : 'Оплата по счёту на компанию.'}
      </span>
      {d.result && <span className="pill">{RESULTS[d.result]}{d.resultNote ? ` · ${d.resultNote}` : ''}</span>}
    </div>
  );
}

function PerformerActions({ d, onDone }: { d: any; onDone: () => void }) {
  const { busy, run } = useAction();
  const [extras, setExtras] = useState<{ name: string; amount: number | null }[]>(d.bill?.extras ?? []);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, []);
  const cleanExtras = extras.filter((x) => x.name.trim().length >= 2 && (x.amount ?? 0) > 0).map((x) => ({ name: x.name.trim(), amount: x.amount as number }));
  const bill = liveBill(d, now, cleanExtras);
  const setExtra = (i: number, v: Partial<{ name: string; amount: number | null }>) => setExtras(extras.map((x, j) => (j === i ? { ...x, ...v } : x)));
  const [result, setResult] = useState<string>(d.result ?? 'solved');
  const [note, setNote] = useState(d.resultNote ?? '');
  const [dropReason, setDropReason] = useState('');
  const [showDrop, setShowDrop] = useState(false);
  const step = (action: string, text: string) => run(() => post(`/api/orders/${d.id}/step`, { action }), text).then((r) => r && onDone());

  if (['completed', 'cancelled'].includes(d.status)) return null;
  return (
    <div className="stack">
      {d.consultFrom?.hint && <HintCheck d={d} onDone={onDone} />}
      {d.status === 'accepted' && <button className="btn" disabled={busy} onClick={() => step('depart', 'Клиент видит, что вы выехали')}>Выехал</button>}
      {['accepted', 'en_route'].includes(d.status) && <LateButtons d={d} onDone={onDone} />}
      {['arrived', 'working', 'awaiting_confirmation'].includes(d.status) && <SiteFlags d={d} onDone={onDone} />}
      {d.service !== 'tow' && ['arrived', 'working', 'awaiting_confirmation'].includes(d.status) && <RecommendService order={d} onDone={onDone} />}
      {d.status === 'en_route' && <button className="btn" disabled={busy} onClick={() => step('arrive', 'Клиент видит, что вы на месте')}>Я на месте</button>}
      {d.status === 'arrived' && <button className="btn" disabled={busy} onClick={() => step('start_work', 'Работа началась')}>Начать работу</button>}

      {['working', 'awaiting_confirmation'].includes(d.status) && (
        <div className="card">
          <b>{d.status === 'awaiting_confirmation' ? 'Ждём подтверждения клиента' : 'Закрыть выезд'}</b>
          <BillRows b={bill} />
          
          {bill.hour != null && <span className="note">Время идёт с «Я на месте» по цене часа {rub(bill.hour)}, о которой договорились до вызова, — его не изменить. {billingRule(bill.step)}</span>}
          <b style={{ fontSize: 14 }}>Расходники и запчасти</b>
          {extras.map((x, i) => (
            <div key={i} className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
              <input className="field" placeholder="Что: предохранители, провод, блок…" value={x.name} maxLength={60} onChange={(e) => setExtra(i, { name: e.target.value })} style={{ flex: 2 }} />
              <div style={{ flex: 1 }}><RubInput value={x.amount} onChange={(v) => setExtra(i, { amount: v })} /></div>
              <button type="button" className="btn ghost small" aria-label="Убрать строку" onClick={() => setExtras(extras.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
          {extras.length < 10 && <div className="row" style={{ gap: 6 }}>
            {['Расходники', 'Запчасть по чеку'].map((n) => <button key={n} type="button" className="pill" onClick={() => setExtras([...extras, { name: n, amount: null }])}>+ {n}</button>)}
          </div>}
          <div className="hr" />
          <div className="sum total"><span>За работу итого</span><span>{rub(bill.total)}</span></div>
          <span className="note">Плюс выезд {rub(d.money.callOut)}{d.money.clientFee ? ' и сервисный сбор' : ''}. Клиент увидит каждую строку.</span>
          <div className="stack">
            {Object.entries(RESULTS).map(([k, v]) => (
              <button key={k} type="button" className="opt" aria-pressed={result === k} onClick={() => setResult(k)}><b>{v}</b></button>
            ))}
          </div>
          <input className="field" placeholder="Что сделали — одной строкой" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          <button className="btn" disabled={busy} onClick={() =>
            run(() => post(`/api/orders/${d.id}/amount`, { extras: cleanExtras, result, note: note || undefined }), 'Клиенту отправлено на подтверждение').then((r) => r && onDone())}>
            {d.status === 'awaiting_confirmation' ? 'Исправить сумму' : 'Отправить клиенту'}
          </button>
        </div>
      )}

      {['arrived', 'working', 'awaiting_confirmation'].includes(d.status) && <ClientRefuses d={d} onDone={onDone} />}
      {['accepted', 'en_route'].includes(d.status) && (showDrop ? (
        <div className="card">
          <b>Не сможете приехать?</b>
          <span className="note">Заявка уйдёт другим мастерам. Частые отказы снижают рейтинг.</span>
          <input className="field" placeholder="Причина" value={dropReason} onChange={(e) => setDropReason(e.target.value)} />
          <button className="btn bad" disabled={busy || dropReason.length < 2} onClick={() =>
            run(() => post(`/api/orders/${d.id}/drop`, { reason: dropReason }), 'Заявка передана другим').then((r) => r && (location.hash = '#/work'))}>Отказаться</button>
        </div>
      ) : <button className="btn bad" onClick={() => setShowDrop(true)}>Не смогу приехать</button>)}
    </div>
  );
}

/** Мастер: клиент отказывается платить — сразу поддержка */
function ClientRefuses({ d, onDone }: { d: any; onDone: () => void }) {
  const { busy, run } = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!open) return <button className="btn ghost small" onClick={() => setOpen(true)}>Клиент отказывается платить</button>;
  return (
    <div className="card">
      <b>Клиент отказывается платить</b>
      <span className="note">Подключим поддержку: она свяжется с клиентом и разберёт по чату, фото и таймеру. Не спорьте на месте.</span>
      <textarea className="field" placeholder="Что случилось: уехал не заплатив, говорит, что не сделано…" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      <button className="btn bad" disabled={busy || reason.trim().length < 5} onClick={() =>
        run(() => post(`/api/orders/${d.id}/nonpayment`, { kind: 'client_refuses', reason }), 'Поддержка подключена').then((r) => { if (r) { setOpen(false); onDone(); } })}>Позвать поддержку</button>
      <button className="btn ghost small" onClick={() => setOpen(false)}>Отмена</button>
    </div>
  );
}

const PLACE: Record<string, string> = { parking: 'Парковка', yard: 'Стоянка', plant: 'Завод', road: 'Трасса' };
const PASS: Record<string, string> = { none: 'пропуск не нужен', onsite: 'пропуск на месте', ahead: 'пропуск заранее' };
const STATE: Record<string, string> = { loading: 'идёт погрузка', other_work: 'идут другие работы' };
const WHEN: Record<string, string> = { today: 'сегодня', tomorrow: 'завтра' };

/** Условия на месте одной строкой меток: где стоит, пропуск, кто встретит, что с машиной, когда */
function SitePills({ site }: { site: any }) {
  const items = [
    site.place && PLACE[site.place], site.place === 'plant' && site.pass && PASS[site.pass], site.meet && `встретит: ${site.meet}`,
    site.state && STATE[site.state], site.when && WHEN[site.when] && `${WHEN[site.when]}${site.time ? ` к ${site.time}` : ''}`,
  ].filter(Boolean) as string[];
  if (!items.length) return <>—</>;
  return <span className="row" style={{ gap: 4 }}>{items.map((x) => <span key={x} className={`pill ${/погрузка|работы|заранее/.test(x) ? 'warn' : ''}`}>{x}</span>)}</span>;
}

/** Клиент: «Работа идёт» — таймер с начала работы, примерная сумма по часам, гарантия */
function WorkInProgress({ d }: { d: any }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const start = d.arrivedAt ?? d.workStartedAt;
  if (!start) return null;
  const sec = Math.max(0, Math.floor((now - new Date(start).getTime()) / 1000));
  const clock = `${Math.floor(sec / 3600)}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  const b = liveBill(d, now, []);
  const due = d.money.callOut + b.time + b.wait;
  return (
    <div className="card flat" style={{ alignItems: 'center', textAlign: 'center' }}>
      <span className="label" style={{ color: 'var(--accent)' }}>Мастер на месте · время идёт</span>
      <div className="timer">{clock}</div>
      {b.hour != null && <>
        <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 22 }}>{rub(due)}</div>
        <span className="note">Сейчас к оплате: выезд {rub(d.money.callOut)} + {hrs(b.units, b.step)} × {rub(b.hour)}{b.wait ? ` + ожидание ${rub(b.wait)}` : ''}. Эта сумма не меняется задним числом — мастер может добавить только расходники и запчасти, отдельными строками.</span>
        <span className="note">{billingRule(d.billingStep)}</span>
      </>}
      <div className="banner good" style={{ textAlign: 'left' }}><span>Гарантия на работу — <b>14 дней</b>: та же поломка снова — повторный выезд бесплатно.</span></div>
    </div>
  );
}

/** «Нужна запчасть, которой нет у мастера?» — мастер ждёт / уедет и вернётся / эвакуатор. Видят обе стороны. */
function PartPicker({ d, onDone, performer }: { d: any; onDone: () => void; performer?: boolean }) {
  const { busy, run } = useAction();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!d.waitStartedAt) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [d.waitStartedAt]);
  const set = (mode: string, text: string) => run(() => post(`/api/orders/${d.id}/part`, { mode }), text).then((r) => { if (r) onDone(); return r; });
  const waitMin = d.waitStartedAt ? Math.floor((now - new Date(d.waitStartedAt).getTime()) / 60000) : 0;
  const rate = d.waitRate;
  if (d.waitStartedAt) return (
    <div className="banner warn col">
      <b>Ожидание запчасти · {waitMin} мин{d.waitMinutes ? ` (до этого ${d.waitMinutes} мин)` : ''}</b>
      <span className="note">Таймер на «ожидании»{rate ? ` — ${rub(rate)}/ч, дешевле часа работы` : ''}. Привезли не ту деталь — ожидание продолжается.</span>
      <button className="btn small" disabled={busy} onClick={() => set('resume', 'Работа продолжается')}>Запчасть на месте — продолжаем</button>
    </div>
  );
  return (
    <details className="card">
      <summary><b>Нужна запчасть, которой нет у мастера?</b></summary>
      <div className="stack" style={{ marginTop: 8 }}>
        <button className="opt" disabled={busy} onClick={() => set('wait', 'Таймер переключён на ожидание')}><b>Мастер ждёт</b><small>Таймер переключится на «ожидание» по ставке мастера{rate ? ` ${rub(rate)}/ч` : ''}. Дорогу за запчастью оплачивает тот, кто уехал.</small></button>
        <button className="opt" aria-pressed={d.partMode === 'return'} disabled={busy} onClick={() => set('return', 'Мастер вернётся с запчастью')}><b>Уедет и вернётся</b><small>Мастер закроет текущую работу и вернётся, когда деталь будет на месте. Возвращение — новый выезд по его прайсу.</small></button>
        <button className="opt" aria-pressed={d.partMode === 'tow'} disabled={busy} onClick={async () => { if (await set('tow', 'Мастер закроет работу с диагнозом') && !performer) { try { sessionStorage.setItem('traksos.prefill', JSON.stringify({ address: d.address ?? '' })); } catch { /* */ } go('new/tow'); } }}><b>Эвакуатор</b><small>Мастер закроет работу с диагнозом — его увидит сервис. Эвакуатор — с этого же места.</small></button>
      </div>
    </details>
  );
}

// Мастер на заявке --------------------------------------------------------------

function PerformerTabs({ tab, setTab }: { tab: string; setTab: (t: any) => void }) {
  return (
    <div className="grid2" role="tablist">
      <button className="seg" role="tab" aria-pressed={tab === 'order'} onClick={() => setTab('order')}>Заявка</button>
      <button className="seg" role="tab" aria-pressed={tab === 'client'} onClick={() => setTab('client')}>Клиент и машина</button>
    </div>
  );
}

function LateButtons({ d, onDone }: { d: any; onDone: () => void }) {
  const { busy, run } = useAction();
  const [open, setOpen] = useState(false);
  if (!open) return <button className="btn ghost" onClick={() => setOpen(true)}>Опаздываю{d.lateMinutes ? ` · уже +${d.lateMinutes} мин` : ''}</button>;
  return (
    <div className="card">
      <b>На сколько задерживаетесь?</b>
      <div className="grid3">{[15, 30, 60].map((m) => (
        <button key={m} className="seg" disabled={busy} onClick={() => run(() => post(`/api/orders/${d.id}/late`, { minutes: m }), 'Клиент увидит новое время').then((r) => { if (r) { setOpen(false); onDone(); } })}>+{m < 60 ? `${m} мин` : '1 час'}</button>
      ))}</div>
      <span className="note">Клиент получит уведомление сразу. До 40 минут для грузовых не считается нарушением — если предупредили.</span>
    </div>
  );
}

const SITE_FLAGS: [string, string][] = [['waited', 'Ждал клиента'], ['client_left', 'Клиент отъехал'], ['loading', 'Работал во время погрузки'], ['gate', 'Долгий въезд, досмотр'], ['price_dispute', 'Спор о цене']];

function SiteFlags({ d, onDone }: { d: any; onDone: () => void }) {
  const { busy, run } = useAction();
  const cur: string[] = d.siteFlags ?? [];
  const toggle = (f: string) => run(() => post(`/api/orders/${d.id}/site-flags`, { flags: cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f] })).then((r) => r && onDone());
  return (
    <div className="card">
      <b>Отметки на месте · по желанию</b>
      <div className="row">{SITE_FLAGS.map(([id, n]) => (
        <button key={id} className="chip" disabled={busy} aria-pressed={cur.includes(id)} onClick={() => toggle(id)}>{cur.includes(id) ? '✓ ' : ''}{n}</button>
      ))}</div>
      <span className="note">Ожидание и время на въезд оплачиваются по вашей ставке — укажите их в сумме. Отметки попадут в карточку клиента: другие исполнители будут знать заранее.</span>
    </div>
  );
}

function HintCheck({ d, onDone }: { d: any; onDone: () => void }) {
  const { busy, run } = useAction();
  const h = d.consultFrom.hint;
  return (
    <div className="card flat">
      <span className="label">Подсказка с консультации{d.consultFrom.performer_name ? ` · ${d.consultFrom.performer_name}` : ''}</span>
      <b>Подозрение: {h.hints.join(', ').toLowerCase()}</b>
      <span className="note">{CONSULT_CONF[h.confidence]}{h.note ? ` · ${h.note}` : ''}</span>
      {d.hintCheck ? <span className="note" style={{ color: 'var(--good-fg)' }}>Вы отметили: {{ yes: 'подтвердилось', part: 'частично', no: 'не подтвердилось' }[d.hintCheck as 'yes']}. Это учтётся в точности подсказок — без штрафов.</span> : (
        <>
          <span className="note">На месте отметьте, совпало ли, — одним нажатием.</span>
          <div className="grid3">{([['yes', 'Подтвердилось'], ['part', 'Частично'], ['no', 'Нет']] as const).map(([k, n]) => (
            <button key={k} className="seg" style={{ fontSize: 13 }} disabled={busy} onClick={() => run(() => post(`/api/orders/${d.id}/hint-check`, { result: k }), 'Спасибо').then((r) => r && onDone())}>{n}</button>
          ))}</div>
        </>
      )}
    </div>
  );
}

/** Вкладка «Клиент и машина»: метки других исполнителей, история машины без сумм, уточнить машину, «не брать этого клиента» */
function ClientTab({ id, canEdit }: { id: string; canEdit: boolean }) {
  const card = useLoad(() => get(`/api/orders/${id}/client-card`), [id]);
  const { busy, run } = useAction();
  const [fix, setFix] = useState(false);
  const [v, setV] = useState({ brand: '', model: '', year: '', axles: '' });
  if (!card.data) return <Loading error={card.error} />;
  const c = card.data;
  const veh = c.vehicle;
  return (
    <div className="stack">
      <div className="card">
        <div className="between">
          <div><b>{c.client.company_name ?? c.client.name ?? 'Клиент'}</b>{c.client.company_inn && <div className="note">ИНН {c.client.company_inn}</div>}</div>
          <div style={{ textAlign: 'right' }}><b>{c.client.rating ? `★ ${c.client.rating.toFixed(1)}` : 'новый'}</b><div className="note">{c.stats.done ? `${c.stats.done} заявок · от ${c.stats.performers} исполн.` : 'первая заявка'}</div></div>
        </div>
        {c.marks.length > 0 ? <div className="row">{c.marks.map((m: any) => <span key={m.label} className={`pill ${m.tone}`}>{m.label} · {m.n}</span>)}</div>
          : <span className="note">Отметок от исполнителей пока нет.</span>}
        <span className="note">Метки — из отзывов и отметок на месте других мастеров и эвакуаторщиков. Суммы клиента не видны никому.</span>
      </div>

      <div className="card">
        <div className="between"><b>{[veh.brand, veh.model, veh.year].filter(Boolean).join(' ') || 'Машина не указана'}</b>{veh.plate && <span className="pill">{veh.plate}</span>}</div>
        <span className="note">{veh.fixed_at ? `Уточнено мастером ${veh.fixed_by_name ?? ''}` : veh.from === 'order' ? 'Со слов клиента, не из гаража' : 'Со слов клиента'}{veh.axles ? ` · осей: ${veh.axles}` : ''}</span>
        {canEdit && !fix && <button className="btn ghost small" onClick={() => { setV({ brand: veh.brand ?? '', model: veh.model ?? '', year: veh.year ? String(veh.year) : '', axles: veh.axles ? String(veh.axles) : '' }); setFix(true); }}>{veh.fixed_at ? 'Исправить ещё раз' : 'Проверить на месте · исправить'}</button>}
        {fix && (
          <div className="stack" style={{ gap: 8 }}>
            <VehicleFields value={{ brand: v.brand, model: v.model, year: v.year }} onChange={(x) => setV({ ...v, ...x })} />
            <span className="note">Осей у тягача</span>
            <div className="grid3">{['2', '3', '4'].map((a) => <button key={a} className="seg" aria-pressed={v.axles === a} onClick={() => setV({ ...v, axles: a })}>{a}</button>)}</div>
            <div className="grid2">
              <button className="btn ghost small" onClick={() => setFix(false)}>Отмена</button>
              <button className="btn small" disabled={busy || !v.brand} onClick={async () => {
                const r = await run(() => post(`/api/orders/${id}/vehicle`, { brand: v.brand, model: v.model || null, year: v.year ? Number(v.year) : null, axles: v.axles ? Number(v.axles) : null }), 'Карточка машины уточнена');
                if (r) { setFix(false); card.reload(); }
              }}>Сохранить</button>
            </div>
            <span className="note">Следующий мастер приедет подготовленным: нужные разъёмы, схемы, запчасти.</span>
          </div>
        )}
      </div>

      <span className="label">История машины · без сумм</span>
      {c.history.length ? (
        <ol className="tl">{c.history.map((h: any) => (
          <li key={h.id}><i className={h.mine ? 'now' : 'ok'} /><div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <b>{SERVICES[h.service]?.name ?? h.service}{h.mine ? ' · вы' : ''}</b>
            <small>{fmtTime(h.created_at)}{h.performer_name && !h.mine ? ` · ${h.performer_name}` : ''}</small>
            {h.consult_hint && <small>Подсказка: {h.consult_hint.hints.join(', ').toLowerCase()}</small>}
            {h.result_note && <small style={{ color: 'var(--fg)' }}>{h.result_note}</small>}
          </div></li>
        ))}</ol>
      ) : <span className="note">По этой машине ещё ничего не делали через ТракSOS.</span>}

      {canEdit && (
        <button className={`seg ${c.blocked ? '' : ''}`} aria-pressed={c.blocked} disabled={busy} onClick={async () => {
          if (await run(() => post(`/api/orders/${id}/block-client`, { on: !c.blocked }), c.blocked ? 'Заявки клиента снова будут приходить' : 'Заявки этого клиента вам больше не придут')) card.reload();
        }}>{c.blocked ? 'Заявки этого клиента вам не приходят · вернуть' : 'Не брать заявки этого клиента'}</button>
      )}
    </div>
  );
}

function ConfirmAmount({ d, onDone }: { d: any; onDone: () => void }) {
  const { busy, run } = useAction();
  const [mode, setMode] = useState<null | 'menu' | 'extras' | 'not_done' | 'refuse'>(null);
  const [reason, setReason] = useState('');
  const b = d.bill;
  // Баллы — по желанию: галочка и сколько списать (не больше половины сбора и остатка)
  const pmax: number = d.points?.max ?? 0;
  const [usePts, setUsePts] = useState(false);
  const [pts, setPts] = useState<number | null>(pmax || null);
  const spend = usePts ? Math.min(pts ?? 0, pmax) : 0;
  const send = (path: string, body: any, ok: string) => run(() => post(`/api/orders/${d.id}/${path}`, body), ok).then((r) => r && onDone());
  return (
    <div className="card hi">
      <b>К оплате: {rub(d.money.total)}</b>
      <span className="note">Разбивка — в карточке «Сумма» выше.</span>
      <span className="note">Выезд и время — по цене, о которой договорились до вызова. Оспорить можно только расходники и запчасти — и только если работа сделана. {d.paymentMethod === 'cash' ? 'Деньги отдайте мастеру.' : ''}</span>
      {mode === null && pmax > 0 && (
        <div className="card flat" style={{ gap: 6 }}>
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}><input type="checkbox" checked={usePts} onChange={(e) => setUsePts(e.target.checked)} style={{ marginTop: 3 }} />
            <span>Списать баллы — у вас {Math.round(d.points.balance / 100).toLocaleString('ru-RU')}, можно до {Math.round(pmax / 100).toLocaleString('ru-RU')}</span></label>
          {usePts && <Field label="Сколько баллов" hint={`Не больше половины сервисного сбора — ${Math.round(pmax / 100)}`}><RubInput value={pts} onChange={(v) => setPts(v == null ? null : Math.min(v, pmax))} /></Field>}
        </div>
      )}
      {mode === null && <>
        <button className="btn good" disabled={busy} onClick={() => send('confirm', { total: d.money.total, points: spend }, 'Сумма подтверждена')}>Подтверждаю {rub(d.money.total - spend)}{spend ? ' с баллами' : ''}</button>
        <button className="btn ghost" onClick={() => setMode('menu')}>Не согласен</button>
      </>}
      {mode === 'menu' && <div className="stack">
        {b?.extras?.length > 0 && <button className="opt" onClick={() => setMode('extras')}><b>Не согласен с расходниками</b><small>Работа сделана, но строки за материалы и запчасти — не те. Мастер исправит их, время не пересчитывается.</small></button>}
        <button className="opt" onClick={() => setMode('not_done')}><b>Работа не выполнена</b><small>Поломка осталась или сделано не то. Подключим поддержку — разберёмся по чату и фото.</small></button>
        <button className="opt" onClick={() => setMode('refuse')}><b>Не буду платить</b><small>Без причины</small></button>
        <button className="btn ghost small" onClick={() => setMode(null)}>Назад</button>
      </div>}
      {(mode === 'extras' || mode === 'not_done') && <>
        <textarea className="field" placeholder={mode === 'extras' ? 'Какая строка не так и почему' : 'Что не сделано: поломка осталась, сделали не то…'} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        <button className="btn bad" disabled={busy || reason.trim().length < 5} onClick={() => mode === 'extras'
          ? send('dispute', { reason }, 'Мастер получил ваше сообщение')
          : send('nonpayment', { kind: 'not_done', reason }, 'Поддержка подключена')}>{mode === 'extras' ? 'Отправить мастеру' : 'Позвать поддержку'}</button>
        <button className="btn ghost small" onClick={() => setMode('menu')}>Назад</button>
      </>}
      {mode === 'refuse' && <div className="banner warn col">
        <b>Вы приняли оферту при входе</b>
        <span className="note">По <a href="#/offer/client" target="_blank" rel="noreferrer">оферте</a> выезд и время работы по согласованной цене оплачиваются, если работа выполнена. Отказ платить за выполненную работу — нарушение договора: долг могут взыскать по закону, а аккаунт — заблокировать до оплаты.</span>
        <span className="note">Если работа не сделана — выберите «Работа не выполнена» и укажите причину.</span>
        <button className="btn" onClick={() => setMode('not_done')}>Работа не выполнена — указать причину</button>
        <button className="btn good" disabled={busy} onClick={() => send('confirm', { total: d.money.total, points: spend }, 'Сумма подтверждена')}>Подтвердить {rub(d.money.total - spend)}</button>
        <button className="btn bad small" disabled={busy} onClick={() => send('nonpayment', { kind: 'refuse' }, 'Поддержка подключена')}>Всё равно отказываюсь — позвать поддержку</button>
      </div>}
    </div>
  );
}

// Консультация ---------------------------------------------------------------

/** Клиент: мастер на связи, что дальше; выезды, вызванные после консультации */
function ConsultClient({ d }: { d: any }) {
  const back = d.consultBack;
  const st = d.status;
  if (st === 'searching' || st === 'cancelled' || st === 'no_performer') return null;
  return (
    <div className="card">
      <div className="between">
        <b>{st === 'completed' ? 'Консультация завершена' : st === 'awaiting_confirmation' ? 'Мастер закончил разговор' : 'Мастер на связи'}</b>
        <span className={`pill ${st === 'accepted' ? 'good' : ''}`}>{st === 'accepted' ? 'на связи' : st === 'completed' ? 'в архиве' : 'ждёт вас'}</span>
      </div>
      {st === 'accepted' && <span className="note">Мастер позвонит через ТракSOS или напишет в чат ниже. Номера скрыты с обеих сторон. Опишите, что видите, пришлите фото, если попросит.</span>}
      {d.consultHint && (
        <div className="card flat" style={{ gap: 4 }}>
          <span className="label">Мнение мастера по телефону</span>
          <b>Подозрение: {d.consultHint.hints.join(', ').toLowerCase()}</b>
          <span className="note">{CONSULT_CONF[d.consultHint.confidence]}{d.consultHint.note ? ` · ${d.consultHint.note}` : ''}. Это предварительно, не диагностика. Если поедет мастер, он увидит эту подсказку.</span>
        </div>
      )}
      {d.followUps?.length > 0 && d.followUps.map((f: any) => (
        <a key={f.id} className="linkrow" href={`#/order/${f.id}`}><span><b>Выезд №{f.number} · {SERVICES[f.service]?.name}</b><small>{STATUS[f.status]?.name}</small></span><span aria-hidden="true">›</span></a>
      ))}
      {st !== 'completed' || (d.completedAt && Date.now() - new Date(d.completedAt).getTime() < (back?.backHours ?? 48) * 3600_000) ? (
        <button className="btn ghost" onClick={() => go(`new/electric?from=${d.id}`)}>Нужен выезд{back && !d.followUps?.length && st !== 'accepted' ? ` · скидка ${rub(back.backDiscount)}` : ''}</button>
      ) : null}
    </div>
  );
}

/** Клиент: «Вопрос решён» — или выезд */
function ConsultConfirm({ d, onDone }: { d: any; onDone: () => void }) {
  const { busy, run } = useAction();
  return (
    <div className="card hi">
      <b>Вопрос решён?</b>
      <span className="note">Подтвердите консультацию — {rub(d.money.total)}. Если без выезда не обойтись, вызовите мастера: подсказка перейдёт к нему, а вам скидка {rub(d.consultBack?.backDiscount ?? 0)}.</span>
      <button className="btn good" disabled={busy} onClick={() =>
        run(() => post(`/api/orders/${d.id}/confirm`, { total: d.money.total }), 'Спасибо! Консультация закрыта').then((r) => r && onDone())}>Вопрос решён · {rub(d.money.total)}</button>
      <button className="btn ghost" onClick={() => go(`new/electric?from=${d.id}`)}>Нужен выезд</button>
      <a className="btn ghost" href={`#/support/new?order=${d.id}`}>Помощи не было — в поддержку</a>
      <span className="note">Не нажмёте — консультация закроется сама через сутки.</span>
    </div>
  );
}

/** Мастер: подсказка следующему мастеру — 10 секунд — и закрыть консультацию */
function ConsultFinish({ d, onDone }: { d: any; onDone: () => void }) {
  const { busy, run } = useAction();
  const [hints, setHints] = useState<string[]>(d.consultHint?.hints ?? []);
  const [conf, setConf] = useState<string>(d.consultHint?.confidence ?? 'likely');
  const [note, setNote] = useState(d.consultHint?.note ?? '');
  const [showDrop, setShowDrop] = useState(false);
  const [dropReason, setDropReason] = useState('');
  if (['completed', 'cancelled'].includes(d.status)) return d.consultHint ? <ConsultHintCard from={{ hint: d.consultHint }} title="Ваша подсказка" /> : null;
  const toggle = (h: string) => setHints(hints.includes(h) ? hints.filter((x) => x !== h) : hints.length >= 3 ? hints : [...hints, h]);
  return (
    <div className="stack">
      <div className="card hi">
        <span className="label" style={{ color: 'var(--accent)' }}>Консультация по телефону · без выезда</span>
        <span className="note">Свяжитесь с клиентом через чат ниже. Когда разговор окончен — отметьте, что подозреваете. Подсказка перейдёт мастеру, если клиент вызовет выезд.</span>
      </div>
      <div className="card">
        <b>{d.status === 'awaiting_confirmation' ? 'Подсказка отправлена — ждём клиента' : 'Что подозреваете'}</b>
        <div className="row">{CONSULT_HINTS.map((h) => (
          <button key={h} type="button" className="chip" aria-pressed={hints.includes(h)} onClick={() => toggle(h)}>{hints.includes(h) ? '✓ ' : ''}{h}</button>
        ))}</div>
        <span className="note">До трёх вариантов. Чем меньше отмечено, тем больше весит попадание.</span>
        <b style={{ fontSize: 14 }}>Насколько уверены</b>
        <div className="grid3">{Object.entries(CONSULT_CONF).map(([k, v]) => (
          <button key={k} type="button" className="seg" style={{ fontSize: 13 }} aria-pressed={conf === k} onClick={() => setConf(k)}>{v}</button>
        ))}</div>
        <input className="field" placeholder="Одной строкой, если есть что добавить" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        <button className="btn" disabled={busy || !hints.length} onClick={() =>
          run(() => post(`/api/orders/${d.id}/consult-finish`, { hints, confidence: conf, note: note || undefined }), 'Консультация завершена — вы снова свободны').then((r) => r && onDone())}>
          {d.status === 'awaiting_confirmation' ? 'Исправить подсказку' : 'Завершить консультацию'}</button>
        {!hints.length && <span className="note">Нужна хотя бы одна галочка — без неё консультацию не закрыть. Ошибка в подсказке не штрафуется.</span>}
      </div>
      {d.status === 'accepted' && (showDrop ? (
        <div className="card">
          <b>Не можете проконсультировать?</b>
          <input className="field" placeholder="Причина" value={dropReason} onChange={(e) => setDropReason(e.target.value)} />
          <button className="btn bad" disabled={busy || dropReason.length < 2} onClick={() =>
            run(() => post(`/api/orders/${d.id}/drop`, { reason: dropReason }), 'Заявка передана другим').then((r) => r && (location.hash = '#/work'))}>Отказаться</button>
        </div>
      ) : <button className="btn bad" onClick={() => setShowDrop(true)}>Не могу проконсультировать</button>)}
    </div>
  );
}

function ConsultHintCard({ from, title }: { from: any; title?: string }) {
  return (
    <div className="card flat" style={{ gap: 4 }}>
      <span className="label">{title ?? `Подсказка по телефону${from.performer_name ? ` · ${from.performer_name}` : ''}`}</span>
      <b>Подозрение: {from.hint.hints.join(', ').toLowerCase()}</b>
      <span className="note">{CONSULT_CONF[from.hint.confidence]}{from.hint.note ? ` · ${from.hint.note}` : ''}{title ? '' : '. Это предварительно — проверьте на месте.'}</span>
    </div>
  );
}

function Retry({ id, onDone }: { id: string; onDone: () => void }) {
  const { busy, run } = useAction();
  return (
    <div className="card hi">
      <b>Сейчас никто не взял заявку</b>
      <span className="note">Все свободные мастера рядом заняты. Можно позвать ещё раз — кто-то мог освободиться.</span>
      <button className="btn" disabled={busy} onClick={() => run(() => post(`/api/orders/${id}/retry`)).then((r) => r && onDone())}>Искать ещё раз</button>
    </div>
  );
}

function Cancel({ id, status, consult, onDone }: { id: string; status: string; consult?: boolean; onDone: () => void }) {
  const { busy, run } = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const reasons = consult ? ['Разобрался сам', 'Мастер не отвечает', 'Долго ждать', 'Ошибся с заявкой'] : ['Завелась сама', 'Нашёл другого мастера', 'Долго ждать', 'Ошибся с заявкой'];
  if (!open) return <button className="btn ghost" onClick={() => setOpen(true)}>Отменить заявку</button>;
  return (
    <div className="card">
      <b>Отменить заявку?</b>
      {status !== 'searching' && !consult && <span className="note">Мастер уже принял заявку: если он в пути, часть выезда уходит ему — по шкале отмены в правилах.</span>}
      {status !== 'searching' && consult && <span className="note">Если мастер не вышел на связь — отменяйте, деньги не спишутся.</span>}
      <div className="scroll-x">{reasons.map((r) => <button key={r} className="chip" aria-pressed={reason === r} onClick={() => setReason(r)}>{r}</button>)}</div>
      <button className="btn bad" disabled={busy || !reason} onClick={() => run(() => post(`/api/orders/${id}/cancel`, { reason }), 'Заявка отменена').then((r) => r && onDone())}>Отменить</button>
      <button className="btn ghost" onClick={() => setOpen(false)}>Не отменять</button>
    </div>
  );
}

function Review({ id, you }: { id: string; you: string }) {
  const { busy, run } = useAction();
  const pricing = useLoad(() => get('/api/pricing'), []);
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  const rv = useLoad(() => (you === 'admin' || you === 'candidate' ? Promise.resolve(null) : get(`/api/orders/${id}/reviews`)), [id, sent]);
  const [contest, setContest] = useState(false);
  const [why, setWhy] = useState('');
  if (you === 'admin' || you === 'candidate') return null;
  const all: string[] = pricing.data?.reviewTags?.[you === 'performer' ? 'aboutClient' : 'aboutPerformer'] ?? [];
  const w = (x: number) => String(Math.round(x * 100) / 100).replace('.', ',');
  if (rv.data?.mine) return (
    <div className="card">
      <span className="note">Ваш отзыв: {'★'.repeat(rv.data.mine.stars)}{rv.data.mine.text ? ` — «${rv.data.mine.text}»` : ''} · вес {w(rv.data.mine.weight)}</span>
      {rv.data.aboutMe ? (
        <div className="stack" style={{ gap: 6 }}>
          <div className="between"><b>{you === 'performer' ? 'Клиент оценил вас' : 'Мастер оценил вас'}: ★ {rv.data.aboutMe.stars}</b><span className="note">вес отзыва {w(rv.data.aboutMe.weight)}</span></div>
          {rv.data.aboutMe.tags?.length > 0 && <div className="row">{rv.data.aboutMe.tags.map((t: string) => <span key={t} className="pill">{t}</span>)}</div>}
          {rv.data.aboutMe.text && <span>«{rv.data.aboutMe.text}»</span>}
          {rv.data.aboutMe.disputed ? <span className="note">Оспорен — до решения модератора в рейтинг не идёт.</span> : contest ? (
            <div className="stack">
              <textarea className="field" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Почему отзыв несправедлив" />
              <button className="btn small" disabled={busy || why.trim().length < 5} onClick={async () => { if (await run(() => post(`/api/reviews/${rv.data.aboutMe.id}/contest`, { text: why }), 'Отправлено модератору')) { setContest(false); rv.reload(); } }}>Отправить модератору</button>
            </div>
          ) : <button className="btn ghost small" onClick={() => setContest(true)}>Оспорить отзыв</button>}
        </div>
      ) : <span className="note">{you === 'performer' ? 'Клиент' : 'Мастер'} ещё не оставил отзыв о вас.</span>}
    </div>
  );
  return (
    <div className="card">
      <b>{you === 'performer' ? 'Как прошло с клиентом?' : 'Как отработал мастер?'}</b>
      <div className="stars">
        {[1, 2, 3, 4, 5].map((n) => <button key={n} aria-label={`${n} из 5`} aria-pressed={stars >= n} onClick={() => setStars(n)}>★</button>)}
      </div>
      <div className="row">{all.map((t) => (
        <button key={t} className="chip" aria-pressed={tags.includes(t)} onClick={() => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])}>{t}</button>
      ))}</div>
      <textarea className="field" placeholder="Пара слов · по желанию" value={text} onChange={(e) => setText(e.target.value)} />
      {rv.data && <div className="banner col"><span className="note">Вес вашего отзыва — <b>{w(rv.data.weight)}</b>: он зависит от вашего рейтинга{rv.data.myRating ? ` (★ ${rv.data.myRating.toFixed(1)})` : ''}: чем выше ваш рейтинг, тем больше весит отзыв. Пока у вас меньше трёх оценок, вес небольшой — так защищаемся от накруток.</span></div>}
      {you !== 'performer' && <WorksCheck id={id} />}
      <button className="btn" disabled={busy || !stars} onClick={async () => {
        const r = await run(() => post(`/api/orders/${id}/review`, { stars, tags, text: text || undefined }), 'Спасибо за отзыв');
        if (r) setSent(true);
      }}>Оставить отзыв</button>
    </div>
  );
}

/** Сверка работ: сделали не то или больше, чем указал мастер — спор с модератором */
function WorksCheck({ id }: { id: string }) {
  const { busy, run } = useAction();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  if (sent) return <a className="banner warn" href={`#/support/${sent}`} style={{ textDecoration: 'none', color: 'inherit' }}><span>Спор по работам открыт — модератор уточнит у вас и у мастера. Открыть обращение →</span></a>;
  if (!open) return <button className="btn ghost" style={{ borderStyle: 'dashed' }} onClick={() => setOpen(true)}>Работы не совпадают с тем, что указал мастер</button>;
  return (
    <div className="card" style={{ background: 'var(--warn-soft)', borderColor: 'rgba(255,178,122,.45)' }}>
      <b>Что не так с работами?</b>
      <textarea className="field" placeholder="Например: сделали ещё ремонт проводки, его нет в итоге мастера" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="grid2">
        <button className="btn ghost small" onClick={() => setOpen(false)}>Отмена</button>
        <button className="btn small" disabled={busy || text.trim().length < 5} onClick={async () => {
          const r = await run(() => post('/api/support', { topic: 'Спор о работах', text, orderId: id }), 'Спор открыт');
          if (r) setSent(r.id);
        }}>Открыть спор</button>
      </div>
      <span className="note">Модератор увидит заявку, итог мастера и переписку. Приложите фото или чек в обращении, если есть.</span>
    </div>
  );
}

// Чат -----------------------------------------------------------------------

function Chat({ id, status }: { id: string; status: string }) {
  const closed = status === 'completed' || status === 'cancelled';
  const { me } = useMe();
  const toast = useToast();
  const [msgs, setMsgs] = useState<any[]>([]);
  const [quick, setQuick] = useState<string[]>([]);
  const [people, setPeople] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    get(`/api/orders/${id}/messages`).then((r) => { if (alive) { setMsgs(r.messages); setQuick(r.quickReplies); setPeople(r.participants ?? []); } }).catch(() => {});
    const off = onEvent((e) => {
      if (e.type === 'chat' && e.message.order_id === id) setMsgs((m) => (m.some((x) => x.id === e.message.id) ? m : [...m, e.message]));
    });
    return () => { alive = false; off(); };
  }, [id, status]);
  useEffect(() => { box.current?.scrollTo(0, box.current.scrollHeight); }, [msgs.length, open]);
  useEffect(() => { if (open) setSeen(msgs.length); }, [open, msgs.length]);

  async function send(body: string, kind: 'text' | 'quick' = 'text') {
    if (!body.trim()) return;
    try {
      const m = await post(`/api/orders/${id}/messages`, { body, kind });
      setMsgs((x) => (x.some((y) => y.id === m.id) ? x : [...x, m]));
      setText('');
    } catch (e) {
      toast((e as Error).message);
    }
  }

  // Свёрнут, пока не нажали: лента заявки не переполнена. Новые сообщения видно по счётчику.
  const fresh = msgs.slice(seen).filter((m) => m.sender_id && m.sender_id !== me?.id && m.kind !== 'system').length;
  if (!open) return (
    <button type="button" className="card" onClick={() => setOpen(true)} style={{ textAlign: 'left', cursor: 'pointer', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <b>{closed ? '💬 История диалога' : '💬 Чат по заявке'}</b>
      <span className="row" style={{ gap: 6 }}>
        {fresh > 0 && <span className="pill warn">новых: {fresh}</span>}
        <span className="note">{msgs.length ? `${msgs.length} сообщ.` : 'открыть'} ▾</span>
      </span>
    </button>
  );
  return (
    <div className="card">
      <button type="button" onClick={() => setOpen(false)} className="between" style={{ background: 'none', border: 0, padding: 0, color: 'inherit', cursor: 'pointer' }}><b>Чат по заявке</b><span className="note">свернуть ▴</span></button>
      {people.length > 0 && <span className="note">В чате: {people.map((p) => p.you ? 'вы' : `${({ owner: 'владелец', driver: 'водитель', performer: 'исполнитель', support: '' } as Record<string, string>)[p.who]} ${p.name ?? ''}`.trim()).join(', ')}. Номера скрыты.</span>}
      <div className="msgs" ref={box}>
        {msgs.length === 0 && <span className="note">Сообщений пока нет</span>}
        {msgs.map((m) => {
          const sys = m.kind === 'system' || !m.sender_id;
          const mine = m.sender_id === me?.id;
          return (
            <div key={m.id} className={`msg ${sys ? 'sys' : mine ? 'me' : ''}`}>
              {!sys && !mine && <span className="n">{m.sender_name ?? (m.sender_role === 'performer' ? 'Мастер' : m.sender_role === 'support' ? 'Поддержка' : 'Клиент')}</span>}
              <span className="b">{m.body}</span>
            </div>
          );
        })}
      </div>
      {closed ? (
        <div className="stack" aria-label="Завершённый диалог">
          <div className="banner good" role="status">
            Переписка завершена. Сообщения сохранены в истории заявки, отправка новых сообщений недоступна.
          </div>
          <button type="button" className="btn ghost small" onClick={() => setOpen(false)}>
            Завершить диалог
          </button>
        </div>
      ) : (
        <>
          {quick.length > 0 && <div className="scroll-x" aria-label="Быстрые сообщения">
            {quick.map((q) => <button key={q} type="button" className="chip" onClick={() => send(q, 'quick')}>{q}</button>)}
          </div>}
          <form className="compose" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
            <input className="field" placeholder="Сообщение" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
            <button className="btn small" disabled={!text.trim()}>➤</button>
          </form>
        </>
      )}
    </div>
  );
}

// Деньги по заявке: клиенту — что списано и что вернули; админу — ещё и кнопка возврата
function PaymentsList({ id, admin }: { id: string; admin: boolean }) {
  const list = useLoad(() => get(`/api/orders/${id}/payments`), [id], (e) => e.orderId === id);
  if (!list.data?.length) return null;
  return (
    <div className="card">
      <b>Оплата</b>
      {list.data.map((p: any) => (
        <div key={p.id} className="stack" style={{ gap: 4 }}>
          <div className="sum"><span>{p.kind === 'call_out' ? 'Выезд' : 'Работа'} · {payStatus(p.status)}</span><span>{rub(p.total)}</span></div>
          {p.refunded_amount > 0 && <div className="sum" style={{ color: 'var(--good-fg)' }}><span>Возвращено</span><span>{rub(p.refunded_amount)}</span></div>}
          {p.status === 'pending' && p.confirmation_url && !admin && <a className="btn small" href={p.confirmation_url}>Оплатить {rub(p.total)}</a>}
          {admin && <RefundForm pay={p} onDone={list.reload} />}
        </div>
      ))}
    </div>
  );
}

const STAGES: [string, string][] = [
  ['searching', 'Бесплатно'], ['accepted', 'Мастеру 25%'], ['en_route_first_half', '50%'], ['en_route_second_half', '100%'],
  ['arrived', 'На месте · 100%'], ['performer_fault', 'Вина мастера · 0'],
];

function AdminPanel({ d, onDone }: { d: any; onDone: () => void }) {
  const { busy, run } = useAction();
  const [mode, setMode] = useState<'none' | 'discount' | 'complete' | 'cancel'>('none');
  const [amount, setAmount] = useState<number | null>(null);
  const [stage, setStage] = useState('searching');
  const [reason, setReason] = useState('');
  const closed = ['completed', 'cancelled'].includes(d.status);
  const act = (fn: () => Promise<unknown>, text: string) => run(fn, text).then((r) => { if (r) { setMode('none'); setReason(''); onDone(); } });
  return (
    <div className="card" style={{ borderColor: 'var(--accent)' }}>
      <b>Администратор</b>
      <div className="row">
        {d.client && <a className="btn ghost small" href={`#/admin/user/${d.client.id}`}>Клиент: {d.client.company_name ?? d.client.name ?? 'карточка'}</a>}
        {d.performer && <a className="btn ghost small" href={`#/admin/user/${d.performer.id}`}>Исполнитель: {d.performer.name ?? 'карточка'}</a>}
      </div>
      {!closed && (
        <div className="scroll-x">
          {([['discount', 'Скидка'], ['complete', 'Закрыть спор'], ['cancel', 'Отменить']] as const).map(([k, n]) => (
            <button key={k} className="chip" aria-pressed={mode === k} onClick={() => setMode(mode === k ? 'none' : k)}>{n}</button>
          ))}
        </div>
      )}
      {closed && <span className="note">Заявка закрыта. Деньги можно вернуть в блоке «Оплата» ниже, исполнителю — начислить или списать в его карточке.</span>}
      {mode === 'discount' && (
        <>
          <span className="note">Скидку оплачивает площадка — исполнитель получит полностью. Клиент увидит её в сумме.</span>
          <RubInput value={amount} onChange={setAmount} placeholder="Скидка, ₽" />
          <input className="field" placeholder="Причина — клиент её увидит" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className="btn" disabled={busy || amount == null || reason.length < 3} onClick={() =>
            act(() => post(`/api/admin/orders/${d.id}/discount`, { amount, reason }), 'Скидка применена')}>Дать скидку {rub(amount ?? 0)}</button>
        </>
      )}
      {mode === 'complete' && (
        <>
          <span className="note">Спор решён: фиксируем сумму работы (без выезда {rub(d.money.callOut)}) и закрываем заявку — как будто клиент подтвердил.</span>
          <RubInput value={amount} onChange={setAmount} placeholder="Сумма работы, ₽" />
          <input className="field" placeholder="Как решили — увидят обе стороны" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className="btn" disabled={busy || amount == null || reason.length < 3 || !d.performer} onClick={() =>
            act(() => post(`/api/admin/orders/${d.id}/resolve`, { action: 'complete', workAmount: amount, reason }), 'Заявка закрыта')}>Закрыть заявку</button>
        </>
      )}
      {mode === 'cancel' && (
        <>
          <span className="note">Сколько выезда положено исполнителю — по шкале отмены. Остальное клиенту вернётся само (при оплате на сайте).</span>
          <div className="row">{STAGES.map(([k, n]) => <button key={k} className="chip" aria-pressed={stage === k} onClick={() => setStage(k)}>{n}</button>)}</div>
          <input className="field" placeholder="Причина — увидят обе стороны" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className="btn bad" disabled={busy || reason.length < 3} onClick={() =>
            act(() => post(`/api/admin/orders/${d.id}/resolve`, { action: 'cancel', stage, reason }), 'Заявка отменена')}>Отменить заявку</button>
        </>
      )}
    </div>
  );
}
