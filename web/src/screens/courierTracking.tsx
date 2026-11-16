import {useEffect} from 'react';
import {get,post,fmtTime} from '../api.ts';
import {useAction,useLoad} from '../ui.tsx';

type Tracking={
  status:string;runStatus:string|null;live:boolean;
  location:{lat:number;lng:number;accuracyMeters:number;updatedAt:string}|null;
  etaMinutes:null;
};
type Event={id:string;status:string;at:string;title:string};
type Timeline={events:Event[]};
const stage:Record<string,string>={
  awaiting_assignment:'Ожидает назначения курьера',
  awaiting_pickup:'Ожидает забора на складе',collected:'В машине у курьера',
  at_door:'Курьер у получателя',delivered:'Вручён',failed:'Не удалось вручить'
};
/** Lazy, buyer-scoped courier data. Never caches coordinates or other recipients. */
export function CustomerCourierTracking({orderId,onChanged}:{
  orderId:string;onChanged:()=>void
}){
  const position=useLoad<Tracking>(()=>get('/api/shop/orders/'+orderId+'/courier'),[orderId]);
  const history=useLoad<Timeline>(()=>get('/api/shop/orders/'+orderId+'/delivery-history'),[orderId]);
  const {busy,run}=useAction();
  useEffect(()=>{
    const timer=window.setInterval(()=>{
      if(!navigator.onLine||document.visibilityState==='hidden')return;
      void position.reload();
      void history.reload();
    },20000);
    return ()=>window.clearInterval(timer);
  },[orderId]);
  const d=position.data;
  return <section className="card stack" aria-label="Отслеживание заказа" style={{gap:12}}>
    <h3>Доставка заказа</h3>
    {position.error&&<p role="alert">{position.error} <button className="btn ghost small" onClick={position.reload}>Повторить</button></p>}
    {!d&&!position.error&&<p className="note">Проверяем состояние доставки…</p>}
    {d&&<>
      <strong>{stage[d.status]??d.status}</strong>
      {d.status==='awaiting_assignment'&&<p className="note">Курьер появится после сборки, проверки адреса и утверждения маршрута диспетчером.</p>}
      {d.status==='failed'&&<p className="note">Невручённая посылка остаётся под ответственностью курьера до возврата на склад и проверки диспетчером.</p>}
      {d.live&&d.location?<>
        <p>Курьер делится геопозицией для вашей текущей доставки.</p>
        <p className="note">Последняя точка: {fmtTime(d.location.updatedAt)} · точность около {Math.round(d.location.accuracyMeters)} м. Это не гарантированное время прибытия.</p>
        <a className="btn ghost" href={'https://yandex.ru/maps/?ll='+encodeURIComponent(d.location.lng+','+d.location.lat)+'&z=14'}
          target="_blank" rel="noopener noreferrer">Посмотреть последнюю точку на карте</a>
      </>:<p className="note">Актуальная GPS-точка сейчас недоступна. Мы не подменяем её прогнозом или точками других получателей.</p>}
      {d.status==='at_door'&&<div className="stack">
        <p>Курьер сообщил о прибытии. Подтверждайте получение только после фактической передачи и проверки посылки.</p>
        <button className="btn" disabled={busy} onClick={async()=>{
          const result=await run(()=>post('/api/shop/orders/'+orderId+'/confirm-delivery',{}),
            'Получение подтверждено');
          if(result){await position.reload();await history.reload();onChanged()}
        }}>Товар действительно получен</button>
      </div>}
    </>}
    <h4>История доставки</h4>
    {history.error&&<p role="alert">{history.error} <button onClick={history.reload}>Обновить историю</button></p>}
    {!history.data&&!history.error&&<p className="note">Загружаем события…</p>}
    {history.data?.events.length===0&&<p className="note">Пока нет событий доставки.</p>}
    {history.data&&<ol className="stack" style={{paddingLeft:20,gap:8}}>
      {history.data.events.map(e=><li key={e.id}>
        <b>{e.title}</b><small className="note" style={{marginLeft:8}}>{fmtTime(e.at)}</small>
      </li>)}
    </ol>}
  </section>;
}
