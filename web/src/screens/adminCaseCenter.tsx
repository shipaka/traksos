import { useEffect, useRef, useState } from 'react';
import { useMe } from '../ui.tsx';
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
  const { me } = useMe();
  const [q,setQ]=useState('');
  const [scope,setScope]=useState<Scope>('all');
  const [refresh,setRefresh]=useState(0);
  const [listState,setListState]=useState<{key:string;rows:any[]}|null>(null);
  const [listFailure,setListFailure]=useState<{key:string;message:string}|null>(null);
  const [selected,setSelected]=useState<string|null>(null);
  const [detailState,setDetailState]=useState<{key:string;value:any}|null>(null);
  const [detailFailure,setDetailFailure]=useState<{key:string;message:string}|null>(null);
  const [actionError,setActionError]=useState('');
  const [tab,setTab]=useState<DetailTab>('overview');
  const [focused,setFocused]=useState<FocusCard|null>(null);
  const [comment,setComment]=useState('');
  const [saving,setSaving]=useState(false);
  const [exporting,setExporting]=useState(false);
  const dialog=useRef<HTMLElement|null>(null);
  const opener=useRef<HTMLElement|null>(null);
  const savingRef=useRef(false);
  const exportingRef=useRef(false);
  const active=useRef<{id:string|null;owner:string|null}>({id:null,owner:null});
  active.current={id:selected,owner:me?.id??null};
  const listKey=JSON.stringify([me?.id??null,q,scope,refresh]);
  const detailKey=JSON.stringify([me?.id??null,selected,refresh]);
  // Only show data returned for this exact filter, owner and selected case.
  // Late calls can finish but cannot populate a new identity's workspace.
  const list=listState?.key===listKey&&!listFailure ? listState.rows : null;
  const listError=listFailure?.key===listKey?listFailure.message:'';
  const detail=detailState?.key===detailKey&&!detailFailure?detailState.value:null;
  const error=actionError||(detailFailure?.key===detailKey?detailFailure.message:'');
  useEffect(()=>{
    setSelected(null);setFocused(null);setComment('');setActionError('');
  },[me?.id]);
  useEffect(()=>{
    if(!me?.id)return;
    let live=true;
    const handle=window.setTimeout(()=>{
      void get('/api/admin/cases?q='+encodeURIComponent(q)+'&scope='+scope)
        .then((rows:any)=>{
          if(!live)return;
          if(!Array.isArray(rows))throw new Error('Сервер вернул неверный формат реестра');
          setListState({key:listKey,rows});setListFailure(null);
        }).catch((reason:any)=>{
          if(live)setListFailure({key:listKey,message:String(reason?.message||reason)});
        });
    },250);
    return ()=>{live=false;window.clearTimeout(handle);};
  },[me?.id,q,scope,listKey]);
  useEffect(()=>{
    if(!selected||!me?.id)return;
    let live=true;
    void get('/api/admin/cases/'+encodeURIComponent(selected))
      .then((value:any)=>{
        if(!live)return;
        if(!Array.isArray(value?.stages))throw new Error('Сервер вернул неполные сведения об обращении');
        setDetailState({key:detailKey,value});setDetailFailure(null);
      }).catch((reason:any)=>{
        if(live)setDetailFailure({key:detailKey,message:String(reason?.message||reason)});
      });
    return ()=>{live=false;};
  },[selected,me?.id,detailKey]);
  useEffect(()=>{
    if(selected)return;
    const focusBack=opener.current;
    opener.current=null;
    if(focusBack?.isConnected)focusBack.focus();
  },[selected]);
  useEffect(()=>{
    if(!selected)return;
    dialog.current?.focus();
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    const keydown=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){
        e.preventDefault();
        if(focused)setFocused(null); else close();
        return;
      }
      if(e.key!=='Tab'||!dialog.current)return;
      const all=Array.from(dialog.current.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'
      )).filter(x=>x.getBoundingClientRect().width>0);
      if(!all.length){e.preventDefault();dialog.current.focus();return;}
      const first=all[0],last=all[all.length-1];
      if(e.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){
        e.preventDefault();last.focus();
      }else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===dialog.current)){
        e.preventDefault();first.focus();
      }
    };
    document.addEventListener('keydown',keydown);
    return ()=>{document.removeEventListener('keydown',keydown);document.body.style.overflow=previousOverflow;};
  },[selected,focused]);
  const close=()=>{
    active.current={id:null,owner:me?.id??null};
    setFocused(null);setSelected(null);setActionError('');
  };
  const open=(id:string)=>{
    opener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    active.current={id,owner:me?.id??null};
    setTab('overview');setFocused(null);setComment('');setActionError('');
    setSelected(id);
  };
  const drill=(kind:FocusCard['kind'],id?:string|null)=>{
    if(id){setFocused({kind,id});dialog.current?.focus();}
  };
  const save=async()=>{
    if(!selected||!me?.id||comment.trim().length<5||comment.trim().length>1500||
       savingRef.current)return;
    const target=selected,owner=me.id;
    savingRef.current=true;setSaving(true);setActionError('');
    try{
      await post('/api/admin/cases/'+encodeURIComponent(target)+'/notes',
        {comment:comment.trim()});
      if(active.current.id!==target||active.current.owner!==owner)return;
      setComment('');setRefresh(x=>x+1);
    }catch(reason){
      if(active.current.id===target&&active.current.owner===owner)
        setActionError(reason instanceof Error?reason.message:'Не удалось сохранить комментарий');
    }finally{savingRef.current=false;setSaving(false);}
  };
  const downloadCsv=async()=>{
    if(!selected||!me?.id||exportingRef.current||!detail)return;
    const target=selected,owner=me.id;
    exportingRef.current=true;setExporting(true);setActionError('');
    try{
      const data=await get<{csv:string;filename:string}>(
        '/api/admin/cases/'+encodeURIComponent(target)+'/export');
      // An export for case A may finish after switching to case B or logging
      // out: never expose A's sensitive CSV under the new account.
      if(active.current.id!==target||active.current.owner!==owner)return;
      if(typeof data?.csv!=='string'||!data.csv.startsWith('\uFEFF'))
        throw new Error('Сервер вернул некорректную CSV-выгрузку');
      const blob=new Blob([data.csv],{type:'text/csv;charset=utf-8'});
      const url=URL.createObjectURL(blob);
      const link=document.createElement('a');
      const safeName=String(data.filename??'').replace(/[^a-zA-Z0-9_.-]/g,'_').slice(0,90);
      link.href=url;link.download=safeName.endsWith('.csv')?safeName:'traksos-case.csv';
      document.body.appendChild(link);link.click();link.remove();
      window.setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(reason){
      if(active.current.id===target&&active.current.owner===owner)
        setActionError(reason instanceof Error?reason.message:'Не удалось выгрузить CSV');
    }finally{exportingRef.current=false;setExporting(false);}
  };
  const stages=detail?.stages||[],bookings=detail?.bookings||[],ecuReferrals=detail?.ecu_referrals||[];
  const currentOrder=focused?.kind==='order'?stages.find((s:any)=>s.id===focused.id):null;
  const currentBooking=focused?.kind==='booking'?bookings.find((b:any)=>b.id===focused.id):null;
  const currentPerson=focused?.kind==='person'?stages.reduce((p:any,s:any)=>p??(
    s.client_id===focused.id?{id:s.client_id,name:s.client_name,role:'Клиент'}:
    s.performer_id===focused.id?{id:s.performer_id,name:s.performer_name,role:'Исполнитель'}:null),null):null;
  const segments=[...stages.map((s:any)=>({...s,source_kind:'order'})),
    ...bookings.map((b:any)=>({...b,source_kind:'booking'})),
    ...ecuReferrals.map((h:any)=>({...h,source_kind:'ecu'}))]
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
    {listError&&<div className="case-reg-error" role="alert">{listError}
      <button type="button" className="btn ghost small" onClick={()=>setRefresh(x=>x+1)}>
        Повторить загрузку реестра
      </button>
    </div>}
    {!list&&!listError?<p className="note" role="status">Загрузка реестра…</p>
      :!list.length?<p className="case-reg-empty">По выбранным условиям обращений не найдено.</p>
      :<div className="case-reg-list">{list.map(x=>
        <button type="button" className="case-reg-entry" key={x.id} onClick={()=>open(x.id)}
          aria-label={'Открыть '+(x.case_number||'заявку №'+x.number)}>
          <div className="case-reg-entry-main">
            <b>{x.case_number||'Заявка № '+x.number}</b>
            <small>{x.client_name||'Клиент'} · {x.vehicle_brand||'Автомобиль'} {x.vehicle_plate||''}</small>
          </div>
          <div className="case-reg-entry-meta">
            <span>{x.is_multi?'Этапов: '+(Number(x.order_count)+Number(x.workshop_count)+Number(x.ecu_count??0)):'Один заказ'}</span>
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
      <button type="button" className="case-detail-curtain" onClick={close}
        aria-label="Закрыть подробности заявки"/>
      <section ref={dialog} className="case-detail-window" role="dialog" aria-modal="true"
        aria-label="Подробности заявки" tabIndex={-1}>
        <header className="case-detail-header">
          <div>
            <span className="case-reg-kicker">ЦЕНТР УПРАВЛЕНИЯ ОБРАЩЕНИЕМ</span>
            <h3>{detail?.case_number||('Заявка № '+(stages[0]?.number??'…'))}</h3>
            <p>{detail?.multi?'Сборная мультизаявка · отдельные этапы и расчёты':'Одна заявка · история и контроль'}</p>
          </div>
          <button type="button" className="case-detail-close" onClick={close} aria-label="Закрыть окно">×</button>
        </header>
        <nav className="case-detail-tabs" aria-label="Разделы обращения">
          {tabs.map(x=><button key={x.id} type="button" className={tab===x.id?'active':''}
            aria-current={tab===x.id?'page':undefined} onClick={()=>{setFocused(null);setTab(x.id);}}>{x.name}</button>)}
        </nav>
        <div className="case-detail-body">
          {error&&<div className="case-reg-error" role="alert">{error}
            {detailFailure?.key===detailKey&&<button type="button" className="btn ghost small"
              onClick={()=>setRefresh(x=>x+1)}>Повторить загрузку обращения</button>}
          </div>}
          {!detail&&!error&&<p className="note" role="status">Загружаю историю обращения…</p>

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
                {currentBooking.center_id&&<a className="case-inspect-target" href={'#/services/'+currentBooking.center_id}>Открыть страницу СТО <span>›</span></a>}
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
              <div><span>Передач ЭБУ</span><b>{ecuReferrals.length}</b></div>
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
              </article>:item.source_kind==='ecu'?
              <article key={'ecu-'+item.id} className="case-detail-stage">
                <div className="case-detail-between">
                  <a className="case-inspect-text-link" href={'#/ecu-handoff/'+item.id}>
                    Этап {item.stage_no} · ЭБУ №{item.number} ↗</a>
                  <span className="case-reg-chip">{item.state==='pending'?'Ожидает предложений':item.state==='selected'?'Специалист выбран':'Закрыто'}</span>
                </div>
                <p>{item.summary}</p>
                <div>{item.selected_performer_id
                  ? <button className="case-inspect-text-link" onClick={()=>drill('person',item.selected_performer_id)}>
                    {item.selected_performer_name||'Специалист ЭБУ'} ↗</button>
                  : 'Исполнитель ЭБУ ещё не выбран'}</div>
                {item.diagnosis_price!=null && <small>Диагностика: {rub(Number(item.diagnosis_price))} · предложение версии {item.quote_version} (оплата отдельно)</small>}
                <div className="case-detail-stage-dates">
                  <span>Передано: {date(item.created_at)}</span>
                  <span>Согласовано: {date(item.selected_at)}</span>
                </div>
                <a className="case-detail-link" href={'#/ecu-handoff/'+item.id}>Открыть техническую историю</a>
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
                  {stages.some((s:any)=>s.id===e.order_id)
                    ?<button type="button" className="case-inspect-text-link" onClick={()=>drill('order',e.order_id)}>
                      Заказ №{stages.find((s:any)=>s.id===e.order_id)?.number} ↗</button>
                    :<small>Заказ не определён</small>}</div>
              </div>)}
            <p className="note">Временные отметки берутся из журнала; пропущенные события не восстанавливаются предположительно.</p>
          </>}
          {detail&&!focused&&tab==='chat'&&<>
            <h4>Переписка по заявкам</h4>
            {!detail.chat?.length?<p className="note">Сообщений по этим заказам пока нет.</p>
              :detail.chat.map((m:any)=><div className="case-detail-message" key={m.id}>
                <div className="case-detail-between"><b>{m.sender_name}</b><small>{date(m.created_at)}</small></div>
                <p>{m.body}</p>
                <button type="button" className="case-inspect-text-link" onClick={()=>drill('order',m.order_id)}>
                  Заказ №{stages.find((s:any)=>s.id===m.order_id)?.number||'—'} ↗</button>
              </div>)}
            <p className="note">Ответ клиенту направляется через соответствующий защищённый чат заявки с сохранением прав доступа.</p>
          </>}
          {detail&&!focused&&tab==='finance'&&<>
            <h4>Фактические записи по расчётам</h4>
            <p className="case-detail-warning">{detail.document_status}</p>
            {stages.map((s:any)=><article className="case-detail-stage" key={s.id}>
              <button type="button" className="case-inspect-text-link" onClick={()=>drill('order',s.id)}>
                Заказ №{s.number} · {SERVICES[s.service]?.name||s.service} ↗</button>
              <div className="case-detail-between"><span>Подтверждённый выезд (если указан)</span><b>{cash(s.call_out_amount)}</b></div>
              <div className="case-detail-between"><span>Работы (если указаны)</span><b>{cash(s.work_amount)}</b></div>
              <div className="case-detail-between"><span>Скидка (если указана)</span><b>{cash(s.discount_amount)}</b></div>
            </article>)}
            {stages.map((s:any)=>s.recorded_items?.lines?.length>0&&<div key={'lines-'+s.id} className="case-detail-stage">
              <button type="button" className="case-inspect-text-link" onClick={()=>drill('order',s.id)}>
                Позиции мастера · заказ №{s.number} ↗</button>
              {s.recorded_items.lines.map((line:any,i:number)=><div className="case-detail-between" key={i}>
                <span>{line.description}</span><b>{cash(line.amount)}</b>
              </div>)}
              <small>{s.recorded_items.workVerified?'Сумма работ совпадает с записанным расчётом':'Расчёт требует сверки'}</small>
              {s.recorded_items.quoteOnly&&<small>Предложение не подтверждено как завершённая услуга</small>}
            </div>)}
            <button type="button" className="btn ghost small" disabled={exporting}
              onClick={()=>void downloadCsv()}>{exporting?'Подготовка…':'Скачать операционную детализацию CSV'}</button>
            <h4>Выплаты исполнителям и комиссии</h4>
            {!detail.payouts?.length?<p className="note">Записей о выплатах пока нет.</p>
            :detail.payouts.map((p:any)=><article key={p.id} className="case-detail-stage">
              <div className="case-detail-between">
                <button type="button" className="case-inspect-text-link" onClick={()=>drill('order',p.order_id)}>
                  Заказ №{stages.find((s:any)=>s.id===p.order_id)?.number||'—'} ↗</button>
                <span className="case-reg-chip">{p.status}</span>
              </div>
              <div className="case-detail-between"><span>Сумма в реестре выплат</span><b>{cash(p.amount)}</b></div>
              <div className="case-detail-between"><span>Комиссия по записи</span><b>{cash(p.commission)}</b></div>
              <small>Выплачено: {date(p.paid_at)} · Для налоговой базы требуется проверка договора и первичных документов</small>
            </article>)}
            <h4>Записи платёжной системы</h4>
            {!detail.payments?.length?<p className="note">Сопоставленных платежей нет.</p>
            :detail.payments.map((p:any)=><div className="case-detail-payment" key={p.id}>
              <button type="button" className="case-inspect-text-link" onClick={()=>drill('order',p.order_id)}>
                Заказ №{stages.find((s:any)=>s.id===p.order_id)?.number||'—'} · {p.kind} · {p.status} ↗</button>
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
                {n.actor_id&&<a className="case-inspect-text-link" href={'#/admin/user/'+n.actor_id}>Профиль автора ↗</a>}
                <small>{n.data?.comment||n.data?.reason||'Действие внесено в журнал'}</small>
                {n.data?.orderId&&<button type="button" className="case-inspect-text-link" onClick={()=>drill('order',n.data.orderId)}>К заказу ↗</button>}</div>
              </div>)}
            <label className="case-detail-note-label" htmlFor="case-admin-note">Добавить комментарий к обращению</label>
            <textarea id="case-admin-note" className="field" rows={4} maxLength={1500}
              value={comment} disabled={saving} onChange={e=>setComment(e.target.value)}
              placeholder="Опишите ситуацию, основание действия или решение. Комментарий будет сохранён в журнале."/>
            <button type="button" className="btn" disabled={saving||comment.trim().length<5} onClick={()=>void save()}>
              {saving?'Сохранение…':'Добавить в журнал'}
            </button>
            <p className="note">История не удаляется; изменение статуса или суммы выполняется только через разрешённое действие с обязательной причиной.</p>
          </>}
        </div>
        <footer className="case-detail-footer">
          <span>Просмотр фиксируется в журнале · данные защищены</span>
          <button type="button" className="btn ghost small" onClick={close}>Закрыть и вернуться к реестру</button>
        </footer>
      </section>
    </div>}
  </div>;
}
