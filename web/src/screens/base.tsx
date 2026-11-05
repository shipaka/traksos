// Рембаза (сервис-партнёр): кабинет сервиса и запись клиента в сервис.
import { useEffect, useState } from 'react';
import { get, post, put, rub, fmtTime } from '../api.ts';
import { BRANDS } from '../dict.ts';
import { useLoad, useAction, useMe, go, Loading, Field, Back, RubInput } from '../ui.tsx';

export const NEEDS: Record<string, string> = {
  electric: 'Электрика', air: 'Пневматика', engine: 'Двигатель', gearbox: 'КПП', brakes: 'Тормоза',
  chassis: 'Ходовая', tires: 'Шины', ecu: 'Блоки управления', heater: 'Автономка', other: 'Другое',
};
const CONDITIONS: Record<string, string> = { parking: 'Стоянка для фуры', pit: 'Яма', lift: 'Подъёмник', night: 'Ночная работа' };
const ACCEPTS: Record<string, [string, string]> = {
  quick: ['Быстрый ремонт', 'в течение 1–2 часов'], day: ['В течение суток', 'поставим в очередь'], long: ['Длительный ремонт', 'машина может стоять у нас'],
};
const STAFF: Record<string, string> = { own: 'Есть у нас', invite: 'Приглашаем', none: 'Нет' };
const REPAIR: [string, string][] = [['arrived', 'Машина приехала'], ['diagnostics', 'Диагностика'], ['in_work', 'В работе'], ['waiting_part', 'Ждём запчасть'], ['agreeing', 'Согласуем с клиентом']];
const WORKS = ['Диагностика', 'Электрика', 'Пневматика', 'Двигатель', 'КПП', 'Тормоза', 'Ходовая', 'Шины', 'Сварка', 'Замена масла и фильтров'];
const DECLINE = ['Нет такого специалиста', 'Нет мест', 'Не работаем с этой маркой'];
const CLARIFY = ['Нужно подробнее о поломке', 'Своим ходом или на эвакуаторе?', 'Нужен госномер прицепа'];
const TONE: Record<string, string> = {
  new: 'accent', clarify: 'warn', declined: 'bad', expected: 'accent', arrived: 'accent', diagnostics: 'accent', in_work: 'accent',
  waiting_part: 'warn', agreeing: 'warn', ready: 'good', invoiced: 'good', closed: '', disputed: 'bad', cancelled: '',
};
const POP: Record<string, string> = { top: 'Обращаются чаще всех', often: 'Обращаются часто', rare: 'Обращаются реже', new: 'Новый на ТракSOS' };

const query = () => new URLSearchParams(location.hash.split('?')[1] ?? '');
const mskDay = (shift = 0) => new Date(Date.now() + 3 * 3600_000 + shift * 86400_000).toISOString().slice(0, 10);
const fmtDay = (d: string) => { const [y, m, dd] = d.slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' }); };
const carName = (v: any) => [v?.brand, v?.model, v?.year].filter(Boolean).join(' ') || 'Машина';
const toggle = (list: string[], x: string) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);
const isBookingEvent = (e: any) => e.type === 'booking';

// ═══════════════════════ Кабинет рембазы ═══════════════════════

export function BaseHome() {
  const cab = useLoad(() => get('/api/base'), [], isBookingEvent);
  const [tab, setTab] = useState<'req' | 'cars' | 'done'>('req');
  const { busy, run } = useAction();
  if (!cab.data) return <main><Loading error={cab.error} /></main>;
  const { center, groups } = cab.data;
  if (!center) return <BaseSetup first />;
  const cars = [...groups.expected, ...groups.repair, ...groups.ready];
  return (
    <main>
      <div>
        <h1>Рембаза «{center.name}»</h1>
        <div className="sub">{center.address} · {center.hours}</div>
      </div>
      {center.verification !== 'approved' && (
        <div className="banner warn col">
          <b>{center.verification === 'rejected' ? 'Проверка не пройдена' : 'Пройдите проверку ТракSOS'}</b>
          <span className="note">ИНН компании, вывеска и въезд, ремзона, ответственное лицо. Пока проверка не пройдена, клиенты вас на карте не видят.</span>
          <a className="btn ghost small" href="#/support/new">Написать модератору</a>
        </div>
      )}
      {center.paused && <div className="banner warn col"><b>Приём временно закрыт</b><span className="note">Клиенты видят «приём закрыт». Включить — в карточке сервиса.</span></div>}
      {center.closedToday && <div className="banner col"><b>Сегодня вы закрыты</b><span className="note">Записаться на сегодня нельзя — только на другие дни.</span></div>}
      {center.confirmDue && (
        <div className="card">
          <b>Раз в неделю: приём всё так же, как отмечено?</b>
          <span className="note">{center.accepts.map((a: string) => ACCEPTS[a]?.[0]).join(' · ') || 'не отмечено'}</span>
          <div className="grid2">
            <button className="btn" disabled={busy} onClick={async () => { if (await run(() => post('/api/base/confirm-accepts'), 'Спасибо, следующий вопрос — через неделю')) cab.reload(); }}>Да, всё так</button>
            <button className="btn ghost" onClick={() => go('base/me')}>Изменить</button>
          </div>
        </div>
      )}
      <div className="grid3">
        <div className="card tile"><span className="label">Запросы</span><span className="tile-value">{groups.requests.length}</span></div>
        <div className="card tile"><span className="label">Ожидаем</span><span className="tile-value">{groups.expected.length}</span></div>
        <div className="card tile"><span className="label">В ремонте</span><span className="tile-value">{groups.repair.length}</span></div>
      </div>
      <div className="scroll-x" role="tablist">
        {([['req', `Входящие запросы · ${groups.requests.length}`], ['cars', `Машины у вас · ${cars.length}`], ['done', 'Закрытые']] as const).map(([k, n]) => (
          <button key={k} className="chip" role="tab" aria-pressed={tab === k} onClick={() => setTab(k)}>{n}</button>
        ))}
      </div>
      {tab === 'req' && (groups.requests.length
        ? groups.requests.map((b: any) => <RequestCard key={b.id} b={b} onDone={cab.reload} />)
        : <div className="empty">Новых запросов нет. Они приходят уведомлением — со звуком, даже когда приложение закрыто.</div>)}
      {tab === 'cars' && (cars.length ? (
        <div className="rows">
          {cars.map((b: any) => (
            <a key={b.id} href={`#/base/car/${b.id}`} className="list-item">
              <div className="stack" style={{ gap: 2 }}>
                <b>{carName(b.vehicle)} · {b.vehicle?.plate ?? 'без номера'}</b>
                <span className="note">{b.client?.name} · {b.needName} · {b.status === 'expected' ? `ожидаем ${fmtDay(b.whenDay)}${b.acceptTime ? ` к ${b.acceptTime}` : ''}` : b.daysInRepair ? `в ремонте ${b.daysInRepair} дн.` : ''}</span>
                {b.stillHereDue && <span className="note" style={{ color: 'var(--warn)' }}>Отметьте: машина ещё у вас?</span>}
              </div>
              <span className={`pill ${TONE[b.status]}`}>{b.statusName}</span>
            </a>
          ))}
          <span className="note">Нажмите на машину — откроется её карточка: статус, заметки, компания, история.</span>
        </div>
      ) : <div className="empty">Машин у вас пока нет. После «Готовы принять» машина появится здесь в «Ожидаем».</div>)}
      {tab === 'done' && (groups.done.length ? (
        <div className="rows">
          {groups.done.map((b: any) => (
            <a key={b.id} href={`#/base/car/${b.id}`} className="list-item">
              <div className="stack" style={{ gap: 2 }}><b>{carName(b.vehicle)} · {b.vehicle?.plate ?? ''}</b><span className="note">{fmtTime(b.createdAt)} · {b.needName}{b.amount ? ` · ${rub(b.amount)}` : ''}</span></div>
              <span className={`pill ${TONE[b.status]}`}>{b.statusName}</span>
            </a>
          ))}
        </div>
      ) : <div className="empty">За 30 дней закрытых нет</div>)}
    </main>
  );
}

