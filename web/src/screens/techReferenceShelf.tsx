import {useEffect,useState} from 'react';
import {get,fmtTime} from '../api.ts';
import {useLoad} from '../ui.tsx';
import './techBase.css';

export type OpenTechReference={
  id:string;slug:string;title:string;source_kind:'diagram'|'photo'|'document'|'manufacturer_portal';
  coverage:'generic'|'manufacturer';make:string|null;model:string|null;
  subsystem:string;description:string;safety_note:string;
  tags:string[];source_url:string;preview_url:string|null;
  attribution_author:string|null;license_code:string;license_url:string|null;
  technical_status:string;updated_at:string;
};

type Page={
  references:OpenTechReference[];systems:string[];page:number;hasMore:boolean;
  referenceOnly:boolean;notice:string;
};
const sourceKind:Record<OpenTechReference['source_kind'],string>={
  diagram:'Учебная схема',photo:'Фото узла',document:'Документ по ссылке',
  manufacturer_portal:'Портал производителя'
};

export function TechReferenceDetail({reference}:{reference:OpenTechReference}){
  const [imageFailed,setImageFailed]=useState(false);
  useEffect(()=>setImageFailed(false),[reference.id]);
  return <article className="tech-article" aria-label="Источник технической схемы">
    <h2>{reference.title}</h2>
    <p className="note">{sourceKind[reference.source_kind]} · {reference.subsystem}
      {reference.make?' · '+reference.make:' · Общая схема, без привязки к марке'}</p>
    {reference.preview_url&&!imageFailed&&
      <a href={reference.source_url} target="_blank" rel="noopener noreferrer"
         aria-label={'Открыть исходную иллюстрацию: '+reference.title}>
        <img className="tech-reference-preview"
          src={reference.preview_url} loading="lazy" decoding="async"
          referrerPolicy="no-referrer"
          alt={'Иллюстрация источника: '+reference.title}
          onError={()=>setImageFailed(true)}/>
      </a>}
    {reference.preview_url&&imageFailed&&<p className="note" role="status">
      Предпросмотр недоступен. Откройте оригинал по ссылке ниже.
    </p>}
    <p className="tech-description">{reference.description}</p>
    <p role="note" className="tech-warning">{reference.safety_note}</p>
    <p className="note">Автор / источник: {reference.attribution_author??'см. страницу оригинала'}</p>
    <p className="note">Право использования: {reference.license_code==='LINK_ONLY'
      ?'Только внешняя ссылка; материалы производителя не копируются'
      :reference.license_code}
      {reference.license_url&&<> · <a href={reference.license_url}
         target="_blank" rel="noopener noreferrer">Условия лицензии</a></>}
    </p>
    <p className="note">Статус: {reference.technical_status==='expert_approved'
      ?'Иллюстрация дополнительно рассмотрена редактором (не заводская схема)'
      :'Справочный источник, применимость к конкретному ТС не подтверждена'}</p>
    <a className="btn ghost" href={reference.source_url}
      target="_blank" rel="noopener noreferrer">
      {reference.source_kind==='manufacturer_portal'?'Открыть портал производителя':'Открыть страницу оригинала'}
    </a>
    <p className="note">Обновление записи: {fmtTime(reference.updated_at)}</p>
  </article>;
}

