import {useState} from 'react';
import {get,post,fmtTime} from '../api.ts';
import {useAction,useLoad} from '../ui.tsx';

type Line={index:number;name:string;brand:string|null;article:string|null;
 quantity:number;verified:boolean;method:string|null;checkedAt:string|null;blockedReason:string|null};
type Stop={id:string;orderNumber:number;status:string;lines:Line[]};
type Progress={runId:string;packingRequired:boolean;runStatus:string;dispatchApproved:boolean;
 totalLines:number;remainingLines:number;ready:boolean;stops:Stop[];warning:string};
type Input={article:string;quantity:string;method:'scanner'|'manual';reason:string};
const empty:Input={article:'',quantity:'',method:'scanner',reason:''};

/** Warehouse scanner works as a hardware keyboard. No camera permission or GPS. */
export function CourierWarehouseCheck({runId}:{runId:string}){
 const result=useLoad<Progress>(()=>get('/api/admin/shop/courier-runs/'+runId+'/warehouse'),[runId]);
 const {busy,run}=useAction();
 const [forms,setForms]=useState<Record<string,Input>>({});
 const patch=(id:string,partial:Partial<Input>)=>
   setForms(current=>({...current,[id]:{...(current[id]??empty),...partial}}));
 const save=async(stopId:string,line:Line)=>{
   const key=stopId+':'+line.index;
   const state=forms[key]??empty;
   if(!state.article.trim()||!state.quantity.trim())return;
   const qty=Number(state.quantity);
   if(!Number.isSafeInteger(qty)||qty<=0)return;
   const outcome=await run(()=>post('/api/admin/shop/courier-runs/'+runId+
     '/warehouse/stops/'+stopId+'/verify',{
       lineIndex:line.index,article:state.article.trim(),quantity:qty,
       method:state.method,manualReason:state.method==='manual'?state.reason.trim():undefined
     }),'Сверка артикула и количества записана');
   if(outcome){
     setForms(current=>{const next={...current};delete next[key];return next});
     await result.reload();
   }
 };
 if(result.error)return <p role="alert">{result.error}
   <button className="btn ghost" type="button" onClick={result.reload}>Повторить</button>
 </p>;
 if(!result.data)return <p className="note">Загружаю контроль комплектации…</p>;
 const p=result.data;
 return <section className="card stack" aria-label="Складская сверка артикула и количества">
   <h3>Складская сверка запчастей</h3>
   {!p.packingRequired?<p className="note">
     Для этого рейса строгая сверка артикулов не включена при планировании.
     Новый рейс можно создать с обязательным контролем.
   </p>:<>
     <p role="status">{p.ready?'Все позиции подтверждены.':'Не проверено позиций: '+p.remainingLines}
       {' · '}Всего строк: {p.totalLines}</p>
     <p className="note">{p.warning}</p>
     {p.stops.map(stop=><article key={stop.id} className="card stack">
       <h4>Заказ №{stop.orderNumber}</h4>
       {stop.lines.length===0&&<p role="alert">Состав заказа отсутствует: запрещено подтверждать пустую посылку.</p>}
       {stop.lines.map(line=>{
         const key=stop.id+':'+line.index,entry=forms[key]??empty;
         const locked=p.dispatchApproved||p.runStatus!=='planned';
         return <div className="card stack" key={key}>
           <strong>{line.name}</strong>
           <p className="note">Артикул заказа: {line.article??'не указан'}
             {' · '}Количество: {line.quantity}
             {line.brand?' · '+line.brand:''}</p>
           {line.verified?<p role="status">Сверено: {line.method==='scanner'?'сканер':'ручная сверка'}
             {line.checkedAt?' · '+fmtTime(line.checkedAt):''}
           </p>:<p role="status">{line.blockedReason??'Не сверено'}</p>}
           {!locked&&line.article&&<form className="stack" onSubmit={e=>{
             e.preventDefault();void save(stop.id,line);
           }}>
             <label>Сканировать / ввести фактический артикул
               <input className="field" value={entry.article} maxLength={100}
                 autoComplete="off" placeholder="Отсканируйте штрихкод или маркировку"
                 onChange={e=>patch(key,{article:e.target.value})} required/>
             </label>
             <label>Фактически пересчитанное количество
               <input className="field" type="number" min={1} max={10000}
                 value={entry.quantity} onChange={e=>patch(key,{quantity:e.target.value})} required/>
             </label>
             <label>Способ сверки
               <select className="field" value={entry.method}
                 onChange={e=>patch(key,{method:e.target.value as Input['method']})}>
                 <option value="scanner">Сканером</option>
                 <option value="manual">Ручная проверка маркировки</option>
               </select>
             </label>
             {entry.method==='manual'&&<label>Почему не использован сканер
               <textarea className="field" rows={2} minLength={15} maxLength={500}
                 value={entry.reason} onChange={e=>patch(key,{reason:e.target.value})}/>
             </label>}
             <button className="btn" type="submit" disabled={busy||
               entry.article.trim().length<2||!entry.quantity.trim()||
               entry.method==='manual'&&entry.reason.trim().length<15}>
               Подтвердить физическую сверку
             </button>
           </form>}
         </div>
       })}
     </article>)}
     <p className="note">{p.dispatchApproved
       ?'Рейс утверждён. Складской журнал закрыт для редактирования.'
       :'Перед утверждением рейса система проверит каждый артикул и количество повторно.'}</p>
   </>}
 </section>;
}
