import {useState} from 'react';

// Standalone, local-only customer/driver simulation. No real API or external actions.
type Page='road'|'garage'|'requests'|'history'|'profile';
type Job={id:number;kind:string;vehicle:string;status:'Ожидает'|'В пути'|'Завершена'|'Отменена'};
const example:Job[]=[{id:101,kind:'Диагностика электрики',vehicle:'Scania R520',status:'Ожидает'}];
export function CustomerTrainingCabinet({driver=false}:{driver?:boolean}){
  const [page,setPage]=useState<Page>('road');
  const [jobs,setJobs]=useState<Job[]>(example);
  const [vehicle,setVehicle]=useState('Scania R520');
  const [service,setService]=useState('Выездной мастер');
  const [problem,setProblem]=useState('');
  const [name,setName]=useState(driver?'Тестовый водитель':'Тестовый клиент');
  const [note,setNote]=useState('');
  const menu:[Page,string][]=[['road','Помощь на дороге'],['garage',driver?'Мой грузовик':'Мой гараж'],['requests','Мои заявки'],['history','История'],['profile','Профиль']];
  const active=jobs.filter(j=>j.status==='Ожидает'||j.status==='В пути');
  const update=(id:number,status:Job['status'])=>setJobs(a=>a.map(j=>j.id===id?{...j,status}:j));
  const create=()=>{if(!problem.trim()){setNote('Опишите проблему с грузовиком.');return;}setJobs(a=>[{id:Math.max(...a.map(j=>j.id),100)+1,kind:service+': '+problem.trim().slice(0,80),vehicle,status:'Ожидает'},...a]);setProblem('');setPage('requests');setNote('Демонстрационная заявка создана без обращения к серверу.');};
  return <main className="sandbox-root sandbox-cabinet stack" aria-label={'Тестовый кабинет: '+(driver?'Водитель автопарка':'Клиент')}>
    <div className="sandbox-breadcrumb"><a href="#/admin/test-center">← Назад к выбору кабинетов</a><span className="pill accent">ТЕСТОВЫЙ РЕЖИМ</span></div>
    <section className="sandbox-hero"><span className="sandbox-eyebrow">TRAKSOS · {driver?'ВОДИТЕЛЬ':'КЛИЕНТ'}</span>
      <h1>{driver?'Помощь в каждом рейсе':'Помощь грузовику — рядом'}</h1><p>Вызов помощи, транспорт, заявки и история · изолированный интерактивный кабинет.</p>
      <div className="row"><button className="btn" type="button" onClick={()=>setPage('road')}>Вызвать помощь</button><button className="btn ghost" type="button" onClick={()=>setPage('requests')}>Мои заявки ({active.length})</button></div>
    </section>
    <div className="banner" role="note"><b>АДМИНИСТРАТОР · ДЕМОНСТРАЦИЯ</b><span>Все заявки и изменения вымышленные. Настоящие звонки, геолокация, SMS и платежи отключены.</span></div>
    <div className="sandbox-workspace"><nav className="sandbox-nav" aria-label="Разделы клиентского кабинета">
      <div className="sandbox-identity"><span>✚</span><div><b>{name}</b><small>{driver?'Закреплённый транспорт':'Тестовый аккаунт'}</small></div></div>
      {menu.map(([id,title])=><button key={id} type="button" className={page===id?'active':''} aria-current={page===id?'page':undefined} onClick={()=>{setPage(id);setNote('')}}>{title}</button>)}
      <a href="#/admin/test-center">← Все кабинеты</a>
    </nav><div className="sandbox-panel stack" aria-live="polite">
      {note&&<div className="banner" role="status">{note}</div>}
      {page==='road'&&<><div className="sandbox-section-head"><div><span className="sandbox-eyebrow">SOS · ДЕМО</span><h2>Какая помощь нужна?</h2><p className="note">Заявка не зависит от наличия автомобиля в гараже.</p></div></div>
        <div className="sandbox-feature-grid">{['Выездной мастер','Эвакуатор','Шиномонтаж'].map(s=><button className="sandbox-feature" key={s} type="button" aria-pressed={service===s} onClick={()=>setService(s)}><b>{s}</b><small>{service===s?'Выбрано':'Выбрать услугу'}</small></button>)}</div>
        <section className="card stack"><label className="stack">Транспорт<input className="field" value={vehicle} onChange={e=>setVehicle(e.target.value)} maxLength={80}/></label>
          <label className="stack">Что случилось?<textarea className="field" value={problem} onChange={e=>setProblem(e.target.value)} maxLength={400} placeholder="Опишите неисправность или ситуацию"/></label>
          <button type="button" className="btn" onClick={create}>Создать тестовую заявку</button>
        </section>
      </>}
      {page==='garage'&&<section className="card stack"><span className="sandbox-eyebrow">ТРАНСПОРТ · ДЕМО</span><h2>{driver?'Мой закреплённый грузовик':'Мой гараж'}</h2>
        <label className="stack">Грузовой автомобиль<input className="field" value={vehicle} onChange={e=>setVehicle(e.target.value)} maxLength={80}/></label>
        <p className="note">{driver?'Данные машины изменяются только в тренажёре. В рабочем кабинете закрепление выполняет владелец автопарка.':'История и документы транспорта доступны в рабочем кабинете; здесь данные не сохраняются.'}</p>
        <button type="button" className="btn" onClick={()=>{setPage('road');setNote('Выбран тестовый грузовик.')}}>Запросить помощь для машины</button>
      </section>}
      {page==='requests'&&<><div className="sandbox-section-head"><div><span className="sandbox-eyebrow">ЗАЯВКИ</span><h2>Активные обращения</h2></div><span className="pill">{active.length} активных</span></div>
        {active.length===0&&<p className="empty">Активных заявок нет.</p>}
        {active.map(j=><section key={j.id} className="card stack"><b>№{j.id} · {j.kind}</b><span className="note">{j.vehicle} · {j.status}</span>
          <div className="row"><button className="btn" type="button" onClick={()=>update(j.id,j.status==='Ожидает'?'В пути':'Завершена')}>{j.status==='Ожидает'?'Исполнитель выехал':'Завершить'}</button>
            <button className="btn ghost" type="button" onClick={()=>update(j.id,'Отменена')}>Отменить</button></div></section>)}
        <button type="button" className="btn ghost" onClick={()=>setPage('road')}>+ Новая заявка</button>
      </>}
      {page==='history'&&<><h2>История обращений</h2>{jobs.filter(j=>j.status==='Завершена'||j.status==='Отменена').length===0?<p className="empty">История пока пуста.</p>:jobs.filter(j=>j.status==='Завершена'||j.status==='Отменена').map(j=><section className="card stack" key={j.id}><b>№{j.id} · {j.kind}</b><span>{j.vehicle} · {j.status}</span><button className="btn ghost" type="button" onClick={()=>{setService(j.kind.split(':')[0]);setPage('road')}}>Повторить обращение</button></section>)}</>}
      {page==='profile'&&<section className="card stack"><h2>Мой профиль</h2><label className="stack">Имя<input className="field" value={name} onChange={e=>setName(e.target.value)} maxLength={80}/></label><button className="btn" type="button" onClick={()=>setNote('Изменения профиля сохранены только в тренажёре.')}>Сохранить тестовый профиль</button></section>}
    </div></div>
    <div className="sandbox-footer"><button type="button" className="btn ghost small" onClick={()=>{setJobs(example);setVehicle('Scania R520');setPage('road');setNote('Тестовые данные сброшены.')}}>Сбросить тренажёр</button><a href="#/admin/test-center">← Все кабинеты</a></div>
  </main>;
}
