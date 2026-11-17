import {useEffect} from 'react';
import {get,post,rub,onEvent,fmtTime} from '../api.ts';
import {useMe,useLoad,useAction,go} from '../ui.tsx';
import {SERVICES,STATUS,LINE} from '../dict.ts';
import {OfferForm} from './search.tsx';
import {VerifiedBadge} from '../verifiedBadge.tsx';
import {WorkerNotices} from './ops.tsx';
import {native} from '../native.ts';

type EcuJob={
  id:string;number:number;service:string;status:string;address:string|null;
  brand:string|null;description:string|null;created_at:string;
  additional_to:string|null;parent_number:number|null;
};
type EcuOffer={
  order_id:string;service:string;is_sos:boolean;brand:string|null;
  address:string|null;description:string|null;distance_km:number|null;
  limits:any;my_price?:number;is_linked_stage?:boolean
};
const inProgress=new Set(['accepted','en_route','arrived','working','awaiting_confirmation']);

function EcuJobCard({job}:{job:EcuJob}){
  return <a href={'#/order/'+job.id} className="card hi stack"
    style={{textDecoration:'none',color:'inherit'}}>
    <b>№{job.number} · {SERVICES[job.service]?.name??'ЭБУ'}</b>
    <span>{job.brand??'Грузовой транспорт'} · {STATUS[job.status]?.name??job.status}</span>
    {job.additional_to&&<span className="note">Дополнительная работа к заявке
      {job.parent_number?' №'+job.parent_number:''}. Договор и оплата отдельные.</span>}
    <span className="note">{job.address??'Адрес уточняется'} · Открыть заявку</span>
  </a>;
}
function EcuOfferCard({offer,onDone}:{offer:EcuOffer;onDone:()=>void}){
  return <article className="card stack">
    <b>{offer.is_sos?'SOS · ':''}ЭБУ · {offer.brand??'грузовой транспорт'}</b>
    {offer.is_linked_stage&&<span className="note">Дополнительный этап ремонта. Финансы
      и переписка другого исполнителя не доступны.</span>}
    {offer.description&&<p className="note">{offer.description}</p>}
    <p className="note">{offer.address??'Место уточняется'}
      {offer.distance_km!=null?' · '+offer.distance_km.toFixed(1)+' км':''}</p>
    <OfferForm orderId={offer.order_id} limits={offer.limits} myPrice={offer.my_price}
      onDone={onDone}/>
  </article>;
}
/**
 * A specialized desk, not a new auth role. Existing verified performer.kind
 * 'ecu' is dispatched by the same order system and uses its own contracts.
 */
