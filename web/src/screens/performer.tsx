import { useEffect, useRef, useState } from 'react';
import { get, post, put, rub, onEvent } from '../api.ts';
import { BRANDS, BRAND_LEVELS, LINE, SERVICES } from '../dict.ts';
import { useLoad, useAction, useMe, go, Loading, Field, RubInput, Back, LiveStrip } from '../ui.tsx';
import { native } from '../native.ts';
import { OfferForm } from './search.tsx';
import { WorkerNotices } from './ops.tsx';
import { useToast } from '../ui.tsx';
import { VerifiedBadge } from '../verifiedBadge.tsx';
import { EcuStationWorkspace } from './ecuHandoffs.tsx';
import './performerMobileWork.css';

// Линия: статус, геолокация, входящие ---------------------------------------

export function Work({background=false}:{background?:boolean}={}) {
  const { me, reload } = useMe();
  const { busy, run } = useAction();
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 820px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 820px)');
    const sync = () => setCompact(mq.matches);
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  const balance = useLoad(() => get('/api/performer/balance'), [], (e) => e.type === 'balance' || e.type === 'order');
  const jobs = useLoad(() => get('/api/orders?as=performer'), [], (e) => e.type === 'order');
  const auctions = useLoad(() => get('/api/performer/auctions'), [], (e) => e.type === 'auction' || e.type === 'order');
  useEffect(() => onEvent((e) => { if (e.type === 'line_status') reload(); }), [reload]);
  const p = me?.performer;
  if (p?.kind === 'ecu') return <EcuStationWorkspace />;
  if (!p) return <main><h1>Кабинет исполнителя</h1><div className="card"><b>Заполните профиль</b><span className="note">Марки, цены, машина и статус самозанятого или ИП — после проверки начнут приходить заявки.</span><button className="btn" onClick={() => go('work/me')}>Заполнить</button></div></main>;

  // A physical job may be completed while its separate price dispute is still open.
  const active = (jobs.data ?? []).filter((o: any) =>
    ['accepted','en_route','arrived','working','awaiting_confirmation'].includes(o.status) &&
    !(['pending_client','disputed'].includes(o.unilateral_status)));
  const toReview = (jobs.data ?? []).filter((o:any)=>
    ['pending_client','disputed'].includes(o.unilateral_status));
  const online = p.line_status === 'online' || p.line_status === 'on_job' || p.line_status === 'on_call';
  const setLine = (lineStatus: string, busyUntil?: string) => run(() => post('/api/performer/line', { lineStatus, busyUntil })).then((r) => {
    if (!r) return;
    if (lineStatus === 'online') native.performerOnline();
    reload();
  });

  if (compact && !background) return <MobilePerformerWork p={p} personName={me?.name ?? undefined}
    active={active} awaiting={toReview} jobs={jobs.data ?? []} incoming={auctions.data ?? []}
    onOfferDone={auctions.reload} balance={balance.data} online={online}
    busy={busy} setLine={setLine} />;

  return (
    <main className="work-live-dashboard">
      <WorkerNotices />
      <section className="work-command-hero" aria-label="Рабочий стол исполнителя">
        <div className="work-command-copy">
          <span className="work-command-kicker">TRAKSOS · {p.kind === 'tow' ? 'ЭВАКУАЦИЯ' : 'ВЫЕЗДНАЯ ПОМОЩЬ'}</span>
          <h1>{me?.name || (p.kind === 'tow' ? 'Водитель эвакуатора' : 'Выездной специалист')}</h1>
          <p>{active.length
            ? 'Сейчас у вас активных заявок: ' + active.length + '. Откройте нужную карточку ниже — там текущий этап и дальнейшие действия.'
            : online ? 'Вы на линии. Новые заявки, предложения и рабочие уведомления появятся на этом экране.'
              : 'Ваш рабочий стол. Выберите статус доступности ниже, чтобы управлять приёмом заявок.'}</p>
          <div className="work-command-tags">
            <span className="work-command-status"><span className={'dot ' + (online ? 'on' : '')} />{LINE[p.line_status] ?? 'Статус не указан'}</span>
            {p.verification === 'approved' ? <VerifiedBadge verified kind={p.kind === 'tow' ? 'tow' : 'specialist'} /> : <button type="button" className="traksos-verify-invite" onClick={() => go('work/docs')}>◇ Подтвердить профиль · узнать преимущества ›</button>}
          </div>
        </div>
        <div className="work-command-art" aria-hidden="true" />
      </section>
      <LiveStrip who={p.kind === 'tow' ? 'tow' : 'master'} />
      {!background && online && <Nearby />}
      {p.verification !== 'approved' ? (
        <div className="card hi">
          <b>{p.verification === 'rejected' ? 'Проверка не пройдена' : p.submitted_at ? 'Профиль на проверке' : 'Пройдите проверку'}</b>
          <span className="note">{p.verification === 'rejected' ? (p.verification_note ?? 'Исправьте данные и отправьте ещё раз.')
            : p.submitted_at ? 'Обычно до 24 часов. Проверка добровольная и повышает доверие клиентов.'
            : 'Проверка добровольная: подтверждённый профиль получает заметный значок и преимущество среди подходящих исполнителей.'}</span>
          <button className="btn" onClick={() => go('work/docs')}>{p.submitted_at ? 'Мои фото' : 'Снять фото'}</button>
        </div>
      ) : (
        <LineCard p={p} busy={busy} setLine={setLine} online={online} shareLocation={!background} />
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

      {toReview.length > 0 && <section className="stack" aria-label="Работы на проверке">
        <span className="label">Работа сдана · ожидаются подтверждения</span>
        {toReview.map((o:any)=><a key={o.id} className="card"
          href={'#/order/'+o.id} style={{textDecoration:'none',color:'inherit'}}>
          <b>Заявка №{o.number} · {o.unilateral_status==='disputed'?'Разбирательство':'Ожидаем клиента'}</b>
          <span className="note">Физическая работа завершена. Расчёт ещё не утверждён и не означает оплату. Открыть историю и чат →</span>
        </a>)}
      </section>}
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
          <span className="note">TrakSOS работает как агент: отчёт агента и акт — раз в месяц.</span>
        </div>
      )}
      <button className="btn ghost" onClick={() => go('work/me/money')}>Финансы · все операции</button>
    </main>
  );
}