function RequestCard({ b, onDone }: { b: any; onDone: () => void }) {
  const { busy, run } = useAction();
  const [mode, setMode] = useState<'' | 'accept' | 'clarify' | 'decline'>('');
  const [time, setTime] = useState(b.whenTime ?? '');
  const [q, setQ] = useState('');
  const respond = async (body: any, okText: string) => { if (await run(() => post(`/api/base/bookings/${b.id}/respond`, body), okText)) { setMode(''); onDone(); } };
  return (
    <div className="card hi">
      <div className="between"><b>Новый запрос · {fmtTime(b.createdAt)}</b><span className={`pill ${TONE[b.status]}`}>{b.statusName}</span></div>
      <dl className="kv">
        <dt>Машина</dt><dd>{carName(b.vehicle)}{b.vehicle?.plate ? ` · ${b.vehicle.plate}` : ''}{b.vehicle?.trailerPlate ? ` · прицеп ${b.vehicle.trailerPlate}` : ''}</dd>
        <dt>Нужно</dt><dd>{b.needName}</dd>
        <dt>Когда</dt><dd>{fmtDay(b.whenDay)}{b.whenTime ? `, к ${b.whenTime}` : ''}</dd>
        <dt>Как приедет</dt><dd>{b.arrival === 'tow' ? 'На эвакуаторе' : 'Своим ходом'}</dd>
        <dt>Клиент</dt><dd>{b.client?.name}{b.client?.rating ? ` · ★ ${b.client.rating.toFixed(1)}` : ''}</dd>
        {b.fromOrder && <><dt>Откуда</dt><dd>По совету мастера ТракSOS</dd></>}
      </dl>
      {b.comment && <span className="note">«{b.comment}»</span>}
      {b.status === 'clarify' && <span className="note">Вы спросили: «{b.clarifyQ}» — ждём ответа клиента</span>}
      {b.clientAnswer && <span className="note" style={{ color: 'var(--fg)' }}>Клиент ответил: «{b.clientAnswer}»</span>}
      {mode === '' && (
        <div className="grid3">
          <button className="btn" disabled={busy} onClick={() => setMode('accept')}>Готовы принять</button>
          <button className="btn ghost" disabled={busy} onClick={() => setMode('clarify')}>Уточнить</button>
          <button className="btn ghost" disabled={busy} onClick={() => setMode('decline')}>Не можем</button>
        </div>
      )}
      {mode === 'accept' && (
        <div className="stack">
          <Field label="Во сколько ждёте" hint="Клиенту придут адрес и маршрут."><input className="field" placeholder="например, 15:00" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
          <div className="grid2">
            <button className="btn" disabled={busy} onClick={() => respond({ action: 'accept', time: time || undefined }, 'Машина добавлена в «Ожидаем»')}>Отправить клиенту</button>
            <button className="btn ghost" onClick={() => setMode('')}>Назад</button>
          </div>
        </div>
      )}
      {mode === 'clarify' && (
        <div className="stack">
          <span className="label">Что уточнить у клиента?</span>
          {CLARIFY.map((x) => <button key={x} className="opt" disabled={busy} onClick={() => respond({ action: 'clarify', q: x }, `Клиенту отправлено: «${x}»`)}>{x}</button>)}
          <input className="field" placeholder="Свой вопрос" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="grid2">
            <button className="btn" disabled={busy || q.trim().length < 3} onClick={() => respond({ action: 'clarify', q }, `Клиенту отправлено: «${q}»`)}>Спросить</button>
            <button className="btn ghost" onClick={() => setMode('')}>Назад</button>
          </div>
        </div>
      )}
      {mode === 'decline' && (
        <div className="stack">
          <span className="label">Причина — клиенту предложим другие сервисы рядом</span>
          {DECLINE.map((x) => <button key={x} className="opt" disabled={busy} onClick={() => respond({ action: 'decline', reason: x }, 'Клиенту: предложим другие сервисы')}>{x}</button>)}
          <button className="btn ghost" onClick={() => setMode('')}>Назад</button>
        </div>
      )}
    </div>
  );
}

