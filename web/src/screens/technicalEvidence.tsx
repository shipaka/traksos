import {useState} from 'react';
import {get,post,fmtTime} from '../api.ts';
import {useAction,useLoad,useMe} from '../ui.tsx';

type Evidence={
  id:string;caseId:string;title:string;mediaKind:'diagram'|'manual'|'video_link';
  documentRevision:string;rightsReview:'pending'|'approved'|'rejected';
  technicalReview:'pending'|'approved'|'rejected';status:'active'|'withdrawn';
  sourceUrl:string|null;rightsNote:string|null;applicabilityNote:string|null;
  rightsReviewNote?:string|null;technicalReviewNote?:string|null;
  createdAt:string;isMine:boolean;needsRightsReview?:boolean;
  needsTechnicalReview?:boolean;subsystem?:string;roomId?:string
};
type EvidenceList={evidence:Evidence[];linksOnly:boolean;warning:string};
const empty={
  title:'',sourceUrl:'',documentRevision:'',mediaKind:'manual' as const,
  rightsNote:'',applicabilityNote:''
};
const uuid=()=>crypto.randomUUID();
const reviewLabel=(state:string)=>state==='approved'?'подтверждено':
  state==='rejected'?'отклонено':'на проверке';

export function TechnicalEvidenceLinks({caseId,canPropose}:{caseId:string;canPropose:boolean}){
  const records=useLoad<EvidenceList>(()=>
    get('/api/community/pro-cases/'+caseId+'/evidence'),[caseId]);
  const [form,setForm]=useState<{
    title:string;sourceUrl:string;documentRevision:string;
    mediaKind:'diagram'|'manual'|'video_link';rightsNote:string;applicabilityNote:string
  }>(empty);
  const [show,setShow]=useState(false);
  const [nonce,setNonce]=useState<string|null>(null);
  const {busy,run}=useAction();
  const submit=async()=>{
    const id=nonce??uuid();setNonce(id);
    const saved=await run(()=>post('/api/community/pro-cases/'+caseId+'/evidence',{
      ...form,clientNonce:id
    }),'Ссылка передана на правовую и техническую проверку');
    if(saved){
      setForm(empty);setShow(false);setNonce(null);
      await records.reload();
    }
  };
  const withdraw=async(id:string)=>{
    const saved=await run(()=>post('/api/community/pro-cases/'+caseId+
      '/evidence/'+id+'/withdraw',{}),'Технический источник отозван');
    if(saved)await records.reload();
  };
  return <section className="tech-section" aria-label="Проверенные технические первоисточники">
    <h4>Источники и иллюстрации по вопросу</h4>
    <p className="note">Здесь доступны только ссылки, прошедшие проверку прав и
      техническую экспертизу. Сами заводские PDF, фото или видео на TrackSOS
      не загружаются. Совпадение модели не гарантирует применимость к VIN.</p>
    {records.error&&<p role="alert">{records.error}
      <button type="button" className="btn ghost" onClick={records.reload}>Повторить</button>
    </p>}
    {records.data?.evidence.length===0&&<p className="note">
      Проверенных источников пока нет. Не добавляем вымышленные схемы.
    </p>}
    {records.data?.evidence.map(e=><article key={e.id} className="tech-draft">
      <strong>{e.title}</strong>
      <p className="note">Ревизия: {e.documentRevision}
        {' · '}Авторские права: {reviewLabel(e.rightsReview)}
        {' · '}Техническая проверка: {reviewLabel(e.technicalReview)}</p>
      {e.sourceUrl&&<a href={e.sourceUrl} target="_blank" rel="noopener noreferrer"
        className="btn ghost">Открыть первоисточник на сайте правообладателя</a>}
      {e.applicabilityNote&&<p className="note">{e.applicabilityNote}</p>}
      {e.isMine&&e.rightsReviewNote&&<p className="note">
        Правовая проверка: {e.rightsReviewNote}
      </p>}
      {e.isMine&&e.technicalReviewNote&&<p className="note">
        Техническая проверка: {e.technicalReviewNote}
      </p>}
      {e.isMine&&e.status==='active'&&<button type="button"
        className="btn ghost" disabled={busy} onClick={()=>void withdraw(e.id)}>
        Отозвать свою ссылку
      </button>}
    </article>)}
    {canPropose&&<>
      <button type="button" className="btn ghost"
        onClick={()=>setShow(s=>!s)}>{show?'Свернуть форму':'Предложить первоисточник'}</button>
      {show&&<form className="tech-form" onSubmit={e=>{e.preventDefault();void submit()}}>
        <p className="tech-warning">Только официальные сайты Scania, Renault Trucks,
          Volvo, MAN, DAF, ZF/WABCO, Knorr-Bremse, Haldex и Wikimedia Commons.
          Личные облачные файлы и ссылки на переписки запрещены.
          Публикация только после двух независимых проверок.</p>
        <label>Название материала
          <input className="field" minLength={8} maxLength={180} required
            value={form.title} onChange={e=>{setForm(f=>({...f,title:e.target.value}));setNonce(null)}}/>
        </label>
        <label>Тип
          <select className="field" value={form.mediaKind}
            onChange={e=>{setForm(f=>({...f,mediaKind:e.target.value as typeof form.mediaKind}));setNonce(null)}}>
            <option value="manual">Документ производителя</option>
            <option value="diagram">Схема или иллюстрация</option>
            <option value="video_link">Видеоматериал правообладателя (ссылка)</option>
          </select>
        </label>
        <label>HTTPS-ссылка на оригинальный источник
          <input className="field" type="url" required maxLength={1200}
            value={form.sourceUrl} onChange={e=>{setForm(f=>({...f,sourceUrl:e.target.value}));setNonce(null)}}/>
        </label>
        <label>Номер/редакция документа
          <input className="field" minLength={2} maxLength={120} required
            value={form.documentRevision}
            onChange={e=>{setForm(f=>({...f,documentRevision:e.target.value}));setNonce(null)}}/>
        </label>
        <label>Основание правомерности ссылки/распространения
          <textarea className="field" rows={3} minLength={30} maxLength={1000} required
            value={form.rightsNote}
            onChange={e=>{setForm(f=>({...f,rightsNote:e.target.value}));setNonce(null)}}/>
        </label>
        <label>Техническая применимость и ограничения по версии
          <textarea className="field" rows={3} minLength={30} maxLength={1500} required
            value={form.applicabilityNote}
            onChange={e=>{setForm(f=>({...f,applicabilityNote:e.target.value}));setNonce(null)}}/>
        </label>
        <button type="submit" className="btn"
          disabled={busy||form.title.trim().length<8||
            form.rightsNote.trim().length<30||form.applicabilityNote.trim().length<30}>
          Передать на две проверки
        </button>
      </form>}
    </>}
  </section>;
}

