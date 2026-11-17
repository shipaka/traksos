import {useState} from 'react';
import {post} from '../api.ts';
import {useAction} from '../ui.tsx';

type Courier={user_id:string;display_name:string;vehicle_label:string|null;active:boolean;busy:boolean};
type Plan={
 signature:string;
 batches:Array<{courierId:string;courierName:string;orderIds:string[];
   orderNumbers:number[];directKm:number|null}>;
 plannedOrders:number;eligibleScanned:number;eligibleRemaining:number;
 queueTruncated:boolean;requiresApproval:boolean;
 warehouseCheckRequired:boolean;supplierReceiptRequired:boolean;
 warning:string;
};
type Created={created:boolean;draftRuns:Array<{id:string;courierId:string;stops:number}>;
 plannedOrders:number;courierNotified:boolean;message:string};

export function CourierAutoDispatch({couriers,onCreated}:{
 couriers:Courier[];onCreated:(ids:string[])=>Promise<void>
}){
 const [selected,setSelected]=useState<string[]>([]);
 const [warehouse,setWarehouse]=useState('');
 const [latitude,setLatitude]=useState('');
 const [longitude,setLongitude]=useState('');
 const [maxStops,setMaxStops]=useState(25);
 const [capacityChecked,setCapacityChecked]=useState(false);
 const [snapshot,setSnapshot]=useState<{key:string;plan:Plan}|null>(null);
 const {run,busy}=useAction();
 const readyCouriers=couriers.filter(c=>c.active&&!c.busy);
 const key=JSON.stringify([selected,warehouse.trim(),latitude,longitude,maxStops]);
 const current=snapshot?.key===key?snapshot.plan:null;
 const numeric=(v:string)=>Number(v.replace(',','.'));
 const valid=selected.length>0&&selected.length<=20&&
  warehouse.trim().length>=10&&
  latitude.trim()!==''&&longitude.trim()!==''&&
  Number.isFinite(numeric(latitude))&&Number.isFinite(numeric(longitude))&&
  Math.abs(numeric(latitude))<=90&&Math.abs(numeric(longitude))<=180&&
  maxStops>=1&&maxStops<=50;
 const payload=()=>({
  courierIds:selected,pickupAddress:warehouse.trim(),
  pickupLat:numeric(latitude),pickupLng:numeric(longitude),maxStops
 });
 const toggle=(id:string,checked:boolean)=>{
  setSelected(current=>checked?[...current,id]:current.filter(x=>x!==id));
  setCapacityChecked(false);
 };
 const preview=async()=>{
  setSnapshot(null);
  const requestKey=key;
  const data=await run(()=>post<Plan>('/api/admin/shop/courier-dispatch/preview',payload()),
    'Предварительная группировка рассчитана');
  if(data)setSnapshot({key:requestKey,plan:data});
 };
 const create=async()=>{
  if(!current||!capacityChecked)return;
  const made=await run(()=>post<Created>('/api/admin/shop/courier-dispatch/create',{
    ...payload(),expectedSignature:current.signature,
    capacityConfirmed:true
  }),'Черновики рейсов созданы; доставка ещё не разрешена');
  if(made){
   setSnapshot(null);setCapacityChecked(false);
   await onCreated(made.draftRuns.map(x=>x.id));
  }
 };
 return <section className="card stack" aria-label="Автоматическая диспетчерская">
  <h2>Автоматическое распределение доставок</h2>
  <p className="note">Выберите свободных курьеров и проверенный склад. Система сама
   найдёт готовые, ещё не назначенные заказы с подтверждёнными координатами
   и предложит группы до 50 остановок. ID заказов вводить не нужно.</p>
  <p className="note">На этом этапе <b>не</b> учитываются грузоподъёмность, дорожные
   ограничения, окна разгрузки и пробки. Не подтверждайте проект,
   если машина или время работы курьера не подходят.</p>
  <fieldset className="stack" style={{border:'1px solid var(--line, #52647c)',
   padding:12,borderRadius:12}}>
   <legend>Курьеры для автоматической группировки (до 20)</legend>
   {readyCouriers.length===0&&<p className="note">Нет доступных курьеров: проверьте занятость или назначьте новых.</p>}
   <div className="grid2">
    {readyCouriers.map(c=><label key={c.user_id} className="row">
      <input type="checkbox" checked={selected.includes(c.user_id)}
       disabled={busy||(!selected.includes(c.user_id)&&selected.length>=20)}
       onChange={e=>toggle(c.user_id,e.target.checked)}/>
      <span><b>{c.display_name}</b>
       <small className="note">{c.vehicle_label??'Транспорт не указан'}</small></span>
    </label>)}
   </div>
  </fieldset>
  <div className="stack">
   <label>Подтверждённый адрес склада
    <input className="field" value={warehouse} onChange={e=>setWarehouse(e.target.value)}
      placeholder="Санкт-Петербург, улица и дом" maxLength={300}/></label>
   <div className="grid2">
    <label>Широта склада <input className="field" inputMode="decimal"
      value={latitude} onChange={e=>setLatitude(e.target.value)} placeholder="59.93"/></label>
    <label>Долгота склада <input className="field" inputMode="decimal"
      value={longitude} onChange={e=>setLongitude(e.target.value)} placeholder="30.32"/></label>
   </div>
   <label>Максимум посылок в одном рейсе, от 1 до 50
    <input className="field" type="number" min={1} max={50} value={maxStops}
      onChange={e=>setMaxStops(Number(e.target.value))}/></label>
  </div>
  <button className="btn" disabled={busy||!valid} onClick={()=>void preview()}>
   Рассчитать распределение без назначения
  </button>
  {current&&<div className="stack" aria-label="Результат автоматического планирования">
    <h3>Предложенные рейсы: {current.batches.length}</h3>
    <p>Заказов распределено: <b>{current.plannedOrders}</b>.
      {current.eligibleRemaining>0?' Ещё в очереди: '+current.eligibleRemaining+'.':''}
      {current.queueTruncated?' Очередь превышает 1000, показана только первая партия.':''}</p>
    <p className="note">{current.warning}</p>
    {current.batches.length===0&&<p role="status">
     Подходящих заказов пока нет: проверьте статусы и координаты доставки.
    </p>}
    <ol className="stack">
     {current.batches.map(b=><li key={b.courierId}>
      <b>{b.courierName}</b> · {b.orderIds.length} остановок
      {b.directKm!=null?' · '+b.directKm+' км по прямой':''}
      <small className="note">Начало очереди: заказы №{b.orderNumbers.slice(0,5).join(', №')}
       {b.orderNumbers.length>5?' и ещё '+(b.orderNumbers.length-5):''}</small>
     </li>)}
    </ol>
    <label className="row">
     <input type="checkbox" checked={capacityChecked}
       onChange={e=>setCapacityChecked(e.target.checked)}/>
     Я проверил грузоподъёмность, смены выбранных курьеров и возможность
     вывоза указанного количества посылок со склада
    </label>
    <button className="btn" disabled={busy||!capacityChecked||!current.plannedOrders}
      onClick={()=>void create()}>
     Создать {current.batches.length} черновиков рейсов
    </button>
    <p className="note">После создания обязательно: сверка запчастей и накладных
     поставщика, смета затрат, проверка прибыльности и отдельное утверждение.
     До утверждения курьеры не получают задания.</p>
   </div>}
 </section>;
}
