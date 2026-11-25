// Кабинет партнёра-страховщика: только назначенные администратором страховые заявки.
import { useEffect, useRef, useState } from 'react';
import { get, patch, fmtTime, onEvent } from '../api.ts';
import { useAction, useMe, useRoute } from '../ui.tsx';
import { insurancePresentation, insuranceQueueGroup } from '../insurancePresentation.ts';

const labels: Record<string, string> = {
  sent_to_partner: 'Ждёт оформления', completed: 'Полис оформлен', rejected: 'Отказ',
};

type PartnerResource<T>={scope:string;data:T|null;error:string;loading:boolean};
type InspectionPage={items:any[];active:number;history:number;page:number;pageSize:number};

/** Partner documents and finance must never survive an account/role switch.
 * A late HTTP response from the previous session is explicitly discarded.
 * Failed reads replace, rather than reuse, an older privileged result. */
function usePartnerResource<T>(path:string,scope:string,enabled=true,live=false) {
  const [version,setVersion]=useState(0);
  const [state,setState]=useState<PartnerResource<T>>({
    scope:'',data:null,error:'',loading:true,
  });
  const serial=useRef(0);
  const scopeRef=useRef(scope);
  scopeRef.current=scope;
  const reload=()=>setVersion(n=>n+1);
  useEffect(()=>{
    const request=++serial.current;
    const currentScope=scope;
    setState({scope:currentScope,data:null,error:'',loading:enabled});
    if(!enabled)return ()=>{serial.current++;};
    get<T>(path).then(data=>{
      if(serial.current!==request||scopeRef.current!==currentScope)return;
      if(data==null || (path==='/api/insurer/finance'
          ? !(Array.isArray((data as any).entries)&&Array.isArray((data as any).totals))
          : path.startsWith('/api/insurer/inspections/page?')
            ? !(Array.isArray((data as any).items)&&['active','history','page','pageSize'].every(key=>
                Number.isSafeInteger((data as any)[key])&&(data as any)[key]>=0)
                &&(data as any).page>=1&&(data as any).pageSize>=1)
            : path.startsWith('/api/insurer/inspections/')
              ? !((data as any).kind==='inspection'&&String((data as any).id)===decodeURIComponent(path.split('/').at(-1)??''))
              : !Array.isArray(data)))
        throw new Error('Некорректный ответ от сервера');
      setState({scope:currentScope,data,error:'',loading:false});
    }).catch(e=>{
      if(serial.current!==request||scopeRef.current!==currentScope)return;
      setState({scope:currentScope,data:null,
        error:e instanceof Error?e.message:'Не удалось получить сведения',loading:false});
    });
    return ()=>{serial.current++;};
  },[path,scope,enabled,version]);
  useEffect(()=>{
    if(!live||!enabled)return;
    return onEvent(e=>{
      if(e.type==='vehicle_service'||e.type==='connection_restored')reload();
    });
  },[live,enabled,scope]);
  const current=state.scope===scope?state:null;
  return {data:enabled?current?.data??null:null,error:enabled?current?.error??'':'',
    loading:enabled?current?.loading??true:false,reload};
}

function futureDate(value:string):boolean {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const day=new Date(value+'T00:00:00Z');
  return Number.isFinite(day.getTime())&&day.toISOString().slice(0,10)===value
    &&value>new Date().toISOString().slice(0,10);
}
/** Chat entry always resolves to a real assigned insurance case, never a
 * generic or cross-partner inbox. The thread owns messages and permissions. */
export function InsurerChats() {
  const {me}=useMe();
  const allowed=!!me?.roles.includes('insurer');
  const q=usePartnerResource<any[]>('/api/insurer/requests',
    (me?.id??'signed-out')+':insurer-chats',allowed,true);
  const chats=Array.isArray(q.data)?q.data:null;
  return <main className="and19-chats and19-workspace and20-insurer-chats">
    <h1>Чаты по страховым делам</h1>
    <p>Уточнения и документы хранятся внутри соответствующей заявки.</p>
    {!chats&&<div className="and19-panel" role={q.error?'alert':'status'}>{q.error
      ? <>Не удалось открыть переписку: {q.error}
        <button type="button" className="btn ghost small" onClick={q.reload}>Повторить загрузку чатов</button></>
      : allowed?'Загружаем назначенные дела…':'Страховые дела доступны назначенному страховому партнёру.'}</div>}
    {chats?.length===0&&<div className="and19-panel">Назначенных страховых дел пока нет.</div>}
    {chats?.map(r=><a className="and19-row-link" key={r.id}
      href={'#/insurance/request/'+encodeURIComponent(r.id)}>
      <span>{[r.brand,r.model].filter(Boolean).join(' ') || 'Страховое дело'}
        <small>{insurancePresentation(r.insurance_stage,r.status,'partner').label}</small>
      </span>
      <span>Чат ›</span>
    </a>)}
  </main>;
}

