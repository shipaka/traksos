// Поддержка: список обращений, переписка, новое обращение (по заявке или без). Для сотрудников — то же, плюс «Закрыть».

import { useEffect, useRef, useState } from 'react';
import { get, post, fmtTime, fmtPhone, onEvent, rub } from '../api.ts';

const ENTRY_KIND: Record<string, string> = {
  earning: 'Начислено за заявку', payout: 'Выплата', adjustment: 'Корректировка', refund_charge: 'Удержание за возврат',
  cash_commission: 'Комиссия с наличных', cash_commission_paid: 'Комиссия оплачена',
};
import { useLoad, useAction, useMe, Loading, Back, go } from '../ui.tsx';

export function SupportList() {
  const list = useLoad(() => get('/api/support'), [], (e) => e.type === 'support');
  return (
    <main>
      <Back to="profile" />
      <div className="between"><h1>Поддержка</h1><button className="btn small" onClick={() => go('support/new')}>Написать</button></div>
      <span className="note">Отвечаем круглосуточно, обычно за 15 минут. По заявке быстрее — кнопка «Позвать поддержку» в самой заявке.</span>
      {!list.data ? <Loading error={list.error} /> : !list.data.length ? <div className="empty">Обращений пока нет</div> : (
        <div className="rows">{list.data.map((t: any) => (
          <a key={t.id} href={`#/support/${t.id}`} className="list-item">
            <div className="stack" style={{ gap: 2 }}>
              <b>№{t.number} · {t.topic}{t.order_number ? ` · заявка №${t.order_number}` : ''}</b>
              <span className="note">{fmtTime(t.updated_at)} · {t.last?.slice(0, 60)}</span>
            </div>
            <span className={`pill ${t.status === 'open' ? 'accent' : ''}`}>{t.status === 'open' ? 'Открыто' : 'Закрыто'}</span>
          </a>
        ))}</div>
      )}
    </main>
  );
}

export function SupportNew() {
  const orderId = new URLSearchParams(location.hash.split('?')[1] ?? '').get('order') ?? undefined;
  const topics = useLoad(() => get('/api/support/topics'), []);
  const { busy, run } = useAction();
  const [topic, setTopic] = useState('');
  const [text, setText] = useState('');
  return (
    <main>
      <Back to={orderId ? `order/${orderId}` : 'support'} />
      <h1>{orderId ? 'Позвать поддержку' : 'Написать в поддержку'}</h1>
      <div className="row">{(topics.data ?? []).map((t: string) => <button key={t} className="chip" aria-pressed={topic === t} onClick={() => setTopic(t)}>{t}</button>)}</div>
      <textarea className="field" placeholder="Что случилось — коротко" value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn" disabled={busy || !topic || text.trim().length < 3} onClick={async () => {
        const r = await run(() => post('/api/support', { topic, text, orderId }), 'Отправлено — поддержка уже видит');
        if (r) location.replace(`#/support/${r.id}`);
      }}>Отправить</button>
    </main>
  );
}

export function SupportThread({ id }: { id: string }) {
  const { me, mode } = useMe();
  const th = useLoad(() => get(`/api/support/${id}`), [id], (e) => e.type === 'support' && e.ticketId === id);
  const { busy, run } = useAction();
  const [text, setText] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.scrollTo(0, box.current.scrollHeight); }, [th.data?.messages.length]);
  useEffect(() => onEvent((e) => { if (e.type === 'support' && e.ticketId === id) th.reload(); }), [id]); // eslint-disable-line
  if (!th.data) return <main><Back to="support" /><Loading error={th.error} /></main>;
  const t = th.data;
  const staff = mode === 'admin';
  return (
    <main>
      <Back to={staff ? 'admin' : 'support'} />
      <div className="between" style={{ alignItems: 'flex-start' }}>
        <div>
          <h1>№{t.number} · {t.topic}</h1>
          <div className="sub">{fmtTime(t.createdAt)}{t.order ? ` · заявка №${t.order.number}` : ''}</div>
        </div>
        <span className={`pill ${t.status === 'open' ? 'accent' : ''}`}>{t.status === 'open' ? 'Открыто' : 'Закрыто'}</span>
      </div>
      <div className="row">
        {t.order && <a className="btn ghost small" href={`#/order/${t.order.id}`}>Открыть заявку</a>}
        {staff && t.author && <a className="btn ghost small" href={`#/admin/user/${t.author.id}`}>{t.author.name ?? fmtPhone(t.author.phone)} — карточка</a>}
      </div>
      {t.entry && (
        <div className="card flat" style={{ gap: 4 }}>
          <span className="label">Операция №{t.entry.id}{t.entry.order_number ? ` · заявка №${t.entry.order_number}` : ''}</span>
          <div className="between"><b>{ENTRY_KIND[t.entry.kind] ?? t.entry.kind}</b><b>{t.entry.amount >= 0 ? '+' : '−'}{rub(Math.abs(t.entry.amount))}</b></div>
          <span className="note">{fmtTime(t.entry.created_at)}{t.entry.note ? ` · ${t.entry.note}` : ''}</span>
          {staff && <span className="note">Исправить — в карточке исполнителя: «Начислить» или «Списать» с причиной.</span>}
        </div>
      )}
      <div className="card">
        <div className="msgs" ref={box}>
          {t.messages.map((m: any) => {
            const sys = !m.sender_id;
            const mine = m.sender_id === me?.id;
            return (
              <div key={m.id} className={`msg ${sys ? 'sys' : mine ? 'me' : ''}`}>
                {!sys && !mine && <span className="n">{m.from_staff ? 'Поддержка' : m.sender_name ?? 'Пользователь'}</span>}
                <span className="b">{m.body}</span>
              </div>
            );
          })}
        </div>
        {t.status === 'open' && (
          <form className="compose" onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => post(`/api/support/${id}/messages`, { body: text }), null)) { setText(''); th.reload(); }
          }}>
            <input className="field" placeholder="Сообщение" value={text} onChange={(e) => setText(e.target.value)} />
            <button className="btn small" disabled={busy || !text.trim()}>➤</button>
          </form>
        )}
      </div>
      {t.status === 'open' && <button className="btn ghost" disabled={busy} onClick={() => run(() => post(`/api/support/${id}/close`), 'Обращение закрыто').then((r) => r && th.reload())}>
        {staff ? 'Закрыть обращение' : 'Вопрос решён — закрыть'}</button>}
      {t.status === 'closed' && <button className="btn" onClick={() => go(t.order ? `support/new?order=${t.order.id}` : 'support/new')}>Новое обращение</button>}
    </main>
  );
}

