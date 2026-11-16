import {useState} from 'react';
import {post,fmtTime} from '../api.ts';
import './nearbyHelp.css';

type Kind='master'|'tow'|'service';
type Provider={id?:string;name:string;distanceKm:number;detail:string};
type Card={kind:Kind;title:string;count:number;capabilities:string[];providers:Provider[];note:string;action:string};
type Availability={radiusKm:number;checkedAt:string;accuracyMeters:number;cards:Card[];
  hasMatches:boolean;noMatchesText:string;disclaimer:string};
const titles:Record<Kind,string>={
  master:'Мастер на линии',tow:'Эвакуатор на линии',service:'Подтверждённая СТО'
};
/** Location never enters community profile, chat message, local storage, or background task.
 * The explicit tap below is the ONLY trigger to ask the browser for a fix.
 */
export function NearbyHelp(){
 const [result,setResult]=useState<Availability|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const ask=()=>{
   if(busy)return;
   if(!navigator.geolocation){setError('Геолокация недоступна. Разрешите GPS для сайта через HTTPS или откройте его в приложении.');return;}
   setBusy(true);setError(null);setResult(null);
   navigator.geolocation.getCurrentPosition(async p=>{
     const accuracy=Math.ceil(p.coords.accuracy);
     if(!Number.isFinite(accuracy)||accuracy<1||accuracy>500){
       setError('Точка GPS недостаточно точная для предложений рядом (нужно не более 500 метров). Попробуйте на открытой местности.');
       setBusy(false);return;
     }
     try{
       // POST body avoids precise GPS coordinates leaking into URLs or reverse-proxy access logs.
       setResult(await post<Availability>('/api/community/nearby-help',{
         lat:p.coords.latitude,lng:p.coords.longitude,accuracyMeters:accuracy
       }));
     }catch(e){
       setError(e instanceof Error?e.message:'Не удалось проверить доступность партнёров.');
     }finally{setBusy(false)}
   },e=>{
     setError(e.code===1?'Доступ к местоположению запрещён. Включите геолокацию вручную в настройках устройства.':
       e.code===3?'Время ожидания GPS истекло. Попробуйте ещё раз.':
         'Не удалось получить координаты. Мы не будем подставлять IP-адрес или выдуманный город.');
     setBusy(false);
   },{enableHighAccuracy:true,maximumAge:0,timeout:15000});
 };
 return <section className="real-nearby">
   <header className="real-nearby-head">
     <h2>Помощь там, где вы сейчас</h2>
     <p>Никаких рекламных обещаний без реальных исполнителей. Проверим только подтверждённых партнёров, которые находятся поблизости и доступны по текущим статусам.</p>
   </header>
   <button type="button" className="btn" disabled={busy} onClick={ask}>
     {busy?'Проверяем GPS и партнёров…':result?'Проверить заново':'Показать реальную помощь рядом'}
   </button>
   <p className="note">Геолокация запрашивается только после нажатия. Она не публикуется в Эфире, не связывается с вашим позывным и не сохраняется для рекламных рассылок. Без доступа к GPS ничего не предлагаем наугад.</p>
   {error&&<p role="alert" className="real-nearby-error">{error}</p>}
   {result&&<>
     <p className="note" role="status">Проверено {fmtTime(result.checkedAt)} · радиус {result.radiusKm} км · точность GPS около {result.accuracyMeters} м.</p>
     {result.cards.length===0&&<div className="real-nearby-empty">{result.noMatchesText}
       <p>Вы всё равно можете оформить заявку на поиск помощи — это не означает, что исполнитель уже найден.</p>
       <a href="#/sos" className="btn ghost">Запросить поиск помощи</a>
     </div>}
     {result.cards.length>0&&<div className="real-nearby-cards">
       {result.cards.map(card=><article key={card.kind} className="real-nearby-card">
         <div className="real-nearby-card-head">
           <h3>{card.title}</h3>
           <span className="pill good">{card.count} поблизости</span>
         </div>
         {card.capabilities.length>0&&<div className="real-nearby-tags">
           {card.capabilities.map(cap=><span key={cap}>{cap}</span>)}
         </div>}
         <div className="real-nearby-providers">
           {card.providers.map((p,i)=><div key={p.id??String(i)} className="real-nearby-provider">
             <b>{p.name}</b><small>{p.detail}</small>
             <small>Примерно {p.distanceKm.toFixed(1)} км по прямой</small>
             {card.kind==='service'&&p.id&&<a href={'#/services/'+p.id} className="btn ghost small">
               Посмотреть СТО и запросить запись
             </a>}
           </div>)}
         </div>
         <p className="note">{card.note}</p>
         {card.kind!=='service'&&<a href={card.action} className="btn">Создать заявку для проверки доступности</a>}
       </article>)}
     </div>}
     <p className="note">{result.disclaimer}</p>
   </>}
   <p className="real-nearby-safety">Обращаться за помощью и настраивать GPS безопаснее после остановки.</p>
 </section>;
}
