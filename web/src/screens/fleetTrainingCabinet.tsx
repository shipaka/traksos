import {useState} from 'react';

// Entire fleet management simulator runs in React memory; no live data or network.
type Truck={id:number;name:string;plate:string;driver:string;state:'В рейсе'|'На стоянке'|'На ремонте'};
type Request={id:number;truckId:number;kind:string;state:'Новая'|'В работе'|'Завершена'};
const initialTrucks:Truck[]=[
  {id:1,name:'Scania R520 · 2021',plate:'А123АА 77',driver:'Иван Петров',state:'В рейсе'},
  {id:2,name:'DAF XF · 2018',plate:'В456ВВ 77',driver:'Сергей Иванов',state:'На стоянке'},
  {id:3,name:'Полуприцеп Schmitz',plate:'АА1234 77',driver:'Не назначен',state:'На ремонте'},
];
const initialRequests:Request[]=[{id:301,truckId:3,kind:'Проверка тормозной системы',state:'В работе'}];
type Tab='fleet'|'drivers'|'requests'|'history'|'finance';
export function FleetTrainingCabinet(){
  const [trucks,setTrucks]=useState<Truck[]>(initialTrucks);
  const [requests,setRequests]=useState<Request[]>(initialRequests);
  const [tab,setTab]=useState<Tab>('fleet');
  const [selected,setSelected]=useState(1);
  const [driver,setDriver]=useState('');
  const [issue,setIssue]=useState('');
  const [notice,setNotice]=useState('');
  const nav:[Tab,string][]=[['fleet','Мой автопарк'],['drivers','Водители'],['requests','Обслуживание и заявки'],['history','История'],['finance','Расходы']];
  const current=trucks.find(t=>t.id===selected)!;
  const active=requests.filter(r=>r.state!=='Завершена');
  const updateTruck=(patch:Partial<Truck>)=>setTrucks(a=>a.map(t=>t.id===selected?{...t,...patch}:t));
  const add=()=>{if(!issue.trim()){setNotice('Опишите неисправность или услугу.');return;}setRequests(a=>[{id:Math.max(...a.map(r=>r.id),300)+1,truckId:selected,kind:issue.trim().slice(0,120),state:'Новая'},...a]);setIssue('');setNotice('Тестовая заявка создана без обращения к серверу.');};
  return <main className="sandbox-root sandbox-cabinet stack" aria-label="Тестовый кабинет: Владелец автопарка">
    <div className="sandbox-breadcrumb"><a href="#/admin/test-center">← Назад к выбору кабинетов</a><span className="pill accent">ТЕСТОВЫЙ РЕЖИМ</span></div>
    <section className="sandbox-hero"><span className="sandbox-eyebrow">TRAKSOS · ВЛАДЕЛЕЦ АВТОПАРКА</span><h1>Мой автопарк</h1>
      <p>Грузовики, водители, заявки и обслуживание техники · безопасный демонстрационный кабинет.</p>
      <div className="row"><button className="btn" type="button" onClick={()=>setTab('fleet')}>Управлять транспортом</button><button className="btn ghost" type="button" onClick={()=>setTab('requests')}>Заявки ({active.length})</button></div>
    </section>
    <div className="banner" role="note"><b>АДМИНИСТРАТОР · ДЕМОНСТРАЦИЯ</b><span>Данные вымышленные. Назначение водителей и заявки не изменяют реальные аккаунты.</span></div>
    <div className="sandbox-workspace"><nav className="sandbox-nav" aria-label="Разделы кабинета автопарка">
      <div className="sandbox-identity"><span>▰</span><div><b>Тестовый автопарк</b><small>{trucks.length} единицы техники</small></div></div>
      {nav.map(([id,label])=><button type="button" key={id} className={tab===id?'active':''} aria-current={tab===id?'page':undefined} onClick={()=>{setTab(id);setNotice('')}}>{label}</button>)}
      <a href="#/admin/test-center">← Все кабинеты</a>
    </nav><div className="sandbox-panel stack" aria-live="polite">
      {notice&&<div className="banner" role="status">{notice}</div>}
      {tab==='fleet'&&<><div className="sandbox-section-head"><div><span className="sandbox-eyebrow">ТРАНСПОРТ</span><h2>Техника автопарка</h2></div><span className="pill">{trucks.length} единицы</span></div>
        <div className="sandbox-metrics"><div className="sandbox-metric"><small>В рейсе</small><strong>{trucks.filter(t=>t.state==='В рейсе').length}</strong></div><div className="sandbox-metric"><small>На стоянке</small><strong>{trucks.filter(t=>t.state==='На стоянке').length}</strong></div><div className="sandbox-metric"><small>На ремонте</small><strong>{trucks.filter(t=>t.state==='На ремонте').length}</strong></div></div>
        <div className="sandbox-feature-grid">{trucks.map(t=><button className="sandbox-feature" key={t.id} type="button" aria-pressed={selected===t.id} onClick={()=>setSelected(t.id)}><b>{t.name}</b><small>{t.plate} · {t.driver}</small><em>{t.state}</em></button>)}</div>
        <section className="card stack"><h3>{current.name}</h3><p className="note">Госномер: {current.plate} · водитель: {current.driver}</p>
          <label className="stack">Статус техники<select className="field" value={current.state} onChange={e=>updateTruck({state:e.target.value as Truck['state']})}>{(['В рейсе','На стоянке','На ремонте'] as const).map(v=><option key={v}>{v}</option>)}</select></label>
          <button type="button" className="btn" onClick={()=>setTab('requests')}>Оформить обслуживание</button>
        </section>
      </>}
      {tab==='drivers'&&<><h2>Водители и закрепление техники</h2><label className="stack">Грузовик<select className="field" value={selected} onChange={e=>setSelected(Number(e.target.value))}>{trucks.map(t=><option value={t.id} key={t.id}>{t.name}</option>)}</select></label>
        <p className="note">Сейчас закреплён: {current.driver}</p><label className="stack">Имя водителя<input className="field" value={driver} maxLength={80} onChange={e=>setDriver(e.target.value)} placeholder="ФИО водителя"/></label>
        <button type="button" className="btn" onClick={()=>{if(!driver.trim()){setNotice('Укажите имя водителя.');return;}updateTruck({driver:driver.trim()});setDriver('');setNotice('Тестовое закрепление обновлено.')}}>Закрепить водителя</button>
      </>}
      {tab==='requests'&&<><div className="sandbox-section-head"><div><span className="sandbox-eyebrow">ОБСЛУЖИВАНИЕ</span><h2>Заявки автопарка</h2></div><span className="pill">{active.length} активных</span></div>
        {requests.map(r=><section className="card stack" key={r.id}><b>№{r.id} · {r.kind}</b><span className="note">{trucks.find(t=>t.id===r.truckId)?.name} · {r.state}</span>
          <button type="button" className="btn ghost" disabled={r.state==='Завершена'} onClick={()=>setRequests(a=>a.map(x=>x.id===r.id?{...x,state:x.state==='Новая'?'В работе':'Завершена'}:x))}>{r.state==='Новая'?'Взять в работу':'Завершить'}</button></section>)}
        <section className="card stack"><h3>Новая заявка</h3><label className="stack">Техника<select className="field" value={selected} onChange={e=>setSelected(Number(e.target.value))}>{trucks.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label className="stack">Неисправность или услуга<textarea className="field" value={issue} maxLength={400} onChange={e=>setIssue(e.target.value)}/></label><button type="button" className="btn" onClick={add}>Создать тестовую заявку</button></section>
      </>}
      {tab==='history'&&<><h2>История обслуживания</h2>{requests.filter(r=>r.state==='Завершена').length===0?<p className="empty">Завершённых работ пока нет.</p>:requests.filter(r=>r.state==='Завершена').map(r=><section className="card stack" key={r.id}><b>№{r.id} · {r.kind}</b><span>{trucks.find(t=>t.id===r.truckId)?.name}</span></section>)}</>}
      {tab==='finance'&&<section className="card stack"><h2>Расходы автопарка</h2><p className="note">В демонстрационном режиме финансовые документы и реальные суммы недоступны. Ни одна оплата не проводится.</p><b>Заявок на обслуживание: {requests.length}</b></section>}
    </div></div>
    <div className="sandbox-footer"><button type="button" className="btn ghost small" onClick={()=>{setTrucks(initialTrucks);setRequests(initialRequests);setTab('fleet');setSelected(1);setNotice('Тестовые данные сброшены.')}}>Сбросить тренажёр</button><a href="#/admin/test-center">← Все кабинеты</a></div>
  </main>;
}
