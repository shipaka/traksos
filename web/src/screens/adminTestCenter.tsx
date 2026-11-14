import { useState } from 'react';
import { InsurerTrainingCabinet } from './insurerTrainingCabinet.tsx';
import { CustomerTrainingCabinet } from './customerTrainingCabinet.tsx';
import { PerformerTrainingCabinet } from './performerTrainingCabinet.tsx';
import { FleetTrainingCabinet } from './fleetTrainingCabinet.tsx';
import { InspectionTrainingCabinet } from './inspectionTrainingCabinet.tsx';

// Admin-only DEMONSTRATION. This file deliberately has no API imports or fetch:
// even realistic-looking actions never touch real accounts, jobs, SMS or money.
type DemoRole = 'client'|'owner'|'driver'|'master'|'tow'|'service'|
  'master_service'|'insurer'|'inspection'|'moderator'|'admin';
type Section = 'overview'|'tasks'|'profile'|'history';
type Ticket = {id:number;title:string;status:'Новая'|'В работе'|'Завершена'|'Отменена'};
type RoleInfo = {
  id:DemoRole; icon:string; label:string; subtitle:string; headline:string;
  section:string; action:string; profile:string; history:string;
  features:[string,string,string][]; metrics:[string,string,string];
  activity:string[]; task:string;
};
const DEMO_ROLES:RoleInfo[] = [
  {id:'client',icon:'✚',label:'Клиент',subtitle:'Помощь на дороге и мой гараж',
    headline:'Помощь грузовику — рядом',section:'Мои заявки',action:'Создать заявку',
    profile:'Гараж и профиль',history:'История обращений',task:'Помощь с электрикой в пути',
    metrics:['1','2','0'],activity:['Открыт поиск дорожной помощи','Доступна история обращений'],
    features:[['⚡','SOS и помощь','Электрик, диагностика, шиномонтаж'],['▤','Мой гараж','Грузовики и полуприцепы'],['◉','Ближайшая помощь','Специалисты и СТО рядом']]},
  {id:'owner',icon:'▦',label:'Владелец / автопарк',subtitle:'Машины, водители и расходы',
    headline:'Весь автопарк под контролем',section:'Заявки автопарка',action:'Новая заявка',
    profile:'Мой автопарк',history:'История обслуживания',task:'Ремонт тягача Scania',
    metrics:['1','3','1'],activity:['Грузовик закреплён за водителем','Доступна история ремонта'],
    features:[['▤','Транспорт','Машины, прицепы и полуприцепы'],['♙','Водители','Назначения и доступы'],['◈','История затрат','Работы по каждой машине']]},
  {id:'driver',icon:'◉',label:'Водитель автопарка',subtitle:'Закреплённый грузовик и рейс',
    headline:'Поддержка в каждом рейсе',section:'Заявки в пути',action:'Вызвать помощь',
    profile:'Мой рейс и машина',history:'История вызовов',task:'Помощь на трассе',
    metrics:['1','1','0'],activity:['Машина закреплена за водителем','Доступен вызов SOS'],
    features:[['▤','Мой грузовик','Данные назначенной техники'],['✚','Помощь SOS','Вызов мастера или эвакуатора'],['⌁','Статус заявки','От вызова до завершения']]},
  {id:'master',icon:'⚡',label:'Выездной мастер',subtitle:'Линия, выезды и выплаты',
    headline:'Ваша рабочая смена',section:'Мои выезды',action:'Принять заявку',
    profile:'Профиль мастера',history:'История выездов',task:'Диагностика пневмосистемы',
    metrics:['1','2','1'],activity:['Демонстрационная смена открыта','Поступил заказ на диагностику'],
    features:[['●','На линии','Готовность к новым вызовам'],['⚡','Заявки рядом','Выезды по специализации'],['₽','Финансы','Комиссии и выплаты']]},
  {id:'tow',icon:'↗',label:'Эвакуаторщик',subtitle:'Эвакуация грузового транспорта',
    headline:'Вызовы без лишних звонков',section:'Заказы эвакуации',action:'Принять вызов',
    profile:'Мой эвакуатор',history:'История эвакуаций',task:'Эвакуация тягача с трассы',
    metrics:['1','2','1'],activity:['Заказ на эвакуацию поступил','Техника готова к выезду'],
    features:[['↗','Входящие вызовы','Грузовые автомобили и прицепы'],['◉','Место подачи','Маршрут к клиенту'],['▤','Моя техника','Грузоподъёмность и оснащение']]},
  {id:'service',icon:'▤',label:'Рембаза / СТО',subtitle:'Записи, боксы, заказ-наряды',
    headline:'Сервис под контролем',section:'Запись на ремонт',action:'Принять запись',
    profile:'Карточка СТО',history:'История ремонтов',task:'Запись на техническое обслуживание',
    metrics:['1','3','2'],activity:['Открыта запись на ремонт','В журнале обновлён заказ-наряд'],
    features:[['▣','Календарь','Время записи и загруженность боксов'],['⚙','Заказ-наряды','Работы и использованные детали'],['₽','Финансы','Расчёты с клиентами']]},
  {id:'master_service',icon:'◈',label:'Мастер и своя СТО',subtitle:'Выезды и стационарный ремонт',
    headline:'Два направления — один центр',section:'Выезды и ремонты',action:'Принять заказ',
    profile:'Мастер и рембаза',history:'История работ',task:'Выездной ремонт с записью на СТО',
    metrics:['2','4','1'],activity:['Получен выездной заказ','Запись в ремонтный бокс ожидает ответа'],
    features:[['⚡','Выездной мастер','Заявки на дороге'],['▤','Моя СТО','Стационарные ремонты'],['◈','Общий контроль','Разные очереди и история']]},
  {id:'insurer',icon:'◇',label:'Страховой партнёр',subtitle:'Заявки, документы, полисы',
    headline:'Страхование грузового транспорта',section:'Страховые заявки',action:'Взять в работу',
    profile:'Компания и документы',history:'История полисов',task:'Подготовить страховое предложение',
    metrics:['1','2','1'],activity:['Получена заявка на оформление полиса','Документы ожидают проверки'],
    features:[['◇','Обращения','Запросы клиентов и автопарков'],['▤','Документы','Сведения о технике и страхователе'],['◉','Статусы','Сроки, ответы и напоминания']]},
  {id:'inspection',icon:'▣',label:'Оператор техосмотра',subtitle:'Диагностические карты, осмотры и расчёты',
    headline:'Технический осмотр транспорта',section:'Заявки на техосмотр',action:'Открыть осмотр',
    profile:'Оператор и документы',history:'История техосмотров',task:'Провести технический осмотр тягача',
    metrics:['1','2','1'],activity:['Получена заявка на техосмотр','Диагностическая карта ожидает оформления'],
    features:[['▣','Осмотры','Очередь назначенных транспортных средств'],['▤','Документы','Результаты и диагностические карты'],['₽','Финансы','Начисления и выплаты оператора']]},
  {id:'moderator',icon:'⚑',label:'Модератор',subtitle:'Споры и проверка партнёров',
    headline:'Контроль качества TrackSOS',section:'Очередь модерации',action:'Открыть обращение',
    profile:'Мой профиль',history:'Журнал решений',task:'Рассмотреть жалобу на услугу',
    metrics:['1','3','2'],activity:['Поступило обращение пользователя','Проверка документов ожидает решения'],
    features:[['⚑','Обращения','Разбор конфликтных ситуаций'],['✓','Проверки','Документы мастеров и СТО'],['◈','Решения','История модерации и контроль']]},
  {id:'admin',icon:'▦',label:'Администратор',subtitle:'Управление площадкой и аналитика',
    headline:'Центр управления TrackSOS',section:'Операционная очередь',action:'Открыть событие',
    profile:'Настройки площадки',history:'История событий',task:'Проверить работу площадки',
    metrics:['1','4','2'],activity:['Новый запрос на проверку','Тестовый магазин остаётся закрытым'],
    features:[['▦','Работа сервиса','Контроль заявок и партнёров'],['▤','Магазин','Подготовка грузовых запчастей'],['▥','Статистика','Нагрузка и динамика заявок']]},
];
const rolePath = (id:DemoRole)=>'#/admin/test-center/'+id;
const initialTickets=(r:RoleInfo):Ticket[]=>[
  {id:1,title:r.task,status:'Новая'},
  {id:2,title:'Контроль: '+r.section,status:'В работе'},
];
const copy:Record<Section,string>={overview:'Главная',tasks:'Заявки',profile:'Профиль',history:'История'};
function iconLabel(role:RoleInfo, section:Section):string {
  return section==='tasks'?role.section:section==='profile'?role.profile:section==='history'?role.history:copy[section];
}

