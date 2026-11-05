// Кабинет исполнителя по разделам: профиль — отдельно, фильтр заявок — отдельно, деньги — отдельно.
// Каждый раздел — своя короткая страница со своей кнопкой «Сохранить», ничего не листается до конца.

import { useState } from 'react';
import { get, put, post, rub, fmtTime, fmtPhone } from '../api.ts';
import { BRANDS, BRAND_LEVELS, SERVICES } from '../dict.ts';
import { useLoad, useAction, useMe, go, Loading, Field, RubInput, Back } from '../ui.tsx';

const SPECIALTIES: { id: string; name: string }[] = [
  { id: 'electric', name: 'Электрика' }, { id: 'diag', name: 'Диагностика' }, { id: 'air', name: 'Пневма, тормоза' },
  { id: 'autonomy', name: 'Автономки' }, { id: 'tyre', name: 'Шиномонтаж' }, { id: 'consult', name: 'Консультации' },
];

/** Сохранить часть профиля: kind обязателен, остальное — только то, что меняем */
function useSave() {
  const { me, reload } = useMe();
  const { busy, run } = useAction();
  const kind = me?.performer?.kind ?? (me?.roles.includes('tow') ? 'tow' : 'master');
  const save = async (patch: Record<string, unknown>, text = 'Сохранено') => {
    const r = await run(() => put('/api/performer/profile', { kind, ...patch }), text);
    if (r) await reload();
    return r;
  };
  return { busy, save, kind };
}

// Профиль: список разделов ----------------------------------------------------

export function PerformerHub() {
  const { me } = useMe();
  const p = me?.performer;
  if (!p) return <PerformerOnboarding />;
  const cars = (p.cars?.length ? p.cars : p.car ? [p.car] : []) as any[];
  const rows: [string, string, string][] = [
    ['work/me/about', 'Кто вы', `${me?.name ?? 'Имя не указано'} · ${p.kind === 'tow' ? 'эвакуатор' : 'мастер'}`],
    ['work/me/phone', 'Телефон и вход', fmtPhone(me!.phone)],
    ['work/me/cars', p.kind === 'tow' ? 'Эвакуаторы' : 'Машины', cars.length ? `${cars.length} из 3 · сегодня: ${p.car?.brand ?? '—'} ${p.car?.plate ?? ''}` : 'не добавлены'],
    ['work/me/schedule', 'Распорядок', p.schedule?.on ? `${dayList(p.schedule.days)} · выезды ${p.schedule.from}–${p.schedule.to} · телефон до ${p.schedule.phoneTo}` : 'не задан — заявки идут, пока вы на линии'],
    ['work/me/tax', 'Налоговый статус', p.tax_status ? `${p.tax_status === 'ip' ? 'ИП' : 'Самозанятый'} · ИНН ${p.inn ?? '—'}` : 'не указан'],
    ['work/me/money', 'Финансы', 'баланс, начисления, списания, выплаты'],
    ['work/docs', 'Проверка и фото', p.verification === 'approved' ? 'пройдена' : p.submitted_at ? 'на проверке' : 'нужно пройти'],
    ['support', 'Поддержка', 'обращения и ответы'],
    ['profile', 'Аккаунт', 'кабинет клиента, выход'],
  ];
  return (
    <main>
      <div><h1>Профиль</h1><div className="sub">Всё по разделам — откройте нужный.</div></div>
      <div className="stack">
        {rows.map(([to, t, sub]) => (
          <button key={to} className="linkrow" onClick={() => go(to)}><span><b>{t}</b><small>{sub}</small></span><span aria-hidden="true">›</span></button>
        ))}
      </div>
    </main>
  );
}

