import '../adminExperience.css';
import { AdminServices } from './base.tsx';
import { ModQueue } from './moderation.tsx';
import { AdminSummary } from './adminSummary.tsx';
import { AdminCaseCenter } from './adminCaseCenter.tsx';
import { DispatcherDesk } from './DispatcherDesk.tsx';
import { EcuAdminStations } from './ecuHandoffs.tsx';
import { AdminSettings } from './adminSettings.tsx';
import { AdminDiagnostics } from './adminDiagnostics.tsx';
import { AdminAccountAccess } from './adminAccountAccess.tsx';
import { AdminRegistry } from './adminRegistry.tsx';
import { AdminServiceFinance } from './adminServiceFinance.tsx';
import { useState } from 'react';
import { useEffect } from 'react';
import { SupportQueue } from './support.tsx';
import { Stats } from './stats.tsx';
import { OpsDashboard, WorkerCommunications } from './ops.tsx';
import { VehicleServicesQueue } from './vehicleServicesAdmin.tsx';
import { get, post, put, rub, fmtPhone, fmtTime, authedImage } from '../api.ts';
import { STATUS, SERVICES, LINE } from '../dict.ts';
import { useLoad, useAction, Loading } from '../ui.tsx';
import { TRAKBOT_TERMS, type TrakBotOfferAudience } from '../trakbotTerms.ts';

type AdminSection = 'ecu' | 'cases' | 'stats' | 'search' | 'support' | 'verify' | 'people' | 'access' | 'orders' | 'dispatch' | 'payments' | 'offers' | 'flagged' | 'bases' | 'queue' | 'summary' | 'settings' | 'demand' | 'announcements' | 'vehicleServices' | 'diagnostics' | 'serviceFinance' | 'registry';
type AdminNavItem = { id: AdminSection; name: string; description: string; symbol: string };
const ADMIN_GROUPS: { name: string; items: AdminNavItem[] }[] = [
  { name: 'Операционная работа', items: [
    { id: 'queue', name: 'Модерация', description: 'Очередь проверок и обращений', symbol: '01' },
    { id: 'summary', name: 'Сводка', description: 'Общее состояние платформы', symbol: '02' },
    { id: 'cases', name: 'Заявки и мультизаявки', description: 'Номера, история, модерация и расчёты', symbol: '03' },
    { id: 'orders', name: 'Все заказы', description: 'Отдельные рабочие заказы исполнителей', symbol: '03+' },
    { id: 'dispatch', name: 'Распределение', description: 'Назначения и управление вызовами', symbol: '04' },
    { id: 'demand', name: 'Проблемные заявки', description: 'Найти и устранить задержки', symbol: '05' },
    { id: 'support', name: 'Обращения', description: 'Поддержка пользователей и партнёров', symbol: '06' },
  ] },
  { name: 'Люди и партнёры', items: [
    { id: 'registry', name: 'Единая база', description: 'Компании, водители, мастера, эвакуаторы, СТО — поиск, регионы, CSV', symbol: 'CRM' },
    { id: 'search', name: 'Поиск', description: 'Люди, заявки и история', symbol: '07' },
    { id: 'people', name: 'Все люди', description: 'Пользователи и их права', symbol: '08' },
    { id: 'access', name: 'Регистрация и доступы', description: 'Создать учётную запись, выбрать роли и передать проблему разработчику', symbol: '08+' },
    { id: 'verify', name: 'Проверка', description: 'Документы и допуск исполнителей', symbol: '09' },
    { id: 'bases', name: 'Рембазы', description: 'Партнёрские станции ремонта', symbol: '10' },
    { id: 'ecu', name: 'Стационарные ЭБУ', description: 'Проверка адресов ремонтников электронных блоков', symbol: '10+' },
    { id: 'vehicleServices', name: 'Страхование и ТО', description: 'Заявки и контроль партнёров', symbol: '11' },
  ] },
  { name: 'Финансы и документы', items: [
    { id: 'serviceFinance', name: 'Счета и выплаты СТО', description: 'Поступления, возвраты и две независимые комиссии', symbol: 'СТО' },
    { id: 'payments', name: 'Деньги', description: 'Комиссии, отчёты и выплаты', symbol: '12' },
    { id: 'offers', name: 'Оферты', description: 'Документы для пользователей', symbol: '13' },
    { id: 'announcements', name: 'Объявления и комиссии', description: 'Оповещения и условия работы', symbol: '14' },
  ] },
  { name: 'Контроль платформы', items: [
    { id: 'stats', name: 'Статистика', description: 'Реальные показатели сервиса', symbol: '15' },
    { id: 'flagged', name: 'Подозрительное', description: 'Сигналы и проверки безопасности', symbol: '16' },
    { id: 'diagnostics', name: 'Журнал ошибок', description: 'Сбои, фильтры и выгрузка CSV', symbol: '18' },
    { id: 'settings', name: 'Настройки', description: 'Параметры платформы и доступы', symbol: '17' },
  ] },
];
const ADMIN_SECTIONS: AdminSection[] = ADMIN_GROUPS.flatMap(group => group.items.map(item => item.id));