export function AdminTestCenter({roleId}:{roleId?:string}) {
  const role=DEMO_ROLES.find(r=>r.id===roleId);
  if(!role) return <main className="sandbox-root stack" aria-label="Тестовый центр администратора">
    <section className="sandbox-intro">
      <span className="sandbox-eyebrow">TRACKSOS · ЗАКРЫТЫЙ ДЕМОНСТРАЦИОННЫЙ РЕЖИМ</span>
      <h1>Тестирование кабинетов</h1>
      <p>Выберите роль: откроется отдельный рабочий экран с собственным меню, разделами и возвратом к списку.</p>
      <a className="btn ghost small" href="#/admin">← Вернуться в админку</a>
    </section>
    <div className="banner" role="note"><b>ТЕСТОВЫЙ РЕЖИМ · НЕ РЕАЛЬНЫЕ АККАУНТЫ</b>
      <span>Данные и действия вымышленные. Настоящие заявки, платежи, SMS и заказы магазинa не создаются.</span>
    </div>
    <div className="sandbox-role-grid" role="group" aria-label="Выбор тестового кабинета">
      {DEMO_ROLES.map(r=><a key={r.id} className="sandbox-role-card" href={rolePath(r.id)}>
        <span className="sandbox-role-icon" aria-hidden="true">{r.icon}</span>
        <b>{r.label}</b><span>{r.subtitle}</span>
        <strong>Открыть кабинет ↗</strong>
      </a>)}
    </div>
  </main>;
  if(role.id==='insurer')return <InsurerTrainingCabinet/>;
  if(role.id==='client'||role.id==='driver')return <CustomerTrainingCabinet driver={role.id==='driver'}/>;
  if(role.id==='master'||role.id==='tow')return <PerformerTrainingCabinet tow={role.id==='tow'}/>;
  if(role.id==='owner')return <FleetTrainingCabinet/>;
  if(role.id==='inspection')return <InspectionTrainingCabinet/>;
  return <SandboxCabinet key={role.id} role={role}/>;
}

