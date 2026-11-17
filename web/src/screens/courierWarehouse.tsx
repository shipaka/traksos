import {useState} from 'react';
import {get,post,fmtTime} from '../api.ts';
import {useAction,useLoad} from '../ui.tsx';

type WarehouseIssue={id:string;kind:string;note:string;observedArticle:string;
 observedQty:number;reportedAt:string};
type WarehouseTrace={gtin:string;lot:string|null;serials:string[];method:string;recordedAt:string};
type Line={index:number;name:string;brand:string|null;article:string|null;
 quantity:number;verified:boolean;method:string|null;checkedAt:string|null;blockedReason:string|null;
 recheckedAfterDiscrepancy:boolean;openDiscrepancy:WarehouseIssue|null;
 traceabilityVerified:boolean;trace:WarehouseTrace|null};
type IssueRecord={id:string;stop_id:string|null;order_number:number;line_index:number;kind:string;
 expected_article:string;expected_qty:number;observed_article:string;observed_qty:number;
 note:string;reported_at:string;status:string;resolved_at:string|null;resolution_note:string|null};
type Stop={id:string;orderNumber:number;status:string;lines:Line[]};
type Progress={runId:string;packingRequired:boolean;traceabilityRequired:boolean;runStatus:string;dispatchApproved:boolean;
 totalLines:number;remainingLines:number;openDiscrepancies:number;ready:boolean;stops:Stop[];warning:string};
type Input={article:string;quantity:string;method:'scanner'|'manual';reason:string};
const empty:Input={article:'',quantity:'',method:'scanner',reason:''};
type TraceInput={gtin:string;lot:string;serialsText:string;
 inputMethod:'manual'|'keyboard_wedge';manualReason:string};
const emptyTrace:TraceInput={
 gtin:'',lot:'',serialsText:'',inputMethod:'keyboard_wedge',manualReason:''
};
type IncidentInput={kind:'wrong_article'|'shortage'|'surplus'|'damaged'|'seal_broken'|'other';
 observedArticle:string;observedQty:string;note:string};
const emptyIssue:IncidentInput={kind:'wrong_article',observedArticle:'',observedQty:'',
  note:''};
const kindNames:Record<IncidentInput['kind'],string>={
 wrong_article:'Другой артикул',shortage:'Недовложение',
 surplus:'Лишнее количество',damaged:'Повреждение товара',
 seal_broken:'Нарушена пломба или упаковка',other:'Другое расхождение'
};

