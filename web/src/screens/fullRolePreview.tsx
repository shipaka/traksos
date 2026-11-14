// The SAME registered account screens, not a condensed administration mock.
// Role data are only provided by fullRolePreview.ts; no actual user is impersonated.
import type {MouseEvent} from 'react';
import {Home,Sos,Consult,NewOrder,Orders,Garage} from './client.tsx';
import {Work} from './performer.tsx';
import {PerformerHub,AboutSection,PhoneSection,CarsSection,ScheduleSection,TaxSection,MoneySection,
 FilterSection,LevelSection} from './performerCabinet.tsx';
import {Order} from './order.tsx';
import {Fleet} from './fleet.tsx';
import {ModeratorDesk} from './moderatorDesk.tsx';
import {ModCase} from './moderation.tsx';
import {BaseHome,BaseCar,BaseMoney,BaseSetup} from './base.tsx';
import {Admin} from './admin.tsx';
import {InsurerPreviewPage} from './insurerPreview.tsx';
import type {Me} from '../ui.tsx';
import {currentPreviewRole,previewLink,resetFullPreview,PREVIEW_ROLES,type Role} from '../demo/fullRolePreview.ts';

const names:Record<Role,string>={client:'Клиент',owner:'Владелец автопарка',driver:'Водитель',
 master:'Выездной мастер',tow:'Эвакуаторщик',master_service:'Мастер + СТО',insurer:'Страховой партнёр',
 moderator:'Модератор',admin:'Администратор'};
const kinds:Record<Role,'client'|'performer'|'insurer'|'moderator'|'admin'>={
 client:'client',owner:'client',driver:'client',master:'performer',
 tow:'performer',master_service:'performer',insurer:'insurer',moderator:'moderator',admin:'admin'};