/** Первый вход исполнителя: только то, без чего нельзя начать, — остальное потом в разделах */
function PerformerOnboarding() {
  const { me, reload } = useMe();
  const { busy, run } = useAction();
  const [kind, setKind] = useState(me?.roles.includes('tow') ? 'tow' : 'master');
  const [name, setName] = useState(me?.name ?? '');
  const [spec, setSpec] = useState<string[]>(['electric']);
  const [car, setCar] = useState({ brand: '', color: '', plate: '' });
  const [taxStatus, setTax] = useState('');
  const [inn, setInn] = useState('');
  const isTow = kind === 'tow';
  async function save() {
    const body: any = { kind, name: name || undefined, taxStatus: taxStatus || null, inn: inn || null,
      cars: car.brand && car.plate ? [car] : [], car: car.brand && car.plate ? car : null };
    if (!isTow) body.specialties = spec;
    if (await run(() => put('/api/performer/profile', body), 'Профиль сохранён — теперь фото для проверки')) { await reload(); go('work/docs'); }
  }
  return (
    <main>
      <div><h1>Станьте исполнителем</h1><div className="sub">Четыре коротких шага. Марки, цены и остальное настроите потом в профиле.</div></div>
      <div className="step-card">
        <div className="step-head"><span className="step-n">1</span><b>Кто вы</b></div>
        <div className="grid2">
          <button type="button" className="seg" aria-pressed={kind === 'master'} onClick={() => setKind('master')}>Мастер</button>
          <button type="button" className="seg" aria-pressed={kind === 'tow'} onClick={() => setKind('tow')}>Эвакуатор</button>
        </div>
        <input className="field" placeholder="Имя, как увидят клиенты" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      {!isTow && (
        <div className="step-card">
          <div className="step-head"><span className="step-n">2</span><b>Что делаете</b></div>
          <div className="row">{SPECIALTIES.map((s) => (
            <button key={s.id} type="button" className="chip" aria-pressed={spec.includes(s.id)}
              onClick={() => setSpec(spec.includes(s.id) ? spec.filter((x) => x !== s.id) : [...spec, s.id])}>{s.name}</button>
          ))}</div>
        </div>
      )}
      <div className="step-card">
        <div className="step-head"><span className="step-n">{isTow ? 2 : 3}</span><b>{isTow ? 'Эвакуатор' : 'Машина, на которой приезжаете'}</b></div>
        <CarInputs car={car} onChange={setCar} tow={isTow} />
      </div>
      <div className="step-card">
        <div className="step-head"><span className="step-n">{isTow ? 3 : 4}</span><b>Налоговый статус</b></div>
        <TaxInputs taxStatus={taxStatus} inn={inn} onChange={(t, i) => { setTax(t); setInn(i); }} />
      </div>
      <button className="btn" disabled={busy || !name || (!isTow && !spec.length)} onClick={save}>Дальше — фото для проверки</button>
    </main>
  );
}

// Кто вы ----------------------------------------------------------------------

export function AboutSection() {
  const { me } = useMe();
  const p = me!.performer!;
  const { busy, save } = useSave();
  const [name, setName] = useState(me?.name ?? '');
  return (
    <main>
      <Back to="work/me" label="Профиль" />
      <h1>Кто вы</h1>
      <Field label="Имя, как увидят клиенты"><input className="field" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="card">
        <dl className="kv">
          <dt>Кто</dt><dd>{p.kind === 'tow' ? 'Эвакуатор' : 'Мастер'}</dd>
          <dt>Рейтинг</dt><dd>{me?.rating ? `★ ${Number(me.rating).toFixed(1)} · ${me.rating_count} оценок` : 'пока нет оценок'}</dd>
          <dt>Проверка</dt><dd>{p.verification === 'approved' ? 'Пройдена' : p.verification === 'rejected' ? 'Не пройдена' : 'Ещё не пройдена'}</dd>
        </dl>
        <span className="note">Услуги, марки и цены — в «Фильтре заявок».</span>
      </div>
      <button className="btn" disabled={busy || !name.trim()} onClick={() => save({ name: name.trim() })}>Сохранить</button>
    </main>
  );
}

// Телефон и вход --------------------------------------------------------------

export function PhoneSection() {
  const { me } = useMe();
  return (
    <main>
      <Back to="work/me" label="Профиль" />
      <h1>Телефон и вход</h1>
      <div className="card">
        <dl className="kv"><dt>Номер</dt><dd>{fmtPhone(me!.phone)}</dd></dl>
        <span className="note">Вход — по этому номеру и коду из SMS. Клиенты ваш номер не видят: звонки идут через ТракSOS.</span>
      </div>
      <a className="btn ghost" href="#/support/new">Сменить номер — через поддержку</a>
      <span className="note">Номер меняем только после проверки, что это вы: на нём ваши выплаты и рейтинг.</span>
    </main>
  );
}

// Машины ----------------------------------------------------------------------

