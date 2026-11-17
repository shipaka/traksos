import {useState} from 'react';
import {CourierWarehouseCheck} from './courierWarehouse.tsx';
import {SupplierReceivingDesk} from './supplierReceivingDesk.tsx';
import {get,post,put} from '../api.ts';
import {useAction,useLoad,Back} from '../ui.tsx';

type Courier={user_id:string;display_name:string;vehicle_label:string|null;active:boolean};
type Run={id:string;courier_id:string;courier_name:string;status:string;stops:number};
type Economics={
  runId:string;status:string;stops:number;
  goodsRevenueKopecks:number;deliveryRevenueKopecks:number;
  procurementKnown:boolean;procurementTotalKopecks:number|null;
  tradingMarkupKopecks:number|null;forecastExpensesKopecks:number|null;
  routeContributionKopecks:number|null;budgetDocumented:boolean;
  supplierIssuesOpen:boolean;ordersReady:boolean;canApprove:boolean;
  supplierReceiptRequired:boolean;supplierReceiptReady:boolean;
  approved:boolean;profitable:boolean|null;warning:string;
  platformCommissionEstimateKopecks:number;platformCommissionBookedKopecks:number;
};
const asRub=(kopecks:number|null)=>kopecks==null?'—':(kopecks/100).toLocaleString('ru-RU')+' ₽';
const zeros={courierPayKopecks:'0',fuelKopecks:'0',packingKopecks:'0',
  acquiringKopecks:'0',taxesKopecks:'0',otherKopecks:'0'};
