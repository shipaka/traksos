import { useEffect, useRef, useState } from 'react';
import { get, post, fmtTime, rub } from '../api.ts';
import { SERVICES, STATUS } from '../dict.ts';
import '../adminCaseCenter.css';

type FocusCard = { kind:'order'|'vehicle'|'booking'|'person'; id:string }; 
type Scope = 'all'|'active'|'closed'|'moderated';
type DetailTab = 'overview'|'timeline'|'chat'|'finance'|'moderation'|'notes';
const scopes: {id:Scope;name:string}[] = [
  {id:'all',name:'Все'}, {id:'active',name:'В работе'},
  {id:'closed',name:'Завершённые'}, {id:'moderated',name:'Модерировались'}
];
const tabs: {id:DetailTab;name:string}[] = [
  {id:'overview',name:'Обзор'}, {id:'timeline',name:'Ход работ'},
  {id:'chat',name:'Чат'}, {id:'finance',name:'Расчёты'},
  {id:'moderation',name:'Модерация'}, {id:'notes',name:'Журнал'}
];
const date = (v?:string|null) => v?fmtTime(v):'Не зафиксировано';
const cash = (v?:number|null) => v==null?'Не подтверждено':rub(Number(v));
const action = (name:string) => ({
  created:'Заявка создана',accepted:'Исполнитель принял',depart:'Исполнитель выехал',
  arrive:'Исполнитель прибыл',start_work:'Работа началась',
  completed:'Работа завершена',cancelled:'Заявка отменена',
  resolved_complete:'Администратор завершил заказ',
  resolved_cancel:'Администратор отменил заказ'
} as Record<string,string>)[name]||name.replaceAll('_',' ');
const status = (s?:string) => (s&&STATUS[s]?.name)||s||'—';

