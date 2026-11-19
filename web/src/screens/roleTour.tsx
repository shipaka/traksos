import { useEffect, useMemo, useRef, useState } from 'react';
import { useMe } from '../ui.tsx';
import { trainingRole } from './training.tsx';

type TourStep = { selector: string; title: string; description: string };
function tourSteps(mode: string, role: string): TourStep[] {
  const start: TourStep[] = [
    { selector: 'header.top', title: 'Это ваш TrackSOS', description: 'Здесь вход в основные разделы и уведомления. Все элементы управления настоящие; экскурсия их не нажимает.' },
  ];
  const byRole: Record<string, TourStep> = {
    owner: { selector: '.desktop-quick-links', title: 'Начните с нужной услуги', description: 'Выездной мастер, эвакуатор, СТО или консультация. В срочной ситуации откройте SOS.' },
    driver: { selector: '.desktop-quick-links', title: 'Помощь для вашей машины', description: 'Выберите проблему или SOS. Если сумма выше лимита, её подтверждает владелец.' },
    master: { selector: '.work-command-hero', title: 'Управляйте рабочей линией', description: 'Здесь статус доступности, активные заявки и рабочая информация. Без выхода на линию новые заявки могут не поступать.' },
    tow: { selector: '.work-command-hero', title: 'Ваши эвакуации', description: 'Сверьте возможность перевозки, стоимость и маршрут до принятия новой заявки.' },
    service: { selector: '.base-command-hero', title: 'Рабочий стол СТО', description: 'Здесь новые обращения, машины в ремонте и финансы. Каждая смета согласуется с клиентом.' },
    insurer: { selector: '.partner-workspaces', title: 'Страхование по разделам', description: 'Запросы, техосмотры, финансы и настройки отделены друг от друга.' },
    inspection: { selector: '.partner-workspaces', title: 'Технические осмотры', description: 'Здесь учёт назначенных запросов. Отметка статуса — не выдача диагностической карты.' },
    moderator: { selector: 'main', title: 'Очередь решений', description: 'Открывайте карточку, проверяйте факты обеих сторон, сохраняйте основание решения и способ оспорить.' },
    admin: { selector: 'main', title: 'Панель управления', description: 'Заявки, проверка партнёров, деньги, оферты и тестовый центр. Реальные изменения требуют подтверждения.' },
  };
  if (byRole[role]) start.push(byRole[role]);
  start.push(
    { selector: '.account-menu > summary', title: 'Все функции — в Меню', description: 'Здесь профиль, финансы, история, документы, настройки и выход. На мобильном не нужно искать их среди нижних кнопок.' },
    { selector: '.tr-context-help > summary', title: 'Подсказка именно для этого экрана', description: '«Что здесь делать?» объясняет ближайший шаг и показывает ссылки на обучение и условия.' },
  );
  return start;
}
function rectOf(selector: string) {
  const el = document.querySelector(selector) as HTMLElement | null;
  const r = el?.getBoundingClientRect();
  if (!r || r.width === 0 || r.height === 0) return null;
  return {x: Math.max(4,r.left - 5), y: Math.max(4,r.top - 5),
    width: Math.min(window.innerWidth - 8,r.width + 10), height: Math.min(window.innerHeight - 8,r.height + 10)};
}
export function RoleTour({ page }: { page:string }) {
  const { me, mode } = useMe();
  const role = trainingRole(mode,me?.roles ?? [],me?.owner_id);
  const [open,setOpen] = useState(false);
  const [i,setI] = useState(0);
  const [rect,setRect] = useState<ReturnType<typeof rectOf>>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const steps = useMemo(()=>tourSteps(mode,role),[mode,role]);
  useEffect(()=>{
    const start=()=>{setI(0);setOpen(true);};
    window.addEventListener('traksos-tour-start',start);
    return()=>window.removeEventListener('traksos-tour-start',start);
  },[]);
  useEffect(()=>{
    if(page!==''&&page!=='login')return;
    try {
      if(sessionStorage.getItem('traksos.tour.pending')==='1'){
        sessionStorage.removeItem('traksos.tour.pending');
        setI(0);setOpen(true);
      }
    }catch{/* restricted storage */}
  },[page]);
  useEffect(()=>{
    if(!open)return;
    const update=()=>setRect(rectOf(steps[i].selector) ?? rectOf('header.top'));
    update();
    window.addEventListener('resize',update);window.addEventListener('scroll',update,true);
    nextButton.current?.focus();
    return()=>{window.removeEventListener('resize',update);window.removeEventListener('scroll',update,true);};
  },[open,i,steps]);
  const lastPage = useRef(page);
  useEffect(()=>{if(lastPage.current!==page&&open)setOpen(false);lastPage.current=page;},[page]); // close only on actual navigation
  if(!me||!open)return null;
  const step=steps[i];
  const box=rect;
  const width=Math.min(360,Math.max(250,window.innerWidth-32));
  const left=box?Math.max(12,Math.min(window.innerWidth-width-12,box.x)):12;
  const idealTop=box?box.y+box.height+12:100;
  const top=idealTop+228>window.innerHeight&&box?Math.max(12,box.y-234):Math.max(12,Math.min(idealTop,window.innerHeight-240));
  const close=()=>setOpen(false);
  return <div className="tr-tour" role="dialog" aria-modal="true" aria-label="Короткая экскурсия по кабинету"
    onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();close();}}}>
    <div className="tr-tour-cover" />
    {box&&<div className="tr-tour-spot" aria-hidden="true" style={{left:box.x,top:box.y,width:box.width,height:box.height}} />}
    <section className="tr-tour-bubble" style={{left,top,width}}>
      <span className="label">TRAKSOS · ШАГ {i+1} ИЗ {steps.length}</span>
      <h2>{step.title}</h2><p>{step.description}</p>
      <div className="tr-tour-actions">
        <button type="button" className="btn ghost" onClick={close}>Закрыть</button>
        <div className="row">
          <button className="btn ghost" type="button" disabled={i===0} onClick={()=>setI(k=>Math.max(0,k-1))}>Назад</button>
          <button ref={nextButton} className="btn" type="button" onClick={()=>i===steps.length-1?close():setI(k=>k+1)}>
            {i===steps.length-1?'Готово':'Дальше'}
          </button>
        </div>
      </div>
    </section>
  </div>;
}
