// Поддержка: список обращений, переписка, новое обращение (по заявке или без). Для сотрудников — то же, плюс «Закрыть».

import { useEffect, useRef, useState } from 'react';
import { get, post, fmtTime, fmtPhone, onEvent, rub } from '../api.ts';

const ENTRY_KIND: Record<string, string> = {
  earning: 'Начислено за заявку', payout: 'Выплата', adjustment: 'Корректировка', refund_charge: 'Удержание за возврат',
  cash_commission: 'Комиссия с наличных', cash_commission_paid: 'Комиссия оплачена',
};
import { useLoad, useAction, useMe, Loading, Back, go } from '../ui.tsx';

/** A completed old-session request may not navigate or broadcast in a new one. */
function useSupportSessionAlive() {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  return alive;
}

export function SupportList() {
  const { me } = useMe();
  return <SupportListSession key={me?.id ?? 'guest'} />;
}

function SupportListSession() {
  const { me } = useMe();
  // Scope tickets to the authenticated account even when the route survives a
  // fast logout/login; never show the previous user's cached conversation list.
  const list = useLoad(() => get('/api/support'), [me?.id], (e) => e.type === 'support');
  return (
    <main>
      <Back to="profile" />
      <div className="between"><h1>Поддержка</h1><button type="button" className="btn small" onClick={() => go('support/new')}>Написать</button></div>
      <span className="note">Обращение сохраняется в личном кабинете. Первый ответ специалиста — в течение часа; если ответ задерживается, обращение передаётся администратору.</span>
      {!list.data ? <div className="stack">
        <Loading error={list.error} />
        {list.error && <button type="button" className="btn ghost small" onClick={() => void list.reload()}>Повторить загрузку обращений</button>}
      </div> : !list.data.length ? <div className="empty">Обращений пока нет</div> : (
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
  const { me } = useMe();
  const orderId = new URLSearchParams(location.hash.split('?')[1] ?? '').get('order') ?? undefined;
  // Never carry a previous account's support draft into another identity.
  return <SupportNewSession key={(me?.id ?? 'guest') + ':' + (orderId ?? '')} orderId={orderId} />;
}

function SupportNewSession({ orderId }: { orderId?: string }) {
  const alive = useSupportSessionAlive();
  const topics = useLoad(() => get('/api/support/topics'), []);
  const { busy, run } = useAction();
  // Backend deduplicates order-linked tickets, but not standalone requests.
  // A synchronous lock prevents two near-simultaneous taps making two tickets
  // before React's busy state has had a chance to re-render the button.
  const sendingRef = useRef(false);
  const [topic, setTopic] = useState('');
  const [text, setText] = useState('');
  return (
    <main>
      <Back to={orderId ? `order/${orderId}` : 'support'} />
      <h1>{orderId ? 'Позвать поддержку' : 'Написать в поддержку'}</h1>
      {topics.error && <div className="stack" role="alert">
        <span className="note">Не удалось загрузить темы обращений: {topics.error}</span>
        <button type="button" className="btn ghost small" onClick={() => void topics.reload()}>Повторить загрузку тем</button>
      </div>}
      {!topics.data && !topics.error && <span className="note" role="status">Получаем доступные темы поддержки…</span>}
      <div className="row" role="group" aria-label="Тема обращения">{(topics.data ?? []).map((t: string) =>
        <button type="button" key={t} className="chip" disabled={busy} aria-pressed={topic === t} onClick={() => setTopic(t)}>{t}</button>)}</div>
      <textarea className="field" aria-label="Описание проблемы" maxLength={2000} placeholder="Что случилось — коротко" value={text} onChange={(e) => setText(e.target.value)} />
      <button type="button" className="btn" disabled={busy || !topics.data?.includes(topic) || text.trim().length < 3} onClick={async () => {
        if (sendingRef.current) return;
        sendingRef.current = true;
        try {
          const r = await run(() => post('/api/support', {
            topic, text: text.trim(), orderId
          }), 'Обращение зарегистрировано');
          if (r && alive.current) location.replace(`#/support/${r.id}`);
          // If the mobile response was lost, do not erase the draft. The user
          // can inspect the list before deliberately retrying a new ticket.
        } finally { sendingRef.current = false; }
      }}>Отправить</button>
    </main>
  );
}

export function SupportThread({ id }: { id: string }) {
  const { me, mode } = useMe();
  // Old GET/POST and sensitive drafts remain in an unmounted session only.
  return <SupportThreadSession key={(me?.id ?? 'guest') + ':' + mode + ':' + id} id={id} />;
}

function SupportThreadSession({ id }: { id: string }) {
  const alive = useSupportSessionAlive();
  const { me, mode } = useMe();
  const th = useLoad(() => get(`/api/support/${id}`), [id], (e) => e.type === 'support' && e.ticketId === id);
  const { busy, run } = useAction();
  const [text, setText] = useState('');
  const sendingRef = useRef(false);
  const closingRef = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.scrollTo(0, box.current.scrollHeight); }, [th.data?.messages.length]);
  // useLoad already owns the matching support event subscription. A second
  // subscription used to launch two competing GETs for each single event.
  if (!th.data) return <main><Back to="support" /><div className="stack">
    <Loading error={th.error} />
    {th.error && <button type="button" className="btn ghost small"
      onClick={() => void th.reload()}>Повторить загрузку переписки</button>}
  </div></main>;
  const t = th.data;
  const staff = mode === 'admin' || mode === 'moderator';
  const backTo = mode === 'moderator' ? 'moderation/support' : staff ? 'admin' : 'support';
  return (
    <main>
      <Back to={backTo} />
      <div className="between" style={{ alignItems: 'flex-start' }}>
        <div>
          <h1>№{t.number} · {t.topic}</h1>
          <div className="sub">{fmtTime(t.createdAt)}{t.order ? ` · заявка №${t.order.number}` : ''}</div>
        </div>
        <span className={`pill ${t.status === 'open' ? 'accent' : ''}`}>{t.status === 'open' ? 'Открыто' : 'Закрыто'}</span>
      </div>
      <div className="row">
        {t.order && <a className="btn ghost small" href={`#/order/${t.order.id}`}>Открыть заявку</a>}
        {mode === 'admin' && t.author && <a className="btn ghost small" href={`#/admin/user/${t.author.id}`}>{t.author.name ?? fmtPhone(t.author.phone)} — карточка</a>}
      </div>
      {t.entry && mode !== 'moderator' && (
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
            if (sendingRef.current || closingRef.current || busy || !text.trim()) return;
            sendingRef.current = true;
            try {
              const posted = await run(() => post(`/api/support/${id}/messages`, { body: text }), null);
              if (posted && alive.current) {
                setText('');
                void th.reload();
              }
              // On an uncertain timeout the original draft remains visible;
              // never auto-POST the same message a second time.
            } finally { sendingRef.current = false; }
          }}>
            <input className="field" aria-label="Сообщение поддержке" placeholder="Сообщение" value={text} onChange={(e) => setText(e.target.value)} />
            <button type="submit" className="btn small" disabled={busy || !text.trim()}>➤</button>
          </form>
        )}
      </div>
      {t.status === 'open' && <button type="button" className="btn ghost" disabled={busy} onClick={async () => {
        if (closingRef.current || sendingRef.current || busy) return;
        closingRef.current = true;
        try {
          const closed = await run(() => post(`/api/support/${id}/close`), 'Обращение закрыто');
          if (closed && alive.current) void th.reload();
        } finally { closingRef.current = false; }
      }}>{staff ? 'Закрыть обращение' : 'Вопрос решён — закрыть'}</button>}
      {t.status === 'closed' && <button className="btn" onClick={() => go(t.order ? `support/new?order=${t.order.id}` : 'support/new')}>Новое обращение</button>}
    </main>
  );
}

