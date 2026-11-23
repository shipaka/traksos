// Админ: сводка (сегодня, деньги, работа, качество) и живые заявки с лентой событий.
import { useState } from 'react';
import { get, rub, fmtTime } from '../api.ts';
import { SERVICES, STATUS } from '../dict.ts';
import { useLoad, useMe, Loading } from '../ui.tsx';

const pct = (x: number | null | undefined) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const EVENT: Record<string, string> = {
  created: 'создана', dispatch_started: 'звоним', offer_chosen: 'выбран исполнитель', offer_autopicked: 'исполнитель назначен', accepted: 'принял',
  depart: 'выехал', arrive: 'на месте', start_work: 'начал работу', amount_proposed: 'сумма', amount_disputed: 'спор о сумме', late: 'опаздывает',
  part: 'запчасть', support_called: 'позвали поддержку', owner_approval_requested: 'ждёт владельца', owner_approved: 'владелец подтвердил',
  service_recommended: 'посоветовал сервис', auction_started: 'торги', ringing: 'звоним', offer: 'отклик', amount_confirmed: 'сумма подтверждена',
  no_performer: 'никто не взял', retry: 'повтор поиска', owner_rejected: 'владелец отклонил', hint_checked: 'подсказка проверена', consult_finished: 'консультация закрыта', site_flags: 'отметки на месте', performer_dropped: 'исполнитель отказался', cancelled: 'отменена',
};

function Tile({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: string }) {
  return (
    <div className="card tile">
      <span className="label">{label}</span>
      <span className="tile-value" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</span>
      {hint && <span className="note">{hint}</span>}
    </div>
  );
}

