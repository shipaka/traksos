import { useEffect, useState } from 'react';
import { get } from '../api.ts';

type ProfessionalLink = {
  id:string;title:string;url:string;scope:string;make:string|null;subsystem:string;
  rights:string;owner?:string;author?:string;licenseUrl?:string;sourceStatus?:string;
  accessCost?:string;requiresLogin?:string;confirmedFitment?:boolean;
};
type DriverTip = { id:string;title:string;body:string;category:string;priority:string;tags:string[] };
type ProfessionalResponse = {links:ProfessionalLink[];message:string;version:string;sourceNotice?:string};
type DriverResponse = {items:DriverTip[];message:string;version:string};

/**
 * Additional checked source index inside the *existing* approved TechBase.
 * Does not mirror OEM PDFs or claim VIN/part-number compatibility.
 */
export function VehicleTechnicalSources({ professional, makeKey, category, query, vehicleId }:{
  professional:boolean;makeKey:string;category:'truck'|'trailer'|'passenger'|'all';
  query:string;vehicleId?:string;
}) {
  const [links,setLinks]=useState<ProfessionalLink[]>([]);
  const [tips,setTips]=useState<DriverTip[]>([]);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [version,setVersion]=useState('');
  useEffect(()=>{
    let alive=true;
    setLoading(true);setError('');
    // Professionally restricted material is fetched from a separate backend
    // endpoint that verifies active approved master/service roles on every call.
    const url=professional
      ? '/api/vehicle-reference/professional?category='+(category==='all'?'truck':category)+
        '&make='+encodeURIComponent(makeKey.trim().toLowerCase())+
        '&q='+encodeURIComponent(query.trim())
      : '/api/vehicle-reference/tips?q='+encodeURIComponent(query.trim());
    get<ProfessionalResponse|DriverResponse>(url)
      .then(v=>{
        if(!alive)return;
        setVersion(v.version||'');
        if('links' in v){setLinks(v.links||[]);setTips([]);}
        else {setTips(v.items||[]);setLinks([]);}
      })
      .catch((e:Error)=>{if(alive){setLinks([]);setTips([]);setError(e.message||'Источник недоступен');}})
      .finally(()=>{if(alive)setLoading(false);});
    return ()=>{alive=false;};
  },[professional,makeKey,category,query]);

  return <section className="stack" aria-label="Дополнительные проверенные источники">
    <div className="between">
      <h2>{professional?'Проверенные технические источники':'Памятки по эксплуатации'}</h2>
      <span className="pill">{loading?'Загрузка…':error?'Недоступно':(professional?links.length:tips.length)+' записей'}</span>
    </div>
    {version && <p className="note">Реестр источников TrakSOS · {version}. Доступ и содержание ссылок могут изменяться правообладателями.</p>}
    {vehicleId&&!professional&&<a className="btn ghost small" href={'#/garage/'+encodeURIComponent(vehicleId)}>
      Книжка и руководства выбранной машины
    </a>}
    {error&&<div className="banner warn" role="alert">Не удалось открыть дополнительные источники: {error}</div>}
    {!loading&&!error&&professional&&<div className="techbase-grid">
      {links.map(r=><article key={r.id} className="card stack techbase-document">
        <span className="pill">{r.subsystem||'Техническая документация'}</span>
        <h3>{r.title}</h3>
        <p className="note">{r.scope}</p>
        <p className="techbase-warning">Применимость к конкретному VIN, двигателю, блоку или прицепу не подтверждена автоматически.</p>
        <div className="between">
          <span className="note">{r.owner||r.author||'Первичный источник'}</span>
          <a className="btn ghost small" href={r.url} target="_blank" rel="noopener noreferrer">Открыть источник</a>
        </div>
        {r.licenseUrl&&<small className="note"><a href={r.licenseUrl} target="_blank" rel="noopener noreferrer">{r.rights}</a></small>}
      </article>)}
    </div>}
    {!loading&&!error&&!professional&&<div className="techbase-grid">
      {tips.map(r=><article key={r.id} className="card stack techbase-document">
        <span className="pill">{r.category}</span>
        <h3>{r.title}</h3>
        <p>{r.body}</p>
      </article>)}
    </div>}
    {!loading&&!error&&(professional?links.length:tips.length)===0&&<div className="card">
      Для выбранного фильтра подтверждённых дополнительных материалов пока нет. Попробуйте другую марку или систему — мы не выдаём неподходящие инструкции за подходящие.
    </div>}
  </section>;
}