export function EcuDesk(){
  const {me,reload}=useMe();
  const {busy,run}=useAction();
  const profile=me?.performer;
  const jobs=useLoad<EcuJob[]>(()=>get('/api/orders?as=performer'),[],
    (e:any)=>e.type==='order');
  const offers=useLoad<EcuOffer[]>(()=>get('/api/performer/auctions'),[],
    (e:any)=>e.type==='auction'||e.type==='order');
  const balance=useLoad<any>(()=>get('/api/performer/balance'),[],
    (e:any)=>e.type==='balance'||e.type==='order');
  useEffect(()=>onEvent((e:any)=>{if(e.type==='line_status')reload()}),[reload]);
  if(profile?.kind!=='ecu')return <main className="stack">
    <h1>Специалист по ЭБУ</h1>
    <p>Доступ открыт только для профиля по электронным блокам управления.</p>
  </main>;
  const online=profile.line_status==='online'||profile.line_status==='on_call'||
    profile.line_status==='on_job';
  const active=(jobs.data??[]).filter(o=>inProgress.has(o.status));
  const past=(jobs.data??[]).filter(o=>!inProgress.has(o.status));
  const standalone=active.filter(o=>!o.additional_to);
  const additional=active.filter(o=>Boolean(o.additional_to));
  const ecuOffers=(offers.data??[]).filter(o=>o.service==='ecu');
  const standaloneOffers=ecuOffers.filter(o=>!o.is_linked_stage);
  const linkedOffers=ecuOffers.filter(o=>Boolean(o.is_linked_stage));
  const change=async(status:'online'|'on_call'|'offline')=>{
    const ok=await run(()=>post('/api/performer/line',{lineStatus:status}),
      status==='offline'?'Приём новых заявок остановлен':'Доступность изменена');
    if(ok){if(status==='online')native.performerOnline();await reload();}
  };
  return <main className="work-live-dashboard" aria-label="Кабинет специалиста по ЭБУ">
    <WorkerNotices/>
    <section className="work-command-hero">
      <div className="work-command-copy">
        <span className="work-command-kicker">TRAKSOS · ЭЛЕКТРОННЫЕ БЛОКИ УПРАВЛЕНИЯ</span>
        <h1>Специалист по ЭБУ</h1>
        <p>Диагностика, восстановление и программирование электронных блоков грузового
          транспорта. Отдельные заявки и дополнительные этапы после другого мастера
          поступают сюда через общую систему распределения.</p>
        <div className="work-command-tags">
          <span className="work-command-status">{LINE[profile.line_status]??'Не на линии'}</span>
          {profile.verification==='approved'?
            <VerifiedBadge verified kind="specialist"/>:
            <a className="btn ghost" href="#/work/docs">Подтвердить профиль</a>}
        </div>
      </div>
      <div className="work-command-art" aria-hidden="true"/>
    </section>

    <section className="card stack" aria-label="Доступность специалиста">
      <h2>Приём заявок</h2>
      {profile.verification!=='approved'?
        <p role="status">До проверки профиля заявки не распределяются. <a href="#/work/docs">Документы и проверка</a>.</p>:
        <div className="row">
          <button className="btn" type="button" disabled={busy||profile.line_status==='on_job'}
            onClick={()=>void change('online')}>На линии</button>
          <button className="btn ghost" type="button" disabled={busy||profile.line_status==='on_job'}
            onClick={()=>void change('on_call')}>На связи</button>
          <button className="btn ghost" type="button" disabled={busy}
            onClick={()=>void change('offline')}>Не принимать</button>
        </div>}
      <p className="note">Новые заказы по ЭБУ и дополнительные этапы идут к вам только
        при подходящей специализации и доступности. Вы видите условия только
        своей заявки, а не расчёт первого мастера.</p>
    </section>

    <section className="stack" aria-label="Текущие задания ЭБУ">
      <h2>Мои заявки {active.length>0?'· '+active.length:''}</h2>
      {jobs.error&&<p role="alert">{jobs.error} <button type="button"
        className="btn ghost" onClick={jobs.reload}>Повторить</button></p>}
      {!jobs.data&&!jobs.error&&<p className="note">Загружаю заявки…</p>}
      {jobs.data&&active.length===0&&<p className="card note">
        Пока активных заявок нет. После назначения появится отдельная карточка.
      </p>}
      {active.length>0&&<>
        <h3>Самостоятельные заказы ЭБУ · {standalone.length}</h3>
        {standalone.length===0&&<p className="note">Сейчас самостоятельных заказов нет.</p>}
        {standalone.map(job=><EcuJobCard key={job.id} job={job}/>)}
        <h3>Дополнительные этапы ремонта · {additional.length}</h3>
        {additional.length===0&&<p className="note">Дополнительных работ пока нет.</p>}
        {additional.map(job=><EcuJobCard key={job.id} job={job}/>)}
      </>}
    </section>

    <section className="stack" aria-label="Новые предложения">
      <h2>Новые предложения</h2>
      {offers.error&&<p role="alert">{offers.error}
        <button type="button" className="btn ghost" onClick={offers.reload}>Повторить</button></p>}
      {offers.data&&ecuOffers.length===0&&<p className="note">Пока предложений нет.</p>}
      {ecuOffers.length>0&&<>
        <h3>Самостоятельные заказы · {standaloneOffers.length}</h3>
        {standaloneOffers.map(o=><EcuOfferCard key={o.order_id} offer={o}
          onDone={offers.reload}/>)}
        <h3>Дополнительные работы · {linkedOffers.length}</h3>
        {linkedOffers.map(o=><EcuOfferCard key={o.order_id} offer={o}
          onDone={offers.reload}/>)}
      </>}
    </section>

    <section className="card stack" aria-label="Результаты и действия">
      <h2>Работа и история</h2>
      <p className="note">Статусы, чат, выезд и завершение — в карточке каждой заявки.
        История ремонта объединяется для клиента, но договор с каждым мастером отдельный.</p>
      {past.slice(0,5).map(o=><a key={o.id} className="linkrow" href={'#/order/'+o.id}>
        <span><b>№{o.number} · {STATUS[o.status]?.name??o.status}</b>
          <small>{o.brand??'Автомобиль'} · {fmtTime(o.created_at)}</small></span><span>›</span>
      </a>)}
      <button className="btn ghost" type="button" onClick={()=>go('work/jobs')}>
        Все заявки
      </button>
      {balance.data&&<div className="sum">
        <span>К выплате по моим работам</span>
        <b>{rub(balance.data.to_pay??0)}</b>
      </div>}
      <a className="btn ghost" href="#/work/me">Настройки и документы</a>
      {profile.verification==='approved'&&<a className="btn ghost" href="#/techbase/cases/ecu-pro">
        Клуб специалистов по ЭБУ · обсудить неисправность
      </a>}
      <a className="btn ghost" href="#/techbase">ТехБаза</a>
    </section>
  </main>;
}