const budgetNames:Record<keyof typeof zeros,string>={
  courierPayKopecks:'Оплата курьеру',fuelKopecks:'Топливо',
  packingKopecks:'Упаковка',acquiringKopecks:'Эквайринг',
  taxesKopecks:'Налоги',otherKopecks:'Прочие расходы'
};
const toMoney=(v:string)=>Math.round(Number(v.replace(',','.'))*100);
export function CourierAdmin(){
 const couriers=useLoad<{couriers:Courier[]}>(()=>get('/api/admin/shop/couriers'),[]);
 const runs=useLoad<{runs:Run[]}>(()=>get('/api/admin/shop/courier-runs'),[]);
 const {run,busy}=useAction();
 const [newUser,setNewUser]=useState(''),[displayName,setDisplayName]=useState('');
 const [vehicle,setVehicle]=useState('');
 const [verifyOrder,setVerifyOrder]=useState(''),[verifyEvidence,setVerifyEvidence]=useState('');
 const [courierId,setCourierId]=useState(''),[warehouse,setWarehouse]=useState(''),[orders,setOrders]=useState('');
 const [packingRequired,setPackingRequired]=useState(false);
 const [traceabilityRequired,setTraceabilityRequired]=useState(false);
 const [supplierReceiptRequired,setSupplierReceiptRequired]=useState(false);
 const [selected,setSelected]=useState('');
 const economics=useLoad<Economics|null>(()=>selected?get('/api/admin/shop/courier-runs/'+selected+'/economics'):Promise.resolve(null),[selected]);
 const [budget,setBudget]=useState(zeros),[budgetNote,setBudgetNote]=useState('');
 const [exception,setException]=useState('');
 const [cancelReason,setCancelReason]=useState('');
 const [returnEvidence,setReturnEvidence]=useState('');
 const chosen=runs.data?.runs.find(r=>r.id===selected)??null;
 const updateBudget=(key:keyof typeof zeros,value:string)=>setBudget(x=>({...x,[key]:value}));
 const saveBudget=async()=>{
   const amounts=Object.fromEntries(Object.entries(budget).map(([key,value])=>[key,toMoney(value)]));
   if(Object.values(amounts).some(x=>!Number.isSafeInteger(x)||x<0))return;
   const result=await run(()=>put('/api/admin/shop/courier-runs/'+selected+'/budget',{
     ...amounts,note:budgetNote.trim()}),'Смета сохранена');
   if(result)await economics.reload();
 };
 return <main className="stack" style={{maxWidth:1060,padding:'clamp(12px,3vw,24px)',margin:'auto',gap:14}}>
   <Back to="admin" label="Админка"/>
   <h1>Курьеры и маршруты магазина</h1>
   <p className="note">Только Санкт-Петербург. Здесь фиксируются фактическая готовность товара, подтверждение адресов, маршрут и экономика рейса. Комиссия платформы 5% отдельно от торговой маржи. Магазин нельзя открывать до отдельной релизной приёмки.</p>
   <section className="card stack">
     <h2>Назначить курьера</h2>
     <p className="note">Для курьера требуется отдельный зарегистрированный аккаунт без клиентских заказов. Назначение допускается только администратору.</p>
     <form className="stack" onSubmit={async e=>{
       e.preventDefault();const saved=await run(()=>post('/api/admin/shop/couriers',{
         userId:newUser.trim(),displayName:displayName.trim(),vehicleLabel:vehicle.trim()||undefined
       }),'Курьер назначен');
       if(saved){setNewUser('');setDisplayName('');await couriers.reload()}
     }}>
       <label>ID отдельного аккаунта <input className="field" value={newUser} onChange={e=>setNewUser(e.target.value)} required placeholder="UUID аккаунта"/></label>
       <label>Имя курьера <input className="field" value={displayName} onChange={e=>setDisplayName(e.target.value)} minLength={2} maxLength={80} required/></label>
       <label>Автомобиль <input className="field" value={vehicle} onChange={e=>setVehicle(e.target.value)} maxLength={100}/></label>
       <button className="btn" type="submit" disabled={busy||displayName.trim().length<2||!newUser}>Назначить</button>
     </form>
     <h3>Мои курьеры</h3>
     {couriers.error&&<p role="alert">{couriers.error}</p>}
     {couriers.data?.couriers.length===0&&<p className="note">Пока нет зарегистрированных курьеров.</p>}
     {couriers.data?.couriers.map(c=><div className="between" key={c.user_id}>
       <span><b>{c.display_name}</b> · {c.vehicle_label??'транспорт не указан'}
         <small className="note">{c.user_id}</small></span>
       <button className="btn ghost small" onClick={()=>setCourierId(c.user_id)}>Выбрать для рейса</button>
     </div>)}
   </section>
   <section className="card stack">
     <h2>Проверить адрес доставки</h2>
     <p className="note">Подтверждайте только реально проверенные адреса Санкт-Петербурга. При сомнениях нужно связаться с получателем; IP не является подтверждением адреса.</p>
     <form className="stack" onSubmit={async e=>{
       e.preventDefault();const saved=await run(()=>post('/api/admin/shop/delivery-addresses/'+verifyOrder.trim()+'/verify',{
         cityCode:'spb',evidence:verifyEvidence.trim()
       }),'Адрес проверен');if(saved){setVerifyOrder('');setVerifyEvidence('')}
     }}>
       <label>ID заказа магазина <input className="field" value={verifyOrder} onChange={e=>setVerifyOrder(e.target.value)} required/></label>
       <label>Как проверили адрес <textarea className="field" value={verifyEvidence} onChange={e=>setVerifyEvidence(e.target.value)}
         minLength={10} maxLength={500} required rows={2}/></label>
       <button className="btn" disabled={busy||verifyEvidence.trim().length<10} type="submit">Зафиксировать проверку</button>
     </form>
   </section>
   <SupplierReceivingDesk/>
   <section className="card stack">
     <h2>Составить рейс</h2>
     <p className="note">Порядок ID заказов определяет порядок доставки. Маршрутизатор ещё не подключён; здесь нет автоматического расчёта пути и ETA.</p>
     <form className="stack" onSubmit={async e=>{
       e.preventDefault();const orderIds=orders.split(/[,;\s]+/).map(x=>x.trim()).filter(Boolean);
       const saved=await run(()=>post('/api/admin/shop/courier-runs',{
         courierId:courierId.trim(),pickupAddress:warehouse.trim(),orderIds,packingRequired,traceabilityRequired,supplierReceiptRequired
       }),'План рейса сформирован');
       if(saved){setOrders('');setSelected(saved.id);await runs.reload();await economics.reload();}
     }}>
       <label>ID курьера <input className="field" value={courierId} onChange={e=>setCourierId(e.target.value)} required/></label>
       <label>Адрес склада <input className="field" value={warehouse} onChange={e=>setWarehouse(e.target.value)} minLength={10} required placeholder="Санкт-Петербург, …"/></label>
       <label>ID готовых заказов по порядку <textarea className="field" value={orders} onChange={e=>setOrders(e.target.value)}
         rows={4} placeholder="Каждый UUID на новой строке" required/></label>
       <label className="row">
         <input type="checkbox" checked={packingRequired}
           onChange={e=>{setPackingRequired(e.target.checked);
             if(!e.target.checked){setTraceabilityRequired(false);setSupplierReceiptRequired(false)}}}/>
         Обязательная складская сверка артикула и количества перед выдачей курьеру
       </label>
       <label className="row">
         <input type="checkbox" checked={traceabilityRequired} disabled={!packingRequired}
           onChange={e=>setTraceabilityRequired(e.target.checked)}/>
         Дополнительно требовать GTIN (EAN/UPC) и номер партии или серии каждой детали
       </label>
       <label className="row">
         <input type="checkbox" checked={supplierReceiptRequired} disabled={!packingRequired}
           onChange={e=>setSupplierReceiptRequired(e.target.checked)}/>
         Требовать принятые накладные поставщика на каждую позицию заказа
       </label>
       <p className="note">При включённой проверке отправку и забор
         курьером заблокирует недопоставка или отозванный акт. Это ручная
         приёмка, без подключения к API поставщика и без движения денег.</p>
       <p className="note">Строгая прослеживаемость включается только для нового рейса со
         складской сверкой. Контрольная цифра GTIN не доказывает подлинность товара
         или его применяемость к автомобилю. Сканер-клавиатура не считается
         аппаратно подтверждённым считывателем.</p>
       <p className="note">Если включить проверку, отправка рейса и забор посылки невозможны до подтверждения всех строк состава. Это не проверка оригинальности деталей.</p>
       <button className="btn" disabled={busy||!courierId||warehouse.trim().length<10||!orders.trim()} type="submit">
         Создать маршрут без отправки курьеру
       </button>
     </form>
   </section>
   <section className="card stack">
     <h2>Рейсы и экономика</h2>
     {runs.error&&<p role="alert">{runs.error}</p>}
     {runs.data?.runs.length===0&&<p className="note">Пока нет рейсов.</p>}
     <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
       {runs.data?.runs.map(r=><button key={r.id} type="button" className="btn ghost small"
         aria-pressed={selected===r.id} onClick={()=>setSelected(r.id)}>
         {r.courier_name} · {r.stops} заказ(ов) · {r.status}
       </button>)}
     </div>
     {chosen&&<>
       <p className="note">Рейс {chosen.id} · {chosen.status}</p>
       <CourierWarehouseCheck key={selected} runId={selected}/>
       {economics.error&&<p role="alert">{economics.error} <button onClick={economics.reload}>Обновить</button></p>}
       {economics.data&&<div className="card stack">
         <h3>Расчёт рейса</h3>
         <dl className="kv">
           <dt>Продажи запчастей</dt><dd>{asRub(economics.data.goodsRevenueKopecks)}</dd>
           <dt>Подтверждённая закупка</dt><dd>{asRub(economics.data.procurementTotalKopecks)}</dd>
           <dt>Торговая маржа</dt><dd>{asRub(economics.data.tradingMarkupKopecks)}</dd>
           <dt>Оплата за доставку</dt><dd>{asRub(economics.data.deliveryRevenueKopecks)}</dd>
           <dt>План расходов на рейс</dt><dd>{asRub(economics.data.forecastExpensesKopecks)}</dd>
           <dt>Прогноз вклада рейса</dt><dd>{asRub(economics.data.routeContributionKopecks)}</dd>
           <dt>Комиссия платформы 5% (не включена и не проведена)</dt><dd>{asRub(economics.data.platformCommissionEstimateKopecks)}</dd>
         </dl>
         {economics.data.supplierReceiptRequired&&
         <p role="status">Акты поставщика: {economics.data.supplierReceiptReady?
           'полное количество принято':'приёмка не завершена — выдача заблокирована'}</p>}
       <p className="note">{economics.data.warning}</p>
         {!economics.data.canApprove&&<p role="alert">Утверждать нельзя: отсутствует смета/подтверждённая закупка, не готов заказ или открыт спор с поставщиком.</p>}
       </div>}
       {chosen.status==='planned'&&<>
         <form className="stack" onSubmit={e=>{e.preventDefault();void saveBudget()}}>
           <h3>Смета затрат (рубли)</h3>
           <div className="grid2">
             {(Object.keys(zeros) as Array<keyof typeof zeros>).map(k=><label key={k}>{budgetNames[k]}
               <input className="field" inputMode="decimal" value={budget[k]} onChange={e=>updateBudget(k,e.target.value)} required/>
             </label>)}
           </div>
           <label>Основание сметы <textarea className="field" minLength={10} maxLength={1000} rows={3}
             value={budgetNote} onChange={e=>setBudgetNote(e.target.value)} required/></label>
           <button className="btn" type="submit" disabled={busy||budgetNote.trim().length<10}>Сохранить смету</button>
         </form>
         <label>Причина исключения для убыточного рейса (не менее 30 символов)
           <textarea className="field" rows={3} value={exception} onChange={e=>setException(e.target.value)} maxLength={700}/>
         </label>
         <button className="btn" disabled={busy||!economics.data?.canApprove||
           (economics.data.routeContributionKopecks??0)<0&&exception.trim().length<30}
           onClick={async()=>{
             const result=await run(()=>post('/api/admin/shop/courier-runs/'+selected+'/approve-dispatch',{
               exceptionReason:exception.trim()||undefined
             }),'Рейс утверждён и доступен курьеру');if(result){await runs.reload();await economics.reload()}
           }}>Проверить и отправить рейс курьеру</button>
         <label>Отмена запланированного рейса
           <textarea className="field" rows={2} value={cancelReason} onChange={e=>setCancelReason(e.target.value)} maxLength={700}/>
         </label>
         <button className="btn ghost" disabled={busy||cancelReason.trim().length<20}
           onClick={async()=>{
             const result=await run(()=>post('/api/admin/shop/courier-runs/'+selected+'/cancel',
               {reason:cancelReason.trim()}),'Плановый рейс снят');
             if(result){setSelected('');await runs.reload();}
           }}>Отменить плановый рейс с обоснованием</button>
       </>}
       {chosen.status==='returning'&&<>
         <h3>Возврат невручённых товаров на склад</h3>
         <p>Подтвердите только реальную сверку посылок и пломб. Нельзя считать деньги клиенту возвращёнными автоматически.</p>
         <textarea className="field" minLength={25} maxLength={1000} rows={3} value={returnEvidence}
           onChange={e=>setReturnEvidence(e.target.value)} placeholder="Документ, количество, сверка товара и ответственный"/>
         <button className="btn" disabled={busy||returnEvidence.trim().length<25}
           onClick={async()=>{
             const result=await run(()=>post('/api/admin/shop/courier-runs/'+selected+
               '/confirm-warehouse-return',{evidence:returnEvidence.trim()}),
               'Возврат на склад подтверждён');
             if(result){setSelected('');setReturnEvidence('');await runs.reload();}
           }}>Подтвердить фактический возврат</button>
       </>}
     </>}
   </section>
 </main>;
}
