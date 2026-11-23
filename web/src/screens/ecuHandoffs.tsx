import { useRef,useState } from 'react';
import { get,post,put,rub,fmtTime } from '../api.ts';
import { useAction,useMe,Loading,Back } from '../ui.tsx';
import { usePrivateRead } from './privateRead20261124.ts';
import { ecuDiagnosisKopecks } from '../ecuQuoteAmount20261124.ts';
import { SERVICES,STATUS } from '../dict.ts';

/** A technician hands over a technical conclusion; no sale or bank operation. */
export function EcuOrderPanel({order:o}:{order:any}) {
 const {me}=useMe();
 return <EcuOrderPanelInner key={(me?.id??'guest')+':'+o.id} order={o}/>;
}
function EcuOrderPanelInner({order:o}:{order:any}) {
 const {me}=useMe();
 const key=(me?.id??'guest')+':'+o.id;
 const handoff=usePrivateRead<any>(()=>me?get('/api/orders/'+o.id+'/ecu-handoff'):Promise.resolve(null),
  key,e=>e.type==='ecu_handoff'&&e.orderId===o.id);
 const [summary,setSummary]=useState('');
 const {busy,run}=useAction();
 const postBusy=useRef(false);
 const supported=['consult','electric','diag','air','autonomy','tyre'].includes(o.service);
 if(!supported || !['client','performer','admin'].includes(o.you))return null;
 const originReady=o.you==='performer' && (o.service==='consult'
  ? ['awaiting_confirmation','completed'].includes(o.status)
  : ['arrived','working','awaiting_confirmation','completed'].includes(o.status));
 const ownerReady=o.you==='client' && !me?.owner_id
  && ['awaiting_confirmation','completed'].includes(o.status);
 if(!handoff.data && !originReady && !ownerReady)return null;
 return <div className="card stack">
  <b>Передача ремонтникам ЭБУ</b>
  {handoff.data ? <>
   <span className="note">Техническое заключение связано с обращением. Исходный мастер остаётся закреплён за своим заказом.</span>
   <a className="btn ghost small" href={'#/ecu-handoff/'+handoff.data.id}>
    Открыть передачу · {handoff.data.state==='selected'?'специалист выбран':'ожидаем предложения'}
   </a>
  </> : <>
   {handoff.loading&&<span className="note" role="status">Проверяю передачу ЭБУ…</span>}
   {handoff.error&&<div role="alert" className="stack">
     <span className="note">Не удалось проверить наличие передачи ЭБУ: {handoff.error}</span>
     <button type="button" className="btn ghost small" onClick={()=>void handoff.reload()}>Повторить</button>
   </div>}
   <span className="note">Если проблема в электронном блоке управления, можно передать заключение проверенным стационарным мастерским. Клиенту придёт уведомление. Это бесплатно; будущая диагностика и ремонт согласуются отдельно.</span>
   <textarea className="field" rows={3} value={summary} maxLength={1400}
    placeholder="Что проверили, какие ошибки получили, какие детали исключили, вывод мастера…"
    onChange={e=>setSummary(e.target.value)}/>
   <button className="btn ghost small"
    disabled={busy||postBusy.current||handoff.loading||!!handoff.error||summary.trim().length<10}
    onClick={async()=>{
     if(postBusy.current)return;
     postBusy.current=true;
     try{
      const r=await run(()=>post('/api/orders/'+o.id+'/ecu-handoff',{summary}),
       'Заключение направлено, платных работ не создано');
      if(r)void handoff.reload();
     }finally{postBusy.current=false;}
    }}>Передать техническое заключение в ЭБУ</button>
  </>}
 </div>;
}

