import {useState} from 'react';

// Training-only dispatch board: no network, persistent storage, calls or payments.
type Status='Новая'|'Принята'|'В пути'|'На месте'|'Завершена'|'Отклонена';
type Job={id:number;title:string;location:string;status:Status;fee:number};
const initial:Job[]=[
  {id:201,title:'Диагностика пневмосистемы · Scania R520',location:'М-11, 124-й км',status:'Новая',fee:8500},
  {id:202,title:'Не запускается DAF XF',location:'М-10, стоянка',status:'Принята',fee:6200},
];
export function PerformerTrainingCabinet({tow=false}:{tow?:boolean}){
  const [jobs,setJobs]=useState<Job[]>(tow?initial.map(j=>({...j,title:'Эвакуация · '+j.title})):initial);
  const [tab,setTab]=useState<'dispatch'|'active'|'history'|'finance'|'equipment'>('dispatch');
  const [online,setOnline]=useState(false);
  const [notice,setNotice]=useState('');
  const [vehicle,setVehicle]=useState(tow?'Грузовой эвакуатор · 25 т':'Выездной сервис · Scania');
  const nav:[typeof tab,string][]=[['dispatch','Новые вызовы'],['active','Мои выезды'],['history','История работ'],['finance','Финансы'],['equipment',tow?'Мой эвакуатор':'Профиль мастера']];
  const change=(id:number,status:Status)=>{setJobs(list=>list.map(j=>j.id===id?{...j,status}:j));setNotice('Статус изменён только в демонстрационном кабинете.');};
  const active=jobs.filter(j=>['Принята','В пути','На месте'].includes(j.status));
  const newJobs=jobs.filter(j=>j.status==='Новая');
  return <main className="sandbox-root sandbox-cabinet stack" aria-label={'Тестовый кабинет: '+(tow?'Эвакуаторщик':'Выездной мастер')}>
    <div className="sandbox-breadcrumb"><a href="#/admin/test-center">← Назад к выбору кабинетов</a><span className="pill accent">ТЕСТОВЫЙ РЕЖИМ</span></div>
    <section className="sandbox-hero"><span className="sandbox-eyebrow">TRACKSOS · {tow?'ЭВАКУАТОР':'ВЫЕЗДНОЙ МАСТЕР'}</span>
      <h1>{tow?'Диспетчерская эвакуации':'Ваша рабочая смена'}</h1><p>Входящие вызовы, этапы выезда, история и расчёты в безопасном демонстрационном режиме.</p>
      <div className="row"><button className="btn" type="button" onClick={()=>setOnline(v=>!v)}>{online?'На линии · Отключиться':'Выйти на линию'}</button><button className="btn ghost" type="button" onClick={()=>setTab('active')}>Активные выезды ({active.length})</button></div>
    </section>
    <div className="banner" role="note"><b>АДМИНИСТРАТОР · ДЕМОНСТРАЦИЯ</b><span>Выезды, уведомления, геолокация, звонки и деньги настоящих пользователей не затрагиваются.</span></div>
    <div className="sandbox-workspace"><nav className="sandbox-nav" aria-label="Разделы кабинета исполнителя">
      <div className="sandbox-identity"><span>{tow?'↗':'⚡'}</span><div><b>{tow?'Эвакуаторщик':'Выездной мастер'}</b><small>{online?'На линии · демо':'Не на линии · демо'}</small></div></div>
      {nav.map(([id,label])=><button key={id} type="button" className={tab===id?'active':''} aria-current={tab===id?'page':undefined} onClick={()=>{setTab(id);setNotice('')}}>{label}</button>)}
      <a href="#/admin/test-center">← Все кабинеты</a>
    </nav><div className="sandbox-panel stack" aria-live="polite">
      {notice&&<div className="banner" role="status">{notice}</div>}
      {tab==='dispatch'&&<><div className="sandbox-section-head"><div><span className="sandbox-eyebrow">ДИСПЕТЧЕРСКАЯ</span><h2>Новые вызовы</h2></div><span className="pill">{newJobs.length} заявок</span></div>
        {!online&&<p className="note">Чтобы принимать вызовы, включите тестовый статус «На линии».</p>}
        {newJobs.map(j=><section className="card stack" key={j.id}><b>№{j.id} · {j.title}</b><span className="note">{j.location} · {j.fee.toLocaleString('ru-RU')} ₽ (пример)</span>
          <div className="row"><button type="button" className="btn" disabled={!online} onClick={()=>{change(j.id,'Принята');setTab('active')}}>Принять вызов</button><button type="button" className="btn ghost" onClick={()=>change(j.id,'Отклонена')}>Отклонить</button></div>
        </section>)}
      </>}
      {tab==='active'&&<><h2>Мои выезды</h2>{active.length===0&&<p className="empty">Активных выездов нет.</p>}
        {active.map(j=><section className="card stack" key={j.id}><b>№{j.id} · {j.title}</b><span className="note">{j.location} · {j.status}</span>
          <div className="row"><button type="button" className="btn" onClick={()=>change(j.id,j.status==='Принята'?'В пути':j.status==='В пути'?'На месте':'Завершена')}>{j.status==='Принята'?'Начать выезд':j.status==='В пути'?'Прибыл на место':'Завершить работу'}</button></div></section>)}
      </>}
      {tab==='history'&&<><h2>История работ</h2>{jobs.filter(j=>['Завершена','Отклонена'].includes(j.status)).length===0?<p className="empty">История пока пуста.</p>:jobs.filter(j=>['Завершена','Отклонена'].includes(j.status)).map(j=><section key={j.id} className="card stack"><b>№{j.id} · {j.title}</b><span>{j.status} · {j.location}</span></section>)}</>}
      {tab==='finance'&&<section className="card stack"><h2>Финансы и выплаты</h2><p className="note">Суммы ниже — демонстрационные расценки, не баланс и не реальные выплаты.</p>{jobs.map(j=><div key={j.id} className="between"><span>№{j.id} · {j.status}</span><b>{j.fee.toLocaleString('ru-RU')} ₽</b></div>)}</section>}
      {tab==='equipment'&&<section className="card stack"><h2>{tow?'Моя техника':'Мой профиль'}</h2><label className="stack">Техника и оснащение<input className="field" value={vehicle} onChange={e=>setVehicle(e.target.value)} maxLength={100}/></label><button className="btn" type="button" onClick={()=>setNotice('Тестовые сведения обновлены локально.')}>Сохранить сведения</button></section>}
    </div></div>
    <div className="sandbox-footer"><button type="button" className="btn ghost small" onClick={()=>{setJobs(tow?initial.map(j=>({...j,title:'Эвакуация · '+j.title})):initial);setTab('dispatch');setOnline(false);setNotice('Тестовые данные сброшены.')}}>Сбросить тренажёр</button><a href="#/admin/test-center">← Все кабинеты</a></div>
  </main>;
}
