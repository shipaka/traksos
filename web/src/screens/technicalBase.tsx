import {useState} from 'react';
import {get,post,fmtTime} from '../api.ts';
import {useAction,useLoad,useMe} from '../ui.tsx';
import './techBase.css';
import {TechReferenceShelf} from './techReferenceShelf.tsx';
import {AdminTechReferences} from './adminTechReferences.tsx';
import {ProfessionalCases} from './professionalCases.tsx';
import {MyTechnicalAppeals,TechnicalAppealsQueue} from './technicalCaseAppeals.tsx';
import {TechnicalApplicability,AdminTechnicalApplicability} from './technicalApplicability.tsx';
import {CommunityNotificationSettings} from './communityNotificationSettings.tsx';
import {TechnicalCaseReportQueue} from './technicalCaseReportQueue.tsx';
import {EcuBlockGuide} from './ecuBlockGuide.tsx';
import {TechnicalEvidenceReviewQueue} from './technicalEvidence.tsx';

type Entry={id:string;title:string;make:string;model:string|null;model_year:number|null;
 subsystem:string;source_url:string|null;created_at:string};
type Detail=Entry&{description:string;rights_basis:string;updated_at:string};
type Draft={id:string;title:string;rights_review:string;technical_review:string;created_at:string};
type ReviewEntry=Entry&{description:string;rights_basis:string;rights_reference:string|null;
 rights_review:string;technical_review:string;author_nickname:string|null};