function SandboxCabinet({role}:{role:RoleInfo}) {
  const [section,setSection]=useState<Section>('overview');
  const [tickets,setTickets]=useState<Ticket[]>(()=>initialTickets(role));
  const [name,setName]=useState('Тестовый пользователь');
  const [text,setText]=useState('');
  const [notice,setNotice]=useState<{kind:'ok'|'bad';message:string}|null>(null);
  const active=tickets.filter(t=>t.status==='Новая'||t.status==='В работе').length;
  const completed=tickets.filter(t=>t.status==='Завершена').length;
  const sections:Section[]=['overview','tasks','profile','history'];
  const go=(next:Section)=>{setSection(next);setNotice(null);};
  const announce=(kind:'ok'|'bad',message:string)=>setNotice({kind,message});
  const change=(id:number,abort=false)=>{
    setTickets(list=>list.map(t=>t.id===id?{...t,status:abort?'Отменена':t.status==='Новая'?'В работе':'Завершена'}:t));
    announce('ok','Статус изменён только в тестовом кабинете.');
  };
  const add=()=>{
    if(!text.trim()){announce('bad','Укажи описание тестовой заявки.');return;}
    setTickets(list=>[...list,{id:Math.max(0,...list.map(x=>x.id))+1,title:text.trim().slice(0,120),status:'Новая'}]);
    setText('');announce('ok','Тестовая заявка создана только на этом экране.');
  };
  return <main className="sandbox-root sandbox-cabinet stack" aria-label={'Тестовый кабинет: '+role.label}>
    <div className="sandbox-breadcrumb">
      <a href="#/admin/test-center">← Назад к выбору кабинетов</a>
      <span className="pill accent">ТЕСТОВЫЙ РЕЖИМ</span>
    </div>
    <section className="sandbox-hero">
      <div className="sandbox-hero-art" aria-hidden="true"><span>{role.icon}</span><i/><i/><i/></div>
      <span className="sandbox-eyebrow">TRACKSOS · {role.label.toUpperCase()}</span>
      <h1>{role.headline}</h1>
      <p>{role.subtitle} · Интерактивная песочница без реальных действий.</p>
      <div className="row">
        <button type="button" className="btn" onClick={()=>go('tasks')}>{role.action}</button>
        <button type="button" className="btn ghost" onClick={()=>go('profile')}>{role.profile}</button>
      </div>
    </section>
    <div className="sandbox-workspace">
      <nav className="sandbox-nav" aria-label="Разделы тестового кабинета">
        <div className="sandbox-identity"><span>{role.icon}</span><div><b>{role.label}</b><small>Демонстрационный аккаунт</small></div></div>
        {sections.map(s=><button key={s} type="button" className={section===s?'active':''}
          aria-current={section===s?'page':undefined} onClick={()=>go(s)}>
          {s==='overview'?'⌂':s==='tasks'?'▤':s==='profile'?'◉':'◷'} {iconLabel(role,s)}
        </button>)}
        <a href="#/admin/test-center">← Все кабинеты</a>
      </nav>
      <div className="sandbox-panel stack" aria-live="polite">
        {notice&&<div className={'banner '+(notice.kind==='bad'?'bad':'good')}
          role={notice.kind==='bad'?'alert':'status'}>{notice.message}</div>}
        {section==='overview'&&<>
          <div className="sandbox-section-head"><div><span className="sandbox-eyebrow">РАБОЧИЙ СТОЛ</span><h2>{role.label}</h2>
            <p className="sub">Условные данные для демонстрации интерфейса</p></div><span className="pill">Демо</span></div>
          <div className="sandbox-metrics">
            <div className="sandbox-metric"><small>{role.metrics[0]} · {role.section}</small><strong>{active}</strong><span>Активные</span></div>
            <div className="sandbox-metric"><small>{role.metrics[1]} · пример</small><strong>{tickets.length}</strong><span>Всего записей</span></div>
            <div className="sandbox-metric"><small>{role.metrics[2]} · история</small><strong>{completed}</strong><span>Завершено</span></div>
          </div>
          <div className="sandbox-feature-grid">
            {role.features.map(([symbol,title,subtitle],i)=><button type="button" key={title}
              className="sandbox-feature" onClick={()=>{go(i===2?'history':'tasks');announce('ok','Открыт раздел демонстрационного кабинета.');}}>
              <span aria-hidden="true">{symbol}</span><b>{title}</b><small>{subtitle}</small><em>Перейти ↗</em>
            </button>)}
          </div>
          <RoleScenario role={role} onOpen={()=>go('tasks')} />
          <div className="sandbox-overview-bottom">
            <div className="card stack"><b>Последние события</b>
              {role.activity.map((entry,i)=><div className="sandbox-event" key={entry}>
                <span aria-hidden="true">{i===0?'●':'◌'}</span><div><b>{entry}</b><small>Тестовая запись · без реальных данных</small></div>
              </div>)}
            </div>
            <div className="card stack sandbox-graph"><b>Активность за неделю</b>
              <span className="note">Пример графика, не статистика сервера</span>
              <div className="sandbox-bars" aria-label="Условная активность по дням">
                {[38,67,46,84,58,93,72].map((n,i)=><span key={i} style={{height:n+'%'}} title={'Демо: '+n+'%'} />)}
              </div>
              <div className="sandbox-weekdays"><span>Пн</span><span>Вт</span><span>Ср</span><span>Чт</span><span>Пт</span><span>Сб</span><span>Вс</span></div>
            </div>
          </div>
        </>}
        {section==='tasks'&&<div className="stack">
          <div className="sandbox-section-head"><div><span className="sandbox-eyebrow">ЗАЯВКИ · ДЕМО</span><h2>{role.section}</h2></div>
            <span className="pill">{active} активных</span></div>
          {tickets.map(t=><div className="sandbox-ticket card" key={t.id}>
            <div className="between"><b>№{t.id} · {t.title}</b><span className="pill">{t.status}</span></div>
            <span className="note">Тестовая запись — внешние уведомления отключены</span>
            <div className="row">
              <button className="btn small" type="button" disabled={t.status==='Завершена'||t.status==='Отменена'}
                onClick={()=>change(t.id)}>{t.status==='Новая'?'Принять':'Завершить'}</button>
              <button className="btn ghost small" type="button" disabled={t.status==='Завершена'||t.status==='Отменена'}
                onClick={()=>change(t.id,true)}>Отклонить</button>
            </div>
          </div>)}
          <div className="card stack"><b>Новая заявка — тренажёр</b>
            <label className="stack">Описание<input className="field" value={text} maxLength={120}
              onChange={e=>setText(e.target.value)} placeholder={role.task}/></label>
            <button className="btn" type="button" onClick={add}>Создать тестовую заявку</button>
            <button className="btn ghost" type="button" onClick={()=>{setTickets(initialTickets(role));announce('ok','Вымышленные примеры восстановлены.');}}>Сбросить примеры</button>
          </div>
        </div>}
        {section==='profile'&&<div className="card stack">
          <span className="sandbox-eyebrow">АККАУНТ · ДЕМО</span><h2>{role.profile}</h2>
          <label className="stack">Имя для демонстрации<input className="field" maxLength={80}
            value={name} onChange={e=>setName(e.target.value)}/></label>
          <p className="note">Настоящие телефон, документы, VIN и платёжные сведения недоступны в песочнице.</p>
          <button type="button" className="btn" onClick={()=>announce(name.trim()?'ok':'bad',name.trim()?'Демо-профиль изменён только здесь.':'Введите имя.')}>Сохранить профиль</button>
        </div>}
        {section==='history'&&<div className="stack">
          <div className="sandbox-section-head"><div><span className="sandbox-eyebrow">ЖУРНАЛ · ДЕМО</span><h2>{role.history}</h2></div></div>
          {tickets.filter(t=>t.status==='Завершена'||t.status==='Отменена').length===0&&
            <div className="empty">Завершённых действий пока нет. Перейдите в заявки и измените их статус.</div>}
          {tickets.filter(t=>t.status==='Завершена'||t.status==='Отменена').map(t=><div className="sandbox-ticket card" key={t.id}>
            <b>№{t.id} · {t.title}</b><span className="pill">{t.status}</span></div>)}
          <button className="btn ghost" type="button" onClick={()=>go('tasks')}>← К заявкам</button>
        </div>}
      </div>
    </div>
    <div className="sandbox-footer"><a href="#/admin/test-center">← Назад к выбору кабинетов</a>
      <span>Изолированный учебный режим · данные не сохраняются на сервере</span></div>
  </main>;
}