export function EcuStationWorkspace(){
 const {me}=useMe();
 return <EcuStationWorkspaceInner key={me?.id??'guest'} />;
}
function EcuStationWorkspaceInner(){
 const {me}=useMe();
 const identity=me?.id??'guest';
 const station=usePrivateRead<any>(()=>me?get('/api/ecu/station'):Promise.resolve(null),identity+':station');
 const inbox=usePrivateRead<any[]>(()=>me?get('/api/ecu/handoffs'):Promise.resolve([]),
  identity+':inbox',e=>e.type==='ecu_handoff');
 const [name,setName]=useState('');
 const [address,setAddress]=useState('');
 const {busy,run}=useAction();
 const lock=useRef(false);
 const s=station.data?.station;
 return <main className="work-live-dashboard stack">
  <Back to="work/me"/>
  <h1>Специалист по ремонту ЭБУ</h1>
  <p className="note">Стационарная мастерская. Здесь нет цены выезда, километража, оплаты без согласия клиента или служебной машины.</p>
  <div className="card stack">
   <b>Адрес и проверка стационарной точки</b>
   {!station.data ? <div className="stack">
   <Loading error={station.error}/>
   {station.error&&<button type="button" className="btn ghost small"
     onClick={()=>void station.reload()}>Повторить загрузку адреса</button>}
  </div> : <>
    <span className="note">{s?.approved_at?'Адрес мастерской подтверждён администратором':'Адрес ещё не одобрен. Запросы станут доступны после проверки специалиста и мастерской.'}</span>
    {s && <span className="note">{s.public_name} · {s.address}</span>}
    <input className="field" placeholder="Публичное название мастерской" value={name}
     maxLength={120} onChange={e=>setName(e.target.value)} />
    <input className="field" placeholder="Адрес для приёма блоков ЭБУ (не домашний адрес)"
     maxLength={300} value={address} onChange={e=>setAddress(e.target.value)}/>
    <span className="note">Изменение адреса сбросит прежнее одобрение до повторной проверки.</span>
    <button className="btn small" disabled={busy||lock.current||name.trim().length<3||address.trim().length<8}
     onClick={async()=>{
      if(lock.current)return;lock.current=true;
      try{
       const r=await run(()=>put('/api/ecu/station',{publicName:name,address}),
        'Адрес отправлен на проверку');
       if(r){void station.reload();void inbox.reload();setName('');setAddress('');}
      }finally{lock.current=false;}
     }}>Сохранить точку и отправить на проверку</button>
   </>}
  </div>
  <div className="card stack">
   <div className="between"><b>Заключения для ЭБУ</b>
    <button className="btn ghost small" onClick={()=>inbox.reload()}>Обновить</button></div>
   {!inbox.data ? <div className="stack"><Loading error={inbox.error}/>
     {inbox.error&&<button className="btn ghost small" type="button"
       onClick={()=>void inbox.reload()}>Повторить загрузку передач</button>}
     </div> :
    inbox.data.length ? inbox.data.map((r:any)=><a className="linkrow"
      href={'#/ecu-handoff/'+r.id} key={r.id}>
      <span><b>{r.brand??'Грузовик'} {r.model??''} · после {SERVICES[r.service]?.name??r.service}</b>
       <small>{r.summary.slice(0,130)} · {r.state==='selected'?'Выбрано':'Нужна цена диагностики'}</small></span><span>›</span>
     </a>) : <span className="note">Доступных передач пока нет. Нужна верификация профиля и адреса мастерской.</span>}
  </div>
  <a className="btn ghost small" href="#/work/me">Профиль и документы специалиста</a>
 </main>;
}