export function Admin({ initialSection }: { initialSection?: string }) {
  const [tab, setTab] = useState<AdminSection>(() =>
    ADMIN_SECTIONS.includes(initialSection as AdminSection) ? initialSection as AdminSection : 'summary');
  const [navOpen, setNavOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const selected = ADMIN_GROUPS.flatMap(group => group.items).find(item => item.id === tab)!;
  const search = filter.trim().toLocaleLowerCase('ru-RU');
  const groups = ADMIN_GROUPS.map(group => ({...group, items: group.items.filter(item =>
    !search || (item.name + ' ' + item.description).toLocaleLowerCase('ru-RU').includes(search))
  })).filter(group => group.items.length > 0);
  const navigate = (id: AdminSection) => {
    // Route changes already remount Admin with a fresh initialSection in main.tsx.
    // Do not render a temporary tab before changing the hash: fast input would be
    // detached during that second mount (admin search losing what was typed).
    setNavOpen(false);
    location.hash = '#/admin/section/' + id;
  };
  return (
    <main className="admin-workspace">
      {/* The original landing hero is never repeated inside a selected admin
          work section: that section already has its own title and actions. */}
      {!initialSection && <section className="admin-command-hero">
        <div className="admin-command-art" aria-hidden="true"><span>◈</span><i/><i/><i/></div>
        <span className="admin-command-eyebrow">TRAKSOS · ОПЕРАЦИОННЫЙ ЦЕНТР</span>
        <h1>Рабочий стол</h1>
        <p>Заявки, партнёры, страхование, финансы и качество сервиса — в одном рабочем пространстве.</p>
        <div className="and20-admin-actions" aria-label="Основные действия администратора">
          {([
            ['demand','Проблемные заявки'],['verify','Проверка партнёров'],
            ['support','Обращения'],['registry','Реестр пользователей'],
          ] as [AdminSection,string][]).map(([id,label])=><button key={id} type="button"
            className="and20-admin-action" onClick={()=>navigate(id)}>{label}<span aria-hidden="true">›</span>
          </button>)}
        </div>
        <div className="admin-command-actions">
          <button type="button" className="btn" onClick={() => navigate('summary')}>Общая сводка</button>
          <a className="btn ghost" href="#/admin/test-center">Тестирование кабинетов ролей</a>
        </div>
      </section>}
      <div className="admin-shell">
        <button type="button" className="admin-nav-toggle" aria-controls="admin-section-navigation"
          aria-expanded={navOpen} onClick={() => setNavOpen(open => !open)}>
          <span><small>Разделы управления</small><b>{selected.name}</b></span>
          <span aria-hidden="true">{navOpen ? '−' : '+'}</span>
        </button>
        <nav id="admin-section-navigation" className={'admin-navigation' + (navOpen ? ' expanded' : '')}
          aria-label="Разделы администрации">
          <div className="admin-nav-intro"><b>Управление TrakSOS</b><span>Все рабочие инструменты в одном месте</span></div>
          <label className="admin-nav-search"><span className="label">Быстрый поиск раздела</span>
            <input className="field" type="search" placeholder="Например, заявки или страхование"
              aria-label="Поиск раздела администрации" value={filter} onChange={event => setFilter(event.target.value)} />
          </label>
          {groups.map(group => <section className="admin-nav-group" key={group.name}>
            <h2>{group.name}</h2>
            {group.items.map(item => <button key={item.id} type="button"
              className={'admin-nav-item' + (tab === item.id ? ' active' : '')}
              aria-label={item.name} aria-current={tab === item.id ? 'page' : undefined}
              onClick={() => navigate(item.id)}>
              <span className="admin-nav-symbol" aria-hidden="true">{item.symbol}</span>
              <span className="admin-nav-item-copy"><b>{item.name}</b><small>{item.description}</small></span>
              <span className="admin-nav-chevron" aria-hidden="true">›</span>
            </button>)}
          </section>)}
          {groups.length === 0 && <p className="admin-nav-no-results">Ничего не найдено. Попробуйте другое слово.</p>}
          <a className="admin-nav-preview" href="#/admin/test-center">
            <span className="admin-nav-preview-icon" aria-hidden="true">▣</span>
            <span><b>Проверить кабинеты ролей</b><small>Отдельная безопасная тестовая среда</small></span>
            <span aria-hidden="true">›</span>
          </a>
        </nav>
        <section className="admin-stage" aria-label={'Рабочий раздел: ' + selected.name}>
          <header className="admin-stage-head">
            <span className="admin-stage-kicker">РАБОЧИЙ РАЗДЕЛ · TRAKSOS</span>
            <h2>{selected.name}</h2>
            <p>{selected.description}</p>
          </header>
          <div className="admin-stage-content">
            {tab === 'stats' && <Stats />}
            {tab === 'demand' && <OpsDashboard />}
            {tab === 'announcements' && <WorkerCommunications />}
            {tab === 'registry' && <AdminRegistry />}
            {tab === 'search' && <Search />}
            {tab === 'support' && <SupportQueue />}
            {tab === 'verify' && <Verify />}
            {tab === 'bases' && <AdminServices />}
            {tab === 'ecu' && <EcuAdminStations />}
            {tab === 'queue' && <ModQueue />}
            {tab === 'summary' && <AdminSummary />}
            {tab === 'vehicleServices' && <>
              <a className="btn ghost small" href="#/admin/section/settings">Управлять регистрацией страховых агентов</a>
              <VehicleServicesQueue />
            </>}
            {tab === 'settings' && <AdminSettings />}
            {tab === 'offers' && <Offers />}
            {tab === 'people' && <People />}
            {tab === 'access' && <AdminAccountAccess />}
            {tab === 'cases' && <AdminCaseCenter />}
            {tab === 'orders' && <AllOrders />}
            {tab === 'dispatch' && <div className="stack">
              <DispatcherDesk />
              <details className="card">
                <summary>Настройки распределения и торгов</summary>
                <Dispatch />
              </details>
            </div>}
            {tab === 'payments' && <Payments />}
            {tab === 'serviceFinance' && <AdminServiceFinance />}
            {tab === 'flagged' && <Flagged />}
            {tab === 'diagnostics' && <AdminDiagnostics />}
          </div>
          <div className="admin-mobile-quick">
            <div className="admin-mobile-quick-heading"><b>Быстрые переходы</b><small>Частые задачи администратора</small></div>
            <div className="admin-mobile-quick-grid">
              {(['registry','access','verify','dispatch','payments','search','support','stats'] as AdminSection[]).map(id => {
                const item = ADMIN_GROUPS.flatMap(group => group.items).find(entry => entry.id === id)!;
                return <button type="button" key={id} aria-label={item.name}
                  className="admin-mobile-quick-item" onClick={() => navigate(id)}>
                  <span aria-hidden="true">{item.symbol}</span><b>{item.name}</b><i aria-hidden="true">›</i>
                </button>;
              })}
            </div>
          </div>
        </section>
      </div>
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
      <a className="btn ghost small" href="#/admin/section/access">+ Создать пользователя / сообщить разработчику</a>
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
  if (list.data.length === 0) return (
    <section className="card admin-orders-zero" role="status" aria-label="Нет заказов">
      <h3>Заказов пока нет</h3>
      <p className="note">Когда появятся заказы исполнителей, здесь будут их номера, статусы и переходы в карточки. Данные не подменяются демонстрационными.</p>
      <a className="btn ghost" href="#/admin/section/cases">Открыть заявки и мультизаявки</a>
    </section>
  );
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
  const fees = settings.data.fees;

  return (
    <div className="stack">
      <div className="card">
        <b>Способы оплаты</b>
        <div className="banner warn">Реальные банковские платежи ещё не подключены. Тестовые списания и счета не разрешается выдавать за полученные деньги.</div>
        <div className="sum"><span>СБП / карта</span><b>Не подключено</b></div>
        <div className="sum"><span>Счета компаний</span><b>Подготовка документов через Точку, без приёма платежей</b></div>
        <div className="note">Наличные для новых заказов исключены. Подключение оплаты требует отдельного банковского и юридического выпуска, а не переключателя администратора.</div>
      </div>
      <div className="card">
        <b>Комиссии</b>
        <div className="sum"><span>Сбор с клиента</span><span>{fees.clientFeePct}%</span></div>
        <div className="sum"><span>Вознаграждение с исполнителя</span><span>{fees.performerCommissionPct}%</span></div>
        <div className="note">Исторические задолженности доступны в учёте, но новые наличные заказы не создаются.</div>
        <FeesEditor fees={fees} onDone={settings.reload} />
      </div>
      <div className="card">
        <b>Выплаты исполнителям</b>
        <div className="banner warn">Автоматические банковские выплаты ещё не подключены. Отправка заблокирована: тестовые суммы нельзя отмечать реальными переводами.</div>
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

export function Flagged() {
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

export function Verify() {
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
      <span className="note">Изменение процентов немедленно меняет расчёты новых заявок и справку. До такого изменения необходимо подготовить юридически согласованную новую редакцию оферты; её публикация и повторное согласие пользователей — отдельные обязательные шаги. Для исполнителей действует срок уведомления, поэтому без согласованного перехода тарифы менять нельзя.</span>
      <span className="note">Новые проценты — для новых заявок. «Без комиссии до» — первый месяц для мастеров, включительно.</span>
      <button className="btn small" disabled={busy || !valid} onClick={() => run(() => put('/api/admin/settings/fees', {
        clientFeePct: num(f.client), performerCommissionPct: num(f.perf), cashDebtLimit: num(f.debt) * 100, freeUntil: f.free || null,
      }), 'Комиссии сохранены').then((r) => r && onDone())}>Сохранить комиссии</button>
    </div>
  );
}

// Оферты -----------------------------------------------------------------------

const AUD: Record<string, string> = { client: 'Оферта для клиентов', performer: 'Агентский договор для исполнителей и рембаз', insurer:'Договор страхового партнёра', inspection:'Договор оператора ТО', privacy: 'Согласие на обработку ПДн' };

function Offers() {
  const list = useLoad(() => get('/api/admin/offers'), []);
  const economicsAudit = useLoad(() => get('/api/admin/offers/economics-audit'), []);
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
      <div className="card stack" aria-label="Сверка экономики с офертами">
        <b>Контроль: тарифы и действующие редакции</b>
        <p className="note">Цифры справки обновляются из настроек автоматически. Юридически принятые редакции неизменны: новые ставки, бонусы и рефералы необходимо утвердить новой версией оферты. Финансовый раздел приложения к ней при публикации формируется из действующих настроек.</p>
        {(economicsAudit.data as any[]|undefined)?.map((record:any)=><div className="between" style={{gap:10,flexWrap:'wrap'}} key={record.audience}>
          <span>{AUD[record.audience] ?? record.audience} · {record.version??'не опубликована'}</span>
          <strong style={{color:record.requiresReview?'var(--warn, #bc6020)':'var(--accent, #2f84df)'}}>
            {record.requiresReview?'Нужна новая редакция':'Расчёты совпадают'}
          </strong>
        </div>)}
        {economicsAudit.error && <span className="note">Не удалось проверить соответствие экономических условий опубликованным редакциям.</span>}
      </div>
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
              <input className="field" type="date" min={['performer','insurer','inspection'].includes(f.audience) ? minPerf : undefined} value={f.effectiveAt} onChange={(e) => setF({ ...f, effectiveAt: e.target.value })} />
            </div>
            <span className="note">{f.effectiveAt ? '' : ['performer','insurer','inspection'].includes(f.audience) ? `Дата не выбрана — вступит ${new Date(minPerf).toLocaleDateString('ru-RU')}` : 'Дата не выбрана — вступит сразу'}</span>
            <input className="field" placeholder="Что изменилось — одной строкой, люди увидят первым" value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} />
            <div className="card flat" style={{ gap: 8 }}>
              <b>Дополнения TrakBot — черновик, нужен юридический просмотр</b>
              <span className="note">Три отдельных раздела для клиента, исполнителя и персональных данных. Уже принятые редакции не редактируются: создаётся новая версия с датой вступления. Для исполнителей сохраняется уведомление минимум за 15 дней.</span>
              <button type="button" className="btn ghost small" onClick={() => {
                const section = TRAKBOT_TERMS[f.audience as TrakBotOfferAudience];
                if (!section || f.body.includes('## TrakBot')) return;
                setF({ ...f, body: f.body.trimEnd() + '\\n\\n' + section.trim() + '\\n',
                  summary: f.summary || 'Добавлены правила справочного ИИ TrakBot и дистанционных консультаций' });
              }}>Добавить проект раздела TrakBot в эту редакцию</button>
            </div>
            <textarea className="field" style={{ minHeight: 260, fontFamily: 'ui-monospace, monospace', fontSize: 13 }} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })}
              placeholder={'# Заголовок\n\nТекст. **Жирный** выделяется звёздочками.\n\n1. Пункт\n2. Пункт'} />
            <button className="btn" disabled={busy || !f.version || f.body.length < 50} onClick={() => run(() => post('/api/admin/offers', {
              audience: f.audience, version: f.version, summary: f.summary || undefined, body: f.body,
              effectiveAt: f.effectiveAt ? new Date(f.effectiveAt + 'T00:00:00+03:00').toISOString() : undefined,
            }), 'Опубликовано — всем придёт уведомление').then((r) => { if (r) { setLoaded(false); list.reload(); economicsAudit.reload(); } })}>Опубликовать</button>
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