/**
 * Phone-sized work search: only records already granted to this performer by
 * /api/orders?as=performer and /api/performer/auctions. No global client lookup.
 * Current orders API returns the most recent 100 assigned jobs.
 */
function MobileWorkSearch({jobs,incoming,onOfferDone}:{
  jobs:any[]; incoming:any[]; onOfferDone:()=>void;
}) {
  const [expanded,setExpanded] = useState(false);
  const [query,setQuery] = useState('');
  const [scope,setScope] = useState<'mine'|'incoming'|'archive'>('mine');
  const normalize=(x:unknown)=>String(x??'').toLocaleLowerCase('ru-RU').trim();
  const needle=normalize(query);
  const searchText=(o:any)=>[
    o.number,o.address,o.v_plate,o.v_brand,o.v_model,o.brand,o.problem,o.description,
  ].map(normalize).join(' ');
  const selected = scope==='incoming'
    ? incoming.filter((o:any)=>[o.number,o.order_id,o.address,o.brand,o.description]
        .map(normalize).join(' ').includes(needle))
    : jobs.filter((o:any)=>scope==='archive'
        ? ['completed','cancelled'].includes(o.status)
        : !['completed','cancelled'].includes(o.status))
        .filter((o:any)=>searchText(o).includes(needle));
  return <section className="work-mobile-search" aria-label="Поиск заявок мастера">
    <div className="work-mobile-searchbar">
      <span aria-hidden="true" className="work-mobile-search-icon">⌕</span>
      <input type="search" aria-label="Поиск по своим заявкам, номеру, госномеру или адресу"
        placeholder="Номер, госномер, адрес…" autoComplete="off"
        value={query} onChange={e=>{setQuery(e.target.value);setExpanded(true)}}
        onFocus={()=>setExpanded(true)}/>
      <button type="button" aria-label={expanded?'Свернуть поиск':'Открыть поиск и фильтры'}
        aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>
        {expanded?'Свернуть':'Фильтры'}
      </button>
    </div>
    {expanded && <>
      <div className="work-mobile-searchfilters" role="group" aria-label="Что ищем">
        {([['mine','Мои'],['incoming','Входящие'],['archive','История']] as const)
          .map(([id,label])=><button type="button" key={id}
            aria-pressed={scope===id} className={scope===id?'active':''}
            onClick={()=>setScope(id)}>{label}</button>)}
      </div>
      <p className="work-mobile-searchinfo">
        {scope==='mine'?'Только назначенные вам открытые заявки'
        :scope==='archive'?'Последние завершённые и отменённые вами заявки'
        :'Только реально поступившие вам предложения'} · найдено {selected.length}
      </p>
      <div className="work-mobile-searchresults" role="region" aria-label="Найденные заявки">
        {selected.length===0
          ? <p className="work-mobile-search-empty">Ничего не найдено. Проверьте номер или переключите фильтр.</p>
          : selected.slice(0,20).map((o:any)=>scope==='incoming'
            ? <article key={o.order_id} className="work-mobile-search-result">
                <b>{o.is_sos?'SOS · ':''}{SERVICES[o.service]?.name??o.service}</b>
                <span className="note">{o.address || 'Адрес в предложении'}</span>
                <OfferForm orderId={o.order_id} limits={o.limits} myPrice={o.my_price}
                  onDone={onOfferDone}/>
              </article>
            : <a key={o.id} href={`#/order/${o.id}`} className="work-mobile-search-result">
                <b>№{o.number} · {SERVICES[o.service]?.name??o.service}</b>
                <span>{o.v_plate || o.v_model || o.brand || 'Грузовой транспорт'}</span>
                <span className="note">{o.address || 'Адрес в заявке'} · {o.status==='completed'?'Завершена':
                  o.status==='cancelled'?'Отменена':o.unilateral_status==='disputed'?'Спор':
                  'Открыть'}</span>
              </a>)}
        {selected.length>20 && <p className="work-mobile-searchinfo">Показаны первые 20 из {selected.length} найденных.</p>}
      </div>
      <p className="work-mobile-searchinfo">Поиск только по доступным вам данным; архив API ограничен последними 100 заявками. Календарные записи открываются в графике.</p>
    </>}
  </section>;
}

