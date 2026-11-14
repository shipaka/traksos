import {useState} from 'react';
import {PartnerInspectionTraining} from './partnerInspectionTraining.tsx';

// Isolated insurance partner training workspace. No API, storage, SMS or payment calls.
type Stage='Новая'|'Принята'|'Предложение отправлено'|'Завершена';
type Case={id:string;vehicle:string;client:string;stage:Stage;offer:string;document:string};
const seed:Case[]=[
  {id:'DEMO-101',vehicle:'Scania R520 · 2021',client:'ООО «Транспорт»',stage:'Новая',offer:'',document:''},
  {id:'DEMO-102',vehicle:'DAF XF · 2018',client:'Иванов И.И.',stage:'Принята',offer:'',document:''},
];
type Tab='queue'|'inspection'|'documents'|'finance'|'company';
export function InsurerTrainingCabinet(){
  const [tab,setTab]=useState<Tab>('queue');
  const [cases,setCases]=useState<Case[]>(seed);
  const [selected,setSelected]=useState('DEMO-101');
  const [price,setPrice]=useState('32500');
  const [message,setMessage]=useState('');
  const [company,setCompany]=useState('Тестовый страховой партнёр');
  const item=cases.find(c=>c.id===selected)!;
  const update=(patch:Partial<Case>)=>setCases(prev=>prev.map(c=>c.id===selected?{...c,...patch}:c));
  const nav:[Tab,string][]=[['queue','Страховки'],['inspection','Техосмотры'],['documents','Документы и полисы'],['finance','Финансы'],['company','Компания']];
  return <main className="sandbox-root sandbox-cabinet stack" aria-label="Тестовый кабинет: Страховой партнёр">
    <div className="sandbox-breadcrumb"><a href="#/admin/test-center">← Назад к выбору кабинетов</a><span className="pill accent">ТЕСТОВЫЙ РЕЖИМ</span></div>
    <section className="sandbox-hero"><span className="sandbox-eyebrow">TRACKSOS · СТРАХОВОЙ ПАРТНЁР</span>
      <h1>{tab==='inspection'?'Техосмотры грузового транспорта':'Страхование и техосмотры'}</h1><p>Два отдельных рабочих направления: страховые предложения и технические осмотры, документы и расчёты · без настоящих операций.</p>
      <div className="row"><button className="btn" type="button" onClick={()=>setTab('queue')}>Открыть заявки</button>
      <button className="btn ghost" type="button" onClick={()=>setTab('inspection')}>Перейти к техосмотрам</button><button className="btn ghost" type="button" onClick={()=>setTab('finance')}>Мои финансы</button></div>
    </section>
    <div className="banner" role="note"><b>АДМИНИСТРАТОР · ДЕМОНСТРАЦИЯ</b><span>Изменения существуют только на этой странице. Реальные полисы, выплаты и уведомления не создаются.</span></div>
    <div className="sandbox-workspace">
      <nav className="sandbox-nav" aria-label="Разделы страхового кабинета">
        <div className="sandbox-identity"><span>◇</span><div><b>{company}</b><small>Тестовая организация</small></div></div>
        {nav.map(([id,label])=><button type="button" key={id} className={tab===id?'active':''} aria-current={tab===id?'page':undefined} onClick={()=>{setTab(id);setMessage('')}}>{label}</button>)}
        <a href="#/admin/test-center">← Все кабинеты</a>
      </nav>
      <div className="sandbox-panel stack" aria-live="polite">
        {message&&<div className="banner" role="status">{message}</div>}
        {tab==='queue'&&<>
          <div className="sandbox-section-head"><div><span className="sandbox-eyebrow">СТРАХОВЫЕ ЗАЯВКИ</span><h2>Входящие обращения</h2></div><span className="pill">{cases.filter(c=>c.stage!=='Завершена').length} активных</span></div>
          <div className="sandbox-metrics"><div className="sandbox-metric"><small>Новые</small><strong>{cases.filter(c=>c.stage==='Новая').length}</strong></div><div className="sandbox-metric"><small>В работе</small><strong>{cases.filter(c=>c.stage==='Принята').length}</strong></div><div className="sandbox-metric"><small>Предложения</small><strong>{cases.filter(c=>c.stage==='Предложение отправлено').length}</strong></div></div>
          <div className="sandbox-feature-grid">{cases.map(c=><button type="button" key={c.id} className="sandbox-feature" onClick={()=>setSelected(c.id)} aria-pressed={selected===c.id}><b>{c.id} · {c.vehicle}</b><small>{c.client}</small><em>{c.stage}</em></button>)}</div>
          <section className="card stack" aria-label="Страховое дело">
            <h3>{item.id} · {item.vehicle}</h3><p className="note">Страхователь: {item.client} · статус: {item.stage}</p>
            <div className="row"><button className="btn" type="button" disabled={item.stage!=='Новая'} onClick={()=>{update({stage:'Принята'});setMessage('Тестовая заявка принята в работу.')}}>Принять в работу</button></div>
            <label className="stack">Стоимость предложения, ₽<input className="field" inputMode="decimal" value={price} onChange={e=>setPrice(e.target.value)}/></label>
            <button className="btn" type="button" disabled={item.stage!=='Принята'} onClick={()=>{const n=Number(price);if(!Number.isFinite(n)||n<=0){setMessage('Укажите положительную стоимость.');return;}update({stage:'Предложение отправлено',offer:price});setMessage('Тестовое предложение отправлено.')}}>Отправить предложение</button>
            {item.offer&&<p className="note">Предложение: {item.offer} ₽ · демонстрация, не платёж</p>}
          </section>
        </>}
        {tab==='inspection'&&<PartnerInspectionTraining/>}
        {tab==='documents'&&<section className="card stack"><span className="sandbox-eyebrow">ДОКУМЕНТЫ</span><h2>Полисы и документы</h2>
          <label className="stack">Страховое дело<select className="field" value={selected} onChange={e=>setSelected(e.target.value)}>{cases.map(c=><option key={c.id} value={c.id}>{c.id} · {c.vehicle}</option>)}</select></label>
          <p className="note">Загрузка настоящих файлов отключена: здесь проверяется последовательность работы с документами.</p>
          <button type="button" className="btn" disabled={item.stage!=='Предложение отправлено'} onClick={()=>{update({document:'Тестовый полис (образец)',stage:'Завершена'});setMessage('Образец полиса прикреплён только в тренажёре.')}}>Прикрепить образец полиса</button>
          <p>{item.document||'Документ пока не прикреплён'}</p>
        </section>}
        {tab==='finance'&&<section className="card stack"><span className="sandbox-eyebrow">ФИНАНСЫ · ДЕМО</span><h2>Финансы страхования и техосмотров</h2>
          <p className="note">Начисления и выплаты в реальном кабинете приходят с сервера. В тренажёре банковские операции и изменение финансового реестра отключены.</p>
          <p className="note">Страхование: показаны суммы предложений, не подтверждённые начисления. Техосмотры: выплаты отсутствуют — расчётные операции в тренажёре отключены.</p>
          {cases.map(c=><div key={c.id} className="between"><span>{c.id} · {c.client}</span><b>{c.offer?c.offer+' ₽ (предложение)':'Без предложения'}</b></div>)}
        </section>}
        {tab==='company'&&<section className="card stack"><span className="sandbox-eyebrow">ПАРТНЁР</span><h2>Данные организации</h2>
          <label className="stack">Название организации<input className="field" value={company} maxLength={100} onChange={e=>setCompany(e.target.value)}/></label>
          <p className="note">Изменения профиля не отправляются в настоящий аккаунт.</p>
          <button type="button" className="btn" onClick={()=>setMessage('Данные тестовой организации обновлены локально.')}>Сохранить демонстрационный профиль</button>
        </section>}
      </div>
    </div>
    <div className="sandbox-footer"><button type="button" className="btn ghost small" onClick={()=>{setCases(seed);setSelected('DEMO-101');setTab('queue');setMessage('Тестовые данные сброшены.')}}>Сбросить тренажёр</button><a href="#/admin/test-center">← Все кабинеты</a></div>
  </main>;
}