export function AdminSummary() {
  const { me } = useMe();
  const s = useLoad(async () => ({ownerId:me?.id,payload:await get('/api/admin/summary')}),
    [me?.id], (e) => e.type === 'order' || e.type === 'mod_case');
  const [tab, setTab] = useState<'money' | 'work' | 'quality'>('money');
  // useLoad keeps the previous payload on GET failure; this is financial and
  // role-sensitive data, not a reusable estimate from a previous session.
  const d = !s.error && !!me?.id && s.data && s.data.ownerId === me.id ? s.data.payload : null;
  if (!d) return <div className="stack">
    <Loading error={s.error} />
    {s.error && <button type="button" className="btn ghost small"
      onClick={() => void s.reload()}>Повторить загрузку сводки</button>}
  </div>;
  return (
    <div className="stack">
      <span className="label">Сегодня · данные платформы</span>
      <div className="grid3">
        <Tile label="Заявок сегодня" value={d.today.orders} />
        <Tile label="На линии" value={d.today.mastersOnline + d.today.towOnline} hint={`эвакуаторов: ${d.today.towOnline}`} />
        <Tile label="Споров" value={d.today.disputesOpen} tone={d.today.disputesOpen ? 'warn' : undefined} hint={`в очереди всего: ${d.today.modOpen}`} />
      </div>
      <div className="admin-live-viz card" aria-label="Оперативная диаграмма по текущим показателям">
        <div className="between"><b>Пульс площадки</b><span className="pill">Данные сервера · сегодня</span></div>
        <div className="admin-live-bars">
          {([
            ['Заявки',d.today.orders],
            ['На линии',d.today.mastersOnline + d.today.towOnline],
            ['Споры',d.today.disputesOpen],
          ] as [string,number][]).map(([label,value],_,data)=>{
            const max=Math.max(1,...data.map(x=>x[1]));
            return <div className="admin-live-bar" key={label}>
              <span className="admin-live-bar-track"><i style={{height:(value===0?2:Math.max(8,value/max*100))+'%'}}/></span>
              <b>{value}</b><small>{label}</small>
            </div>;
          })}
        </div>
        <span className="note">Высота столбцов — относительная величина по трём показателям. Платежи здесь не отображаются.</span>
      </div>
      <div className="scroll-x" role="group" aria-label="Раздел сводки">
        {([['money', 'Деньги'], ['work', 'Работа'], ['quality', 'Качество']] as const).map(([k, n]) => <button type="button" key={k} className="chip" aria-pressed={tab === k} onClick={() => setTab(k)}>{n}</button>)}
      </div>
      {tab === 'money' && (
        <div className="tiles">
          <Tile label="Оплачено клиентами за месяц" value={rub(d.money.paidMonth)} hint="онлайн, за вычетом возвратов" />
          <Tile label="Доход TrakSOS за месяц" value={rub(d.money.platformMonth)} hint="сборы и комиссии" />
          <Tile label="К выплате исполнителям" value={rub(d.money.toPayout)} />
          <Tile label="Заморожено" value={rub(d.money.frozen)} hint="выезды до приезда" />
          <Tile label="Ждут подтверждения суммы" value={d.money.awaitingConfirmation} />
          <Tile label="Долги по наличным" value={rub(d.money.cashDebts)} tone={d.money.cashDebts ? 'warn' : undefined} />
        </div>
      )}
      {tab === 'work' && (
        <div className="tiles">
          <Tile label="Мастеров на линии" value={d.work.mastersOnline} hint={`эвакуаторщиков: ${d.work.towOnline}`} />
          <Tile label="Средняя подача" value={d.work.arriveMedianMin != null ? `${d.work.arriveMedianMin} мин` : '—'} hint="медиана за месяц" />
          <Tile label="Консультации → выезд" value={pct(d.work.consultToVisit)} hint="за месяц" />
          <Tile label="Новых клиентов" value={d.work.newClients} hint="за месяц" />
        </div>
      )}
      {tab === 'quality' && (
        <div className="tiles">
          <Tile label="Открытых споров" value={d.quality.disputesOpen} />
          <Tile label="Неприездов за месяц" value={d.quality.dropsMonth} hint={`из ${d.quality.completedMonth} работ`} tone={d.quality.dropsMonth ? 'warn' : undefined} />
          <Tile label="Удержание клиентов" value={pct(d.quality.repeat)} hint="вернулись после работы" />
          <Tile label="Средний рейтинг исполнителей" value={d.quality.performersRating ? `★ ${d.quality.performersRating.toFixed(2)}` : '—'} />
        </div>
      )}
      <LiveOrders />
    </div>
  );
}

function LiveOrders() {
  const { me } = useMe();
  const l = useLoad(async () => ({ownerId:me?.id,rows:await get('/api/admin/live')}),
    [me?.id], (e) => e.type === 'order');
  const rows = !l.error && !!me?.id && l.data && l.data.ownerId === me.id ? l.data.rows : null;
  if (!rows) return <div className="stack">
    <Loading error={l.error} />
    {l.error && <button type="button" className="btn ghost small"
      onClick={() => void l.reload()}>Повторить загрузку живых заявок</button>}
  </div>;
  return (
    <div className="stack">
      <span className="label">Живые заявки · {rows.length}</span>
      {!rows.length ? <div className="empty">Сейчас открытых заявок нет</div> : (
        <div className="rows">
          {rows.map((o: any) => (
            <a key={o.id} href={`#/order/${o.id}`} className="list-item">
              <div className="stack" style={{ gap: 2 }}>
                <b>№{o.number} · {SERVICES[o.service]?.name ?? o.service}{o.is_sos ? ' · SOS' : ''}</b>
                <span className="note">{o.client_name ?? 'Клиент'}{o.performer_name ? ` → ${o.performer_name}` : ''} · {o.address ?? o.zone ?? ''}</span>
                <span className="note">{o.events.map((e: any) => `${fmtTime(e.at)} ${EVENT[e.type] ?? e.type}`).join(' · ')}</span>
              </div>
              <span className={`pill ${STATUS[o.status]?.tone ?? ''}`}>{STATUS[o.status]?.name ?? o.status}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