export function EcuHandoffPage({id}:{id:string}){
 const {me}=useMe();
 return <EcuHandoffPageInner key={(me?.id??'guest')+':'+id} id={id}/>;
}
function EcuHandoffPageInner({id}:{id:string}){
 const {me}=useMe();
 const identity=(me?.id??'guest')+':'+id;
 const details=usePrivateRead<any>(()=>me?get('/api/ecu/handoffs/'+id):Promise.resolve(null),
  identity,e=>e.type==='ecu_handoff'&&e.handoffId===id);
 const {busy,run}=useAction();
 const [priceRub,setPriceRub]=useState('');
 const [explanation,setExplanation]=useState('');
 const [quoteId,setQuoteId]=useState<string|null>(null);
 const [agreedTo,setAgreedTo]=useState<string|null>(null);
 const [message,setMessage]=useState('');
 const actionLock=useRef(false);
 const lockAction=async(fn:()=>Promise<any>,label:string,onSuccess:()=>void)=>{
  if(actionLock.current)return;
  actionLock.current=true;
  try{
   const result=await run(fn,label);
   if(result)onSuccess();
  }finally{actionLock.current=false;}
 };
 const d=details.data;
 const price=ecuDiagnosisKopecks(priceRub);
 const quote=d?.quotes?.find((q:any)=>q.id===quoteId);
 // A checkbox is consent to exactly one immutable quote revision AND price;
 // refreshing the list must never reuse consent for a changed amount.
 const confirmationKey=quote?quote.id+':'+quote.version+':'+quote.diagnosis_price:null;
 const agree=!!confirmationKey && agreedTo===confirmationKey;
 const owner=d?.actor==='owner' && !me?.owner_id;
 const canChat=d?.state==='selected'&&['owner','driver','expert','admin'].includes(d?.actor);
 return <main className="stack">
  <Back to={me?.performer?.kind==='ecu'?'work':'orders'} />
  <h1>Передача ЭБУ №{d?.number??'…'} · техническая цепочка</h1>
  {!d ? <div className="stack"><Loading error={details.error}/>
    {details.error&&<button type="button" className="btn ghost small"
      onClick={()=>void details.reload()}>Повторить загрузку передачи ЭБУ</button>}
   </div> : <>
   <div className="card stack">
    <div className="between"><b>После заявки №{d.sourceNumber}</b>
      <span className="pill">{d.state==='selected'?'Специалист выбран':'Ожидаем предложения'}</span></div>
    <span className="note">{d.vehicle.brand} {d.vehicle.model??''} {d.vehicle.year??''}</span>
    {d.vehicle.vin && <span className="note">VIN: {d.vehicle.vin}</span>}
    <p>{d.summary}</p>
    <span className="note">{d.disclaimer}</span>
    {d.station && <span>Выбранная мастерская: <b>{d.station.public_name}</b> · {d.station.address}</span>}
   </div>
   {((d.history?.length??0)+(d.workshops?.length??0))>0 && <div className="card stack">
    <b>Общая хронология · консультация, мастер, эвакуатор, СТО</b>
    <span className="note">У каждого этапа свой исполнитель. От СТО передаются только публичные технические заметки, без закрытых переписок и финансов.</span>
    {[...(d.history??[]).map((v:any)=>({...v,kind:'order'})),
      ...(d.workshops??[]).map((v:any)=>({...v,kind:'sto'}))]
      .sort((a:any,b:any)=>new Date(a.createdAt).getTime()-new Date(b.createdAt).getTime())
      .map((item:any)=>item.kind==='sto'
       ? <div key={'sto-'+item.id} className="stack" style={{gap:4}}>
          <a href={'#/booking/'+item.id} className="note">СТО · запись №{item.number} · {item.status}</a>
          <b>{item.centerName}</b>
          <span className="note">{item.need}</span>
          {item.comment && <span className="note">{item.comment}</span>}
          {item.works?.length>0 && <span className="note">Что сделали: {item.works.join(', ')}</span>}
          {item.publicNotes?.map((n:any,i:number)=><span className="note" key={i}>
            Публичное заключение СТО: {n.text}</span>)}
          <small className="note">{fmtTime(item.createdAt)} {item.closedAt?'· закрыто '+fmtTime(item.closedAt):''}</small>
         </div>
       : <div key={'order-'+item.id} className="stack" style={{gap:4}}>
          <a href={'#/order/'+item.id} className="note">Заказ №{item.number} · {SERVICES[item.service]?.name??item.service} · {STATUS[item.status]?.name??item.status}</a>
          <b>{item.performerName}</b>
          {item.description && <span className="note">{item.description}</span>}
          {item.resultNote && <span className="note">Заключение: {item.resultNote}</span>}
          {item.consultHint?.note && <span className="note">Консультация: {item.consultHint.note}</span>}
          <small className="note">{fmtTime(item.createdAt)} {item.completedAt?'· завершено '+fmtTime(item.completedAt):''}</small>
         </div>)}
   </div>}
   {d.actor==='candidate' && d.state==='pending' && <div className="card stack">
    <b>Предложить цену первичной диагностики</b>
    <span className="note">Пока клиент не выбрал вас, VIN, личные контакты и чужие заключения закрыты. Укажите только стоимость диагностики, не полную цену ремонта.</span>
    <input className="field" inputMode="decimal" placeholder="Цена диагностики, ₽"
     value={priceRub} onChange={e=>setPriceRub(e.target.value)}/>
    <textarea className="field" rows={3} maxLength={1000} value={explanation}
     placeholder="Что включено в диагностику и условия передачи блока"
     onChange={e=>setExplanation(e.target.value)}/>
    <button className="btn" disabled={busy||actionLock.current||price===null||explanation.trim().length<10}
     onClick={()=>void lockAction(()=>post('/api/ecu/handoffs/'+id+'/quote',
       {diagnosisPrice:price,explanation}),'Предложение отправлено',()=>void details.reload())}>
     Предложить диагностику</button>
   </div>}
   {owner && d.state==='pending' && <div className="card stack">
    <b>Предложения стационарных специалистов</b>
    <span className="note">Цена диагностики относится только к ней. Ремонт и перепрошивка обсуждаются отдельным согласованием. Без оплаты и автосписаний.</span>
    {d.quotes?.length ? d.quotes.map((q:any)=><label key={q.id} className="opt">
      <input type="radio" name="ecu-quote" checked={quoteId===q.id} onChange={()=>{
       setQuoteId(q.id);setAgreedTo(null);
      }}/>
      <b>{q.public_name} · {rub(q.diagnosis_price)}</b>
      <small>{q.address}</small><small>{q.explanation} · версия {q.version}</small>
     </label>) : <span className="note">Специалисты ещё не прислали цены.</span>}
    {quote && <>
     <label className="agree"><input type="checkbox" checked={agree}
      onChange={e=>setAgreedTo(e.target.checked?confirmationKey:null)} />
      Я подтверждаю цену диагностики {rub(quote.diagnosis_price)} по версии {quote.version} и разрешаю выбранному специалисту увидеть VIN и технические заключения этой цепочки. Другие специалисты доступа не получат. Дополнительный ремонт отдельно.</label>
     <button className="btn" disabled={busy||actionLock.current||!agree||!quote}
      onClick={()=>void lockAction(()=>post('/api/ecu/handoffs/'+id+'/choose',
       {quoteId:quote.id,version:quote.version,price:quote.diagnosis_price,agree:true}),
       'Выбран специалист и подтверждена цена диагностики',
       ()=>{setAgreedTo(null);setQuoteId(null);void details.reload();})}>
      Выбрать этого специалиста</button>
    </>}
   </div>}
   {owner && d.state!=='closed' && <EcuClose id={id} onDone={()=>details.reload()} />}
   {canChat && <div className="card stack">
    <b>Техническая переписка по выбранной передаче</b>
    {d.notes?.map((m:any)=><div key={m.id} className="stack">
     <b>{m.author_name}</b><span>{m.body}</span><small className="note">{fmtTime(m.created_at)}</small>
    </div>)}
    <textarea className="field" value={message} maxLength={1500}
     placeholder="Информация о проверке, адрес и согласование передачи блока — без личных номеров"
     onChange={e=>setMessage(e.target.value)} />
    <button className="btn ghost small" disabled={busy||actionLock.current||message.trim().length<2}
     onClick={()=>void lockAction(()=>post('/api/ecu/handoffs/'+id+'/notes',{body:message}),
       'Сообщение сохранено',()=>{setMessage('');void details.reload();})}>
     Отправить сообщение</button>
   </div>}
  </>}
 </main>;
}

