import { useEffect, useRef, useState } from 'react';
import { get, post } from '../api.ts';
import { Back, useMe } from '../ui.tsx';

interface RepairCase {
  id: string; make: string; model: string; production_year: number|null;
  ecu: string; code: string; symptoms: string; checks_performed: string;
  verified_fix: string; provenance_note: string; created_at?: string;
}
const empty = {
  make: '', model: '', productionYear: '', ecu: '', code: '',
  symptoms: '', checksPerformed: '', verifiedFix: '', provenanceNote: '',
};
export function RepairCases() {
  const { me } = useMe();
  const [term, setTerm] = useState('');
  const [items, setItems] = useState<RepairCase[]>([]);
  const [value, setValue] = useState(empty);
  const [editor, setEditor] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting,setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const permitted = !!me?.roles.some((r)=>['admin','moderator'].includes(r)) ||
    (!!me?.roles.some((r)=>['master','service'].includes(r)) && me?.performer?.verification === 'approved');
  const identity=(me?.id??'')+':'+String(permitted);
  const [visibleIdentity,setVisibleIdentity]=useState('');
  const identityRef=useRef(identity);
  identityRef.current=identity;
  const requestSerial=useRef(0);
  // Never render another account's approved technical cases while the new
  // bearer or verification status is still loading.
  const currentItems=permitted&&visibleIdentity===identity?items:[];
  const change = (field: keyof typeof empty, v: string) => setValue((prev)=>({...prev, [field]:v}));

  const load = async (searchTerm=term) => {
    const requestId=++requestSerial.current;
    const requestedBy=identity;
    setLoading(true);setError('');
    try {
      const result=await get<{items:RepairCase[]}>('/api/tech/repair-cases?q='+encodeURIComponent(searchTerm.trim().slice(0,80)));
      if(requestId!==requestSerial.current||identityRef.current!==requestedBy)return;
      if(!Array.isArray(result?.items))throw new Error('Некорректный ответ каталога ремонтов');
      setItems(result.items);
    } catch(e:any) {
      if(requestId!==requestSerial.current||identityRef.current!==requestedBy)return;
      setItems([]);
      setError(e?.message||'Не удалось загрузить кейсы');
    } finally {
      if(requestId===requestSerial.current&&identityRef.current===requestedBy)setLoading(false);
    }
  };
  useEffect(()=>{
    // Invalidate a previous user's in-flight GET and any private editor data.
    requestSerial.current++;
    setVisibleIdentity(identity);
    setItems([]);setTerm('');setValue(empty);setEditor(false);
    setError('');setNotice('');setSubmitting(false);
    if(permitted)void load('');
    else setLoading(false);
  },[identity]); // eslint-disable-line

  if(!permitted) return <main><Back to="trakbot"/><h1>Технические кейсы</h1><p className="note">Доступны только проверенным специалистам.</p></main>;
  return <main>
    <Back to="tech/codes" />
    <h1>Реальная практика ремонтов</h1>
    <p className="sub">Проверенные кейсы специалистов TrakSOS. Это опыт ремонта конкретной машины, а не заводская инструкция для всех модификаций.</p>
    <form className="compose" onSubmit={(e)=>{e.preventDefault();void load();}}>
      <input className="field" aria-label="Поиск кейса" placeholder="Марка, блок или код" value={term} onChange={(e)=>setTerm(e.target.value)}/>
      <button className="btn small" disabled={loading||submitting}>{loading?'...':'Поиск'}</button>
    </form>
    {error && <div className="banner warn" role="alert">{error}
      <button type="button" className="btn ghost small" onClick={()=>void load()} disabled={loading}>
        Повторить загрузку кейсов
      </button>
    </div>}
    {notice && <p className="note" role="status">{notice}</p>}
    {currentItems.map((item)=><details key={item.id} className="card">
      <summary><b>{item.make} {item.model}</b> · {item.code || item.ecu || 'Неисправность'} {item.production_year || ''}</summary>
      <div className="stack">
        <span className="label">Симптомы</span><p style={{whiteSpace:'pre-wrap'}}>{item.symptoms}</p>
        <span className="label">Что проверили</span><p style={{whiteSpace:'pre-wrap'}}>{item.checks_performed}</p>
        <span className="label">Что помогло в том случае</span><p style={{whiteSpace:'pre-wrap'}}>{item.verified_fix}</p>
        {item.provenance_note && <span className="note">Происхождение: {item.provenance_note}</span>}
      </div>
    </details>)}
    {!loading && !error && !currentItems.length && <p className="note">Проверенных случаев по запросу пока нет.</p>}
    <div className="card">
      <button type="button" className="btn ghost" onClick={()=>setEditor(!editor)}>
        {editor?'Скрыть форму':'Добавить случай ремонта'}
      </button>
      {editor && <form className="stack" onSubmit={async(e)=>{
        e.preventDefault();
        if(submitting)return;
        const submittedBy=identity;
        setSubmitting(true);setError('');setNotice('');
        try{
          await post('/api/tech/repair-cases',{
            ...value,
            productionYear:value.productionYear?Number(value.productionYear):undefined,
          });
          if(identityRef.current!==submittedBy)return;
          setNotice('Спасибо! Кейс отправлен на техническую проверку и пока никому не показывается.');
          setValue(empty);setEditor(false);
        }catch(e:any){
          if(identityRef.current===submittedBy)setError(e?.message||'Не удалось отправить кейс');
        }finally{
          if(identityRef.current===submittedBy)setSubmitting(false);
        }
      }}>
        <b>Какой ремонт действительно помог?</b>
        <span className="note">Не прикладывай VIN, номер машины, телефон клиента и текст из чужой платной документации. Публикация только после проверки.</span>
        <div className="grid2">
          <input className="field" required maxLength={60} placeholder="Марка" aria-label="Марка" value={value.make} onChange={e=>change('make',e.target.value)} />
          <input className="field" maxLength={80} placeholder="Модель" aria-label="Модель" value={value.model} onChange={e=>change('model',e.target.value)} />
          <input className="field" inputMode="numeric" maxLength={4} placeholder="Год" aria-label="Год" value={value.productionYear} onChange={e=>change('productionYear',e.target.value.replace(/\D/g,'').slice(0,4))} />
          <input className="field" maxLength={80} placeholder="Блок управления" aria-label="Блок управления" value={value.ecu} onChange={e=>change('ecu',e.target.value)} />
          <input className="field" maxLength={35} placeholder="Код ошибки" aria-label="Код ошибки" value={value.code} onChange={e=>change('code',e.target.value)} />
        </div>
        <textarea className="field" required minLength={15} maxLength={2000} rows={3} placeholder="Симптомы" aria-label="Симптомы" value={value.symptoms} onChange={e=>change('symptoms',e.target.value)} />
        <textarea className="field" required minLength={15} maxLength={2000} rows={3} placeholder="Что проверяли?" aria-label="Проверки" value={value.checksPerformed} onChange={e=>change('checksPerformed',e.target.value)} />
        <textarea className="field" required minLength={15} maxLength={2000} rows={3} placeholder="Подтверждённый результат ремонта" aria-label="Результат" value={value.verifiedFix} onChange={e=>change('verifiedFix',e.target.value)} />
        <textarea className="field" maxLength={800} rows={2} placeholder="Источник: своя практика, дата, особенности (без личных данных)" aria-label="Источник" value={value.provenanceNote} onChange={e=>change('provenanceNote',e.target.value)} />
        <button className="btn" disabled={submitting}>{submitting?'Отправляем…':'Отправить на проверку'}</button>
      </form>}
    </div>
  </main>;
}

