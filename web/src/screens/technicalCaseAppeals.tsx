import {useState} from 'react';
import {get,post,fmtTime} from '../api.ts';
import {useAction,useLoad} from '../ui.tsx';

type MyDecision={report_id:string;case_id:string;reply_id:string|null;reviewed_at:string;
  review_note:string|null;appeal_id:string|null;appeal_status:string|null};
type PendingAppeal={id:string;report_id:string;case_id:string;reply_id:string|null;
  grounds:string;created_at:string;status:string;
  moderator_id:string|null;moderator_note:string|null;
  source_text:string;club_title:string};

export function MyTechnicalAppeals(){
 const records=useLoad<{decisions:MyDecision[];reporterIdentityHidden:boolean}>(
   ()=>get('/api/community/pro-cases/my-moderation'),[]);
 const {busy,run}=useAction();
 const [grounds,setGrounds]=useState<Record<string,string>>({});
 const [opened,setOpened]=useState<string|null>(null);
 const submit=async(item:MyDecision)=>{
   const reason=(grounds[item.report_id]??'').trim();
   if(reason.length<30)return;
   const saved=await run(()=>post('/api/community/pro-cases/appeals',{
     reportId:item.report_id,grounds:reason
   }),'Возражение отправлено независимому модератору');
   if(saved){setOpened(null);await records.reload()}
 };
 return <section className="tech-section" aria-label="Мои обжалования решений модерации">
   <h2>Мои решения и обжалования</h2>
   <p className="note">Здесь видны только решения о скрытии ваших собственных
     технических материалов, а не личности заявителей. Другое должностное
     лицо рассматривает апелляцию с записью основания.</p>
   {records.error&&<p role="alert">{records.error}
     <button type="button" className="btn ghost" onClick={records.reload}>Повторить</button>
   </p>}
   {records.data?.decisions.length===0&&<p className="tech-empty">
     Решений о скрытии ваших технических материалов нет.
   </p>}
   {records.data?.decisions.map(item=><article className="tech-draft" key={item.report_id}>
     <h3>{item.reply_id?'Скрытый ответ':'Скрытый технический вопрос'}</h3>
     <p className="note">{fmtTime(item.reviewed_at)}</p>
     <p>{item.review_note??'Решение модератора без опубликованного пояснения'}</p>
     {item.appeal_status?
       <p role="status">Статус обжалования: {item.appeal_status==='pending'
         ?'на независимой проверке':item.appeal_status==='upheld'
         ?'решение подтверждено':'решение отменено'}</p>:
       <>
         {opened===item.report_id&&<form className="tech-form" onSubmit={e=>{
           e.preventDefault();void submit(item);
         }}>
           <label>Ваши аргументы и фактические основания для пересмотра
             <textarea className="field" rows={4} minLength={30} maxLength={1500}
               required value={grounds[item.report_id]??''}
               onChange={e=>setGrounds(v=>({...v,[item.report_id]:e.target.value}))}/>
           </label>
           <p className="note">Не включайте сюда контакты клиента, VIN или персональные данные.</p>
           <button type="submit" className="btn"
             disabled={busy||(grounds[item.report_id]?.trim().length??0)<30}>
             Передать на рассмотрение
           </button>
         </form>}
         <button type="button" className="btn ghost"
           onClick={()=>setOpened(v=>v===item.report_id?null:item.report_id)}>
           {opened===item.report_id?'Свернуть':'Оспорить решение'}
         </button>
       </>}
   </article>)}
 </section>;
}

export function TechnicalAppealsQueue(){
 const entries=useLoad<{appeals:PendingAppeal[];originalReviewerCannotResolve:boolean}>(
   ()=>get('/api/admin/community/pro-cases/appeals'),[]);
 const {busy,run}=useAction();
 const [notes,setNotes]=useState<Record<string,string>>({});
 const [decisions,setDecisions]=useState<Record<string,'upheld'|'overturned'>>({});
 const review=async(a:PendingAppeal)=>{
   const note=(notes[a.id]??'').trim(),decision=decisions[a.id]??'upheld';
   if(note.length<15)return;
   const saved=await run(()=>post('/api/admin/community/pro-cases/appeals/'+a.id+'/review',
     {decision,note}),'Решение по апелляции записано в аудит');
   if(saved)await entries.reload();
 };
 return <section className="tech-section" aria-label="Независимая проверка технических апелляций">
   <h2>Обжалование решений модераторов</h2>
   <p className="note">Сотрудник не вправе пересматривать собственное решение.
     Отмена скрытия не утверждает инструкцию и не восстанавливает
     ранее принятую опасную рекомендацию автоматически.</p>
   {entries.error&&<p role="alert">{entries.error}
     <button className="btn ghost" type="button" onClick={entries.reload}>Повторить</button>
   </p>}
   {entries.data?.appeals.length===0&&<p className="tech-empty">
     Ожидающих независимого рассмотрения обращений нет.
   </p>}
   {entries.data?.appeals.map(a=><article className="tech-review" key={a.id}>
     <h3>{a.club_title} · {a.reply_id?'Ответ специалиста':'Техническая карточка'}</h3>
     <p className="note">Подано: {fmtTime(a.created_at)}</p>
     <p className="tech-description">{a.source_text}</p>
     <p><strong>Аргументы автора:</strong> {a.grounds}</p>
     <p className="note">Исходное решение: {a.moderator_note??'Причина не опубликована'}</p>
     <label>Результат независимой проверки
       <select className="field" value={decisions[a.id]??'upheld'}
         onChange={e=>setDecisions(v=>({...v,[a.id]:
           e.target.value as 'upheld'|'overturned'}))}>
         <option value="upheld">Подтвердить скрытие</option>
         <option value="overturned">Отменить скрытие</option>
       </select>
     </label>
     <label>Фактическое основание решения
       <textarea className="field" required minLength={15} maxLength={1500}
         rows={3} value={notes[a.id]??''}
         onChange={e=>setNotes(v=>({...v,[a.id]:e.target.value}))}/>
     </label>
     <button className="btn" type="button" disabled={busy||(notes[a.id]?.trim().length??0)<15}
       onClick={()=>void review(a)}>Сохранить независимое решение</button>
   </article>)}
 </section>;
}