/** Карточка машины в сервисе: статус (клиент видит сразу), заметки, компания, история, «Машина готова → счёт» */
export function BaseCar({ id }: { id: string }) {
  const b = useLoad(() => get(`/api/bookings/${id}`), [id], isBookingEvent);
  const { busy, run } = useAction();
  const [note, setNote] = useState('');
  const [works, setWorks] = useState<string[] | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [company, setCompany] = useState<any>(null);
  const d = b.data;
  if (!d) return <main><Back to="base" label="Рембаза" /><Loading error={b.error} /></main>;
  const act = async (path: string, body: any, okText: string) => { const r = await run(() => post(`/api/base/bookings/${id}/${path}`, body), okText); if (r) b.setData(r); return r; };
  const inRepair = REPAIR.some(([s]) => s === d.status);
  return (
    <main>
      <Back to="base" label="Рембаза" />
      <div>
        <h1>{carName(d.vehicle)}</h1>
        <div className="sub">Госномер {d.vehicle?.plate ?? '—'}{d.vehicle?.trailerPlate ? ` · прицеп ${d.vehicle.trailerPlate}` : ''} · чтобы узнать машину на въезде</div>
      </div>
      <div className="card">
        <dl className="kv">
          <dt>Приехал</dt><dd>{d.needName}{d.comment ? ` — «${d.comment}»` : ''}</dd>
          <dt>Как</dt><dd>{d.arrival === 'tow' ? 'На эвакуаторе' : 'Своим ходом'}</dd>
          <dt>{d.status === 'expected' ? 'Ожидаем' : 'Записан'}</dt><dd>{fmtDay(d.whenDay)}{(d.acceptTime || d.whenTime) ? ` к ${d.acceptTime || d.whenTime}` : ''}</dd>
          {d.arrivedAt && <><dt>В ремонте с</dt><dd>{fmtTime(d.arrivedAt)} · {d.daysInRepair} дн.</dd></>}
          <dt>Клиент</dt><dd>{d.client?.name}</dd>
        </dl>
        <button className="btn ghost small" disabled={busy} onClick={async () => setCompany(company ? null : await run(() => get(`/api/base/bookings/${id}/company`), null))}>{company ? 'Скрыть карточку компании' : 'Карточка компании'}</button>
        {company && (
          <div className="stack" style={{ gap: 6 }}>
            <dl className="kv">
              {company.inn && <><dt>ИНН</dt><dd>{company.inn}</dd></>}
              <dt>Рейтинг</dt><dd>{company.rating ? `★ ${company.rating.toFixed(1)} · ${company.ratingCount} оценок` : 'пока без оценок'}</dd>
              <dt>На площадке</dt><dd>с {fmtTime(company.since)}</dd>
              <dt>Парк</dt><dd>{company.park} маш.</dd>
              <dt>Ремонтов в сервисах</dt><dd>{company.closedRepairs}{company.disputes ? ` · споров: ${company.disputes}` : ''}</dd>
            </dl>
            {company.cars.length > 1 && <><span className="label">Машины компании у вас</span>{company.cars.map((c: any) => <a key={c.id} href={`#/base/car/${c.id}`} className="note">{carName(c.vehicle)} · {c.vehicle?.plate ?? ''} · {c.statusName}</a>)}</>}
            <span className="note">Суммы и расходы компании не видны — только то, что нужно для работы.</span>
          </div>
        )}
      </div>

      {d.status === 'expected' && (
        <div className="grid2">
          <button className="btn" disabled={busy} onClick={() => act('status', { status: 'arrived' }, 'Клиент видит: машина приехала')}>Машина приехала</button>
          <button className="btn ghost" disabled={busy} onClick={async () => { if (await act('respond', { action: 'undo' }, 'Ответ отменён')) go('base'); }}>Отменить ответ</button>
        </div>
      )}
      {inRepair && (
        <div className="card">
          <span className="label">Статус ремонта — клиент видит сразу</span>
          <div className="scroll-x">
            {REPAIR.map(([s, n]) => <button key={s} className="chip" aria-pressed={d.status === s} disabled={busy} onClick={() => d.status !== s && act('status', { status: s }, `Статус: ${n}`)}>{n}</button>)}
          </div>
          {d.fromOrder && (d.stillHereDue
            ? <div className="banner warn col"><b>По совету мастера · в ремонте {d.daysInRepair} дн.</b><span className="note">Раз в неделю отметьте: машина ещё у вас?</span><button className="btn small" disabled={busy} onClick={() => act('still-here', {}, 'Отмечено: ещё в ремонте, продлено на 7 дней')}>Да, ещё у нас</button></div>
            : <span className="note">Клиент пришёл по совету мастера — скидка клиенту и бонус мастеру из комиссии ТракSOS, ваша выручка не меняется.</span>)}
        </div>
      )}

      {(inRepair || d.status === 'expected' || d.notes.length > 0) && (
        <div className="card">
          <span className="label">Заметки по машине</span>
          {d.notes.length ? d.notes.map((n: any, i: number) => <div key={i} className="note" style={{ color: 'var(--fg)' }}>{fmtTime(n.at)} · {n.text}</div>)
            : <span className="note">Пока пусто. Например: «заказали синхронизатор, будет в четверг».</span>}
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input className="field" placeholder="Дописать…" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="btn small" disabled={busy || !note.trim()} onClick={async () => { if (await act('note', { text: note }, 'Заметка добавлена')) setNote(''); }}>Добавить</button>
          </div>
          <label className="agree"><input type="checkbox" checked={d.notesPublic} onChange={(e) => act('note', { notesPublic: e.target.checked }, e.target.checked ? 'Клиент видит заметки' : 'Заметки скрыты от клиента')} /><span>Показывать заметки клиенту</span></label>
        </div>
      )}

      {inRepair && works === null && <button className="btn" onClick={() => setWorks(d.works?.length ? d.works : [])}>Машина готова — оформить работы</button>}
      {inRepair && works !== null && (
        <div className="card">
          <b>Что делали — коротко</b>
          <div className="row">{WORKS.map((w) => <button key={w} type="button" className="chip" aria-pressed={works.includes(w)} onClick={() => setWorks(toggle(works, w))}>{w}</button>)}</div>
          <span className="note">Галочки вместо описаний. Подробности — в заметках, по желанию. Клиент сверит перечень.</span>
          <div className="grid2">
            <button className="btn" disabled={busy || !works.length} onClick={async () => { if (await act('ready', { works }, 'Готово — клиент сверит работы')) setWorks(null); }}>Машина готова</button>
            <button className="btn ghost" onClick={() => setWorks(null)}>Назад</button>
          </div>
        </div>
      )}
      {d.status === 'ready' && (
        <div className="card">
          <b>Выставить счёт</b>
          <span className="note">Работы: {d.works.join(', ')}</span>
          <Field label="Сумма работ и запчастей"><RubInput value={amount} onChange={setAmount} placeholder="например, 12 000 ₽" /></Field>
          <span className="note">Счёт и акт формируются сами и уходят клиенту, компаниям — по ИНН. Деньги придут после оплаты и сверки работ.</span>
          <button className="btn" disabled={busy || !amount} onClick={() => act('invoice', { amount }, 'Агентский счёт сформирован')}>Выставить счёт</button>
        </div>
      )}
      {['invoiced', 'closed', 'disputed'].includes(d.status) && d.amount != null && (
        <div className="card">
          <b>{d.status === 'closed' ? 'Клиент подтвердил работы' : d.status === 'disputed' ? 'Клиент не согласен — модератор свяжется с обеими сторонами' : 'Агентский счёт сформирован · ждём сверки клиента'}</b>
          <dl className="kv">
            <dt>Работы</dt><dd>{d.works.length} поз. · {rub(d.amount)}</dd>
            <dt>Комиссия ТракSOS</dt><dd>− {rub(d.commission)}</dd>
            {d.discount > 0 && <><dt>Скидка клиенту</dt><dd>{rub(d.discount)} — из комиссии ТракSOS</dd></>}
            <dt>Вам к выплате</dt><dd><b>{rub(d.payout)}</b></dd>
          </dl>
          {d.reviewStars && <span className="note">Отзыв: {'★'.repeat(d.reviewStars)}{d.reviewText ? ` — «${d.reviewText}»` : ''}</span>}
        </div>
      )}

      {d.history.length > 0 && (
        <div className="card">
          <span className="label">История машины на ТракSOS — ваши работы и чужие, без сумм</span>
          <ol className="tl">{d.history.map((h: any, i: number) => <li key={i}><i className="ok" /><b>{h.what}</b><small>{fmtTime(h.at)} · {h.who}</small></li>)}</ol>
        </div>
      )}
    </main>
  );
}

