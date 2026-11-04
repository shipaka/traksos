import { useState } from 'react';
import { get, post, put, rub, fmtPhone, fmtTime } from '../api.ts';
import { STATUS, SERVICES, LINE } from '../dict.ts';
import { useLoad, useAction, Loading } from '../ui.tsx';

export function Admin() {
  const [tab, setTab] = useState<'people' | 'orders' | 'dispatch' | 'payments' | 'flagged'>('people');
  return (
    <main>
      <h1>Администратор</h1>
      <div className="scroll-x">
        {([['people', 'Люди'], ['orders', 'Заявки'], ['dispatch', 'Распределение'], ['payments', 'Оплата и выплаты'], ['flagged', 'Подозрительное']] as const).map(([id, n]) => (
          <button key={id} className="chip" aria-pressed={tab === id} onClick={() => setTab(id)}>{n}</button>
        ))}
      </div>
      {tab === 'people' && <People />}
      {tab === 'orders' && <AllOrders />}
      {tab === 'dispatch' && <Dispatch />}
      {tab === 'payments' && <Payments />}
      {tab === 'flagged' && <Flagged />}
    </main>
  );
}

function People() {
  const [q, setQ] = useState('');
  const list = useLoad(() => get(`/api/admin/users?q=${encodeURIComponent(q)}`), [q]);
  const { busy, run } = useAction();
  const act = (path: string, body: unknown, text: string) => run(() => post(path, body), text).then((r) => r && list.reload());
  return (
    <div className="stack">
      <input className="field" placeholder="Телефон или имя" value={q} onChange={(e) => setQ(e.target.value)} />
      {!list.data ? <Loading error={list.error} /> : list.data.map((u: any) => (
        <div key={u.id} className="card">
          <div className="between">
            <b>{u.name ?? 'Без имени'} · {fmtPhone(u.phone)}</b>
            {u.status === 'blocked' && <span className="pill bad">Заблокирован</span>}
          </div>
          <span className="note">{u.roles.join(', ')}{u.kind ? ` · ${LINE[u.line_status] ?? ''} · проверка: ${u.verification}` : ''}{u.rating ? ` · ★ ${u.rating.toFixed(2)}` : ''}</span>
          <div className="row">
            {u.kind && u.verification !== 'approved' && <button className="btn small" disabled={busy} onClick={() => act(`/api/admin/performers/${u.id}/verify`, { decision: 'approved' }, 'Проверка пройдена')}>Одобрить</button>}
            {u.kind && u.verification === 'pending' && <button className="btn ghost small" disabled={busy} onClick={() => act(`/api/admin/performers/${u.id}/verify`, { decision: 'rejected' }, 'Отказано')}>Отказать</button>}
            {u.kind && <button className="btn ghost small" disabled={busy} onClick={() => act(`/api/admin/performers/${u.id}/priority`, { isPriority: !u.is_priority }, u.is_priority ? 'Убран из первых' : 'Теперь получает заявки первым')}>{u.is_priority ? '★ Первый в очереди' : 'Сделать первым в очереди'}</button>}
            <button className="btn bad small" disabled={busy} onClick={() => act(`/api/admin/users/${u.id}/block`, { blocked: u.status !== 'blocked' }, u.status === 'blocked' ? 'Разблокирован' : 'Заблокирован')}>{u.status === 'blocked' ? 'Разблокировать' : 'Заблокировать'}</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function AllOrders() {
  const list = useLoad(() => get('/api/admin/orders'), [], (e) => e.type === 'order');
  if (!list.data) return <Loading error={list.error} />;
  return (
    <div className="rows">
      {list.data.map((o: any) => (
        <a key={o.id} href={`#/order/${o.id}`} className="list-item">
          <div className="stack" style={{ gap: 2 }}>
            <b>№{o.number} · {SERVICES[o.service]?.name}{o.is_sos ? ' · SOS' : ''}</b>
            <span className="note">{fmtTime(o.created_at)} · {fmtPhone(o.client_phone)}{o.performer_name ? ` → ${o.performer_name}` : ''}</span>
          </div>
          <span className={`pill ${STATUS[o.status]?.tone}`}>{STATUS[o.status]?.name}</span>
        </a>
      ))}
    </div>
  );
}

function Payments() {
  const settings = useLoad(() => get('/api/admin/settings'), []);
  const { busy, run } = useAction();
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [report, setReport] = useState<any[] | null>(null);
  if (!settings.data) return <Loading error={settings.error} />;
  const p = settings.data.payments;
  const fees = settings.data.fees;
  const toggle = (key: string, value: boolean) => run(() => put('/api/admin/settings/payments', { [key]: value }), 'Сохранено').then((r) => r && settings.reload());

  return (
    <div className="stack">
      <div className="card">
        <b>Способы оплаты</b>
        <span className="note">Агентская схема: ТракSOS принимает деньги за исполнителя и перечисляет ему за вычетом вознаграждения. Безнал и счета включайте после проверки оферты юристом и бухгалтером.</span>
        {([['cash', 'Наличные мастеру на месте'], ['online', 'СБП и карта в приложении'], ['invoice', 'Счёт для компаний']] as const).map(([k, n]) => (
          <button key={k} className="opt" aria-pressed={!!p[k]} disabled={busy} onClick={() => toggle(k, !p[k])}>
            <div className="between"><b>{n}</b><span className={`pill ${p[k] ? 'good' : ''}`}>{p[k] ? 'Включено' : 'Выключено'}</span></div>
          </button>
        ))}
      </div>
      <div className="card">
        <b>Комиссии</b>
        <div className="sum"><span>Сбор с клиента</span><span>{fees.clientFeePct}%</span></div>
        <div className="sum"><span>Вознаграждение с исполнителя</span><span>{fees.performerCommissionPct}%</span></div>
        <div className="sum"><span>Долг по наличным — пауза с</span><span>{rub(fees.cashDebtLimit)}</span></div>
        <span className="note">Меняются через API настроек; экран редактирования — следующим шагом.</span>
      </div>
      <div className="card">
        <b>Выплаты исполнителям</b>
        <button className="btn" disabled={busy} onClick={() => run(() => post('/api/admin/payouts/run'), 'Выплаты отправлены')}>Выплатить всё, что ждёт</button>
      </div>
      <div className="card">
        <b>Отчёт агента</b>
        <div className="compose">
          <input className="field" value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="ГГГГ-ММ" />
          <button className="btn small" disabled={busy} onClick={async () => { const r = await run(() => get(`/api/admin/agent-report?period=${period}`)); if (r) setReport(r); }}>Собрать</button>
        </div>
        {report && (report.length === 0 ? <span className="note">За этот месяц завершённых заявок нет</span> : report.map((r) => (
          <div key={r.performer_id} className="stack" style={{ gap: 4 }}>
            <b>{r.name ?? 'Исполнитель'} · ИНН {r.inn ?? '—'}</b>
            <div className="sum"><span>Заявок (наличными)</span><span>{r.orders} ({r.cash_orders})</span></div>
            <div className="sum"><span>Сумма услуг исполнителя</span><span>{rub(r.principal_amount)}</span></div>
            <div className="sum"><span>Вознаграждение агента</span><span>{rub(r.online_commission + r.cash_commission)}</span></div>
            <div className="sum"><span>Перечислено исполнителю</span><span>{rub(r.to_performer)}</span></div>
          </div>
        )))}
      </div>
    </div>
  );
}

function Flagged() {
  const list = useLoad(() => get('/api/admin/chat/flagged'), []);
  if (!list.data) return <Loading error={list.error} />;
  if (!list.data.length) return <div className="empty">Ничего подозрительного</div>;
  return (
    <div className="rows">
      {list.data.map((m: any) => (
        <a key={m.id} href={`#/order/${m.order_id}`} className="list-item">
          <div className="stack" style={{ gap: 2 }}>
            <span>{m.body}</span>
            <span className="note">{fmtTime(m.created_at)} · {m.phone ? fmtPhone(m.phone) : ''}</span>
          </div>
        </a>
      ))}
    </div>
  );
}

function Dispatch() {
  const settings = useLoad(() => get('/api/admin/settings'), []);
  const { busy, run } = useAction();
  const [form, setForm] = useState<any>(null);
  if (!settings.data) return <Loading error={settings.error} />;
  const d = settings.data.dispatch;
  const f = form ?? { auctionMinutes: d.auctionMinutes, sosAuctionSeconds: d.sosAuctionSeconds, floor: Math.round(d.offerFloor * 100), ceil: Math.round(d.offerCeil * 100) };
  const save = (patch: unknown, text = 'Сохранено') => run(() => put('/api/admin/settings/dispatch', patch), text).then((r) => { if (r) { setForm(null); settings.reload(); } });
  const num = (k: string) => (e: any) => setForm({ ...f, [k]: Number(e.target.value.replace(/\D/g, '') || 0) });

  return (
    <div className="stack">
      <button className="opt" aria-pressed={d.priorityFirst} disabled={busy}
        onClick={() => save({ priorityFirst: !d.priorityFirst }, d.priorityFirst ? 'Заявки сразу идут на общие торги' : 'Заявки сначала звонят вам')}>
        <div className="between"><b>Сначала заявки нам</b><span className={`pill ${d.priorityFirst ? 'good' : ''}`}>{d.priorityFirst ? 'Включено' : 'Выключено'}</span></div>
        <small>{d.priorityFirst
          ? `Каждая заявка сначала ${d.ringSeconds} секунд звонит исполнителям с пометкой «Первый в очереди» (вкладка «Люди»), потом уходит на торги.`
          : 'Заявки сразу уходят на общие торги — вы откликаетесь наравне со всеми. Удобно на старте, чтобы мастера получали заказы и оставались на площадке.'}</small>
      </button>

      <div className="card">
        <b>Торги</b>
        <div className="grid2">
          <label className="stack" style={{ gap: 6 }}><span className="label">Обычная заявка, мин</span>
            <input className="field" inputMode="numeric" value={f.auctionMinutes} onChange={num('auctionMinutes')} /></label>
          <label className="stack" style={{ gap: 6 }}><span className="label">SOS, секунд</span>
            <input className="field" inputMode="numeric" value={f.sosAuctionSeconds} onChange={num('sosAuctionSeconds')} /></label>
        </div>
        <div className="grid2">
          <label className="stack" style={{ gap: 6 }}><span className="label">Пол цены, % обычной</span>
            <input className="field" inputMode="numeric" value={f.floor} onChange={num('floor')} /></label>
          <label className="stack" style={{ gap: 6 }}><span className="label">Потолок, %</span>
            <input className="field" inputMode="numeric" value={f.ceil} onChange={num('ceil')} /></label>
        </div>
        <span className="note">SOS: если клиент не выбрал за это время, назначаем лучшего из «Рекомендуем». Пол не даёт цене упасть до дна.</span>
        <button className="btn" disabled={busy || !form || f.floor < 50 || f.floor > 100 || f.ceil < 100 || f.ceil > 200 || f.auctionMinutes < 1 || f.sosAuctionSeconds < 30}
          onClick={() => save({ auctionMinutes: f.auctionMinutes, sosAuctionSeconds: f.sosAuctionSeconds, offerFloor: f.floor / 100, offerCeil: f.ceil / 100 })}>Сохранить</button>
      </div>
    </div>
  );
}