export function TechnicalCasesReview() {
  const {me}=useMe();
  const admin=!!me?.roles.includes('admin');
  const identity=(me?.id??'')+':'+String(admin);
  const identityRef=useRef(identity);
  identityRef.current=identity;
  const requestSerial=useRef(0);
  const [visibleIdentity,setVisibleIdentity]=useState('');
  const [items,setItems]=useState<RepairCase[]>([]);
  const [notes,setNotes]=useState<Record<string,string>>({});
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [loading,setLoading]=useState(false);
  const [reviewingId,setReviewingId]=useState<string|null>(null);
  const currentItems=admin&&visibleIdentity===identity?items:[];

  const load=async()=>{
    if(!admin)return;
    const requestedBy=identity;
    const requestId=++requestSerial.current;
    setLoading(true);setError('');
    try{
      const response=await get<{items:RepairCase[]}>('/api/admin/tech/repair-cases');
      if(requestId!==requestSerial.current||identityRef.current!==requestedBy)return;
      if(!Array.isArray(response?.items))throw new Error('Некорректный ответ очереди проверки');
      setItems(response.items);
    }catch(e:any){
      if(requestId!==requestSerial.current||identityRef.current!==requestedBy)return;
      setItems([]);
      setError(e?.message||'Ошибка загрузки кейсов');
    }finally{
      if(requestId===requestSerial.current&&identityRef.current===requestedBy)setLoading(false);
    }
  };
  useEffect(()=>{
    // Pending moderation includes unreviewed, private specialist details.
    // Invalidate old requests immediately when the signed-in user changes.
    requestSerial.current++;
    setVisibleIdentity(identity);setItems([]);setNotes({});
    setError('');setNotice('');setReviewingId(null);
    if(admin)void load();
    else setLoading(false);
  },[identity]); // eslint-disable-line

  const review=async(id:string,approve:boolean)=>{
    if(!admin||reviewingId||loading)return;
    const note=(notes[id]??'').trim();
    if(approve&&note.length<10){
      setError('Для одобрения необходимо основание проверки не менее 10 символов.');
      return;
    }
    const requestedBy=identity;
    setReviewingId(id);setError('');setNotice('');
    try{
      await post('/api/admin/tech/repair-cases/'+id+'/review',{approve,note});
      if(identityRef.current!==requestedBy)return;
      setItems(old=>old.filter(item=>item.id!==id));
      setNotes(old=>{const next={...old};delete next[id];return next;});
      setNotice(approve?'Кейс одобрен после проверки.':'Кейс отклонён.');
      await load();
    }catch(e:any){
      if(identityRef.current===requestedBy)setError(e?.message||'Ошибка проверки кейса');
    }finally{
      if(identityRef.current===requestedBy)setReviewingId(null);
    }
  };
  if(!admin)return <main><Back to="tech/codes"/><h1>Модерация технических кейсов</h1>
    <p className="note">Проверка и публикация кейсов доступны только администратору.</p></main>;
  return <main>
    <Back to="tech/codes" />
    <h1>Модерация технических кейсов</h1>
    <p className="sub">Проверяй фактическую применяемость и происхождение информации. Отклоняй неподтверждённые решения, чужие документы и персональные данные.</p>
    {error&&<div className="banner warn" role="alert">{error}
      <button type="button" className="btn ghost small" disabled={loading||!!reviewingId}
        onClick={()=>void load()}>Повторить загрузку очереди</button>
    </div>}
    {notice&&<p role="status" className="note">{notice}</p>}
    {loading&&<div className="empty" role="status">Обновляем очередь технических кейсов…</div>}
    {!currentItems.length&&!loading&&!error&&<div className="empty">Кейсов на проверке нет</div>}
    {currentItems.map((item)=><section key={item.id} className="card stack">
      <h3>{item.make} {item.model} · {item.code || item.ecu}</h3>
      <span className="label">Симптомы</span><p style={{whiteSpace:'pre-wrap'}}>{item.symptoms}</p>
      <span className="label">Проверки</span><p style={{whiteSpace:'pre-wrap'}}>{item.checks_performed}</p>
      <span className="label">Исправление</span><p style={{whiteSpace:'pre-wrap'}}>{item.verified_fix}</p>
      <span className="note">{item.provenance_note}</span>
      <textarea className="field" placeholder="Основание решения (обязательно для одобрения)" aria-label={'Основание проверки '+item.id}
        maxLength={1000} disabled={!!reviewingId}
        value={notes[item.id]??''} onChange={(e)=>setNotes(x=>({...x,[item.id]:e.target.value}))}/>
      <div className="row">
        <button className="btn" disabled={loading||!!reviewingId||(notes[item.id]??'').trim().length<10}
          onClick={()=>void review(item.id,true)}>{reviewingId===item.id?'Проверяем…':'Одобрить'}</button>
        <button className="btn ghost" disabled={loading||!!reviewingId}
          onClick={()=>void review(item.id,false)}>Отклонить</button>
      </div>
    </section>)}
  </main>;
}