/** Карточка сервиса: один раз — что принимаете, кто есть, условия, дни без работы */
export function BaseSetup({ first }: { first?: boolean }) {
  const { reload } = useMe();
  const cab = useLoad(() => get('/api/base'), []);
  const { busy, run } = useAction();
  const [f, setF] = useState<any>(null);
  const [day, setDay] = useState('');
  useEffect(() => {
    if (!cab.data || f) return;
    const c = cab.data.center;
    setF(c ? { name: c.name, address: c.address, hours: c.hours, inn: c.inn ?? '', lat: c.lat, lng: c.lng, brands: c.brands, staff: c.staff, conditions: c.conditions, accepts: c.accepts, closedDays: (c.closed_days ?? []).map((x: string) => x.slice(0, 10)), paused: c.paused }
      : { name: '', address: '', hours: '08:00–20:00', inn: '', lat: null, lng: null, brands: [], staff: { electric: 'own' }, conditions: ['parking'], accepts: ['quick', 'day'], closedDays: [], paused: false });
  }, [cab.data]); // eslint-disable-line
  if (!f) return <main><Loading error={cab.error} /></main>;
  const set = (k: string, v: any) => setF({ ...f, [k]: v });
  async function save() {
    const body = { ...f, inn: f.inn || null, closedDays: f.closedDays.filter((d: string) => d >= mskDay()) };
    if (await run(() => put('/api/base', body), first ? 'Карточка сохранена — осталось пройти проверку' : 'Карточка сервиса сохранена')) { await reload(); go('base'); }
  }
  function locate() {
    navigator.geolocation?.getCurrentPosition((p) => setF((x: any) => ({ ...x, lat: p.coords.latitude, lng: p.coords.longitude })), () => {}, { timeout: 8000 });
  }
  return (
    <main>
      {!first && <Back to="base" label="Рембаза" />}
      <div>
        <h1>{first ? 'Подключите рембазу' : 'Карточка сервиса'}</h1>
        <div className="sub">Один раз отметьте, что принимаете, кто у вас есть и условия. Цены не нужны: итог зависит от осмотра.</div>
      </div>
      <div className="card">
        <Field label="Название"><input className="field" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Например, Шушары-Трак" /></Field>
        <Field label="Адрес въезда"><input className="field" value={f.address} onChange={(e) => set('address', e.target.value)} placeholder="Шушары, Московское ш., 50" /></Field>
        <button type="button" className="btn ghost small" onClick={locate}>{f.lat ? `Место на карте отмечено · ${f.lat.toFixed(3)}, ${f.lng.toFixed(3)}` : 'Отметить место по GPS — вы сейчас на базе'}</button>
        <div className="grid2">
          <Field label="Часы работы"><input className="field" value={f.hours} onChange={(e) => set('hours', e.target.value)} /></Field>
          <Field label="ИНН компании"><input className="field" inputMode="numeric" value={f.inn} onChange={(e) => set('inn', e.target.value.replace(/\D/g, '').slice(0, 12))} /></Field>
        </div>
      </div>
      <div className="card">
        <b>Что принимаем</b>
        {Object.entries(ACCEPTS).map(([k, [n, h]]) => (
          <label key={k} className="agree"><input type="checkbox" checked={f.accepts.includes(k)} onChange={() => set('accepts', toggle(f.accepts, k))} /><span><b>{n}</b> — {h}</span></label>
        ))}
        <label className="agree"><input type="checkbox" checked={f.paused} onChange={(e) => set('paused', e.target.checked)} /><span><b>Приём временно закрыт</b> — клиенты видят, на карте вы серые</span></label>
      </div>
      <div className="card">
        <b>Кто у вас есть</b>
        {Object.entries(NEEDS).filter(([k]) => k !== 'other').map(([k, n]) => (
          <div key={k} className="stack" style={{ gap: 4 }}>
            <span>{n}</span>
            <div className="row" style={{ gap: 4 }}>
              {Object.entries(STAFF).map(([lv, ln]) => <button key={lv} type="button" className="chip" aria-pressed={(f.staff[k] ?? 'none') === lv} onClick={() => set('staff', { ...f.staff, [k]: lv })}>{ln}</button>)}
            </div>
          </div>
        ))}
        <span className="note">«Приглашаем» — специалист приезжает к вам по вызову. «Нет» — такие запросы к вам не придут.</span>
      </div>
      <div className="card">
        <b>Условия</b>
        <div className="row">{Object.entries(CONDITIONS).map(([k, n]) => <button key={k} type="button" className="chip" aria-pressed={f.conditions.includes(k)} onClick={() => set('conditions', toggle(f.conditions, k))}>{n}</button>)}</div>
        <b>Марки</b>
        <div className="row">{BRANDS.filter((x) => x !== 'Прочие').map((m) => <button key={m} type="button" className="chip" aria-pressed={f.brands.includes(m)} onClick={() => set('brands', toggle(f.brands, m))}>{m}</button>)}</div>
        <span className="note">Клиенту с этой маркой вас покажут выше.</span>
      </div>
      <div className="card">
        <b>Не работаем в эти дни</b>
        {f.closedDays.length ? <div className="row">{f.closedDays.map((d: string) => <button key={d} type="button" className="chip" aria-pressed onClick={() => set('closedDays', f.closedDays.filter((x: string) => x !== d))}>{fmtDay(d)} ✕</button>)}</div> : <span className="note">Пока нет — работаете по графику.</span>}
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input className="field" type="date" min={mskDay()} value={day} onChange={(e) => setDay(e.target.value)} />
          <button type="button" className="btn ghost small" disabled={!day || f.closedDays.includes(day)} onClick={() => { set('closedDays', [...f.closedDays, day].sort()); setDay(''); }}>Добавить</button>
        </div>
        <span className="note">Стоит, пока сами не поменяете. В эти дни записаться к вам нельзя.</span>
      </div>
      <button className="btn" disabled={busy || f.name.trim().length < 2 || f.address.trim().length < 3} onClick={save}>{first ? 'Сохранить и пройти проверку' : 'Сохранить'}</button>
    </main>
  );
}

