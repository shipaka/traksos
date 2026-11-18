import {useState} from 'react';
import {get,post,fmtTime} from '../api.ts';
import {useAction,useLoad,useMe} from '../ui.tsx';

const titles:Record<string,string> = {
 tow:'Эвакуатор',sto:'СТО',master:'Выездной мастер',ecu:'Ремонт ЭБУ',
};

/**
 * Performer recommends, fleet owner decides whether to look for another
 * provider, and the owner submits a separate priced order or booking.
 * Neither the advice nor this decision changes the original order state.
 */
export function OrderContinuations({order:o}:{order:any}) {
 const {me}=useMe();
 const recs=useLoad<any[]>(()=>get('/api/orders/'+o.id+'/continuations'),[o.id],
  e=>e.orderId===o.id && e.type==='order');
 const {busy,run}=useAction();
 const [target,setTarget]=useState<'tow'|'sto'|'master'|'ecu'>(o.service==='consult'?'master':o.service==='tow'?'sto':'tow');
 const [reason,setReason]=useState('');
 const isPerformer=o.you==='performer';
 const client=o.you==='client';
 const owner=client&&!me?.owner_id;
 const canSuggest=isPerformer && (
  ['arrived','working','awaiting_confirmation','completed'].includes(o.status)
 );
 const targets=o.service==='consult'?['master','tow','sto','ecu']
  :o.service==='tow'?['sto']:['tow','sto','ecu'];
 if(!client&&!isPerformer||!targets.length)return null;
 const rows=recs.data??[];
 const nextLink=(r:any)=>{
  const suffix='&recommendation='+r.id;
  if(r.target_kind==='master')return '#/new/diag?from='+o.id+suffix;
  if(r.target_kind==='sto')return '#/services?case='+o.id+suffix;
  if(o.service==='consult')return '#/new/tow?from='+o.id+suffix;
  if(['completed'].includes(o.status))return '#/new/tow?continue='+o.id+suffix;
  return '#/new/tow?parallel='+o.id+suffix;
 };
 return <section className="card stack" aria-label="Продолжение обращения">
  <b>Продолжить обращение · мультизаявка</b>
  <span className="note">Это рекомендация к следующей услуге, а не новая платная заявка. Исходная работа и расчёты сохраняются отдельно.</span>
  {canSuggest&&<>
   <label className="label" htmlFor={'continuation-target-'+o.id}>Кого предложить клиенту</label>
   <select className="field" id={'continuation-target-'+o.id} value={target}
    onChange={e=>setTarget(e.target.value as 'tow'|'sto'|'master'|'ecu')}>
    {targets.map(k=><option key={k} value={k}>{titles[k]}</option>)}
   </select>
   <textarea className="field" rows={3} maxLength={1000} value={reason}
    placeholder="Заключение: что обнаружили, почему нужен следующий специалист или эвакуация"
    onChange={e=>setReason(e.target.value)}/>
   <button className="btn ghost small" disabled={busy||reason.trim().length<12||
      rows.some(r=>r.target_kind===target)}
    onClick={async()=>{
     if(await run(()=>post('/api/orders/'+o.id+'/continuations',
       {target,summary:reason}),'Рекомендация отправлена владельцу')) {
       setReason('');recs.reload();
     }
    }}>Предложить продолжение клиенту</button>
  </>}
  {!recs.data && recs.error && <span className="note">{String(recs.error)}</span>}
  {rows.map((r:any)=><div className="card flat stack" key={r.id}>
   <div className="between"><b>{titles[r.target_kind]??r.target_kind}</b>
    <span className="pill">{r.next_order_id||r.next_booking_id||r.next_ecu_handoff_id?'Создан следующий этап':
       r.status==='pending'?'Ожидает решения':
       r.status==='approved'?'Поиск согласован':'Отказано'}</span></div>
   <p>{r.summary}</p>
   <small className="note">{fmtTime(r.created_at)} · Следующую услугу подтверждает владелец; условия оплаты отдельно</small>
   {owner&&r.status==='pending'&&<div className="row">
    <button className="btn small" disabled={busy} onClick={async()=>{
     if(await run(()=>post('/api/orders/'+o.id+'/continuations/'+r.id+'/decision',
      {approve:true}),'Поиск следующего специалиста разрешён'))recs.reload();
    }}>Согласовать поиск</button>
    <button className="btn ghost small" disabled={busy} onClick={async()=>{
     if(await run(()=>post('/api/orders/'+o.id+'/continuations/'+r.id+'/decision',
      {approve:false}),'Продолжение отклонено'))recs.reload();
    }}>Отказаться</button>
   </div>}
   {owner&&r.status==='approved'&&r.target_kind==='ecu'&&!r.next_ecu_handoff_id&&
    <button className="btn small" disabled={busy} onClick={async()=>{
     const created=await run(()=>post('/api/orders/'+o.id+'/ecu-handoff',
       {summary:r.summary}), 'Заключение направлено мастерским ЭБУ');
     if(created)recs.reload();
    }}>Направить заключение специалистам ЭБУ</button>}
   {r.next_ecu_handoff_id&&<a className="btn ghost small"
     href={'#/ecu-handoff/'+r.next_ecu_handoff_id}>Открыть предложения диагностики ЭБУ</a>}
   {owner&&r.status==='approved'&&r.target_kind!=='ecu'&&!r.next_order_id&&!r.next_booking_id&&
    <a className="btn small" href={nextLink(r)}>
     {r.target_kind==='sto'?'Выбрать СТО и оформить запись':
      r.target_kind==='master'?'Выбрать мастера и проверить цену':
      'Оформить эвакуацию и получить предложения'}
    </a>}
   {owner&&r.next_order_id&&<a className="btn ghost small" href={'#/order/'+r.next_order_id}>
    Открыть следующий заказ</a>}
   {owner&&r.next_booking_id&&<a className="btn ghost small" href={'#/booking/'+r.next_booking_id}>
    Открыть запись на СТО</a>}
   {client&&!owner&&r.status==='pending'&&<span className="note">Ожидаем решения владельца автопарка. Водитель не подтверждает новые платные услуги.</span>}
  </div>)}
 </section>;
}
