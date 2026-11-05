import { useEffect, useRef, useState } from 'react';
import { get, post, put, rub, onEvent } from '../api.ts';
import { BRANDS, BRAND_LEVELS, LINE, SERVICES } from '../dict.ts';
import { useLoad, useAction, useMe, go, Loading, Field, RubInput, Back, LiveStrip } from '../ui.tsx';
import { native } from '../native.ts';
import { OfferForm } from './search.tsx';
import { useToast } from '../ui.tsx';

// Линия: статус, геолокация, входящие ---------------------------------------

export function Work() {
  const { me, reload } = useMe();
  const { busy, run } = useAction();
  const balance = useLoad(() => get('/api/performer/balance'), [], (e) => e.type === 'balance' || e.type === 'order');
  const jobs = useLoad(() => get('/api/orders?as=performer'), [], (e) => e.type === 'order');
  const auctions = useLoad(() => get('/api/performer/auctions'), [], (e) => e.type === 'auction' || e.type === 'order');
  useEffect(() => onEvent((e) => { if (e.type === 'line_status') reload(); }), [reload]);
  const p = me?.performer;
  if (!p) return <main><h1>Кабинет исполнителя</h1><div className="card"><b>Заполните профиль</b><span className="note">Марки, цены, машина и статус самозанятого или ИП — после проверки начнут приходить заявки.</span><button className="btn" onClick={() => go('work/me')}>Заполнить</button></div></main>;

  const active = (jobs.data ?? []).filter((o: any) => ['accepted', 'en_route', 'arrived', 'working', 'awaiting_confirmation'].includes(o.status));
  const online = p.line_status === 'online' || p.line_status === 'on_job' || p.line_status === 'on_call';
  const setLine = (lineStatus: string) => run(() => post('/api/performer/line', { lineStatus })).then((r) => {
    if (!r) return;
    if (lineStatus === 'online') native.performerOnline();
    reload();
  });

  return (
    <main>
      <LiveStrip who={p.kind === 'tow' ? 'tow' : 'master'} />
      <div className="between">
        <h1>{me?.name ?? 'Кабинет'}</h1>
        <span className="pill"><span className={`dot ${online ? 'on' : ''}`} /> {LINE[p.line_status]}</span>
      </div>

      {p.verification !== 'approved' ? (
        <div className="card hi">
          <b>{p.verification === 'rejected' ? 'Проверка не пройдена' : p.submitted_at ? 'Профиль на проверке' : 'Пройдите проверку'}</b>
          <span className="note">{p.verification === 'rejected' ? (p.verification_note ?? 'Исправьте данные и отправьте ещё раз.')
            : p.submitted_at ? 'Обычно до 24 часов. Пока проверяем, заявки не приходят.'
            : 'Снимите паспорт, селфи с паспортом и машину — без проверки заявки не приходят. Это 3 минуты.'}</span>
          <button className="btn" onClick={() => go('work/docs')}>{p.submitted_at ? 'Мои фото' : 'Снять фото'}</button>
        </div>
      ) : (
        <div className="card">
          <b>Статус на линии</b>
          <div className="grid2">
            <button className="seg" aria-pressed={p.line_status === 'online'} disabled={busy || p.line_status === 'on_job'} onClick={() => setLine('online')}>Свободен</button>
            <button className="seg" aria-pressed={p.line_status === 'offline'} disabled={busy || p.line_status === 'on_job'} onClick={() => setLine('offline')}>Не на линии</button>
          </div>
          <span className="note">Пока вы на линии, заявки приходят как звонок — 30 секунд, «Беру» или «Отклонить». Три пропуска подряд — статус сам станет «Не на линии».</span>
          {online && <LocationSharing />}
        </div>
      )}

      {active.length > 0 && (
        <div className="stack">
          <span className="label">Сейчас</span>
          {active.map((o: any) => (
            <a key={o.id} href={`#/order/${o.id}`} className="card hi" style={{ textDecoration: 'none', color: 'inherit' }}>
              <b>№{o.number} · {SERVICES[o.service]?.name}{o.is_sos ? ' · SOS' : ''}</b>
              <span className="note">{o.address ?? o.estimate?.zoneName} · открыть →</span>
            </a>
          ))}
        </div>
      )}

      {(auctions.data ?? []).length > 0 && (
        <div className="stack">
          <span className="label">Заявки рядом · торги</span>
          {auctions.data!.map((a: any) => (
            <div key={a.order_id} className="card">
              <div className="between">
                <b>{a.is_sos ? 'SOS · ' : ''}{SERVICES[a.service]?.name} · {a.brand ?? 'грузовик'}</b>
                {a.distance_km != null && <span className="pill">{a.distance_km.toFixed(1)} км</span>}
              </div>
              <span className="note">{a.address ?? a.estimate?.zoneName}{a.destination ? ` → ${a.destination}` : ''}{a.description ? ` · ${a.description}` : ''}</span>
              <OfferForm orderId={a.order_id} limits={a.limits} myPrice={a.my_price} onDone={auctions.reload} />
            </div>
          ))}
        </div>
      )}

      {balance.data && (
        <div className="card">
          <b>Баланс</b>
          <div className="sum"><span>К выплате</span><span>{rub(balance.data.to_pay)}</span></div>
          <div className="sum"><span>Долг по комиссии с наличных</span><span>{rub(balance.data.cash_debt)}</span></div>
          {balance.data.paused && <span className="err">Долг больше {rub(balance.data.cashDebtLimit)} — новые заявки на паузе до оплаты.</span>}
          <span className="note">ТракSOS работает как агент: отчёт агента и акт — раз в месяц.</span>
        </div>
      )}
      <div className="grid2"><button className="btn ghost" onClick={() => go('work/filter')}>Фильтр заявок</button><button className="btn ghost" onClick={() => go('work/me/money')}>Финансы</button></div>
    </main>
  );
}

