// Живой поиск исполнителя: радар, счётчики, отклики появляются по одному.
// Один список — разные сортировки: «Рекомендуем / Дешевле / Быстрее / Ближе».

import { useEffect, useRef, useState } from 'react';
import { get, post, rub, onEvent } from '../api.ts';
import { useAction, useToast } from '../ui.tsx';

const SORTS = [
  { id: 'recommended', name: 'Рекомендуем' },
  { id: 'price', name: 'Дешевле' },
  { id: 'eta', name: 'Быстрее' },
  { id: 'distance', name: 'Ближе' },
] as const;

const PHRASES = [
  'Ищем свободных мастеров рядом',
  'Отправили заявку тем, кто знает вашу марку',
  'Мастера смотрят заявку',
  'Сравниваем рейтинг и расстояние',
];
const CONSULT_PHRASES = ['Ищем мастеров на связи', 'Сначала — тем, кто хорошо знает вашу марку', 'Мастера смотрят заявку'];
const TOW_PHRASES = ['Ищем эвакуаторы рядом', 'Эвакуаторщики смотрят заявку', 'Считаем подачу: сборы + дорога'];

export function Search({ d, onChosen }: { d: any; onChosen: () => void }) {
  const toast = useToast();
  const { busy, run } = useAction();
  const [sort, setSort] = useState<(typeof SORTS)[number]['id']>('recommended');
  const [data, setData] = useState<any>(null);
  const seen = useRef(new Set<string>());

  const load = () => get(`/api/orders/${d.id}/offers?sort=${sort}`).then(setData).catch(() => {});
  useEffect(() => { load(); }, [sort, d.id]); // eslint-disable-line
  useEffect(() => onEvent((e) => { if (e.orderId === d.id && e.type === 'order') load(); }), [d.id, sort]); // eslint-disable-line
  useEffect(() => { const t = setInterval(load, 10_000); return () => clearInterval(t); }, [d.id, sort]); // eslint-disable-line

  const offers: any[] = data?.offers ?? [];
  const isTow = d.service === 'tow';
  const phrases = isTow ? TOW_PHRASES : d.service === 'consult' ? CONSULT_PHRASES : PHRASES;
  const phrase = usePhrase(phrases, offers.length > 0);
  const left = useLeft(d.autoPick ? d.auctionUntil : null);
  const lim = data?.limits ?? d.limits;

  async function choose(id: string) {
    const r = await run(() => post(`/api/orders/${d.id}/offers/${id}/choose`));
    if (r) { toast('Исполнитель выбран'); onChosen(); }
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="card search-card">
        <Radar dots={Math.min(d.search?.candidates ?? 0, 8)} hits={offers.length} />
        <div className="stack" style={{ gap: 4, textAlign: 'center' }}>
          <b className="search-title">{offers.length ? `${offers.length} ${plural(offers.length, 'отклик', 'отклика', 'откликов')}` : phrase}</b>
          <span className="note">
            {offers.length
              ? (d.autoPick && left != null ? `Выберите сами — или через ${mmss(left)} назначим лучшего` : 'Выберите исполнителя — остальным сообщим сами')
              : d.search?.candidates ? `Заявку видят ${d.search.candidates} ${plural(d.search.candidates, d.service === 'tow' ? 'эвакуаторщик' : 'мастер', d.service === 'tow' ? 'эвакуаторщика' : 'мастера', d.service === 'tow' ? 'эвакуаторщиков' : 'мастеров')}${d.service === 'consult' ? ' на связи' : ' рядом'} — ждём, кто откликнется` : 'Звоним ближайшим'}
          </span>
        </div>
        {d.autoPick && left != null && data?.until && <Progress until={data.until} />}
        {lim && <div className="sum" style={{ justifyContent: 'center', gap: 6 }}><span>{d.service === 'consult' ? 'Стоимость консультации' : `Обычная цена ${isTow ? 'перевозки' : 'выезда'}`}</span><b>{rub(lim.usual)}</b></div>}
      </div>

      {offers.length > 0 && (
        <>
          <div className="scroll-x">
            {SORTS.filter((s) => d.service !== 'consult' || s.id === 'recommended').map((s) => <button key={s.id} className="chip" aria-pressed={sort === s.id} onClick={() => setSort(s.id)}>{s.name}</button>)}
          </div>
          <div className="stack">
            {offers.map((o, i) => {
              const fresh = !seen.current.has(o.id);
              seen.current.add(o.id);
              return (
                <div key={o.id} className={`card offer ${fresh ? 'fresh' : ''} ${i === 0 && sort === 'recommended' ? 'best' : ''}`}>
                  {i === 0 && sort === 'recommended' && <span className="pill accent" style={{ alignSelf: 'flex-start' }}>Лучший выбор</span>}
                  <div className="between" style={{ alignItems: 'flex-start' }}>
                    <div className="stack" style={{ gap: 2 }}>
                      <b>{o.name ?? 'Исполнитель'}</b>
                      <span className="note">
                        {o.rating && o.rating_count >= 3 ? `★ ${o.rating.toFixed(1)} · ${o.rating_count} ${plural(o.rating_count, 'отзыв', 'отзыва', 'отзывов')}` : 'Новый на ТракSOS'}
                        {o.completed ? ` · ${o.completed} ${plural(o.completed, 'выезд', 'выезда', 'выездов')}` : ''}
                      </span>
                    </div>
                    <div className="stack" style={{ gap: 2, alignItems: 'flex-end' }}>
                      <b className="offer-price">{rub(o.price)}</b>
                      {o.diffPct !== 0 && <span className={`pill ${o.diffPct < 0 ? 'good' : ''}`}>{o.diffPct > 0 ? '+' : ''}{o.diffPct}%</span>}
                    </div>
                  </div>
                  <div className="row note">
                    {d.service !== 'consult' && <span>⏱ подача ~{o.eta_minutes} мин</span>}
                    {d.service !== 'consult' && o.distance_km != null && <span>· {o.distance_km.toFixed(1)} км</span>}
                    {o.hour_price && <span>· час {rub(o.hour_price)}</span>}
                    {o.brand_level === 'excellent' && <span className="pill good">Знает {d.brand}</span>}
                  </div>
                  {o.extras?.stock?.length > 0 && d.service !== 'consult' && <span className="note">С собой: {o.extras.stock.join(', ')}</span>}
                  {(o.extras?.weekendPct || o.extras?.nightPct || o.extras?.waitRate) && d.service !== 'consult' ? <span className="note">Наценки мастера: {[o.extras.weekendPct && `выходные +${o.extras.weekendPct}%`, o.extras.nightPct && `ночь +${o.extras.nightPct}%`, o.extras.waitRate && `ожидание ${rub(o.extras.waitRate)}/ч`].filter(Boolean).join(' · ')}</span> : null}
                  {o.extras?.prepay === 'always' && <span className="note" style={{ color: 'var(--warn)' }}>Берёт предоплату за работу</span>}
                  {o.car && d.service !== 'consult' && <span className="note">Приедет на: {o.car.brand}{o.car.color ? `, ${o.car.color}` : ''}</span>}
                  <button className="btn small" style={{ width: '100%' }} disabled={busy} onClick={() => choose(o.id)}>Выбрать за {rub(o.price)}</button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** Радар: расходящиеся круги, точки — исполнители, которые видят заявку; загораются, когда откликнулись */
function Radar({ dots, hits }: { dots: number; hits: number }) {
  const pts = Array.from({ length: Math.max(dots, hits) }, (_, i) => {
    const a = (i * 137.5 * Math.PI) / 180;
    const r = 28 + ((i * 23) % 44);
    return { x: 50 + Math.cos(a) * r * 0.55, y: 50 + Math.sin(a) * r * 0.55, on: i < hits, delay: i * 0.35 };
  });
  return (
    <div className="radar" aria-hidden="true">
      <span className="wave" /><span className="wave w2" /><span className="wave w3" />
      <span className="sweep" />
      {pts.map((p, i) => <span key={i} className={`blip ${p.on ? 'on' : ''}`} style={{ left: `${p.x}%`, top: `${p.y}%`, animationDelay: `${p.delay}s` }} />)}
      <span className="core">🚛</span>
    </div>
  );
}

function Progress({ until }: { until: string }) {
  const [pct, setPct] = useState(100);
  const start = useRef(Date.now());
  useEffect(() => {
    const total = Math.max(1, new Date(until).getTime() - start.current);
    const t = setInterval(() => setPct(Math.max(0, ((new Date(until).getTime() - Date.now()) / total) * 100)), 250);
    return () => clearInterval(t);
  }, [until]);
  return <div className="progress"><span style={{ width: `${pct}%` }} /></div>;
}

function usePhrase(list: readonly string[], stop: boolean) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (stop) return;
    const t = setInterval(() => setI((x) => (x + 1) % list.length), 2600);
    return () => clearInterval(t);
  }, [stop, list]);
  return list[i];
}

function useLeft(until: string | null) {
  const calc = () => (until ? Math.max(0, Math.ceil((new Date(until).getTime() - Date.now()) / 1000)) : null);
  const [left, setLeft] = useState(calc);
  useEffect(() => { const t = setInterval(() => setLeft(calc()), 500); return () => clearInterval(t); }, [until]); // eslint-disable-line
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
  const diff = Math.round((price / limits.usual - 1) * 100);
  const send = (p?: number) => run(() => post(`/api/orders/${orderId}/offers`, p ? { price: p } : {}), 'Отклик отправлен — ждём выбора клиента').then((r) => r && onDone?.());
  const skip = () => run(() => api_delete(`/api/orders/${orderId}/offers`)).then((r) => r && onDone?.());

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
