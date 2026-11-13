import { useState } from 'react';

// This is an isolated, local-only interactive training environment. Never
// import get/post/put from api.ts or perform real HTTP/SMS/payment operations.
type DemoRole = 'client'|'owner'|'driver'|'master'|'tow'|'service'|
  'master_service'|'insurer'|'moderator'|'admin';
type Ticket = { id: number; name: string; state: string };
type Notice = { kind: 'ok'|'bad'; message: string } | null;
type Tab = 'overview'|'tasks'|'profile'|'failures';
const DEMO_ROLES: {id:DemoRole;label:string;summary:string;task:string}[] = [
  {id:'client',label:'Клиент',summary:'Помощь на дороге, заявки и история',task:'Вызов помощи'},
  {id:'owner',label:'Владелец / автопарк',summary:'Машины, водители, страхование',task:'Запрос по грузовику'},
  {id:'driver',label:'Водитель автопарка',summary:'Закреплённый грузовик и заявки',task:'Запрос помощи водителем'},
  {id:'master',label:'Выездной мастер',summary:'Рабочая линия, заказы, профиль',task:'Выезд на ремонт'},
  {id:'tow',label:'Эвакуаторщик',summary:'Заявки на эвакуацию и техника',task:'Заказ эвакуатора'},
  {id:'service',label:'Рембаза / СТО',summary:'Запись, заказ-наряды, ремонт',task:'Запись на сервис'},
  {id:'master_service',label:'Мастер и своя СТО',summary:'Выезды и стационарный ремонт',task:'Заявка мастеру и СТО'},
  {id:'insurer',label:'Страховой партнёр',summary:'Назначенные заявки, документы и полисы',task:'Оформление полиса'},
  {id:'moderator',label:'Модератор',summary:'Споры, обращения и проверка исполнителей',task:'Разбор обращения'},
  {id:'admin',label:'Администратор',summary:'Управление и контроль площадки',task:'Модерация площадки'},
];
const demoInitial = (role: DemoRole): Ticket[] => [
  {id:1,name:DEMO_ROLES.find(c=>c.id===role)?.task??'Проверочная заявка',state:'Новая'},
  {id:2,name:'Проверка истории операций',state:'В работе'},
];
const labelFor = (id:DemoRole) => DEMO_ROLES.find(c=>c.id===id)!;

