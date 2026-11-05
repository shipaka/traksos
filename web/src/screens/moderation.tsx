// Модератор: очередь споров, обжалований и отзывов, решения, журнал. Пользователь: оспорить нарушение, отзывы обо мне.
import { useState } from 'react';
import { get, post, rub, fmtTime } from '../api.ts';
import { SERVICES } from '../dict.ts';
import { useLoad, useAction, go, Loading, Back } from '../ui.tsx';

const KINDS: [string, string][] = [['dispute', 'Споры'], ['appeal', 'Обжалования'], ['review', 'Отзывы и отметки']];
const PRI: Record<number, [string, string]> = { 1: ['Срочно', 'bad'], 2: ['Обычно', 'warn'], 3: ['Не горит', ''] };

export function ModQueue() {
  const [kind, setKind] = useState<string>('dispute');
  const log = kind === 'log';
  const q = useLoad(() => get(`/api/mod/cases?${log ? 'status=resolved' : `kind=${kind}`}`), [kind], (e) => e.type === 'mod_case');
  const counts = q.data?.counts ?? {};
  return (
    <div className="stack">
      <div className="scroll-x" role="tablist">
        {KINDS.map(([k, n]) => <button key={k} className="chip" role="tab" aria-pressed={kind === k} onClick={() => setKind(k)}>{n}{counts[k] ? ` · ${counts[k]}` : ''}</button>)}
        <button className="chip" role="tab" aria-pressed={log} onClick={() => setKind('log')}>Журнал решений</button>
      </div>
      {!q.data ? <Loading error={q.error} /> : !q.data.items.length ? <div className="empty">{log ? 'Решений пока нет' : 'Очередь пуста'}</div> : (
        <div className="rows">
          {q.data.items.map((c: any) => (
            <a key={c.id} href={`#/admin/case/${c.id}`} className="list-item">
              <div className="stack" style={{ gap: 2 }}>
                <b>№{c.number} · {c.title}</b>
                <span className="note">{fmtTime(log ? c.decidedAt : c.createdAt)} · {c.openedBy ?? '—'}{c.target ? ` → ${c.target}` : ''}{log ? ` · ${c.decisionName}${c.decidedBy ? ` · ${c.decidedBy}` : ''}` : ''}</span>
              </div>
              {log ? <span className="pill">{c.kindName}</span> : <span className={`pill ${PRI[c.priority]?.[1]}`}>{PRI[c.priority]?.[0]}</span>}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function ModCase({ id }: { id: string }) {
  const c = useLoad(() => get(`/api/mod/cases/${id}`), [id]);
  const { busy, run } = useAction();
  const [note, setNote] = useState('');
  const d = c.data;
  if (!d) return <main><Back to="admin" label="Админ" /><Loading error={c.error} /></main>;
  const act = async (path: string, body: any, okText: string) => { const r = await run(() => post(`/api/mod/cases/${id}/${path}`, body), okText); if (r) c.setData(r); return r; };
  return (
    <main>
      <Back to="admin" label="Очередь" />
      <div>
        <h1>{d.kindName} №{d.number}</h1>
        <div className="sub">{d.title} · {fmtTime(d.createdAt)}</div>
      </div>
      {d.text && <div className="card"><span className="label">Что пишут</span><span style={{ whiteSpace: 'pre-wrap' }}>{d.text}</span></div>}
      {d.status === 'open' && (
        <div className="scroll-x">
          {[1, 2, 3].map((p) => <button key={p} className="chip" aria-pressed={d.priority === p} disabled={busy} onClick={() => act('priority', { priority: p }, `Приоритет: ${PRI[p][0]}`)}>{PRI[p][0]}</button>)}
        </div>
      )}
      {d.order && (
        <div className="card">
          <span className="label">Заявка</span>
          <a href={`#/order/${d.order.id}`}><b>№{d.order.number} · {SERVICES[d.order.service]?.name ?? d.order.service}</b></a>
          <dl className="kv">
            <dt>Клиент</dt><dd>{d.order.client_name ?? '—'}</dd>
            <dt>Исполнитель</dt><dd>{d.order.performer_name ?? '—'}</dd>
            <dt>Выезд</dt><dd>{rub(d.order.call_out_amount)}</dd>
            <dt>Работа</dt><dd>{rub(d.order.work_amount)}</dd>
            {d.order.result_note && <><dt>Мастер</dt><dd>{d.order.result_note}</dd></>}
          </dl>
          {d.chat.length > 0 && (
            <details>
              <summary className="note">Чат заявки · {d.chat.length} сообщ.</summary>
              <div className="stack" style={{ gap: 4, marginTop: 8 }}>
                {d.chat.map((m: any, i: number) => <span key={i} className="note"><b>{m.sender ?? 'ТракSOS'}</b> · {fmtTime(m.created_at)}: {m.body}</span>)}
              </div>
            </details>
          )}
          <button className="btn ghost small" disabled={busy} onClick={async () => { const r = await act('enter-chat', {}, 'Вы в чате — это записано в журнал'); if (r) go(`order/${r.orderId}`); }}>Войти в чат заявки</button>
        </div>
      )}
      {d.booking && (
        <div className="card">
          <span className="label">Ремонт в сервисе</span>
          <b>«{d.booking.center}» · счёт №{d.booking.number}</b>
          <span className="note">Работы: {(d.booking.works ?? []).join(', ') || '—'} · {rub(d.booking.amount)}{d.booking.discount ? ` · скидка ${rub(d.booking.discount)}` : ''}</span>
        </div>
      )}
      {d.review && (
        <div className="card">
          <span className="label">Отзыв</span>
          <b>{'★'.repeat(d.review.stars)}{'☆'.repeat(5 - d.review.stars)}</b>
          {d.review.text && <span>«{d.review.text}»</span>}
          {d.review.tags?.length > 0 && <span className="note">{d.review.tags.join(', ')}</span>}
          <span className="note">{d.review.hidden ? 'Скрыт' : d.review.disputed ? 'Оспорен — в рейтинг пока не идёт' : 'Виден'}</span>
        </div>
      )}
      {d.target && (
        <div className="card">
          <span className="label">О ком</span>
          <a href={`#/admin/user/${d.target.id}`}><b>{d.target.name ?? d.target.phone}</b></a>
          <span className="note">{d.target.status === 'blocked' ? 'Заблокирован' : 'Активен'}{d.target.rating ? ` · ★ ${d.target.rating.toFixed(2)}` : ''}</span>
        </div>
      )}
      {d.ticketId && <a className="btn ghost" href={`#/support/${d.ticketId}`}>Открыть обращение в поддержку</a>}

      {d.status === 'open' ? (
        <div className="card hi">
          <b>Решение</b>
          <textarea className="field" placeholder="Коротко — стороны увидят" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="stack">
            {Object.entries(d.decisions as Record<string, string>).map(([k, n]) => (
              <button key={k} className="opt" disabled={busy} onClick={() => act('decide', { decision: k, note: note || undefined }, `Решение: ${n}. Стороны получили уведомление`)}><b>{n}</b></button>
            ))}
          </div>
          {d.kind === 'dispute' && <span className="note">Деньги по решению — возврат или доплата — делаются в карточке оплаты заявки.</span>}
        </div>
      ) : (
        <div className="card">
          <b>{d.decisionName}</b>
          {d.decisionNote && <span>{d.decisionNote}</span>}
          <span className="note">{fmtTime(d.decidedAt)}</span>
          <button className="btn ghost small" disabled={busy} onClick={() => act('reopen', {}, 'Вернули в очередь')}>Вернуть в очередь</button>
        </div>
      )}
      {d.log.length > 0 && (
        <div className="card">
          <span className="label">Журнал</span>
          {d.log.map((l: any, i: number) => <span key={i} className="note">{fmtTime(l.created_at)} · {({ 'mod.decide': 'решение', 'mod.reopen': 'вернули в очередь', 'mod.priority': 'приоритет', 'mod.chat_open': 'модератор вошёл в чат' } as Record<string, string>)[l.action] ?? l.action}{l.data?.decision ? `: ${d.decisions[l.data.decision] ?? l.data.decision}` : ''}</span>)}
        </div>
      )}
    </main>
  );
}

/** «Оспорить нарушение или блокировку» — открыто всегда; и мои обращения к модератору */
export function Appeal() {
  const mine = useLoad(() => get('/api/my-cases'), [], (e) => e.type === 'mod_case');
  const { busy, run } = useAction();
  const [text, setText] = useState('');
  return (
    <main>
      <Back to="profile" label="Назад" />
      <div><h1>Оспорить нарушение</h1><div className="sub">Не согласны с нарушением, ограничением или решением — опишите, что произошло. Модератор разберётся и ответит.</div></div>
      <div className="card">
        <textarea className="field" value={text} onChange={(e) => setText(e.target.value)} placeholder="Что случилось, номер заявки, почему вы не согласны" />
        <button className="btn" disabled={busy || text.trim().length < 10} onClick={async () => { if (await run(() => post('/api/appeals', { text }), 'Отправлено модератору. Проверка — до 24 часов')) { setText(''); mine.reload(); } }}>Отправить модератору</button>
        <span className="note">Считаются только нарушения, подтверждённые модератором. Неподтверждённые споры никому не идут в минус.</span>
      </div>
      {mine.data && mine.data.length > 0 && (
        <div className="stack">
          <span className="label">Мои обращения к модератору</span>
          {mine.data.map((c: any) => (
            <div key={c.id} className="card">
              <div className="between"><b>{c.kindName} №{c.number}</b><span className={`pill ${c.status === 'open' ? 'warn' : 'good'}`}>{c.status === 'open' ? 'на рассмотрении' : 'решено'}</span></div>
              <span className="note">{c.title} · {fmtTime(c.createdAt)}</span>
              {c.decisionName && <span>{c.decisionName}{c.decisionNote ? ` — ${c.decisionNote}` : ''}</span>}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

/** Отзывы обо мне — с «Оспорить отзыв» */
export function MyReviews() {
  const l = useLoad(() => get('/api/me/reviews'), []);
  const { busy, run } = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState('');
  return (
    <main>
      <Back to="profile" label="Назад" />
      <div><h1>Отзывы обо мне</h1><div className="sub">Вес отзыва зависит от рейтинга автора. Оспоренный отзыв не идёт в рейтинг, пока модератор не решит.</div></div>
      {!l.data ? <Loading error={l.error} /> : !l.data.length ? <div className="empty">Отзывов пока нет</div> : l.data.map((r: any) => (
        <div key={r.id} className="card">
          <div className="between"><b>{'★'.repeat(r.stars)}{'☆'.repeat(5 - r.stars)}</b><span className="note">{fmtTime(r.created_at)}</span></div>
          {r.text && <span>«{r.text}»</span>}
          {r.tags?.length > 0 && <span className="note">{r.tags.join(', ')}</span>}
          <span className="note">{r.author_name ?? 'Автор'}{r.disputed ? ' · оспорен, ждёт модератора' : ''}</span>
          {!r.disputed && (open === r.id ? (
            <div className="stack">
              <textarea className="field" value={text} onChange={(e) => setText(e.target.value)} placeholder="Почему отзыв несправедлив" />
              <div className="grid2">
                <button className="btn small" disabled={busy || text.trim().length < 5} onClick={async () => { if (await run(() => post(`/api/reviews/${r.id}/contest`, { text }), 'Отправлено модератору')) { setOpen(null); setText(''); l.reload(); } }}>Оспорить</button>
                <button className="btn ghost small" onClick={() => setOpen(null)}>Отмена</button>
              </div>
            </div>
          ) : <button className="btn ghost small" onClick={() => setOpen(r.id)}>Оспорить отзыв</button>)}
        </div>
      ))}
    </main>
  );
}
