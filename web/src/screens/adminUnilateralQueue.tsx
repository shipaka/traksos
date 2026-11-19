import { useState } from 'react';
import { get, fmtTime, rub } from '../api.ts';
import { useLoad, Loading } from '../ui.tsx';

/** Read-only operational queue. Decisions happen through the existing moderated order flow. */
export function AdminUnilateralQueue() {
  const [refresh,setRefresh]=useState(0);
  const items=useLoad(()=>get('/api/admin/unilateral-closures'),[refresh]);
  if (!items.data) return <section className="card stack">
    <b>Работы без ответа клиента</b><Loading error={items.error} />
  </section>;
  const records=Array.isArray(items.data)?items.data:[];
  return <section className="card stack" aria-label="Работы на проверке клиента">
    <div className="between">
      <div><b>Работы без ответа клиента · {records.length}</b>
        <p className="note">Физическая работа заявлена завершённой; расчёт не принят. Молчание не означает согласия или оплату.</p></div>
      <button type="button" className="btn ghost small" onClick={()=>setRefresh(x=>x+1)}>Обновить</button>
    </div>
    {!records.length && <p className="note">Нет ожидающих решений или возражений.</p>}
    {records.map((r:any)=><a key={r.order_id} className="linkrow" href={`#/order/${encodeURIComponent(r.order_id)}`}>
      <span><b>Заявка №{r.number} · {r.status==='disputed'?'Спор':'Ждём клиента'}</b>
        <small>{fmtTime(r.created_at)} · {r.reason==='no_connection'?'Нет связи':r.reason==='customer_absent'?'Клиент не отвечает':'Причина указана в заявке'}</small>
        <small>{r.comment}</small></span>
      <span><b>{rub(r.work_amount)}</b><small>Работа, без выезда/сбора</small></span>
    </a>)}
  </section>;
}
