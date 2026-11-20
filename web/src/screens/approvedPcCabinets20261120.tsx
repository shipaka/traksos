/**
 * Desktop workspaces based on owner-approved PC cabinets, 20 Nov 2026.
 * No fabricated orders, locations, prices or online statuses. Each action
 * opens an existing authorized server-backed workflow.
 * Desktop only; Android/mobile continues to use the already-approved routes.
 */
import {useEffect, useState, type ReactNode} from 'react';
import {get, onEvent} from '../api.ts';
import {RoadsideMap} from './roadsideMap.tsx';
import {useLoad, useMe} from '../ui.tsx';
import {STATUS, SERVICES} from '../dict.ts';
import {APPROVED_VISUALS} from '../approvedVisuals.ts';
import {VehicleModelPhoto} from '../vehicleVisual.tsx';
import {OfferForm} from './search.tsx';
import {BaseHome} from './base.tsx';
import {native} from '../native.ts';

export type ApprovedPCRole = 'driver'|'owner'|'master'|'tow'|'service'|'insurer'|'inspection'|'moderator'|'admin';
const activeStates = new Set(['searching','accepted','en_route','arrived','working','awaiting_confirmation','pending_client','disputed']);
const text = (value:any, fallback='—') => value == null || value === '' ? fallback : String(value);
const number = (value:any) => typeof value === 'number' ? value.toLocaleString('ru-RU') : '—';
const vehicleLabel = (v:any) => [v?.brand, v?.model, v?.year].filter(Boolean).join(' ') || 'Транспортное средство';
const fmtDate = (value:any) => value ? new Date(value).toLocaleString('ru-RU',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '';
const statusName = (o:any) => STATUS[o?.status]?.name || o?.statusName || text(o?.status, 'Статус уточняется');
const transport = (o:any) => o?.vehicle || o || {};
const orderDate = (o:any):string => (o?.whenDay || o?.when_day || o?.scheduled_date || o?.scheduledAt || o?.scheduled_at || '').slice(0,10);
const dateIso = (value:Date) => [value.getFullYear(),String(value.getMonth()+1).padStart(2,'0'),String(value.getDate()).padStart(2,'0')].join('-');
const todayISO = () => dateIso(new Date());

function useDesktopSize(){
  const [wide,setWide]=useState(()=>!native.isApp && typeof window!=='undefined' && window.matchMedia('(min-width: 1000px)').matches);
  useEffect(()=>{
    const mq=window.matchMedia('(min-width: 1000px)');
    const sync=()=>setWide(!native.isApp && mq.matches);
    // Old Android WebViews have addListener/removeListener but not MQL.addEventListener.
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change',sync);
    else mq.addListener(sync);
    sync();
    return ()=>{
      if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change',sync);
      else mq.removeListener(sync);
    };
  },[]);
  return wide;
}

/** Never mount both versions simultaneously: avoids duplicate requests/actions. */
export function ApprovedPcDesk({role,fallback}:{role:ApprovedPCRole;fallback:ReactNode}) {
  const wide=useDesktopSize();
  if(!wide) return <>{fallback}</>;
  if(role==='owner'||role==='driver') return <CustomerDesk owner={role==='owner'}/>;
  if(role==='master'||role==='tow') return <PerformDesk tow={role==='tow'}/>;
  if(role==='service') return <ServiceDesk/>;
  if(role==='insurer'||role==='inspection') return <InsuranceDesk inspection={role==='inspection'}/>;
  if(role==='moderator') return <ModeratorDesk/>;
  return <AdminDesk/>;
}

function Heading({title,description,children}:{title:string;description:string;children?:ReactNode}){
  return <header className="approved-pc-heading">
    <div><span className="approved-pc-eyebrow">TRAKSOS · РАБОЧИЙ КАБИНЕТ</span><h1>{title}</h1><p>{description}</p></div>
    <img src={APPROVED_VISUALS.workspaceTruck} alt="Иллюстрация TrakSOS, не транспорт клиента"/>
    {children}
  </header>;
}
function Pane({title,children,className=''}:{title:string;children:ReactNode;className?:string}){
  return <section className={'approved-pc-pane '+className}><h2>{title}</h2>{children}</section>;
}
function Empty({children}:{children:ReactNode}){return <p className="approved-pc-empty">{children}</p>}
function LoadingBlock({error,retry}:{error?:any;retry?:()=>void}){
  return <Empty>{error?'Ошибка загрузки данных: '+String(error?.message||error):'Загружаем актуальные данные…'} {retry&&<button className="approved-pc-retry" onClick={retry}>Обновить</button>}</Empty>;
}
function Tabs({items,active,onChange}:{items:[string,string,number|string|null][];active:string;onChange:(id:string)=>void}){
  return <div className="approved-pc-tabs" role="tablist">
    {items.map(([id,label,count])=><button type="button" key={id} role="tab" aria-selected={id===active}
      className={id===active?'selected':''} onClick={()=>onChange(id)}>{label}{count!=null&&<strong>{count}</strong>}</button>)}
  </div>;
}
function Bot({message='Помогу разобраться с заявкой и документами.'}:{message?:string}){
  return <a href="#/trakbot" className="approved-pc-bot" aria-label="Открыть личный чат TrakBot">
    <div><b>TrakBot</b><small>{message}</small><span>Открыть помощника ›</span></div>
    <img src={APPROVED_VISUALS.trakbotHello} alt="TrakBot, утверждённый грузовичок-техник №3"/>
  </a>;
}
function Photo({v,href}:{v:any;href?:string}){
  const image=<VehicleModelPhoto brand={v?.brand} model={v?.model} year={v?.year}/>;
  return href?<a href={href} className="approved-pc-photo" aria-label={'Открыть карточку '+vehicleLabel(v)}>{image}</a>
    :<div className="approved-pc-photo">{image}</div>;
}
function RowItem({label,info,active,href,onClick,badge,v}:{label:string;info?:string;active?:boolean;href?:string;onClick?:()=>void;badge?:string;v?:any}) {
  const body=<>{v&&<Photo v={v}/>}<span className="approved-pc-row-copy"><strong>{label}</strong><small>{info||'Открыть подробности'}</small></span>{badge&&<em>{badge}</em>}</>;
  return href?<a className={'approved-pc-row'+(active?' current':'')} href={href}>{body}</a>
    :<button type="button" className={'approved-pc-row'+(active?' current':'')} onClick={onClick}>{body}</button>;
}
function Calendar({items=[]}:{items?:any[]}) {
  const [shift,setShift]=useState(0);
  const [chosen,setChosen]=useState('');
  const ref=new Date(); const month=new Date(ref.getFullYear(),ref.getMonth()+shift,1);
  const monthDays=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
  const pad=(month.getDay()+6)%7;
  const counts:Record<string,number>={};
  items.forEach(item=>{const d=orderDate(item);if(d)counts[d]=(counts[d]||0)+1});
  const days=Array.from({length:pad},()=>null as number|null).concat(Array.from({length:monthDays},(_,i)=>i+1));
  const monthName=month.toLocaleString('ru-RU',{month:'long',year:'numeric'});
  return <Pane title="Календарь">
    <div className="approved-pc-cal-head"><button onClick={()=>setShift(v=>v-1)} aria-label="Предыдущий месяц">‹</button><b>{monthName}</b><button onClick={()=>setShift(v=>v+1)} aria-label="Следующий месяц">›</button></div>
    <div className="approved-pc-calendar">
      {['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d=><small key={d}>{d}</small>)}
      {days.map((day,i)=>day===null?<span key={'blank'+i}/>:(()=>{
        const date=dateIso(new Date(month.getFullYear(),month.getMonth(),day));
        return <button type="button" key={date} onClick={()=>setChosen(date)} className={(chosen===date?'chosen ':'')+(date===todayISO()?'today':'')}
          aria-label={date+', записей: '+(counts[date]||0)}>{day}{counts[date]>0&&<i aria-hidden="true"/>}</button>;
      })())}
    </div>
    {chosen&&<p className="approved-pc-cal-selection">{chosen.split('-').reverse().join('.')}: {counts[chosen]||0} записей</p>}
  </Pane>;
}
function WorkLayout({left,center,right}:{left:ReactNode;center:ReactNode;right?:ReactNode}){
  return <div className="approved-pc-three"><aside className="approved-pc-left">{left}</aside><div className="approved-pc-center">{center}</div><aside className="approved-pc-right">{right}</aside></div>;
}
function RealCase({o,owner=false}:{o:any;owner?:boolean}){
  const detail=useLoad(()=>get<any>('/api/orders/'+o.id),[o.id],e=>e.orderId===o.id&&e.type==='order');
  const [gps,setGps]=useState<{lat:number;lng:number;at:number}|null>(null);
  useEffect(()=>{
    setGps(null); // Previous application's location cannot leak into a different case.
    return onEvent((event:any)=>{
      if(event.type==='performer_location'&&String(event.orderId)===String(o.id)
         &&Number.isFinite(event.lat)&&Number.isFinite(event.lng)
         &&Math.abs(event.lat)<=90&&Math.abs(event.lng)<=180)
        setGps({lat:event.lat,lng:event.lng,at:Date.now()});
    });
  },[o.id]);
  const d=detail.data||o;
  const v=transport(d);
  const p=d.performer;
  const prev=Number.isFinite(p?.lat)&&Number.isFinite(p?.lng)?{lat:p.lat,lng:p.lng}:null;
  const lastAt=gps?.at||(p?.location_at?Date.parse(p.location_at):null);
  const fresh=lastAt!=null&&Date.now()-lastAt<=120000&&Date.now()-lastAt>=-30000;
  const point=gps||prev;
  const milestones=[['searching','Поиск'],['accepted','Назначен'],['en_route','Выехал'],['arrived','На месте'],['working','Работа'],['completed','Завершено']];
  const current=milestones.findIndex(([id])=>id===d.status);
  return <section className="approved-pc-case">
    <header><div><small>ВЫБРАННАЯ ЗАЯВКА</small><h2>№{text(d.number||d.id)} · {SERVICES[d.service]?.name||text(d.service,'Помощь на дороге')}</h2></div><span className="approved-pc-stage">{statusName(d)}</span></header>
    <div className="approved-pc-case-main">
      <Photo v={v} href={d.vehicleId?'#/garage/'+d.vehicleId:undefined}/>
      <div className="approved-pc-facts">
        <h3>{vehicleLabel(v)}</h3>
        <p><b>Неисправность:</b> {text(d.description||d.problem,'Описание в заявке')}</p>
        <p><b>Место помощи:</b> {text(d.address||d.estimate?.zoneName,'Адрес в подробностях')}</p>
        <p><b>Исполнитель:</b> {text(p?.name||d.performer_name,'Пока не назначен')}</p>
        {p?.car&&<p><b>Едет на:</b> {vehicleLabel(p.car)}</p>}
        {p?.rating!=null&&<p><b>Рейтинг:</b> ★ {Number(p.rating).toFixed(1)}{p.rating_count!=null?' · '+p.rating_count+' отзывов':''}</p>}
        {fresh&&<p className="approved-pc-gps-ok">GPS передавался недавно</p>}
        {!fresh&&<p>Текущее местоположение исполнителя не подтверждено.</p>}
      </div>
    </div>
    <div className="approved-pc-stage-steps" aria-label="Этапы заявки">
      {milestones.map(([id,label],index)=><span key={id} className={id===d.status?'current':current>=0&&index<current?'done':''}>{label}</span>)}
    </div>
    {p&&d.service!=='consult'&&<div className="approved-pc-live-map">
      <RoadsideMap point={fresh?point:null} kind="performer" updatedAt={lastAt}
        synthetic={String(p.id||'').startsWith('demo-')}/>
      {!fresh&&<p className="approved-pc-caveat">Маршрут и время прибытия не выдумываются: ожидаем актуальную геолокацию.</p>}
    </div>}
    <div className="approved-pc-case-actions">
      <a className="approved-pc-primary" href={'#/order/'+o.id}>Открыть заявку и следующий шаг</a>
      <a href={'#/order/'+o.id+'?chat=1'}>Чат и связь по заявке</a>
      {d.vehicleId&&<a href={'#/garage/'+d.vehicleId}>История автомобиля</a>}
      {owner&&<a href="#/fleet">Управление автопарком</a>}
    </div>
    {detail.error&&<p className="approved-pc-caveat">Дополнительные сведения недоступны: {String(detail.error?.message||detail.error)}. Откройте карточку заявки.</p>}
    <p className="approved-pc-caveat">Информация о заказе, изменениях и исполнителе поступает с сервера. Личные телефоны не раскрываются; общение только через предоставленные платформой способы связи.</p>
  </section>;
}
function CustomerDesk({owner}:{owner:boolean}){
  const {me}=useMe();
  const orders=useLoad(()=>get<any[]>('/api/orders'),[],e=>e.type==='order');
  const fleet=useLoad(()=>owner?get<any>('/api/fleet'):Promise.resolve(null),[owner],e=>e.type==='fleet'||e.type==='order');
  const active=(orders.data||[]).filter((o:any)=>activeStates.has(o.status));
  const [chosen,setChosen]=useState<string>('');
  const selected=active.find((o:any)=>String(o.id)===chosen)||active[0];
  const cars=owner?(fleet.data?.cars||[]):[];
  return <main className="approved-pc approved-pc-client">
    <Heading title={owner?'Владелец автопарка':'Водитель'} description={owner?'Заявки, ремонт и состояние техники вашего автопарка':'Вся информация о помощи по выбранной заявке, без лишних сервисов'}/>
    <Tabs active="active" onChange={()=>{}} items={[[owner?'active':'active','Активные заявки',orders.data?active.length:null]]}/>
    {orders.error&&<LoadingBlock error={orders.error} retry={orders.reload}/>}
    <WorkLayout left={<>
      <Pane title="Мои заявки">
        {!orders.data?<LoadingBlock error={orders.error} retry={orders.reload}/>:active.length?
          active.map((o:any)=><RowItem key={o.id} label={'№'+text(o.number||o.id)} info={text(o.address||o.description, statusName(o))}
            active={selected?.id===o.id} onClick={()=>setChosen(String(o.id))} badge={statusName(o)} v={transport(o)}/>)
          :<Empty>Нет активных заявок. Создать новую можно через меню.</Empty>}
      </Pane>
      {owner&&<Pane title="Техника автопарка">
        {fleet.error&&<LoadingBlock error={fleet.error} retry={fleet.reload}/>}
        {cars.slice(0,5).map((c:any)=><RowItem key={c.id} href={'#/garage/'+c.id} label={vehicleLabel(c)}
          info={c.driver?.name?'Водитель: '+c.driver.name:'Водитель не закреплён'} v={c}/>)}
        {!cars.length&&<Empty>Информация о технике появится после добавления в автопарк.</Empty>}
        <a className="approved-pc-small-link" href="#/fleet">Весь автопарк →</a>
      </Pane>}
    </>} center={selected?<RealCase o={selected} owner={owner}/>:<Pane title="Рабочий стол">
        <h3>Помощь грузовому транспорту</h3><p>Активных заявок сейчас нет. Выберите необходимую услугу или откройте историю.</p>
        <div className="approved-pc-case-actions"><a className="approved-pc-primary" href="#/sos">Вызвать специалиста</a>
          <a href="#/new/tow">Эвакуатор</a><a href="#/services">СТО</a><a href="#/orders">История заявок</a></div>
      </Pane>}
      right={<><Pane title={owner?'Сводка автопарка':'Быстрые переходы'}>
        {owner?<><p>Машин в автопарке: <strong>{fleet.data?cars.length:'—'}</strong></p>
          <p>Ждут решения владельца: <strong>{fleet.data?fleet.data.pending?.length||0:'—'}</strong></p>
          <a className="approved-pc-small-link" href="#/fleet">Открыть контроль доступа →</a></>
          :<><a className="approved-pc-small-link" href="#/orders">Заявки и история →</a><a className="approved-pc-small-link" href="#/garage">Моя техника →</a></>}
      </Pane><Bot message={owner?'Помогу с историей техники и заявками.':'Помогу с неисправностью или заявкой.'}/></>}/>
  </main>;
}
function PerformDesk({tow}:{tow:boolean}){
  const {me}=useMe();
  const jobs=useLoad(()=>get<any[]>('/api/orders?as=performer'),[],e=>e.type==='order');
  const auctions=useLoad(()=>get<any[]>('/api/performer/auctions'),[],e=>e.type==='auction'||e.type==='order');
  const [mode,setMode]=useState<'work'|'offers'>('work');
  const [chosen,setChosen]=useState('');
  const all=jobs.data||[];
  const current=all.filter((o:any)=>activeStates.has(o.status) && (!orderDate(o)||orderDate(o)<=todayISO()));
  const planned=all.filter((o:any)=>activeStates.has(o.status)&&orderDate(o)>todayISO());
  const selected=[...current,...planned].find((o:any)=>String(o.id)===chosen)||current[0]||planned[0];
  const offers=auctions.data||[];
  return <main className="approved-pc approved-pc-performer">
    <Heading title={tow?'Эвакуаторщик':'Выездной мастер'} description={tow?'Эвакуации, погрузка, доставка и передача автомобиля':'Выезды, техника клиента, этапы работ и расписание'}/>
    <Tabs items={[[ 'work','Текущая работа · '+current.length+'  |  Запланировано · '+planned.length,null ],
      ['offers','Новые предложения',auctions.data?offers.length:null]]} active={mode} onChange={(id)=>setMode(id as 'work'|'offers')}/>
    {mode==='offers'?<WorkLayout left={<Pane title="Параметры и доступность">
      <p><b>Статус:</b> {text(me?.performer?.line_status,'Проверьте профиль')}</p>
      <p>Предложения отобраны сервером по доступным специализациям и зоне работы.</p>
      <a className="approved-pc-small-link" href="#/work/me">Мои параметры →</a></Pane>}
      center={<Pane title={'Новые предложения · '+offers.length}>
        {auctions.error&&<LoadingBlock error={auctions.error} retry={auctions.reload}/>}
        {!auctions.data?<LoadingBlock error={auctions.error} retry={auctions.reload}/>:offers.length?
          offers.map((a:any)=><article key={a.order_id} className="approved-pc-offer">
            <Photo v={a}/><div><h3>Заявка №{text(a.number||a.order_id)}</h3>
              <p>{vehicleLabel(a)} · {text(a.description||a.needName,'Описание в заявке')}</p>
              <p>{text(a.address||a.estimate?.zoneName,'Место указано в заявке')}</p>
              {a.my_price!=null&&<b>Отклик отправлен. Ожидаем выбора клиента.</b>}
              {a.limits?<OfferForm orderId={a.order_id} limits={a.limits} myPrice={a.my_price} compact onDone={auctions.reload}/>
                :<a className="approved-pc-small-link" href={'#/order/'+a.order_id}>Подробнее →</a>}
            </div>
          </article>):<Empty>Новых подходящих предложений пока нет.</Empty>}
      </Pane>}
      right={<><Calendar items={planned}/><Bot message={tow?'Помогу с заказом и документами эвакуации.':'Помогу с заявкой и ТехБазой.'}/></>}/>
      :<WorkLayout left={<><Pane title={'В работе сегодня · '+current.length}>
        {!jobs.data?<LoadingBlock error={jobs.error} retry={jobs.reload}/>:current.length?current.map((o:any)=>
        <RowItem key={o.id} label={'№'+text(o.number||o.id)} info={text(o.address||o.description,statusName(o))} v={transport(o)}
          badge={statusName(o)} active={selected?.id===o.id} onClick={()=>setChosen(String(o.id))}/>)
        :<Empty>На сегодня принятых работ нет.</Empty>}
      </Pane><Pane title={'Запланировано · '+planned.length}>
        {planned.map((o:any)=><RowItem key={o.id} label={'№'+text(o.number||o.id)} info={orderDate(o)} v={transport(o)}
          onClick={()=>setChosen(String(o.id))} badge={statusName(o)}/>)}
        {!planned.length&&<Empty>Записей на следующие дни нет.</Empty>}
      </Pane></>}
      center={selected?<section className="approved-pc-case">
        <header><div><small>ВЫБРАННЫЙ ЗАКАЗ</small><h2>{tow?'Эвакуация':'Ремонт'} №{text(selected.number||selected.id)}</h2></div><span className="approved-pc-stage">{statusName(selected)}</span></header>
        <div className="approved-pc-case-main"><Photo v={transport(selected)}/><div className="approved-pc-facts">
          <h3>{vehicleLabel(transport(selected))}</h3>
          <p><b>Проблема:</b> {text(selected.description||selected.problem,'Описание в заявке')}</p>
          <p><b>Место:</b> {text(selected.address||selected.estimate?.zoneName)}</p>
          {tow&&<p><b>Куда доставить:</b> {text(selected.destination,'В заявке')}</p>}
        </div></div>
        <div className="approved-pc-case-actions"><a className="approved-pc-primary" href={'#/order/'+selected.id}>Открыть заказ и следующий шаг</a>
          {!tow&&<a href="#/techbase/master">ТехБаза ›</a>}
          <a href="#/work/chats">Чат</a></div>
        <p className="approved-pc-caveat">Фотографии, расчёт, подтверждения и смена статуса — только в серверной карточке заказа.</p>
      </section>:<Pane title="Рабочая смена"><Empty>Нет принятых активных заявок. Перейдите в новые предложения.</Empty>
        <button className="approved-pc-primary" onClick={()=>setMode('offers')}>Проверить предложения</button></Pane>}
      right={<><Calendar items={all}/><Pane title="Моя смена"><p>Статус: <b>{text(me?.performer?.line_status)}</b></p>
        <a className="approved-pc-small-link" href="#/work/me/schedule">Расписание и доступность →</a></Pane>
        <Bot message={tow?'Помогу с погрузкой и документами.':'Подскажу по диагностике и заявке.'}/></>}/>}
  </main>;
}
function ServiceDesk(){
  const data=useLoad(()=>get<any>('/api/base'),[],e=>e.type==='booking');
  const [mode,setMode]=useState<'req'|'repair'|'ready'|'done'>('repair');
  const [chosen,setChosen]=useState('');
  const g=data.data?.groups;
  const buckets={req:g?.requests||[],repair:g?.repair||[],ready:g?.ready||[],done:g?.done||[]};
  const list=buckets[mode];
  const selected=list.find((v:any)=>String(v.id)===chosen)||list[0];
  const expected=g?.expected||[];
  // A brand-new repair station must complete the real onboarding before its workdesk appears.
  if(data.data && !data.data.center) return <BaseHome />;
  const card=(b:any)=><RowItem key={b.id} label={vehicleLabel(b.vehicle)} info={text(b.needName,b.statusName)}
      badge={b.statusName} active={selected?.id===b.id} onClick={()=>setChosen(String(b.id))} v={b.vehicle}/>;
  return <main className="approved-pc approved-pc-service">
    <Heading title="СТО / рембаза" description={data.data?.center?.name||'Входящие обращения, ремонт, ожидание и выдача транспорта'}/>
    <Tabs active={mode} onChange={(id)=>{setMode(id as typeof mode);setChosen('')}} items={[
      ['req','Входящие',g?buckets.req.length:null],['repair','В ремонте',g?buckets.repair.length:null],
      ['ready','К выдаче',g?buckets.ready.length:null],['done','История',g?buckets.done.length:null]]}/>
    {!g?<LoadingBlock error={data.error} retry={data.reload}/>:<WorkLayout
      left={<><Pane title={mode==='repair'?'В ремонте':mode==='req'?'Новые обращения':mode==='ready'?'К выдаче':'История'}>
        {list.length?list.map(card):<Empty>Заявок в этом разделе нет.</Empty>}</Pane>
        <Pane title={'Ожидаем приезд · '+expected.length}>{expected.map((b:any)=>
          <RowItem key={b.id} label={vehicleLabel(b.vehicle)} info={text(b.needName)} v={b.vehicle}
            href={'#/base/car/'+b.id} badge={text(b.statusName,'Ожидаем')}/>)}
          {!expected.length&&<Empty>Подтверждённых приездов сейчас нет.</Empty>}
        </Pane></>}
      center={selected?<section className="approved-pc-case">
        <header><div><small>ВЫБРАННОЕ ДЕЛО СТО</small><h2>Ремонт №{text(selected.number||selected.id)}</h2></div>
          <span className="approved-pc-stage">{text(selected.statusName)}</span></header>
        <div className="approved-pc-case-main"><Photo v={selected.vehicle}/><div className="approved-pc-facts">
          <h3>{vehicleLabel(selected.vehicle)}</h3>
          <p><b>Работы:</b> {text(selected.needName,'Уточняются')}</p>
          <p><b>Клиент:</b> {text(selected.client?.name)}</p>
          <p><b>Дата:</b> {text(selected.whenDay)}</p>
          {selected.vehicle?.trailerPlate&&<p><b>Прицеп:</b> {selected.vehicle.trailerPlate}</p>}
        </div></div>
        <div className="approved-pc-case-actions"><a className="approved-pc-primary" href={'#/base/car/'+selected.id}>Открыть ремонт / документы</a>
          <a href="#/base/inbox">Входящие обращения</a></div>
        <p className="approved-pc-caveat">Отдельный тягач, прицеп или сцепка — по данным клиента. Смета, чеклист, фото и переписка открываются в настоящем ремонтном деле.</p>
      </section>:<Pane title="Рабочий стол рембазы"><Empty>Выберите машину слева или откройте новые обращения.</Empty>
        <a href="#/base/inbox" className="approved-pc-primary">Входящие заявки</a></Pane>}
      right={<><Calendar items={[...expected,...buckets.repair]}/><Pane title="Управление"><a className="approved-pc-small-link" href="#/base/me">Карточка СТО и приём →</a>
        <a className="approved-pc-small-link" href="#/base/money">Финансы СТО →</a></Pane><Bot message="Помогу с ремонтом, запчастями и заявками."/></>}/>}
  </main>;
}

/** Authorized live quote summary inside the approved insurance workdesk. */
function InsuranceProposals({requestId}:{requestId:string}){
  const caseData=useLoad(()=>get<any>('/api/insurance/requests/'+requestId),[requestId],
    e=>e.type==='vehicle_service'&&String(e.requestId)===String(requestId));
  const entries=caseData.data?.proposals||[];
  const stage=caseData.data?.request?.insurance_stage;
  const chosenId=caseData.data?.request?.insurance_choice_id;
  return <Pane title={'Предложения страховых компаний · '+(caseData.data?entries.length:'—')+' из 20'}>
    {!caseData.data?<LoadingBlock error={caseData.error} retry={caseData.reload}/>:
      entries.length?entries.slice(0,20).map((quote:any)=>
        <a key={quote.id} href={'#/insurance/request/'+requestId} className="approved-pc-quote">
          <strong>{text(quote.company,'Страховая компания')} · {text(quote.product,'Полис')}</strong>
          <span>{Number.isFinite(Number(quote.premium_kopecks))?
            new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(Number(quote.premium_kopecks)/100):'Стоимость уточняется'}</span>
          {chosenId===quote.id&&<em>Выбран клиентом</em>}
        </a>)
      :<Empty>Предложения ещё подготавливаются. Данные появятся после сохранения в страховом деле.</Empty>}
    {stage==='offers_sent'&&<p className="approved-pc-caveat">Варианты отправлены. Ожидаем решения клиента.</p>}
    <a className="approved-pc-small-link" href={'#/insurance/request/'+requestId}>Открыть все варианты, документы и переписку →</a>
  </Pane>;
}

function InsuranceDesk({inspection}:{inspection:boolean}){
  const {me}=useMe();
  const api=inspection?'/api/insurer/inspections':'/api/insurer/requests';
  const source=useLoad(()=>get<any[]>(api),[api],e=>e.type==='vehicle_service');
  const [mode,setMode]=useState<'active'|'done'>('active');
  const [chosen,setChosen]=useState('');
  const all=source.data||[];
  const done=(o:any)=>['completed','rejected','cancelled'].includes(o.status);
  const items=all.filter(o=>mode==='done'?done(o):!done(o));
  const selected=items.find(o=>String(o.id)===chosen)||items[0];
  const both=me?.roles.includes('insurer')&&me?.roles.includes('inspection_operator');
  return <main className="approved-pc approved-pc-insurance">
    <Heading title={inspection?'Оператор техосмотра':'Страховой партнёр'}
      description={inspection?'Назначенные проверки, результаты осмотра и документы':'Назначенные страховые дела, варианты полисов и документы'}/>
    {both&&<div className="approved-pc-partner-switch"><a className={!inspection?'selected':''} href="#/as/insurer">Страхование</a>
      <a className={inspection?'selected':''} href="#/as/inspection">Техосмотр</a></div>}
    <Tabs items={[[ 'active',inspection?'Осмотры в работе':'Страховые дела в работе',source.data?all.filter(o=>!done(o)).length:null],
      ['done','История',source.data?all.filter(done).length:null]]} active={mode} onChange={id=>{setMode(id as typeof mode);setChosen('')}}/>
    <WorkLayout left={<Pane title={inspection?'Назначенные осмотры':'Страховые заявки'}>
      {!source.data?<LoadingBlock error={source.error} retry={source.reload}/>:items.length?items.map((o:any)=>
        <RowItem key={o.id} label={(inspection?'ТО ':'Полис ')+vehicleLabel(o)} info={text(o.comment)}
          active={selected?.id===o.id} onClick={()=>setChosen(String(o.id))} badge={text(o.status) } v={o}/>)
        :<Empty>Назначенных заявок в выбранном разделе нет.</Empty>}
    </Pane>}
    center={selected?<section className="approved-pc-case">
      <header><div><small>{inspection?'ДЕЛО ТЕХОСМОТРА':'СТРАХОВОЕ ДЕЛО'}</small><h2>№{text(selected.number||selected.id)}</h2></div>
        <span className="approved-pc-stage">{text(selected.status)}</span></header>
      <div className="approved-pc-case-main"><Photo v={selected}/><div className="approved-pc-facts">
        <h3>{vehicleLabel(selected)}</h3><p><b>Клиент:</b> {text(selected.client_name||selected.client?.name)}</p>
        <p><b>VIN:</b> {text(selected.vin)}</p><p><b>Заявка:</b> {text(selected.comment,'Детали внутри дела')}</p>
      </div></div>
      {inspection?<><Pane title="Этапы осмотра"><p>Заявка → Назначение → Проверка → Фиксация результата</p>
        <p>Отметка о выполнении не является выдачей диагностической карты и не направляет её в ЕАИСТО.</p></Pane>
        <a className="approved-pc-primary" href="#/inspections/processing">Открыть рабочую обработку осмотра</a></>
      :<><InsuranceProposals requestId={String(selected.id)}/>
        <a className="approved-pc-primary" href={'#/insurance/request/'+selected.id}>Открыть дело, варианты и переписку</a></>}
    </section>:<Pane title={inspection?'Техосмотры':'Страхование'}><Empty>Пока нет открытого дела. Новые назначенные заявки появятся здесь.</Empty></Pane>}
    right={<><Calendar items={all}/><Pane title="Документы и следующее действие"><p>Проверяйте полноту документов в карточке выбранного дела.</p>
      {selected&&!inspection&&<a className="approved-pc-small-link" href={'#/insurance/request/'+selected.id}>Документы и предложения →</a>}
      {inspection&&<p className="approved-pc-caveat">Официальные карты/ЕАИСТО пока не подключены.</p>}
      </Pane><Bot message={inspection?'Помогу с порядком осмотра и документами.':'Помогу со страховым делом и документами.'}/></>}/>
  </main>;
}
function ModeratorDesk(){
  const [kind,setKind]=useState<'dispute'|'appeal'|'review'>('dispute');
  const source=useLoad(()=>get<any>('/api/mod/cases?kind='+kind),[kind],e=>e.type==='mod_case');
  const [chosen,setChosen]=useState('');
  const items=source.data?.items||[];
  const selected=items.find((o:any)=>String(o.id)===chosen)||items[0];
  return <main className="approved-pc approved-pc-moderator">
    <Heading title="Модератор" description="Споры, обращения, проверка партнёров и журнал решений"/>
    <Tabs active={kind} onChange={id=>{setKind(id as typeof kind);setChosen('')}} items={[
      ['dispute','Споры и жалобы',null],['appeal','Обжалования',null],['review','Отзывы и отметки',null]]}/>
    <div className="approved-pc-subnav"><a href="#/moderation/support">Обращения</a><a href="#/moderation/verify">Проверка партнёров</a>
      <a href="#/moderation/flagged">Подозрительные сообщения</a><a href="#/moderation/cases">Журнал решений</a></div>
    <WorkLayout left={<Pane title="Очередь обращений">{!source.data?<LoadingBlock error={source.error} retry={source.reload}/>:items.length?
      items.map((o:any)=><RowItem key={o.id} label={'№'+text(o.number)} info={text(o.title)}
        badge={o.priority===1?'Срочно':'На проверке'} active={selected?.id===o.id} onClick={()=>setChosen(String(o.id))}/>)
      :<Empty>Открытых дел в очереди нет.</Empty>}</Pane>}
      center={selected?<section className="approved-pc-case">
        <header><div><small>РАЗБОР ОБРАЩЕНИЯ</small><h2>Дело №{text(selected.number||selected.id)}</h2></div>
          <span className="approved-pc-stage">Приоритет: {selected.priority===1?'срочно':'обычный'}</span></header>
        <h3>{text(selected.title)}</h3><p>{text(selected.openedBy)} → {text(selected.target)}</p>
        <p>Связанная заявка, сообщения сторон, документы, основания решения и журнал доступны в подробном деле.</p>
        <div className="approved-pc-case-actions"><a className="approved-pc-primary" href={'#/admin/case/'+selected.id}>Открыть дело и принять решение</a></div>
        <p className="approved-pc-caveat">Решения фиксируются на сервере. Из карточки здесь не создаются списания и блокировки.</p>
      </section>:<Pane title="Модерация"><Empty>Выберите обращение слева.</Empty></Pane>}
      right={<><Pane title="Что проверить"><p>✓ Связанная заявка и статус</p><p>✓ Доказательства обеих сторон</p><p>✓ Переписка и правила площадки</p><p>✓ Основание и журнал решения</p></Pane>
        <Pane title="Рабочие инструменты"><a className="approved-pc-small-link" href="#/moderation/support">Очередь поддержки →</a>
          <a className="approved-pc-small-link" href="#/moderation/verify">Проверка партнёров →</a></Pane></>}/>
  </main>;
}
function AdminDesk(){
  const summary=useLoad(()=>get<any>('/api/admin/summary'),[],e=>e.type==='order'||e.type==='mod_case');
  const live=useLoad(()=>get<any[]>('/api/admin/live'),[],e=>e.type==='order');
  const d=summary.data;
  const alertItems=(live.data||[]).filter((o:any)=>o.unilateral_status==='disputed'||o.status==='no_performer'||o.is_sos).slice(0,5);
  const tiles:[string,string,string][]=[['Заявок сегодня',d?number(d.today?.orders):'—','#/admin/section/cases'],
    ['На линии',d?number((d.today?.mastersOnline||0)+(d.today?.towOnline||0)):'—','#/admin/section/dispatch'],
    ['Открытые споры',d?number(d.today?.disputesOpen):'—','#/admin/section/queue'],
    ['В очереди модерации',d?number(d.today?.modOpen):'—','#/admin/section/queue']];
  return <main className="approved-pc approved-pc-admin">
    <Heading title="Центр управления TrakSOS" description="Операции · Партнёры · Заявки · Проверки · Безопасность"/>
    <div className="approved-pc-metrics">{tiles.map(([label,value,href])=><a href={href} key={label}><small>{label}</small><strong>{value}</strong></a>)}</div>
    <WorkLayout left={<><Pane title="Требуют внимания">{!live.data?<LoadingBlock error={live.error} retry={live.reload}/>:alertItems.length?
      alertItems.map((o:any)=><RowItem href={'#/order/'+o.id} key={o.id} label={'№'+text(o.number)} info={text(o.address,statusName(o))}
        badge={statusName(o)}/>):<Empty>Срочных заявок в текущей выборке нет.</Empty>}
    </Pane><Pane title="Управление"><a className="approved-pc-small-link" href="#/admin/section/registry">Единая база компаний и партнёров →</a>
      <a className="approved-pc-small-link" href="#/admin/section/payments">Финансы и комиссии →</a>
      <a className="approved-pc-small-link" href="#/admin/section/diagnostics">Журнал ошибок →</a></Pane></>}
    center={<><Pane title="Рабочая сводка"><div className="approved-pc-stats">
      <p><b>Заявок сегодня</b><strong>{d?number(d.today?.orders):'—'}</strong></p>
      <p><b>Мастеров на линии</b><strong>{d?number(d.today?.mastersOnline):'—'}</strong></p>
      <p><b>Эвакуаторщиков на линии</b><strong>{d?number(d.today?.towOnline):'—'}</strong></p>
      <p><b>Ждут подтверждения суммы</b><strong>{d?number(d.money?.awaitingConfirmation):'—'}</strong></p></div>
      {summary.error&&<LoadingBlock error={summary.error} retry={summary.reload}/>}
      <div className="approved-pc-case-actions"><a className="approved-pc-primary" href="#/admin/section/summary">Полная сводка</a>
        <a href="#/admin/section/stats">Аналитика</a><a href="#/admin/section/settings">Настройки</a></div>
      </Pane><Pane title="Россия · регионы обслуживания">
        <div className="approved-pc-russia"><b>Россия</b><span>Региональные данные — по фактической географии заказов.</span>
          <a href="#/admin/section/registry">Поиск партнёров по регионам →</a></div>
        <p className="approved-pc-caveat">Никаких выдуманных точек на карте: до подключения геоданных показываем переход к фильтрам реестра.</p>
      </Pane></>}
    right={<><Pane title="Состояние платформы"><p>Реальный статус интеграций — в диагностике; зелёные индикаторы из макета не являются подтверждением работы.</p>
      <a className="approved-pc-small-link" href="#/admin/section/diagnostics">Открыть диагностику →</a></Pane>
      <Pane title="Тестовые кабинеты"><div className="approved-pc-role-grid">
        {[['owner','Владелец'],['driver','Водитель'],['master','Мастер'],['tow','Эвакуатор'],
          ['service','СТО'],['insurer','Страхование'],['inspection','Техосмотр'],['moderator','Модератор'],['admin','Администратор']]
          .map(([id,label])=><a key={id} href={'#/admin/test-center/'+id}>{label}</a>)}
      </div><a className="approved-pc-primary" href="#/admin/test-center">Открыть тест-центр</a></Pane></>}/>
  </main>;
}