/** Android / narrow-screen workspace. One next action, not a squeezed PC dashboard.
 * All numbers, orders and offers are read from exactly the same authenticated API
 * responses as the desktop. No fake progress, no offline status mutations.
 */
function MobilePerformerWork({p, personName, active, awaiting, jobs, incoming, onOfferDone,
  balance, online, busy, setLine}: {
  p:any; personName?:string; active:any[]; awaiting:any[]; jobs:any[]; incoming:any[];
  onOfferDone:()=>void; balance:any; online:boolean; busy:boolean;
  setLine:(line:string, until?:string)=>void;
}) {
  const first = active[0];
  const stage:Record<string,string> = {
    accepted:'Принята — пора выезжать', en_route:'Вы в пути', arrived:'Вы на месте',
    working:'Идёт работа', awaiting_confirmation:'Ждём подтверждения клиента',
  };
  return <main className="work-mobile" aria-label="Мобильное рабочее место исполнителя">
    <header className="work-mobile-header">
      <span className="work-mobile-kicker">TrakSos · {p.kind === 'tow' ? 'эвакуация' : 'выездной мастер'}</span>
      <h1>Рабочая смена</h1>
      <div className="work-mobile-person">
        <span>{personName || (p.kind==='tow' ? 'Эвакуаторщик' : 'Мастер')}</span>
        <span className="work-mobile-state"><span className={'dot '+(online?'on':'')}/>
          {LINE[p.line_status] || 'Доступность не указана'}</span>
      </div>
    </header>
    <WorkerNotices />
    <MobileWorkSearch jobs={jobs} incoming={incoming} onOfferDone={onOfferDone}/>
    {p.verification === 'approved'
      ? <LineCard p={p} busy={busy} setLine={setLine} online={online}/>
      : <section className="card stack" aria-label="Проверка исполнителя">
          <strong>{p.verification==='rejected'?'Проверка не пройдена':p.submitted_at?'Профиль на проверке':'Подтвердите профиль'}</strong>
          <span className="note">{p.verification_note || 'Пока статус не подтверждён, ознакомьтесь с условиями приёма заявок.'}</span>
          <a className="btn ghost" href="#/work/docs">Документы исполнителя</a>
        </section>}
    {first ? <section className="work-mobile-current" aria-label="Активная заявка">
        <span className="work-mobile-kicker">СЕЙЧАС В РАБОТЕ</span>
        <h2>№{first.number} · {SERVICES[first.service]?.name || first.service}</h2>
        <p className="work-mobile-stage">{stage[first.status] || 'Открытая заявка'}</p>
        <p className="note">{first.address || first.estimate?.zoneName || 'Место — в карточке заявки'}</p>
        <div className="work-mobile-progress" aria-label="Этапы текущей работы">
          {(['accepted','en_route','arrived','working','awaiting_confirmation'] as const).map((step,i)=>{
            const order = ['accepted','en_route','arrived','working','awaiting_confirmation'];
            const at = order.indexOf(first.status);
            return <span key={step} className={i<at?'done':i===at?'current':''}
              title={['Принята','В пути','На месте','Работа','На подтверждении'][i]}
              aria-label={['Принята','В пути','На месте','Работа','На подтверждении'][i]}/>;
          })}
        </div>
        <a className="btn work-mobile-primary" href={`#/order/${first.id}`}>{({
          accepted:'Открыть · подтвердить выезд',
          en_route:'Открыть · отметить прибытие',
          arrived:'Открыть · начать работу',
          working:'Оформить результат и расчёт',
          awaiting_confirmation:'Проверить подтверждение клиента',
        } as Record<string,string>)[first.status] ?? 'Открыть заявку'}</a>
        <span className="work-mobile-action-hint">Действие выполняется внутри заявки и подтверждается сервером.</span>
        {active.length > 1 && <span className="note">Других активных заявок: {active.length-1}</span>}
      </section>
      : <section className="work-mobile-current work-mobile-empty" aria-label="Нет текущих работ">
          <span className="work-mobile-kicker">{online ? 'ГОТОВ К НОВЫМ ЗАЯВКАМ' : 'СЕЙЧАС НЕ НА ЛИНИИ'}</span>
          <h2>{online?'Ожидаем подходящий вызов':'Включите доступность, когда готовы'}</h2>
          <p className="note">Входящие предложения появятся здесь, когда их отправит сервер. Статус меняется выше.</p>
        </section>}
    {active.length > 1 && <section className="work-mobile-list" aria-label="Другие активные работы">
      <h2>Остальные работы</h2>
      {active.slice(1).map((o:any)=><a className="work-mobile-list-item" href={`#/order/${o.id}`} key={o.id}>
        <strong>№{o.number} · {SERVICES[o.service]?.name || o.service}</strong>
        <span>{stage[o.status] || o.status} ›</span></a>)}
    </section>}
    {incoming.length>0 && <section className="work-mobile-list" aria-label="Новые предложения">
      <h2>Новые предложения · {incoming.length}</h2>
      {incoming.map((a:any)=><div className="card stack" key={a.order_id}>
        <div className="between"><b>{a.is_sos?'SOS · ':''}{SERVICES[a.service]?.name || a.service}</b>
          {Number.isFinite(a.distance_km) && <span className="pill">{a.distance_km.toFixed(1)} км</span>}</div>
        <span className="note">{a.address || a.estimate?.zoneName || 'Адрес уточняется'}</span>
        <OfferForm orderId={a.order_id} limits={a.limits} myPrice={a.my_price}
          onDone={onOfferDone}/></div>)}
    </section>}
    {awaiting.length>0 && <section className="work-mobile-list" aria-label="Сданные работы на проверке">
      <h2>Ждём ответа клиента · {awaiting.length}</h2>
      {awaiting.map((o:any)=><a key={o.id} className="work-mobile-list-item"
        href={`#/order/${o.id}`}><strong>№{o.number}</strong>
        <span>{o.unilateral_status==='disputed'?'Спор рассматривается':'Работа сдана — деньги не подтверждены'} ›</span></a>)}
    </section>}
    <nav className="work-mobile-shortcuts" aria-label="Рабочие разделы">
      <a href="#/work/jobs"><span aria-hidden="true">☷</span> Мои заявки</a>
      <a href="#/work/me/schedule"><span aria-hidden="true">▦</span> График</a>
      <a href="#/notifications"><span aria-hidden="true">♧</span> Уведомления</a>
      <a href="#/work/me/money"><span aria-hidden="true">₽</span> Финансы</a>
    </nav>
    {balance && <div className="work-mobile-balance note">
      <span>К выплате: <b>{rub(balance.to_pay)}</b></span>
      <span>Долг по комиссии с наличных: <b>{rub(balance.cash_debt)}</b></span>
      {balance.paused && <span className="err">Заявки приостановлены до урегулирования комиссии.</span>}
    </div>}
  </main>;
}

