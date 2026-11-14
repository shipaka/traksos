import {useState} from 'react';

// Offline training only: no diagnostic card issuance, API calls, payments or external files.
type State='Новая'|'Назначена'|'Осмотр проведён'|'Карта подготовлена';
type Visit={id:number;vehicle:string;plate:string;date:string;status:State;result:string};
const sample:Visit[]=[
  {id:401,vehicle:'Scania R520 · тягач',plate:'А123АА 77',date:'15.11.2026',status:'Новая',result:''},
  {id:402,vehicle:'Schmitz · полуприцеп',plate:'АА1234 77',date:'16.11.2026',status:'Назначена',result:''},
];
type Tab='queue'|'calendar'|'cards'|'finance'|'operator';
export function InspectionTrainingCabinet(){
  const [visits,setVisits]=useState<Visit[]>(sample);
  const [tab,setTab]=useState<Tab>('queue');
  const [selected,setSelected]=useState(401);
  const [result,setResult]=useState('Исправен');
  const [operator,setOperator]=useState('Тестовый оператор ТО');
  const [notice,setNotice]=useState('');
  const nav:[Tab,string][]=[['queue','Очередь осмотров'],['calendar','Расписание'],['cards','Диагностические карты'],['finance','Начисления и выплаты'],['operator','Оператор']];
  const current=visits.find(v=>v.id===selected)!;
  const change=(patch:Partial<Visit>)=>{setVisits(v=>v.map(x=>x.id===selected?{...x,...patch}:x));setNotice('Изменение выполнено только в тестовом кабинете.');};
  return <main className="sandbox-root sandbox-cabinet stack" aria-label="Тестовый кабинет: Оператор техосмотра">
    <div className="sandbox-breadcrumb"><a href="#/admin/test-center">← Назад к выбору кабинетов</a><span className="pill accent">ТЕСТОВЫЙ РЕЖИМ</span></div>
    <section className="sandbox-hero"><span className="sandbox-eyebrow">TRACKSOS · ОПЕРАТОР ТЕХОСМОТРА</span><h1>Технический осмотр транспорта</h1><p>Очередь, расписание, результаты и диагностические карты в изолированном тренажёре.</p>
      <div className="row"><button className="btn" type="button" onClick={()=>setTab('queue')}>Открыть очередь</button><button className="btn ghost" type="button" onClick={()=>setTab('cards')}>Диагностические карты</button></div>
    </section>
    <div className="banner" role="note"><b>АДМИНИСТРАТОР · ДЕМОНСТРАЦИЯ</b><span>Настоящие диагностические карты, ЕАИСТО, платежи и документы не создаются.</span></div>
    <div className="sandbox-workspace"><nav className="sandbox-nav" aria-label="Разделы кабинета техосмотра">
      <div className="sandbox-identity"><span>▣</span><div><b>{operator}</b><small>Учебный пункт осмотра</small></div></div>
      {nav.map(([id,label])=><button key={id} type="button" className={tab===id?'active':''} aria-current={tab===id?'page':undefined} onClick={()=>{setTab(id);setNotice('')}}>{label}</button>)}
      <a href="#/admin/test-center">← Все кабинеты</a>
    </nav><div className="sandbox-panel stack" aria-live="polite">
      {notice&&<div className="banner" role="status">{notice}</div>}
      {tab==='queue'&&<><div className="sandbox-section-head"><div><span className="sandbox-eyebrow">ОСМОТРЫ</span><h2>Входящие заявки</h2></div><span className="pill">{visits.filter(v=>v.status!=='Карта подготовлена').length} в работе</span></div>
        <div className="sandbox-feature-grid">{visits.map(v=><button className="sandbox-feature" key={v.id} type="button" aria-pressed={selected===v.id} onClick={()=>setSelected(v.id)}><b>№{v.id} · {v.vehicle}</b><small>{v.plate} · {v.date}</small><em>{v.status}</em></button>)}</div>
        <section className="card stack"><h3>Осмотр №{current.id}</h3><p className="note">{current.vehicle} · {current.plate} · {current.status}</p>
          {current.status==='Новая'&&<button className="btn" type="button" onClick={()=>change({status:'Назначена'})}>Назначить осмотр</button>}
          {current.status==='Назначена'&&<><label className="stack">Результат осмотра<select className="field" value={result} onChange={e=>setResult(e.target.value)}><option>Исправен</option><option>Выявлены неисправности</option></select></label>
            <button className="btn" type="button" onClick={()=>change({status:'Осмотр проведён',result})}>Зафиксировать результат</button></>}
          {current.status==='Осмотр проведён'&&<button className="btn" type="button" onClick={()=>{change({status:'Карта подготовлена'});setTab('cards')}}>Подготовить образец карты</button>}
          {current.status==='Карта подготовлена'&&<p className="note">Образец диагностической карты подготовлен. Официальный документ не оформлен.</p>}
        </section>
      </>}
      {tab==='calendar'&&<><h2>Расписание осмотров</h2>{visits.map(v=><section className="card stack" key={v.id}><b>{v.date} · {v.vehicle}</b><span className="note">{v.status} · {v.plate}</span></section>)}</>}
      {tab==='cards'&&<><h2>Диагностические карты</h2><p className="note">Только образцы. Отправка в ЕАИСТО и формирование юридически значимых документов отключены.</p>
        {visits.filter(v=>v.status==='Карта подготовлена').length===0?<p className="empty">Подготовленных образцов пока нет.</p>:visits.filter(v=>v.status==='Карта подготовлена').map(v=><section className="card stack" key={v.id}><b>Образец карты · №{v.id}</b><span>{v.vehicle} · {v.result}</span></section>)}</>}
      {tab==='finance'&&<section className="card stack"><h2>Начисления и выплаты</h2><p className="note">Настоящие начисления, возвраты и выплаты доступны только в рабочем кабинете. Тренажёр не выполняет финансовые операции.</p><b>Осмотров в примере: {visits.length}</b></section>}
      {tab==='operator'&&<section className="card stack"><h2>Пункт технического осмотра</h2><label className="stack">Название оператора<input className="field" value={operator} maxLength={100} onChange={e=>setOperator(e.target.value)}/></label><button className="btn" type="button" onClick={()=>setNotice('Тестовый профиль изменён локально.')}>Сохранить профиль</button></section>}
    </div></div>
    <div className="sandbox-footer"><button type="button" className="btn ghost small" onClick={()=>{setVisits(sample);setTab('queue');setSelected(401);setNotice('Тестовые данные сброшены.')}}>Сбросить тренажёр</button><a href="#/admin/test-center">← Все кабинеты</a></div>
  </main>;
}