// ═══════════════════════ Клиент: сервисы-партнёры ═══════════════════════

function useGps() {
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => { navigator.geolocation?.getCurrentPosition((p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude }), () => {}, { timeout: 6000, maximumAge: 300_000 }); }, []);
  return pos;
}

export function ServicesList() {
  const q = query();
  const [need, setNeed] = useState(q.get('need') ?? '');
  const from = q.get('from');
  const pos = useGps();
  const cars = useLoad(() => get('/api/vehicles'), []);
  const brand = cars.data?.[0]?.brand ?? '';
  const list = useLoad(() => get(`/api/services?${new URLSearchParams({ ...(pos ? { lat: String(pos.lat), lng: String(pos.lng) } : {}), ...(need ? { need } : {}), ...(brand ? { brand } : {}) })}`), [pos?.lat, need, brand]);
  return (
    <main>
      <Back to="" label="Главная" />
      <div>
        <h1>Сервисы-партнёры</h1>
        <div className="sub">Только ремзоны, с которыми ТракSOS договорился лично. Цену сервис скажет после осмотра.</div>
      </div>
      {from && <div className="banner col"><b>По совету мастера — скидка в сервисе</b><span className="note">Запишитесь отсюда — скидка применится в счёте сама.</span></div>}
      <div className="scroll-x">
        <button className="chip" aria-pressed={!need} onClick={() => setNeed('')}>Все</button>
        {Object.entries(NEEDS).filter(([k]) => k !== 'other').map(([k, n]) => <button key={k} className="chip" aria-pressed={need === k} onClick={() => setNeed(k)}>{n}</button>)}
      </div>
      {!list.data ? <Loading error={list.error} /> : !list.data.length ? <div className="empty">Пока нет сервисов{need ? ` с услугой «${NEEDS[need]}»` : ''}. Вызовите выездного мастера — он приедет на место.</div> : (
        <div className="stack">
          {list.data.map((c: any) => (
            <a key={c.id} href={`#/services/${c.id}${from ? `?from=${from}` : ''}`} className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="between">
                <b>{c.name}</b>
                {c.rating ? <span className="pill good">★ {c.rating.toFixed(1)} · {c.reviews}</span> : <span className="pill">новый</span>}
              </div>
              <span className="note">{c.address} · {c.hours}{c.distanceKm != null ? ` · до вас ${c.distanceKm} км` : ''}</span>
              <span className="note">{c.paused ? 'Приём временно закрыт' : c.closedToday ? 'Сегодня закрыт' : c.accepts.map((a: string) => ACCEPTS[a]?.[0]).join(' · ')} · {POP[c.popularity]}{c.load ? ` · сейчас машин: ${c.load}` : ''}</span>
              {c.knowsBrand && <span className="pill accent" style={{ alignSelf: 'flex-start' }}>Знает {brand}</span>}
            </a>
          ))}
        </div>
      )}
    </main>
  );
}

