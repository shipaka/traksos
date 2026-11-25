// Модератор: очередь споров, обжалований и отзывов, решения, журнал. Пользователь: оспорить нарушение, отзывы обо мне.
import { useState } from 'react';
import { get, post, rub, fmtTime } from '../api.ts';
import { SERVICES } from '../dict.ts';
import { useLoad, useAction, useMe, go, Loading, Back } from '../ui.tsx';
import {usePrivateRead} from './privateRead20261124.ts';

const KINDS: [string, string][] = [['dispute', 'Споры'], ['appeal', 'Обжалования'], ['review', 'Отзывы и отметки']];
const PRI: Record<number, [string, string]> = { 1: ['Срочно', 'bad'], 2: ['Обычно', 'warn'], 3: ['Не горит', ''] };

export function ModQueue({initialKind='dispute'}:{initialKind?:'dispute'|'log'}={}) {
  const {me}=useMe();
  return <ModQueueForAccount key={(me?.id??'guest')+':'+initialKind} initialKind={initialKind}/>;
}
function ModQueueForAccount({initialKind}:{initialKind:'dispute'|'log'}){
  const [kind, setKind] = useState<string>(initialKind);
  const [qualityOpen,setQualityOpen]=useState(false);
  const log = kind === 'log';
  const q = useLoad(async()=>({kind,payload:await get(`/api/mod/cases?${log ? 'status=resolved' : `kind=${kind}`}`)}), [kind], (e) => e.type === 'mod_case'||e.type==='connection_restored');
  const data=!q.error&&q.data?.kind===kind?q.data.payload:null;
  const counts = data?.counts ?? {};
  const total = Object.values(counts as Record<string, number>).reduce((a, b) => a + b, 0);
  const urgent = log||!data ? null : (data.items ?? []).filter((c: any) => c.priority === 1).length;
  return (
    <div className="stack">
      <div className="grid2">
        <div className="card tile"><span className="label">В очереди</span><span className="tile-value">{data?total:'—'}</span></div>
        <div className="card tile"><span className="label">Срочно</span><span className="tile-value" style={{ color: urgent ? 'var(--bad)' : undefined }}>{urgent ?? '—'}</span><span className="note">в этой вкладке</span></div>
      </div>
      <span className="note">Срочные — сверху. Проверка исполнителей и подозрительное — в соседних разделах кабинета.</span>
      <button type="button" className="btn ghost small" aria-expanded={qualityOpen} onClick={()=>setQualityOpen(v=>!v)}>{qualityOpen?'Скрыть претензии к качеству':'Претензии к качеству ремонта'}</button>
      {qualityOpen&&<WarrantyQueue/>}
      <div className="scroll-x" role="group" aria-label="Типы обращений">
        {KINDS.map(([k, n]) => <button type="button" key={k} className="chip" aria-pressed={kind === k} onClick={() => setKind(k)}>{n}{counts[k] ? ` · ${counts[k]}` : ''}</button>)}
        <button type="button" className="chip" aria-pressed={log} onClick={() => setKind('log')}>Журнал решений</button>
      </div>
      {!data ? <div className="stack"><Loading error={q.error}/>{q.error&&<button className="btn ghost small" type="button" onClick={q.reload}>Повторить загрузку дел</button>}</div> : !data.items.length ? <div className="empty">{log ? 'Решений пока нет' : 'Очередь пуста'}</div> : (
        <div className="rows">
          {data.items.map((c: any) => (
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

const QUALITY_DECISIONS=[['not_fault','Недостаток не связан с работой'],['repair_by_original','Устранение первоначальным исполнителем'],['repair_by_alternative','Устранение другим исполнителем'],['partial_refund','Частичный возврат'],['full_refund','Полный возврат'],['needs_external_review','Нужна независимая оценка']] as const;
function WarrantyQueue(){
  const {me}=useMe();
  const scope=(me?.id??'guest')+':quality';
  const [filter,setFilter]=useState('');
  const [selected,setSelected]=useState('');
  const list=usePrivateRead<any[]>(()=>get('/api/admin/warranty-claims'+(filter?'?status='+encodeURIComponent(filter):'')),scope+':'+filter,e=>e.type==='warranty'||e.type==='connection_restored');
  return <section className="card stack" aria-label="Претензии к качеству ремонта">
    <b>Претензии к качеству ремонта</b><span className="note">Решение — отдельный этап. Оно не выполняет возврат или удержание автоматически.</span>
    <select className="field" aria-label="Статус претензии" value={filter} onChange={e=>{setFilter(e.target.value);setSelected('');}}>
      <option value="">Все статусы</option><option value="submitted">Получены</option><option value="reviewing">На проверке</option><option value="appealed">Апелляции</option><option value="decision_recorded">Решения</option>
    </select>
    {!list.data?<><Loading error={list.error}/>{list.error&&<button className="btn ghost small" onClick={list.reload}>Повторить загрузку претензий</button>}</>:list.data.length===0?<span className="note">По выбранному статусу претензий нет.</span>:list.data.map(row=><button key={row.id} type="button" className="linkrow" aria-pressed={selected===row.id} onClick={()=>setSelected(row.id)}><span><b>Претензия №{row.number} · заказ №{row.order_number}</b><small>{row.defect_description}</small></span><span>›</span></button>)}
    {selected&&<WarrantyReview key={scope+':'+selected} id={selected} refresh={list.reload}/>}
  </section>;
}
function WarrantyReview({id,refresh}:{id:string;refresh:()=>void}){
  const {me}=useMe();
  const detail=usePrivateRead<any>(()=>get('/api/warranty-claims/'+id),(me?.id??'guest')+':quality-detail:'+id,e=>e.type==='warranty'||e.type==='connection_restored');
  const {busy,run}=useAction();
  const [decision,setDecision]=useState('');
  const [note,setNote]=useState('');
  const [uncertain,setUncertain]=useState(false);
  const d=detail.data;
  const act=async(path:string,body:unknown,label:string)=>{
    if(busy||uncertain||!d)return;
    const r=await run(()=>post('/api/admin/warranty-claims/'+id+'/'+path,body),label);
    if(!r?.id)setUncertain(true);else{setNote('');setDecision('');}
    await detail.reload();refresh();
  };
  if(!d)return <div className="stack"><Loading error={detail.error}/>{detail.error&&<button className="btn ghost small" onClick={detail.reload}>Повторить загрузку дела</button>}</div>;
  return <div className="card stack">
    <b>Претензия №{d.number}</b><span>Недостаток: {d.defect}</span>{d.evidence&&<p>Доказательства: {d.evidence}</p>}{d.performerExplanation&&<p>Ответ исполнителя: {d.performerExplanation}</p>}
    {d.decisionNote&&<p>Предыдущее решение: {d.decisionNote}</p>}
    <details><summary>Журнал рассмотрения</summary>{Array.isArray(d.events)&&d.events.map((e:any,i:number)=><div className="note" key={i}>{fmtTime(e.createdAt)} · {e.data?.note??e.data?.reason??e.event}</div>)}</details>
    {uncertain&&<div role="alert" className="note">Действие не подтверждено. Сверьте журнал. <button type="button" className="btn ghost small" onClick={()=>setUncertain(false)}>Состояние проверено</button></div>}
    {['submitted','appealed'].includes(d.status)&&<button className="btn ghost" disabled={busy||uncertain} onClick={()=>void act('review',{},'Проверка начата')}>Взять на проверку</button>}
    {['submitted','reviewing','appealed'].includes(d.status)&&<>
      <label className="stack">Решение<select className="field" value={decision} onChange={e=>setDecision(e.target.value)}><option value="">Выберите решение</option>{QUALITY_DECISIONS.map(([k,label])=><option key={k} value={k}>{label}</option>)}</select></label>
      <label className="stack">Факты и мотивировка<textarea className="field" maxLength={3000} value={note} onChange={e=>setNote(e.target.value)}/></label>
      <button className="btn" disabled={busy||uncertain||!decision||note.trim().length<20} onClick={()=>void act('decide',{decision,note},'Решение зафиксировано')}>Зафиксировать решение</button>
    </>}
  </div>;
}

export function ModCase({id}:{id:string}){
  const {me,mode}=useMe();
  return <ModCaseForAccount key={(me?.id??'guest')+':'+mode+':'+id} id={id}/>;
}
function ModCaseForAccount({ id }: { id: string }) {
  const { mode } = useMe();
  const backTo = mode === 'moderator' ? 'moderation/cases' : 'admin';
  const c = useLoad(() => get(`/api/mod/cases/${id}`), [id]);
  const { busy, run } = useAction();
  const [note, setNote] = useState('');
  const [unconfirmed,setUnconfirmed]=useState(false);
  const d = c.error?null:c.data;
  if (!d) return <main><Back to={backTo} label="Очередь" /><Loading error={c.error} />{c.error&&<button type="button" className="btn ghost small" onClick={c.reload}>Повторить загрузку дела</button>}</main>;
  const act = async (path: string, body: any, okText: string) => {
    if(busy||unconfirmed)return;
    const r = await run(() => post(`/api/mod/cases/${id}/${path}`, body), okText);
    if(r){if(path!=='enter-chat')c.setData(r);}
    else{setUnconfirmed(true);void c.reload();}
    return r;
  };
  return (
    <main>
      <Back to={backTo} label="Очередь" />
      {unconfirmed&&<div className="banner warn" role="alert">Ответ на действие не подтверждён. Сверьте состояние дела и журнал перед повтором. <button type="button" className="btn ghost small" onClick={async()=>{await c.reload();}}>Обновить дело</button> <button type="button" className="btn ghost small" onClick={()=>setUnconfirmed(false)}>Состояние проверено</button></div>}
      <div>
        <h1>{d.kindName} №{d.number}</h1>
        <div className="sub">{d.title} · {fmtTime(d.createdAt)}</div>
      </div>
      {d.text && <div className="card"><span className="label">Что пишут</span><span style={{ whiteSpace: 'pre-wrap' }}>{d.text}</span></div>}
      {d.status === 'open' && (
        <div className="scroll-x">
          {[1, 2, 3].map((p) => <button key={p} className="chip" aria-pressed={d.priority === p} disabled={busy||unconfirmed} onClick={() => act('priority', { priority: p }, `Приоритет: ${PRI[p][0]}`)}>{PRI[p][0]}</button>)}
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
                {d.chat.map((m: any, i: number) => <span key={i} className="note"><b>{m.sender ?? 'TrakSOS'}</b> · {fmtTime(m.created_at)}: {m.body}</span>)}
              </div>
            </details>
          )}
          <button className="btn ghost small" disabled={busy||unconfirmed} onClick={async () => { const r = await act('enter-chat', {}, 'Вы в чате — это записано в журнал'); if (r) go(`order/${r.orderId}`); }}>Войти в чат заявки</button>
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
          {mode === 'admin' ? <a href={`#/admin/user/${d.target.id}`}><b>{d.target.name ?? d.target.phone}</b></a> : <b>{d.target.name ?? d.target.phone}</b>}
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
              <button key={k} className="opt" disabled={busy||unconfirmed} onClick={() => act('decide', { decision: k, note: note || undefined }, `Решение: ${n}. Стороны получили уведомление`)}><b>{n}</b></button>
            ))}
          </div>
          {d.kind === 'dispute' && <span className="note">Деньги по решению — возврат или доплата — делаются в карточке оплаты заявки.</span>}
        </div>
      ) : (
        <div className="card">
          <b>{d.decisionName}</b>
          {d.decisionNote && <span>{d.decisionNote}</span>}
          <span className="note">{fmtTime(d.decidedAt)}</span>
          <button className="btn ghost small" disabled={busy||unconfirmed} onClick={() => act('reopen', {}, 'Вернули в очередь')}>Вернуть в очередь</button>
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
  const [why, setWhy] = useState('');
  const REASONS = ['ДТП', 'Сломалась машина', 'Здоровье', 'Задержали на прошлом заказе', 'Клиент не на месте', 'Не согласен с отзывом', 'Другое'];
  return (
    <main>
      <Back to="profile" label="Назад" />
      <div><h1>Оспорить нарушение</h1><div className="sub">Не согласны с нарушением, ограничением или решением — опишите, что произошло. Модератор разберётся и ответит.</div></div>
      <div className="card">
        <span className="label">Что произошло</span>
        <div className="row" style={{ gap: 6 }}>{REASONS.map((r) => <button key={r} type="button" className="chip" aria-pressed={why === r} onClick={() => setWhy(why === r ? '' : r)}>{r}</button>)}</div>
        <textarea className="field" value={text} onChange={(e) => setText(e.target.value)} placeholder="Коротко, как было: где, когда, номер заявки, почему не смогли предупредить" />
        <button className="btn" disabled={busy || text.trim().length < 10} onClick={async () => { if (await run(() => post('/api/appeals', { text: why ? `${why}. ${text}` : text }), 'Отправлено модератору. Проверка — до 24 часов')) { setText(''); setWhy(''); mine.reload(); } }}>Отправить модератору</button>
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
