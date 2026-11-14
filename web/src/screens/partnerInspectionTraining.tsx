import {useState} from 'react';

// This subcabinet is mounted inside the insurer's demo workspace; no API, no EАИСТО,
// no official diagnostic cards, no uploads or monetary transactions.
type InspectionStage='Новая'|'Назначена'|'Осмотр проведён'|'Образец карты готов';
type Visit={id:string;truck:string;plate:string;client:string;date:string;status:InspectionStage;result:string};
const visitsSeed:Visit[]=[
  {id:'TO-201',truck:'Scania R520',plate:'А123АА 77',client:'ООО «Транспорт»',date:'15.11.2026',status:'Новая',result:''},
  {id:'TO-202',truck:'DAF XF',plate:'В456ВВ 77',client:'ООО «Магистраль»',date:'16.11.2026',status:'Назначена',result:''}
];
export function PartnerInspectionTraining(){
  const [visits,setVisits]=useState<Visit[]>(visitsSeed);
  const [selected,setSelected]=useState(visitsSeed[0].id);
  const [view,setView]=useState<'active'|'history'>('active');
  const [result,setResult]=useState('Исправен');
  const [message,setMessage]=useState('');
  const current=visits.find(v=>v.id===selected)!;
  const isDone=(v:Visit)=>v.status==='Образец карты готов';
  const shown=visits.filter(v=>view==='history'?isDone(v):!isDone(v));
  const change=(patch:Partial<Visit>)=>{
    setVisits(rows=>rows.map(v=>v.id===selected?{...v,...patch}:v));
    setMessage('Изменение записано только в демонстрационном кабинете.');
  };
  return <section className="stack" aria-label="Тренажёр техосмотров страхового партнёра">
    <div className="sandbox-section-head">
      <div><span className="sandbox-eyebrow">ОТДЕЛЬНОЕ НАПРАВЛЕНИЕ · ТЕХОСМОТРЫ</span><h2>Техосмотры</h2></div>
      <span className="pill">{visits.filter(v=>!isDone(v)).length} активных</span>
    </div>
    <p className="note">Здесь только заявки на технический осмотр: они не смешиваются со страховыми предложениями и полисами.</p>
    <div className="sandbox-metrics">
      <div className="sandbox-metric"><small>Ожидают</small><strong>{visits.filter(v=>v.status==='Новая').length}</strong></div>
      <div className="sandbox-metric"><small>Назначены</small><strong>{visits.filter(v=>v.status==='Назначена').length}</strong></div>
      <div className="sandbox-metric"><small>Образцы карт</small><strong>{visits.filter(isDone).length}</strong></div>
    </div>
    <div className="row" role="group" aria-label="Очередь техосмотров">
      <button type="button" className="chip" aria-pressed={view==='active'} onClick={()=>setView('active')}>В работе</button>
      <button type="button" className="chip" aria-pressed={view==='history'} onClick={()=>setView('history')}>История техосмотров</button>
    </div>
    {message&&<div role="status" className="banner">{message}</div>}
    {shown.length===0?<p className="empty">{view==='history'?'История пока пуста':'Нет активных осмотров.'}</p>:<>
      <div className="sandbox-feature-grid">{shown.map(v=><button type="button" key={v.id} className="sandbox-feature" aria-pressed={selected===v.id} onClick={()=>setSelected(v.id)}><b>{v.id} · {v.truck}</b><small>{v.plate} · {v.client}</small><em>{v.status}</em></button>)}</div>
      {shown.some(v=>v.id===selected)&&<section className="card stack" aria-label="Карточка техосмотра">
        <h3>{current.id} · {current.truck}</h3>
        <p className="note">{current.plate} · {current.client} · дата: {current.date}</p>
        <p className="note">Статус: {current.status}</p>
        {current.status==='Новая'&&<button type="button" className="btn" onClick={()=>change({status:'Назначена'})}>Назначить техосмотр</button>}
        {current.status==='Назначена'&&<>
          <label className="stack">Результат проверки<select className="field" value={result} onChange={e=>setResult(e.target.value)}><option>Исправен</option><option>Выявлены неисправности</option></select></label>
          <button type="button" className="btn" onClick={()=>change({status:'Осмотр проведён',result})}>Зафиксировать осмотр</button>
        </>}
        {current.status==='Осмотр проведён'&&<button type="button" className="btn" onClick={()=>{change({status:'Образец карты готов'});setView('history')}}>Подготовить образец диагностической карты</button>}
        {isDone(current)&&<p className="note">Результат: {current.result}. Подготовлен только демонстрационный образец, не официальный документ.</p>}
      </section>}
    </>}
    <section className="card stack"><b>Важно</b><p className="note">Официальные диагностические карты, сведения в ЕАИСТО, начисления и платежи в этом тренажёре не оформляются.</p>
      <button type="button" className="btn ghost small" onClick={()=>{setVisits(visitsSeed);setSelected(visitsSeed[0].id);setResult('Исправен');setView('active');setMessage('Техосмотры в тренажёре сброшены.')}}>Сбросить техосмотры</button>
    </section>
  </section>;
}