export function previewMode(role:Role){return kinds[role];}
export function previewIdentity(admin:Me,role:Role):Me{
 const insuranceClient=role==='insurer'&&location.hash.includes('/insurer/client');
 const master=['master','tow','master_service'].includes(role);
 const person=role==='owner'?'Демо · Владелец автопарка':role==='driver'?'Демо · Водитель':
 role==='tow'?'Демо · Эвакуаторщик':role==='master'?'Демо · Выездной мастер':
 role==='master_service'?'Демо · Мастер и СТО':role==='insurer'?(insuranceClient?'Демо · Клиент':'Демо · Страховой партнёр'):role==='moderator'?'Демо · Модератор':
 role==='admin'?'Демо · Администратор':'Демо · Клиент';
 return {...admin,id:master?'demo-performer':'demo-customer',name:person,
  phone:'+70000000000',owner_id:role==='driver'?'demo-customer':null,
  roles:role==='insurer'?(insuranceClient?['client']:['insurer']):role==='master_service'?['master','service']:
   role==='owner'?['client']:role==='driver'?['driver']:
   role==='master'?['master']:role==='tow'?['tow']:
   role==='moderator'?['moderator']:role==='admin'?['admin']:['client'],
  company_name:role==='owner'?'Демо Транспорт':null,
  company_inn:null,rating:4.9,rating_count:128,
  performer:master?{kind:role==='tow'?'tow':'master',verification:'approved',
   line_status:'offline',car:{brand:'Volkswagen',model:'Crafter',plate:'Т111ТТ78'},
   cars:[{brand:'Volkswagen',model:'Crafter',plate:'Т111ТТ78'}],
   schedule:{on:false},specialties:['electric','diag','air','tyre'],brands:{Scania:'excellent',DAF:'excellent'},
   prices:{},tax_status:'npd'}:null};
}
export function RolePreviewBar({role}:{role:Role}){
 return <div className="role-preview-bar" role="banner" aria-label="Управление тестовыми кабинетами">
   <div className="role-preview-identity"><b>TRACKSOS · АДМИНИСТРАТОР</b>
    <small>Тестовая среда · только вымышленные данные</small></div>
   <div className="role-preview-controls">
     <label>Смотреть как
      <select aria-label="Выбрать тестовый кабинет" value={role}
       onChange={e=>{location.hash=previewLink(e.target.value as Role);}}>
       {PREVIEW_ROLES.map(id=><option value={id} key={id}>{names[id]}</option>)}
       <option value="service">Рембаза / СТО</option>
      </select>
     </label>
     {role==='insurer'&&<>
       <a href={previewLink('insurer')}>Вид страховщика</a>
       <a href={previewLink('insurer','client')}>Вид клиента</a>
       <a href={previewLink('insurer','inspections')}>Техосмотры</a>
     </>}
     <a href="#/admin/test-center">Все кабинеты</a>
     <a href="#/admin">В админку</a>
     <button type="button" onClick={()=>{resetFullPreview();location.hash=previewLink(role);location.reload();}}>↻ Сбросить тест</button>
   </div>
 </div>;
}
export function handlePreviewClick(event:MouseEvent<HTMLElement>){
 const role=currentPreviewRole();if(!role)return;
 const clicked=event.target;
 if(!(clicked instanceof Element))return;
 const anchor=clicked.closest<HTMLAnchorElement>('a[href^="#/"]');
 if(!anchor||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||
    anchor.target==='_blank'||event.button!==0)return;
 const href=anchor.getAttribute('href')??'';
 if(href.startsWith('#/admin/test-center/')||href==='#/admin/test-center'||href==='#/admin')return;
 event.preventDefault();event.stopPropagation();
 const target=href.slice(2);
 location.hash=previewLink(role,target);
}
function DisabledArea({role}:{role:Role}){
 return <main className="stack role-preview-guarded">
  <h1>{names[role]}</h1>
  <div className="banner">Этот внешний раздел намеренно не проводит операции с настоящими клиентами, партнёрами и оплатой.
    Перейдите в доступные разделы кабинета через меню или создайте тестовую заявку.</div>
  <a className="btn" href={previewLink(role)}>На главную кабинета</a>
 </main>;
}
export function FullRolePreviewPage({role,parts}:{role:Role;parts:string[]}){
 const [a,b,c]=parts;
 if(role==='insurer')return <InsurerPreviewPage section={a} sub={b} id={c}/>;
 const worker=['master','tow','master_service'].includes(role);
 const client=['client','owner','driver'].includes(role);
 if(client){
  if(!a)return <Home/>;
  if(a==='new'&&b)return b==='consult'?<Consult/>:<NewOrder service={b}/>;
  if(a==='sos')return <Sos/>;
  if(a==='orders')return <Orders as="client"/>;
  if(a==='order'&&b)return <Order id={b}/>;
  if(a==='garage')return <Garage/>;
  if(a==='fleet'&&role==='owner')return <Fleet/>;
  if(a==='profile')return <PreviewProfile role={role}/>;
  return <DisabledArea role={role}/>;
 }
 if(worker){
  if(!a||a==='work'&&!b)return <Work/>;
  if(a==='work'&&b==='jobs')return <Orders as="performer"/>;
  if(a==='order'&&b)return <Order id={b}/>;
  if(a==='work'&&b==='me')return c?({
    about:<AboutSection/>,phone:<PhoneSection/>,cars:<CarsSection/>,
    schedule:<ScheduleSection/>,tax:<TaxSection/>,money:<MoneySection/>,
    level:<LevelSection/>,
   } as Record<string,JSX.Element>)[c]??<PerformerHub/>:<PerformerHub/>;
  if(a==='work'&&b==='filter')return <FilterSection/>;
  if(role==='master_service'&&a==='base'){
    if(b==='car'&&c)return <BaseCar id={c}/>;
    if(b==='money')return <BaseMoney/>;
    if(b==='me')return <BaseSetup/>;
    return <BaseHome/>;
  }
  if(a==='profile')return <PreviewProfile role={role}/>;
  return <DisabledArea role={role}/>;
 }
 if(role==='moderator'){
  if(a==='admin'&&b==='case'&&c)return <ModCase id={c}/>;
  if(!a||a==='moderation')return <ModeratorDesk/>;
  if(a==='profile')return <PreviewProfile role={role}/>;
  return <DisabledArea role={role}/>;
 }
 if(role==='admin'){
   // The administrator's ACTUAL live cockpit is always available via the separate
   // admin toolbar. Do not render it inside a fake account and risk real mutations.
   return <main className="stack role-preview-guarded">
     <h1>Администратор TrackSOS</h1>
     <div className="banner">Вы уже вошли как администратор. Для проверки настоящей админки используйте кнопку ниже;
       остальные роли открываются с верхним переключателем в безопасном режиме.</div>
     <a className="btn" href="#/admin">Открыть настоящий кабинет администратора</a>
   </main>;
 }
 return <DisabledArea role={role}/>;
}
function PreviewProfile({role}:{role:Role}){
 return <main className="stack role-preview-profile">
   <section className="internal-role-hero"><span>TRACKSOS · УЧЕБНЫЙ ПРОФИЛЬ</span>
     <h1>Профиль · {names[role]}</h1>
     <p>Отображается отдельная учебная личность. Данные настоящего администратора здесь не меняются.</p></section>
   <div className="card stack">
     <b>Информация профиля</b><label>Имя<input className="field" readOnly value={'Демо · '+names[role]}/></label>
     <span className="note">Права, телефон, проверка документов и настройки реального аккаунта из этой песочницы недоступны.</span>
   </div>
 </main>;
}