function CarInputs({ car, onChange, tow }: { car: { brand: string; color?: string; plate: string }; onChange: (c: any) => void; tow?: boolean }) {
  return (
    <>
      <input className="field" placeholder={tow ? 'Марка эвакуатора: MAN TGS' : 'Марка: Lada Largus'} value={car.brand} onChange={(e) => onChange({ ...car, brand: e.target.value })} />
      <div className="grid2">
        <input className="field" placeholder="Цвет" value={car.color ?? ''} onChange={(e) => onChange({ ...car, color: e.target.value })} />
        <input className="field" placeholder="Госномер" value={car.plate} onChange={(e) => onChange({ ...car, plate: e.target.value.toUpperCase() })} />
      </div>
    </>
  );
}

export function CarsSection() {
  const { me } = useMe();
  const p = me!.performer!;
  const { busy, save } = useSave();
  const [cars, setCars] = useState<any[]>(p.cars?.length ? p.cars : p.car ? [p.car] : []);
  const [today, setToday] = useState<string>(p.car?.plate ?? cars[0]?.plate ?? '');
  const [add, setAdd] = useState({ brand: '', color: '', plate: '' });
  const tow = p.kind === 'tow';
  const commit = (list: any[], t: string) => save({ cars: list, car: list.find((c) => c.plate === t) ?? list[0] ?? null }, 'Машины сохранены');
  return (
    <main>
      <Back to="work/me" label="Профиль" />
      <div><h1>{tow ? 'Эвакуаторы' : 'Машины'}</h1><div className="sub">До трёх. Клиент видит ту, на которой вы сегодня, — и сверяет госномер, когда вы приедете.</div></div>
      {cars.map((c) => (
        <div key={c.plate} className={`card ${today === c.plate ? 'hi' : ''}`}>
          <div className="between"><b>{c.brand}{c.color ? `, ${c.color}` : ''}</b><span className="pill">{c.plate}</span></div>
          <div className="row">
            {today === c.plate ? <span className="pill good">Сегодня на ней</span>
              : <button className="btn ghost small" disabled={busy} onClick={async () => { if (await commit(cars, c.plate)) setToday(c.plate); }}>Сегодня на этой</button>}
            <button className="btn bad small" disabled={busy || cars.length === 1} onClick={async () => {
              const list = cars.filter((x) => x.plate !== c.plate);
              const t = today === c.plate ? list[0]?.plate ?? '' : today;
              if (await commit(list, t)) { setCars(list); setToday(t); }
            }}>Убрать</button>
          </div>
        </div>
      ))}
      {cars.length < 3 && (
        <div className="card">
          <b>Добавить {tow ? 'эвакуатор' : 'машину'}</b>
          <CarInputs car={add} onChange={setAdd} tow={tow} />
          <button className="btn" disabled={busy || !add.brand || !add.plate || cars.some((c) => c.plate === add.plate)} onClick={async () => {
            const list = [...cars, add];
            const t = today || add.plate;
            if (await commit(list, t)) { setCars(list); setToday(t); setAdd({ brand: '', color: '', plate: '' }); }
          }}>Добавить</button>
          {cars.length > 0 && <span className="note">Новую машину модератор может попросить подтвердить фото.</span>}
        </div>
      )}
    </main>
  );
}

// Распорядок -------------------------------------------------------------------

const WEEK: [string, string][] = [['mon', 'Пн'], ['tue', 'Вт'], ['wed', 'Ср'], ['thu', 'Чт'], ['fri', 'Пт'], ['sat', 'Сб'], ['sun', 'Вс']];
const dayList = (d: Record<string, boolean>) => WEEK.filter(([k]) => d?.[k]).map(([, n]) => n).join(', ') || 'нет рабочих дней';
const TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);

