/* Real courier role: approved 20 Nov twin Android screens. Never fake stops,
 * codes, locations, contact numbers, payments or customer receipt.
 */
import {useState} from 'react';
import {get,put,post} from '../api.ts';
import {useAction,useLoad,useMe} from '../ui.tsx';
import './courierApproved20261120.css';

type CourierStatus='assigned'|'picked_up'|'en_route'|'arrived'|'code_verified'|'received'|'cancelled';
type PackageItem={productId:string;name:string;qty:number;article?:string|null};
type CourierJob={
  id:string;shopOrderId:string;orderNumber:number;status:CourierStatus;
  items:PackageItem[];deliveryAddress:string|null;vehicle?:any;
  codeVerified:boolean;receivedAt:string|null;updatedAt:string;
  codeAttemptsRemaining:number;
};
const CURRENT=new Set(['assigned','picked_up','en_route','arrived','code_verified']);
const STATUS:Record<CourierStatus,string>={
  assigned:'Назначен',picked_up:'Забрал',en_route:'В пути',
  arrived:'На месте',code_verified:'Код проверен',received:'Вручено',cancelled:'Отменено'
};
const NEXT:Partial<Record<CourierStatus,{status:CourierStatus;label:string}>>={
  assigned:{status:'picked_up',label:'Забрал отправление'},
  picked_up:{status:'en_route',label:'В пути'},
  en_route:{status:'arrived',label:'Я на месте'}
};
function directions(address:string|null){
  return address?.trim()?'https://yandex.ru/maps/?text='+encodeURIComponent(address.trim()):null;
}
/** Carton with visible folded flaps and sealing tape, not the old empty ▣
 * glyph. One consistent small vector for the approved courier workspace. */
