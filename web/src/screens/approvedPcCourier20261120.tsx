/**
 * Approved cinematic courier PC workplace, 20 November 2026.
 * Real delivery records only. Schematic road decoration is NOT a geographic
 * route or an ETA. Actual navigation opens the destination with Yandex Maps.
 * The buyer, not the courier, confirms final receipt after code verification.
 */
import {useState} from 'react';
import {get,put} from '../api.ts';
import {useAction,useLoad} from '../ui.tsx';
import {APPROVED_VISUALS} from '../approvedVisuals.ts';
import './approvedPcCourier20261120.css';

type Stage='assigned'|'picked_up'|'en_route'|'arrived'|'code_verified'|'received'|'cancelled';
type Item={productId:string;name:string;qty:number;article?:string|null};
type Job={id:string;shopOrderId:string;orderNumber:number;status:Stage;
  items:Item[];deliveryAddress:string|null;updatedAt:string;codeVerified:boolean;
  codeAttemptsRemaining:number;receivedAt:string|null};
const LIVE=new Set<Stage>(['assigned','picked_up','en_route','arrived','code_verified']);
const STATUS:Record<Stage,string>={
  assigned:'Назначен',picked_up:'Забран',en_route:'В пути',
  arrived:'На месте',code_verified:'Код проверен',received:'Вручено',cancelled:'Отменено'
};
const MILESTONES:Stage[]=['assigned','picked_up','en_route','arrived','received'];
function navigate(address:string|null){
  return address?.trim()?'https://yandex.ru/maps/?text='+encodeURIComponent(address.trim()):null;
}
function Progress({stage}:{stage:Stage}){
  const current=stage==='code_verified'?3:MILESTONES.indexOf(stage);
  return <ol className="courier-pc-progress" aria-label="Состояние доставки">
    {MILESTONES.map((item,i)=><li key={item} className={i<current?'done':i===current?'current':''}
      aria-current={i===current?'step':undefined}><span>{i<current?'✓':i+1}</span>
      <small>{STATUS[item]}</small></li>)}
  </ol>;
}
export function ApprovedPcCourier(){
  const jobs=useLoad<Job[]>(()=>get('/api/courier/jobs'),[],e=>e.type==='shop');
  const presence=useLoad<{online:boolean}>(()=>get('/api/courier/presence'),[]);
  const {busy,run}=useAction();
  const [selected,setSelected]=useState<string|null>(null);
  const all=jobs.data||[];
  const active=all.filter(j=>LIVE.has(j.status));
  const current=active.find(j=>j.id===selected)||active[0]||null;
  const itemCount=active.reduce((n,j)=>n+j.items.reduce((k,x)=>k+(x.qty||0),0),0);
  const address=current?.deliveryAddress||null;
  const nav=navigate(address);
  return <main className="approved-pc courier-pc" aria-label="Рабочий кабинет курьера">
    <header className="courier-pc-header">
      <div><small>TRAKSOS · КУРЬЕРСКАЯ ДОСТАВКА</small><h1>Рабочий стол</h1>
        <p>Рейсы, посылки и подтверждение получателя — в одном месте.</p></div>
      <button type="button" role="switch" className={'courier-pc-presence'+(presence.data?.online?' on':'')}
        aria-checked={!!presence.data?.online} disabled={!presence.data||busy}
        onClick={async()=>{if(!presence.data)return;const next=!presence.data.online;
          const ok=await run(()=>put('/api/courier/presence',{online:next}),next?'Вы на линии':'Вы не на линии');
          if(ok)presence.reload();}}>
        <span className="courier-pc-light" aria-hidden="true"/>
        {!presence.data?'Статус загружается':presence.data.online?'На линии':'Не на линии'}
        <i aria-hidden="true"/></button>
    </header>
    <div className="courier-pc-grid">
      <div className="courier-pc-primary">
        <div className="courier-pc-stats">
          <a className="orange" href="#/courier/jobs"><span>▣</span><small>Активные рейсы</small><strong>{jobs.data?active.length:'—'}</strong></a>
          <a className="teal" href="#/courier/jobs"><span>⬡</span><small>Посылки</small><strong>{jobs.data?itemCount:'—'}</strong></a>
          <a className="blue" href="#/courier/jobs"><span>⌖</span><small>Остановки</small><strong>{jobs.data?active.length:'—'}</strong></a>
        </div>
        <section className="courier-pc-trip">
          <header><div><span className="courier-pc-trip-icon">▣</span>
              <div><h2>{current?'Доставка №'+current.orderNumber:'Мой рейс'}</h2>
                <small>{current?'Назначенная доставка запчастей':'Только подтверждённые задания'}</small></div></div>
            {current&&<em>{STATUS[current.status]}</em>}</header>
          <div className="courier-pc-trip-hero">
            <div className="courier-pc-vehicle">
              <img src={APPROVED_VISUALS.workspaceTruck} alt="Согласованная иллюстрация грузовика TrakSOS — не транспорт курьера"/>
              <span>Иллюстрация TrakSOS · не фото заказа</span>
            </div>
            <div className="courier-pc-stops">
              <strong>Пункты доставки</strong>
              {jobs.error&&<p role="alert">Не удалось загрузить рейсы. <button onClick={jobs.reload}>Повторить</button></p>}
              {!jobs.data&&!jobs.error&&<p>Загружаем назначения…</p>}
              {jobs.data&&active.length===0&&<p>Пока нет назначенных доставок. Новые появятся после назначения диспетчером.</p>}
              {active.slice(0,5).map((job,i)=><button type="button" key={job.id}
                className={current?.id===job.id?'selected':''} onClick={()=>setSelected(job.id)}>
                <b>{i+1}</b><span><strong>Заказ №{job.orderNumber}</strong>
                <small>{job.deliveryAddress||'Адрес ещё не указан'}</small></span></button>)}
            </div>
          </div>
          {current?<><Progress stage={current.status}/>
            <div className="courier-pc-trip-actions">
              <a className="courier-pc-cta" href={'#/courier/jobs/'+encodeURIComponent(current.id)}>Продолжить доставку</a>
              {nav&&<a className="courier-pc-secondary" href={nav} target="_blank" rel="noopener noreferrer">Навигация</a>}
            </div></>:<a className="courier-pc-cta" href="#/courier/jobs">Все мои доставки</a>}
        </section>
      </div>
      <aside className="courier-pc-side">
        <section className="courier-pc-route">
          <h2>Маршрутный лист <small>Адреса назначений</small></h2>
          <div className="courier-pc-schematic" aria-label="Список остановок, без автоматической прокладки маршрута">
            <span className="courier-pc-schematic-title">Доставки по заданиям</span>
            <div className="courier-pc-route-line">
              {active.length?active.slice(0,4).map((job,i)=><button key={job.id} type="button"
                className={current?.id===job.id?'selected':''} onClick={()=>setSelected(job.id)}
                aria-label={'Выбрать доставку '+job.orderNumber}>{i+1}</button>)
                :<span>Нет активных остановок</span>}
            </div>
            <small>Схема, не географическая карта. Порядок маршрута не рассчитывается.</small>
          </div>
        </section>
        <section className="courier-pc-order">
          <header><h2>{current?'Заказ №'+current.orderNumber:'Текущая доставка'}</h2>
            {current&&<em>{STATUS[current.status]}</em>}</header>
          {current?<><div className="courier-pc-items"><span className="courier-pc-package">⬡</span>
            <div><strong>{current.items[0]?.name||'Запчасти'}</strong>
              <small>{current.items.reduce((n,it)=>n+(it.qty||0),0)} шт. · {current.items.length} позиций</small>
              {current.items.length>1&&<small>Остальное — в карточке доставки</small>}</div></div>
            <p><b>Адрес доставки</b><span>{address||'Не указан'}</span></p>
            <div className="courier-pc-actions">
              <a className="courier-pc-cta" href={'#/courier/jobs/'+encodeURIComponent(current.id)}>Открыть доставку</a>
              {nav&&<a className="courier-pc-secondary" href={nav} target="_blank" rel="noopener noreferrer">Навигация</a>}
            </div>
            <a className="courier-pc-support" href="#/support">Связаться с поддержкой</a>
            <small className="courier-pc-notice">Вручение завершает покупатель после проверки кода — не курьер.</small>
          </>:<p>Выберите назначенную доставку, когда она появится.</p>}
        </section>
        <a className="courier-pc-bot" href="#/trakbot" aria-label="Открыть TrakBot">
          <div><strong>TrakBot</strong><span>На связи, если нужна помощь!</span></div>
          <img src={APPROVED_VISUALS.trakbotHello} alt="Утверждённый TrakBot-грузовичок"/>
        </a>
      </aside>
    </div>
  </main>;
}