function prefillOrder(service: string, place: { address?: string; destination?: string }) {
  try { sessionStorage.setItem('traksos.prefill', JSON.stringify(place)); } catch { /* */ }
  go(`new/${service}`);
}

export function CenterPage({ id }: { id: string }) {
  const c = useLoad(() => get(`/api/services/${id}`), [id]);
  const from = query().get('from');
  const d = c.data;
  if (!d) return <main><Back to="services" label="Сервисы" /><Loading error={c.error} /></main>;
  const staffOwn = Object.entries(d.staff ?? {}).filter(([, v]) => v === 'own').map(([k]) => NEEDS[k]).filter(Boolean);
  const staffInv = Object.entries(d.staff ?? {}).filter(([, v]) => v === 'invite').map(([k]) => NEEDS[k]).filter(Boolean);
  return (
    <main>
      <Back to="services" label="Сервисы" />
      <div>
        <h1>{d.name}</h1>
        <div className="sub">{d.address} · {d.hours}{d.distanceKm != null ? ` · до вас ${d.distanceKm} км` : ''}</div>
      </div>
      <div className="card">
        <dl className="kv">
          <dt>Рейтинг</dt><dd>{d.rating ? `★ ${d.rating.toFixed(1)} · ${d.reviews} отзывов` : 'отзывов пока нет'}</dd>
          <dt>Принимают</dt><dd>{d.accepts.map((a: string) => ACCEPTS[a]?.[0]).join(' · ') || '—'}</dd>
          {d.brands?.length > 0 && <><dt>Марки</dt><dd>{d.brands.join(', ')}</dd></>}
          {staffOwn.length > 0 && <><dt>Есть у них</dt><dd>{staffOwn.join(', ')}</dd></>}
          {staffInv.length > 0 && <><dt>Приглашают</dt><dd>{staffInv.join(', ')}</dd></>}
          {d.conditions?.length > 0 && <><dt>Условия</dt><dd>{d.conditions.map((x: string) => CONDITIONS[x]).join(', ')}</dd></>}
        </dl>
        <span className="note">Цену сервис скажет после осмотра. Смежные работы — закисшие болты, сварка, мелочи — нередко добавляют к счёту: сверьте перечень перед оплатой.</span>
      </div>
      {d.paused ? <div className="banner warn col"><b>Приём временно закрыт</b></div> : (
        <a className="btn" href={`#/services/${id}/book${from ? `?from=${from}` : ''}`}>Записаться</a>
      )}
      <div className="grid2">
        <button className="btn ghost" onClick={() => prefillOrder('tow', { destination: `${d.name}, ${d.address}` })}>Везти сюда эвакуатором</button>
        <button className="btn ghost" onClick={() => prefillOrder('electric', { address: `${d.name}, ${d.address}` })}>Вызвать мастера сюда</button>
      </div>
      {d.lat != null && <a className="btn ghost" target="_blank" rel="noreferrer" href={`https://yandex.ru/maps/?rtext=~${d.lat},${d.lng}&rtt=auto`}>Маршрут в навигаторе</a>}
      <div className="stack">
        <span className="label">Отзывы · сначала подробные</span>
        {d.reviews.length ? d.reviews.map((r: any, i: number) => (
          <div key={i} className="card">
            <div className="between"><b>{'★'.repeat(r.stars)}</b><span className="note">{fmtTime(r.at)}</span></div>
            {r.text && <span>{r.text}</span>}
            <span className="note">{r.who ?? 'Клиент'} · ✓ подтверждённый заказ</span>
          </div>
        )) : <div className="empty">Отзывов пока нет — их оставляют только после подтверждённого ремонта.</div>}
      </div>
    </main>
  );
}

export function BookForm({ id }: { id: string }) {
  const c = useLoad(() => get(`/api/services/${id}`), [id]);
  const cars = useLoad(() => get('/api/vehicles'), []);
  const from = query().get('from');
  const { busy, run } = useAction();
  const [vehicleId, setVehicle] = useState('');
  const [need, setNeed] = useState(query().get('need') ?? '');
  const [day, setDay] = useState(mskDay());
  const [time, setTime] = useState('');
  const [arrival, setArrival] = useState<'self' | 'tow'>('self');
  const [comment, setComment] = useState('');
  useEffect(() => { if (cars.data?.length && !vehicleId) setVehicle(cars.data[0].id); }, [cars.data]); // eslint-disable-line
  if (!c.data) return <main><Back to={`services/${id}`} label="Сервис" /><Loading error={c.error} /></main>;
  const d = c.data;
  const needs = Object.entries(NEEDS).filter(([k]) => k === 'other' || (d.staff?.[k] && d.staff[k] !== 'none'));
  async function send() {
    const r = await run(() => post(`/api/services/${id}/book`, { vehicleId: vehicleId || null, need, day, time: time || null, arrival, comment: comment || null, fromOrderId: from }), 'Запрос отправлен — сервис ответит уведомлением');
    if (r) go(`booking/${r.id}`);
  }
  return (
    <main>
      <Back to={`services/${id}`} label={d.name} />
      <div><h1>Запись в сервис</h1><div className="sub">Рембаза «{d.name}» · {d.address}</div></div>
      <div className="card">
        <Field label="Машина" group>
          {cars.data?.length ? (
            <select className="field" value={vehicleId} onChange={(e) => setVehicle(e.target.value)}>
              {cars.data.map((v: any) => <option key={v.id} value={v.id}>{carName(v)} · {v.plate ?? 'без номера'}</option>)}
            </select>
          ) : <a className="note" href="#/garage">+ Добавить машину в гараж</a>}
        </Field>
        <Field label="Что нужно" group>
          <div className="row">{needs.map(([k, n]) => <button key={k} type="button" className="chip" aria-pressed={need === k} onClick={() => setNeed(k)}>{n}</button>)}</div>
        </Field>
        <Field label="Когда приедете" group>
          <div className="row">
            <button type="button" className="chip" aria-pressed={day === mskDay()} disabled={d.closedToday} onClick={() => setDay(mskDay())}>Сегодня{d.closedToday ? ' · закрыто' : ''}</button>
            <button type="button" className="chip" aria-pressed={day === mskDay(1)} onClick={() => setDay(mskDay(1))}>Завтра</button>
            <input className="field" type="date" min={mskDay()} value={day} onChange={(e) => setDay(e.target.value)} style={{ maxWidth: 170 }} />
          </div>
        </Field>
        <Field label="Примерное время"><input className="field" placeholder="Примерно к … (например, 14:00)" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
        <div className="grid2">
          <button type="button" className="seg" aria-pressed={arrival === 'self'} onClick={() => setArrival('self')}>Своим ходом</button>
          <button type="button" className="seg" aria-pressed={arrival === 'tow'} onClick={() => setArrival('tow')}>На эвакуаторе</button>
        </div>
        <Field label="Комментарий · по желанию"><textarea className="field" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Что беспокоит" /></Field>
      </div>
      {from && <span className="note">По совету мастера — скидка применится в счёте сама.</span>}
      <button className="btn" disabled={busy || !need || !day} onClick={send}>Отправить запрос</button>
      <span className="note">Сервис подтвердит готовность или уточнит детали — придёт уведомление.</span>
    </main>
  );
}

