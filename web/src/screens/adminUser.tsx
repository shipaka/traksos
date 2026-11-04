// Карточка пользователя для администратора: всё о человеке и все действия над ним — по разделам.

import { useState } from 'react';
import { get, post, rub, fmtPhone, fmtTime } from '../api.ts';
import { STATUS, SERVICES, LINE } from '../dict.ts';
import { useLoad, useAction, Loading, Back, RubInput, go } from '../ui.tsx';

const ROLE_NAMES: Record<string, string> = {
  client: 'Клиент', driver: 'Водитель', master: 'Мастер', tow: 'Эвакуатор', service: 'Сервис / рембаза', moderator: 'Модератор', admin: 'Админ',
};
const TABS = [
  ['profile', 'Профиль и цена'], ['orders', 'Заявки'], ['cars', 'Машины'], ['performer', 'Исполнитель'],
  ['reviews', 'Отзывы'], ['payments', 'Платежи'], ['log', 'Журнал'],
] as const;
type Tab = (typeof TABS)[number][0];

export function AdminUser({ id }: { id: string }) {
  const card = useLoad(() => get(`/api/admin/users/${id}`), [id]);
  const [tab, setTab] = useState<Tab>('profile');
  if (!card.data) return <main><Back to="admin" /><Loading error={card.error} /></main>;
  const c = card.data;
  const u = c.user;
  const tabs = TABS.filter(([k]) => k !== 'performer' || c.performer);
  return (
    <main>
      <Back to="admin" />
      <div>
        <h1>{u.name ?? 'Без имени'}</h1>
        <div className="sub">{fmtPhone(u.phone)} · {u.roles.map((r: string) => ROLE_NAMES[r] ?? r).join(', ')} · с {new Date(u.created_at).toLocaleDateString('ru-RU')}</div>
      </div>
      <div className="row">
        {u.status === 'blocked' && <span className="pill bad">Заблокирован</span>}
        {u.rating && <span className="pill">★ {u.rating.toFixed(2)} · {u.rating_count}</span>}
        {c.pricing.feePctOverride != null && <span className="pill accent">Сбор {c.pricing.feePctOverride}%</span>}
        {c.pricing.bonus > 0 && <span className="pill good">Бонусы {rub(c.pricing.bonus)}</span>}
        {c.performer && <span className="pill">{LINE[c.performer.line_status]}</span>}
      </div>
      <div className="scroll-x">{tabs.map(([k, n]) => <button key={k} className="chip" aria-pressed={tab === k} onClick={() => setTab(k)}>{n}</button>)}</div>
      {tab === 'profile' && <ProfileTab c={c} reload={card.reload} />}
      {tab === 'orders' && <OrdersTab c={c} />}
      {tab === 'cars' && <CarsTab c={c} />}
      {tab === 'performer' && c.performer && <PerformerTab c={c} reload={card.reload} />}
      {tab === 'reviews' && <ReviewsTab c={c} reload={card.reload} />}
      {tab === 'payments' && <PaymentsTab c={c} reload={card.reload} />}
      {tab === 'log' && <LogTab c={c} />}
    </main>
  );
}

