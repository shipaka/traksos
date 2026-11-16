import {useEffect,useRef,useState} from 'react';
import {get,post,put} from '../api.ts';
import {useAction,useLoad,useMe,Back} from '../ui.tsx';
import './courier.css';

type CourierProfile={displayName:string;vehicleLabel:string|null;locationConsent:boolean;gpsNote:string};
type Run={id:string;status:string;cityCode:string;pickupAddress:string;stops:Stop[]};
type RunList={runs:Array<{id:string;status:string;cityCode:string}>};
type Parcel={name:string;brand:string|null;article:string|null;qty:number};
type Stop={id:string;seq:number;status:string;orderNumber:number;recipientName:string|null;
  address:string|null;items:Parcel[];comment:string|null};
const statusText:Record<string,string>={
  planned:'Ожидает принятия',accepted:'Принят',collecting:'Забираем со склада',
  delivering:'Доставляем клиентам',returning:'Возврат на склад',
  completed:'Завершён',cancelled:'Отменён'
};
const parcelText:Record<string,string>={
  awaiting_pickup:'На складе',collected:'В машине',at_door:'У получателя',
  delivered:'Выдано',failed:'Не вручено'
};
function Navigate({address,label}:{address:string|null;label:string}){
  if(!address)return null;
  return <a className="btn ghost" href={'https://yandex.ru/maps/?text='+encodeURIComponent(address)}
    rel="noopener noreferrer" aria-label={label}>Открыть адрес в Яндекс Картах</a>;
}
function CargoItems({items}:{items:Parcel[]}){
  return <ul className="courier-cargo">{items.map((p,i)=><li key={i}>
    <b>{p.name}</b> · {p.qty} шт.
    {(p.brand||p.article)&&<small>{[p.brand,p.article].filter(Boolean).join(' · ')}</small>}
  </li>)}</ul>;
}
export function CourierHome(){
 const {me}=useMe();
 const isCourier=Boolean(me?.roles.includes('courier'));
 const profile=useLoad<CourierProfile>(()=>get('/api/courier/profile'),[me?.id]);
 const list=useLoad<RunList>(()=>get('/api/courier/runs'),[me?.id]);
 const [selected,setSelected]=useState<string|null>(null);
 const detail=useLoad<Run|null>(()=>selected?get('/api/courier/runs/'+selected):Promise.resolve(null),[selected]);
 const {run,busy}=useAction();
 const [failureId,setFailureId]=useState<string|null>(null);
 const [reason,setReason]=useState('');
 const [gpsOn,setGpsOn]=useState(false);
 const [gpsError,setGpsError]=useState<string|null>(null);
 const watch=useRef<number|null>(null);
 const lastSent=useRef(0);
 useEffect(()=>{
   if(!list.data)return;
   setSelected(previous=>previous&&list.data!.runs.some(x=>x.id===previous)?
     previous:list.data!.runs[0]?.id??null);
 },[list.data]);
 useEffect(()=>{
   const id=window.setInterval(()=>{
     if(document.visibilityState==='visible'&&navigator.onLine){
       void list.reload();if(selected)void detail.reload();
     }
   },20000);
   return ()=>window.clearInterval(id);
 },[selected]);
 const current=detail.data;
 const status=current?.status??null;
 // No tracking in the background, without explicit user action, on other routes,
 // or after departure from the active delivery stage.
 useEffect(()=>{
   const stopWatch=()=>{if(watch.current!=null){navigator.geolocation?.clearWatch(watch.current);watch.current=null;}};
   const startWatch=()=>{
     if(!gpsOn||status!=='delivering'||!selected||document.visibilityState!=='visible'){
       stopWatch();return;
     }
     if(!navigator.geolocation){setGpsError('GPS в этом браузере недоступен.');return;}
     if(watch.current!=null)return;
     watch.current=navigator.geolocation.watchPosition(pos=>{
       if(document.visibilityState!=='visible'||!navigator.onLine)return;
       if(!Number.isFinite(pos.coords.accuracy)||pos.coords.accuracy>500)return;
       const now=Date.now();if(now-lastSent.current<18000)return;
       lastSent.current=now;
       void put('/api/courier/runs/'+selected+'/position',{
         lat:pos.coords.latitude,lng:pos.coords.longitude,
         accuracyMeters:Math.max(1,Math.round(pos.coords.accuracy))
       }).catch(()=>setGpsError('Не удалось отправить точку. Проверьте связь и разрешение GPS.'));
     },err=>setGpsError('GPS: '+err.message),
       {enableHighAccuracy:true,maximumAge:3000,timeout:15000});
   };
   const onVisibility=()=>startWatch();
   startWatch();document.addEventListener('visibilitychange',onVisibility);
   return ()=>{stopWatch();document.removeEventListener('visibilitychange',onVisibility)};
 },[gpsOn,status,selected]);
 const action=async(url:string,label:string)=>{
   const ok=await run(()=>post(url,{}),label);
   if(ok){await detail.reload();await list.reload();}
 };
 const changeGps=async(enabled:boolean)=>{
   if(!enabled)setGpsOn(false); // stop the sensor first, even without internet
   if(!selected||status!=='delivering')return;
   const result=await run(()=>put('/api/courier/location-consent',{enabled}),
     enabled?'Разрешение на GPS включено':'Передача GPS отключена');
   if(result){setGpsOn(enabled);setGpsError(null);await profile.reload();}
   else if(!enabled)setGpsError('GPS на устройстве остановлен. Не удалось подтвердить отзыв согласия на сервере — проверьте соединение.');
 };
 if(!isCourier)return <main><h1>Кабинет курьера</h1><p>Раздел доступен только назначенным администрацией курьерам.</p></main>;
 return <main className="courier-shell">
   <header className="courier-head">
     <div><span className="note">TRAKSOS · ДОСТАВКА ЗАПЧАСТЕЙ</span>
       <h1>Мои доставки</h1><p>Склад, список посылок, получатели и порядок остановок. Без лишних действий.</p></div>
     <Back to="profile" label="Аккаунт"/>
   </header>
   {profile.error&&<p role="alert">{profile.error}</p>}
   {profile.data&&<div className="courier-profile">
     <b>{profile.data.displayName}</b>{profile.data.vehicleLabel&&<span>{profile.data.vehicleLabel}</span>}
     <small>Курьерская доставка магазина сейчас обслуживает только Санкт-Петербург.</small>
   </div>}
   {list.error&&<p role="alert">{list.error} <button onClick={list.reload}>Повторить</button></p>}
   {!list.data&&!list.error&&<p>Загружаю рейсы…</p>}
   {list.data?.runs.length===0&&<section className="card stack">
     <h2>Пока нет назначенных рейсов</h2>
     <p className="note">Маршрут появится после проверки товаров, адресов и утверждения администратором сметы доставки.</p>
     <button className="btn ghost" onClick={list.reload}>Обновить</button>
   </section>}
   {list.data&&list.data.runs.length>0&&<div className="courier-layout">
     <nav className="courier-runs" aria-label="Мои рейсы">
       {list.data.runs.map(r=><button key={r.id} type="button" aria-current={selected===r.id?'page':undefined}
         onClick={()=>{setGpsOn(false);setSelected(r.id);setFailureId(null)}}>
         <b>Рейс {r.id.slice(0,8)}</b><small>{statusText[r.status]??r.status}</small>
       </button>)}
     </nav>
     <section className="courier-route">
       {detail.error&&<div role="alert">{detail.error} <button onClick={detail.reload}>Повторить</button></div>}
       {selected&&!detail.data&&!detail.error&&<p>Открываю маршрут…</p>}
       {current&&<>
         <header className="courier-route-head">
           <h2>Рейс {current.id.slice(0,8)}</h2>
           <span className="pill accent">{statusText[current.status]??current.status}</span>
         </header>
         <article className="courier-warehouse">
           <b>Склад отправления</b>
           <p>{current.pickupAddress}</p>
           <Navigate address={current.pickupAddress} label="Открыть адрес склада"/>
         </article>
         {current.status==='planned'&&<button className="btn" disabled={busy}
           onClick={()=>void action('/api/courier/runs/'+current.id+'/accept','Рейс принят')}>
           Принять рейс
         </button>}
         {['accepted','collecting'].includes(current.status)&&
           <div className="courier-step-info">
             <b>Шаг 1. Сверьте посылки со складом</b>
             <p>Отмечайте только фактически принятые товары. Если заказ отменён поставщиком, система не позволит забрать его.</p>
           </div>}
         {['accepted','collecting'].includes(current.status)&&
           current.stops.length>0&&current.stops.every(x=>x.status==='collected')&&
             <button className="btn" disabled={busy}
               onClick={()=>void action('/api/courier/runs/'+current.id+'/start','Все пакеты сверены, выезд отмечен')}>
               Все пакеты забраны · Выехать
             </button>}
         {current.status==='delivering'&&<section className="courier-gps">
           <b>GPS для клиента текущей остановки</b>
           <p className="note">Только во время активной доставки и с отдельным согласием. Точки других получателей клиент не видит. При сворачивании приложения отправка из этого экрана прекращается.</p>
           <button className="btn ghost" disabled={busy}
             onClick={()=>void changeGps(!gpsOn)}>{gpsOn?'Отключить передачу GPS':'Разрешить GPS на время доставки'}</button>
           {gpsError&&<p role="alert">{gpsError}</p>}
         </section>}
         {current.status==='returning'&&<div className="banner warn" role="status">
           Остались невручённые посылки. Верните их на склад. Только администратор может подтвердить фактический возврат и закрыть рейс.
         </div>}
         <h3>Заказы по маршруту</h3>
         <ol className="courier-stops">
           {current.stops.map(st=><li className="courier-stop" key={st.id}>
             <div className="courier-stop-head">
               <b>Остановка {st.seq} · Заказ №{st.orderNumber}</b>
               <span className="pill">{parcelText[st.status]??st.status}</span>
             </div>
             {st.recipientName&&<p><b>Получатель:</b> {st.recipientName}</p>}
             {st.address&&<p><b>Куда доставить:</b> {st.address}</p>}
             {st.comment&&<p className="note">Примечание: {st.comment}</p>}
             <CargoItems items={st.items}/>
             <div className="courier-stop-actions">
               {['accepted','collecting'].includes(current.status)&&st.status==='awaiting_pickup'&&
                 <button className="btn" disabled={busy}
                   onClick={()=>void action('/api/courier/runs/'+current.id+'/stops/'+st.id+'/collect','Посылка сверена и забрана')}>
                   Забрал со склада
                 </button>}
               {current.status==='delivering'&&['collected','at_door'].includes(st.status)&&
                 <Navigate address={st.address} label="Открыть навигацию к заказу"/>}
               {current.status==='delivering'&&st.status==='collected'&&
                 <button className="btn" disabled={busy}
                   onClick={()=>void action('/api/courier/runs/'+current.id+'/stops/'+st.id+'/arrive','Прибытие отмечено')}>
                   Я у получателя
                 </button>}
               {current.status==='delivering'&&st.status==='at_door'&&
                 <p className="note">Ожидаем подтверждения получения клиентом в его кабинете.</p>}
               {current.status==='delivering'&&['collected','at_door'].includes(st.status)&&
                 <button className="btn ghost" type="button" onClick={()=>{setFailureId(st.id);setReason('')}}>
                   Не удалось вручить
                 </button>}
               {failureId===st.id&&<form className="courier-failure" onSubmit={async e=>{
                 e.preventDefault();const result=await run(()=>post('/api/courier/runs/'+current.id+
                   '/stops/'+st.id+'/report-failure',{reason:reason.trim()}),'Проблема вручения записана');
                 if(result){setFailureId(null);setReason('');setGpsOn(false);await detail.reload();await list.reload()}
               }}>
                 <label>Причина невручения
                   <textarea className="field" rows={3} minLength={20} maxLength={500}
                     value={reason} onChange={e=>setReason(e.target.value)}
                     placeholder="Например, клиент не отвечает, вход на объект закрыт…"/>
                 </label>
                 <button className="btn" disabled={busy||reason.trim().length<20} type="submit">
                   Подтвердить проблему
                 </button>
                 <button className="btn ghost" type="button" onClick={()=>setFailureId(null)}>Отмена</button>
               </form>}
             </div>
           </li>)}
         </ol>
         <p className="note">Маршрут следует порядку, утверждённому диспетчером. Время прибытия не прогнозируется без подключённого маршрутизатора. Сборка и статус поставщика проверяются до отправки.</p>
       </>}
     </section>
   </div>}
 </main>;
}
