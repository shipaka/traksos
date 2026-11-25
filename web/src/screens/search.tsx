// Живой поиск исполнителя: радар, счётчики, отклики появляются по одному.
// Один список — разные сортировки: «Рекомендуем / Дешевле / Быстрее / Ближе».

import { useEffect, useId, useRef, useState } from 'react';
import { get, post, rub, onEvent } from '../api.ts';
import { useAction, useToast } from '../ui.tsx';
import { RoadsideMap } from './roadsideMap.tsx';
import './searchWorkspace.css';

const SORTS = [
  { id: 'recommended', name: 'Рекомендуем' },
  { id: 'price', name: 'Дешевле' },
  { id: 'eta', name: 'Быстрее' },
  { id: 'distance', name: 'Ближе' },
] as const;

export function Search({ d, onChosen }: { d: any; onChosen: () => void }) {
  const toast = useToast();
  const { busy, run } = useAction();
  // Приоритет из формы вызова: «Ближе / Дешевле / Быстрее» — сразу сортирует отклики
  const [sort, setSort] = useState<(typeof SORTS)[number]['id']>(() => {
    try { return ({ near: 'distance', cheap: 'price', fast: 'eta' } as Record<string, (typeof SORTS)[number]['id']>)[localStorage.getItem('traksos.prio') ?? ''] ?? 'recommended'; } catch { return 'recommended'; }
  });
  // Three refresh sources (initial, websocket and polling) used to compete:
  // a late answer for another order/sort could overwrite newer proposals.
  // Keep only responses belonging to the CURRENT order and latest request.
  const key = d.id + ':' + sort;
  const [response, setResponse] = useState<{key: string; value: any} | null>(null);
  const [requestError, setRequestError] = useState<{key: string; message: string} | null>(null);
  const panelId = useId();
  const [collapsedOrder, setCollapsedOrder] = useState<string | null>(null);
  const collapsed = collapsedOrder === d.id;
  const choosingRef = useRef(false);
  const refreshRef = useRef<() => void>(() => {});
  const data = response?.key === key ? response.value : null;
  const loadError = requestError?.key === key ? requestError.message : null;
  useEffect(() => { choosingRef.current = false; }, [d.id]);
  useEffect(() => {
    let active = true;
    let generation = 0;
    const load = () => {
      const current = ++generation;
      void get('/api/orders/' + d.id + '/offers?sort=' + sort)
        .then(value => {
          if (!active || current !== generation) return;
          setResponse({key, value});
          setRequestError(null);
        })
        .catch(e => {
          if (!active || current !== generation) return;
          // An unsuccessful refresh is NOT evidence that earlier offers are
          // still available. Hide the obsolete cards until a genuine 200.
          setResponse(null);
          setRequestError({key, message: e instanceof Error ? e.message : 'Нет связи с сервером'});
        });
    };
    refreshRef.current = load;
    load();
    const stop = onEvent(e => {
      if (e.orderId === d.id && e.type === 'order') load();
    });
    const interval = window.setInterval(load, 10_000);
    return () => {
      active = false;
      generation++;
      stop();
      window.clearInterval(interval);
      if (refreshRef.current === load) refreshRef.current = () => {};
    };
  }, [d.id, sort, key]);

  const offers: any[] = data?.offers ?? [];
  const isTow = d.service === 'tow';
  const phrase = isTow ? 'Ищем эвакуатор' : d.service === 'consult' ? 'Ищем мастера для консультации' : 'Ищем исполнителя';
  const autoPick = data?.autoPick ?? d.autoPick;
  const deadline = autoPick ? (data?.until ?? d.auctionUntil ?? null) : null;
  const left = useLeft(deadline);
  const offerCount = offers.length ? `${offers.length} ${plural(offers.length, 'отклик', 'отклика', 'откликов')}` : null;
  const statusText = loadError ? 'Не удалось обновить поиск' : offerCount ?? (!data ? 'Загружаем предложения…' : phrase);
  const lim = data?.limits ?? d.limits;

  async function choose(id: string) {
    if (choosingRef.current || busy || loadError || !offers.some(offer => offer.id === id)) return;
    choosingRef.current = true;
    try {
      const r = await run(() => post(`/api/orders/${d.id}/offers/${id}/choose`));
      if (r) { toast('Исполнитель выбран'); onChosen(); }
      else refreshRef.current(); // the offer could have expired remotely
    } finally { choosingRef.current = false; }
  }

  return (
    <section className="search-workspace stack" aria-label="Поиск исполнителя" style={{ gap: 14 }}>
      <div className="card search-workspace-head">
        <div className="stack" style={{gap:4}}>
          <b>Поиск исполнителя</b>
          <span className="note" role="status">{statusText}{collapsed && !loadError ? ' · поиск продолжается' : ''}</span>
        </div>
        <button type="button" className="btn ghost small search-workspace-toggle"
          aria-expanded={!collapsed} aria-controls={panelId}
          onClick={() => setCollapsedOrder(collapsed ? null : d.id)}>
          {collapsed ? 'Раскрыть поиск' : 'Свернуть поиск'}
        </button>
      </div>
      <div className="search-workspace-content" id={panelId} hidden={collapsed}>
      <div className="search-workspace-visual stack">
      {d.service !== 'consult' && <RoadsideMap
        point={Number.isFinite(d.lat)&&Number.isFinite(d.lng)?{lat:d.lat,lng:d.lng}:null}
        address={d.address} synthetic={String(d.id).startsWith('demo-')} />}
      <div className="card search-card">
        <Radar hits={offers.length} />
        {loadError && <div className="and19-search-error" role="alert">Не удалось получить свежие отклики. <button type="button" onClick={() => refreshRef.current()}>Повторить</button><small>{loadError}</small></div>}
        <div className="stack" style={{ gap: 4, textAlign: 'center' }}>
          <b className="search-title">{statusText}</b>
          <span className="note">
            {loadError ? 'Повторите загрузку, чтобы увидеть актуальные предложения.'
              : offers.length
              ? (autoPick && left != null ? (left > 0 ? `Время выбора: ${mmss(left)} · затем система проверит возможность назначения` : 'Время выбора истекло · ожидаем результат от сервера') : 'Выберите подходящего исполнителя')
              : d.search?.candidates ? `Заявку видят ${d.search.candidates} ${plural(d.search.candidates, d.service === 'tow' ? 'эвакуаторщик' : 'мастер', d.service === 'tow' ? 'эвакуаторщика' : 'мастера', d.service === 'tow' ? 'эвакуаторщиков' : 'мастеров')}${d.service === 'consult' ? ' на связи' : ' рядом'} — ждём, кто откликнется` : 'Ожидаем доступные предложения'}
          </span>
        </div>
        <span className="note and19-radar-note">Радар — схема поиска, не географические координаты. Светящиеся точки соответствуют полученным предложениям.</span>
        {d.searchStage && !loadError && <div className="note" role="status">
          Ищем исполнителей: этап {d.searchStage.wave} из {d.searchStage.waves}.
          Приглашаем только тех, для кого дорожное время подачи подтверждено маршрутизатором
          и не превышает {d.searchStage.maxRoadEtaMinutes} минут с учётом сборов.
          Дальний выезд без отдельного согласия не назначается.
        </div>}
        {autoPick && left != null && deadline && <Progress until={deadline} />}
        {lim && <div className="sum" style={{ justifyContent: 'center', gap: 6 }}><span>{d.service === 'consult' ? 'Стоимость консультации' : `Обычная цена ${isTow ? 'перевозки' : 'выезда'}`}</span><b>{rub(lim.usual)}</b></div>}
      </div>
      </div>
      <div className="search-workspace-results stack">
      {offers.length > 0 && (
        <>
          <div className="scroll-x">
            {SORTS.filter((s) => d.service !== 'consult' || s.id === 'recommended').map((s) => <button type="button" key={s.id} className="chip" aria-pressed={sort === s.id} onClick={() => setSort(s.id)}>{s.name}</button>)}
          </div>
          <div className="stack">
            {offers.map((o, i) => {
              return (
                <div key={o.id} className={`card offer fresh ${i === 0 && sort === 'recommended' ? 'best' : ''}`}>
                  {i === 0 && sort === 'recommended' && <span className="pill accent" style={{ alignSelf: 'flex-start' }}>Лучший выбор</span>}
                  <div className="between" style={{ alignItems: 'flex-start' }}>
                    <div className="stack" style={{ gap: 2 }}>
                      <b>{o.name ?? 'Исполнитель'}</b>
                      <span className="note">
                        {o.rating && o.rating_count >= 3 ? `★ ${o.rating.toFixed(1)} · ${o.rating_count} ${plural(o.rating_count, 'отзыв', 'отзыва', 'отзывов')}` : 'Новый на TrakSOS'}
                        {o.completed ? ` · ${o.completed} ${plural(o.completed, 'выезд', 'выезда', 'выездов')}` : ''}
                      </span>
                    </div>
                    <div className="stack" style={{ gap: 2, alignItems: 'flex-end' }}>
                      <b className="offer-price">{rub(o.price)}</b>
                      {o.diffPct !== 0 && <span className={`pill ${o.diffPct < 0 ? 'good' : ''}`}>{o.diffPct > 0 ? '+' : ''}{o.diffPct}%</span>}
                    </div>
                  </div>
                  <div className="row note">
                    {d.service !== 'consult' && <span>Подача: {o.road_eta_minutes != null ? 'по маршруту ' : 'ориентировочно ~'}{o.eta_minutes} мин</span>}
                    {d.service !== 'consult' && o.distance_km != null && <span>· {o.distance_km.toFixed(1)} км</span>}
                    {o.hour_price && <span>· час {rub(o.hour_price)}</span>}
                    {o.brand_level === 'excellent' && <span className="pill good">Знает {d.brand}</span>}
                  </div>
                  {o.extras?.stock?.length > 0 && d.service !== 'consult' && <span className="note">С собой: {o.extras.stock.join(', ')}</span>}
                  {(o.extras?.weekendPct || o.extras?.nightPct || o.extras?.waitRate) && d.service !== 'consult' ? <span className="note">Наценки мастера: {[o.extras.weekendPct && `выходные +${o.extras.weekendPct}%`, o.extras.nightPct && `ночь +${o.extras.nightPct}%`, o.extras.waitRate && `ожидание ${rub(o.extras.waitRate)}/ч`].filter(Boolean).join(' · ')}</span> : null}
                  {o.extras?.prepay === 'always' && <span className="note" style={{ color: 'var(--warn)' }}>Берёт предоплату за работу</span>}
                  {o.car && d.service !== 'consult' && <span className="note">Приедет на: {o.car.brand}{o.car.color ? `, ${o.car.color}` : ''}</span>}
                  <button className="btn small" style={{ width: '100%' }} disabled={busy || !!loadError} onClick={() => void choose(o.id)}>Выбрать за {rub(o.price)}</button>
                </div>
              );
            })}
          </div>
        </>
      )}
      </div>
      </div>
    </section>
  );
}