function CourierParcelGlyph(){
  return <svg className="courier-parcel-glyph" viewBox="0 0 100 96"
    role="img" aria-label="Посылка" xmlns="http://www.w3.org/2000/svg">
    <path d="M10 29 50 10 90 29 50 49Z" fill="#ffb15c" stroke="#fbd0a0" strokeWidth="2.5" strokeLinejoin="round"/>
    <path d="M10 29 50 49v36L10 65Z" fill="#c75d21" stroke="#ffa15b" strokeWidth="2.5" strokeLinejoin="round"/>
    <path d="M50 49 90 29v36L50 85Z" fill="#f18a35" stroke="#ffc083" strokeWidth="2.5" strokeLinejoin="round"/>
    <path d="M35 17 74 37v14l-11 6V43L25 23Z" fill="#ffdfb0" opacity=".96"/>
    <path d="M50 49v36" stroke="#7f3919" strokeWidth="2" opacity=".55"/>
    <path d="M19 57 30 62M19 62l8 4" stroke="#ffe4ba" strokeWidth="2" strokeLinecap="round" opacity=".9"/>
  </svg>;
}
function CourierProgress({status}:{status:CourierStatus}){
  const stages:CourierStatus[]=['picked_up','en_route','arrived','code_verified','received'];
  const index=stages.indexOf(status);
  return <ol className="courier-progress" aria-label="Этапы доставки">
    {stages.map((step,i)=><li key={step}
      className={i<index?'passed':i===index?'current':''}
      aria-current={i===index?'step':undefined}>
      <span aria-hidden="true">{i<index?'✓':i+1}</span><small>{STATUS[step]}</small>
    </li>)}
  </ol>;
}
function CourierStatusSwitch(){
  const p=useLoad<{online:boolean}>(()=>get('/api/courier/presence'),[]);
  const {busy,run}=useAction();
  // A failed presence GET must not impersonate "offline" indefinitely.
  // Let the courier recover without leaving the workspace.
  if(p.error)return <span className="courier-presence-error" role="alert">
    Не удалось проверить статус линии
    <button type="button" className="courier-switch" onClick={()=>{void p.reload();}}>
      Повторить
    </button>
  </span>;
  return <button type="button" role="switch" className={'courier-switch'+(p.data?.online?' is-on':'')}
    aria-label="Доступность курьера для новых доставок"
    aria-checked={!!p.data?.online} disabled={busy||!p.data}
    onClick={async()=>{
      const result=await run(()=>put('/api/courier/presence',{online:!p.data?.online}),
        p.data?.online?'Вы не на линии':'Вы на линии');
      if(result)p.reload();
    }}>
    <span aria-hidden="true" className="courier-presence-dot"/>
    {p.data?(p.data.online?'На линии':'Не на линии'):'Проверяем статус…'} <span aria-hidden="true" className="courier-switch-track"/>
  </button>;
}
function CourierJobLink({job,focus=false}:{job:CourierJob;focus?:boolean}){
  const itemCount=job.items.reduce((n,i)=>n+(i.qty||0),0);
  const url='#/courier/jobs/'+encodeURIComponent(job.id);
  return <article className={'courier-trip'+(focus?' focus':'')}>
    <div className="courier-trip-title">
      <strong>Доставка №{job.orderNumber}</strong><span className="courier-trip-state">{STATUS[job.status]}</span>
    </div>
    <div className="courier-trip-content">
      <span className="courier-trip-illustration"><CourierParcelGlyph/></span>
      <div><b>{itemCount} ед. · {job.items.length} позиций</b>
        <small>{job.items.map(i=>i.name).slice(0,2).join(', ')||'Содержимое в карточке заказа'}</small></div>
    </div>
    <div className="courier-trip-address"><b>⌖</b><span>{job.deliveryAddress||'Адрес в заявке ещё не указан'}</span></div>
    <CourierProgress status={job.status}/>
    <a className="courier-primary" href={url}>Открыть доставку <span aria-hidden="true">›</span></a>
  </article>;
}
export function CourierDesk({section='home'}:{section?:'home'|'jobs'|'chat'}={}){
  const tasks=useLoad<CourierJob[]>(()=>get('/api/courier/jobs'),[],e=>e.type==='shop');
  // A failed refresh must not present previous delivery addresses as current.
  const list=tasks.error?[]:(tasks.data??[]);
  const active=list.filter(j=>CURRENT.has(j.status));
  const current=active[0];
  const packages=active.reduce((n,j)=>n+j.items.reduce((s,i)=>s+(i.qty||0),0),0);
  return <main className="courier-android" aria-label="Рабочий кабинет курьера TrakSOS">
    <div className="courier-role"><b><span className="courier-role-parcel" aria-hidden="true"><CourierParcelGlyph/></span> Курьер TrakSOS</b><CourierStatusSwitch/></div>
    <h1>{section==='jobs'?'Мои доставки':section==='chat'?'Связь по доставкам':'Рабочий стол'}</h1>
    {section==='chat'?<>
      <p className="courier-muted">Сообщения с получателем пока не подключены. Вопросы по доставке решает поддержка TrakSOS — без раскрытия личных телефонов.</p>
      <a href="#/support" className="courier-primary">Открыть обращения в поддержку</a>
      {active.map(j=><a className="courier-list-row" href={'#/courier/jobs/'+encodeURIComponent(j.id)} key={j.id}>
        Доставка №{j.orderNumber} · {STATUS[j.status]} <span aria-hidden="true">›</span></a>)}
    </>:<>
      {section==='home'&&<div className="courier-overview">
        <a href="#/courier/jobs"><small>Мои доставки</small><strong>{active.length}</strong></a>
        <a href="#/courier/jobs"><small>Посылки</small><strong>{packages}</strong></a>
        <a href="#/courier/jobs"><small>Остановки</small><strong>{active.length}</strong></a>
      </div>}
      {(!tasks.data||tasks.error)?<section className="courier-trip" role={tasks.error?'alert':undefined}>
        <b>{tasks.error?'Не удалось загрузить доставки':'Загружаем текущие доставки…'}</b>
        {tasks.error&&<button className="courier-primary" type="button" onClick={tasks.reload}>Повторить</button>}
      </section>:
        section==='home' ? current
          ? <><CourierJobLink job={current} focus/>
             {active.length>1&&<a className="courier-list-row" href="#/courier/jobs">
               Ещё остановки · {active.length-1} <span aria-hidden="true">›</span></a>}</>
          : <section className="courier-trip"><b>Назначенных доставок нет</b>
              <p>Новые доставки появятся здесь после назначения диспетчером. Нет выдуманных маршрутов без назначенной доставки.</p></section>
        : list.length
          ? list.map(j=><CourierJobLink job={j} key={j.id}/>)
          : <section className="courier-trip">Доставок пока нет.</section>}
      {current&&section==='home'&&directions(current.deliveryAddress)&&
        <div className="courier-main-actions">
          <a className="courier-navigation" href={directions(current.deliveryAddress)!}
            target="_blank" rel="noopener noreferrer">Навигация</a>
        </div>}
    </>}
  </main>;
}
export function CourierDelivery({id}:{id:string}){
  const {me}=useMe();
  // A route/account switch must drop the prior order's 6-digit input
  // and any late async GET response for that order.
  return <CourierDeliveryForJob key={(me?.id??'guest')+':'+id} id={id}/>;
}
function CourierDeliveryForJob({id}:{id:string}){
  const d=useLoad<CourierJob>(()=>get('/api/courier/jobs/'+encodeURIComponent(id)),[id],e=>e.type==='shop');
  const {busy,run}=useAction();
  const [code,setCode]=useState('');
  const job=d.error?null:d.data;
  const next=job&&NEXT[job.status];
  const nav=job&&directions(job.deliveryAddress);
  const advance=async(status:CourierStatus)=>{
    if(!job)return;
    const result=await run(()=>post('/api/courier/jobs/'+encodeURIComponent(id)+'/stage',{status}),
      'Этап доставки обновлён');
    if(result)d.reload();
  };
  return <main className="courier-android courier-detail" aria-label="Карточка курьерской доставки">
    <a className="courier-back" href="#/courier/jobs">← К моим доставкам</a>
    {!job?<section className="courier-trip" role={d.error?'alert':'status'}>
      <b>{d.error?'Не удалось обновить назначенную доставку':'Загружаем назначенную доставку…'}</b>
      {d.error&&<button className="courier-primary" type="button"
        onClick={()=>{void d.reload();}}>Повторить загрузку</button>}
    </section>:<>
      <h1>Доставка №{job.orderNumber}</h1>
      <span className="courier-trip-state">{STATUS[job.status]}</span>
      <section className="courier-trip">
        <strong className="courier-section-title">Содержимое отправления</strong>
        {job.items.map(i=><div className="courier-item" key={i.productId}>
          <span className="courier-item-icon" aria-hidden="true">▤</span>
          <div><b>{i.name}</b><small>{i.article?'Артикул: '+i.article+' · ':''}Количество: {i.qty}</small></div>
        </div>)}
        <div className="courier-trip-address"><b>⌖</b>
          <span><small>Пункт доставки</small>{job.deliveryAddress||'Уточните адрес у диспетчера'}</span></div>
        <CourierProgress status={job.status}/>
      </section>
      {next&&<button className="courier-primary courier-wide" type="button" disabled={busy}
        onClick={()=>advance(next.status)}>{next.label}</button>}
      {nav&&<a className="courier-navigation" href={nav} target="_blank" rel="noopener noreferrer">
        Открыть навигацию к получателю</a>}
      {job.status==='arrived'&&<section className="courier-trip courier-code">
        <strong className="courier-section-title">Код вручения</strong>
        <p>Попросите получателя открыть магазин TrakSOS → История покупок → Код вручения. Введите его шесть цифр.</p>
        <input type="text" className="courier-code-input" inputMode="numeric" pattern="[0-9]*"
          autoComplete="one-time-code" maxLength={6} aria-label="Шестизначный код вручения"
          placeholder="• • • • • •" value={code}
          onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))}/>
        <button className="courier-primary courier-wide" type="button" disabled={busy||code.length!==6||job.codeAttemptsRemaining===0}
          onClick={async()=>{
            const result=await run(()=>post('/api/courier/jobs/'+encodeURIComponent(id)+'/verify',{code}),
              'Код проверен — ожидаем подтверждение получателя');
            setCode('');if(result)d.reload();
          }}>Проверить код вручения</button>
        <small>Осталось попыток: {job.codeAttemptsRemaining}. Код не закрывает заказ автоматически.</small>
      </section>}
      {job.status==='code_verified'&&<section className="courier-trip courier-waiting">
        <strong>Код проверен</strong>
        <p>Ожидаем отдельное подтверждение фактического получения от покупателя. Курьер не может завершить заказ самостоятельно.</p>
        <button type="button" className="courier-navigation" disabled={busy} onClick={d.reload}>Обновить статус</button>
      </section>}
      {job.status==='received'&&<section className="courier-trip courier-waiting">
        <strong>Вручение подтверждено покупателем</strong>
        <p>Доставка закрыта. Подтверждение сохранено в истории заказа.</p>
      </section>}
      <a href="#/support" className="courier-support">Связаться с поддержкой по доставке</a>
    </>}
  </main>;
}