/** Licensed diagrams and official portals: NOT the approved OEM repair library. */
export function TechReferenceShelf({initialMake='',initialSystem='',compact=false}:{
  initialMake?:string;initialSystem?:string;compact?:boolean
}){
  const [q,setQ]=useState('');
  const [make,setMake]=useState(initialMake);
  const [system,setSystem]=useState(initialSystem);
  const [kind,setKind]=useState('');
  const [filters,setFilters]=useState({q:'',make:initialMake,system:initialSystem,kind:''});
  const [page,setPage]=useState(0);
  const [selected,setSelected]=useState<string|null>(null);
  useEffect(()=>{
    setMake(initialMake);setSystem(initialSystem);
    setFilters(f=>({...f,make:initialMake,system:initialSystem}));
    setPage(0);setSelected(null);
  },[initialMake,initialSystem]);
  const params=new URLSearchParams({
    q:filters.q,make:filters.make,subsystem:filters.system,
    kind:filters.kind,page:String(page),
  });
  const results=useLoad<Page>(()=>get('/api/community/knowledge/references?'+params),[
    filters.q,filters.make,filters.system,filters.kind,page,
  ]);
  const entries=results.data?.references??[];
  const detail=useLoad<OpenTechReference|null>(
    ()=>selected?get('/api/community/knowledge/references/'+selected):Promise.resolve(null),[selected]);
  const apply=()=>{
    setPage(0);setSelected(null);
    setFilters({q:q.trim(),make:make.trim(),system:system.trim(),kind});
  };
  return <section className="tech-section" aria-label="Открытые технические схемы">
    <div>
      <h2>Открытые схемы и технические источники</h2>
      <p className="note">
        Реальные иллюстрации с указанными лицензиями и ссылками на первоисточники.
        Это не заводская база распиновок: соответствие конкретному VIN обязательно проверяется отдельно.
      </p>
    </div>
    <form className="tech-filters" onSubmit={e=>{e.preventDefault();apply()}}>
      <label>Название, узел или термин
        <input className="field" value={q} maxLength={80} onChange={e=>setQ(e.target.value)}
          placeholder="Common Rail, AdBlue, генератор, EBS"/>
      </label>
      <label>Марка (необязательно)
        <input className="field" value={make} maxLength={80} onChange={e=>setMake(e.target.value)}
          placeholder="Renault, DAF, Scania…"/>
      </label>
      {!compact&&<label>Система
        <input className="field" list="tech-reference-systems" value={system}
          maxLength={80} onChange={e=>setSystem(e.target.value)}
          placeholder="Электрика, охлаждение…"/>
        <datalist id="tech-reference-systems">
          {results.data?.systems.map(x=><option value={x} key={x}/>)}
        </datalist>
      </label>}
      <label>Тип
        <select className="field" value={kind} onChange={e=>setKind(e.target.value)}>
          <option value="">Все источники</option>
          <option value="diagram">Схемы</option>
          <option value="photo">Фотографии</option>
          <option value="document">Документы</option>
          <option value="manufacturer_portal">Производители</option>
        </select>
      </label>
      <button className="btn" type="submit">Найти</button>
      <button className="btn ghost" type="button" onClick={()=>{
        setQ('');setMake('');setSystem('');setKind('');
        setPage(0);setSelected(null);
        setFilters({q:'',make:'',system:'',kind:''});
      }}>Все</button>
    </form>
    {results.error&&<p role="alert">{results.error} <button type="button"
      onClick={results.reload}>Повторить</button></p>}
    {!results.data&&!results.error&&<p role="status">Загружаются открытые источники…</p>}
    {results.data&&<p className="note" role="status">
      Найдено на странице: {entries.length}. {results.data.notice}
    </p>}
    {results.data&&entries.length===0&&<p className="tech-empty">
      Для этих условий источников пока нет. Это не означает, что у производителя нет документации.
      Попробуйте убрать марку или систему.
    </p>}
    <div className="tech-result-layout">
      <div className="tech-list" role="list">
        {entries.map(entry=><button key={entry.id} type="button"
          aria-current={selected===entry.id?'page':undefined}
          onClick={()=>setSelected(entry.id)}>
          <strong>{entry.title}</strong>
          <small>{sourceKind[entry.source_kind]} · {entry.subsystem}
            {entry.make?' · '+entry.make:' · Общая'}</small>
          <small>{entry.license_code==='LINK_ONLY'?'Официальная ссылка':entry.license_code}
            {' · '}{entry.technical_status==='expert_approved'?'Редакционная проверка':'Без привязки к VIN'}</small>
        </button>)}
        <div className="tech-actions">
          <button className="btn ghost" type="button" disabled={page===0}
            onClick={()=>{setPage(n=>n-1);setSelected(null)}}>Назад</button>
          <span className="note">Страница {page+1}</span>
          <button className="btn ghost" type="button" disabled={!results.data?.hasMore}
            onClick={()=>{setPage(n=>n+1);setSelected(null)}}>Дальше</button>
        </div>
      </div>
      {selected&&detail.error&&<p role="alert">{detail.error}</p>}
      {selected&&!detail.error&&!detail.data&&<p>Открываю источник…</p>}
      {selected&&detail.data&&<TechReferenceDetail reference={detail.data}/>}
    </div>
  </section>;
}
