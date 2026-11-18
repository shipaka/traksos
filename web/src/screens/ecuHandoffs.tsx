import { useState } from 'react';
import { get,post,put,rub,fmtTime } from '../api.ts';
import { useLoad,useAction,useMe,Loading,Back } from '../ui.tsx';
import { SERVICES,STATUS } from '../dict.ts';

/** A technician hands over a technical conclusion; no sale or bank operation. */
export function EcuOrderPanel({order:o}:{order:any}) {
 const {me}=useMe();
 const handoff=useLoad(()=>get('/api/orders/'+o.id+'/ecu-handoff'),[o.id],
  e=>e.type==='ecu_handoff' && e.orderId===o.id);
 const [summary,setSummary]=useState('');
 const {busy,run}=useAction();
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
   <span className="note">Если проблема в электронном блоке управления, можно передать заключение проверенным стационарным мастерским. Клиенту придёт уведомление. Это бесплатно; будущая диагностика и ремонт согласуются отдельно.</span>
   <textarea className="field" rows={3} value={summary} maxLength={1400}
    placeholder="Что проверили, какие ошибки получили, какие детали исключили, вывод мастера…"
    onChange={e=>setSummary(e.target.value)}/>
   <button className="btn ghost small" disabled={busy||summary.trim().length<10}
    onClick={async()=>{
     const r=await run(()=>post('/api/orders/'+o.id+'/ecu-handoff',{summary}),
      'Заключение направлено, платных работ не создано');
     if(r)handoff.reload();
    }}>Передать техническое заключение в ЭБУ</button>
  </>}
 </div>;
}

