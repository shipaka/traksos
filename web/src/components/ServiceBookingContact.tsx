import { useState } from 'react';
import { get, post } from '../api.ts';
import { useAction, useLoad } from '../ui.tsx';

/** Диалог загружается только по явному запросу пользователя. */
export function ServiceBookingContact({ bookingId, asService = false }: { bookingId: string; asService?: boolean }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [reason, setReason] = useState('');
  const [blocking, setBlocking] = useState(false);
  const { busy, run } = useAction();
  const messages = useLoad(() => open ? get(`/api/bookings/${bookingId}/messages`) : Promise.resolve(null), [bookingId,open]);
  const send = async () => {
    if (!body.trim()) return;
    if ((await run(() => post(`/api/bookings/${bookingId}/messages`, {body}), 'Сообщение отправлено')) !== undefined) {setBody('');messages.reload();}
  };
  return <section className="card" style={{gap:12}}>
    <div className="between"><b>Связь по записи</b><button className="btn ghost small" type="button" onClick={() => setOpen(v=>!v)}>{open ? 'Свернуть диалог' : 'Написать сообщение'}</button></div>
    <span className="note">Переписка открывается по вашему запросу. Прямые номера не отображаются. При плохой связи можно написать текстом.</span>
    {open && <>
      <div className="stack" style={{maxHeight:300,overflowY:'auto',gap:8}} aria-live="polite">
        {(messages.data?.messages ?? []).map((m:any)=><div className="card flat" key={m.id}><span>{m.body}</span><small className="note">{new Date(m.created_at).toLocaleString('ru-RU')}</small></div>)}
        {!messages.data && <span className="note">Загрузка сообщений…</span>}
        {messages.data && !messages.data.messages.length && <span className="note">Сообщений пока нет.</span>}
      </div>
      {messages.data?.blocked && !messages.data?.canMessage && !asService ? <span className="note">Новые сообщения ограничены рембазой. При необходимости обратитесь в поддержку.</span> : <>
        <textarea className="field" rows={3} maxLength={2000} placeholder="Напишите о времени приезда, въезде или проблеме со связью" value={body} onChange={e=>setBody(e.target.value)}/>
        <div className="row"><button className="btn" disabled={busy || !body.trim()} onClick={send}>Отправить</button><button className="btn ghost small" onClick={()=>messages.reload()}>Обновить</button></div>
      </>}
      {asService && <div className="stack"><button className="btn ghost small" onClick={()=>setBlocking(v=>!v)}>{messages.data?.blocked ? 'Снять ограничение' : 'Ограничить сообщения клиента'}</button>
        {blocking && <><input className="field" placeholder="Причина блокировки" value={reason} onChange={e=>setReason(e.target.value)}/><button className="btn ghost small" disabled={busy || (!messages.data?.blocked && reason.trim().length<5)} onClick={async()=>{if((await run(()=>post(`/api/bookings/${bookingId}/contact-block`,{blocked:!messages.data?.blocked,reason}), 'Ограничение обновлено')) !== undefined){setBlocking(false);setReason('');messages.reload();}}}>Подтвердить</button></>}
      </div>}
    </>}
    <a href="#/support/new" className="note">Спор или жалоба? Обратиться к администратору</a>
  </section>;
}
