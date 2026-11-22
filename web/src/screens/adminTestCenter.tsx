import { useEffect, useState } from 'react';
import { get, post } from '../api.ts';
import { NavGlyph } from '../navGlyph.tsx';

// Only the role-selection UI lives here. Authorized sandbox tickets open
// actual TrakSOS role workspaces on a separate origin and isolated database.
// The retired React mini-dashboard/fictional order implementation is gone.
type DemoRole='client'|'owner'|'driver'|'master'|'tow'|'service'|
  'master_service'|'insurer'|'inspection'|'courier'|'moderator'|'admin';
type RoleInfo={id:DemoRole;icon:string;label:string;subtitle:string};
const DEMO_ROLES:RoleInfo[]=[
  {id:'client',icon:'＋',label:'Клиент',subtitle:'Помощь на дороге и мой гараж'},
  {id:'owner',icon:'▦',label:'Владелец / автопарк',subtitle:'Машины, водители и расходы'},
  {id:'driver',icon:'◉',label:'Сотрудник автопарка',subtitle:'Закреплённая техника'},
  {id:'master',icon:'wrench',label:'Выездной мастер',subtitle:'Линия, выезды и выплаты'},
  {id:'tow',icon:'tow',label:'Эвакуаторщик',subtitle:'Эвакуация грузового транспорта'},
  {id:'service',icon:'garage',label:'Рембаза / СТО',subtitle:'Записи, боксы, заказ-наряды'},
  {id:'master_service',icon:'garage',label:'Мастер и своя СТО',subtitle:'Выезды и стационарный ремонт'},
  {id:'insurer',icon:'◇',label:'Страховой партнёр',subtitle:'Заявки, документы, полисы'},
  {id:'inspection',icon:'▣',label:'Оператор техосмотра',subtitle:'Диагностические карты и осмотры'},
  {id:'courier',icon:'truck',label:'Курьер запчастей',subtitle:'Рейсы и подтверждение доставки'},
  {id:'moderator',icon:'⚑',label:'Модератор',subtitle:'Споры и проверка партнёров'},
  {id:'admin',icon:'⚙',label:'Администратор',subtitle:'Контроль платформы'},
];
const rolePath=(id:DemoRole)=>'#/admin/test-center/'+id;
function FullFidelityRoleLauncher({role}:{role:RoleInfo}) {
  const [message,setMessage]=useState('Проверяем доступ к изолированной тестовой базе…');
  useEffect(()=>{
    let active=true;
    void get<{enabled:boolean}>('/api/admin/sandbox/status')
      .then(status=>{
        if(!status.enabled)
          throw new Error((status as any).reason||'Полноценный тестовый сервер ещё не подключён.');
        return post<{entryUrl:string}>('/api/admin/sandbox/ticket',{role:role.id});
      })
      .then(result=>{
        if(!active)return;
        if(!result?.entryUrl||!result.entryUrl.startsWith('https://'))
          throw new Error('Не удалось сформировать защищённый тестовый вход.');
        location.assign(result.entryUrl);
      })
      .catch(e=>{if(active)setMessage(e instanceof Error?e.message:'Ошибка доступа к тестовому серверу');});
    return ()=>{active=false;};
  },[role.id]);
  return <main className="sandbox-root stack" style={{maxWidth:720,margin:'28px auto'}}>
    <span className="pill accent">НАСТОЯЩИЙ КАБИНЕТ · ТЕСТОВАЯ ВЕРСИЯ</span>
    <h1>{role.label}</h1><p>{message}</p>
    <p className="note">На отдельном адресе открываются настоящие экраны TrakSOS с тестовыми аккаунтами, базой и платёжным имитатором. Песочница может содержать новые изменения раньше основного сайта.</p>
    <div className="row"><a className="btn ghost" href="#/admin/test-center">← Выбор кабинета</a></div>
  </main>;
}
export function AdminTestCenter({roleId}:{roleId?:string;fullFidelity?:boolean}) {
  // Deliberately ignore callers' options. No code path offers the old trainer.
  const fullFidelity = true;
  const role=DEMO_ROLES.find(r=>r.id===roleId);
  if(role && fullFidelity)return <FullFidelityRoleLauncher role={role}/>;
  return <main className="sandbox-root stack" aria-label="Тестовый центр администратора">
    <section className="sandbox-intro">
      <span className="sandbox-eyebrow">TRAKSOS · ЗАКРЫТЫЙ ДЕМОНСТРАЦИОННЫЙ РЕЖИМ</span>
      <h1>Тестирование кабинетов</h1>
      <p>Выберите роль: откроется настоящий кабинет с отдельной тестовой базой. На песочнице изменения могут появляться раньше, чем на основном сайте.</p>
      <a className="btn ghost small" href="#/admin">← Вернуться в админку</a>
    </section>
    <div className="banner" role="note">
      <b>ТЕСТОВЫЙ РЕЖИМ · НЕ РЕАЛЬНЫЕ АККАУНТЫ</b>
      <span>Для проверки используется отдельный тестовый сервер без доступа к реальным клиентам, SMS и платежам. Если сервер ещё не подключён, откроется пояснение, а не поддельный реальный кабинет.</span>
    </div>
    <div className="sandbox-role-grid" role="group" aria-label="Выбор тестового кабинета">
      {DEMO_ROLES.map(r=><a key={r.id} className="sandbox-role-card" href={rolePath(r.id)}>
        <span className="sandbox-role-icon" aria-hidden="true"><NavGlyph glyph={r.icon}/></span>
        <b>{r.label}</b><span>{r.subtitle}</span><strong>Открыть кабинет ↗</strong>
      </a>)}
    </div>
  </main>;
}