const BREAKS: [number, string][] = [[15, '15 мин'], [30, '30 мин'], [60, '1 час'], [120, '2 часа']];

/** Статус на линии, как в демо: Свободен / На звонке / Перерыв / Не на линии — и что сейчас по графику */
function LineCard({ p, busy, setLine, online, shareLocation = true }: { p: any; busy: boolean; setLine: (s: string, until?: string) => void; online: boolean; shareLocation?:boolean }) {
  const [open, setOpen] = useState(false);
  const [breakOpen, setBreakOpen] = useState(false);
  const sl = scheduleSlot(p.schedule, new Date(), p.off_schedule_until);
  const onJob = p.line_status === 'on_job';
  const statuses: [string, string, string][] = [
    ['online', 'Свободен', 'Принимать новые заявки'],
    ['on_call', 'На звонке', 'Видны клиентам, но ниже в очереди'],
    ['offline', 'Не на линии', 'Не получать новые заявки'],
  ];
  const current = onJob ? 'На выезде' : p.line_status === 'busy' ? 'Перерыв' : statuses.find(([id]) => id === p.line_status)?.[1] ?? LINE[p.line_status] ?? 'Статус';
  const choose = (id: string, until?: string) => { setLine(id, until); setOpen(false); setBreakOpen(false); };
  return (
    <div className="card">
      <button type="button" className="linkrow" aria-expanded={open} aria-controls="performer-line-options" disabled={busy || onJob} onClick={() => { setOpen(!open); setBreakOpen(false); }}>
        <span><b>Статус · {current}</b><small>{onJob ? 'Во время выезда статус изменить нельзя' : 'Нажмите, чтобы изменить доступность'}</small></span>
        <span aria-hidden="true">{open ? '⌃' : '⌄'}</span>
      </button>
      {open && !onJob && (
        <div id="performer-line-options" className="stack" style={{ gap: 6 }}>
          {statuses.map(([id, name, hint]) => (
            <button key={id} className="opt" aria-pressed={p.line_status === id} disabled={busy} onClick={() => choose(id)}>
              <b>{name}</b><small>{hint}</small>
            </button>
          ))}
          <button className="opt" aria-pressed={p.line_status === 'busy'} disabled={busy} onClick={() => setBreakOpen(!breakOpen)}>
            <b>Перерыв{p.line_status === 'busy' && p.busy_until ? ` · до ${new Date(p.busy_until).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : ''}</b>
            <small>Выберите длительность перерыва</small>
          </button>
          {breakOpen && <div className="grid4">{BREAKS.map(([m, label]) => (
            <button key={m} className="seg" disabled={busy} onClick={() => choose('busy', new Date(Date.now() + m * 60_000).toISOString())}>{label}</button>
          ))}</div>}
          <span className="note">Три пропущенных вызова подряд — статус автоматически станет «Не на линии».</span>
        </div>
      )}
      <SearchSettingsLink p={p} />
      {shareLocation && online && <LocationSharing />}
    </div>
  );
}

/** Настройки заявок: выбираемые услуги, марки, оснащение и тарифы. Не выдавать их за самостоятельный поиск. */
function SearchSettingsLink({ p }: { p: any }) {
  const top = Object.entries(p.brands ?? {}).filter(([, v]) => v === 'excellent').map(([k]) => k);
  const off = Object.entries(p.brands ?? {}).filter(([, v]) => v === 'refuse').length;
  const sub = p.kind === 'tow' ? `сборы ${p.prep_minutes ?? 0} мин · цена за км`
    : [(p.specialties ?? []).map((x: string) => SERVICES[x]?.name ?? (x === 'consult' ? 'Консультации' : x)).join(', '),
      top.length ? `отлично: ${top.join(', ')}` : '', off ? `не берусь: ${off}` : ''].filter(Boolean).join(' · ');
  return (
    <button className="linkrow" onClick={() => go('work/filter')}>
      <span><b>Настройки заявок</b><small>{sub || 'Какие заявки принимать, с чем выезжаете и по каким тарифам'}</small></span><span aria-hidden="true">›</span>
    </button>
  );
}

function ScheduleNote({ p, sl }: { p: any; sl: string }) {
  const s = p.schedule;
  if (!s?.on) return <a className="note" href="#/work/me/schedule">Распорядок не задан — заявки идут, пока вы на линии. Задать рабочие дни и часы →</a>;
  const text = sl === 'work' ? (p.off_schedule_until && new Date(p.off_schedule_until) > new Date() ? 'Вы вышли на линию вне графика — до конца дня' : `Рабочее время: выезды ${s.from}–${s.to}`)
    : sl === 'phone' ? `На телефоне до ${s.phoneTo}: приходят только консультации` : 'Сейчас нерабочее время по графику — заявки не приходят';
  return <a className={`banner ${sl === 'work' ? 'good' : 'warn'}`} href="#/work/me/schedule" style={{ textDecoration: 'none', color: 'inherit' }}><span>{text}. Распорядок →</span></a>;
}

/** Тот же расчёт, что на сервере (domain/schedule.ts): по московскому времени */
export function scheduleSlot(s: any, now: Date, offUntil?: string | null): 'work' | 'phone' | 'off' {
  if (!s?.on) return 'work';
  if (offUntil && new Date(offUntil) > now) return 'work';
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const g = (t: string) => parts.find((x) => x.type === t)!.value;
  const day = g('weekday').toLowerCase().slice(0, 3);
  const min = Number(g('hour')) * 60 + Number(g('minute'));
  const m = (t: string) => { const [h, mm] = t.split(':').map(Number); return h * 60 + mm; };
  if (!s.days?.[day]) return 'off';
  if (min >= m(s.from) && min < m(s.to)) return 'work';
  if (min >= m(s.to) && min < Math.max(m(s.phoneTo), m(s.to))) return 'phone';
  return 'off';
}

/** Отправляем координаты раз в 30 секунд, пока экран открыт (в приложении — и в фоне) */
export function LocationSharing() {
  const [state, setState] = useState<'wait' | 'ok' | 'off'>('wait');
  let sandbox=false;
  try {sandbox=sessionStorage.getItem('traksos.sandboxMode')==='1';}catch{/* */ }
  const demo=sandbox||location.hash.startsWith('#/admin/test-center/');
  useEffect(() => {
    // A test role must NEVER request the administrator's physical GPS location.
    if(demo)return;
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
  }, [demo]);
  if(demo)return <span className="note">Тестовый режим: GPS устройства отключён, заявки и координаты только вымышленные.</span>;
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


/** На линии: открытых заявок рядом по вашему профилю и сколько свободных коллег к ним ближе */
function Nearby() {
  const n = useLoad(() => get('/api/performer/nearby'), [], (e) => e.type === 'order' || e.type === 'auction');
  if (!n.data) return null;
  return <span className="note">{n.data.openNearby ? `${n.data.openNearby} открыт${n.data.openNearby === 1 ? 'ая заявка' : 'ых заявок'} рядом` : 'Открытых заявок рядом нет'} · {n.data.ahead ? `${n.data.ahead} свободн${n.data.ahead === 1 ? 'ый коллега ближе' : 'ых коллег ближе'} вас` : 'вы ближе всех свободных'}</span>;
}
