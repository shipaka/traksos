import {useEffect,useState} from 'react';
import {get,post,del,rub} from '../api.ts';

type Entry={id:string;kind:string;amount_kopeks:string;incurred_on:string;note:string};
type Summary={entries:Entry[];totalKopeks:number;totals:{kind:string;amount_kopeks:string}[];
 note:string;separateFromPlatformPayments:true};
const types=[
 ['fuel','Топливо'],['maintenance','Обслуживание'],['tyres','Шины'],
 ['tolls','Платные дороги'],['insurance','Страхование'],['other','Прочее']
] as const;
const label=(kind:string)=>types.find(x=>x[0]===kind)?.[1]??kind;
export function VehicleOwnerExpenses({vehicleId}:{vehicleId:string}){
 const [open,setOpen]=useState(false);
 const [data,setData]=useState<Summary|null>(null);
 const [error,setError]=useState('');
 const [amount,setAmount]=useState('');
 const [kind,setKind]=useState('fuel');
 const [date,setDate]=useState(()=>new Date().toISOString().slice(0,10));
 const [note,setNote]=useState('');
 const [busy,setBusy]=useState(false);
 const [revision,setRevision]=useState(0);
 useEffect(()=>{
   if(!open)return;
   let active=true;
   get<Summary>('/api/vehicles/'+vehicleId+'/costs')
     .then(x=>{if(active){setData(x);setError('')}})
     .catch((e:Error)=>{if(active)setError(e.message)});
   return()=>{active=false};
 },[open,vehicleId,revision]);
 const kopeks=Math.round(Number(amount)*100);
 const submit=async()=>{
   setBusy(true);setError('');
   try{await post('/api/vehicles/'+vehicleId+'/costs',{
     kind,incurredOn:date,amountKopeks:kopeks,note:note.trim()
   });setAmount('');setNote('');setRevision(x=>x+1)}
   catch(e:any){setError(e.message||'Не удалось записать расход')}
   finally{setBusy(false)}
 };
 const remove=async(id:string)=>{
   if(!window.confirm('Удалить личную запись о расходе?'))return;
   setBusy(true);setError('');
   try{await del('/api/vehicles/'+vehicleId+'/costs/'+id);setRevision(x=>x+1)}
   catch(e:any){setError(e.message||'Не удалось удалить')}
   finally{setBusy(false)}
 };
 return <section className="vehicle-expenses">
   <button className="linkrow" aria-expanded={open} type="button" onClick={()=>setOpen(v=>!v)}>
     <span><b>Финансы по этой технике</b><small>Топливо, шины, ТО, дороги и личные расходы</small></span>
     <span aria-hidden="true">{open?'−':'+'}</span>
   </button>
   {open&&<div className="stack" style={{marginTop:12}}>
     {error&&<p role="alert" className="note">{error}</p>}
     {!data?<p className="note">Загружаю расходы этой машины…</p>:<>
       <div className="card stack" style={{gap:7}}>
         <b>Личные расходы: {rub(data.totalKopeks)}</b>
         {data.totals.length>0&&<div className="row" style={{flexWrap:'wrap'}}>
           {data.totals.map(x=><span className="pill" key={x.kind}>{label(x.kind)} · {rub(Number(x.amount_kopeks))}</span>)}
         </div>}
         <small className="note">Личные записи не прибавляются к платежам TrakSOS автоматически, чтобы не возникало двойного учёта.</small>
       </div>
       <div className="card stack">
         <b>Добавить расход</b>
         <div className="grid2">
           <select className="field" aria-label="Категория расхода" value={kind} onChange={e=>setKind(e.target.value)}>
             {types.map(([k,title])=><option key={k} value={k}>{title}</option>)}
           </select>
           <input className="field" type="date" aria-label="Дата расхода" value={date}
             onChange={e=>setDate(e.target.value)}/>
         </div>
         <input className="field" type="number" inputMode="decimal" min="0.01" step="0.01"
           aria-label="Сумма в рублях" placeholder="Сумма, ₽" value={amount}
           onChange={e=>setAmount(e.target.value)}/>
         <input className="field" aria-label="Описание расхода" placeholder="Например, заправка или замена шин"
           maxLength={500} value={note} onChange={e=>setNote(e.target.value)}/>
         <button className="btn small" type="button" onClick={()=>void submit()}
           disabled={busy||!Number.isSafeInteger(kopeks)||kopeks<=0||kopeks>100_000_000_000||!date}>Записать расход</button>
       </div>
       {data.entries.map(x=><div className="between" key={x.id} style={{gap:12,alignItems:'center'}}>
         <div className="stack" style={{gap:2,minWidth:0}}>
           <b>{label(x.kind)} · {rub(Number(x.amount_kopeks))}</b>
           <small className="note">{x.incurred_on}{x.note?' · '+x.note:''}</small>
         </div>
         <button className="btn ghost small" disabled={busy} type="button"
           onClick={()=>void remove(x.id)}>Удалить</button>
       </div>)}
     </>}
   </div>}
 </section>;
}