/** Warehouse scanner works as a hardware keyboard. No camera permission or GPS. */
export function CourierWarehouseCheck({runId}:{runId:string}){
 const result=useLoad<Progress>(()=>get('/api/admin/shop/courier-runs/'+runId+'/warehouse'),[runId]);
 const incidents=useLoad<{discrepancies:IssueRecord[]}>(()=>
   get('/api/admin/shop/courier-runs/'+runId+'/warehouse/discrepancies'),[runId]);
 const {busy,run}=useAction();
 const [forms,setForms]=useState<Record<string,Input>>({});
 const [traceForms,setTraceForms]=useState<Record<string,TraceInput>>({});
 const [issueForms,setIssueForms]=useState<Record<string,IncidentInput>>({});
 const [resolutionNotes,setResolutionNotes]=useState<Record<string,string>>({});
 const patch=(id:string,partial:Partial<Input>)=>
   setForms(current=>({...current,[id]:{...(current[id]??empty),...partial}}));
 const patchTrace=(id:string,partial:Partial<TraceInput>)=>
   setTraceForms(current=>({...current,[id]:{...(current[id]??emptyTrace),...partial}}));
 const patchIssue=(key:string,partial:Partial<IncidentInput>)=>
   setIssueForms(current=>({...current,[key]:{...(current[key]??emptyIssue),...partial}}));
 const reportIssue=async(stopId:string,line:Line)=>{
   const form=issueForms[stopId+':'+line.index]??emptyIssue;
   if(form.note.trim().length<20)return;
   const saved=await run(()=>post('/api/admin/shop/courier-runs/'+runId+
     '/warehouse/stops/'+stopId+'/discrepancies',{
       lineIndex:line.index,kind:form.kind,
       observedArticle:form.observedArticle.trim(),
       observedQty:Number(form.observedQty),note:form.note.trim()
     }),'Расхождение зарегистрировано; отправка заблокирована');
   if(saved){setIssueForms(v=>{const x={...v};delete x[stopId+':'+line.index];return x});
     await Promise.all([result.reload(),incidents.reload()]);
   }
 };
 const resolveIssue=async(stopId:string,line:Line)=>{
   const item=line.openDiscrepancy;
   if(!item)return;
   const note=(resolutionNotes[item.id]??'').trim();
   if(note.length<20)return;
   const saved=await run(()=>post('/api/admin/shop/courier-runs/'+runId+
     '/warehouse/stops/'+stopId+'/discrepancies/'+item.id+'/resolve',{note}),
     'Случай закрыт после повторной физической сверки');
   if(saved){setResolutionNotes(v=>{const x={...v};delete x[item.id];return x});
     await Promise.all([result.reload(),incidents.reload()]);
   }
 };
 const saveTrace=async(stopId:string,line:Line)=>{
   const key=stopId+':'+line.index,form=traceForms[key]??emptyTrace;
   const serials=form.serialsText.split(/[;,\n]+/).map(x=>x.trim()).filter(Boolean);
   if(!form.gtin.trim()||(!form.lot.trim()&&serials.length===0))return;
   const saved=await run(()=>post('/api/admin/shop/courier-runs/'+runId+
     '/warehouse/stops/'+stopId+'/trace',{
       lineIndex:line.index,gtin:form.gtin.trim(),
       lot:form.lot.trim()||null,serials,
       inputMethod:form.inputMethod,
       manualReason:form.inputMethod==='manual'?form.manualReason.trim():null
     }),'Маркировка записана. Это не подтверждение подлинности детали.');
   if(saved){
     setTraceForms(v=>{const n={...v};delete n[key];return n});
     await result.reload();
   }
 };
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
     await Promise.all([result.reload(),incidents.reload()]);
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
       {' · '}Всего строк: {p.totalLines}
       {p.openDiscrepancies>0?' · Открытых расхождений: '+p.openDiscrepancies:''}</p>
     {p.openDiscrepancies>0&&<p role="alert" className="note">
       Отправка рейса и выдача посылок заблокированы до новой физической
       сверки каждой проблемной строки и документированного закрытия расхождений.
     </p>}
     <p className="note">{p.warning}</p>
     {p.traceabilityRequired&&<p className="note">
       В этом новом рейсе обязательны GTIN с правильной контрольной цифрой и
       партия либо серийные номера всех единиц. Прежде всего выполните физическую
       сверку артикула и количества; после исправлений маркировку нужно записать вновь.
     </p>
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
           {p.traceabilityRequired&&<div className="stack">
             {line.traceabilityVerified?<p role="status">
               Маркировка записана: GTIN {line.trace?.gtin}
               {line.trace?.lot?' · партия '+line.trace.lot:''}
               {line.trace?.serials.length?' · серии '+line.trace.serials.join(', '):''}
             </p>:<p role="status">Маркировка GTIN/партии не подтверждена.</p>}
             {!locked&&line.verified&&!line.openDiscrepancy&&<form className="stack"
               onSubmit={e=>{e.preventDefault();void saveTrace(stop.id,line)}}>
               <label>GTIN / EAN / UPC — цифры со штрихкода
                 <input className="field" inputMode="numeric" maxLength={14}
                   autoComplete="off" placeholder="8, 12, 13 или 14 цифр"
                   value={(traceForms[key]??emptyTrace).gtin}
                   onChange={e=>patchTrace(key,{gtin:e.target.value})} required/>
               </label>
               <label>Номер партии (если применяется)
                 <input className="field" maxLength={80} autoComplete="off"
                   value={(traceForms[key]??emptyTrace).lot}
                   onChange={e=>patchTrace(key,{lot:e.target.value})}/>
               </label>
               <label>Серийные номера (если есть; один для каждой единицы, через строку)
                 <textarea className="field" rows={3}
                   value={(traceForms[key]??emptyTrace).serialsText}
                   onChange={e=>patchTrace(key,{serialsText:e.target.value})}/>
               </label>
               <label>Способ ввода маркировки
                 <select className="field" value={(traceForms[key]??emptyTrace).inputMethod}
                   onChange={e=>patchTrace(key,{inputMethod:e.target.value as TraceInput['inputMethod']})}>
                   <option value="keyboard_wedge">Сканер или ввод с клавиатуры</option>
                   <option value="manual">Ручная запись с объяснением</option>
                 </select>
               </label>
               {(traceForms[key]??emptyTrace).inputMethod==='manual'&&
                 <label>Причина ручной записи
                   <textarea className="field" minLength={15} maxLength={500} rows={2}
                     value={(traceForms[key]??emptyTrace).manualReason}
                     onChange={e=>patchTrace(key,{manualReason:e.target.value})}/>
                 </label>}
               <button className="btn ghost" type="submit" disabled={busy||
                 (traceForms[key]?.gtin.trim().length??0)<8||
                 !((traceForms[key]?.lot.trim().length??0)>0||
                   (traceForms[key]?.serialsText.trim().length??0)>0)||
                 (traceForms[key]?.inputMethod==='manual'&&
                   (traceForms[key]?.manualReason.trim().length??0)<15)}>
                 Зафиксировать маркировку
               </button>
             </form>}
           </div>}
           {line.openDiscrepancy&&<div className="stack" role="status">
             <strong>Открытое складское расхождение</strong>
             <p className="note">{kindNames[line.openDiscrepancy.kind as IncidentInput['kind']]??
               line.openDiscrepancy.kind}
               {' · '}{fmtTime(line.openDiscrepancy.reportedAt)}</p>
             <p className="note">Фактически: {line.openDiscrepancy.observedArticle||'артикул не указан'},
               количество {line.openDiscrepancy.observedQty}</p>
             <p>{line.openDiscrepancy.note}</p>
             {line.recheckedAfterDiscrepancy?<p className="note">
               Повторная сверка совпала с заказом. Случай можно закрыть с основанием.
             </p>:<p className="note">Требуется повторно пересчитать и сверить правильный артикул.</p>}
             {!locked&&<>
               <label>Основание закрытия после повторной сверки
                 <textarea className="field" rows={2} minLength={20} maxLength={1000}
                   value={resolutionNotes[line.openDiscrepancy.id]??''}
                   onChange={e=>setResolutionNotes(v=>({...v,
                     [line.openDiscrepancy!.id]:e.target.value}))}/>
               </label>
               <button type="button" className="btn ghost" disabled={busy||
                 !line.recheckedAfterDiscrepancy||
                 (resolutionNotes[line.openDiscrepancy.id]?.trim().length??0)<20}
                 onClick={()=>void resolveIssue(stop.id,line)}>
                 Закрыть после повторной сверки
               </button>
             </>}
           </div>}
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
           {!locked&&!line.openDiscrepancy&&<details className="stack">
             <summary>Сообщить о расхождении или повреждении</summary>
             <form className="stack" onSubmit={e=>{
               e.preventDefault();void reportIssue(stop.id,line);
             }}>
               <label>Что обнаружено
                 <select className="field" value={(issueForms[key]??emptyIssue).kind}
                   onChange={e=>patchIssue(key,{
                     kind:e.target.value as IncidentInput['kind']})}>
                   {Object.entries(kindNames).map(([k,v])=><option value={k} key={k}>{v}</option>)}
                 </select>
               </label>
               <label>Фактический артикул (если читается)
                 <input className="field" maxLength={100}
                   value={(issueForms[key]??emptyIssue).observedArticle}
                   onChange={e=>patchIssue(key,{observedArticle:e.target.value})}/>
               </label>
               <label>Фактическое количество
                 <input className="field" type="number" min={0} max={10000} required
                   value={(issueForms[key]??emptyIssue).observedQty}
                   onChange={e=>patchIssue(key,{observedQty:e.target.value})}/>
               </label>
               <label>Подробное описание проблемы
                 <textarea className="field" rows={3} minLength={20} maxLength={1000}
                   required value={(issueForms[key]??emptyIssue).note}
                   onChange={e=>patchIssue(key,{note:e.target.value})}/>
               </label>
               <button className="btn ghost" type="submit" disabled={busy||
                 (issueForms[key]?.note.trim().length??0)<20||
                 !(issueForms[key]?.observedQty.trim().length)}>
                 Зафиксировать проблему и остановить выдачу
               </button>
             </form>
           </details>}
         </div>
       })}
     </article>)}
     {incidents.data?.discrepancies.length? <details className="stack">
       <summary>История складских расхождений ({incidents.data.discrepancies.length})</summary>
       {incidents.data.discrepancies.map(x=><div className="card stack" key={x.id}>
         <strong>Заказ №{x.order_number} · {kindNames[x.kind as IncidentInput['kind']]??x.kind}
           {' · '}{x.status==='open'?'не закрыто':'урегулировано'}</strong>
         <p className="note">Заказанная позиция {x.expected_article} × {x.expected_qty};
           фактическая {x.observed_article||'не читается'} × {x.observed_qty}</p>
         <p>{x.note}</p>
         <p className="note">Выявлено {fmtTime(x.reported_at)}
           {x.resolved_at?' · закрыто '+fmtTime(x.resolved_at):''}</p>
         {x.resolution_note&&<p>Итог: {x.resolution_note}</p>}
       </div>)}
     </details>:null}
     {incidents.error&&<p role="alert">{incidents.error}
       <button type="button" className="btn ghost" onClick={incidents.reload}>Повторить</button>
     </p>}
     <p className="note">{p.dispatchApproved
       ?'Рейс утверждён. Складской журнал закрыт для редактирования.'
       :'Перед утверждением рейса система проверит каждый артикул и количество повторно.'}</p>
   </>}
 </section>;
}