export function AdminCaseCenter() {
  const [q,setQ]=useState('');
  const [scope,setScope]=useState<Scope>('all');
  const [refresh,setRefresh]=useState(0);
  const [list,setList]=useState<any[]|null>(null);
  const [listError,setListError]=useState('');
  const [selected,setSelected]=useState<string|null>(null);
  const [detail,setDetail]=useState<any|null>(null);
  const [error,setError]=useState('');
  const [tab,setTab]=useState<DetailTab>('overview');
  const [focused,setFocused]=useState<FocusCard|null>(null);
  const [comment,setComment]=useState('');
  const [saving,setSaving]=useState(false);
  const [exporting,setExporting]=useState(false);
  const dialog=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    let live=true;
    const handle=setTimeout(()=>{
      get('/api/admin/cases?q='+encodeURIComponent(q)+'&scope='+scope)
        .then((r:any)=>{if(live){setList(Array.isArray(r)?r:[]);setListError('');}})
        .catch((e:any)=>{if(live){setListError(String(e?.message||e));setList([]);}});
    },250);
    return ()=>{live=false;clearTimeout(handle);};
  },[q,scope,refresh]);
  useEffect(()=>{
    if(!selected){setDetail(null);setError('');return;}
    let live=true;
    setDetail(null);setError('');
    get('/api/admin/cases/'+encodeURIComponent(selected))
      .then((r:any)=>{if(live)setDetail(r);})
      .catch((e:any)=>{if(live)setError(String(e?.message||e));});
    return ()=>{live=false;};
  },[selected,refresh]);
  useEffect(()=>{
    if(!selected)return;
    dialog.current?.focus();
    const close=(e:KeyboardEvent)=>{if(e.key==='Escape')setSelected(null);};
    document.addEventListener('keydown',close);
    return ()=>document.removeEventListener('keydown',close);
  },[selected]);
  const open=(id:string)=>{setTab('overview');setFocused(null);setComment('');setSelected(id);};
  const drill=(kind:FocusCard['kind'],id?:string|null)=>{if(id){setFocused({kind,id});dialog.current?.focus();}};
  const save=async()=>{
    if(!selected||comment.trim().length<5||saving)return;
    setSaving(true);
    try{
      await post('/api/admin/cases/'+encodeURIComponent(selected)+'/notes',{comment:comment.trim()});
      setComment('');setRefresh(x=>x+1);
    }catch(e:any){setError(String(e?.message||e));}
    finally{setSaving(false);}
  };
  const downloadCsv=async()=>{
    if(!selected||exporting)return;
    setExporting(true);
    try{
      const result:any=await get('/api/admin/cases/'+encodeURIComponent(selected)+'/export');
      const blob=new Blob([result.csv],{type:'text/csv;charset=utf-8'});
      const url=URL.createObjectURL(blob);
      const link=document.createElement('a');
      link.href=url;link.download=result.filename||'traksos-case.csv';
      document.body.appendChild(link);link.click();link.remove();
      URL.revokeObjectURL(url);
    }catch(e:any){setError(String(e?.message||e));}
    finally{setExporting(false);}
  };
  const stages=detail?.stages||[],bookings=detail?.bookings||[];
  const currentOrder=focused?.kind==='order'?stages.find((s:any)=>s.id===focused.id):null;
  const currentBooking=focused?.kind==='booking'?bookings.find((b:any)=>b.id===focused.id):null;
  const currentPerson=focused?.kind==='person'?stages.reduce((p:any,s:any)=>p??(
    s.client_id===focused.id?{id:s.client_id,name:s.client_name,role:'Клиент'}:
    s.performer_id===focused.id?{id:s.performer_id,name:s.performer_name,role:'Исполнитель'}:null),null):null;
  const segments=[...stages.map((s:any)=>({...s,source_kind:'order'})),
    ...bookings.map((b:any)=>({...b,source_kind:'booking'}))]
    .sort((a:any,b:any)=>(a.stage_no||0)-(b.stage_no||0));
  return <div className="case-register">
    <div className="case-reg-intro">
      <div><span className="case-reg-kicker">ОПЕРАЦИОННЫЙ РЕЕСТР</span>
        <h3>Заявки и мультизаявки</h3>
        <p>Поиск по номеру заказа, номеру М-заявки или госномеру. Данные из настоящих заявок, без демонстрационных сумм.</p></div>
      <span className="case-reg-status">Доступ администратора · действия журналируются</span>
    </div>
    <div className="case-reg-filters">
      <input type="search" className="field" value={q}
        onChange={e=>setQ(e.target.value)}
        placeholder="№ 78456, М-000041 или номер ТС"
        aria-label="Найти заявку, мультизаявку или автомобиль"/>
      <button type="button" className="btn ghost small" onClick={()=>setRefresh(x=>x+1)}>Обновить</button>
    </div>
    <div className="case-reg-tabs" role="group" aria-label="Фильтр обращений">
      {scopes.map(x=><button key={x.id} type="button"
        aria-pressed={scope===x.id} className={scope===x.id?'chosen':''}
        onClick={()=>setScope(x.id)}>{x.name}</button>)}
    </div>
    {listError&&<div className="case-reg-error" role="alert">{listError}</div>}
    {!list?<p className="note">Загрузка реестра…</p>
      :!list.length?<p className="case-reg-empty">По выбранным условиям обращений не найдено.</p>
      :<div className="case-reg-list">{list.map(x=>
        <button type="button" className="case-reg-entry" key={x.id} onClick={()=>open(x.id)}
          aria-label={'Открыть '+(x.case_number||'заявку №'+x.number)}>
          <div className="case-reg-entry-main">
            <b>{x.case_number||'Заявка № '+x.number}</b>
            <small>{x.client_name||'Клиент'} · {x.vehicle_brand||'Автомобиль'} {x.vehicle_plate||''}</small>
          </div>
          <div className="case-reg-entry-meta">
            <span>{x.is_multi?'Этапов: '+(Number(x.order_count)+Number(x.workshop_count)):'Один заказ'}</span>
            <small>Открыта: {date(x.opened_at)}</small>
          </div>
          <div className="case-reg-entry-badges">
            {x.moderated&&<span className="case-reg-chip edited">Модерировалась</span>}
            <span className={'case-reg-chip '+(x.has_active?'active':'closed')}>
              {x.has_active?'В работе':'Закрыта'}</span>
          </div>
          <span aria-hidden="true" className="case-reg-arrow">↗</span>
        </button>)}</div>}
    <p className="case-reg-foot">Реестр показывает до 500 последних обращений. Финансовые расчёты и статусы здесь являются отражением существующих записей, а не налоговым заключением.</p>

    {selected&&<div className="case-detail-layer">
      <button type="button" className="case-detail-curtain" onClick={()=>setSelected(null)}
        aria-label="Закрыть подробности заявки"/>
      <section ref={dialog} className="case-detail-window" role="dialog" aria-modal="true"
        aria-label="Подробности заявки" tabIndex={-1}>
        <header className="case-detail-header">
          <div>
            <span className="case-reg-kicker">ЦЕНТР УПРАВЛЕНИЯ ОБРАЩЕНИЕМ</span>
            <h3>{detail?.case_number||('Заявка № '+(stages[0]?.number??'…'))}</h3>
            <p>{detail?.multi?'Сборная мультизаявка · отдельные этапы и расчёты':'Одна заявка · история и контроль'}</p>
          </div>
          <button type="button" className="case-detail-close" onClick={()=>setSelected(null)} aria-label="Закрыть окно">×</button>
        </header>
        <nav className="case-detail-tabs" aria-label="Разделы обращения">
          {tabs.map(x=><button key={x.id} type="button" className={tab===x.id?'active':''}
            aria-current={tab===x.id?'page':undefined} onClick={()=>{setFocused(null);setTab(x.id);}}>{x.name}</button>)}
        </nav>
        <div className="case-detail-body">
          {error&&<div className="case-reg-error" role="alert">{error}</div>}
          {!detail&&!error&&<p className="note">Загружаю историю обращения…</p>}

          {detail&&focused&&<div className="case-inspect-pane">
            <div className="case-inspect-top">
              <button type="button" className="case-detail-link case-inspect-back" onClick={()=>setFocused(null)}>← Вернуться к обращению</button>
              <span className="case-reg-chip">Просмотр администратора · операции по правам</span>
            </div>
            {focused.kind==='vehicle'&&<>
              <h4>Карточка автомобиля</h4>
              {!detail.vehicle||detail.vehicle.id!==focused.id
                ?<p className="case-detail-warning">В этом обращении автомобиль не привязан к подтверждённой карточке. Данные по марке из описания заявки нельзя выдавать за запись из гаража.</p>
                :<div className="case-inspect-grid">
                  <div><span>Марка и модель</span><b>{detail.vehicle.brand||'—'} {detail.vehicle.model||''}</b></div>
                  <div><span>Год выпуска</span><b>{detail.vehicle.year||'Не указан'}</b></div>
                  <div><span>Госномер</span><b>{detail.vehicle.plate||'Не указан'}</b></div>
                  <div><span>Прицеп</span><b>{detail.vehicle.trailer_plate||'Не указан'}</b></div>
                </div>}
              <h4>Владелец и водитель</h4>
              <div className="case-inspect-links">
                {detail.vehicle?.owner_id&&<button type="button" className="case-inspect-target" onClick={()=>drill('person',detail.vehicle.owner_id)}>Владелец · открыть профиль <span>›</span></button>}
                {detail.vehicle?.driver_id&&<a className="case-inspect-target" href={'#/admin/user/'+detail.vehicle.driver_id}>Водитель · полная карточка <span>›</span></a>}
              </div>
              <h4>История обращений этого ТС</h4>
              {!detail.vehicle_history?.length&&!detail.vehicle_history_bookings?.length?<p className="note">Других зарегистрированных обращений по этому ТС нет.</p>:null}
              {detail.vehicle_history?.map((v:any)=><a key={v.id} className="case-inspect-target" href={'#/order/'+v.id}>
                <span>Заказ №{v.number} · {SERVICES[v.service]?.name||v.service} · {date(v.created_at)}</span><b>Открыть ›</b>
              </a>)}
              {detail.vehicle_history_bookings?.map((b:any)=><a key={b.id} className="case-inspect-target" href={'#/booking/'+b.id}>
                <span>СТО №{b.number} · {b.center_name||'Сервис'} · {date(b.created_at)}</span><b>Открыть ›</b>
              </a>)}
              <p className="note">История берётся по внутреннему идентификатору машины. Одного совпадения марки или госномера недостаточно для объединения чужих автомобилей.</p>
            </>}
            {focused.kind==='order'&&<>
              {!currentOrder?<p className="case-reg-error">Этот этап отсутствует среди заказов обращения.</p>:<>
                <h4>Рабочая заявка №{currentOrder.number}</h4>
                <div className="case-inspect-grid">
                  <div><span>Статус</span><b>{status(currentOrder.status)}</b></div>
                  <div><span>Услуга</span><b>{SERVICES[currentOrder.service]?.name||currentOrder.service}</b></div>
                  <div><span>Выезд</span><b>{date(currentOrder.en_route_at)}</b></div>
                  <div><span>На месте</span><b>{date(currentOrder.arrived_at)}</b></div>
                  <div><span>Начало работы</span><b>{date(currentOrder.work_started_at)}</b></div>
                  <div><span>Завершение</span><b>{date(currentOrder.completed_at||currentOrder.cancelled_at)}</b></div>
                </div>
                <p>{currentOrder.problem||currentOrder.description||'Описание отсутствует'}</p>
                <div className="case-inspect-links">
                  {currentOrder.vehicle_id&&<button type="button" className="case-inspect-target" onClick={()=>drill('vehicle',currentOrder.vehicle_id)}>Автомобиль и история ТС <span>›</span></button>}
                  {currentOrder.client_id&&<button type="button" className="case-inspect-target" onClick={()=>drill('person',currentOrder.client_id)}>Клиент · профиль <span>›</span></button>}
                  {currentOrder.performer_id&&<button type="button" className="case-inspect-target" onClick={()=>drill('person',currentOrder.performer_id)}>Исполнитель · профиль <span>›</span></button>}
                  <button type="button" className="case-inspect-target" onClick={()=>{setFocused(null);setTab('chat');}}>Чат по обращению <span>›</span></button>
                  <a className="case-inspect-target" href={'#/order/'+currentOrder.id}>Полная рабочая заявка и разрешённые действия <span>›</span></a>
                </div>
                <p className="case-detail-warning">Для смены суммы, статуса или назначения используйте только реальные полномочные операции в рабочей заявке. Обязательные причины и аудит не обходятся этим окном.</p>
              </>}
            </>}
            {focused.kind==='booking'&&<>
              {!currentBooking?<p className="case-reg-error">Связанная запись СТО не найдена.</p>:<>
                <h4>Запись СТО №{currentBooking.number}</h4>
                <div className="case-inspect-grid">
                  <div><span>Сервис</span><b>{currentBooking.center_name||'—'}</b></div>
                  <div><span>Статус</span><b>{currentBooking.status}</b></div>
                  <div><span>Записан</span><b>{String(currentBooking.when_day||'—')} {currentBooking.when_time||''}</b></div>
                  <div><span>Прибыл</span><b>{date(currentBooking.arrived_at)}</b></div>
                  <div><span>Готов</span><b>{date(currentBooking.ready_at)}</b></div>
                  <div><span>Закрыт</span><b>{date(currentBooking.closed_at)}</b></div>
                </div>
                <p>{currentBooking.need||'Работы не указаны'}</p>
                <a className="case-inspect-target" href={'#/booking/'+currentBooking.id}>Открыть полную запись и документы СТО <span>›</span></a>
              </>}
            </>}
            {focused.kind==='person'&&<>
              <h4>{currentPerson?.role||'Участник обращения'} · карточка пользователя</h4>
              <p>{currentPerson?.name||'Имя в заказе не указано'}</p>
              <a className="case-inspect-target" href={'#/admin/user/'+focused.id}>Открыть полный профиль, историю и разрешённые администратору действия <span>›</span></a>
              <p className="note">Открытие профиля — просмотр с административными правами, не вход от имени другого пользователя.</p>
            </>}
          </div>}

          {detail&&!focused&&tab==='overview'&&<>
            <div className="case-detail-summary">
              <div><span>Открыто</span><b>{date(stages[0]?.created_at)}</b></div>
              <div><span>Заказов</span><b>{stages.length}</b></div>
              <div><span>Связанных СТО</span><b>{bookings.length}</b></div>
              <div><span>Случаев модерации</span><b>{detail.moderation?.length||0}</b></div>
            </div>
            <div className="case-inspect-overview">
              <span className="case-reg-kicker">СВЯЗАННЫЕ КАРТОЧКИ</span>
              <div className="case-inspect-links">
                {detail.vehicle?.id
                  ?<button type="button" className="case-inspect-target" onClick={()=>drill('vehicle',detail.vehicle.id)}>
                    <span>Автомобиль · {detail.vehicle.brand||'ТС'} {detail.vehicle.model||''} · {detail.vehicle.plate||'без госномера'}</span><b>Открыть ›</b>
                  </button>
                  :<span className="note">Карточка ТС не привязана к этому обращению</span>}
                {stages[0]?.client_id&&<button type="button" className="case-inspect-target" onClick={()=>drill('person',stages[0].client_id)}>
                  <span>Клиент · {stages[0].client_name||'без имени'}</span><b>Открыть ›</b>
                </button>}
              </div>
            </div>
            <h4>Этапы обращения</h4>
            {segments.map((item:any)=>item.source_kind==='order'?
              <article key={'order-'+item.id} className="case-detail-stage">
                <div className="case-detail-between">
                  <button type="button" className="case-inspect-text-link" onClick={()=>drill('order',item.id)}>
                    Этап {item.stage_no} · заказ №{item.number} ↗</button>
                  <span className="case-reg-chip">{status(item.status)}</span>
                </div>
                <div>{SERVICES[item.service]?.name||item.service} · {item.performer_id
                  ?<button type="button" className="case-inspect-text-link" onClick={()=>drill('person',item.performer_id)}>{item.performer_name||'Исполнитель'} ↗</button>
                  :'Исполнитель ещё не выбран'}</div>
                <small>{item.problem||item.description||'Описание не заполнено'}</small>
                <div className="case-detail-stage-dates">
                  <span>Открыта: {date(item.created_at)}</span>
                  <span>Принята: {date(item.accepted_at)}</span>
                  <span>Выехал: {date(item.en_route_at)}</span>
                  <span>Прибыл: {date(item.arrived_at)}</span>
                  <span>Начал работу: {date(item.work_started_at)}</span>
                  <span>Закрыта: {date(item.completed_at||item.cancelled_at)}</span>
                </div>
                <a className="case-detail-link" href={'#/order/'+item.id}>Открыть рабочую заявку</a>
              </article>:
              <article key={'booking-'+item.id} className="case-detail-stage">
                <div className="case-detail-between">
                  <button type="button" className="case-inspect-text-link" onClick={()=>drill('booking',item.id)}>
                    Этап {item.stage_no} · СТО · запись №{item.number} ↗</button>
                  <span className="case-reg-chip">{item.status}</span>
                </div>
                <div>{item.center_name} · {item.need}</div>
                <small>Запись: {String(item.when_day||'—')} {item.when_time||''}</small>
                <div className="case-detail-stage-dates">
                  <span>Приезд: {date(item.arrived_at)}</span>
                  <span>Готова: {date(item.ready_at)}</span>
                  <span>Закрыта: {date(item.closed_at)}</span>
                </div>
              </article>)}
            <h4>Предыдущие обращения по автомобилю</h4>
            {!detail.vehicle_history?.length?<p className="note">Другие записи по указанному автомобилю не найдены.</p>
              :detail.vehicle_history.map((v:any)=><a key={v.id} className="case-inspect-target" href={'#/order/'+v.id}>
                  Заказ №{v.number} · {SERVICES[v.service]?.name||v.service} · {date(v.created_at)} <span>›</span></a>)}
            {detail.vehicle_history_bookings?.map((b:any)=><a key={'history-booking-'+b.id} className="case-inspect-target" href={'#/booking/'+b.id}>
              СТО №{b.number} · {b.center_name||'Сервис'} · {date(b.created_at)} <span>›</span>
            </a>)}
          </>}
          {detail&&!focused&&tab==='timeline'&&<>
            <h4>Хронология этапов · подтверждённые события</h4>
            {!detail.events?.length?<p className="note">Событий пока нет.</p>
              :detail.events.map((e:any,i:number)=><div key={i} className="case-detail-event">
                <time>{date(e.created_at)}</time>
                <div><b>{action(e.type)}</b>
                  <small>Заказ {stages.find((s:any)=>s.id===e.order_id)?.number||'—'}</small></div>
              </div>)}
            <p className="note">Временные отметки берутся из журнала; пропущенные события не восстанавливаются предположительно.</p>
          </>}
          {detail&&!focused&&tab==='chat'&&<>
            <h4>Переписка по заявкам</h4>
            {!detail.chat?.length?<p className="note">Сообщений по этим заказам пока нет.</p>
              :detail.chat.map((m:any)=><div className="case-detail-message" key={m.id}>
                <div className="case-detail-between"><b>{m.sender_name}</b><small>{date(m.created_at)}</small></div>
                <p>{m.body}</p><small>Заказ №{stages.find((s:any)=>s.id===m.order_id)?.number||'—'}</small>
              </div>)}
            <p className="note">Ответ клиенту направляется через соответствующий защищённый чат заявки с сохранением прав доступа.</p>
          </>}
          {detail&&!focused&&tab==='finance'&&<>
            <h4>Фактические записи по расчётам</h4>
            <p className="case-detail-warning">{detail.document_status}</p>
            {stages.map((s:any)=><article className="case-detail-stage" key={s.id}>
              <b>Заказ №{s.number} · {SERVICES[s.service]?.name||s.service}</b>
              <div className="case-detail-between"><span>Подтверждённый выезд (если указан)</span><b>{cash(s.call_out_amount)}</b></div>
              <div className="case-detail-between"><span>Работы (если указаны)</span><b>{cash(s.work_amount)}</b></div>
              <div className="case-detail-between"><span>Скидка (если указана)</span><b>{cash(s.discount_amount)}</b></div>
            </article>)}
            {stages.map((s:any)=>s.recorded_items?.lines?.length>0&&<div key={'lines-'+s.id} className="case-detail-stage">
              <b>Позиции из расчёта мастера · №{s.number}</b>
              {s.recorded_items.lines.map((line:any,i:number)=><div className="case-detail-between" key={i}>
                <span>{line.description}</span><b>{cash(line.amount)}</b>
              </div>)}
              <small>{s.recorded_items.workVerified?'Сумма работ совпадает с записанным расчётом':'Расчёт требует сверки'}</small>
              {s.recorded_items.quoteOnly&&<small>Предложение не подтверждено как завершённая услуга</small>}
            </div>)}
            <button type="button" className="btn ghost small" disabled={exporting}
              onClick={downloadCsv}>{exporting?'Подготовка…':'Скачать операционную детализацию CSV'}</button>
            <h4>Выплаты исполнителям и комиссии</h4>
            {!detail.payouts?.length?<p className="note">Записей о выплатах пока нет.</p>
            :detail.payouts.map((p:any)=><article key={p.id} className="case-detail-stage">
              <div className="case-detail-between">
                <b>Заказ №{stages.find((s:any)=>s.id===p.order_id)?.number||'—'}</b>
                <span className="case-reg-chip">{p.status}</span>
              </div>
              <div className="case-detail-between"><span>Сумма в реестре выплат</span><b>{cash(p.amount)}</b></div>
              <div className="case-detail-between"><span>Комиссия по записи</span><b>{cash(p.commission)}</b></div>
              <small>Выплачено: {date(p.paid_at)} · Для налоговой базы требуется проверка договора и первичных документов</small>
            </article>)}
            <h4>Записи платёжной системы</h4>
            {!detail.payments?.length?<p className="note">Сопоставленных платежей нет.</p>
            :detail.payments.map((p:any)=><div className="case-detail-payment" key={p.id}>
              <span>Заказ №{stages.find((s:any)=>s.id===p.order_id)?.number||'—'} · {p.kind} · {p.status}</span>
              <b>{cash(p.total)}</b>
            </div>)}
            <p className="note">Построчные детали и отчёты агента появятся только после подтверждённых смет, деталей, первичных документов и фискальных чеков.</p>
          </>}
          {detail&&!focused&&tab==='moderation'&&<>
            <h4>Модерация и редакции</h4>
            {!detail.moderation?.length?<p className="note">Связанных случаев модерации нет. Административные действия смотри во вкладке «Журнал».</p>
              :detail.moderation.map((m:any)=><article className="case-detail-stage" key={m.id}>
                <div className="case-detail-between"><a className="case-inspect-text-link" href={'#/admin/case/'+m.id}>Случай №{m.number} · {m.title} ↗</a><span>{m.status}</span></div>
                <small>Открыт: {date(m.created_at)} · Решение: {m.decision||'ожидается'}</small>
                {m.decision_note&&<p>{m.decision_note}</p>}
              </article>)}
            <a className="case-detail-link" href="#/admin/section/queue">Перейти в очередь модерации</a>
          </>}
          {detail&&!focused&&tab==='notes'&&<>
            <h4>Комментарии и изменения администратора</h4>
            {!detail.notes?.length?<p className="note">Комментариев и зарегистрированных административных изменений пока нет.</p>
              :detail.notes.map((n:any)=><div className="case-detail-event" key={n.id}>
                <time>{date(n.created_at)}</time><div><b>{n.actor_name} · {n.action}</b>
                <small>{n.data?.comment||n.data?.reason||'Действие внесено в журнал'}</small>
                {n.data?.orderId&&<button type="button" className="case-inspect-text-link" onClick={()=>drill('order',n.data.orderId)}>К заказу ↗</button>}</div>
              </div>)}
            <label className="case-detail-note-label" htmlFor="case-admin-note">Добавить комментарий к обращению</label>
            <textarea id="case-admin-note" className="field" rows={4} maxLength={1500}
              value={comment} onChange={e=>setComment(e.target.value)}
              placeholder="Опишите ситуацию, основание действия или решение. Комментарий будет сохранён в журнале."/>
            <button type="button" className="btn" disabled={saving||comment.trim().length<5} onClick={save}>
              {saving?'Сохранение…':'Добавить в журнал'}
            </button>
            <p className="note">История не удаляется; изменение статуса или суммы выполняется только через разрешённое действие с обязательной причиной.</p>
          </>}
        </div>
        <footer className="case-detail-footer">
          <span>Просмотр фиксируется в журнале · данные защищены</span>
          <button type="button" className="btn ghost small" onClick={()=>setSelected(null)}>Закрыть и вернуться к реестру</button>
        </footer>
      </section>
    </div>}
  </div>;
}
