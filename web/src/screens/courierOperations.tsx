import {useEffect} from 'react';
import {get} from '../api.ts';
import {useLoad} from '../ui.tsx';

type Flag={runId:string;courier:string;status:string;code:string;
  minutes:number;stopCount:number;failedCount:number;hint:string};
type Overview={
 generatedAt:string;totals:{active:number;drafts:number;approved:number;
  inDelivery:number;returning:number};
 alerts:Flag[];moreAlerts:boolean;capped:boolean;warning:string
};
const time=(minutes:number)=>minutes>=60
 ?Math.floor(minutes/60)+' ч '+minutes%60+' мин':minutes+' мин';

export function CourierOperations({onOpenRun}:{onOpenRun:(id:string)=>void}){
 const feed=useLoad<Overview>(()=>get('/api/admin/shop/courier-operations'),[]);
 useEffect(()=>{
  const refresh=()=>{if(navigator.onLine&&document.visibilityState==='visible')void feed.reload()};
  const visible=()=>refresh();
  const timer=window.setInterval(refresh,60000);
  window.addEventListener('online',refresh);
  document.addEventListener('visibilitychange',visible);
  return ()=>{
   window.clearInterval(timer);
   window.removeEventListener('online',refresh);
   document.removeEventListener('visibilitychange',visible);
  };
 },[feed.reload]);
 return <section className="card stack" aria-label="Операционный контроль доставки">
  <div className="between">
   <h2>Контроль рейсов и задержек</h2>
   <button className="btn ghost small" type="button" onClick={()=>void feed.reload()}>
    Обновить
   </button>
  </div>
  <p className="note">Проблемные рейсы выделяются без просмотра персональных
   адресов, GPS или автоматических штрафов. Проверка обновляется раз в минуту.</p>
  {feed.error&&<p role="alert">{feed.error}</p>}
  {!feed.data&&!feed.error&&<p className="note">Проверяем очередь доставки…</p>}
  {feed.data&&<>
   <div className="grid2">
    <span>Всего активных рейсов: <b>{feed.data.totals.active}</b></span>
    <span>Черновики: <b>{feed.data.totals.drafts}</b></span>
    <span>Утверждены: <b>{feed.data.totals.approved}</b></span>
    <span>В пути: <b>{feed.data.totals.inDelivery}</b></span>
    <span>Нужен возврат: <b>{feed.data.totals.returning}</b></span>
    <span>Требуют внимания: <b>{feed.data.alerts.length}</b></span>
   </div>
   {feed.data.alerts.length===0&&<p className="note" role="status">
    По установленным порогам задержек и открытым вопросам поставщика нет
    рейсов, требующих внимания.
   </p>}
   <div className="stack">
    {feed.data.alerts.map(flag=><article key={flag.runId+flag.code}
      className="banner warn">
      <b>{flag.courier} · {flag.code.split('_').join(' ')}</b>
      <p className="note">{flag.hint}</p>
      <small>Состояние: {flag.status} · время: {time(flag.minutes)} ·
       посылок: {flag.stopCount} · невручённых: {flag.failedCount}</small>
      <div>
       <button className="btn ghost small" type="button"
         onClick={()=>onOpenRun(flag.runId)}>Открыть рейс и проверить</button>
      </div>
    </article>)}
   </div>
   {(feed.data.capped||feed.data.moreAlerts)&&<p role="status" className="note">
     Часть рейсов не поместилась в обзор. Используйте журнал рейсов для полной проверки.
   </p>}
   <p className="note">{feed.data.warning}</p>
  </>}
 </section>;
}