/** Запись глазами клиента: статус ремонта, вопрос сервиса, заметки, счёт и сверка работ */
export function BookingPage({ id }: { id: string }) {
  const b = useLoad(() => get(`/api/bookings/${id}`), [id], isBookingEvent);
  const { busy, run } = useAction();
  const [answer, setAnswer] = useState('');
  const [mode, setMode] = useState<'' | 'agree' | 'dispute'>('');
  const [stars, setStars] = useState(0);
  const [text, setText] = useState('');
  const d = b.data;
  if (!d) return <main><Back to="orders" label="Заявки" /><Loading error={b.error} /></main>;
  if (d.mine) { go(`base/car/${id}`); return null; }
  const act = async (path: string, body: any, okText: string) => { const r = await run(() => post(`/api/bookings/${id}/${path}`, body), okText); if (r) b.setData(r); return r; };
  const steps = ['new', 'expected', 'arrived', 'in_work', 'ready', 'closed'];
  const at = d.status === 'clarify' ? 0 : ['diagnostics', 'waiting_part', 'agreeing'].includes(d.status) ? 3 : d.status === 'invoiced' || d.status === 'disputed' ? 4 : steps.indexOf(d.status);
  return (
    <main>
      <Back to="orders" label="Заявки" />
      <div>
        <h1>Ремонт на рембазе</h1>
        <div className="sub">«{d.center.name}» · {d.center.address}</div>
      </div>
      <div className="card hi">
        <div className="between"><b>№{d.number} · {d.needName}</b><span className={`pill ${TONE[d.status]}`}>{d.statusName}</span></div>
        <span className="note">{carName(d.vehicle)} · {d.vehicle?.plate ?? ''} · {fmtDay(d.whenDay)}{(d.acceptTime || d.whenTime) ? ` к ${d.acceptTime || d.whenTime}` : ''} · {d.arrival === 'tow' ? 'на эвакуаторе' : 'своим ходом'}</span>
        {at >= 0 && !['declined', 'cancelled'].includes(d.status) && (
          <ol className="tl">
            {['Запрос отправлен', 'Сервис ждёт вас', 'Машина в сервисе', 'Ремонт', 'Готова', 'Работы подтверждены'].map((n, i) => (
              <li key={n}><i className={i < at ? 'ok' : i === at ? 'now' : 'off'} /><b>{n}</b>{i === 3 && at === 3 && <small>{d.statusName}</small>}</li>
            ))}
          </ol>
        )}
        {d.status === 'declined' && <span className="note">Сервис не может: {d.declineReason}. <a href="#/services">Другие сервисы рядом →</a></span>}
      </div>
      {d.status === 'clarify' && (
        <div className="card">
          <b>Сервис уточняет: «{d.clarifyQ}»</b>
          <textarea className="field" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Ответ сервису" />
          <button className="btn" disabled={busy || answer.trim().length < 2} onClick={async () => { if (await act('answer', { text: answer }, 'Ответ отправлен')) setAnswer(''); }}>Ответить</button>
        </div>
      )}
      {d.status === 'expected' && d.center && <span className="note">Сервис ждёт вас. Опаздываете или передумали — отмените запись, чтобы место отдали другим.</span>}
      {d.notes.length > 0 && (
        <div className="card">
          <span className="label">Заметки сервиса</span>
          {d.notes.map((n: any, i: number) => <div key={i} className="note" style={{ color: 'var(--fg)' }}>{fmtTime(n.at)} · {n.text}</div>)}
        </div>
      )}
      {d.status === 'ready' && <div className="banner col"><b>Машина готова</b><span className="note">Сделано: {d.works.join(', ')}. Сервис выставит счёт — сверите перечень.</span></div>}
      {d.status === 'invoiced' && (
        <div className="card hi">
          <b>Счёт за ремонт · сверьте работы</b>
          <dl className="kv">
            <dt>Что делали</dt><dd>{d.works.join(', ')}</dd>
            <dt>Работы</dt><dd>{rub(d.amount)}</dd>
            {d.discount > 0 && <><dt>Скидка по совету мастера</dt><dd>− {rub(d.discount)}</dd></>}
            <dt>К оплате</dt><dd><b>{rub(d.toPay)}</b></dd>
          </dl>
          {mode === '' && (
            <div className="grid2">
              <button className="btn" onClick={() => setMode('agree')}>Всё верно</button>
              <button className="btn ghost" onClick={() => setMode('dispute')}>Не согласен</button>
            </div>
          )}
          {mode === 'agree' && (
            <div className="stack">
              <span className="label">Оцените сервис</span>
              <div className="stars">{[1, 2, 3, 4, 5].map((n) => <button key={n} aria-label={`${n} из 5`} aria-pressed={stars >= n} onClick={() => setStars(n)}>★</button>)}</div>
              <textarea className="field" value={text} onChange={(e) => setText(e.target.value)} placeholder="Что понравилось или нет — по желанию" />
              <button className="btn" disabled={busy || !stars} onClick={() => act('confirm', { agree: true, stars, text: text || undefined }, 'Спасибо — работы подтверждены')}>Подтвердить работы</button>
            </div>
          )}
          {mode === 'dispute' && (
            <div className="stack">
              <textarea className="field" value={text} onChange={(e) => setText(e.target.value)} placeholder="Что не так: каких работ не было, что сделали без согласования" />
              <button className="btn bad" disabled={busy || text.trim().length < 5} onClick={() => act('confirm', { agree: false, why: text }, 'Спор открыт, модератор свяжется с обеими сторонами')}>Открыть спор</button>
              <button className="btn ghost" onClick={() => setMode('')}>Назад</button>
            </div>
          )}
        </div>
      )}
      {d.status === 'closed' && <div className="banner col"><b>Работы подтверждены</b><span className="note">{d.works.join(', ')} · {rub(d.toPay)}{d.reviewStars ? ` · ваша оценка ${'★'.repeat(d.reviewStars)}` : ''}. Ремонт записан в историю машины.</span></div>}
      {d.status === 'disputed' && <div className="banner warn col"><b>Спор по работам</b><span className="note">Модератор свяжется с вами и с сервисом. Ответ придёт в «Поддержку».</span></div>}
      {['new', 'clarify', 'expected'].includes(d.status) && (
        <button className="btn ghost" disabled={busy} onClick={() => act('cancel', {}, 'Запись отменена')}>Отменить запись</button>
      )}
    </main>
  );
}

