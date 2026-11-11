import { ExternalServicesAdmin } from './externalServicesAdmin.tsx';
import { AdminServices } from './base.tsx';
import { ModQueue } from './moderation.tsx';
import { AdminSummary } from './adminSummary.tsx';
import { AdminShop } from './shop.tsx';
import { AdminSettings } from './adminSettings.tsx';
import { useState } from 'react';
import { useEffect } from 'react';
import { SupportQueue } from './support.tsx';
import { Stats } from './stats.tsx';
import { get, post, put, patch, rub, fmtPhone, fmtTime, authedImage } from '../api.ts';
import { STATUS, SERVICES, LINE } from '../dict.ts';
import { useLoad, useAction, Loading } from '../ui.tsx';

export function Admin() {
  const [tab, setTab] = useState<'stats' | 'search' | 'support' | 'verify' | 'people' | 'orders' | 'dispatch' | 'payments' | 'offers' | 'flagged' | 'bases' | 'queue' | 'summary' | 'shop' | 'settings' | 'vehicleServices' | 'externalBases'>(() => {
    const requested = new URLSearchParams(location.hash.split('?')[1] ?? '').get('tab');
    return requested === 'vehicleServices' ? 'vehicleServices' : 'summary';
  });
  useEffect(() => {
    const onHash = () => {
      const target = new URLSearchParams(location.hash.split('?')[1] ?? '').get('tab');
      if (target === 'vehicleServices') setTab('vehicleServices');
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return (
    <main>
      <h1>Администратор</h1>
      <div className="admin-desktop-shell">
      <div className="scroll-x admin-secondary-nav">
        {([['summary', 'Сводка'], ['queue', 'Очередь'], ['shop', 'Магазин'], ['vehicleServices', 'Страхование и ТО'], ['stats', 'Статистика'], ['search', 'Поиск'], ['support', 'Обращения'], ['verify', 'Проверка'], ['bases', 'Рембазы'], ['externalBases', 'Справочник рембаз'], ['orders', 'Заявки'], ['people', 'Все люди'], ['payments', 'Деньги'], ['dispatch', 'Распределение'], ['offers', 'Оферты'], ['flagged', 'Подозрительное'], ['settings', 'Настройки']] as const).map(([id, n]) => (
          <button key={id} className="chip" aria-pressed={tab === id} onClick={() => setTab(id)}>{n}</button>
        ))}
      </div>
      <section className="admin-content">
      {tab === 'stats' && <Stats />}
      {tab === 'search' && <Search />}
      {tab === 'support' && <SupportQueue />}
      {tab === 'verify' && <Verify />}
      {tab === 'bases' && <AdminServices />}
      {tab === 'externalBases' && <ExternalServicesAdmin />}
      {tab === 'queue' && <ModQueue />}
      {tab === 'summary' && <AdminSummary />}
      {tab === 'shop' && <AdminShop />}
      {tab === 'vehicleServices' && <VehicleServicesQueue />}
      {tab === 'settings' && <AdminSettings />}
      {tab === 'offers' && <Offers />}
      {tab === 'people' && <People />}
      {tab === 'orders' && <AllOrders />}
      {tab === 'dispatch' && <Dispatch />}
      {tab === 'payments' && <Payments />}
      {tab === 'flagged' && <Flagged />}
      </section>
      </div>
    </main>
  );
}

function VehicleServicesQueue() {
  const list = useLoad(() => get('/api/admin/vehicle-service-requests'), []);
  const insurers = useLoad(() => get('/api/admin/insurers'), []);
  const [selectedInsurers, setSelectedInsurers] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [expiry, setExpiry] = useState<Record<string, string>>({});
  const labels: Record<string, string> = {
    submitted: 'Подана', in_review: 'На рассмотрении', need_documents: 'Нужны документы',
    sent_to_partner: 'Передана партнёру', completed: 'Завершена',
    rejected: 'Отказ', cancelled: 'Отменена',
  };
  const next: Record<string, string[]> = {
    submitted: ['in_review', 'rejected', 'cancelled'],
    in_review: ['need_documents', 'sent_to_partner', 'rejected', 'cancelled'],
    need_documents: ['in_review', 'cancelled'],
    sent_to_partner: ['completed', 'rejected', 'cancelled'],
  };
  async function change(id: string, status: string) {
    const note = (notes[id] ?? '').trim();
    // Explain refusals and document requests before updating the client-visible status.
    if (['rejected', 'need_documents'].includes(status) && !note) {
      window.alert('Укажите причину отказа или какие документы нужны клиенту.');
      return;
    }
    const r = await run(() => patch(`/api/admin/vehicle-service-requests/${id}`, {
      status, note: note || undefined,
      policyExpiresOn: status === 'completed' && expiry[id] ? expiry[id] : undefined,
    }), 'Статус обновлён');
    if (r) { setNotes(previous => { const nextNotes = { ...previous }; delete nextNotes[id]; return nextNotes; }); list.reload(); }
  }
  return <div className="stack">
    <h2>Заявки на страхование и техосмотр</h2>
    {!list.data ? <Loading error={list.error} /> : list.data.length === 0 ? <div className="empty">Заявок пока нет</div> : list.data.map((r: any) =>
      <div className="card" key={r.id}>
        <div className="between"><b>{r.kind === 'insurance' ? 'Страхование' : 'Техосмотр'} · {r.brand} {r.model ?? ''}</b><span className="pill">{labels[r.status] ?? r.status}</span></div>
        <span className="note">{r.plate ?? 'Без номера'} · {fmtTime(r.created_at)}</span>
        {r.comment && <span className="note">Клиент: {r.comment}</span>}
        {r.policy_expires_on && <span className="note">Срок полиса: {r.policy_expires_on}</span>}
        {r.staff_note && <span className="note">Предыдущий комментарий: {r.staff_note}</span>}
        {r.kind === 'insurance' && r.status === 'sent_to_partner' && (
          <div className="stack">
            <span className="label">Назначить страховщика</span>
            <div className="row">
              <select className="field" aria-label="Страховщик" value={selectedInsurers[r.id] ?? ''}
                onChange={(e) => setSelectedInsurers((prev) => ({ ...prev, [r.id]: e.target.value }))}>
                <option value="">Выберите партнёра</option>
                {(insurers.data ?? []).map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name || p.id}</option>
                ))}
              </select>
              <button type="button" className="btn ghost small"
                disabled={busy || !selectedInsurers[r.id]}
                onClick={async () => {
                  const result = await run(() => post(`/api/admin/vehicle-service-requests/${r.id}/assign-insurer`, {
                    insurerId: selectedInsurers[r.id],
                  }), 'Страховщик назначен');
                  if (result) list.reload();
                }}>Передать страховщику</button>
            </div>
            {!(insurers.data ?? []).length && <span className="note">Нет подключённых страховщиков. Назначьте роль insurer через администратора.</span>}
          </div>
        )}

        {(next[r.status]?.length ?? 0) > 0 && <>
          <textarea className="field" aria-label="Комментарий сотрудника" placeholder="Комментарий для клиента" value={notes[r.id] ?? ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} maxLength={2000} />
          {r.kind === 'insurance' && r.status === 'sent_to_partner' && <label className="stack">Дата окончания полиса
            <input className="field" type="date" value={expiry[r.id] ?? ''} onChange={(e) => setExpiry({ ...expiry, [r.id]: e.target.value })} />
          </label>}
          <div className="row">{next[r.status].map((status) => <button key={status} type="button" className="btn ghost small" disabled={busy} onClick={() => change(r.id, status)}>{labels[status]}</button>)}</div>
        </>}
      </div>)}
  </div>;
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
            <a href={`#/admin/user/${u.id}`}><b>{u.name ?? 'Без имени'} · {fmtPhone(u.phone)}</b></a>
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
        <FeesEditor fees={fees} onDone={settings.reload} />
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

// Проверка исполнителей -------------------------------------------------------

function Verify() {
  const q = useLoad(() => get('/api/admin/verification'), [], (e) => e.type === 'verification_queue');
  if (!q.data) return <Loading error={q.error} />;
  if (!q.data.length) return <div className="empty">Очередь пуста — все проверены</div>;
  return <div className="stack">{q.data.map((u: any) => <VerifyCard key={u.id} u={u} onDone={q.reload} />)}</div>;
}

const KIND_NAMES: Record<string, string> = { master: 'Мастер', tow: 'Эвакуатор', service: 'Сервис', ecu: 'Блоки управления' };

function VerifyCard({ u, onDone }: { u: any; onDone: () => void }) {
  const { busy, run } = useAction();
  const [reason, setReason] = useState('');
  const allOk = u.docs.length > 0 && u.missing.length === 0 && u.docs.every((d: any) => d.status === 'approved');
  return (
    <div className="card">
      <div className="between">
        <b>{u.name ?? 'Без имени'} · {fmtPhone(u.phone)}</b>
        <span className="pill">{KIND_NAMES[u.kind] ?? u.kind}</span>
      </div>
      <span className="note">
        Отправил {fmtTime(u.submitted_at)} · {u.tax_status === 'self_employed' ? 'самозанятый' : u.tax_status === 'ip' ? 'ИП' : 'статус не указан'}{u.inn ? `, ИНН ${u.inn}` : ''}
        {u.car ? ` · ${u.car.brand}${u.car.color ? ', ' + u.car.color : ''}, ${u.car.plate}` : ''}
      </span>
      {u.flags.map((f: string) => <span key={f} className="pill bad" style={{ alignSelf: 'flex-start' }}>⚠ {f}</span>)}
      {u.missing.length > 0 && <span className="err">Нет фото: {u.missing.join(', ')}</span>}
      {u.docs.map((d: any) => <DocReview key={d.id} d={d} onDone={onDone} />)}
      <input className="field" placeholder="Причина отказа — исполнитель её увидит" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="grid2">
        <button className="btn bad" disabled={busy || reason.length < 3} onClick={() =>
          run(() => post(`/api/admin/performers/${u.id}/verify`, { decision: 'rejected', note: reason }), 'Отказано').then((r) => r && onDone())}>Отказать</button>
        <button className="btn good" disabled={busy || !allOk} onClick={() =>
          run(() => post(`/api/admin/performers/${u.id}/verify`, { decision: 'approved' }), 'Одобрен — может выходить на линию').then((r) => r && onDone())}>Одобрить</button>
      </div>
      {!allOk && <span className="note">«Одобрить» станет доступна, когда все фото приняты.</span>}
    </div>
  );
}

function DocReview({ d, onDone }: { d: any; onDone: () => void }) {
  const { busy, run } = useAction();
  const [src, setSrc] = useState<string | null>(null);
  const [big, setBig] = useState(false);
  const [note, setNote] = useState('');
  const [retake, setRetake] = useState(false);
  useEffect(() => {
    let url: string | null = null;
    authedImage(`/api/documents/${d.id}/file`).then((x) => { url = x; setSrc(x); }).catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [d.id]);
  const review = (status: 'approved' | 'rejected') =>
    run(() => post(`/api/admin/documents/${d.id}`, status === 'rejected' ? { status, note } : { status }), status === 'approved' ? 'Принято' : 'Попросили переснять').then((r) => r && onDone());
  return (
    <div className="stack" style={{ gap: 6, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      <div className="between">
        <b style={{ fontSize: 14 }}>{d.name}</b>
        <span className={`pill ${d.status === 'approved' ? 'good' : d.status === 'rejected' ? 'bad' : ''}`}>
          {d.status === 'approved' ? 'Принято' : d.status === 'rejected' ? 'Переснять' : 'Новое'}
        </span>
      </div>
      {src && <img src={src} alt={d.name} onClick={() => setBig(!big)} style={{ width: '100%', maxHeight: big ? 'none' : 180, objectFit: big ? 'contain' : 'cover', borderRadius: 10, cursor: 'zoom-in' }} />}
      {d.status !== 'approved' && (retake ? (
        <div className="compose">
          <input className="field" placeholder="Что переснять: номер не читается…" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn small" disabled={busy || note.length < 3} onClick={() => review('rejected')}>Отправить</button>
        </div>
      ) : (
        <div className="grid2">
          <button className="btn ghost small" onClick={() => setRetake(true)}>Переснять</button>
          <button className="btn small" disabled={busy} onClick={() => review('approved')}>Принять</button>
        </div>
      ))}
    </div>
  );
}

// Поиск по всему -------------------------------------------------------------

function Search() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<any>(null);
  const { busy, run } = useAction();
  const find = async () => { const r = await run(() => get(`/api/admin/search?q=${encodeURIComponent(q)}`), null); if (r) setRes(r); };
  return (
    <div className="stack">
      <form className="compose" onSubmit={(e) => { e.preventDefault(); find(); }}>
        <input className="field" autoFocus placeholder="Телефон, имя, компания, № заявки, госномер" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn small" disabled={busy || q.trim().length < 2}>Найти</button>
      </form>
      {res && !res.users.length && !res.orders.length && <div className="empty">Ничего не нашлось</div>}
      {res?.orders.map((o: any) => (
        <a key={o.id} href={`#/order/${o.id}`} className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <b>Заявка №{o.number} · {SERVICES[o.service]?.name}</b><span className="note">{STATUS[o.status]?.name} · {fmtTime(o.created_at)}</span>
        </a>
      ))}
      {res?.users.length > 0 && (
        <div className="rows">{res.users.map((u: any) => (
          <a key={u.id} href={`#/admin/user/${u.id}`} className="list-item">
            <div className="stack" style={{ gap: 2 }}>
              <b>{u.name ?? 'Без имени'}{u.company_name ? ` · ${u.company_name}` : ''}</b>
              <span className="note">{fmtPhone(u.phone)} · {u.roles.join(', ')}{u.kind ? ` · проверка: ${u.verification}` : ''}</span>
            </div>
            {u.status === 'blocked' ? <span className="pill bad">Заблокирован</span> : <span className="note">→</span>}
          </a>
        ))}</div>
      )}
      {!res && <span className="note">Карточка человека: профиль и персональная цена, заявки, машины, баланс исполнителя, отзывы, платежи и возвраты, журнал.</span>}
    </div>
  );
}

// Комиссии ---------------------------------------------------------------------

function FeesEditor({ fees, onDone }: { fees: any; onDone: () => void }) {
  const { busy, run } = useAction();
  const [f, setF] = useState({ client: String(fees.clientFeePct), perf: String(fees.performerCommissionPct), debt: String(fees.cashDebtLimit / 100), free: fees.freeUntil ?? '' });
  const num = (v: string) => Number(v.replace(',', '.'));
  const valid = num(f.client) >= 0 && num(f.client) <= 30 && num(f.perf) >= 0 && num(f.perf) <= 30 && num(f.debt) >= 0;
  return (
    <div className="stack">
      <div className="grid2">
        <label className="stack" style={{ gap: 6 }}><span className="label">Сбор с клиента, %</span><input className="field" inputMode="decimal" value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })} /></label>
        <label className="stack" style={{ gap: 6 }}><span className="label">С исполнителя, %</span><input className="field" inputMode="decimal" value={f.perf} onChange={(e) => setF({ ...f, perf: e.target.value })} /></label>
      </div>
      <div className="grid2">
        <label className="stack" style={{ gap: 6 }}><span className="label">Пауза при долге, ₽</span><input className="field" inputMode="numeric" value={f.debt} onChange={(e) => setF({ ...f, debt: e.target.value.replace(/\D/g, '') })} /></label>
        <label className="stack" style={{ gap: 6 }}><span className="label">Без комиссии до</span><input className="field" type="date" value={f.free} onChange={(e) => setF({ ...f, free: e.target.value })} /></label>
      </div>
      <span className="note">Новые проценты — для новых заявок. «Без комиссии до» — первый месяц для мастеров, включительно.</span>
      <button className="btn small" disabled={busy || !valid} onClick={() => run(() => put('/api/admin/settings/fees', {
        clientFeePct: num(f.client), performerCommissionPct: num(f.perf), cashDebtLimit: num(f.debt) * 100, freeUntil: f.free || null,
      }), 'Комиссии сохранены').then((r) => r && onDone())}>Сохранить комиссии</button>
    </div>
  );
}

