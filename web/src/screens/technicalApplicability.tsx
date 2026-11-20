import {useEffect,useState} from 'react';
import {get,post} from '../api.ts';
import {useAction,useLoad} from '../ui.tsx';

type Evidence={id:string;make:string;model:string;year_from:number;year_to:number;
  engine_code:string|null;ecu_variant:string|null;evidence_url:string;
  source_revision:string;verification_note:string;reviewed_at:string;status?:string};
type Status='vehicle_details_required'|'documented_variant'|'engine_or_ecu_details_required'|'unknown';
type Applicability={status:Status;documentedVariants:Evidence[];
  evidenceExists:boolean;recordedVariantCount:number;matchIsVinVerified:boolean;
  vinNeverStored:boolean;warning:string};
type Candidate={id:string;title:string;make:string;model:string|null;model_year:number|null};
type AdminRecord={article:Candidate;entries:Evidence[]};

export function TechnicalApplicability({articleId,initialMake='',initialModel='',initialYear=null}:{
  articleId:string;initialMake?:string;initialModel?:string;initialYear?:number|null
}){
  const [fields,setFields]=useState({
    make:initialMake,model:initialModel,year:initialYear?String(initialYear):'',
    engineCode:'',ecuVariant:''
  });
  useEffect(()=>setFields({make:initialMake,model:initialModel,
    year:initialYear?String(initialYear):'',engineCode:'',ecuVariant:''}),
    [articleId,initialMake,initialModel,initialYear]);
  const [selected,setSelected]=useState({...fields});
  useEffect(()=>setSelected({make:initialMake,model:initialModel,
    year:initialYear?String(initialYear):'',engineCode:'',ecuVariant:''}),
    [articleId,initialMake,initialModel,initialYear]);
  const params=new URLSearchParams(selected);
  const report=useLoad<Applicability>(
    ()=>get('/api/community/knowledge/applicability/'+articleId+'?'+params),[
      articleId,selected.make,selected.model,selected.year,
      selected.engineCode,selected.ecuVariant
    ]);
  const label=report.data?.status==='documented_variant'
    ?'Есть документированное совпадение параметров модификации'
    :report.data?.status==='engine_or_ecu_details_required'
    ?'Не хватает данных о двигателе или блоке управления'
    :report.data?.status==='vehicle_details_required'
    ?'Укажите марку, модель и год'
    :'Применимость пока не подтверждена';
  return <section className="tech-section" aria-label="Применяемость схемы к модификации автомобиля">
    <h3>Проверка применяемости</h3>
    <p className="note">В справочнике не хранится VIN. Сравнение параметров
      не заменяет проверку оригинального документа по VIN у производителя.</p>
    <form className="tech-filters" onSubmit={e=>{e.preventDefault();setSelected({...fields})}}>
      <label>Марка
        <input className="field" value={fields.make} maxLength={80}
          onChange={e=>setFields(f=>({...f,make:e.target.value}))}/>
      </label>
      <label>Модель
        <input className="field" value={fields.model} maxLength={80}
          onChange={e=>setFields(f=>({...f,model:e.target.value}))}/>
      </label>
      <label>Год выпуска
        <input className="field" type="number" min={1985} max={2026}
          value={fields.year} onChange={e=>setFields(f=>({...f,year:e.target.value}))}/>
      </label>
      <label>Код двигателя (если известен)
        <input className="field" value={fields.engineCode} maxLength={60}
          onChange={e=>setFields(f=>({...f,engineCode:e.target.value}))}/>
      </label>
      <label>ECU / блок управления (если известен)
        <input className="field" value={fields.ecuVariant} maxLength={60}
          onChange={e=>setFields(f=>({...f,ecuVariant:e.target.value}))}/>
      </label>
      <button type="submit" className="btn">Проверить модификацию</button>
    </form>
    {report.error&&<p role="alert">{report.error}
      <button type="button" className="btn ghost" onClick={report.reload}>Повторить</button>
    </p>}
    {report.data&&<>
      <p role="status"><strong>{label}</strong></p>
      <p className="tech-warning">{report.data.warning}</p>
      {report.data.documentedVariants.map(entry=><article key={entry.id} className="tech-draft">
        <h4>{entry.make} {entry.model} · {entry.year_from}–{entry.year_to}</h4>
        <p>Двигатель: {entry.engine_code??'требует отдельной сверки'}
          {' · '}ECU: {entry.ecu_variant??'требует отдельной сверки'}</p>
        <p>Ревизия документа: {entry.source_revision}</p>
        <p className="note">{entry.verification_note}</p>
        <a className="btn ghost" href={entry.evidence_url} target="_blank" rel="noopener noreferrer">
          Проверить первоисточник
        </a>
      </article>)}
    </>}
  </section>;
}

