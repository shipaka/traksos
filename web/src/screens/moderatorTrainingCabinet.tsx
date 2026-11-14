import {useState} from 'react';

// Local-only moderation simulation. Decisions cannot affect live users or cases.
type Status='Ожидает проверки'|'На рассмотрении'|'Одобрено'|'Отклонено';
type Case={id:number;kind:string;subject:string;status:Status;reason:string};
const sample:Case[]=[
  {id:501,kind:'Проверка документов',subject:'Исполнитель · Иван Петров',status:'Ожидает проверки',reason:''},
  {id:502,kind:'Жалоба на заказ',subject:'Заявка SOS-104',status:'Ожидает проверки',reason:''},
  {id:503,kind:'Спор по отзыву',subject:'Отзыв на СТО',status:'На рассмотрении',reason:''},
];
type Tab='queue'|'appeals'|'decisions'|'rules';
export function ModeratorTrainingCabinet(){
  const [cases,setCases]=useState<Case[]>(sample);
  const [selected,setSelected]=useState(501);
  const [reason,setReason]=useState('');
  const [tab,setTab]=useState<Tab>('queue');
  const [notice,setNotice]=useState('');
  const nav:[Tab,string][]=[['queue','Очередь проверки'],['appeals','Жалобы и обращения'],['decisions','История решений'],['rules','Регламент']];
  const current=cases.find(c=>c.id===selected)!;
  const decide=(status:Status)=>{if(status==='Отклонено'&&!reason.trim()){setNotice('Укажите причину отклонения.');return;}setCases(a=>a.map(c=>c.id===selected?{...c,status,reason:reason.trim()}:c));setReason('');setNotice('Решение сохранено только в тренажёре.');};
  const visible=cases.filter(c=>tab==='appeals'?c.kind!=='Проверка документов':tab==='decisions'?['Одобрено','Отклонено'].includes(c.status):true);
  return <main className="sandbox-root sandbox-cabinet stack" aria-label="Тестовый кабинет: Модератор">
    <div className="sandbox-breadcrumb"><a href="#/admin/test-center">← Назад к выбору кабинетов</a><span className="pill accent">ТЕСТОВЫЙ РЕЖИМ</span></div>
    <section className="sandbox-hero"><span className="sandbox-eyebrow">TRAKSOS · МОДЕРАЦИЯ</span><h1>Центр проверки и обращений</h1><p>Документы исполнителей, жалобы, спорные отзывы и история решений в безопасном режиме.</p>
      <div className="row"><button className="btn" type="button" onClick={()=>setTab('queue')}>Открыть очередь</button><button className="btn ghost" type="button" onClick={()=>setTab('decisions')}>История решений</button></div>
    </section>
    <div className="banner" role="note"><b>АДМИНИСТРАТОР · ДЕМОНСТРАЦИЯ</b><span>Ни один пользователь не блокируется. Настоящие документы и жалобы не изменяются.</span></div>
    <div className="sandbox-workspace"><nav className="sandbox-nav" aria-label="Разделы кабинета модератора">
      <div className="sandbox-identity"><span>⚑</span><div><b>Тестовый модератор</b><small>{cases.filter(c=>!['Одобрено','Отклонено'].includes(c.status)).length} ожидают решения</small></div></div>
      {nav.map(([id,label])=><button type="button" key={id} className={tab===id?'active':''} aria-current={tab===id?'page':undefined} onClick={()=>{setTab(id);setNotice('')}}>{label}</button>)}
      <a href="#/admin/test-center">← Все кабинеты</a>
    </nav><div className="sandbox-panel stack" aria-live="polite">
      {notice&&<div className="banner" role="status">{notice}</div>}
      {tab==='rules'?<section className="card stack"><h2>Регламент модерации</h2><p>Проверить обращение, изучить подтверждающие сведения, зафиксировать мотивированное решение и сохранить историю. Действия в этом тренажёре не отправляются на сервер.</p></section>:<>
        <div className="sandbox-section-head"><div><span className="sandbox-eyebrow">ПРОВЕРКА</span><h2>{nav.find(n=>n[0]===tab)?.[1]}</h2></div><span className="pill">{visible.length} записей</span></div>
        {visible.length===0&&<p className="empty">Записей пока нет.</p>}
        <div className="sandbox-feature-grid">{visible.map(c=><button type="button" className="sandbox-feature" key={c.id} aria-pressed={selected===c.id} onClick={()=>setSelected(c.id)}><b>№{c.id} · {c.kind}</b><small>{c.subject}</small><em>{c.status}</em></button>)}</div>
        {visible.some(c=>c.id===selected)&&<section className="card stack" aria-label="Карточка проверки"><h3>№{current.id} · {current.kind}</h3><p className="note">{current.subject} · {current.status}</p>
          {['Одобрено','Отклонено'].includes(current.status)?<p>Решение: {current.status}. {current.reason}</p>:<>
            <label className="stack">Комментарий к решению<textarea className="field" maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Причина и результаты проверки"/></label>
            <div className="row"><button className="btn" type="button" onClick={()=>decide('На рассмотрении')} disabled={current.status==='На рассмотрении'}>Взять на проверку</button><button className="btn" type="button" onClick={()=>decide('Одобрено')}>Одобрить</button><button className="btn ghost" type="button" onClick={()=>decide('Отклонено')}>Отклонить</button></div>
          </>}
        </section>}
      </>}
    </div></div>
    <div className="sandbox-footer"><button className="btn ghost small" type="button" onClick={()=>{setCases(sample);setSelected(501);setTab('queue');setNotice('Тестовые данные сброшены.')}}>Сбросить тренажёр</button><a href="#/admin/test-center">← Все кабинеты</a></div>
  </main>;
}