export function InsurerCabinet({inspectionOnly=false}:{inspectionOnly?:boolean}={}) {
  const { me,mode } = useMe();
  const dualPartnerRole = !!me?.roles.includes('insurer') && !!me?.roles.includes('inspection_operator');
  const [workspace,setWorkspace]=useState<'insurance'|'inspection'|'finance'|'common'>(inspectionOnly?'inspection':'insurance');
  const route = useRoute();
  // "processing" is the list view, never an inspection ID. Individual IDs
  // must open their own server-scoped case detail on desktop and mobile.
  const inspectionId = inspectionOnly && route[0]==='inspections' && route[1]!=='processing' ? route[1] : undefined;
  const [checkedSteps,setCheckedSteps] = useState<Record<string,boolean>>({});
  const canInsure=!!me?.roles.includes('insurer');
  const canInspect=!!me?.roles.some(role=>role==='insurer'||role==='inspection_operator');
  const identity=me?.id??'signed-out';
  const accessScope=identity+':'+mode+':'+(inspectionOnly?'inspection':'insurance');
  const identityRef=useRef(accessScope);
  identityRef.current=accessScope;
  const finance=usePartnerResource<{entries:{id:string;kind:string;entry_type:string;amount_kopecks:string;note:string|null;created_at:string}[];totals:{kind:string;accrued:string;paid:string;balance:string}[]}>(
    '/api/insurer/finance',accessScope+':finance',canInspect,true);
  // PostgreSQL monetary counters are text integers in kopecks. Avoid losing
  // precision or printing "NaN ₽" for missing/malformed backend totals.
  const money=(value:string|number|bigint|undefined|null)=>{
    const literal=String(value??'');
    if(!/^-?\d+$/.test(literal))return '—';
    const cents=BigInt(literal),negative=cents<0n,abs=negative?-cents:cents;
    const rubles=new Intl.NumberFormat('ru-RU').format(abs/100n);
    return (negative?'−':'')+rubles+','+String(abs%100n).padStart(2,'0')+' ₽';
  };
  const [inspectionView,setInspectionView]=useState<'active'|'history'>('active');
  const [inspectionPageNumber,setInspectionPageNumber]=useState(1);
  const inspections=usePartnerResource<InspectionPage>(
    '/api/insurer/inspections/page?view='+inspectionView+'&page='+inspectionPageNumber,
    accessScope+':inspections:'+inspectionView+':'+inspectionPageNumber,canInspect,true);
  const inspectionDetail=usePartnerResource<any>(
    '/api/insurer/inspections/'+encodeURIComponent(inspectionId??''),
    accessScope+':inspection-detail:'+inspectionId,canInspect&&!!inspectionId,true);
  const requests=usePartnerResource<any[]>('/api/insurer/requests',
    accessScope+':requests',!inspectionOnly&&canInsure,true);
  const { busy, run } = useAction();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [inspectionNotes,setInspectionNotes]=useState<Record<string,string>>({});
  const [expires, setExpires] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<'action' | 'active' | 'all' | 'closed'>(
    route[1]==='requests' ? 'all' : 'action');
  const [search, setSearch] = useState('');
  const [actionError,setActionError]=useState('');
  const decisionLock=useRef(false);
  const [unconfirmed,setUnconfirmed]=useState(false);
  const [draftScope,setDraftScope]=useState('');
  const currentDraft=draftScope===accessScope;
  useEffect(()=>{
    // This may be the same mounted component with a different login or a
    // switched insurer/inspection workspace. Reset all case-specific input.
    setDraftScope(accessScope);setCheckedSteps({});setNotes({});
    setInspectionNotes({});setExpires({});setActionError('');setUnconfirmed(false);
    setSearch('');setInspectionView('active');setInspectionPageNumber(1);
    setWorkspace(inspectionOnly?'inspection':'insurance');
    setFilter(route[1]==='requests'?'all':'action');
  },[accessScope]);
  async function update(id: string, status: 'completed' | 'rejected') {
    if(decisionLock.current||busy||unconfirmed||!currentDraft||!canInsure||!requests.data)return;
    const startedAs=accessScope;
    const note = (currentDraft?(notes[id]??''):'').trim();
    const policyExpiresOn = currentDraft?expires[id]:undefined;
    if (status === 'rejected' && !note) {
      setActionError('Укажите причину отказа — клиент должен её видеть.');
      return;
    }
    if(status==='completed'&&!futureDate(policyExpiresOn??'')){
      setActionError('Укажите корректную будущую дату окончания полиса.');
      return;
    }
    if(inspectionOnly)return;
    setActionError('');
    decisionLock.current=true;
    const result = await run(() => patch(`/api/insurer/requests/${id}`, {
      status, note: note || undefined,
      policyExpiresOn: status === 'completed' ? policyExpiresOn : undefined,
    }), 'Заявка обновлена').finally(()=>{decisionLock.current=false;});
    if(identityRef.current!==startedAs)return;
    if(result){
      setNotes(old=>{const value={...old};delete value[id];return value;});
      setExpires(old=>{const value={...old};delete value[id];return value;});
      requests.reload();
    }else {setUnconfirmed(true);setActionError('Изменение заявки не подтверждено. Обновите очередь перед повторной отправкой.');}
  }
  async function decideInspection(id:string,status:'completed'|'rejected') {
    const assignedCase=inspectionId
      ? (inspectionDetail.data?.id===id?inspectionDetail.data:null)
      : inspections.data?.items.find(r=>r.id===id);
    if(decisionLock.current||busy||unconfirmed||!currentDraft||!canInspect||assignedCase?.status!=='sent_to_partner')return;
    if(status==='completed'&&!['documents','vehicle','result'].every(k=>checkedSteps[id+':'+k]))return;
    const startedAs=accessScope;
    const note=(currentDraft?(inspectionNotes[id]??''):'').trim();
    if(status==='rejected'&&!note){setActionError('Укажите причину отказа.');return;}
    if(status==='completed'&&note.length<5){
      setActionError('Укажите фактический результат осмотра (не менее 5 символов).');return;
    }
    setActionError('');
    decisionLock.current=true;
    const result=await run(()=>patch('/api/insurer/inspections/'+id,{status,note:note||undefined}),
      status==='completed'?'Техосмотр отмечен выполненным':'Заявка отклонена').finally(()=>{decisionLock.current=false;});
    if(identityRef.current!==startedAs)return;
    if(result){
      setCheckedSteps(old=>Object.fromEntries(Object.entries(old).filter(([key])=>!key.startsWith(id+':'))));
      setInspectionNotes(old=>{const values={...old};delete values[id];return values;});
      inspections.reload();
      if(inspectionId)inspectionDetail.reload();
    }else {setUnconfirmed(true);setActionError('Решение по техосмотру не подтверждено. Обновите очередь перед повторной отправкой.');}
  }
  const rows: any[] | undefined = Array.isArray(requests.data)?requests.data:undefined;
  const inspectionRows=inspections.data?.items??null;
  const financeData=finance.data;
  const visible = (rows ?? []).filter((r) => {
    if (filter !== 'all' && insuranceQueueGroup(r.insurance_stage, r.status) !== filter) return false;
    return [r.brand, r.model, r.plate, r.comment].some((value) => String(value ?? '').toLocaleLowerCase('ru-RU').includes(search.trim().toLocaleLowerCase('ru-RU')));
  });
  // Separate approved inspection detail: available only to the assigned operator.
  // The detail endpoint independently authorizes the assigned operator, even
  // when the request is not present on the currently visible queue page.
  if(inspectionId) {
    const item = inspectionDetail.data;
    if(!item) return <main className="cabinet-page and20-inspection-detail">
      <a href="#/inspections" className="and20-return">← К техосмотрам</a>
      <div className="card" role={inspectionDetail.error?'alert':'status'}>{inspectionDetail.error
        ? <>Не удалось загрузить техосмотр: {inspectionDetail.error}
          <button type="button" className="btn ghost small" onClick={inspectionDetail.reload}>Повторить загрузку</button></>
        : 'Загрузка назначенного техосмотра…'}</div>
    </main>;
    const canRecord = item.status==='sent_to_partner';
    const verified = currentDraft&&['documents','vehicle','result'].every(k=>checkedSteps[inspectionId+':'+k]===true);
    const note=(currentDraft?(inspectionNotes[inspectionId]??''):'').trim();
    return <main className="cabinet-page and20-inspection-detail">
      <a href="#/inspections" className="and20-return">← К техосмотрам</a>
      <section className="and20-role-header">
        <span className="and20-kicker">TRAKSOS · ТЕХОСМОТР</span>
        <h1>Техосмотр №{item.number||item.id}</h1>
        <span className="and20-state">{item.status==='completed'?'Завершён':
          item.status==='rejected'?'Отказ':'Назначен оператору'}</span>
      </section>
      <section className="card and20-inspection-vehicle">
        <strong>{[item.brand,item.model,item.year].filter(Boolean).join(' ') || 'Транспортное средство'}</strong>
        <span>{item.plate||'Госномер не указан'}</span>
        {item.vin&&<span>VIN: {item.vin}</span>}
        {item.comment&&<p>{item.comment}</p>}
      </section>
      <div className="and20-inspection-stages" aria-label="Ход техосмотра">
        {['Получено','Назначено','Осмотр','Завершено'].map((step,index)=>
          <span key={step} className={item.status==='completed'?'passed':index===1?'current':''}>{step}</span>)}
      </div>
      {canRecord ? <section className="card and20-inspection-checks">
        <h2>Этапы работы</h2>
        <p className="note">Отметьте только реально выполненные действия. TrakSOS не выдаёт диагностическую карту.</p>
        {([
          ['documents','Проверка документов'],
          ['vehicle','Осмотр транспортного средства'],
          ['result','Результат проверки'],
        ] as const).map(([key,label])=><label key={key} className="and20-inspection-check">
          <input type="checkbox" checked={currentDraft&&checkedSteps[inspectionId+':'+key]===true}
            onChange={e=>setCheckedSteps(old=>({...old,[inspectionId+':'+key]:e.target.checked}))}/>
          <span>{label}</span>
        </label>)}
        <label className="and20-inspection-note">Комментарий / результат осмотра
          <textarea className="field" maxLength={2000} value={currentDraft?(inspectionNotes[inspectionId]||''):''}
            placeholder="Фактические результаты проверки"
            onChange={e=>setInspectionNotes(old=>({...old,[inspectionId]:e.target.value}))}/>
        </label>
        {actionError&&<div className="banner warn" role="alert">{actionError}</div>}
        {unconfirmed&&<div className="row"><button type="button" className="btn ghost small" onClick={inspectionDetail.reload}>Обновить очередь для сверки</button><button type="button" className="btn ghost small" disabled={inspectionDetail.loading||!!inspectionDetail.error||!inspectionDetail.data} onClick={()=>setUnconfirmed(false)}>Состояние проверено</button></div>}
        <button type="button" className="btn" disabled={busy||unconfirmed||!verified||note.length<5}
          onClick={()=>decideInspection(inspectionId,'completed')}>Внести результат техосмотра</button>
        <button type="button" className="btn ghost" disabled={busy||unconfirmed||note.length<5}
          onClick={()=>decideInspection(inspectionId,'rejected')}>Отказать с указанием причины</button>
        <p className="note">Завершение заявки в TrakSOS не означает выдачу диагностической карты. Её оформляют отдельно в уполномоченной системе.</p>
      </section> : <section className="card">
        <strong>{item.status==='completed'?'Заявка завершена':'Осмотр не активен'}</strong>
        {item.staff_note&&<p>{item.staff_note}</p>}
      </section>}
    </main>;
  }
  const insurerPriority = (rows??[]).find(r=>insuranceQueueGroup(r.insurance_stage,r.status)==='action')
    ??(rows??[]).find(r=>insuranceQueueGroup(r.insurance_stage,r.status)==='active');
  return (
    <main className="cabinet-page">
      <header className="cabinet-heading">
        <span className="label">TRAKSOS · Партнёрский кабинет</span>
        <h1>{workspace==='insurance'?'Страхование':workspace==='inspection'?'Техосмотры':workspace==='finance'?'Финансы':'Общие настройки'}</h1>
      </header>
      <nav className="partner-workspaces" aria-label="Разделы кабинета партнёра">
        {([['insurance','Страховки'],['inspection','Техосмотры'],['finance','Финансы'],['common','Общее']] as const)
          .filter(([key])=>(!inspectionOnly||key!=='insurance') && !(dualPartnerRole && (key==='insurance'||key==='inspection')))
          .map(([key,label])=><button type="button" key={key} className={'btn ghost'+(workspace===key?' active':'')}
            aria-pressed={workspace===key} onClick={()=>setWorkspace(key)}>{label}</button>)}
      </nav>
      {workspace==='insurance'&&!inspectionOnly&&<section className="and20-insurer-overview"
        aria-label="Оперативный страховой кабинет">
        <div className="and20-role-header">
          <span className="and20-kicker">TRAKSOS · СТРАХОВОЙ ПАРТНЁР</span>
          <h2>Рабочий стол</h2>
        </div>
        <div className="and20-partner-stats">
          {([
            ['Новые',rows?.filter(r=>r.insurance_stage==='received'||r.status==='sent_to_partner').length],
            ['В расчёте',rows?.filter(r=>r.insurance_stage==='preparing').length],
            ['Отправлены',rows?.filter(r=>r.insurance_stage==='offers_sent').length],
            ['Оформлены',rows?.filter(r=>r.insurance_stage==='policy_sent'||r.status==='completed').length],
          ] as [string,number|undefined][]).map(([label,value])=><div key={label} className="and20-partner-stat">
            <small>{label}</small><strong>{value??'—'}</strong>
          </div>)}
        </div>
        {insurerPriority&&<a className="and20-insurer-focus" href={'#/insurance/request/'+encodeURIComponent(insurerPriority.id)}>
          <span className="and20-card-heading">Заявка · {insurerPriority.brand||'Грузовой автомобиль'} {insurerPriority.model||''}</span>
          <span className="and20-state">{insurancePresentation(insurerPriority.insurance_stage,insurerPriority.status,'partner').label}</span>
          <span className="and20-small-text">{insurancePresentation(insurerPriority.insurance_stage,insurerPriority.status,'partner').next}</span>
          <b>Открыть страховое дело ›</b>
        </a>}
      </section>}
      {workspace==='inspection'&&<section className="stack">
        <p className="sub">Здесь отображаются исключительно назначенные вам заявки на техосмотр. Страховые полисы и предложения в этом разделе не показываются.</p>
        <div className="cabinet-metrics">
          <div className="card tile"><span className="label">Заявок на техосмотр</span><b className="tile-value">{inspections.data?inspections.data.active+inspections.data.history:'—'}</b></div>
          <div className="card tile"><span className="label">В работе</span><b className="tile-value">{inspections.data?.active??'—'}</b></div>
          <div className="card tile"><span className="label">История</span><b className="tile-value">{inspections.data?.history??'—'}</b></div>
        </div>
        <div className="row" role="group" aria-label="Показ техосмотров">
          <button type="button" className="chip" aria-pressed={inspectionView==='active'} onClick={()=>{setInspectionView('active');setInspectionPageNumber(1);}}>В работе</button>
          <button type="button" className="chip" aria-pressed={inspectionView==='history'} onClick={()=>{setInspectionView('history');setInspectionPageNumber(1);}}>История техосмотров</button>
          <button type="button" className="btn ghost small" onClick={inspections.reload}>Обновить</button>
        </div>
        {actionError&&<div className="banner warn" role="alert">{actionError}</div>}
        {unconfirmed&&<div className="row"><button type="button" className="btn ghost small" onClick={()=>{requests.reload();inspections.reload();}}>Обновить очередь для сверки</button><button type="button" className="btn ghost small" disabled={requests.loading||inspections.loading||!!requests.error||!!inspections.error} onClick={()=>setUnconfirmed(false)}>Состояние проверено</button></div>}
        {!inspectionRows?<div className="empty" role={inspections.error?'alert':'status'}>{inspections.error?
            <>Не удалось загрузить техосмотры: {inspections.error}
              <button type="button" className="btn ghost small" onClick={inspections.reload}>Повторить загрузку техосмотров</button></>
            :'Загружаем техосмотры…'}</div>:
          inspectionRows.length===0?(inspections.data!.active+inspections.data!.history===0
            ?<div className="card stack"><h2>Техосмотров пока нет</h2><p>Здесь появятся назначенные заявки и история. Оформление диагностической карты будет добавлено отдельно.</p><button type="button" className="btn ghost" onClick={inspections.reload}>Обновить</button></div>
            :<div className="empty">{inspectionPageNumber>1?'На этой странице заявок нет':inspectionView==='history'?'История техосмотров пока пуста':'Активных техосмотров сейчас нет'}</div>)
          : inspectionRows.map(r=><article className="card stack" key={r.id}>
            <b>{r.brand} {r.model}</b><span>{r.plate||'Номер не указан'} · {fmtTime(r.created_at)}</span>
            <a className="btn" href={'#/inspections/'+encodeURIComponent(r.id)}>Открыть техосмотр и этапы →</a>
            <span className="pill">{r.status==='completed'?'Завершён':r.status==='rejected'?'Отклонён':'В обработке'}</span>
            {r.comment&&<p>{r.comment}</p>}{r.staff_note&&<p className="note">{r.staff_note}</p>}
            {r.status==='sent_to_partner'&&<>
              <label className="stack"><span className="label">Комментарий или причина отказа</span>
                <textarea className="field" maxLength={2000} value={currentDraft?(inspectionNotes[r.id]??''):''}
                  onChange={e=>setInspectionNotes(v=>({...v,[r.id]:e.target.value}))}/></label>
              <div className="row">
                <button type="button" className="btn ghost small" disabled={busy||unconfirmed||!currentDraft}
                  onClick={()=>decideInspection(r.id,'rejected')}>Отказать</button>
              </div>
              <p className="note">Отметка выполнения не является выдачей диагностической карты.</p>
            </>}
          </article>)}
        {inspections.data&&(inspectionPageNumber>1||inspections.data[inspectionView]>inspections.data.pageSize)&&
          <div className="row" role="group" aria-label="Страницы техосмотров">
            <button type="button" className="btn ghost small" disabled={inspectionPageNumber<=1||busy}
              onClick={()=>setInspectionPageNumber(p=>Math.max(1,p-1))}>Предыдущая страница</button>
            <span className="note">Страница {inspectionPageNumber} из {Math.max(inspectionPageNumber,Math.ceil(inspections.data[inspectionView]/inspections.data.pageSize))}</span>
            <button type="button" className="btn ghost small" disabled={busy||inspectionPageNumber*inspections.data.pageSize>=inspections.data[inspectionView]}
              onClick={()=>setInspectionPageNumber(p=>p+1)}>Следующая страница</button>
          </div>}
        <p className="note">Назначение выполняет администратор. Выполнение заявки фиксируется отдельно от выдачи диагностической карты.</p>
      </section>}
      {workspace==='finance'&&<section className="stack">
        <p className="sub">Подтверждённые финансовые проводки по двум направлениям. Заявки без начислений не считаются доходом.</p>
        {!financeData?<div className="empty" role={finance.error?'alert':'status'}>{finance.error
          ? <>Не удалось загрузить финансы: {finance.error}
            <button type="button" className="btn ghost small" onClick={finance.reload}>Повторить загрузку финансов</button></>
          : 'Загружаем финансовый реестр…'}</div>:<>
          <div className="cabinet-metrics">
            {(['insurance','inspection'] as const).map(kind=>{
              const total=financeData.totals.find(t=>t.kind===kind);
              return <div className="card tile" key={kind}>
                <span className="label">{kind==='insurance'?'Страхование':'Техосмотры'}</span>
                <b className="tile-value">{money(total?.balance)}</b>
                <small>Начислено: {money(total?.accrued)} · Выплачено: {money(total?.paid)}</small>
              </div>;
            })}
            <div className="card tile"><span className="label">Общий остаток</span>
              <b className="tile-value">{financeData.totals.every(t=>/^-?\d+$/.test(String(t.balance)))?
                  money(financeData.totals.reduce((sum,t)=>sum+BigInt(t.balance),0n)):'—'}</b>
              <small>По всем подтверждённым проводкам</small>
            </div>
          </div>
          <h2>История операций</h2>
          {financeData.entries.length===0?<div className="empty">Подтверждённых операций пока нет.</div>:
            financeData.entries.map(entry=><article className="card between" key={entry.id}>
              <div className="stack"><b>{entry.kind==='insurance'?'Страхование':'Техосмотр'} · {entry.entry_type==='accrual'?'Начисление':entry.entry_type==='payout'?'Выплата':'Корректировка'}</b>
                <small>{fmtTime(entry.created_at)}</small>{entry.note&&<small>{entry.note}</small>}</div>
              <b>{entry.entry_type==='accrual'?'+':'−'}{money(entry.amount_kopecks)}</b>
            </article>)}
        </>}
      </section>}
      {workspace==='common'&&<section className="card stack">
        <h2>Общие разделы партнёра</h2>
        <a className="linkrow" href="#/profile">Профиль и настройки</a>
        <a className="linkrow" href="#/help">Помощь и инструкции</a>
        <a className="linkrow" href="#/offer/privacy">Обработка персональных данных</a>
      </section>}
      {workspace==='insurance'&&!inspectionOnly&&<>
      <div className="sub">Только страховые заявки, переданные вам TrakSOS. Остальные автомобили и сведения о клиентах недоступны.</div>
      {!rows ? <div className="empty" role={requests.error?'alert':'status'}>{requests.error
        ? <>Не удалось загрузить страховые дела: {requests.error}
          <button type="button" className="btn ghost small" onClick={requests.reload}>
            Повторить загрузку заявок
          </button></>
        : 'Загружаем заявки…'}</div>
        : !rows.length ? <InsurerEmptyState onRefresh={requests.reload} />
        : <div className="stack">
          <div className="cabinet-metrics insurer-insurance-metrics">
            <div className="card tile"><span className="label">Всего назначено</span><b className="tile-value">{rows.length}</b></div>
            <div className="card tile"><span className="label">Требуют действий</span><b className="tile-value">{rows.filter((r) => insuranceQueueGroup(r.insurance_stage,r.status)==='action').length}</b></div>
            <div className="card tile"><span className="label">В работе</span><b className="tile-value">{rows.filter((r) => insuranceQueueGroup(r.insurance_stage,r.status)==='active').length}</b></div>
            <div className="card tile"><span className="label">Закрыто</span><b className="tile-value">{rows.filter((r) => insuranceQueueGroup(r.insurance_stage,r.status)==='closed').length}</b></div>
          </div>
          <div className="web-case-toolbar">
            <div className="row" role="group" aria-label="Фильтр страховых заявок">
              {([['action', 'Требуют действий'], ['active', 'В работе'], ['all', 'Все'], ['closed', 'Закрытые']] as const).map(([key, title]) => (
                <button key={key} type="button" className="chip" aria-pressed={filter === key} onClick={() => setFilter(key)}>{title}</button>
              ))}
            </div>
            <label className="stack">
              <span className="label">Найти автомобиль</span>
              <input className="field" type="search" placeholder="Марка, модель или госномер"
                value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
          </div>
          {actionError&&<div className="banner warn" role="alert">{actionError}</div>}
        {unconfirmed&&<div className="row"><button type="button" className="btn ghost small" onClick={()=>{requests.reload();inspections.reload();}}>Обновить очередь для сверки</button><button type="button" className="btn ghost small" disabled={requests.loading||inspections.loading||!!requests.error||!!inspections.error} onClick={()=>setUnconfirmed(false)}>Состояние проверено</button></div>}
          <span className="label">Показано заявок: {visible.length}</span>
          {!visible.length && <div className="empty">{filter==='action'?'Нет заявок, требующих действий. Новые обращения появятся здесь.':filter==='active'?'Нет заявок в работе.':'По выбранным фильтрам заявок нет.'}</div>}
          <div className="web-insurance-grid">
          {visible.map((r) => {
            const state=insurancePresentation(r.insurance_stage,r.status,'partner');
            return <details key={r.id} className={'card insurer-case-card tone-'+state.tone}>
              <summary className="insurer-case-summary">
                <span className="insurer-case-summary-main">
                  <span className="insurance-step-title">СТРАХОВОЕ ДЕЛО · {r.plate || 'БЕЗ НОМЕРА'}</span>
                  <strong>{r.brand} {r.model ?? ''}</strong>
                  <span className="insurer-case-next">{state.next}</span>
                  <small>Поступила {fmtTime(r.created_at)} · нажмите для подробностей</small>
                </span>
                <span className={'insurer-case-state tone-'+state.tone}>
                  <span className="insurer-case-state-dot" aria-hidden="true">●</span><span>{state.label}</span>
                </span>
              </summary>
              <div className="stack">
                <span className="note">{r.plate || 'Без номера'} · Подана {fmtTime(r.created_at)}</span>
                {r.comment && <span className="note">Комментарий клиента: {r.comment}</span>}
                {r.insurance_stage && <div className="insurance-agent-preview">
                  <b>Следующий шаг: {state.next}</b>
                  <p className="note">{state.detail} ФИО, сведения о грузовике, предложения и переписка открываются в рабочем деле.</p>
                  <a className="btn" href={`#/insurance/request/${r.id}`}>Открыть страховую заявку и чат →</a>
                </div>}
                {r.staff_note && <span className="note">Последний ответ: {r.staff_note}</span>}
                {r.policy_expires_on && <span className="note">Срок полиса: {String(r.policy_expires_on).slice(0, 10)}</span>}
                {r.status === 'sent_to_partner' && !r.insurance_stage && <>
                  <label className="stack">
                    <span className="label">Действует до</span>
                    <input className="field" type="date" value={currentDraft?(expires[r.id]??''):''}
                       min={new Date(Date.now()+86400000).toISOString().slice(0,10)}
                      onChange={(e) => setExpires((old) => ({ ...old, [r.id]: e.target.value }))} />
                  </label>
                  <textarea className="field" aria-label="Комментарий страховщика" maxLength={2000}
                    placeholder="Комментарий или причина отказа"
                    value={currentDraft?(notes[r.id]??''):''} onChange={(e) => setNotes((old) => ({ ...old, [r.id]: e.target.value }))} />
                  <div className="grid2">
                    <button type="button" className="btn small" disabled={busy||unconfirmed||!currentDraft||!futureDate(expires[r.id]??'')} onClick={() => update(r.id, 'completed')}>Полис оформлен</button>
                    <button type="button" className="btn ghost small" disabled={busy||unconfirmed} onClick={() => update(r.id, 'rejected')}>Отказать</button>
                  </div>
                </>}
              </div>
            </details>;
          })}
          </div>
        </div>}
      </>}

    </main>
  );
}