// Оферты -----------------------------------------------------------------------

const AUD: Record<string, string> = { client: 'Оферта для клиентов', performer: 'Агентский договор для исполнителей и рембаз', privacy: 'Согласие на обработку ПДн' };

function Offers() {
  const list = useLoad(() => get('/api/admin/offers'), []);
  const { busy, run } = useAction();
  const [f, setF] = useState({ audience: 'client', version: '', summary: '', body: '', effectiveAt: '' });
  const [loaded, setLoaded] = useState(false);
  const loadCurrent = async (aud: string) => {
    const cur = await get(`/api/offers/current/${aud}`).catch(() => null);
    setF((x) => ({ ...x, audience: aud, body: cur?.body ?? '', version: cur?.version ? bump(cur.version) : '1.0' }));
    setLoaded(true);
  };
  const minPerf = new Date(Date.now() + 15 * 86_400_000).toISOString().slice(0, 10);
  return (
    <div className="stack">
      <div className="card">
        <b>Новая редакция</b>
        <span className="note">После публикации всем, кого касается, придёт уведомление, а при входе — окно «Условия изменились» с галочкой. Пока не примут, клиент не создаст заявку, исполнитель не выйдет на линию. Для исполнителей — не раньше чем через 15 дней (закон о платформах).</span>
        <div className="scroll-x">{Object.entries(AUD).map(([k, n]) => (
          <button key={k} className="chip" aria-pressed={f.audience === k && loaded} onClick={() => loadCurrent(k)}>{n}</button>
        ))}</div>
        {loaded && (
          <>
            <div className="grid2">
              <input className="field" placeholder="Номер редакции" value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })} />
              <input className="field" type="date" min={f.audience === 'performer' ? minPerf : undefined} value={f.effectiveAt} onChange={(e) => setF({ ...f, effectiveAt: e.target.value })} />
            </div>
            <span className="note">{f.effectiveAt ? '' : f.audience === 'performer' ? `Дата не выбрана — вступит ${new Date(minPerf).toLocaleDateString('ru-RU')}` : 'Дата не выбрана — вступит сразу'}</span>
            <input className="field" placeholder="Что изменилось — одной строкой, люди увидят первым" value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} />
            <textarea className="field" style={{ minHeight: 260, fontFamily: 'ui-monospace, monospace', fontSize: 13 }} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })}
              placeholder={'# Заголовок\n\nТекст. **Жирный** выделяется звёздочками.\n\n1. Пункт\n2. Пункт'} />
            <button className="btn" disabled={busy || !f.version || f.body.length < 50} onClick={() => run(() => post('/api/admin/offers', {
              audience: f.audience, version: f.version, summary: f.summary || undefined, body: f.body,
              effectiveAt: f.effectiveAt ? new Date(f.effectiveAt + 'T00:00:00+03:00').toISOString() : undefined,
            }), 'Опубликовано — всем придёт уведомление').then((r) => { if (r) { setLoaded(false); list.reload(); } })}>Опубликовать</button>
          </>
        )}
      </div>
      <span className="label">История</span>
      {!list.data ? <Loading error={list.error} /> : !list.data.length ? <div className="empty">Ещё ничего не опубликовано</div> : (
        <div className="rows">{list.data.map((o: any) => (
          <a key={o.id} href={`#/offer/${o.audience}`} className="list-item">
            <div className="stack" style={{ gap: 2 }}>
              <b>{AUD[o.audience]} · {o.version}</b>
              <span className="note">с {new Date(o.effective_at).toLocaleDateString('ru-RU')}{o.summary ? ` · ${o.summary}` : ''}</span>
            </div>
            <span className="pill">приняли {o.accepted}</span>
          </a>
        ))}</div>
      )}
    </div>
  );
}

function bump(v: string) {
  const m = /^(\d+)\.(\d+)/.exec(v);
  return m ? `${m[1]}.${Number(m[2]) + 1}` : v + '-2';
}