function ProfileTab({ c, reload }: { c: any; reload: () => void }) {
  const { busy, run } = useAction();
  const u = c.user;
  const [roles, setRoles] = useState<string[]>(u.roles);
  const [fee, setFee] = useState<string>(c.pricing.feePctOverride == null ? '' : String(c.pricing.feePctOverride));
  const [feeReason, setFeeReason] = useState('');
  const [bonus, setBonus] = useState<number | null>(null);
  const [bonusReason, setBonusReason] = useState('');
  const [blockReason, setBlockReason] = useState('');
  const act = (fn: () => Promise<unknown>, text: string) => run(fn, text).then((r) => r && reload());

  return (
    <div className="stack">
      <div className="card">
        <dl className="kv">
          <dt>Телефон</dt><dd>{fmtPhone(u.phone)}</dd>
          {u.company_name && <><dt>Компания</dt><dd>{u.company_name}{u.company_inn ? `, ИНН ${u.company_inn}` : ''}</dd></>}
          {c.owner && <><dt>Водитель у</dt><dd><a href={`#/admin/user/${c.owner.id}`}>{c.owner.company_name ?? c.owner.name ?? fmtPhone(c.owner.phone)}</a></dd></>}
          <dt>Был в сети</dt><dd>{u.last_seen_at ? fmtTime(u.last_seen_at) : '—'}</dd>
          <dt>Устройств</dt><dd>{c.sessions.length}</dd>
        </dl>
      </div>

      <div className="card">
        <b>Цена для этого клиента</b>
        <span className="note">Общий сбор площадки — {c.pricing.defaultFeePct}%. Персональный действует на новые заявки. Скидки и бонусы оплачивает площадка — исполнитель получает полностью.</span>
        <div className="compose">
          <input className="field" inputMode="decimal" placeholder={`Сбор, % (пусто — ${c.pricing.defaultFeePct}%)`} value={fee} onChange={(e) => setFee(e.target.value.replace(/[^\d.]/g, ''))} />
        </div>
        <input className="field" placeholder="Причина: свой клиент, компания с парком…" value={feeReason} onChange={(e) => setFeeReason(e.target.value)} />
        <button className="btn small" disabled={busy || feeReason.length < 3} onClick={() =>
          act(() => post(`/api/admin/users/${u.id}/fee`, { pct: fee === '' ? null : Number(fee), reason: feeReason }), fee === '' ? 'Вернули общий сбор' : `Сбор клиента — ${fee}%`)}>Сохранить сбор</button>

        <div className="hr" />
        <div className="between"><b>Бонусы</b><span className="pill good">{rub(c.pricing.bonus)}</span></div>
        <span className="note">Спишутся сами при подтверждении суммы следующей заявки. Минус — списать.</span>
        <div className="compose">
          <RubInput value={bonus == null ? null : Math.abs(bonus)} onChange={(v) => setBonus(v)} placeholder="Сумма, ₽" />
        </div>
        <input className="field" placeholder="За что: первый заказ, извинения за ожидание…" value={bonusReason} onChange={(e) => setBonusReason(e.target.value)} />
        <div className="grid2">
          <button className="btn ghost small" disabled={busy || !bonus || bonusReason.length < 3} onClick={() =>
            act(() => post(`/api/admin/users/${u.id}/bonus`, { amount: -Math.abs(bonus!), reason: bonusReason }), 'Бонусы списаны')}>Списать</button>
          <button className="btn small" disabled={busy || !bonus || bonusReason.length < 3} onClick={() =>
            act(() => post(`/api/admin/users/${u.id}/bonus`, { amount: Math.abs(bonus!), reason: bonusReason }), 'Бонусы начислены')}>Начислить</button>
        </div>
        {c.pricing.bonusEntries.length > 0 && (
          <div className="stack" style={{ gap: 4 }}>
            {c.pricing.bonusEntries.slice(0, 10).map((e: any) => (
              <div key={e.id} className="sum"><span>{fmtTime(e.created_at)} · {e.note}</span><span>{e.amount > 0 ? '+' : '−'}{rub(Math.abs(e.amount))}</span></div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <b>Роли</b>
        <div className="row">{Object.entries(ROLE_NAMES).map(([r, n]) => (
          <button key={r} className="chip" aria-pressed={roles.includes(r)} onClick={() => setRoles(roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r])}>{n}</button>
        ))}</div>
        <button className="btn small" disabled={busy || !roles.length || roles.join() === u.roles.join()} onClick={() =>
          act(() => post(`/api/admin/users/${u.id}/roles`, { roles }), 'Роли сохранены')}>Сохранить роли</button>
      </div>

      <div className="card">
        <b>{u.status === 'blocked' ? 'Пользователь заблокирован' : 'Блокировка'}</b>
        <span className="note">Блокировка сразу выкидывает со всех устройств; заявки в работе остаются — разберите их во вкладке «Заявки».</span>
        {u.status !== 'blocked' && <input className="field" placeholder="Причина" value={blockReason} onChange={(e) => setBlockReason(e.target.value)} />}
        <button className={`btn ${u.status === 'blocked' ? '' : 'bad'}`} disabled={busy || (u.status !== 'blocked' && blockReason.length < 3)} onClick={() =>
          act(() => post(`/api/admin/users/${u.id}/block`, { blocked: u.status !== 'blocked', reason: blockReason || undefined }), u.status === 'blocked' ? 'Разблокирован' : 'Заблокирован')}>
          {u.status === 'blocked' ? 'Разблокировать' : 'Заблокировать'}
        </button>
      </div>
    </div>
  );
}

function OrderList({ list, empty }: { list: any[]; empty: string }) {
  if (!list.length) return <div className="empty">{empty}</div>;
  return (
    <div className="rows">
      {list.map((o) => (
        <a key={o.id} href={`#/order/${o.id}`} className="list-item">
          <div className="stack" style={{ gap: 2 }}>
            <b>№{o.number} · {SERVICES[o.service]?.name}{o.is_sos ? ' · SOS' : ''}</b>
            <span className="note">{fmtTime(o.created_at)} · {o.payment_method === 'cash' ? 'наличные' : o.payment_method === 'online' ? 'онлайн' : 'счёт'}
              {o.call_out_amount != null ? ` · ${rub((o.call_out_amount ?? 0) + (o.work_amount ?? 0))}` : ''}</span>
          </div>
          <span className={`pill ${STATUS[o.status]?.tone}`}>{STATUS[o.status]?.name}</span>
        </a>
      ))}
    </div>
  );
}

function OrdersTab({ c }: { c: any }) {
  return (
    <div className="stack">
      <span className="label">Как клиент · {c.asClient.length}</span>
      <OrderList list={c.asClient} empty="Заявок нет" />
      {c.performer && <><span className="label">Как исполнитель · {c.asPerformer.length}</span><OrderList list={c.asPerformer} empty="Выездов нет" /></>}
    </div>
  );
}

function CarsTab({ c }: { c: any }) {
  return (
    <div className="stack">
      {!c.vehicles.length && <div className="empty">Машин нет</div>}
      {c.vehicles.map((v: any) => (
        <div key={v.id} className="card">
          <div className="between"><b>{v.brand} {v.model ?? ''}{v.year ? `, ${v.year}` : ''}</b><span className="pill">{v.plate ?? 'без номера'}</span></div>
          {v.driver_phone && <span className="note">Водитель: {v.driver_name ?? ''} {fmtPhone(v.driver_phone)}</span>}
        </div>
      ))}
      {c.drivers.length > 0 && <>
        <span className="label">Водители</span>
        <div className="rows">{c.drivers.map((d: any) => (
          <a key={d.id} href={`#/admin/user/${d.id}`} className="list-item"><span>{d.name ?? 'Водитель'} · {fmtPhone(d.phone)}</span>{d.status === 'blocked' && <span className="pill bad">Заблокирован</span>}</a>
        ))}</div>
      </>}
    </div>
  );
}

function PerformerTab({ c, reload }: { c: any; reload: () => void }) {
  const { busy, run } = useAction();
  const p = c.performer;
  const b = c.balance;
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [offReason, setOffReason] = useState('');
  const act = (fn: () => Promise<unknown>, text: string) => run(fn, text).then((r) => r && reload());
  return (
    <div className="stack">
      <div className="card">
        <dl className="kv">
          <dt>Кто</dt><dd>{p.kind === 'tow' ? 'Эвакуатор' : 'Мастер'} · {p.specialties.map((s: string) => SERVICES[s]?.name ?? s).join(', ')}</dd>
          <dt>Проверка</dt><dd>{p.verification === 'approved' ? '✓ пройдена' : p.verification === 'rejected' ? 'отказ' : 'на проверке'}{p.verification_note ? ` · ${p.verification_note}` : ''}</dd>
          <dt>Статус</dt><dd>{p.tax_status === 'self_employed' ? 'Самозанятый' : p.tax_status === 'ip' ? 'ИП' : 'не указан'}{p.inn ? `, ИНН ${p.inn}` : ''}</dd>
          <dt>Машина</dt><dd>{p.car ? `${p.car.brand}, ${p.car.plate}` : '—'}</dd>
          <dt>На линии</dt><dd>{LINE[p.line_status]}{p.is_priority ? ' · первый в очереди' : ''}</dd>
        </dl>
        <div className="row">
          <button className="btn ghost small" disabled={busy} onClick={() =>
            act(() => post(`/api/admin/performers/${c.user.id}/priority`, { isPriority: !p.is_priority }), p.is_priority ? 'Убран из первых' : 'Теперь первый в очереди')}>
            {p.is_priority ? 'Убрать из «первых»' : 'Сделать первым в очереди'}</button>
          <button className="btn ghost small" onClick={() => go('admin')}>Проверка фото →</button>
        </div>
      </div>

      <div className="card">
        <b>Баланс</b>
        <div className="sum"><span>К выплате</span><span>{rub(b.to_pay)}</span></div>
        <div className="sum"><span>Выплачено</span><span>{rub(b.paid)}</span></div>
        <div className="sum"><span>Долг по наличным</span><span>{rub(b.cash_debt)}{b.paused ? ' · заявки на паузе' : ''}</span></div>
        <div className="hr" />
        <b>Начислить или списать</b>
        <RubInput value={amount == null ? null : Math.abs(amount)} onChange={setAmount} placeholder="Сумма, ₽" />
        <input className="field" placeholder="Причина: компенсация, штраф, исправление ошибки" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="grid2">
          <button className="btn ghost small" disabled={busy || !amount || reason.length < 3} onClick={() =>
            act(() => post(`/api/admin/performers/${c.user.id}/adjust`, { amount: -Math.abs(amount!), reason }), 'Списано')}>Списать</button>
          <button className="btn small" disabled={busy || !amount || reason.length < 3} onClick={() =>
            act(() => post(`/api/admin/performers/${c.user.id}/adjust`, { amount: Math.abs(amount!), reason }), 'Начислено')}>Начислить</button>
        </div>
        {b.cash_debt > 0 && (
          <button className="btn ghost small" disabled={busy} onClick={() =>
            act(() => post(`/api/admin/performers/${c.user.id}/cash-debt-paid`, { amount: b.cash_debt }), 'Долг погашен')}>Отметить: долг {rub(b.cash_debt)} оплачен переводом</button>
        )}
      </div>

      <div className="card">
        <b>Снять с линии</b>
        <span className="note">Сразу пропадёт из всех звонков и торгов. Вернуться на линию он сможет сам — если нужно запретить, заблокируйте в «Профиль и цена».</span>
        <input className="field" placeholder="Причина — исполнитель её увидит" value={offReason} onChange={(e) => setOffReason(e.target.value)} />
        <button className="btn bad" disabled={busy || offReason.length < 3 || p.line_status === 'offline'} onClick={() =>
          act(() => post(`/api/admin/performers/${c.user.id}/offline`, { reason: offReason }), 'Снят с линии')}>Снять с линии</button>
      </div>

      <span className="label">Проводки</span>
      <div className="rows">{c.ledger.slice(0, 30).map((l: any) => (
        <div key={l.id} className="list-item">
          <div className="stack" style={{ gap: 2 }}><span>{LEDGER_KINDS[l.kind] ?? l.kind}{l.number ? ` · №${l.number}` : ''}</span><span className="note">{fmtTime(l.created_at)}{l.note ? ` · ${l.note}` : ''}</span></div>
          <b style={{ color: l.amount < 0 ? 'var(--bad)' : 'var(--good-fg)' }}>{l.amount > 0 ? '+' : '−'}{rub(Math.abs(l.amount))}</b>
        </div>
      ))}{!c.ledger.length && <div className="empty">Движений нет</div>}</div>

      <span className="label">Выплаты</span>
      <div className="rows">{c.payouts.map((po: any) => (
        <div key={po.id} className="list-item"><span>№{po.number} · {fmtTime(po.created_at)}</span><span>{rub(po.amount)} · {PAYOUT_STATUS[po.status]}</span></div>
      ))}{!c.payouts.length && <div className="empty">Выплат нет</div>}</div>
    </div>
  );
}

const LEDGER_KINDS: Record<string, string> = {
  earning: 'Начислено за заявку', payout: 'Выплата', cash_commission: 'Долг: сбор и вознаграждение с наличных', cash_commission_paid: 'Долг погашен',
  adjustment: 'Корректировка', refund_charge: 'Удержание за возврат клиенту',
};
const PAYOUT_STATUS: Record<string, string> = { pending: 'ждёт', processing: 'отправляется', paid: 'выплачено', failed: 'ошибка' };

function ReviewsTab({ c, reload }: { c: any; reload: () => void }) {
  const { busy, run } = useAction();
  return (
    <div className="stack">
      <span className="label">О нём · {c.reviewsAbout.length}</span>
      {!c.reviewsAbout.length && <div className="empty">Отзывов нет</div>}
      {c.reviewsAbout.map((r: any) => (
        <div key={r.id} className="card">
          <div className="between"><b>{'★'.repeat(r.stars)}{'☆'.repeat(5 - r.stars)} · {r.author_name ?? 'Аноним'}</b><span className="note">вес {r.weight}</span></div>
          {r.tags.length > 0 && <span className="note">{r.tags.join(' · ')}</span>}
          {r.text && <span>{r.text}</span>}
          <div className="row">
            <button className="btn ghost small" disabled={busy} onClick={() => run(() => post(`/api/admin/reviews/${r.id}`, { disputed: !r.disputed }), r.disputed ? 'Отзыв снова учитывается' : 'Отзыв оспорен — не влияет на рейтинг').then((x) => x && reload())}>
              {r.disputed ? 'Снять «оспорен»' : 'Оспорить'}</button>
            <button className="btn ghost small" disabled={busy} onClick={() => run(() => post(`/api/admin/reviews/${r.id}`, { hidden: !r.hidden }), r.hidden ? 'Отзыв показан' : 'Отзыв скрыт').then((x) => x && reload())}>
              {r.hidden ? 'Показать' : 'Скрыть'}</button>
            <a className="btn ghost small" href={`#/order/${r.order_id}`}>Заявка</a>
          </div>
        </div>
      ))}
      <span className="label">Оставил сам · {c.reviewsBy.length}</span>
      {c.reviewsBy.map((r: any) => <div key={r.id} className="sum"><span>{'★'.repeat(r.stars)} → {r.target_name ?? '—'}{r.text ? ` · ${r.text}` : ''}</span><span className="note">{fmtTime(r.created_at)}</span></div>)}
    </div>
  );
}

export function RefundForm({ pay, onDone }: { pay: any; onDone: () => void }) {
  const { busy, run } = useAction();
  const [open, setOpen] = useState(false);
  const left = pay.total - pay.refunded_amount;
  const [amount, setAmount] = useState<number | null>(left);
  const [from, setFrom] = useState<'platform' | 'performer'>('platform');
  const [reason, setReason] = useState('');
  if (!['captured', 'partially_refunded'].includes(pay.status) || left <= 0) return null;
  if (!open) return <button className="btn ghost small" onClick={() => setOpen(true)}>Вернуть деньги</button>;
  return (
    <div className="stack">
      <RubInput value={amount} onChange={setAmount} placeholder={`До ${rub(left)}`} />
      <div className="grid2">
        <button className="seg" aria-pressed={from === 'platform'} onClick={() => setFrom('platform')}>За счёт площадки</button>
        <button className="seg" aria-pressed={from === 'performer'} onClick={() => setFrom('performer')}>Удержать у исполнителя</button>
      </div>
      <input className="field" placeholder="Причина — клиент её увидит" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button className="btn" disabled={busy || !amount || amount > left || reason.length < 3} onClick={() =>
        run(() => post(`/api/admin/payments/${pay.id}/refund`, { amount, from, reason }), `Возврат ${rub(amount)} отправлен`).then((r) => r && onDone())}>Вернуть {rub(amount ?? 0)}</button>
    </div>
  );
}

const PAY_STATUS: Record<string, string> = {
  created: 'создан', pending: 'ждёт оплаты', held: 'заморожен', captured: 'списан', refunded: 'возвращён', partially_refunded: 'частично возвращён', cancelled: 'отменён', failed: 'ошибка',
};
export const payStatus = (s: string) => PAY_STATUS[s] ?? s;

function PaymentsTab({ c, reload }: { c: any; reload: () => void }) {
  if (!c.payments.length) return <div className="empty">Платежей через площадку нет — заявки оплачивались наличными</div>;
  return (
    <div className="stack">
      {c.payments.map((p: any) => (
        <div key={p.id} className="card">
          <div className="between"><b>№{p.number} · {p.kind === 'call_out' ? 'выезд' : 'работа'} · {p.method === 'invoice' ? 'счёт' : p.method === 'sbp' ? 'СБП' : 'карта'}</b><span className="pill">{payStatus(p.status)}</span></div>
          <div className="sum"><span>Списано с клиента</span><span>{rub(p.total)}</span></div>
          {p.refunded_amount > 0 && <div className="sum"><span>Возвращено</span><span>{rub(p.refunded_amount)}</span></div>}
          <RefundForm pay={p} onDone={reload} />
        </div>
      ))}
    </div>
  );
}

const ACTIONS: Record<string, string> = {
  'payment.refund': 'Возврат', 'balance.adjust': 'Корректировка баланса', 'client.fee': 'Сбор клиента', 'client.bonus': 'Бонусы', 'order.discount': 'Скидка на заявку',
  'order.resolve': 'Разбор заявки', 'performer.offline': 'Снят с линии', 'performer.verify': 'Решение по проверке', 'performer.priority': 'Первый в очереди',
  'user.roles': 'Роли', 'user.block': 'Блокировка', 'user.unblock': 'Разблокировка', 'document.view': 'Просмотр документа', 'document.review': 'Проверка фото',
};
function LogTab({ c }: { c: any }) {
  if (!c.audit.length) return <div className="empty">Действий не было</div>;
  return (
    <div className="rows">{c.audit.map((a: any) => (
      <div key={a.id} className="list-item">
        <div className="stack" style={{ gap: 2 }}>
          <span>{ACTIONS[a.action] ?? a.action}{a.data?.reason ? ` · ${a.data.reason}` : ''}{a.data?.amount ? ` · ${rub(Math.abs(a.data.amount))}` : ''}</span>
          <span className="note">{fmtTime(a.created_at)} · {a.actor_phone ? fmtPhone(a.actor_phone) : 'система'}</span>
        </div>
      </div>
    ))}</div>
  );
}
