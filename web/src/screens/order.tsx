import { useEffect, useRef, useState } from 'react';
import { get, post, rub, fmtTime } from '../api.ts';
import { SERVICES, STATUS, STEPS, STEP_NAMES, RESULTS } from '../dict.ts';
import { useLoad, useAction, useMe, Loading, Back, RubInput, Field, useToast } from '../ui.tsx';
import { onEvent } from '../api.ts';
import { Search, OfferForm } from './search.tsx';

export function Order({ id }: { id: string }) {
  const o = useLoad(() => get(`/api/orders/${id}`), [id], (e) => e.orderId === id && (e.type === 'order' || e.type === 'payment'));
  const [perfPos, setPerfPos] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => onEvent((e) => { if (e.type === 'performer_location' && e.orderId === id) setPerfPos({ lat: e.lat, lng: e.lng }); }), [id]);

  const { mode } = useMe();
  const backTo = mode === 'admin' ? 'admin' : mode === 'performer' ? 'work' : 'orders';
  if (!o.data) return <main><Back to={backTo} /><Loading error={o.error} /></main>;
  const d = o.data;
  const isPerformer = d.you === 'performer';
  const done = ['completed', 'cancelled'].includes(d.status);

  return (
    <main>
      <Back to={d.you === 'performer' ? 'work/jobs' : d.you === 'candidate' ? 'work' : d.you === 'admin' ? 'admin' : 'orders'} />
      <div className="between" style={{ alignItems: 'flex-start' }}>
        <div>
          <h1>№{d.number} · {SERVICES[d.service]?.name ?? d.service}</h1>
          <div className="sub">{d.isSos ? 'SOS · ' : ''}{fmtTime(d.createdAt)} · {d.estimate?.zoneName}</div>
        </div>
        <span className={`pill ${STATUS[d.status]?.tone}`}>{STATUS[d.status]?.name}</span>
      </div>

      {d.status === 'searching' && (d.you === 'client' || d.you === 'admin') && <Search d={d} onChosen={o.reload} />}
      {d.you === 'candidate' && <CandidateView d={d} onDone={o.reload} />}

      {d.status !== 'cancelled' && d.status !== 'no_performer' && d.status !== 'searching' && <Steps status={d.status} service={d.service} />}
      {d.status === 'no_performer' && !isPerformer && <Retry id={id} onDone={o.reload} />}

      {d.performer && !isPerformer && <PerformerCard p={d.performer} pos={perfPos} />}
      {isPerformer && <ClientCard d={d} />}
      {d.service === 'tow' && !isPerformer && d.you !== 'candidate' && d.destination && <TowInfo d={d} />}

      {d.you !== 'candidate' && d.status !== 'searching' && <Money d={d} />}

      {isPerformer && <PerformerActions d={d} onDone={o.reload} />}
      {!isPerformer && d.status === 'awaiting_confirmation' && <ConfirmAmount d={d} onDone={o.reload} />}
      {d.status === 'completed' && <Review id={id} you={d.you} />}

      {d.status !== 'searching' && d.status !== 'no_performer' && <Chat id={id} disabled={d.status === 'cancelled'} />}

      {!done && d.actions.includes('cancel') && !isPerformer && <Cancel id={id} status={d.status} onDone={o.reload} />}
      {d.status === 'cancelled' && <div className="card"><b>Заявка отменена</b><span className="note">{d.cancelReason}</span></div>}
    </main>
  );
}

const TOW_STEP_NAMES: Record<string, string> = { ...STEP_NAMES, accepted: 'Эвакуатор выбран', arrived: 'На месте', working: 'Погрузил', awaiting_confirmation: 'Доставил · сумма' };
const CARGO: Record<string, string> = { tractor: 'Тягач', semitrailer: 'Полуприцеп', coupling: 'Сцепка целиком', truck12: 'Грузовик до 12 т' };
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
          <dt>Машина</dt><dd>{d.brand ?? '—'}</dd>
          <dt>Где</dt><dd>{d.address ?? d.estimate?.zoneName}</dd>
          {d.destination && <><dt>Куда</dt><dd>{d.destination}</dd></>}
          {d.cargo && <><dt>Что везём</dt><dd>{CARGO[d.cargo]}{d.loaded ? `, ${LOADED[d.loaded]}` : ''}</dd></>}
          {d.description && <><dt>Что случилось</dt><dd>{d.description}</dd></>}
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

