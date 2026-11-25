import { useLayoutEffect, useRef, useState } from 'react';
import { rememberGuestService, rememberGuestAction } from '../guestCatalog.ts';
import { APPROVED_VISUALS } from '../approvedVisuals.ts';
import { requestTrakBotOpen } from '../trakbotEvents.ts';
import { TrakBotMascot } from '../trakbotMascot.tsx';
import { TrakServiceIcon, type TrakServiceIconKind } from '../trakServiceIcon.tsx';
import { ApprovedServiceIllustration } from '../approvedServiceIllustration.tsx';
import { TrakAppPhone } from '../trakAppPhone.tsx';
import { FeatureArtwork } from '../featureArtwork20261122.tsx';
import { PartnerNetworkMap } from './PartnerNetworkMap20261123.tsx';
import './ownerDesktopHome20261120.css';

function dismissOnMouseLeave(event: import('react').MouseEvent<HTMLDetailsElement>) {
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) event.currentTarget.open = false;
}


/** The 20 November owner-approved desktop layout. Mobile stays on its separately approved view. */
const primary = [
  ['Выездной мастер','Диагностика и ремонт на месте','van'],
  ['Эвакуация','Быстрая и безопасная','tow'],
  ['СТО','Ремонт и обслуживание','sto'],
  ['Консультация','Профессиональная помощь онлайн','consult'],
  ['TrakBot · ИИ','Наш технический помощник','trakbot']
] as const;
const features = [
  ['ТехБаза','Техническая библиотека и практический опыт','tech','Перейти'],
  ['Специалисты ЭБУ','Диагностика, ремонт и программирование','ecu','Подобрать'],
  ['Запчасти','Подбор и поставка для грузовой техники','parts','В каталог'],
  ['Страхование','ОСАГО, КАСКО, грузы и автопарк','insurance','Подробнее'],
  ['Техосмотр','Оформление и прохождение для грузового транспорта','inspection','Записаться']
] as const;
function rememberAllowed(key:string){
  if(key==='van'||key==='tow'||key==='sto'||key==='consult'||key==='parts'||key==='insurance'||key==='inspection') rememberGuestService(key);
  else if(key==='ecu'||key==='air'||key==='club'||key==='tech') rememberGuestAction(key);
}
function route(key:string) { return '#/explore/' + key; }
function OwnerIcon({kind}:{kind:string}) {
  if(['van','tow','sto','consult','parts','insurance','tech','ecu','inspection'].includes(kind))
    return <TrakServiceIcon kind={kind as TrakServiceIconKind}/>;
  const props={viewBox:'0 0 48 48',fill:'none',stroke:'currentColor',strokeWidth:2.8,strokeLinecap:'round' as const,strokeLinejoin:'round' as const,'aria-hidden':true as const};
  let lines;
  switch(kind){
    case 'ecu': lines=<><rect x="10" y="10" width="28" height="28" rx="3"/><path d="M16 4v6m8-6v6m8-6v6M16 38v6m8-6v6m8-6v6M4 16h6m-6 8h6m-6 8h6m28-16h6m-6 8h6m-6 8h6"/><rect x="17" y="17" width="14" height="14" rx="2"/></>;break;
    case 'consult': lines=<><path d="M5 25V23a19 19 0 0 1 38 0v3M5 25v10c0 5 4 8 8 8h4V27h-4a8 8 0 0 0-8 8m38-10v10c0 5-4 8-8 8h-4V27h4a8 8 0 0 1 8 8"/></>;break;
    case 'tech': lines=<><path d="M8 7h27a5 5 0 0 1 5 5v29H13a5 5 0 0 0 0-10h27"/><path d="M8 7v29a5 5 0 0 0 5 5m5-26h15m-15 6h15m-15 6h11"/></>;break;
    case 'parts': lines=<><circle cx="24" cy="24" r="8"/><path d="M19 4h10l2 6 5 3 6-2 4 9-5 5 1 6 4 4-5 9-6-2-6 2-2 6H18l-2-6-6-2-6 2-4-9 5-4v-7l-5-5 4-9 6 2 6-3Z" transform="translate(2,-2) scale(.9)"/></>;break;
    case 'inspection': lines=<><rect x="10" y="7" width="27" height="37" rx="4"/><path d="M17 4h13v6H17zm1 17 3 3 6-7m-9 17 3 3 6-7M30 23h4m-4 10h4"/></>;break;
    case 'warning': lines=<><path d="M20 7a5 5 0 0 1 8 0l18 30a5 5 0 0 1-4 8H6a5 5 0 0 1-4-8Z"/><path d="M24 18v12m0 7v1"/></>;break;
    case 'air': lines=<><circle cx="24" cy="25" r="4" fill="currentColor" stroke="none"/><path d="M15 16a12 12 0 0 0 0 18m18-18a12 12 0 0 1 0 18M9 10a20 20 0 0 0 0 30m30-30a20 20 0 0 1 0 30"/></>;break;
    default: lines=<><circle cx="24" cy="24" r="18"/><path d="M16 24h16m-8-8v16"/></>;
  }
  return <svg {...props}>{lines}</svg>;
}