/** Abstract indicators of actual returned offers, never GPS positions. */
function Radar({ hits }: { hits: number }) {
  const pts = Array.from({ length: Math.min(hits, 8) }, (_, i) => {
    const a = (i * 137.5 * Math.PI) / 180;
    const r = 28 + ((i * 23) % 44);
    return { x: 50 + Math.cos(a) * r * 0.55, y: 50 + Math.sin(a) * r * 0.55 };
  });
  return (
    <div className="radar search-workspace-radar" aria-hidden="true">
      <span className="sweep" />
      {pts.map((p, i) => <span key={i} className="blip on" style={{ left: `${p.x}%`, top: `${p.y}%` }} />)}
      <span className="core">🚛</span>
    </div>
  );
}

function Progress({ until }: { until: string }) {
  const [pct, setPct] = useState(100);
  useEffect(() => {
    const end = new Date(until).getTime();
    const total = Math.max(1, end - Date.now());
    const update = () => setPct(Math.max(0, Math.min(100,
      Number.isFinite(end) ? ((end - Date.now()) / total) * 100 : 0)));
    update();
    const t = setInterval(update, 250);
    return () => clearInterval(t);
  }, [until]);
  return <div className="progress"><span style={{ width: `${pct}%` }} /></div>;
}

function useLeft(until: string | null) {
  const calc = () => {
    const end = until ? new Date(until).getTime() : NaN;
    return Number.isFinite(end) ? Math.max(0, Math.ceil((end - Date.now()) / 1000)) : null;
  };
  const [left, setLeft] = useState(calc);
  useEffect(() => {
    setLeft(calc());
    const t = setInterval(() => setLeft(calc()), 500);
    return () => clearInterval(t);
  }, [until]); // eslint-disable-line
  return left;
}

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