export function EcuStationWorkspace(){
 const station=useLoad(()=>get('/api/ecu/station'),[]);
 const inbox=useLoad(()=>get('/api/ecu/handoffs'),[],
  e=>e.type==='ecu_handoff');
 const [name,setName]=useState('');
 const [address,setAddress]=useState('');
 const {busy,run}=useAction();
 const s=station.data?.station;
 return <main className="work-live-dashboard stack">
  <Back to="work/me"/>
  <h1>Специалист по ремонту ЭБУ</h1>
  <p className="note">Стационарная мастерская. Здесь нет цены выезда, километража, оплаты без согласия клиента или служебной машины.</p>
  <div className="card stack">
   <b>Адрес и проверка стационарной точки</b>
   {!station.data ? <Loading error={station.error}/> : <>
    <span className="note">{s?.approved_at?'Адрес мастерской подтверждён администратором':'Адрес ещё не одобрен. Запросы станут доступны после проверки специалиста и мастерской.'}</span>
    {s && <span className="note">{s.public_name} · {s.address}</span>}
    <input className="field" placeholder="Публичное название мастерской" value={name}
     maxLength={120} onChange={e=>setName(e.target.value)} />
    <input className="field" placeholder="Адрес для приёма блоков ЭБУ (не домашний адрес)"
     maxLength={300} value={address} onChange={e=>setAddress(e.target.value)}/>
    <span className="note">Изменение адреса сбросит прежнее одобрение до повторной проверки.</span>
    <button className="btn small" disabled={busy||name.trim().length<3||address.trim().length<8}
     onClick={async()=>{
      const r=await run(()=>put('/api/ecu/station',{publicName:name,address}),
       'Адрес отправлен на проверку');
      if(r){station.reload();inbox.reload();setName('');setAddress('');}
     }}>Сохранить точку и отправить на проверку</button>
   </>}
  </div>
  <div className="card stack">
   <div className="between"><b>Заключения для ЭБУ</b>
    <button className="btn ghost small" onClick={()=>inbox.reload()}>Обновить</button></div>
   {!inbox.data ? <Loading error={inbox.error}/> :
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
 const details=useLoad(()=>get('/api/ecu/handoffs/'+id),[id],e=>e.type==='ecu_handoff'&&e.handoffId===id);
 const {busy,run}=useAction();
 const [priceRub,setPriceRub]=useState('');
 const [explanation,setExplanation]=useState('');
 const [quoteId,setQuoteId]=useState<string|null>(null);
 const [agree,setAgree]=useState(false);
 const [message,setMessage]=useState('');
 const d=details.data;
 const price=Math.round(Number(priceRub.replace(',','.'))*100);
 const quote=d?.quotes?.find((q:any)=>q.id===quoteId);
 const owner=d?.actor==='owner' && !me?.owner_id;
 const canChat=d?.state==='selected'&&['owner','driver','expert','admin'].includes(d?.actor);
 return <main className="stack">
  <Back to={me?.performer?.kind==='ecu'?'work':'orders'} />
  <h1>Передача ЭБУ · техническая цепочка</h1>
  {!d ? <Loading error={details.error}/> : <>
   <div className="card stack">
    <div className="between"><b>После заявки №{d.sourceNumber}</b>
      <span className="pill">{d.state==='selected'?'Специалист выбран':'Ожидаем предложения'}</span></div>
    <span className="note">{d.vehicle.brand} {d.vehicle.model??''} {d.vehicle.year??''}</span>
    {d.vehicle.vin && <span className="note">VIN: {d.vehicle.vin}</span>}
    <p>{d.summary}</p>
    <span className="note">{d.disclaimer}</span>
    {d.station && <span>Выбранная мастерская: <b>{d.station.public_name}</b> · {d.station.address}</span>}
   </div>
   {d.history?.length>0 && <div className="card stack">
    <b>Хронология · кто и что проверил</b>
    {d.history.map((s:any)=><div key={s.number} className="stack" style={{gap:4}}>
     <a href={'#/order/'+d.rootOrderId} className="note">Этап №{s.number} · {SERVICES[s.service]?.name??s.service} · {STATUS[s.status]?.name??s.status}</a>
     <b>{s.performerName}</b>
     {s.description && <span className="note">{s.description}</span>}
     {s.resultNote && <span className="note">Результат: {s.resultNote}</span>}
     {s.consultHint?.note && <span className="note">Консультация: {s.consultHint.note}</span>}
     <small className="note">{fmtTime(s.createdAt)} {s.completedAt?'· завершено '+fmtTime(s.completedAt):''}</small>
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
    <button className="btn" disabled={busy||!Number.isInteger(price)||price<100||explanation.trim().length<10}
     onClick={async()=>{
      const r=await run(()=>post('/api/ecu/handoffs/'+id+'/quote',
       {diagnosisPrice:price,explanation}),'Предложение отправлено');
      if(r)details.reload();
     }}>Предложить диагностику</button>
   </div>}
   {owner && d.state==='pending' && <div className="card stack">
    <b>Предложения стационарных специалистов</b>
    <span className="note">Цена диагностики относится только к ней. Ремонт и перепрошивка обсуждаются отдельным согласованием. Без оплаты и автосписаний.</span>
    {d.quotes?.length ? d.quotes.map((q:any)=><label key={q.id} className="opt">
      <input type="radio" name="ecu-quote" checked={quoteId===q.id} onChange={()=>{
       setQuoteId(q.id);setAgree(false);
      }}/>
      <b>{q.public_name} · {rub(q.diagnosis_price)}</b>
      <small>{q.address}</small><small>{q.explanation} · версия {q.version}</small>
     </label>) : <span className="note">Специалисты ещё не прислали цены.</span>}
    {quote && <>
     <label className="agree"><input type="checkbox" checked={agree}
      onChange={e=>setAgree(e.target.checked)} />
      Я подтверждаю цену диагностики {rub(quote.diagnosis_price)} по версии {quote.version}. Дополнительный ремонт отдельно.</label>
     <button className="btn" disabled={busy||!agree} onClick={async()=>{
      const r=await run(()=>post('/api/ecu/handoffs/'+id+'/choose',
       {quoteId:quote.id,version:quote.version,price:quote.diagnosis_price,agree:true}),
       'Выбран специалист и подтверждена цена диагностики');
      if(r){details.reload();setAgree(false);}
     }}>Выбрать этого специалиста</button>
    </>}
   </div>}
   {canChat && <div className="card stack">
    <b>Техническая переписка по выбранной передаче</b>
    {d.notes?.map((m:any)=><div key={m.id} className="stack">
     <b>{m.author_name}</b><span>{m.body}</span><small className="note">{fmtTime(m.created_at)}</small>
    </div>)}
    <textarea className="field" value={message} maxLength={1500}
     placeholder="Информация о проверке, адрес и согласование передачи блока — без личных номеров"
     onChange={e=>setMessage(e.target.value)} />
    <button className="btn ghost small" disabled={busy||message.trim().length<2}
     onClick={async()=>{
      const r=await run(()=>post('/api/ecu/handoffs/'+id+'/notes',{body:message}),'Сообщение сохранено');
      if(r){setMessage('');details.reload();}
     }}>Отправить сообщение</button>
   </div>}
  </>}
 </main>;
}

export function EcuAdminStations(){
 const rows=useLoad(()=>get('/api/admin/ecu/stations'),[]);
 const {busy,run}=useAction();
 return <div className="stack">
  <div className="card stack"><b>Проверка стационарных точек ЭБУ</b>
   <span className="note">Проверяйте документы исполнителя и публичный адрес мастерской. Это не выездная услуга и не тариф по километрам.</span></div>
  {!rows.data ? <Loading error={rows.error}/> : rows.data.length
   ? rows.data.map((s:any)=><div key={s.performer_id} className="card stack">
     <b>{s.public_name} · {s.name??'Специалист'}</b>
     <span className="note">{s.address}</span>
     <span className="note">Документы: {s.verification} · адрес: {s.approved_at?'подтверждён':'на проверке'}</span>
     <div className="row">
      <button className="btn small" disabled={busy||s.verification!=='approved'} onClick={async()=>{
       if(await run(()=>post('/api/admin/ecu/stations/'+s.performer_id+'/verify',{approved:true}),
        'Адрес подтверждён'))rows.reload();
      }}>Подтвердить адрес</button>
      <button className="btn ghost small" disabled={busy} onClick={async()=>{
       if(await run(()=>post('/api/admin/ecu/stations/'+s.performer_id+'/verify',{approved:false}),
        'Публикация точки приостановлена'))rows.reload();
      }}>Снять одобрение</button>
     </div>
    </div>) : <div className="empty">Заявок на подтверждение адреса ЭБУ нет</div>}
 </div>;
}