export function AdminTestCenter() {
  const [role,setRole] = useState<DemoRole>('client');
  const [tab,setTab] = useState<Tab>('overview');
  const [tickets,setTickets] = useState<Partial<Record<DemoRole,Ticket[]>>>({});
  const [text,setText] = useState('');
  const [displayName,setDisplayName] = useState('Тестовый пользователь');
  const [notice,setNotice] = useState<Notice>(null);
  const data = tickets[role] ?? demoInitial(role);
  const current = labelFor(role);
  const announce = (kind:Notice['kind'],message:string) => setNotice({kind,message});
  const choose = (id:DemoRole) => {
    setRole(id);setTab('overview');setNotice(null);setText('');
    setDisplayName('Тестовый пользователь');
  };
  const update = (next:Ticket[]) => setTickets(previous=>({...previous,[role]:next}));
  const create = () => {
    if (!text.trim()) {
      announce('bad','Укажите описание — пустая заявка не создана.');
      return;
    }
    update([...data,{id:Math.max(0,...data.map(x=>x.id))+1,name:text.trim().slice(0,120),state:'Новая'}]);
    setText('');
    announce('ok','Демонстрационная заявка создана только в памяти страницы. На сервер ничего не отправлялось.');
  };
  const next = (id:number,reject=false) => {
    update(data.map(x=>x.id===id ? {...x,state:reject?'Отменена':x.state==='Новая'?'В работе':'Завершена'} : x));
    announce('ok','Статус изменён только в тестовом режиме.');
  };
  const tabs:[Tab,string][] = [
    ['overview','Обзор'],['tasks','Заявки и действия'],['profile','Профиль'],['failures','Проверка ошибок'],
  ];
  return <main className="stack" aria-label="Тестовый центр администратора">
    <div className="between" style={{alignItems:'flex-start',gap:12,flexWrap:'wrap'}}>
      <div className="stack" style={{gap:4}}>
        <span className="label">Только для администратора · отдельная песочница</span>
        <h1>Тестирование кабинетов</h1>
        <p className="sub">Переключайте тип кабинета и проверяйте типовые действия, заполнение, ошибки и состояния.</p>
      </div>
      <a className="btn ghost small" href="#/admin">Вернуться в админку</a>
    </div>
    <div className="banner" role="note">
      <b>ТЕСТОВЫЙ РЕЖИМ — НЕ РЕАЛЬНЫЕ АККАУНТЫ</b>
      <span>Здесь демонстрационные данные и сценарии. Они не заменяют полную проверку настоящих кабинетов.
        Действия не создают заявок, платежей, SMS или уведомлений.</span>
    </div>
    <div className="stack" role="group" aria-label="Выбор тестового кабинета">
      <span className="label">Кабинет для просмотра</span>
      <div className="grid2">
        {DEMO_ROLES.map(c=><button type="button" key={c.id} className="seg"
          aria-pressed={role===c.id} onClick={()=>choose(c.id)}>{c.label}</button>)}
      </div>
    </div>
    <div className="card stack">
      <div className="between"><b>{current.label}</b><span className="pill">Демо</span></div>
      <span className="note">{current.summary}</span>
      <div className="scroll-x" role="tablist" aria-label="Разделы тестового кабинета">
        {tabs.map(([id,label])=><button type="button" key={id} className="chip"
          role="tab" aria-selected={tab===id} onClick={()=>{setTab(id);setNotice(null);}}>{label}</button>)}
      </div>
    </div>
    {notice && <div className={'banner '+(notice.kind==='bad'?'bad':'good')}
      role={notice.kind==='bad'?'alert':'status'}>{notice.message}</div>}
    {tab==='overview' && <div className="stack">
      <div className="grid2">
        <div className="card stack"><b>Активные записи</b><strong>{data.filter(x=>x.state!=='Завершена'&&x.state!=='Отменена').length}</strong>
          <span className="note">Вымышленные примеры</span></div>
        <div className="card stack"><b>Последнее действие</b><span>{data[0]?.state??'Пусто'}</span>
          <span className="note">Меняется внутри деморежима</span></div>
      </div>
      <button type="button" className="btn" onClick={()=>setTab('tasks')}>Открыть заявки</button>
      <button type="button" className="btn ghost" onClick={()=>setTab('profile')}>Проверить профиль</button>
    </div>}
    {tab==='tasks' && <div className="stack">
      <span className="label">Имитированные заявки и статусы</span>
      {data.length===0&&<div className="empty">Заявок нет. Создайте тестовую заявку ниже.</div>}
      {data.map(t=><div className="card stack" key={t.id}>
        <div className="between"><b>Демо №{t.id} · {t.name}</b><span className="pill">{t.state}</span></div>
        <div className="row">
          <button type="button" className="btn small" disabled={['Завершена','Отменена'].includes(t.state)}
            onClick={()=>next(t.id)}>{t.state==='Новая'?'Принять':'Завершить'}</button>
          <button type="button" className="btn ghost small" disabled={['Завершена','Отменена'].includes(t.state)}
            onClick={()=>next(t.id,true)}>Отклонить</button>
        </div>
      </div>)}
      <label className="stack">Описание тестовой заявки
        <input className="field" value={text} onChange={e=>setText(e.target.value)}
          maxLength={120} placeholder={'Например: '+current.task}/>
      </label>
      <button type="button" className="btn" onClick={create}>Создать тестовую заявку</button>
      <button type="button" className="btn ghost" onClick={()=>{update(demoInitial(role));announce('ok','Тестовые записи возвращены в исходное состояние.');}}>
        Сбросить примеры
      </button>
    </div>}
    {tab==='profile' && <div className="card stack">
      <h2>Профиль — демонстрационные сведения</h2>
      <label className="stack">Имя в интерфейсе
        <input className="field" value={displayName} onChange={e=>setDisplayName(e.target.value)} maxLength={80}/>
      </label>
      <span className="note">Телефон и документы вымышленные, реальных данных пользователей здесь нет.</span>
      <button type="button" className="btn" onClick={()=>{
        if (!displayName.trim()) announce('bad','Введите имя, иначе профиль не сохранится.');
        else announce('ok','Демо: имя сохранено локально. Реальный профиль не изменён.');
      }}>Сохранить профиль (демо)</button>
    </div>}
    {tab==='failures' && <div className="card stack">
      <h2>Отображение ошибок</h2>
      <p className="sub">Проверьте, что вместо пустого экрана появляется объяснение.</p>
      <button type="button" className="btn ghost" onClick={()=>announce('bad','Нет связи с сервером. Проверьте интернет и повторите действие.')}>
        Смоделировать отсутствие связи
      </button>
      <button type="button" className="btn ghost" onClick={()=>announce('bad','Нет доступа к этому действию. Нужны соответствующие полномочия.')}>
        Смоделировать отказ в доступе
      </button>
      <button type="button" className="btn ghost" onClick={()=>announce('bad','Некорректные данные. Проверьте обязательные поля формы.')}>
        Смоделировать ошибку формы
      </button>
      <button type="button" className="btn ghost" onClick={()=>{setNotice(null);announce('ok','Сценарий восстановлен. Можно продолжить тестирование.');}}>
        Повторить после ошибки
      </button>
    </div>}
  </main>;
}