export function ScheduleSection() {
  const { me } = useMe();
  const p = me!.performer!;
  const { busy, run } = useAction();
  const { reload } = useMe();
  const [s, setS] = useState(() => p.schedule ?? { on: true, days: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false }, from: '09:00', to: '18:00', phoneTo: '20:00' });
  const sel = (v: string, on: (x: string) => void, min?: string) => (
    <select className="field" value={v} onChange={(e) => on(e.target.value)}>{TIMES.filter((t) => !min || t >= min).map((t) => <option key={t} value={t}>{t}</option>)}</select>
  );
  return (
    <main>
      <Back to="work/me" label="Профиль" />
      <div><h1>Распорядок</h1><div className="sub">По нему решаем, звонить ли вам. Кончилось рабочее время — статус сам станет «Не на линии», пока вы не выйдете на линию вручную.</div></div>
      <button className="opt" aria-pressed={s.on} onClick={() => setS({ ...s, on: !s.on })}>
        <b>{s.on ? '✓ Работаю по графику' : 'Без графика'}</b><small>{s.on ? 'Заявки — только в рабочие дни и часы' : 'Заявки идут всегда, пока вы на линии'}</small>
      </button>
      {s.on && (
        <>
          <div className="card">
            <b>Рабочие дни</b>
            <div className="grid7">{WEEK.map(([k, n]) => (
              <button key={k} className="seg" style={{ fontSize: 13, padding: 0 }} aria-pressed={!!s.days[k]} onClick={() => setS({ ...s, days: { ...s.days, [k]: !s.days[k] } })}>{n}</button>
            ))}</div>
          </div>
          <div className="card">
            <b>Выезды</b>
            <div className="grid2">{sel(s.from, (v) => setS({ ...s, from: v }))}{sel(s.to, (v) => setS({ ...s, to: v, phoneTo: s.phoneTo < v ? v : s.phoneTo }), s.from)}</div>
            <span className="note">В эти часы приходят все заявки.</span>
            <b>На телефоне до</b>
            {sel(s.phoneTo, (v) => setS({ ...s, phoneTo: v }), s.to)}
            <span className="note">После выездов и до этого времени — только консультации по телефону. Не нужно — поставьте то же время, что конец выездов.</span>
          </div>
          <div className="card flat">
            <span className="note">Обед или заправка — статус «Перерыв» на «Линии»: 15 минут – 2 часа, потом снова «Свободен» сам.</span>
          </div>
        </>
      )}
      <button className="btn" disabled={busy} onClick={async () => { if (await run(() => put('/api/performer/schedule', s), 'Распорядок сохранён')) reload(); }}>Сохранить</button>
    </main>
  );
}

// Налоги ----------------------------------------------------------------------

function TaxInputs({ taxStatus, inn, onChange }: { taxStatus: string; inn: string; onChange: (t: string, i: string) => void }) {
  return (
    <>
      <span className="note">Площадка работает как агент: принимает оплату за вас и перечисляет её. Нужен статус самозанятого или ИП.</span>
      <div className="grid2">
        <button type="button" className="seg" aria-pressed={taxStatus === 'self_employed'} onClick={() => onChange('self_employed', inn)}>Самозанятый</button>
        <button type="button" className="seg" aria-pressed={taxStatus === 'ip'} onClick={() => onChange('ip', inn)}>ИП</button>
      </div>
      <input className="field" inputMode="numeric" placeholder="ИНН, 12 цифр" maxLength={12} value={inn} onChange={(e) => onChange(taxStatus, e.target.value.replace(/\D/g, ''))} />
    </>
  );
}

export function TaxSection() {
  const { me } = useMe();
  const p = me!.performer!;
  const { busy, save } = useSave();
  const [taxStatus, setTax] = useState(p.tax_status ?? '');
  const [inn, setInn] = useState(p.inn ?? '');
  return (
    <main>
      <Back to="work/me" label="Профиль" />
      <h1>Налоговый статус</h1>
      <div className="card">
        <TaxInputs taxStatus={taxStatus} inn={inn} onChange={(t, i) => { setTax(t); setInn(i); }} />
        <span className="note">Самозанятый выдаёт чек в «Мой налог» на наличные сам. По безналу чеки и отчёт агента формирует ТракSOS — раз в месяц.</span>
      </div>
      <button className="btn" disabled={busy || !taxStatus || inn.length !== 12} onClick={() => save({ taxStatus, inn })}>Сохранить</button>
    </main>
  );
}

// Финансы ---------------------------------------------------------------------

/** Что за операция — простыми словами */
const KIND: Record<string, [string, string]> = {
  earning: ['Начислено за заявку', 'Сумма работы и выезда за вычетом комиссии ТракSOS'],
  payout: ['Выплата вам', 'Перевод на ваш счёт'],
  adjustment: ['Корректировка', 'Начисление или списание администратором — причина в комментарии'],
  refund_charge: ['Удержание за возврат', 'Клиенту вернули деньги по заявке — ваша доля удержана'],
  cash_commission: ['Комиссия с наличных', 'Клиент заплатил вам наличными — комиссия ТракSOS к оплате'],
  cash_commission_paid: ['Комиссия оплачена', 'Долг по комиссии с наличных погашен'],
};