function InsurerEmptyState({onRefresh}:{onRefresh:()=>void}){
  const stages=[
    ['◇','Получение обращения','Клиент выбирает страхового агента и передаёт сведения о грузовике.'],
    ['▤','Подготовка расчётов','Вы проверяете документы и вручную готовите до 20 предложений.'],
    ['◈','Выбор клиентом','Клиент сравнивает стоимость и подтверждает нужный вариант.'],
    ['✓','Выдача полиса','Вы оформляете документ у страховщика и прикрепляете PDF в переписке.'],
  ];
  return <div className="insurer-empty-workspace stack">
    <div className="insurer-overview">
      <div className="insurer-stat"><span>Назначено</span><strong>0</strong><small>Пока нет заявок</small></div>
      <div className="insurer-stat"><span>Входящие</span><strong>0</strong><small>Ожидают приёма</small></div>
      <div className="insurer-stat"><span>На оформлении</span><strong>0</strong><small>Дела в работе</small></div>
      <div className="insurer-stat"><span>Завершены</span><strong>0</strong><small>Переданные полисы</small></div>
    </div>
    <section className="card insurer-empty-intro">
      <div className="insurer-empty-symbol" aria-hidden="true">◇</div>
      <div className="stack"><span className="insurance-step-title">РАБОЧАЯ ОЧЕРЕДЬ</span>
        <h2>Назначенных заявок пока нет</h2>
        <p>Когда клиент выберет вас страховым партнёром, здесь появится его обращение, анкета автомобиля и переписка.
        Заявки от других агентств недоступны.</p>
        <div className="row"><button className="btn small" type="button" onClick={onRefresh}>↻ Проверить новые заявки</button>
          <a className="btn ghost small" href="#/profile">Профиль партнёра</a></div>
      </div>
    </section>
    <section className="card insurer-workflow-guide">
      <div><span className="insurance-step-title">РАБОЧИЙ ПРОЦЕСС</span><h2>Как обрабатывается страхование</h2>
        <p className="note">Оформление у страховой компании проходит вручную, без API-интеграции.</p></div>
      <div className="insurer-workflow-steps">{stages.map(([symbol,title,description],i)=>
        <div className="insurer-workflow-step" key={title}>
          <span className="insurer-workflow-icon" aria-hidden="true">{symbol}</span>
          <small>Этап {i+1}</small><b>{title}</b><p>{description}</p>
        </div>)}
      </div>
    </section>
  </div>;
}
