import { useEffect } from 'react';
import { get } from '../api.ts';
import { SERVICES } from '../dict.ts';
import { go, Loading } from '../ui.tsx';
import { NEEDS } from './base.tsx';
import { usePrivateRead } from './privateRead20261124.ts';

type CalendarItem={
  id:string; number:number; kind:'service'|'roadside'; service:string;
  day:string; brand:string|null; model:string|null;
  requested_time:string|null; confirmed_time:string|null;
  starts_at:string|null; ends_at:string|null; order_id:string|null;
  confirmation:'pending'|'confirmed'|'in_progress'|'ready'|'invoiced'|'disputed'|'cancelled'|'declined'|'completed';
};
type CalendarResponse={timezone:string;from:string;to:string;items:CalendarItem[];truncated:boolean};
const TZ='Europe/Moscow';
const DAY=86400_000;
const dayFormatter=new Intl.DateTimeFormat('ru-RU',{timeZone:'UTC',day:'numeric',month:'long',weekday:'short'});
const moscowParts=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'});
const intervalFormatter=new Intl.DateTimeFormat('ru-RU',{timeZone:TZ,day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function today(){
  const parts=moscowParts.formatToParts(new Date());
  const part=(name:string)=>parts.find(p=>p.type===name)?.value??'';
  return part('year')+'-'+part('month')+'-'+part('day');
}
function validDay(day:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||day<'1900-01-01'||day>'9999-12-24')return false;
  const t=Date.parse(day+'T00:00:00Z');
  return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===day;
}
function shift(day:string,amount:number){return new Date(Date.parse(day+'T00:00:00Z')+amount*DAY).toISOString().slice(0,10);}
function dateLabel(day:string){return dayFormatter.format(new Date(day+'T00:00:00Z'));}
function intervalLabel(instant:string|null){
  if(!instant)return '';
  const d=new Date(instant);
  return Number.isFinite(d.getTime())?intervalFormatter.format(d):'';
}
const stateNames:Record<CalendarItem['confirmation'],string>={
  pending:'Ожидает подтверждения',confirmed:'Подтверждено',in_progress:'Машина в СТО',ready:'Работы завершены',invoiced:'Счёт выставлен',disputed:'Спор по счёту',cancelled:'Отменено',declined:'Отклонено',completed:'Завершено',
};
function timeLabel(item:CalendarItem){
  if(item.kind==='roadside'){
    const from=intervalLabel(item.starts_at),to=intervalLabel(item.ends_at);
    return from&&to?(item.confirmation==='confirmed'?'Резерв: ':'Интервал: ')+from+' — '+to:'Время не указано';
  }
  if(['confirmed','in_progress','ready','invoiced','disputed','completed'].includes(item.confirmation))
    return item.confirmed_time?'Согласованное время записи: '+item.confirmed_time:'Дата записи, согласованное время не указано';
  return item.requested_time?'Желаемое время: '+item.requested_time:'Время не указано';
}

export function ClientCalendar({userId,date,as='client',period='week'}:{userId:string;date:string;as?:'client'|'performer';period?:'day'|'week'}){
  const performer=as==='performer';
  const root=performer?'work/jobs':'orders';
  const route=root+'/calendar';
  const from=validDay(date)?date:today();
  const single=period==='day';
  const days=single?1:7;
  const to=shift(from,days-1);
  const pathFor=(day:string,p:'day'|'week'=period)=>route+'/'+day+(p==='day'?'/day':'');
  // Put the date in the real route, not shared storage. Browser/Android Back
  // from an order returns to the same seven-day window.
  useEffect(()=>{
    if(date!==from)window.location.replace('#/'+route+'/'+from+(single?'/day':''));
  },[date,from,route,single]);
  const calendar=usePrivateRead<CalendarResponse>(
    ()=>get('/api/'+as+'/calendar?from='+from+'&to='+to),
    'calendar:'+as+':'+userId+':'+from+':'+to,
    e=>['order','booking','fleet','reservation'].includes(e.type));
  const select=(day:string)=>{if(validDay(day))go(pathFor(day));};
  const items=calendar.data?.items??[];
  const groups=Array.from(new Set(items.map(item=>item.day))).sort();
  return <main className={(performer?'performer-orders-page':'client-orders-page')+' stack'}>
    <h1>Заявки</h1>
    <div className="scroll-x" role="tablist" aria-label="Разделы заявок">
      <button className="chip" role="tab" aria-pressed={false} onClick={()=>go(root)}>{performer?'История':'Сейчас'}</button>
      <button className="chip" role="tab" aria-pressed={true}>Календарь</button>
    </div>
    <section className="card stack" aria-label="Календарь заявок">
      <h2>Календарь</h2>
      <span className="note">{performer?'Ваши связанные с заявками интервалы выездов.':'Записи на СТО и согласуемые выезды.'} Все даты и время — московские. Отсутствие записей не означает доступность мастера.</span>
      <div className="row" role="group" aria-label="Период просмотра" style={{gap:8}}>
        <button type="button" className="chip" aria-pressed={single} onClick={()=>go(pathFor(from,'day'))}>День</button>
        <button type="button" className="chip" aria-pressed={!single} onClick={()=>go(pathFor(from,'week'))}>Неделя</button>
      </div>
      <label className="stack" style={{gap:4}}>
        <span className="label">{single?'Дата просмотра':'Начало недели просмотра'}</span>
        <input type="date" aria-label="Начало периода" value={from} min="1900-01-01" max="9999-12-24" onChange={e=>select(e.target.value)}/>
      </label>
      <div className="row" style={{flexWrap:'wrap',gap:8}}>
        <button className="btn ghost small" type="button" disabled={!validDay(shift(from,-days))} onClick={()=>select(shift(from,-days))}>{single?'← День':'← 7 дней'}</button>
        <button className="btn ghost small" type="button" onClick={()=>select(today())}>Сегодня</button>
        <button className="btn ghost small" type="button" disabled={!validDay(shift(from,days))} onClick={()=>select(shift(from,days))}>{single?'День →':'7 дней →'}</button>
      </div>
      <p className="note">{dateLabel(from)}{!single?' — '+dateLabel(to):''}</p>
      <button className="btn ghost small" type="button" onClick={()=>{void calendar.reload();}}>Обновить календарь</button>
      {calendar.error?<div role="alert" className="stack"><b>Не удалось загрузить календарь</b>
        <button className="btn ghost small" type="button" onClick={()=>{void calendar.reload();}}>Повторить загрузку календаря</button></div>
      :calendar.loading?<Loading/>
      :calendar.data&&<>
        {calendar.data.truncated&&<p role="status" className="note">Показаны первые 500 записей. {single?'Часть записей не вошла в список; проверьте конкретную заявку в истории.':'Выберите режим «День», чтобы сузить период.'}</p>}
        {!items.length?<div className="empty">На этот период записей нет</div>:groups.map(day=><section className="stack" key={day} aria-label={dateLabel(day)}>
          <h3>{dateLabel(day)}</h3>
          <div className="rows">{items.filter(item=>item.day===day).map(item=><a key={item.kind+':'+item.id}
            href={item.kind==='service'?'#/booking/'+item.id:'#/order/'+item.order_id}
            className="list-item" style={{alignItems:'flex-start',flexWrap:'wrap'}}>
            <div className="stack" style={{gap:4,minWidth:0,overflowWrap:'anywhere'}}>
              <b>№{item.number} · {item.kind==='service'?'СТО: '+(NEEDS[item.service]??'Ремонт'):(SERVICES[item.service]?.name??'Выезд')}</b>
              <span className="note">{[item.brand,item.model].filter(Boolean).join(' ')||'Автомобиль не указан'}</span>
              <span>{timeLabel(item)}</span>
            </div>
            <span className={'pill '+(item.confirmation==='confirmed'?'good':'')}>{stateNames[item.confirmation]??'Статус уточняется'}</span>
          </a>)}</div>
        </section>)}
      </>}
    </section>
    <a className="btn ghost" href={'#/'+root}>К списку заявок и истории</a>
  </main>;
}