/** Отправляем координаты раз в 30 секунд, пока экран открыт (в приложении — и в фоне) */
function LocationSharing() {
  const [state, setState] = useState<'wait' | 'ok' | 'off'>('wait');
  useEffect(() => {
    if (!navigator.geolocation) { setState('off'); return; }
    let last = 0;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setState('ok');
        if (Date.now() - last < 30_000) return;
        last = Date.now();
        post('/api/performer/location', { lat: pos.coords.latitude, lng: pos.coords.longitude }).catch(() => {});
      },
      () => setState('off'),
      { enableHighAccuracy: false, maximumAge: 60_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  return <span className="note">{state === 'ok' ? '✓ Геолокация включена — заявки рядом приходят вам первыми' : state === 'off' ? 'Геолокация выключена — без неё подбор хуже. Разрешите доступ к местоположению.' : 'Определяю место…'}</span>;
}

// Входящий вызов на весь экран ------------------------------------------------

export function IncomingCall() {
  const { me } = useMe();
  const toast = useToast();
  const [calls, setCalls] = useState<any[]>([]);
  const isPerformer = !!me?.performer;

  useEffect(() => {
    if (!isPerformer) return;
    const load = () => get('/api/performer/incoming').then((list) => setCalls(list.map(fromIncoming))).catch(() => {});
    load();
    const off = onEvent((e) => {
      if (e.type === 'incoming_call' || e.type === 'auction') setCalls((c) => (c.some((x) => x.orderId === e.orderId) ? c : [...c, e]));
      if (e.type === 'order' && e.status === 'lost') toast('Клиент выбрал другого исполнителя');
      if (e.type === 'order' && e.status === 'accepted' && !location.hash.includes(e.orderId)) { toast('Клиент выбрал вас'); go(`order/${e.orderId}`); }
      if (e.type === 'call_missed' || (e.type === 'order' && e.status !== 'searching')) setCalls((c) => c.filter((x) => x.orderId !== e.orderId));
      if (e.type === 'hello') load();
    });
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    // Ответ с экрана блокировки или из уведомления — приложение уже отправило его на сервер
    native.onCallAction((orderId, action, handled) => {
      setCalls((c) => c.filter((x) => x.orderId !== orderId));
      if (handled) { if (action === 'accept') go(`order/${orderId}`); return; }
      if (action === 'accept') post(`/api/orders/${orderId}/accept`).then(() => go(`order/${orderId}`)).catch(() => {});
      else post(`/api/orders/${orderId}/decline`).catch(() => {});
    });
    return () => { off(); document.removeEventListener('visibilitychange', onVisible); };
  }, [isPerformer]);

  const call = calls[0];
  if (!call) return null;
  const close = () => setCalls((c) => c.filter((x) => x.orderId !== call.orderId));
  return call.type === 'auction'
    ? <AuctionCallScreen key={call.orderId} call={call} onClose={close} />
    : <CallScreen key={call.orderId} call={call} onClose={close} />;
}

function fromIncoming(r: any) {
  return { orderId: r.order_id, number: r.number, service: r.service, sos: r.is_sos, address: r.address, zone: r.estimate?.zoneName,
    distanceKm: r.distance_km, brand: r.brand, callOut: r.estimate?.callOut, ringUntil: r.ring_until, description: r.description };
}

function CallScreen({ call, onClose }: { call: any; onClose: () => void }) {
  const { busy, run } = useAction();
  const left = useCountdown(call.ringUntil);
  const stopRing = useRinging();
  useEffect(() => { if (left <= 0) { stopRing(); onClose(); } }, [left]); // eslint-disable-line

  async function answer(action: 'accept' | 'decline') {
    stopRing();
    const r = await run(() => post(`/api/orders/${call.orderId}/${action}`), action === 'accept' ? 'Заявка ваша' : 'Отклонено');
    onClose();
    if (r && action === 'accept') go(`order/${call.orderId}`);
  }

  return (
    <div className="call" role="alertdialog" aria-label="Входящая заявка">
      <div className="stack" style={{ textAlign: 'center', gap: 16 }}>
        <span className="label" style={{ color: 'var(--accent)' }}>{call.sos ? 'SOS-вызов' : 'Новая заявка'}</span>
        <div className="ring">⚡</div>
        <h1>{SERVICES[call.service]?.name ?? 'Заявка'} · {call.brand ?? 'грузовик'}</h1>
        <div className="sub" style={{ fontSize: 15 }}>
          {call.service === 'consult' ? 'По телефону — без выезда' : <>{call.address ?? call.zone}{call.distanceKm != null ? ` · ${call.distanceKm} км` : ''}</>}
        </div>
        {call.description && <div className="note" style={{ fontSize: 14 }}>{call.description}</div>}
        <div className="pill accent" style={{ alignSelf: 'center', fontSize: 15 }}>{call.service === 'consult' ? 'Консультация' : 'Выезд'} {rub(call.callOut)}</div>
      </div>
      <div className="stack" style={{ gap: 16 }}>
        <div className="timer">{left}</div>
        <div className="acts">
          <button className="btn bad" disabled={busy} onClick={() => answer('decline')}>Отклонить</button>
          <button className="btn good" disabled={busy} onClick={() => answer('accept')}>Беру</button>
        </div>
      </div>
    </div>
  );
}

/** Торги: заявка «звонит» 30 секунд, отклик — «Беру за обычную цену» или своя цена */
function AuctionCallScreen({ call, onClose }: { call: any; onClose: () => void }) {
  const left = useCountdown(call.ringUntil);
  const stopRing = useRinging();
  const [silent, setSilent] = useState(false);
  useEffect(() => { if (left <= 0 && !silent) { stopRing(); setSilent(true); } }, [left]); // eslint-disable-line
  return (
    <div className="call" role="alertdialog" aria-label="Новая заявка">
      <div className="stack" style={{ textAlign: 'center', gap: 14 }}>
        <span className="label" style={{ color: 'var(--accent)' }}>{call.sos ? 'SOS · торги 90 секунд' : 'Новая заявка · торги'}</span>
        <div className="ring" style={silent ? { animation: 'none' } : undefined}>{call.service === 'tow' ? '🚛' : '⚡'}</div>
        <h1>{SERVICES[call.service]?.name ?? 'Заявка'} · {call.brand ?? 'грузовик'}</h1>
        <div className="sub" style={{ fontSize: 15 }}>
          {call.address ?? call.zone}{call.destination ? ` → ${call.destination}` : ''}{call.distanceKm != null ? ` · ${call.distanceKm} км` : ''}
        </div>
        {call.description && <div className="note" style={{ fontSize: 14 }}>{call.description}</div>}
      </div>
      <div className="stack" style={{ gap: 12 }}>
        <OfferForm orderId={call.orderId} limits={{ usual: call.usual, floor: call.floor, ceil: call.ceil }} compact onDone={() => { stopRing(); onClose(); }} />
        <button className="btn ghost" onClick={() => { stopRing(); onClose(); }}>Позже — заявка останется в «Заявки рядом»</button>
      </div>
    </div>
  );
}

function useCountdown(until: string) {
  const calc = () => Math.max(0, Math.ceil((new Date(until).getTime() - Date.now()) / 1000));
  const [left, setLeft] = useState(calc);
  useEffect(() => { const t = setInterval(() => setLeft(calc()), 250); return () => clearInterval(t); }, [until]); // eslint-disable-line
  return left;
}

/** Звук и вибрация, пока открыт экран вызова. Когда приложение свёрнуто, звонит нативный экран вызова. */
function useRinging() {
  const stop = useRef<() => void>(() => {});
  useEffect(() => {
    let ctx: AudioContext | null = null;
    let timer: any;
    try {
      ctx = new AudioContext();
      const beep = () => {
        if (!ctx) return;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
        o.connect(g).connect(ctx.destination);
        o.start();
        o.stop(ctx.currentTime + 0.65);
        navigator.vibrate?.([400, 200, 400]);
      };
      beep();
      timer = setInterval(beep, 1500);
    } catch { /* браузер не дал звук без нажатия */ }
    stop.current = () => { clearInterval(timer); ctx?.close().catch(() => {}); ctx = null; navigator.vibrate?.(0); };
    return () => stop.current();
  }, []);
  return () => stop.current();
}