/* The role dashboards intentionally differ by workflow, not just the heading.
   These diagrams show fictitious statuses only and cannot perform live actions. */
function RoleScenario({role,onOpen}:{role:RoleInfo;onOpen:()=>void}) {
  if(['client','driver'].includes(role.id)) return <section className="sandbox-scenario sandbox-road">
    <div className="sandbox-scenario-head"><div><span className="sandbox-eyebrow">ПОМОЩЬ В ДОРОГЕ · ДЕМО</span>
      <h3>Связь с дорожной помощью</h3><p>Тестовый сценарий выбора специалиста и контроля заявки.</p></div>
      <button className="btn small" onClick={onOpen} type="button">Перейти к заявке</button></div>
    <div className="sandbox-road-flow"><span>◉ Ваш грузовик</span><i/><span>⚡ Специалист</span><i/><span>✓ Завершение</span></div>
  </section>;
  if(role.id==='owner') return <section className="sandbox-scenario">
    <div className="sandbox-scenario-head"><div><span className="sandbox-eyebrow">АВТОПАРК · ДЕМО</span>
      <h3>Техника под контролем</h3><p>Пример карточек закреплённого транспорта.</p></div>
      <button className="btn ghost small" onClick={onOpen} type="button">Заявки автопарка</button></div>
    <div className="sandbox-fleet">
      {['Scania R520 · тягач','Полуприцеп · рефрижератор','DAF XF · тягач'].map((v,i)=><div key={v}>
        <span>▰</span><b>{v}</b><small>{i===1?'На обслуживании':'В эксплуатации'}</small></div>)}
    </div>
  </section>;
  if(['master','tow'].includes(role.id))return <section className="sandbox-scenario">
    <div className="sandbox-scenario-head"><div><span className="sandbox-eyebrow">ДИСПЕТЧЕРИЗАЦИЯ · ДЕМО</span>
      <h3>Новые вызовы и смена</h3><p>Тестовый путь от входящей заявки до завершения выезда.</p></div>
      <button className="btn small" type="button" onClick={onOpen}>Смотреть вызовы</button></div>
    <div className="sandbox-route">
      {['Получен заказ','Подтверждён выезд','Работа у клиента','Отчёт и оплата'].map((s,i)=><div key={s}>
        <span>{i+1}</span><b>{s}</b><small>{i===0?'Проверить детали':i===1?'Пример статуса':'Только демонстрация'}</small></div>)}
    </div>
  </section>;
  if(['service','master_service'].includes(role.id))return <section className="sandbox-scenario">
    <div className="sandbox-scenario-head"><div><span className="sandbox-eyebrow">РЕМОНТНАЯ ЗОНА · ДЕМО</span>
      <h3>Загрузка ремонтных боксов</h3><p>Пример планирования работ по рабочим местам.</p></div>
      <button className="btn ghost small" type="button" onClick={onOpen}>Открыть записи</button></div>
    <div className="sandbox-bays">{['Бокс 1','Бокс 2','Бокс 3','Выездной пост'].slice(0,role.id==='service'?3:4).map((b,i)=>
      <div key={b}><span>⚙</span><b>{b}</b><small>{i===0?'Диагностика':i===1?'Ремонт':i===2?'Свободен':'На выезде'}</small></div>)}</div>
  </section>;
  if(role.id==='insurer')return <section className="sandbox-scenario">
    <div className="sandbox-scenario-head"><div><span className="sandbox-eyebrow">СТРАХОВАНИЕ · ДЕМО</span>
      <h3>Путь страхового обращения</h3><p>Контроль документов и предложения без оформления настоящего полиса.</p></div>
      <button className="btn small" type="button" onClick={onOpen}>Страховые заявки</button></div>
    <div className="sandbox-route">
      {['Новая заявка','Документы','Расчёт предложения','Ответ клиенту'].map((s,i)=>
        <div key={s}><span>{i+1}</span><b>{s}</b><small>{i===0?'Ожидает рассмотрения':'Демонстрационный этап'}</small></div>)}</div>
  </section>;
  return <section className="sandbox-scenario">
    <div className="sandbox-scenario-head"><div><span className="sandbox-eyebrow">КОНТРОЛЬ ПЛОЩАДКИ · ДЕМО</span>
      <h3>{role.id==='moderator'?'Очередь решений':'Операционный мониторинг'}</h3>
      <p>{role.id==='moderator'?'Проверка жалоб и документов по порядку.':'Пример контроля запросов, качества и состояния сервиса.'}</p></div>
      <button className="btn small" type="button" onClick={onOpen}>Открыть очередь</button></div>
    <div className="sandbox-route">
      {(role.id==='moderator'?['Принять обращение','Проверить сведения','Вынести решение','Записать итог']:
        ['Новая заявка','Проверка исполнителя','Решение оператора','Контроль качества']).map((s,i)=>
        <div key={s}><span>{i+1}</span><b>{s}</b><small>Тестовый процесс</small></div>)}</div>
  </section>;
}