/** Очередь обращений для сотрудников */
export function SupportQueue() {
  const [status, setStatus] = useState<'open' | 'closed'>('open');
  const q = useLoad(() => get(`/api/admin/support?status=${status}`), [status], (e) => e.type === 'support');
  return (
    <div className="stack">
      <div className="grid2">
        <button className="seg" aria-pressed={status === 'open'} onClick={() => setStatus('open')}>Открытые</button>
        <button className="seg" aria-pressed={status === 'closed'} onClick={() => setStatus('closed')}>Закрытые</button>
      </div>
      {!q.data ? <Loading error={q.error} /> : !q.data.length ? <div className="empty">{status === 'open' ? 'Открытых обращений нет' : 'Пусто'}</div> : (
        <div className="rows">{q.data.map((t: any) => (
          <a key={t.id} href={`#/support/${t.id}`} className="list-item">
            <div className="stack" style={{ gap: 2 }}>
              <b>№{t.number} · {t.topic}{t.order_number ? ` · заявка №${t.order_number}` : ''}</b>
              <span className="note">{t.name ?? fmtPhone(t.phone)} · {fmtTime(t.updated_at)} · {t.last?.slice(0, 50)}</span>
            </div>
            {t.status === 'open' && t.waiting ? <span className="pill warn">Ждёт ответа</span> : t.assignee_name ? <span className="note">{t.assignee_name}</span> : null}
          </a>
        ))}</div>
      )}
    </div>
  );
}

// Уведомления -----------------------------------------------------------------

export function useUnread() {
  const { me } = useMe();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!me) return;
    const load = () => get('/api/me/notifications').then((r) => setN(r.unread)).catch(() => {});
    load();
    return onEvent(() => load());
  }, [me?.id]); // eslint-disable-line
  return n;
}

export function Notifications() {
  const list = useLoad(() => get('/api/me/notifications'), []);
  useEffect(() => { post('/api/me/notifications/read').catch(() => {}); }, []);
  const open = (n: any) => {
    if (n.data?.orderId) go(`order/${n.data.orderId}`);
    else if (n.data?.ticketId) go(`support/${n.data.ticketId}`);
    else if (n.kind === 'verification') go('work/docs');
    else if (n.kind === 'balance') go('work');
    else if (n.kind === 'pricing') go('profile');
  };
  return (
    <main>
      <Back to="" />
      <h1>Уведомления</h1>
      {!list.data ? <Loading error={list.error} /> : !list.data.items.length ? <div className="empty">Пока ничего</div> : (
        <div className="rows">{list.data.items.map((n: any) => (
          <button key={n.id} className="list-item" style={{ width: '100%', background: n.read_at ? 'transparent' : 'var(--accent-soft)', border: 0, textAlign: 'left', color: 'inherit' }} onClick={() => open(n)}>
            <div className="stack" style={{ gap: 2 }}>
              <b style={{ fontSize: 14 }}>{n.title ?? 'TrakSOS'}</b>
              <span style={{ fontSize: 14 }}>{n.body}</span>
              <span className="note">{fmtTime(n.created_at)}</span>
            </div>
          </button>
        ))}</div>
      )}
    </main>
  );
}
