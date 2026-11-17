import {useEffect,useRef,useState} from 'react';
import {get,post,fmtTime} from '../api.ts';
import {useAction,useLoad,useMe} from '../ui.tsx';
import './techBase.css';
import {CommunityMuteToggle} from './communityNotificationSettings.tsx';
import {TechnicalEvidenceLinks} from './technicalEvidence.tsx';

type Club={id:string;slug:string;title:string;audience:string;joined:boolean};
type Case={
 id:string;room_id:string;status:'open'|'resolved';make:string|null;model:string|null;
 model_year:number|null;subsystem:string;symptoms:string;dtc_codes:string[];
 diagnostic_context:string|null;origin:string;nickname:string;isAuthor:boolean;
 hasKnowledgeProposal:boolean;accepted_reply_id:string|null;created_at:string;
};
type Preview={make:string|null;model:string|null;modelYear:number|null;
 subsystem:string|null;note:string};
type Reply={id:string;body:string;nickname:string;created_at:string;isMine:boolean;accepted:boolean};
const uuid=()=>crypto.randomUUID();
const emptyCase={make:'',model:'',year:'',system:'',symptoms:'',codes:'',context:''};

/**
 * Structured technical consultations inside an existing verified club.
 * Order id is used ONLY to obtain a non-identifying preview before posting.
 */