/** Очередь обращений для сотрудников */
export function SupportQueue() {
  const { me } = useMe();
  return <SupportQueueSession key={me?.id ?? 'guest'} />;
}

function SupportQueueSession() {
  const [status, setStatus] = useState<'open' | 'closed'>('open');
  return <div className="stack">
    <div className="grid2">
      <button type="button" className="seg" aria-pressed={status === 'open'} onClick={() => setStatus('open')}>Открытые</button>
      <button type="button" className="seg" aria-pressed={status === 'closed'} onClick={() => setStatus('closed')}>Закрытые</button>
    </div>
    <SupportQueueResults key={status} status={status}/>
  </div>;
}

function SupportQueueResults({ status }: { status: 'open' | 'closed' }) {
  // Remount immediately on a filter change: stale GET cannot paint the other tab.
  const q = useLoad(() => get(`/api/admin/support?status=${status}`), [status], (e) => e.type === 'support');
  return (
    <>
      {!q.data ? <div className="stack">
        <Loading error={q.error} />
        {q.error && <button type="button" className="btn ghost small" onClick={() => void q.reload()}>Повторить загрузку очереди</button>}
      </div> : !q.data.length ? <div className="empty">{status === 'open' ? 'Открытых обращений нет' : 'Пусто'}</div> : (
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
    </>
  );
}

// Уведомления -----------------------------------------------------------------

export function useUnread() {
  const { me } = useMe();
  const [n, setN] = useState(0);
  useEffect(() => {
    // The header remains mounted through role switches. A previous account's
    // unread badge (or a late GET for it) must never appear on the next login.
    let active = true;
    let generation = 0;
    setN(0);
    if (!me?.id) return () => { active = false; };
    const load = () => {
      const current = ++generation;
      void get('/api/me/notifications')
        .then((result: { unread: number }) => {
          if (active && current === generation && Number.isSafeInteger(result.unread))
            setN(Math.max(0,result.unread));
        }).catch(() => { /* Keep last confirmed count; never fake zero on outage. */ });
    };
    load();
    const stop = onEvent(() => load());
    window.addEventListener('traksos:notifications-read',load);
    return () => {
      active = false;
      stop();
      window.removeEventListener('traksos:notifications-read',load);
    };
  }, [me?.id]); // eslint-disable-line
  return n;
}

export function Notifications() {
  const { me } = useMe();
  return <NotificationsSession key={me?.id ?? 'guest'} />;
}

function NotificationsSession() {
  const alive = useSupportSessionAlive();
  const { me } = useMe();
  const list = useLoad(() => get('/api/me/notifications'), [me?.id]);
  const [readError,setReadError]=useState('');
  const [markingAll,setMarkingAll]=useState(false);
  const [openingId,setOpeningId]=useState<number|null>(null);
  const open = async (n: any) => {
    if (openingId !== null || markingAll) return;
    setOpeningId(n.id);
    setReadError('');
    if (!n.read_at) {
      try {
        // Only the owning user can mark this actual row as read. The backend
        // verifies user_id and returns 404 for foreign/missing IDs.
        await post(`/api/me/notifications/${n.id}/read`);
        if (!alive.current) return;
        window.dispatchEvent(new Event('traksos:notifications-read'));
        void list.reload(); // update read styling for non-navigating messages
      } catch {
        if (alive.current)
          setReadError('Не удалось отметить уведомление прочитанным. Повторите после восстановления связи.');
        // The destination may still be useful offline for THIS account.
      }
    }
    if (!alive.current) return;
    if (n.data?.orderId) go(`order/${n.data.orderId}`);
    else if (n.data?.ticketId) go(`support/${n.data.ticketId}`);
    else if (n.kind === 'verification') go('work/docs');
    else if (n.kind === 'balance') go('work');
    else if (n.kind === 'pricing') go('profile');
    if (alive.current) setOpeningId(null);
  };
  return (
    <main>
      <Back to="" />
      <div className="between notifications-header"><h1>Уведомления</h1>
        <button type="button" className="btn ghost small" disabled={markingAll || openingId !== null || !list.data?.unread} onClick={async()=>{
          setMarkingAll(true);setReadError('');
          try{
            await post('/api/me/notifications/read');
            if (!alive.current) return;
            await list.reload();
            if (alive.current) window.dispatchEvent(new Event('traksos:notifications-read'));
          }catch{
            if (alive.current) setReadError('Не удалось отметить уведомления: соединение недоступно');
          }finally{
            if (alive.current) setMarkingAll(false);
          }
        }}>Прочитать все</button>
      </div>
      {readError && <p className="err" role="alert">{readError}</p>}
      {!list.data ? <div className="stack">
        <Loading error={list.error} />
        {list.error && <button type="button" className="btn ghost small" onClick={() => void list.reload()}>Повторить загрузку уведомлений</button>}
      </div> : !list.data.items.length ? <div className="empty">Пока ничего</div> : (
        <div className="rows">{list.data.items.map((n: any) => (
          <button type="button" key={n.id} className="list-item"
            aria-label={`Уведомление: ${n.title ?? 'TrakSOS'}. ${n.read_at ? 'Прочитано' : 'Не прочитано'}`}
            disabled={openingId !== null || markingAll}
            style={{ width: '100%', background: n.read_at ? 'transparent' : 'var(--accent-soft)', border: 0, textAlign: 'left', color: 'inherit' }} onClick={() => void open(n)}>
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