function Feature({item}:{item:typeof features[number]}) {
  const [title,description,key,action] = item;
  return <a href={route(key)} className={'owner20-feature owner20-feature-'+key} onClick={() => rememberAllowed(key)}>
    <div className="owner20-feature-title"><span aria-hidden="true"><OwnerIcon kind={key}/></span><b>{title}</b></div>
    <p>{description}</p>
    <FeatureArtwork kind={key} />
    <span className="owner20-feature-cta">{action}　→</span>
  </a>;
}
export function OwnerDesktopHome20261120({ overlayBackground = false }: { overlayBackground?: boolean } = {}) {
  const [mapOpen,setMapOpen]=useState(false);
  const mapReturnFocus=useRef<HTMLButtonElement|null>(null);
  // Restoring focus in a layout effect happens after React removes the modal
  // but before Playwright or a screen reader observes the closed dialog.
  // requestAnimationFrame was too late, and the footer has a different trigger.
  useLayoutEffect(()=>{
    if(!mapOpen && mapReturnFocus.current){
      const opener=mapReturnFocus.current;
      mapReturnFocus.current=null;
      if(opener.isConnected && !opener.disabled) opener.focus();
    }
  },[mapOpen]);
  function openMap(event:import('react').MouseEvent<HTMLButtonElement>){
    mapReturnFocus.current=event.currentTarget;
    setMapOpen(true);
  }
  function closeMap(){ setMapOpen(false); }
  return <main className="owner20-home" id="public-home"
    inert={overlayBackground || undefined} aria-hidden={overlayBackground || undefined}>
    <header className="owner20-top"
        onClick={event => {
          // Native <details> remains keyboard-accessible. One menu at a time;
          // prevent old drop-downs from stacking over the next selection.
          const summary=(event.target as HTMLElement).closest('summary');
          if(!summary || !event.currentTarget.contains(summary)) return;
          const active=summary.closest('details');
          event.currentTarget.querySelectorAll('details[open]').forEach(menu => {
            if(menu!==active) menu.open=false;
          });
        }}
        onKeyDown={event => {
          if(event.key!=='Escape') return;
          const opened=event.currentTarget.querySelector('details[open]') as HTMLDetailsElement|null;
          if(opened){opened.open=false;opened.querySelector('summary')?.focus();event.preventDefault();}
        }}>
      <a href="#/" className="owner20-mark" aria-label="TrakSOS — главная"><img src={APPROVED_VISUALS.logo} alt="TrakSOS" width="235" height="39" /></a>
      <span className="owner20-tagline">Платформа помощи и сервисов<br/>для грузового транспорта</span>
      <nav className="owner20-topnav" aria-label="Основные разделы">
        <details onMouseLeave={dismissOnMouseLeave}><summary>О платформе</summary><div><a href="#/company">О нас</a></div></details>
        <details onMouseLeave={dismissOnMouseLeave}><summary>Сервисы</summary><div>{primary.map(([title,,key])=>key==='trakbot' ? <a href="#/trakbot" key={key} onClick={event=>{event.preventDefault();requestTrakBotOpen(event.currentTarget);}}>{title}</a> : <a href={route(key)} key={key} onClick={() => rememberAllowed(key)}>{title}</a>)}<a href="#/explore/parts" onClick={() => rememberAllowed("parts")}>Запчасти</a><a href="#/explore/insurance" onClick={() => rememberAllowed("insurance")}>Страхование</a><a href="#/explore/ecu" onClick={() => rememberAllowed("ecu")}>Специалисты ЭБУ</a></div></details>
        <details onMouseLeave={dismissOnMouseLeave}><summary>Сообщество</summary><div><a href="#/explore/air">Эфир</a><a href="#/explore/club">Клуб TrakSOS</a></div></details>
        <details onMouseLeave={dismissOnMouseLeave}><summary>Партнёрам</summary><div><a href="#/join">Хотим работать</a></div></details>
        <a href="#/login">Поддержка</a>
      </nav>
      <details className="owner20-compact-menu" onMouseLeave={dismissOnMouseLeave}>
        <summary>☰ Разделы</summary>
        <nav aria-label="Разделы сайта на небольшом экране ПК">
          <a href="#/company">О платформе</a>{primary.map(([title,,key])=>key==='trakbot'?<a href="#/trakbot" key={key} onClick={event=>{event.preventDefault();requestTrakBotOpen(event.currentTarget);}}>{title}</a>:<a href={route(key)} key={key} onClick={()=>rememberAllowed(key)}>{title}</a>)}{features.map(([title,,key])=><a href={route(key)} key={key} onClick={()=>rememberAllowed(key)}>{title}</a>)}
          <a href="#/explore/air">Эфир</a><a href="#/explore/club">Клуб TrakSOS</a>
          <a href="#/join">Партнёрам</a><a href="#/login">Поддержка</a>
        </nav>
      </details>
      <details className="owner20-region" onMouseLeave={dismissOnMouseLeave}><summary>⌖ Доступность по регионам</summary><div className="owner20-region-menu"><b>TrakSOS — вся Россия</b><p>Регистрация и личный кабинет доступны по всей России.</p><small>Выездные услуги зависят от наличия подключённых партнёров в конкретном регионе.</small><a href="#/login">Уточнить доступность →</a></div></details>
      <a href="#/login" className="owner20-signin"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2.2a7 7 0 0 1 14 0V21"/></svg><span>Войти</span></a>
    </header>
    <section className="owner20-hero" aria-labelledby="owner20-heading">
      <div className="owner20-photo" aria-hidden="true"/>
      <div className="owner20-lead">
        <h1 id="owner20-heading">Помощь в дороге.<br/>Сервис и поддержка<br/><em>для грузового транспорта</em></h1>
        <p>Единая платформа для водителей, владельцев<br/>и автопарков по всей России</p>
        <div className="owner20-hero-links">
          <a href="#/explore/sos" onClick={() => rememberGuestAction('sos')} className="owner20-alert"><span aria-hidden="true"><OwnerIcon kind="warning"/></span><span><strong>SOS</strong><small>Экстренная помощь</small></span></a>
          <a href="#/explore/air" className="owner20-broadcast"><span aria-hidden="true"><OwnerIcon kind="air"/></span><span><strong>Эфир</strong><small>Связь, опыт, помощь коллег</small></span></a>
        </div>
      </div>
      <aside className="owner20-map" aria-label="Покрытие сервисов">
        <h2>Покрытие сервисов TrakSOS</h2>
        <div className="owner20-map-inner">
          <div className="owner20-map-shape"><span className="owner20-map-source" aria-hidden="true" />
            <span className="owner20-map-demo-tag">ДЕМО</span>
            <button type="button" className="owner20-map-open" aria-label="Развернуть карту партнёров" aria-expanded={mapOpen}
              onClick={openMap}>
              <span className="owner20-map-expand-label">Развернуть карту</span>
            </button>
          </div>
          <div className="owner20-map-legend"><p><i className="teal"/>Пример зоны покрытия</p><p><i/>Планируемое расширение</p><small>Доступность услуг зависит от региона и партнёрской сети.</small></div>
        </div>
        <button type="button" className="owner20-map-footer-open" onClick={openMap}>Подробнее о покрытии →</button>
      </aside>
      {mapOpen && <PartnerNetworkMap onClose={closeMap}/>} 
    </section>
    <nav className="owner20-quick" aria-label="Основные услуги" id="public-services">
      {primary.map(([title,hint,key])=>key==='trakbot'
        ? <a href="#/trakbot" key={key} className="owner20-quick-trakbot" aria-label="Открыть TrakBot — ИИ-помощник" onClick={event=>{event.preventDefault();requestTrakBotOpen(event.currentTarget);}}><span className="owner20-quick-icon" aria-hidden="true"><TrakBotMascot reaction="hello" size="small" ambient /></span><span className="owner20-quick-copy"><b>{title}</b><small>{hint}</small></span></a>
        : <a href={route(key)} key={key} className={'owner20-quick-'+key} onClick={() => rememberAllowed(key)}><span className="owner20-quick-icon" aria-hidden="true"><OwnerIcon kind={key}/></span><span className="owner20-quick-copy"><b>{title}</b><small>{hint}</small></span><ApprovedServiceIllustration kind={key==='van'?'repair':key==='tow'?'tow':key==='sto'?'service':'consult'}/></a>)}
    </nav>
    <section className="owner20-features" aria-label="Дополнительные сервисы">
      {features.map(item=><Feature key={item[2]} item={item}/>)}
    </section>
    <section className="owner20-bottom" aria-label="Сообщество и приложение">
      <a href="#/explore/air" className="owner20-bottom-card owner20-bottom-air"><b>◉　Эфир TrakSOS</b><p>Живое сообщество водителей и специалистов. Регионы, маршруты, опыт и помощь в пути.</p><span>Войти в Эфир　→</span></a>
      <a href="#/explore/club" className="owner20-bottom-card owner20-bottom-club"><b>♧　Клуб TrakSOS</b><p>Профессиональное сообщество. Обсуждения, советы, разборы, проекты.</p><span>О Клубе　→</span></a>
      <div className="owner20-bottom-card owner20-bottom-why"><b>Почему TrakSOS</b><ul><li>Реальная помощь в дороге</li><li>Проверенные исполнители</li><li>Профессиональное сообщество</li><li>Техническая база знаний</li><li>Развитие сервисов по регионам</li></ul></div>
      <a href="#/app-info" className="owner20-bottom-card owner20-bottom-app" aria-label="Информация о мобильном приложении TrakSOS"><b>Приложение TrakSOS</b><p>Все сервисы платформы в вашем телефоне</p><span className="owner20-store">Скоро в RuStore</span><TrakAppPhone/></a>
    </section>
    <p className="owner20-disclaimer">Демонстрационный режим. Наличие исполнителей, доступность регионов и услуг уточняется после входа.</p>
  </main>;
}