export function ProfessionalCases({orderId}:{orderId?:string}){
 const {me}=useMe();
 const [roomId,setRoomId]=useState<string|null>(null);
 const [selected,setSelected]=useState<string|null>(null);
 const [page,setPage]=useState(0);
 const [status,setStatus]=useState('');
 const [query,setQuery]=useState('');
 const [term,setTerm]=useState('');
 const [form,setForm]=useState(emptyCase);
 const [showComposer,setShowComposer]=useState(Boolean(orderId));
 const [confirmShare,setConfirmShare]=useState(false);
 const [reply,setReply]=useState('');
 const [acceptedReply,setAcceptedReply]=useState<string|null>(null);
 const [solutionNotes,setSolutionNotes]=useState('');
 const [knowledgeTitle,setKnowledgeTitle]=useState('');
 const [reportReplyId,setReportReplyId]=useState<string|null|undefined>(undefined);
 const [reportReason,setReportReason]=useState('');
 const [replyAfter,setReplyAfter]=useState('0');
 const replyPending=useRef<{id:string;text:string;caseId:string}|null>(null);
 const {busy,run}=useAction();
 const {busy:answerBusy,run:answerRun}=useAction();
 const rooms=useLoad<{rooms:Club[]}>(()=>get('/api/community/rooms'),[me?.id]);
 const clubs=(rooms.data?.rooms??[]).filter(c=>c.audience==='professional');
 useEffect(()=>{
   setRoomId(current=>current&&clubs.some(c=>c.id===current)?current:clubs[0]?.id??null);
 },[rooms.data]);
 const room=clubs.find(c=>c.id===roomId)??null;
 const preview=useLoad<Preview|null>(
   ()=>orderId?get('/api/community/pro-cases/order-preview/'+orderId):Promise.resolve(null),[orderId]);
 useEffect(()=>{
   if(!preview.data||!orderId)return;
   setForm(x=>({...x,make:preview.data?.make??'',
     model:preview.data?.model??'',
     year:preview.data?.modelYear?String(preview.data.modelYear):'',
     system:preview.data?.subsystem??''}));
 },[preview.data,orderId]);
 useEffect(()=>{
   setSelected(null);setPage(0);setReplyAfter('0');replyPending.current=null;
 },[roomId]);
 const list=useLoad<{cases:Case[];hasMore:boolean;page:number}>(
   ()=>roomId?get('/api/community/pro-cases/rooms/'+roomId+
     '?page='+page+'&status='+encodeURIComponent(status)+'&q='+encodeURIComponent(query))
     :Promise.resolve({cases:[],hasMore:false,page:0}),[roomId,page,status,query],
   e=>e.type==='community_technical_case'&&e.roomId===roomId);
 const selectedCase=useLoad<Case|null>(
   ()=>selected?get('/api/community/pro-cases/'+selected):Promise.resolve(null),[selected],e=>e.type==='community_technical_case'&&e.caseId===selected);
 const replies=useLoad<{replies:Reply[];nextCursor:string;hasMore:boolean}>(
   ()=>selected?get('/api/community/pro-cases/'+selected+'/replies?after='+replyAfter)
     :Promise.resolve({replies:[],nextCursor:'0',hasMore:false}),[selected,replyAfter],
   e=>e.type==='community_technical_case'&&e.caseId===selected&&
     (e.kind==='reply'||e.kind==='resolved'));
 const join=async()=>{
   if(!room)return;
   const result=await run(()=>post('/api/community/rooms/'+room.id+'/join',{}),
     'Вы присоединились к профессиональному клубу');
   if(result)await rooms.reload();
 };
 const ask=async()=>{
   if(!room||!room.joined)return;
   if(orderId&&!confirmShare)return;
   const data={
     roomId:room.id,clientNonce:uuid(),
     ...(orderId?{orderId}:{make:form.make.trim()||null,
       model:form.model.trim()||null,modelYear:form.year?Number(form.year):null}),
     subsystem:form.system.trim(),symptoms:form.symptoms.trim(),
     dtcCodes:form.codes.toUpperCase().split(/[,;\s]+/).filter(Boolean),
     diagnosticContext:form.context.trim()||null
   };
   const result=await run(()=>post<{case:Case}>('/api/community/pro-cases',data),
     'Технический вопрос опубликован в закрытом клубе');
   if(result){
     setSelected(result.case.id);setShowComposer(false);
     setForm(emptyCase);setConfirmShare(false);await list.reload();
   }
 };
 const sendReply=async()=>{
   if(!selected||!reply.trim()||answerBusy)return;
   const text=reply.trim();
   const previous=replyPending.current;
   const id=previous?.text===text&&previous.caseId===selected?previous.id:uuid();
   replyPending.current={id,text,caseId:selected};
   const sent=await answerRun(()=>post('/api/community/pro-cases/'+selected+'/replies',
      {body:text,clientNonce:id}),'Ответ отправлен');
   if(sent){
     replyPending.current=null;setReply('');setReplyAfter('0');await replies.reload();
   }
 };
 const resolve=async()=>{
   if(!selected)return;
   const saved=await run(()=>post('/api/community/pro-cases/'+selected+'/resolve',
     {replyId:acceptedReply}),'Вопрос помечен как решённый');
   if(saved){await selectedCase.reload();await replies.reload();await list.reload()}
 };
 const flag=async()=>{
   if(!selected||reportReason.trim().length<10)return;
   const saved=await run(()=>post('/api/community/pro-cases/'+selected+'/report',{
     replyId:reportReplyId??null,reason:reportReason.trim()
   }),'Жалоба передана на рассмотрение модератору');
   if(saved){setReportReason('');setReportReplyId(undefined)}
 };
 const contribute=async()=>{
   if(!selected||!selectedCase.data)return;
   const saved=await run(()=>post('/api/community/pro-cases/'+selected+'/propose-knowledge',{
     title:knowledgeTitle.trim(),authorNotes:solutionNotes.trim(),rightsConfirmation:true
   }),'Ваш собственный текст отправлен на проверку ТехБазы');
   if(saved){await selectedCase.reload();setSolutionNotes('')}
 };
 return <section className="tech-section" aria-label="Профессиональные технические обсуждения">
   <h2>Спросить коллег — профессиональные клубы</h2>
   <p className="note">Структурированные вопросы по технике, разбор симптомов и решения
      специалистов. Только подтверждённые мастера, эвакуаторы и СТО своей специализации.
      Закрытые материалы не копируются в открытый Эфир.</p>
   {rooms.error&&<p role="alert">{rooms.error}</p>}
   <div className="tech-filters">
     <label>Профессиональный клуб
       <select className="field" value={roomId??''}
         onChange={e=>setRoomId(e.target.value||null)}>
         {clubs.length===0&&<option value="">Нет доступных клубов</option>}
         {clubs.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}
       </select>
     </label>
     {room?.joined&&<CommunityMuteToggle id={room.id} kind="room"/>}
     {room&&!room.joined&&<button className="btn" type="button" disabled={busy}
       onClick={()=>void join()}>Вступить в клуб</button>}
     {room?.joined&&<button className="btn" type="button"
       onClick={()=>{setShowComposer(x=>!x);setSelected(null)}}>
       {showComposer?'Отменить вопрос':'Новый вопрос коллегам'}
     </button>}
   </div>
   {orderId&&preview.error&&<p role="alert">{preview.error}</p>}
   {orderId&&preview.data&&<p className="note" role="status">
     Из заявки доступен безопасный технический контекст: {preview.data.make??'марка не указана'}
     {' '}{preview.data.model??''} {preview.data.modelYear??''}.
     Адрес, имя клиента, VIN, госномер и ID заявки не публикуются.
   </p>}
   {showComposer&&room&&<form className="tech-form" onSubmit={e=>{e.preventDefault();void ask()}}>
     {!orderId&&<>
       <label>Марка
         <input className="field" maxLength={80} value={form.make}
           onChange={e=>setForm(f=>({...f,make:e.target.value}))} placeholder="Renault"/>
       </label>
       <label>Модель
         <input className="field" maxLength={80} value={form.model}
           onChange={e=>setForm(f=>({...f,model:e.target.value}))} placeholder="Premium"/>
       </label>
       <label>Год (1985–2026)
         <input className="field" type="number" min={1985} max={2026} value={form.year}
           onChange={e=>setForm(f=>({...f,year:e.target.value}))}/>
       </label>
     </>}
     <label>Подсистема
       <input className="field" required minLength={2} maxLength={80}
         value={form.system} onChange={e=>setForm(f=>({...f,system:e.target.value}))}
         placeholder="EBS, проводка, пневматика, двигатель"/>
     </label>
     <label>Симптомы и уже выполненные проверки
       <textarea className="field" required minLength={40} maxLength={2500}
         rows={5} value={form.symptoms}
         onChange={e=>setForm(f=>({...f,symptoms:e.target.value}))}/>
     </label>
     <label>Коды ошибок (максимум 8, через запятую)
       <input className="field" value={form.codes} maxLength={110}
         onChange={e=>setForm(f=>({...f,codes:e.target.value}))}
         placeholder="P0401, P0489"/>
     </label>
     <label>Дополнительный технический контекст
       <textarea className="field" rows={3} maxLength={1500} value={form.context}
         onChange={e=>setForm(f=>({...f,context:e.target.value}))}/>
     </label>
     {orderId&&<label className="tech-consent">
       <input type="checkbox" checked={confirmShare}
         onChange={e=>setConfirmShare(e.target.checked)}/>
       Я проверил текст и разрешаю опубликовать только указанные технические сведения в закрытом клубе
     </label>}
     <p className="tech-warning">Не включайте VIN, госномер, телефоны, координаты,
       адрес клиента, персональные данные и ссылки. Сервер отклонит такие сведения.</p>
     <button type="submit" className="btn" disabled={!room.joined||busy||
       form.system.trim().length<2||form.symptoms.trim().length<40||
       (Boolean(orderId)&&!confirmShare)}>
       Опубликовать технический вопрос
     </button>
   </form>}
   <form className="tech-filters" onSubmit={e=>{
     e.preventDefault();setQuery(term.trim());setPage(0);setSelected(null);
   }}>
     <label>Поиск по симптомам, коду ошибки или модели
       <input className="field" value={term} maxLength={80}
         onChange={e=>setTerm(e.target.value)} placeholder="EBS, P0401, Premium"/>
     </label>
     <label>Состояние
       <select className="field" value={status} onChange={e=>{setStatus(e.target.value);setPage(0)}}>
         <option value="">Все</option><option value="open">Открытые</option>
         <option value="resolved">Решённые</option>
       </select>
     </label>
     <button className="btn ghost" type="submit">Найти</button>
   </form>
   {list.error&&<p role="alert">{list.error} <button onClick={list.reload}>Повторить</button></p>}
   <div className="tech-result-layout">
     <div className="tech-list">
       {!list.error&&list.data?.cases.length===0&&<p className="tech-empty">
         В этом клубе пока нет технических вопросов. Не создаём искусственную активность.
       </p>}
       {list.data?.cases.map(x=><button type="button" key={x.id}
         aria-current={selected===x.id?'page':undefined} onClick={()=>{
           setSelected(x.id);setReplyAfter('0');setAcceptedReply(null);replyPending.current=null;
         }}>
         <strong>{x.subsystem} · {x.make??'Марка уточняется'} {x.model??''}</strong>
         <small>{x.status==='resolved'?'Решено':'Обсуждается'} · {x.nickname}</small>
         <small>{x.symptoms.slice(0,130)}{x.symptoms.length>130?'…':''}</small>
       </button>)}
       <div className="tech-actions">
         <button className="btn ghost" type="button" disabled={page===0}
           onClick={()=>{setPage(p=>p-1);setSelected(null)}}>Назад</button>
         <span className="note">Стр. {page+1}</span>
         <button className="btn ghost" type="button" disabled={!list.data?.hasMore}
           onClick={()=>{setPage(p=>p+1);setSelected(null)}}>Дальше</button>
       </div>
     </div>
     {selected&&<article className="tech-article">
       {selectedCase.error&&<p role="alert">{selectedCase.error}</p>}
       {!selectedCase.data&&!selectedCase.error&&<p>Открываю вопрос…</p>}
       {selectedCase.data&&<>
         <h3>{selectedCase.data.subsystem} · {selectedCase.data.make??'Без марки'}
           {' '}{selectedCase.data.model??''} {selectedCase.data.model_year??''}</h3>
         <p className="note">{selectedCase.data.nickname} · {fmtTime(selectedCase.data.created_at)}</p>
         <p className="tech-description">{selectedCase.data.symptoms}</p>
         {selectedCase.data.dtc_codes.length>0&&<p>Коды:
           {' '}{selectedCase.data.dtc_codes.join(', ')}</p>}
         {selectedCase.data.diagnostic_context&&<p className="tech-description">
           {selectedCase.data.diagnostic_context}</p>}
         <p role="status">{selectedCase.data.status==='resolved'?'Вопрос решён':'Ожидает ответов коллег'}</p>
         {!selectedCase.data.isAuthor&&<button type="button" className="btn ghost"
           onClick={()=>{setReportReplyId(null);setReportReason('')}}>
           Пожаловаться на технический вопрос
         </button>}
         <TechnicalEvidenceLinks key={selected} caseId={selected} canPropose={Boolean(room?.joined)}/>
         <h4>Ответы коллег</h4>
         {replies.error&&<p role="alert">{replies.error}</p>}
         {replies.data?.replies.length===0&&<p className="note">Ответов пока нет.</p>}
         {replies.data?.replies.map(a=><div key={a.id} className="tech-draft">
           <strong>{a.nickname}{a.accepted?' · выбранное решение':''}</strong>
           <p className="tech-description">{a.body}</p>
           <small>{fmtTime(a.created_at)}</small>
           {!a.isMine&&<button type="button" className="btn ghost"
             onClick={()=>{setReportReplyId(a.id);setReportReason('')}}>
             Пожаловаться на ответ
           </button>}
           {selectedCase.data?.isAuthor&&selectedCase.data.status==='open'&&
             <button className="btn ghost" type="button"
               aria-pressed={acceptedReply===a.id}
               onClick={()=>setAcceptedReply(acceptedReply===a.id?null:a.id)}>
               {acceptedReply===a.id?'Выбран':'Выбрать решение'}
             </button>}
         </div>)}
         {reportReplyId!==undefined&&<form className="tech-form"
           onSubmit={e=>{e.preventDefault();void flag()}}>
           <h4>Сообщить модератору об опасном техническом совете</h4>
           <p className="note">Укажите конкретный риск или ошибку. Текст вашей жалобы
             виден модераторам, а не участникам клуба.</p>
           <textarea className="field" minLength={10} maxLength={500}
             rows={3} required value={reportReason}
             onChange={e=>setReportReason(e.target.value)}/>
           <div className="tech-actions">
             <button type="submit" className="btn"
               disabled={busy||reportReason.trim().length<10}>Отправить жалобу</button>
             <button type="button" className="btn ghost"
               onClick={()=>setReportReplyId(undefined)}>Отмена</button>
           </div>
         </form>}
         {replies.data?.hasMore&&<button type="button" className="btn ghost"
           onClick={()=>setReplyAfter(replies.data!.nextCursor)}>Следующие ответы</button>}
         {selectedCase.data.status==='open'&&room?.joined&&<>
           <label>Ответ специалиста
             <textarea className="field" rows={3} minLength={10} maxLength={2000}
               value={reply} onChange={e=>{setReply(e.target.value);replyPending.current=null}}/>
           </label>
           <button className="btn" type="button" disabled={answerBusy||reply.trim().length<10}
             onClick={()=>void sendReply()}>Ответить коллегам</button>
         </>}
         {selectedCase.data.isAuthor&&selectedCase.data.status==='open'&&
           <button className="btn" type="button" disabled={busy}
             onClick={()=>void resolve()}>Отметить вопрос решённым</button>}
         {selectedCase.data.isAuthor&&selectedCase.data.status==='resolved'&&
           !selectedCase.data.hasKnowledgeProposal&&<section className="tech-form">
             <h4>Передать собственные выводы на проверку ТехБазы</h4>
             <p className="note">Ответы других мастеров не копируются без их разрешения.
               Материал не публикуется до юридической и технической проверки.</p>
             <label>Название
               <input className="field" value={knowledgeTitle} minLength={5} maxLength={160}
                 onChange={e=>setKnowledgeTitle(e.target.value)}/>
             </label>
             <label>Ваши выводы
               <textarea className="field" rows={4} minLength={30} maxLength={2000}
                 value={solutionNotes} onChange={e=>setSolutionNotes(e.target.value)}/>
             </label>
             <button type="button" className="btn" disabled={busy||
               knowledgeTitle.trim().length<5||solutionNotes.trim().length<30}
               onClick={()=>void contribute()}>Отправить на две проверки</button>
           </section>}
         {selectedCase.data.hasKnowledgeProposal&&<p className="note" role="status">
           Автор передал материал на проверку ТехБазы. Это пока не опубликованная инструкция.
         </p>}
       </>}
     </article>}
   </div>
 </section>;
}