function PerformerCard({ p, pos }: { p: any; pos: { lat: number; lng: number } | null }) {
  const at = pos ?? (p.lat != null ? { lat: p.lat, lng: p.lng } : null);
  return (
    <div className="card">
      <div className="between">
        <b>{p.name ?? 'Исполнитель'}</b>
        <span className="pill">{p.rating ? `★ ${p.rating.toFixed(1)} · ${p.rating_count}` : 'Новый мастер'}</span>
      </div>
      {p.car && <span className="note">Приедет на: {p.car.brand}{p.car.color ? `, ${p.car.color}` : ''}, {p.car.plate}</span>}
      {at && (
        <div className="mini-map">
          <iframe title="Где мастер" loading="lazy"
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${at.lng - 0.03},${at.lat - 0.015},${at.lng + 0.03},${at.lat + 0.015}&layer=mapnik&marker=${at.lat},${at.lng}`} />
        </div>
      )}
      <span className="note">Звонки — через чат заявки. Номера скрыты с обеих сторон.</span>
    </div>
  );
}

function ClientCard({ d }: { d: any }) {
  return (
    <div className="card">
      <dl className="kv">
        <dt>Клиент</dt><dd>{d.client?.company_name ?? d.client?.name ?? 'Клиент'}{d.client?.rating ? ` · ★ ${d.client.rating.toFixed(1)}` : ''}</dd>
        <dt>Машина</dt><dd>{d.vehicle ? `${d.vehicle.brand} ${d.vehicle.model ?? ''} ${d.vehicle.year ?? ''} · ${d.vehicle.plate ?? ''}` : d.brand ?? '—'}</dd>
        <dt>Где</dt><dd>{d.address ?? d.estimate?.zoneName}</dd>
        {d.description && <><dt>Что случилось</dt><dd>{d.description}</dd></>}
      </dl>
      {d.lat != null && (
        <a className="btn ghost" target="_blank" rel="noreferrer" href={`https://yandex.ru/maps/?rtext=~${d.lat},${d.lng}&rtt=auto`}>Маршрут в Яндекс Картах</a>
      )}
    </div>
  );
}

function Money({ d }: { d: any }) {
  const m = d.money;
  const proposed = ['awaiting_confirmation', 'completed'].includes(d.status) || m.work > 0;
  return (
    <div className="card">
      <b>{proposed ? 'Сумма' : 'Цена'}</b>
      <div className="sum"><span>Выезд{d.groupTrip ? ' (совместный)' : ''}{d.night ? ' · ночь' : ''}</span><span>{rub(m.callOut)}</span></div>
      {proposed ? <div className="sum"><span>Работа</span><span>{rub(m.work)}</span></div>
        : d.estimate?.hour != null && <div className="sum"><span>Час работы</span><span>{rub(d.estimate.hour)}</span></div>}
      {proposed && m.clientFee > 0 && <div className="sum"><span>Сервисный сбор</span><span>{rub(m.clientFee)}</span></div>}
      {proposed && <><div className="hr" /><div className="sum total"><span>Итого</span><span>{rub(m.total)}</span></div></>}
      <span className="note">
        {d.paymentMethod === 'cash' ? 'Оплата мастеру на месте. Сумму подтверждаете в приложении.' : d.paymentMethod === 'online' ? 'Оплата через ТракSOS, мастеру — после подтверждения.' : 'Оплата по счёту на компанию.'}
      </span>
      {d.result && <span className="pill">{RESULTS[d.result]}{d.resultNote ? ` · ${d.resultNote}` : ''}</span>}
    </div>
  );
}