// Отклик исполнителя ----------------------------------------------------------

/** «Беру за обычную цену» или своя цена в коридоре — шаг 50 ₽ */
export function OfferForm({ orderId, limits, myPrice, onDone, compact }: { orderId: string; limits: { usual: number; floor: number; ceil: number }; myPrice?: number | null; onDone?: () => void; compact?: boolean }) {
  const { busy, run } = useAction();
  const [own, setOwn] = useState(false);
  const [price, setPrice] = useState<number>(myPrice ?? limits.usual);
  const step = 5_000;
  const diff = limits.usual > 0 ? Math.round((price / limits.usual - 1) * 100) : 0;
  const submittingRef = useRef(false);
  useEffect(() => {
    submittingRef.current = false;
    setOwn(false);
    setPrice(myPrice ?? limits.usual);
  }, [orderId, myPrice, limits.usual]);
  const submit = async (task: () => Promise<unknown>, message?: string) => {
    if (submittingRef.current || busy) return;
    submittingRef.current = true;
    try {
      const r = await run(task, message ?? null);
      if (r) onDone?.();
    } finally { submittingRef.current = false; }
  };
  const send = (p?: number) => submit(
    () => post(`/api/orders/${orderId}/offers`, p !== undefined ? {price:p} : {}),
    'Отклик отправлен — ждём выбора клиента');
  const skip = () => submit(() => api_delete(`/api/orders/${orderId}/offers`));

  return (
    <div className="stack">
      {myPrice != null && <span className="pill good" style={{ alignSelf: 'flex-start' }}>Ваш отклик: {rub(myPrice)}</span>}
      {!own ? (
        <>
          <button className="btn good" disabled={busy} onClick={() => send()}>Беру за {rub(limits.usual)}</button>
          <div className="grid2">
            {limits.floor !== limits.ceil && <button className="btn ghost" onClick={() => setOwn(true)}>Своя цена</button>}
            {!compact && <button className="btn ghost" disabled={busy} onClick={skip}>Пропустить</button>}
          </div>
        </>
      ) : (
        <div className="card">
          <div className="between">
            <button className="btn ghost small" style={{ width: 52 }} disabled={price - step < limits.floor} onClick={() => setPrice(price - step)}>−</button>
            <div className="stack" style={{ alignItems: 'center', gap: 2 }}>
              <b className="offer-price">{rub(price)}</b>
              <span className="note">{diff === 0 ? 'обычная цена' : `${diff > 0 ? '+' : ''}${diff}% к обычной`}</span>
            </div>
            <button className="btn ghost small" style={{ width: 52 }} disabled={price + step > limits.ceil} onClick={() => setPrice(price + step)}>+</button>
          </div>
          <span className="note">От {rub(limits.floor)} до {rub(limits.ceil)}. Скидка не поднимает в «Рекомендуем» — там важнее рейтинг и подача.</span>
          <button className="btn" disabled={busy} onClick={() => send(price)}>Предложить {rub(price)}</button>
        </div>
      )}
    </div>
  );
}

async function api_delete(p: string) {
  const { del } = await import('../api.ts');
  return del(p);
}