/** Строки записей в сервис — в «Заявках» клиента */
export function BookingRows({ live }: { live: boolean }) {
  const l = useLoad(() => get('/api/bookings'), [], isBookingEvent);
  const rows = (l.data ?? []).filter((b: any) => live === !['closed', 'declined', 'cancelled'].includes(b.status));
  if (!rows.length) return null;
  return (
    <div className="rows">
      {rows.map((b: any) => (
        <a key={b.id} href={`#/booking/${b.id}`} className="list-item">
          <div className="stack" style={{ gap: 2 }}>
            <b>Рембаза «{b.center.name}» · {b.needName}</b>
            <span className="note">{fmtDay(b.whenDay)} · {carName(b.vehicle)} {b.vehicle?.plate ?? ''}</span>
          </div>
          <span className={`pill ${TONE[b.status]}`}>{b.statusName}</span>
        </a>
      ))}
    </div>
  );
}

/** Мастер на месте: «на месте не исправить — советую сервис» */
export function RecommendService({ order, onDone }: { order: any; onDone: (o: any) => void }) {
  const [open, setOpen] = useState(false);
  const list = useLoad(() => (open ? get(`/api/services${order.lat ? `?lat=${order.lat}&lng=${order.lng}` : ''}`) : Promise.resolve(null)), [open]);
  const { busy, run } = useAction();
  if (order.recommendedCenter) return <span className="note">Вы посоветовали сервис «{order.recommendedCenter.name}». Клиенту там скидка, вам — бонус после ремонта.</span>;
  if (!open) return <button className="btn ghost" onClick={() => setOpen(true)}>На месте не исправить — посоветовать сервис</button>;
  return (
    <div className="card">
      <b>Посоветовать сервис-партнёр</b>
      <span className="note">Клиенту — скидка в сервисе, вам — бонус, когда сервис отметит «Машина готова». Из комиссии ТракSOS.</span>
      {!list.data ? <Loading error={list.error} /> : !list.data.length ? <span className="note">Рядом пока нет сервисов-партнёров.</span> : list.data.slice(0, 6).map((c: any) => (
        <button key={c.id} className="linkrow" disabled={busy} onClick={async () => { const r = await run(() => post(`/api/orders/${order.id}/recommend-service`, { centerId: c.id }), 'Клиенту отправлено'); if (r) onDone(r); }}>
          <span><b>{c.name}</b><small>{c.address}{c.distanceKm != null ? ` · ${c.distanceKm} км` : ''}{c.rating ? ` · ★ ${c.rating.toFixed(1)}` : ''}</small></span><span aria-hidden="true">›</span>
        </button>
      ))}
      <button className="btn ghost small" onClick={() => setOpen(false)}>Назад</button>
    </div>
  );
}

/** Модерация: проверка рембаз */
export function AdminServices() {
  const l = useLoad(() => get('/api/admin/services'), []);
  const { busy, run } = useAction();
  if (!l.data) return <Loading error={l.error} />;
  if (!l.data.length) return <div className="empty">Рембаз пока нет</div>;
  return (
    <div className="stack">
      {l.data.map((c: any) => (
        <div key={c.id} className="card">
          <div className="between"><b>{c.name}</b><span className={`pill ${c.verification === 'approved' ? 'good' : c.verification === 'rejected' ? 'bad' : 'warn'}`}>{c.verification === 'approved' ? 'проверен' : c.verification === 'rejected' ? 'отказ' : 'ждёт проверки'}</span></div>
          <span className="note">{c.address} · ИНН {c.inn ?? '—'} · {c.phone}</span>
          <span className="note">Принимают: {c.accepts.map((a: string) => ACCEPTS[a]?.[0]).join(', ')} · условия: {c.conditions.map((x: string) => CONDITIONS[x]).join(', ') || '—'}</span>
          {c.verification !== 'approved' && <div className="grid2">
            <button className="btn small" disabled={busy} onClick={async () => { if (await run(() => post(`/api/admin/services/${c.id}/verify`, { decision: 'approved' }), 'Клиенты увидят этот сервис')) l.reload(); }}>Одобрить</button>
            <button className="btn ghost small" disabled={busy} onClick={async () => { if (await run(() => post(`/api/admin/services/${c.id}/verify`, { decision: 'rejected' }), 'Отказ отправлен')) l.reload(); }}>Отказать</button>
          </div>}
        </div>
      ))}
    </div>
  );
}