function PerformerActions({ d, onDone }: { d: any; onDone: () => void }) {
  const { busy, run } = useAction();
  const [work, setWork] = useState<number | null>(d.money.work || null);
  const [result, setResult] = useState<string>(d.result ?? 'solved');
  const [note, setNote] = useState(d.resultNote ?? '');
  const [dropReason, setDropReason] = useState('');
  const [showDrop, setShowDrop] = useState(false);
  const step = (action: string, text: string) => run(() => post(`/api/orders/${d.id}/step`, { action }), text).then((r) => r && onDone());

  if (['completed', 'cancelled'].includes(d.status)) return null;
  return (
    <div className="stack">
      {d.status === 'accepted' && <button className="btn" disabled={busy} onClick={() => step('depart', 'Клиент видит, что вы выехали')}>Выехал</button>}
      {(d.status === 'accepted' || d.status === 'en_route') && <button className="btn ghost" disabled={busy} onClick={() => step('arrive', 'Клиент видит, что вы на месте')}>Я на месте</button>}
      {d.status === 'arrived' && <button className="btn" disabled={busy} onClick={() => step('start_work', 'Работа началась')}>Начал работу</button>}

      {['arrived', 'working', 'awaiting_confirmation'].includes(d.status) && (
        <div className="card">
          <b>{d.status === 'awaiting_confirmation' ? 'Ждём подтверждения клиента' : 'Закрыть выезд'}</b>
          <Field label="Сумма за работу, без выезда">
            <RubInput value={work} onChange={setWork} />
          </Field>
          <div className="stack">
            {Object.entries(RESULTS).map(([k, v]) => (
              <button key={k} type="button" className="opt" aria-pressed={result === k} onClick={() => setResult(k)}><b>{v}</b></button>
            ))}
          </div>
          <input className="field" placeholder="Что сделали — одной строкой" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          <button className="btn" disabled={busy || work == null} onClick={() =>
            run(() => post(`/api/orders/${d.id}/amount`, { workAmount: work, result, note: note || undefined }), 'Клиенту отправлено на подтверждение').then((r) => r && onDone())}>
            {d.status === 'awaiting_confirmation' ? 'Исправить сумму' : 'Отправить клиенту'}
          </button>
        </div>
      )}

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

function ConfirmAmount({ d, onDone }: { d: any; onDone: () => void }) {
  const { busy, run } = useAction();
  const [dispute, setDispute] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <div className="card hi">
      <b>Мастер назвал сумму: {rub(d.money.total)}</b>
      <span className="note">Подтвердите, если работа сделана и сумма как договорились. {d.paymentMethod === 'cash' ? 'Деньги отдайте мастеру.' : ''}</span>
      {!dispute ? (
        <>
          <button className="btn good" disabled={busy} onClick={() =>
            run(() => post(`/api/orders/${d.id}/confirm`, { total: d.money.total }), 'Сумма подтверждена').then((r) => r && onDone())}>Подтверждаю {rub(d.money.total)}</button>
          <button className="btn ghost" onClick={() => setDispute(true)}>Не согласен</button>
        </>
      ) : (
        <>
          <input className="field" placeholder="Что не так: время, перечень работ, сумма" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className="btn bad" disabled={busy || reason.length < 2} onClick={() =>
            run(() => post(`/api/orders/${d.id}/dispute`, { reason }), 'Мастер получил ваше сообщение').then((r) => r && onDone())}>Отправить мастеру</button>
        </>
      )}
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

function Cancel({ id, status, onDone }: { id: string; status: string; onDone: () => void }) {
  const { busy, run } = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const reasons = ['Завелась сама', 'Нашёл другого мастера', 'Долго ждать', 'Ошибся с заявкой'];
  if (!open) return <button className="btn ghost" onClick={() => setOpen(true)}>Отменить заявку</button>;
  return (
    <div className="card">
      <b>Отменить заявку?</b>
      {status !== 'searching' && <span className="note">Мастер уже принял заявку: если он в пути, часть выезда уходит ему — по шкале отмены в правилах.</span>}
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
  if (sent || you === 'admin') return null;
  const all: string[] = pricing.data?.reviewTags?.[you === 'performer' ? 'aboutClient' : 'aboutPerformer'] ?? [];
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
      <button className="btn" disabled={busy || !stars} onClick={async () => {
        const r = await run(() => post(`/api/orders/${id}/review`, { stars, tags, text: text || undefined }), 'Спасибо за отзыв');
        if (r) setSent(true);
      }}>Оставить отзыв</button>
    </div>
  );
}

// Чат -----------------------------------------------------------------------

function Chat({ id, disabled }: { id: string; disabled: boolean }) {
  const { me } = useMe();
  const toast = useToast();
  const [msgs, setMsgs] = useState<any[]>([]);
  const [quick, setQuick] = useState<string[]>([]);
  const [text, setText] = useState('');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    get(`/api/orders/${id}/messages`).then((r) => { if (alive) { setMsgs(r.messages); setQuick(r.quickReplies); } }).catch(() => {});
    const off = onEvent((e) => {
      if (e.type === 'chat' && e.message.order_id === id) setMsgs((m) => (m.some((x) => x.id === e.message.id) ? m : [...m, e.message]));
    });
    return () => { alive = false; off(); };
  }, [id]);
  useEffect(() => { box.current?.scrollTo(0, box.current.scrollHeight); }, [msgs.length]);

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

  return (
    <div className="card">
      <b>Чат по заявке</b>
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
      {!disabled && (
        <>
          <div className="scroll-x">{quick.map((q) => <button key={q} className="chip" onClick={() => send(q, 'quick')}>{q}</button>)}</div>
          <form className="compose" onSubmit={(e) => { e.preventDefault(); send(text); }}>
            <input className="field" placeholder="Сообщение" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
            <button className="btn small" disabled={!text.trim()}>➤</button>
          </form>
        </>
      )}
    </div>
  );
}