const reviewLabel:Record<string,string>={pending:'Проверяется',approved:'Подтверждено',rejected:'Отклонено'};
const rights:Record<string,string>={
 own:'Собственный материал',permission:'Есть разрешение автора',
 open_license:'Открытая лицензия',unknown:'Право использования пока не подтверждено'
};
function ApprovedKnowledge(){
 const [make,setMake]=useState(''),[system,setSystem]=useState('');
 const [filters,setFilters]=useState({make:'',system:''});
 const [selected,setSelected]=useState<string|null>(null);
 const result=useLoad<{articles:Entry[]}>(()=>get(
   '/api/community/knowledge?make='+encodeURIComponent(filters.make)+
   '&subsystem='+encodeURIComponent(filters.system)),[filters.make,filters.system]);
 const detail=useLoad<Detail|null>(()=>selected?get('/api/community/knowledge/'+selected):Promise.resolve(null),[selected]);
 return <section className="tech-section">
  <form className="tech-filters" onSubmit={e=>{e.preventDefault();setFilters({make:make.trim(),system:system.trim()})}}>
   <label>Марка <input className="field" value={make} maxLength={80} onChange={e=>setMake(e.target.value)} placeholder="Scania"/></label>
   <label>Система <input className="field" value={system} maxLength={70} onChange={e=>setSystem(e.target.value)} placeholder="EBS"/></label>
   <button className="btn" type="submit">Найти</button>
   <button className="btn ghost" type="button" onClick={()=>{setMake('');setSystem('');setFilters({make:'',system:''})}}>Сбросить</button>
  </form>
  {result.error&&<p role="alert">{result.error} <button onClick={result.reload}>Повторить</button></p>}
  {!result.data&&!result.error&&<p>Загружаю материалы…</p>}
  {result.data?.articles.length===0&&<div className="tech-empty">Пока нет проверенных материалов по выбранным параметрам. Не заменяем их выдуманными схемами.</div>}
  <div className="tech-result-layout">
   <div className="tech-list" role="list">
    {result.data?.articles.map(x=><button key={x.id} type="button"
      aria-current={selected===x.id?'page':undefined} onClick={()=>setSelected(x.id)}>
      <strong>{x.title}</strong><small>{x.make} {x.model??''} {x.model_year??''} · {x.subsystem}</small>
    </button>)}
   </div>
   {selected&&<article className="tech-article">
     {detail.error?<p role="alert">{detail.error}</p>:!detail.data?<p>Открываю материал…</p>:<>
      <h2>{detail.data.title}</h2>
      <p className="note">{detail.data.make} {detail.data.model??''} {detail.data.model_year??''} · {detail.data.subsystem}</p>
      <p className="tech-description">{detail.data.description}</p>
      <p className="note">Основание использования: {rights[detail.data.rights_basis]??detail.data.rights_basis}</p>
      {detail.data.source_url&&<a href={detail.data.source_url} target="_blank" rel="noreferrer noopener">Перейти к разрешённому источнику</a>}
      <p className="note">Последнее обновление: {fmtTime(detail.data.updated_at)}</p>
      <p className="note">Проверяйте применимость к конкретной модификации и VIN до проведения работ. Изменения на автомобиле требуют сверки с оригинальными документами.</p>
      <TechnicalApplicability key={detail.data.id} articleId={detail.data.id}
        initialMake={detail.data.make} initialModel={detail.data.model??''}
        initialYear={detail.data.model_year}/>
     </>}
   </article>}
  </div>
 </section>;
}
function ProposeKnowledge(){
 const {busy,run}=useAction();
 const [title,setTitle]=useState(''),[make,setMake]=useState('');
 const [model,setModel]=useState(''),[year,setYear]=useState('');
 const [subsystem,setSubsystem]=useState(''),[description,setDescription]=useState('');
 const [sourceUrl,setSourceUrl]=useState(''),[rightsBasis,setRightsBasis]=useState('unknown');
 const [reference,setReference]=useState('');
 const mine=useLoad<{articles:Draft[]}>(()=>get('/api/community/knowledge/mine'),[]);
 const send=async()=>{
  const saved=await run(()=>post('/api/community/knowledge/propose',{
   title:title.trim(),make:make.trim(),model:model.trim()||undefined,
   modelYear:year?Number(year):undefined,subsystem:subsystem.trim(),
   description:description.trim(),sourceUrl:sourceUrl.trim()||undefined,
   rightsBasis,rightsReference:reference.trim()||undefined
  }),'Предложение отправлено на проверку');
  if(saved){setTitle('');setDescription('');setSourceUrl('');setReference('');await mine.reload()}
 };
 return <section className="tech-section">
  <h2>Предложить материал</h2>
  <p>Можно отправить собственную инструкцию или ссылку на разрешённый источник. Чужие схемы из закрытых форумов без разрешения не публикуются, даже если ТехБаза закрыта для клиентов.</p>
  <form className="tech-form" onSubmit={e=>{e.preventDefault();void send()}}>
   <label>Название <input className="field" value={title} onChange={e=>setTitle(e.target.value)} minLength={5} maxLength={160} required/></label>
   <label>Марка <input className="field" value={make} onChange={e=>setMake(e.target.value)} minLength={2} maxLength={80} required/></label>
   <label>Модель (необязательно) <input className="field" value={model} onChange={e=>setModel(e.target.value)} maxLength={80}/></label>
   <label>Год (1985–2026) <input className="field" type="number" min={1985} max={2026} value={year} onChange={e=>setYear(e.target.value)}/></label>
   <label>Система <input className="field" value={subsystem} onChange={e=>setSubsystem(e.target.value)} minLength={2} maxLength={70} required placeholder="Тормозная система, EBS…"/></label>
   <label>Описание и собственный опыт <textarea className="field" rows={6} value={description} onChange={e=>setDescription(e.target.value)} minLength={30} maxLength={12000} required/></label>
   <label>Ссылка на HTTPS-источник (если есть) <input className="field" type="url" value={sourceUrl} onChange={e=>setSourceUrl(e.target.value)} placeholder="https://..."/></label>
   <label>Права на публикацию <select className="field" value={rightsBasis} onChange={e=>setRightsBasis(e.target.value)}>
     {Object.entries(rights).map(([value,label])=><option key={value} value={value}>{label}</option>)}
   </select></label>
   <label>Подтверждение прав / название лицензии / документ
    <textarea className="field" rows={2} value={reference} maxLength={1000} onChange={e=>setReference(e.target.value)}
      placeholder="Что подтверждает право TrakSOS публиковать этот материал?"/>
   </label>
   <button className="btn" type="submit" disabled={busy||title.trim().length<5||description.trim().length<30||make.trim().length<2||subsystem.trim().length<2}>Отправить на проверку</button>
  </form>
  <h3>Мои предложения</h3>
  {mine.error&&<p role="alert">{mine.error}</p>}
  {mine.data?.articles.length===0&&<p className="note">Вы ещё не предложили материалов.</p>}
  <div className="tech-list">
   {mine.data?.articles.map(x=><div className="tech-draft" key={x.id}>
    <strong>{x.title}</strong>
    <span>Права: {reviewLabel[x.rights_review]??x.rights_review} · Техника: {reviewLabel[x.technical_review]??x.technical_review}</span>
    <small>{fmtTime(x.created_at)}</small>
   </div>)}
  </div>
 </section>;
}
function AdminKnowledgeQueue(){
 const {busy,run}=useAction();
 const queue=useLoad<{articles:ReviewEntry[]}>(()=>get('/api/admin/community/knowledge/review-queue'),[]);
 const [notes,setNotes]=useState<Record<string,string>>({});
 const review=async(article:ReviewEntry,scope:'rights'|'technical',decision:'approved'|'rejected')=>{
  const reference=notes[article.id]?.trim();
  const saved=await run(()=>post('/api/admin/community/knowledge/'+article.id+'/review',{
    scope,decision,reference:reference||undefined
  }),decision==='approved'?'Проверка подтверждена':'Материал отклонён');
  if(saved)await queue.reload();
 };
 return <section className="tech-section">
  <h2>Модерация материалов</h2>
  <p className="note">Разрешение на публикацию и техническая достоверность проверяются раздельно. Источник не является разрешением. Отмечайте основание в журнале.</p>
  {queue.error&&<p role="alert">{queue.error} <button onClick={queue.reload}>Повторить</button></p>}
  {queue.data?.articles.length===0&&<p className="tech-empty">Новых материалов на проверку нет.</p>}
  {queue.data?.articles.map(a=><article key={a.id} className="tech-review">
    <h3>{a.title}</h3>
    <p>{a.make} {a.model??''} {a.model_year??''} · {a.subsystem}</p>
    <p className="tech-description">{a.description}</p>
    <p>Автор: {a.author_nickname??'Участник'} · Основание: {rights[a.rights_basis]??a.rights_basis}</p>
    {a.source_url&&<a href={a.source_url} rel="noopener noreferrer" target="_blank">Проверить источник</a>}
    <p className="note">Заявленные права: {a.rights_reference??'Документы не представлены'}</p>
    <label>Доказательство / заключение <textarea className="field" rows={2} maxLength={1000}
      value={notes[a.id]??''} onChange={e=>setNotes(n=>({...n,[a.id]:e.target.value}))}/></label>
    {a.rights_review==='pending'&&<div className="tech-actions">
      <button className="btn" disabled={busy||!notes[a.id]||notes[a.id].trim().length<10}
        onClick={()=>void review(a,'rights','approved')}>Подтвердить права</button>
      <button className="btn ghost" disabled={busy}
        onClick={()=>void review(a,'rights','rejected')}>Отклонить права</button>
    </div>}
    {a.technical_review==='pending'&&<div className="tech-actions">
      <button className="btn" disabled={busy}
        onClick={()=>void review(a,'technical','approved')}>Проверка техники пройдена</button>
      <button className="btn ghost" disabled={busy}
        onClick={()=>void review(a,'technical','rejected')}>Отклонить технически</button>
    </div>}
  </article>)}
 </section>;
}
export function TechnicalBase({initialTab='sources',initialRoomSlug}:{initialTab?:'sources'|'cases';initialRoomSlug?:string}={}){
 const {me}=useMe();
 const admin=Boolean(me?.roles.includes('admin'));
 const professional=Boolean(me?.roles.some(r=>r==='master'||r==='service'));
 const [tab,setTab]=useState<'sources'|'search'|'cases'|'propose'|'review'|'source-review'|'case-reports'|'appeals'|'appeal-review'|'variants'|'notifications'|'evidence'|'blocks'>(!professional&&admin?'review':initialTab);
 if(!professional&&!admin)return <main className="tech-shell"><p>Нет доступа к разделу.</p></main>;
 return <main className="tech-shell">
  <header className="tech-head">
   <div><span className="note">TRAKSOS · ПРОФЕССИОНАЛЬНАЯ БАЗА</span><h1>ТехБаза</h1>
    <p>Открытые лицензированные схемы и официальные источники отдельно от проверенных практических решений. Только для подтверждённых специалистов.</p></div>
   <a href="#/" className="btn ghost">В кабинет</a>
  </header>
  <nav className="tech-tabs" aria-label="ТехБаза">
   {professional&&<button aria-current={tab==='sources'?'page':undefined} onClick={()=>setTab('sources')}>Схемы и источники</button>}
   {professional&&<button aria-current={tab==='search'?'page':undefined} onClick={()=>setTab('search')}>Проверенные решения</button>}
   {professional&&<button aria-current={tab==='cases'?'page':undefined} onClick={()=>setTab('cases')}>Советы коллег</button>}
   {(professional||admin)&&<button aria-current={tab==='blocks'?'page':undefined} onClick={()=>setTab('blocks')}>Коды блоков ЭБУ</button>}
   {professional&&<button aria-current={tab==='notifications'?'page':undefined} onClick={()=>setTab('notifications')}>Уведомления</button>}
   {professional&&<button aria-current={tab==='appeals'?'page':undefined} onClick={()=>setTab('appeals')}>Мои обжалования</button>}
   {professional&&<button aria-current={tab==='propose'?'page':undefined} onClick={()=>setTab('propose')}>Мои материалы</button>}
   {admin&&<button aria-current={tab==='review'?'page':undefined} onClick={()=>setTab('review')}>Проверка материалов</button>}
   {admin&&<button aria-current={tab==='case-reports'?'page':undefined}
      onClick={()=>setTab('case-reports')}>Жалобы на техсоветы</button>}
   {admin&&<button aria-current={tab==='appeal-review'?'page':undefined} onClick={()=>setTab('appeal-review')}>Апелляции специалистов</button>}
   {admin&&<button aria-current={tab==='evidence'?'page':undefined} onClick={()=>setTab('evidence')}>Источники специалистов</button>}
   {admin&&<button aria-current={tab==='variants'?'page':undefined} onClick={()=>setTab('variants')}>Применяемость схем</button>}
   {admin&&<button aria-current={tab==='source-review'?'page':undefined}
      onClick={()=>setTab('source-review')}>Контроль источников</button>}
  </nav>
  {tab==='sources'&&professional&&<TechReferenceShelf/>}
  {tab==='search'&&professional&&<ApprovedKnowledge/>}
  {tab==='cases'&&professional&&<ProfessionalCases initialRoomSlug={initialRoomSlug}/>}
  {tab==='blocks'&&(professional||admin)&&<EcuBlockGuide/>}
  {tab==='appeals'&&professional&&<MyTechnicalAppeals/>}
  {tab==='notifications'&&professional&&<CommunityNotificationSettings professional/>}
  {tab==='propose'&&professional&&<ProposeKnowledge/>}
  {tab==='review'&&admin&&<AdminKnowledgeQueue/>}
  {tab==='source-review'&&admin&&<AdminTechReferences/>}
  {tab==='case-reports'&&admin&&<TechnicalCaseReportQueue/>}
  {tab==='appeal-review'&&admin&&<TechnicalAppealsQueue/>}
  {tab==='variants'&&admin&&<AdminTechnicalApplicability/>}
  {tab==='evidence'&&admin&&<TechnicalEvidenceReviewQueue/>}
  <p className="tech-footer-note">Материалы не заменяют документацию производителя. Системных запретов на снимки экрана в обычном браузере нет; доступ защищён проверкой роли на сервере.</p>
 </main>;
}
