import {useState} from 'react';
import {get,post,fmtTime} from '../api.ts';
import {useAction,useLoad} from '../ui.tsx';

type Flag={id:string;case_id:string;reply_id:string|null;reason:string;
  created_at:string;subsystem:string;case_state:string;reported_text:string;
  reply_state:string|null;club_title:string};
export function TechnicalCaseReportQueue(){
 const records=useLoad<{reports:Flag[];moderationIsHuman:boolean}>(()=>
   get('/api/admin/community/pro-cases/reports'),[]);
 const {busy,run}=useAction();
 const [note,setNote]=useState<Record<string,string>>({});
 const [choice,setChoice]=useState<Record<string,'dismiss'|'hide'|'restore'>>({});
 const decide=async(flag:Flag)=>{
   const decision=choice[flag.id]??'hide';
   const body={decision,note:(note[flag.id]??'').trim()};
   const result=await run(()=>post(
     '/api/admin/community/pro-cases/reports/'+flag.id+'/review',body),
     'Решение модератора сохранено');
   if(result){
     setNote(current=>{const next={...current};delete next[flag.id];return next});
     await records.reload();
   }
 };
 return <section className="tech-section" aria-label="Жалобы на технические консультации">
   <h2>Жалобы на советы мастеров</h2>
   <p className="note">Решение принимает человек. Скрытие опасного ответа убирает
     отметку о принятом решении; связанный материал ТехБазы возвращается на проверку.
     Нельзя автоматически считать совет правильным только из-за рейтинга автора.</p>
   {records.error&&<p role="alert">{records.error}
     <button className="btn ghost" type="button" onClick={records.reload}>Повторить</button>
   </p>}
   {records.data?.reports.length===0&&<p className="tech-empty">
     Открытых жалоб на технические вопросы нет.
   </p>}
   {records.data?.reports.map(flag=><article className="tech-review" key={flag.id}>
     <h3>{flag.club_title} · {flag.subsystem}</h3>
     <p className="note">{flag.reply_id?'Жалоба на ответ':'Жалоба на вопрос'}
       {' · '}{fmtTime(flag.created_at)}</p>
     <p><strong>Причина обращения:</strong> {flag.reason}</p>
     <p className="tech-description">{flag.reported_text}</p>
     <p className="note">Состояние: {flag.reply_id?flag.reply_state:flag.case_state}</p>
     <label>Решение модератора
       <select className="field" value={choice[flag.id]??'hide'}
         onChange={e=>setChoice(v=>({...v,[flag.id]:e.target.value as 'dismiss'|'hide'|'restore'}))}>
         <option value="hide">Скрыть опасный материал</option>
         <option value="dismiss">Отклонить жалобу</option>
         <option value="restore">Вернуть после проверки</option>
       </select>
     </label>
     <label>Подробное основание решения
       <textarea className="field" minLength={15} maxLength={1000}
         rows={3} value={note[flag.id]??''}
         onChange={e=>setNote(v=>({...v,[flag.id]:e.target.value}))}
         placeholder="Что проверено и почему принято решение?"/>
     </label>
     <button type="button" className="btn"
       disabled={busy||(note[flag.id]?.trim().length??0)<15}
       onClick={()=>void decide(flag)}>Сохранить решение</button>
   </article>)}
 </section>;
}
