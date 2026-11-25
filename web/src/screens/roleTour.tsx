import { useEffect, useMemo, useRef, useState } from 'react';
import { useMe } from '../ui.tsx';
import { trainingRole } from './training.tsx';

type TourStep = { selector: string; title: string; description: string };
function tourSteps(mode: string, role: string): TourStep[] {
  const start: TourStep[] = [
    { selector: 'header.top', title: 'Это ваш TrakSOS', description: 'Здесь вход в основные разделы и уведомления. Все элементы управления настоящие; экскурсия их не нажимает.' },
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
  const menuSelector = window.matchMedia('(max-width:899px)').matches
    ? '.tabbar a[href="#/menu"]' : '.account-menu > summary';
  start.push(
    { selector: menuSelector, title: 'Все функции — в Меню', description: 'В Android нижняя кнопка «Меню» открывает рабочие разделы, документы, обучение, настройки и выход. На ПК то же находится в верхнем меню.' },
    { selector: '.tr-context-help > summary', title: 'Подсказка именно для этого экрана', description: '«Что здесь делать?» объясняет ближайший шаг и показывает ссылки на обучение и условия.' },
  );
  return start;
}
function rectOf(selector: string) {
  const el = document.querySelector(selector) as HTMLElement | null;
  const r = el?.getBoundingClientRect();
  if (!r || r.width <= 0 || r.height <= 0 || r.right <= 0 ||
      r.left >= window.innerWidth || r.bottom <= 0 || r.top >= window.innerHeight)
    return null;
  // Clamp BOTH ends of each axis: the previous code could draw a spotlight
  // wider than the viewport when a target was only partly visible on the right.
  const x=Math.max(4,r.left-5),y=Math.max(4,r.top-5);
  const right=Math.min(window.innerWidth-4,r.right+5);
  const bottom=Math.min(window.innerHeight-4,r.bottom+5);
  if(right<=x||bottom<=y)return null;
  return {x,y,width:right-x,height:bottom-y};
}
export function RoleTour({ page }: { page:string }) {
  const { me, mode } = useMe();
  const role = trainingRole(mode,me?.roles ?? [],me?.owner_id);
  const [open,setOpen] = useState(false);
  const [i,setI] = useState(0);
  const [rect,setRect] = useState<ReturnType<typeof rectOf>>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const bubbleRef=useRef<HTMLElement>(null);
  const identity=(me?.id??'guest')+':'+mode+':'+role;
  const previousIdentity=useRef(identity);
  const steps = useMemo(()=>tourSteps(mode,role),[mode,role]);
  const safeIndex=Math.max(0,Math.min(i,steps.length-1));
  // A mode/account change can happen while the modal is open. Never let a
  // previous user's role-specific tour persist in the next private cabinet.
  useEffect(()=>{
    if(previousIdentity.current!==identity){
      previousIdentity.current=identity;
      setOpen(false);setI(0);setRect(null);
    }
  },[identity]);
  useEffect(()=>{
    const start=()=>{if(me){setI(0);setRect(null);setOpen(true);}};
    window.addEventListener('traksos-tour-start',start);
    return()=>window.removeEventListener('traksos-tour-start',start);
  },[me?.id]);
  useEffect(()=>{
    if(!me || (page!==''&&page!=='login'))return;
    try {
      if(sessionStorage.getItem('traksos.tour.pending')==='1'){
        // Do not consume the pending tour while still on the public login:
        // it must open for the actual authenticated account.
        sessionStorage.removeItem('traksos.tour.pending');
        setI(0);setOpen(true);
      }
    }catch{/* restricted storage */}
  },[page,me?.id]);
  useEffect(()=>{
    if(!open)return;
    const update=()=>setRect(rectOf(steps[safeIndex].selector) ?? rectOf('header.top'));
    update();
    window.addEventListener('resize',update);window.addEventListener('scroll',update,true);
    nextButton.current?.focus();
    return()=>{window.removeEventListener('resize',update);window.removeEventListener('scroll',update,true);};
  },[open,safeIndex,steps]);
  // Trap Tab inside the modal and handle Escape even when focus is outside
  // the tour bubble. This prevents keyboard focus escaping into private
  // buttons behind the overlay.
  useEffect(()=>{
    if(!open||!me)return;
    const onKey=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){e.preventDefault();setOpen(false);return;}
      if(e.key!=='Tab')return;
      const controls=Array.from(bubbleRef.current?.querySelectorAll<HTMLButtonElement>(
        'button:not(:disabled)')??[]);
      if(!controls.length)return;
      const first=controls[0],last=controls[controls.length-1];
      if(e.shiftKey && (document.activeElement===first ||
          !bubbleRef.current?.contains(document.activeElement))){
        e.preventDefault();last.focus();
      }else if(!e.shiftKey && (document.activeElement===last ||
          !bubbleRef.current?.contains(document.activeElement))){
        e.preventDefault();first.focus();
      }
    };
    window.addEventListener('keydown',onKey,true);
    return()=>window.removeEventListener('keydown',onKey,true);
  },[open,me?.id]);
  const lastPage = useRef(page);
  useEffect(()=>{if(lastPage.current!==page&&open)setOpen(false);lastPage.current=page;},[page]); // close only on actual navigation
  if(!me||!open)return null;
  const step=steps[safeIndex];
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
    <section ref={bubbleRef} className="tr-tour-bubble" style={{left,top,width}}>
      <span className="label">TRAKSOS · ШАГ {safeIndex+1} ИЗ {steps.length}</span>
      <h2>{step.title}</h2><p>{step.description}</p>
      <div className="tr-tour-actions">
        <button type="button" className="btn ghost" onClick={close}>Закрыть</button>
        <div className="row">
          <button className="btn ghost" type="button" disabled={safeIndex===0} onClick={()=>setI(k=>Math.max(0,k-1))}>Назад</button>
          <button ref={nextButton} className="btn" type="button" onClick={()=>safeIndex===steps.length-1?close():setI(k=>k+1)}>
            {safeIndex===steps.length-1?'Готово':'Дальше'}
          </button>
        </div>
      </div>
    </section>
  </div>;
}
