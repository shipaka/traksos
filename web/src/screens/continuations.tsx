import {useLayoutEffect,useRef,useState} from 'react';
import {get,getToken,post,fmtTime} from '../api.ts';
import {useAction,useMe} from '../ui.tsx';
import {usePrivateRead} from './privateRead20261124.ts';

const titles:Record<string,string> = {
 tow:'Эвакуатор',sto:'СТО',master:'Выездной мастер',ecu:'Ремонт ЭБУ',
};

/**
 * Performer recommends, fleet owner decides whether to look for another
 * provider, and the owner submits a separate priced order or booking.
 * Neither the advice nor this decision changes the original order state.
 */
export function OrderContinuations({order:o}:{order:any}) {
 const context=useMe(),me=context?.me,token=getToken();
 if(!me||!token||!['client','performer'].includes(o.you))return null;
 const scope=JSON.stringify([me.id,token,context.mode,o.id,o.you,me.owner_id??null,o.service]);
 return <ContinuationAccount key={scope} scope={scope} token={token} order={o}/>;
}

function ContinuationAccount({scope,token,order:o}:{scope:string;token:string;order:any}){
 const {me}=useMe();
 const alive=useRef(true),actionRef=useRef(false);
 useLayoutEffect(()=>{alive.current=true;return ()=>{alive.current=false;};},[]);
 const current=()=>alive.current&&getToken()===token;
 const recs=usePrivateRead<any[]>(()=>get('/api/orders/'+o.id+'/continuations'),scope,e=>e.orderId===o.id&&e.type==='order');
 const {busy,run}=useAction();
 const targets=o.service==='consult'?['master','tow','sto','ecu']
  :o.service==='tow'?['sto']:['tow','sto','ecu'];
 type Target='tow'|'sto'|'master'|'ecu';
 const initialTarget=(o.service==='consult'?'master':o.service==='tow'?'sto':'tow') as Target;
 // An order/account switch invalidates BOTH the fetched private list and the
 // local recommendation draft, even before React effects have run.
 const [draft,setDraft]=useState<{scope:string;target:Target;reason:string}>({
  scope,target:initialTarget,reason:'',
 });
 const target:Target=draft.scope===scope && targets.includes(draft.target)
  ? draft.target : initialTarget;
 const reason=draft.scope===scope?draft.reason:'';
 const setTarget=(next:Target)=>setDraft({scope,target:next,reason});
 const setReason=(next:string)=>setDraft({scope,target,reason:next});
 const submit=async(request:()=>Promise<any>,message:string,onSuccess?:()=>void)=>{
  if(actionRef.current||!me||!current()||recs.loading||recs.error)return;
  actionRef.current=true;
  try{
   const result=await run(request,message);
   // A response for account/order A may not clear B's draft or reload B's
   // private resource. Backend writes are authorized independently.
   if(result && current()){
    onSuccess?.();
    await recs.reload();
   }
  }finally{actionRef.current=false;}
 };
 const isPerformer=o.you==='performer';
 const client=o.you==='client';
 const owner=client && !!me && !me.owner_id;
 const canSuggest=isPerformer && (
  ['arrived','working','awaiting_confirmation','completed'].includes(o.status) ||
  (o.service==='tow' && ['accepted','en_route'].includes(o.status))
 );
 if(!me||(!client&&!isPerformer)||!targets.length)return null;
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
  {o.service==='tow' && ['accepted','en_route'].includes(o.status) &&
   <span className="note">СТО можно предложить заранее, пока эвакуатор в пути. Запись останется предварительной до фактической доставки.</span>}
  {canSuggest&&<>
   <label className="label" htmlFor={'continuation-target-'+o.id}>Кого предложить клиенту</label>
   <select className="field" id={'continuation-target-'+o.id} value={target}
    onChange={e=>setTarget(e.target.value as 'tow'|'sto'|'master'|'ecu')}>
    {targets.map(k=><option key={k} value={k}>{titles[k]}</option>)}
   </select>
   <textarea className="field" rows={3} maxLength={1000} value={reason}
    placeholder="Заключение: что обнаружили, почему нужен следующий специалист или эвакуация"
    onChange={e=>setReason(e.target.value)}/>
   <button className="btn ghost small" disabled={busy||actionRef.current||recs.loading||
      !!recs.error||reason.trim().length<12||rows.some(r=>r.target_kind===target)}
    onClick={()=>void submit(()=>post('/api/orders/'+o.id+'/continuations',
       {target,summary:reason}),'Рекомендация отправлена владельцу',()=>setReason(''))}>
    Предложить продолжение клиенту</button>
  </>}
  {recs.loading&&<span role="status" className="note">Загружаю рекомендации…</span>}
  {recs.error&&<div role="alert" className="stack">
   <span className="note">Не удалось получить актуальные рекомендации: {String(recs.error)}</span>
   <button className="btn ghost small" type="button" onClick={()=>void recs.reload()}>
    Повторить загрузку</button>
  </div>}
  {rows.map((r:any)=><div className="card flat stack" key={r.id}>
   <div className="between"><b>{titles[r.target_kind]??r.target_kind}</b>
    <span className="pill">{r.next_order_id||r.next_booking_id||r.next_ecu_handoff_id?'Создан следующий этап':
       r.status==='pending'?'Ожидает решения':
       r.status==='approved'?'Поиск согласован':'Отказано'}</span></div>
   <p>{r.summary}</p>
   <small className="note">{fmtTime(r.created_at)} · Следующую услугу подтверждает владелец; условия оплаты отдельно</small>
   {owner&&r.status==='pending'&&<div className="row">
    <button className="btn small" disabled={busy||actionRef.current} onClick={()=>
      void submit(()=>post('/api/orders/'+o.id+'/continuations/'+r.id+'/decision',
       {approve:true}),'Поиск следующего специалиста разрешён')}>
     Согласовать поиск</button>
    <button className="btn ghost small" disabled={busy||actionRef.current} onClick={()=>
      void submit(()=>post('/api/orders/'+o.id+'/continuations/'+r.id+'/decision',
       {approve:false}),'Продолжение отклонено')}>
     Отказаться</button>
   </div>}
   {owner&&r.status==='approved'&&r.target_kind==='ecu'&&!r.next_ecu_handoff_id&&
    <button className="btn small" disabled={busy||actionRef.current} onClick={()=>
      void submit(()=>post('/api/orders/'+o.id+'/ecu-handoff',
       {summary:r.summary,recommendationId:r.id}),'Заключение направлено мастерским ЭБУ')}>
     Направить заключение специалистам ЭБУ</button>}
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