export function MoneySection() {
  const balance = useLoad(() => get('/api/performer/balance'), [], (e) => e.type === 'balance' || e.type === 'order');
  const ledger = useLoad(() => get('/api/performer/ledger'), [], (e) => e.type === 'balance' || e.type === 'order');
  const [ask, setAsk] = useState<number | null>(null);
  return (
    <main>
      <Back to="work/me" label="Профиль" />
      <div><h1>Финансы</h1><div className="sub">Каждое движение денег — с причиной и заявкой. Непонятно — задайте вопрос прямо по операции.</div></div>
      {balance.data && (
        <div className="card">
          <div className="sum total"><span>К выплате</span><span>{rub(balance.data.to_pay)}</span></div>
          <div className="sum"><span>Уже выплачено</span><span>{rub(balance.data.paid)}</span></div>
          <div className="sum"><span>Долг по комиссии с наличных</span><span>{rub(balance.data.cash_debt)}</span></div>
          {balance.data.paused && <span className="err">Долг больше {rub(balance.data.cashDebtLimit)} — новые заявки на паузе до оплаты.</span>}
          <span className="note">ТракSOS работает как агент: отчёт агента и акт — раз в месяц.</span>
        </div>
      )}
      <span className="label">Операции</span>
      {!ledger.data ? <Loading error={ledger.error} /> : !ledger.data.length ? <div className="empty">Операций пока нет — появятся после первой заявки</div> : (
        <div className="stack">
          {ledger.data.map((e: any) => {
            const [title, hint] = KIND[e.kind] ?? [e.kind, ''];
            return (
              <div key={e.id} className="card" style={{ gap: 6 }}>
                <div className="between">
                  <b>{title}</b>
                  <b style={{ color: e.amount >= 0 ? 'var(--good-fg)' : 'var(--fg)' }}>{e.amount >= 0 ? '+' : '−'}{rub(Math.abs(e.amount))}</b>
                </div>
                <span className="note">
                  {fmtTime(e.created_at)} · операция №{e.id}
                  {e.order_number ? <> · <a href={`#/order/${e.order_id}`}>заявка №{e.order_number}{e.service ? ` · ${SERVICES[e.service]?.name ?? ''}` : ''}</a></> : null}
                </span>
                <span className="note" style={{ color: 'var(--fg-2)' }}>{e.note || hint}</span>
                {e.ticket_id ? <a className="btn ghost small" href={`#/support/${e.ticket_id}`}>Ваш вопрос по операции →</a>
                  : ask === e.id ? <AskAbout entryId={e.id} onDone={(id) => go(`support/${id}`)} onCancel={() => setAsk(null)} />
                  : <button className="btn ghost small" onClick={() => setAsk(e.id)}>Вопрос по операции</button>}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

function AskAbout({ entryId, onDone, onCancel }: { entryId: number; onDone: (ticketId: string) => void; onCancel: () => void }) {
  const { busy, run } = useAction();
  const [text, setText] = useState('');
  return (
    <div className="stack" style={{ gap: 8 }}>
      <textarea className="field" placeholder="Что непонятно: за что списали, почему такая сумма…" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="grid2">
        <button className="btn small" disabled={busy || text.trim().length < 3} onClick={async () => {
          const r = await run(() => post('/api/support', { topic: 'Вопрос по операции', text, ledgerEntryId: entryId }), 'Вопрос отправлен — поддержка видит эту операцию');
          if (r) onDone(r.id);
        }}>Отправить</button>
        <button className="btn ghost small" onClick={onCancel}>Отмена</button>
      </div>
    </div>
  );
}

// Фильтр заявок ---------------------------------------------------------------

export function FilterSection() {
  const { me } = useMe();
  const p = me?.performer;
  const pricing = useLoad(() => get('/api/pricing'), []);
  const { busy, save } = useSave();
  const [f, setF] = useState(() => ({
    specialties: (p?.specialties ?? ['electric']) as string[],
    brands: (p?.brands ?? {}) as Record<string, string>,
    tier: p?.tier ?? 'eco',
    callOutPrice: (p?.call_out_price ?? null) as number | null,
    hourPrice: (p?.hour_price ?? null) as number | null,
    kmRate: (p?.km_rate ?? null) as number | null,
    prepMinutes: p?.prep_minutes ?? 0,
    acceptsGroup: p?.accepts_group ?? true,
  }));
  const [tab, setTab] = useState<'services' | 'brands' | 'prices'>('services');
  if (!p) return <PerformerOnboarding />;
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  const isTow = p.kind === 'tow';
  const corridor = pricing.data?.tiers;
  const tuned = Object.values(f.brands).filter((v) => v !== 'good').length;
  const body = () => isTow
    ? { kmRate: f.kmRate, prepMinutes: f.prepMinutes }
    : { specialties: f.specialties, brands: f.brands, tier: f.tier, callOutPrice: f.callOutPrice, hourPrice: f.hourPrice, kmRate: f.kmRate, acceptsGroup: f.acceptsGroup };
  const tabs = isTow ? [['prices', 'Цены и подача']] as const : [['services', 'Услуги'], ['brands', `Марки${tuned ? ` · ${tuned}` : ''}`], ['prices', 'Цены']] as const;
  const cur = isTow ? 'prices' : tab;
  return (
    <main>
      <Back to="work" label="Линия" />
      <div><h1>Расширенный поиск</h1><div className="sub">Как вы ищете клиентов на линии: что берёте, с какими марками и по какой цене. По этому вас и ранжируют.</div></div>
      {tabs.length > 1 && <div className="grid3">{tabs.map(([id, n]) => <button key={id} className="seg" style={{ fontSize: 13 }} aria-pressed={cur === id} onClick={() => setTab(id as any)}>{n}</button>)}</div>}

      {cur === 'services' && (
        <div className="card">
          <b>Что делаете</b>
          <div className="row">{SPECIALTIES.map((s) => (
            <button key={s.id} type="button" className="chip" aria-pressed={f.specialties.includes(s.id)}
              onClick={() => set({ specialties: f.specialties.includes(s.id) ? f.specialties.filter((x) => x !== s.id) : [...f.specialties, s.id] })}>{s.name}</button>
          ))}</div>
          <b>Уровень</b>
          <div className="grid3">
            {(['eco', 'comfort', 'pro'] as const).map((t) => (
              <button key={t} type="button" className="seg" style={{ fontSize: 13 }} aria-pressed={f.tier === t} onClick={() => set({ tier: t })}>{t === 'eco' ? 'Стандарт' : t === 'comfort' ? 'Комфорт' : 'Диагност'}</button>
            ))}
          </div>
          <button type="button" className="opt" aria-pressed={f.acceptsGroup} onClick={() => set({ acceptsGroup: !f.acceptsGroup })}>
            <b>{f.acceptsGroup ? '✓ ' : ''}Беру совместные выезды</b><small>Клиенты платят по 70%, вы получаете больше с одной поездки.</small>
          </button>
        </div>
      )}

      {cur === 'brands' && (
        <div className="card">
          <b>Как работаете с марками</b>
          <span className="note">По умолчанию — «Хорошо». «Не берусь» — такие заявки не придут, «Отлично» — придут вам первыми.</span>
          <div className="rows">
            {BRANDS.filter((b) => b !== 'Прочие').map((b) => (
              <div key={b} className="brand-row">
                <span>{b}</span>
                <select className="field" value={f.brands[b] ?? 'good'} onChange={(e) => set({ brands: { ...f.brands, [b]: e.target.value } })}>
                  {BRAND_LEVELS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {cur === 'prices' && (
        <div className="card">
          {!isTow && (
            <div className="grid2">
              <Field label="Выезд по городу"><RubInput value={f.callOutPrice} onChange={(v) => set({ callOutPrice: v })} placeholder={corridor ? rub(corridor[f.tier].callOut) : ''} /></Field>
              <Field label="Час работы"><RubInput value={f.hourPrice} onChange={(v) => set({ hourPrice: v })} placeholder={corridor ? rub(corridor[f.tier].hour) : ''} /></Field>
            </div>
          )}
          {!isTow && <span className="note">Пусто — цена уровня по умолчанию. Коридор площадки: 1 500–7 000 ₽.</span>}
          <Field label="За КАД, ₽ за км" hint="Считается расстояние × 1,5 — дорога туда и половина обратно.">
            <RubInput value={f.kmRate} onChange={(v) => set({ kmRate: v })} placeholder={isTow ? '110 ₽' : '50 ₽'} />
          </Field>
          {isTow && (
            <Field group label="Время на сборы" hint="Клиент видит подачу = сборы + дорога.">
              <div className="scroll-x">{[0, 15, 30, 45, 60].map((m) => (
                <button key={m} type="button" className="chip" aria-pressed={f.prepMinutes === m} onClick={() => set({ prepMinutes: m })}>{m} мин</button>
              ))}</div>
            </Field>
          )}
        </div>
      )}

      <button className="btn" disabled={busy || (!isTow && !f.specialties.length)} onClick={() => save(body(), 'Поиск настроен — заявки подберём по нему')}>Сохранить</button>
    </main>
  );
}