export function TechnicalEvidenceReviewQueue(){
  const {me}=useMe();
  const isAdmin=Boolean(me?.roles.includes('admin'));
  const queue=useLoad<{evidence:Evidence[]}>(()=>get('/api/admin/community/evidence/queue'),[]);
  const [notes,setNotes]=useState<Record<string,string>>({});
  const [decisions,setDecisions]=useState<Record<string,'approved'|'rejected'>>({});
  const {busy,run}=useAction();
  const review=async(e:Evidence)=>{
    const stage=e.needsRightsReview?'rights':'technical';
    const note=(notes[e.id]??'').trim();
    if(note.length<20)return;
    const result=await run(()=>post('/api/admin/community/evidence/'+e.id+'/review',{
      stage,decision:decisions[e.id]??'rejected',note
    }),'Решение по техническому источнику сохранено');
    if(result)await queue.reload();
  };
  return <section className="tech-section" aria-label="Правовая и техническая проверка первоисточников">
    <h2>Проверка ссылок на схемы и руководства</h2>
    <p className="note">Проверка лицензии/прав и техническая применимость —
      два разных этапа, их выполняют разные сотрудники. Ссылки не
      загружаются на сервер. Проверьте подлинность домена, редакцию
      и конкретную модель перед публикацией.</p>
    {queue.error&&<p role="alert">{queue.error}
      <button className="btn ghost" type="button" onClick={queue.reload}>Повторить</button>
    </p>}
    {queue.data?.evidence.length===0&&<p className="tech-empty">Ожидающих проверки ссылок нет.</p>}
    {queue.data?.evidence.map(e=><article className="tech-review" key={e.id}>
      <h3>{e.title}</h3>
      <p className="note">Раздел {e.subsystem??'не указан'}
        {' · '}{fmtTime(e.createdAt)} · ревизия {e.documentRevision}</p>
      {e.sourceUrl&&<a href={e.sourceUrl} target="_blank" rel="noopener noreferrer">
        Открыть оригинальный сайт
      </a>}
      <p><strong>Основание прав:</strong> {e.rightsNote}</p>
      <p><strong>Применимость:</strong> {e.applicabilityNote}</p>
      <p role="status">{e.needsRightsReview?'Стадия: права и лицензия':
        'Стадия: независимая техническая проверка'}</p>
      {e.needsRightsReview&&!isAdmin&&<p className="note">
        Проверку прав выполняет администратор. Модератор видит материал
        для координации, но не может подтверждать лицензию.
      </p>
      <label>Решение
        <select className="field" value={decisions[e.id]??'rejected'}
          onChange={x=>setDecisions(v=>({...v,[e.id]:
            x.target.value as 'approved'|'rejected'}))}>
          <option value="rejected">Отклонить</option>
          <option value="approved">Подтвердить после проверки</option>
        </select>
      </label>
      <label>Документированное основание решения
        <textarea className="field" rows={3} minLength={20} maxLength={1000} required
          value={notes[e.id]??''}
          onChange={x=>setNotes(v=>({...v,[e.id]:x.target.value}))}/>
      </label>
      <button type="button" className="btn" disabled={busy||
        (e.needsRightsReview&&!isAdmin)||
        (notes[e.id]?.trim().length??0)<20}
        onClick={()=>void review(e)}>Зафиксировать решение</button>
    </article>)}
  </section>;
}