export function AdminTechnicalApplicability(){
  const list=useLoad<{articles:Candidate[]}>(()=>
    get('/api/admin/community/knowledge/applicability-candidates'),[]);
  const [articleId,setArticleId]=useState('');
  const [form,setForm]=useState({
    make:'',model:'',yearFrom:'',yearTo:'',engineCode:'',ecuVariant:'',
    evidenceUrl:'',sourceRevision:'',verificationNote:''
  });
  const [notes,setNotes]=useState<Record<string,string>>({});
  const {busy,run}=useAction();
  const article=list.data?.articles.find(a=>a.id===articleId);
  const review=useLoad<AdminRecord|null>(
    ()=>articleId?get('/api/admin/community/knowledge/applicability/'+articleId)
      :Promise.resolve(null),[articleId]);
  const choose=(id:string)=>{
    setArticleId(id);
    const x=list.data?.articles.find(a=>a.id===id);
    setForm({make:x?.make??'',model:x?.model??'',
      yearFrom:x?.model_year?String(x.model_year):'',
      yearTo:x?.model_year?String(x.model_year):'',engineCode:'',ecuVariant:'',
      evidenceUrl:'',sourceRevision:'',verificationNote:''});
  };
  const save=async()=>{
    if(!articleId)return;
    const saved=await run(()=>post('/api/admin/community/knowledge/applicability/'+articleId,{
      make:form.make.trim(),model:form.model.trim(),
      yearFrom:Number(form.yearFrom),yearTo:Number(form.yearTo),
      engineCode:form.engineCode.trim()||null,ecuVariant:form.ecuVariant.trim()||null,
      evidenceUrl:form.evidenceUrl.trim(),sourceRevision:form.sourceRevision.trim(),
      verificationNote:form.verificationNote.trim()
    }),'Ревизия и источник применимости записаны в журнал');
    if(saved)await review.reload();
  };
  const change=async(id:string,status:'active'|'withdrawn')=>{
    const note=notes[id]?.trim()??'';
    if(note.length<15)return;
    const saved=await run(()=>post(
      '/api/admin/community/knowledge/applicability/'+articleId+'/records/'+id+'/status',
      {status,note}),'Решение об изменении применимости сохранено');
    if(saved)await review.reload();
  };
  return <section className="tech-section" aria-label="Редакционная проверка применяемости">
    <h2>Документированная применяемость материалов</h2>
    <p className="tech-warning">Только реально подтверждённые модели, двигатели
      и версии ECU. Само совпадение марки, модели и года НЕ означает проверку по VIN.
      Схемы с неизвестной лицензией или без технической проверки сюда не попадают.</p>
    <label>Проверенный материал
      <select className="field" value={articleId} onChange={e=>choose(e.target.value)}>
        <option value="">Выберите материал</option>
        {list.data?.articles.map(x=><option key={x.id} value={x.id}>
          {x.make} {x.model??''} · {x.title}</option>)}
      </select>
    </label>
    {list.error&&<p role="alert">{list.error}</p>}
    {review.data&&article&&<>
      <div className="tech-form">
        <h3>Добавить свидетельство по версии автомобиля</h3>
        <label>Марка
          <input className="field" maxLength={80} value={form.make}
            onChange={e=>setForm(f=>({...f,make:e.target.value}))}/>
        </label>
        <label>Модель
          <input className="field" maxLength={80} value={form.model}
            onChange={e=>setForm(f=>({...f,model:e.target.value}))}/>
        </label>
        <label>Год с
          <input className="field" type="number" min={1985} max={2026}
            value={form.yearFrom} onChange={e=>setForm(f=>({...f,yearFrom:e.target.value}))}/>
        </label>
        <label>Год по
          <input className="field" type="number" min={1985} max={2026}
            value={form.yearTo} onChange={e=>setForm(f=>({...f,yearTo:e.target.value}))}/>
        </label>
        <label>Код двигателя
          <input className="field" maxLength={60} value={form.engineCode}
            onChange={e=>setForm(f=>({...f,engineCode:e.target.value}))}/>
        </label>
        <label>Блок ECU / EBS
          <input className="field" maxLength={60} value={form.ecuVariant}
            onChange={e=>setForm(f=>({...f,ecuVariant:e.target.value}))}/>
        </label>
        <label>HTTPS-ссылка на документ с правами использования
          <input className="field" type="url" maxLength={1200} value={form.evidenceUrl}
            onChange={e=>setForm(f=>({...f,evidenceUrl:e.target.value}))}/>
        </label>
        <label>Номер/версия ревизии оригинального документа
          <input className="field" minLength={2} maxLength={80}
            value={form.sourceRevision}
            onChange={e=>setForm(f=>({...f,sourceRevision:e.target.value}))}/>
        </label>
        <label>Основание технической проверки
          <textarea className="field" rows={3} minLength={30} maxLength={1500}
            value={form.verificationNote}
            onChange={e=>setForm(f=>({...f,verificationNote:e.target.value}))}/>
        </label>
        <button type="button" className="btn" disabled={busy||
          form.verificationNote.trim().length<30||form.model.trim().length<2||
          !form.evidenceUrl.startsWith('https://')}
          onClick={()=>void save()}>Зафиксировать доказательство</button>
      </div>
      <h3>История по материалу</h3>
      {review.data.entries.length===0&&<p className="tech-empty">
        Пока нет доказательств конкретной применимости. Система должна показывать «неизвестно».
      </p>}
      {review.data.entries.map(x=><article key={x.id} className="tech-draft">
        <h4>{x.make} {x.model} {x.year_from}–{x.year_to}
          {' · '}{x.status==='active'?'Доступно':'Отозвано'}</h4>
        <p className="note">Двигатель {x.engine_code??'не указан'},
          ECU {x.ecu_variant??'не указан'}, ревизия {x.source_revision}</p>
        <p>{x.verification_note}</p>
        <a href={x.evidence_url} target="_blank" rel="noopener noreferrer">Первоисточник</a>
        <label>Основание изменения статуса
          <textarea className="field" rows={2} minLength={15} maxLength={1000}
            value={notes[x.id]??''} onChange={e=>setNotes(n=>({...n,[x.id]:e.target.value}))}/>
        </label>
        <button type="button" className="btn ghost" disabled={busy||(notes[x.id]?.trim().length??0)<15}
          onClick={()=>void change(x.id,x.status==='active'?'withdrawn':'active')}>
          {x.status==='active'?'Отозвать применимость':'Вернуть после проверки'}
        </button>
      </article>)}
    </>}
  </section>;
}