function EcuClose({id,onDone}:{id:string;onDone:()=>void}){
 const [reason,setReason]=useState('');
 const {busy,run}=useAction();
 const lock=useRef(false);
 return <div className="card stack">
  <b>Закрыть техническую передачу</b>
  <span className="note">Закрытие завершает только техническую передачу. Не меняет суммы, оплаты или статусы предыдущих заказов.</span>
  <textarea className="field" rows={2} maxLength={1000} value={reason}
   onChange={e=>setReason(e.target.value)}
   placeholder="Чем закончилась диагностика или почему закрываете передачу"/>
  <button className="btn ghost small" disabled={busy||lock.current||reason.trim().length<10}
   onClick={async()=>{
    if(lock.current)return;lock.current=true;
    try{
     const r=await run(()=>post('/api/ecu/handoffs/'+id+'/close',{reason}),'Передача закрыта');
     if(r)onDone();
    }finally{lock.current=false;}
   }}>Закрыть передачу с итоговым комментарием</button>
 </div>;
}

export function EcuAdminStations(){
 const {me}=useMe();
 return <EcuAdminStationsInner key={me?.id??'guest'} />;
}
function EcuAdminStationsInner(){
 const {me}=useMe();
 const rows=usePrivateRead<any[]>(()=>me?get('/api/admin/ecu/stations'):Promise.resolve([]),
  (me?.id??'guest')+':admin-ecu-stations');
 const {busy,run}=useAction();
 const lock=useRef(false);
 return <div className="stack">
  <div className="card stack"><b>Проверка стационарных точек ЭБУ</b>
   <span className="note">Проверяйте документы исполнителя и публичный адрес мастерской. Это не выездная услуга и не тариф по километрам.</span></div>
  {!rows.data ? <div className="stack"><Loading error={rows.error}/>
    {rows.error&&<button type="button" className="btn ghost small"
      onClick={()=>void rows.reload()}>Повторить загрузку проверок ЭБУ</button>}
   </div> : rows.data.length
   ? rows.data.map((s:any)=><div key={s.performer_id} className="card stack">
     <b>{s.public_name} · {s.name??'Специалист'}</b>
     <span className="note">{s.address}</span>
     <span className="note">Документы: {s.verification} · адрес: {s.approved_at?'подтверждён':'на проверке'}</span>
     <div className="row">
      <button className="btn small" disabled={busy||lock.current||s.verification!=='approved'} onClick={async()=>{
       if(lock.current)return;lock.current=true;
       try{
        if(await run(()=>post('/api/admin/ecu/stations/'+s.performer_id+'/verify',{approved:true}),
         'Адрес подтверждён'))void rows.reload();
       }finally{lock.current=false;}
      }}>Подтвердить адрес</button>
      <button className="btn ghost small" disabled={busy||lock.current} onClick={async()=>{
       if(lock.current)return;lock.current=true;
       try{
        if(await run(()=>post('/api/admin/ecu/stations/'+s.performer_id+'/verify',{approved:false}),
         'Публикация точки приостановлена'))void rows.reload();
       }finally{lock.current=false;}
      }}>Снять одобрение</button>
     </div>
    </div>) : <div className="empty">Заявок на подтверждение адреса ЭБУ нет</div>}
 </div>;
}
