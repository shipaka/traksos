import { useEffect,useState } from 'react';
import { get,getToken } from '../api.ts';
import { PartProposal } from './partRecommendations.tsx';
type Binding={make:string;model:string;generation?:string;yearFrom?:number;yearTo?:number;variant?:string;manufacturer?:string;article?:string;revision?:string;source:string;status:'thematic'|'verified_component'};
export type IllustratedCard = {bindings?:readonly Binding[];id:string;title:string;system:string;kind:string;make:string|null;models:readonly string[];scope:string;body:string;source:string;url:string;sourceCheckedOn:string;rights:string;fitment:string;reviewStatus:string;image:string;relatedCards:readonly SummaryCard[];details?:{capability:string;location:string;route:string;conditions:string;connectors:string;wiring:string;diagnostics:string};category:string;related:readonly string[];pins:readonly (readonly string[])[]};
export type IllustratedPayload = {version:string;families:readonly (readonly [string,readonly string[]])[];categories:readonly string[];systems:readonly string[];total:number;pageSize:number};

type SummaryCard=Pick<IllustratedCard,'id'|'title'|'category'|'system'|'kind'|'make'|'models'|'bindings'|'fitment'|'reviewStatus'>;
type Page={version:string;total:number;page:number;limit:number;hasMore:boolean;items:SummaryCard[]};
const categoryFor=(s:string)=>({air:'Пневматика',electric:'Электрика и ЭБУ',diag:'Электрика и ЭБУ',ecu:'Электрика и ЭБУ',autonomy:'Автономное оборудование',tyre:'Шиномонтаж',hydraulics:'Ходовая и механика'} as Record<string,string>)[s];

// Never retain a previous request's result when account, filters or card changes.
function useProtectedRequest<T>(path:string|null,delay=0){
 const token=getToken();
 const [retry,setRetry]=useState(0);
 const [state,setState]=useState<{path:string;token:string|null;retry:number;data?:T;error?:string}|null>(null);
 useEffect(()=>{
  setState(null);
  if(!path||!token)return;
  let alive=true;
  const handle=setTimeout(()=>{get<T>(path).then(data=>{
   if(alive&&getToken()===token)setState({path,token,retry,data});
  }).catch(e=>{if(alive&&getToken()===token)setState({path,token,retry,error:(e as Error).message});});},delay);
  return ()=>{alive=false;clearTimeout(handle);};
 },[path,token,retry,delay]);
 const result=state?.path===path&&state?.token===token&&state?.retry===retry?state:null;
 return {data:result?.data,error:result?.error,reload:()=>setRetry(x=>x+1)};
}
export function TechBaseIllustrated({data,specialties=[]}:{data:IllustratedPayload;specialties?:string[]}){
 const preferred=[...new Set(specialties.map(categoryFor).filter(Boolean))];
 const [category,setCategory]=useState(preferred.length===1?preferred[0]:'');
 const [focus,setFocus]=useState<string|null>(null);
 const [make,setMake]=useState('');
 const [model,setModel]=useState('');
 const [year,setYear]=useState('');
 const [general,setGeneral]=useState(true);
 const [system,setSystem]=useState('');
 const [q,setQ]=useState('');
 const [zoom,setZoom]=useState<string|null>(null);
 const [partCard,setPartCard]=useState<string|null>(null);
 const orderId=new URLSearchParams(location.hash.split('?')[1]??'').get('orderId')??undefined;
 const family=data.families.find(([m])=>m===make);
 const bindings=(c:SummaryCard):readonly Binding[]=>c.bindings??[];
 const compatible=(c:SummaryCard)=>{
  if(!make&&!model&&!year)return general||bindings(c).length>0;
  const b=bindings(c),y=year?Number(year):null;
  return b.some(v=>(!make||v.make===make)&&(!model||v.model===model)&&(y===null||((v.yearFrom==null||y>=v.yearFrom)&&(v.yearTo==null||y<=v.yearTo))))||(!c.make&&!b.length&&general);
 };
 const params=new URLSearchParams({general:general?'1':'0',limit:String(data.pageSize)});
 for(const [key,value] of Object.entries({make,model,year,category,system,q:q.trim()}))if(value)params.set(key,value);
 const filterKey=params.toString();
 const [paging,setPaging]=useState({key:'',page:0});
 const page=paging.key===filterKey?paging.page:0;
 params.set('page',String(page));
 const results=useProtectedRequest<Page>(focus?null:'/api/techbase/illustrations?'+params.toString(),180);
 const selected=useProtectedRequest<IllustratedCard>(focus?'/api/techbase/illustrations/'+encodeURIComponent(focus):null);
 const c=selected.data;
 return <section className="card stack" aria-label="Иллюстрированная техническая база">
  <h2>Иллюстрации и распиновки</h2>
  <p className="note">Материалы TrakSOS · {data.total} карточек. Изображение загружается только при открытии. Общая иллюстрация не подтверждает применимость к машине.</p>
  <div className="grid2">
   <label className="stack"><b>Профильный раздел</b><select className="field" value={category} onChange={e=>{setCategory(e.target.value);setFocus(null);setSystem('');}}><option value="">Все разделы</option>{data.categories.map(c=><option key={c} value={c}>{c}{preferred.includes(c)?' · мой профиль':''}</option>)}</select></label>
   {preferred.length>1&&<div className="stack"><b>Мои специальности</b>{preferred.map(c=><button type="button" className="btn ghost small" key={c} onClick={()=>{setCategory(c);setFocus(null);setSystem('');setQ('');}}>{c}</button>)}</div>}
   <label className="stack"><b>Марка</b><select className="field" value={make} onChange={e=>{setMake(e.target.value);setModel('');setZoom(null);setFocus(null);}}><option value="">Все приоритетные марки</option>{data.families.map(([m])=><option key={m}>{m}</option>)}</select></label>
   <label className="stack"><b>Семейство (справочный фильтр)</b><select className="field" value={model} disabled={!family} onChange={e=>{setModel(e.target.value);setZoom(null);setFocus(null);}}><option value="">Все семейства</option>{family?.[1].map(m=><option key={m}>{m}</option>)}</select></label>
   <label className="stack"><b>Год выпуска (справочно)</b><select className="field" value={year} onChange={e=>{setYear(e.target.value);setFocus(null);}}><option value="">Все годы</option>{Array.from({length:37},(_,i)=>2026-i).map(y=><option key={y} value={y}>{y}</option>)}</select></label>
   <label className="stack"><span><input type="checkbox" checked={general} onChange={e=>{setGeneral(e.target.checked);setFocus(null);}}/> Показывать общие материалы без подтверждения установки</span></label>
   <label className="stack"><b>Система</b><select className="field" value={system} onChange={e=>{setSystem(e.target.value);setFocus(null);}}><option value="">Все системы</option>{data.systems.map(s=><option key={s}>{s}</option>)}</select></label>
   <label className="stack"><b>Поиск по материалам</b><input className="field" maxLength={160} value={q} onChange={e=>{setQ(e.target.value);setFocus(null);}} placeholder="ISO 7638, CAN, EBS, АКБ"/></label>
  </div>

  {focus?<><button className="btn ghost small" type="button" onClick={()=>{setFocus(null);setZoom(null);setPartCard(null);}}>Вернуться к результатам поиска</button>
    {!c&&<div className="stack"><span role="status">{selected.error??'Загружаем выбранную иллюстрацию…'}</span>{selected.error&&<button className="btn ghost small" onClick={selected.reload}>Повторить загрузку</button>}</div>}
    {c&&<article key={c.id} className="card stack">
    <div className="between"><span className="pill">{c.kind}</span><span className="note">{bindings(c).length?[...new Set(bindings(c).map(b=>b.make))].join(' / '):'Общий материал'}</span></div>
    <h3>{c.title}</h3><span className="note">{c.category} · {c.system}</span><p className="techbase-warning">{c.scope}</p>
    {bindings(c).length>0&&<details><summary>Привязки к машинам ({bindings(c).length})</summary>{bindings(c).map((b,i)=><p key={i} className="note">{b.make} {b.model}{b.generation?' · '+b.generation:''}{b.yearFrom!=null&&b.yearTo!=null?' · '+b.yearFrom+'–'+b.yearTo:''} · {b.status==='verified_component'?'Компонент подтверждён, VIN отдельно':'Тематическая привязка; установка не подтверждена'}{b.article?' · '+b.article:''} <a href={b.source} target="_blank" rel="noopener noreferrer">Источник</a></p>)}</details>}
    <button className="btn ghost small" type="button" aria-expanded={zoom===c.id} onClick={()=>setZoom(v=>v===c.id?null:c.id)}>{zoom===c.id?'Уменьшить':'Увеличить иллюстрацию'}</button>
    <div style={{overflowX:'auto',maxWidth:'100%'}}><img src={'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(c.image)} alt={c.title+' — '+c.scope} loading="lazy" style={{display:'block',width:zoom===c.id?'960px':'100%',maxWidth:zoom===c.id?'none':'100%',height:'auto'}}/></div>
    <section className="stack" aria-label="Техническое описание под иллюстрацией">
    <b>Что нужно знать мастеру</b>
    {c.details?<dl style={{margin:0,display:'grid',gap:8}}>{([['Назначение и возможности',c.details.capability],['Где находится',c.details.location],['Откуда → куда',c.details.route],['Когда работает',c.details.conditions],['Разъёмы / фишки',c.details.connectors],['Пины, цвета, провода',c.details.wiring],['Что проверять',c.details.diagnostics]] as const).map(([label,value])=><div key={label}><dt><b>{label}</b></dt><dd style={{margin:0}}>{value}</dd></div>)}</dl>:<><p>{c.body}</p>{c.pins.length===0&&<p className="note">Точная распиновка, цвета и маршрут проводки отдельно не подтверждены. Сверяйте обозначения и применимость по источнику.</p>}</>}
    </section>
    {c.pins.length>0&&<details><summary>Текстовая таблица контактов ({c.pins.length})</summary><div style={{overflowX:'auto'}}><table><thead><tr><th>№</th><th>Назначение</th><th>Цвет</th><th>мм²</th></tr></thead><tbody>{c.pins.map(p=><tr key={p[0]}>{p.map((v,i)=><td key={i}>{v}</td>)}</tr>)}</tbody></table></div></details>}
    {c.relatedCards.some(compatible)&&<div className="stack"><b>Связанные узлы</b>{c.relatedCards.filter(compatible).map(x=><button key={x.id} type="button" className="btn ghost small" onClick={()=>{setFocus(x.id);setZoom(null);setPartCard(null);}}>{x.category} → {x.title}</button>)}</div>}
    <button type="button" className="btn ghost small" aria-expanded={partCard===c.id} onClick={()=>setPartCard(v=>v===c.id?null:c.id)}>Артикулы и подбор запчасти</button>
    {partCard===c.id&&<PartProposal key={c.id} cardId={c.id} orderId={orderId}/>}
    <div className="note">Авторская иллюстрация TrakSOS · источник проверен {c.sourceCheckedOn} · техническая проверка ожидается. <a href={c.url} target="_blank" rel="noopener noreferrer">{c.source} ↗</a></div>

    </article>}
  </>:<>
    <p role="status">{results.data?results.data.total+' материалов · страница '+(page+1):results.error??'Ищем материалы…'}</p>
    {results.error&&<button className="btn ghost small" onClick={results.reload}>Повторить поиск</button>}
    {results.data?.items.map(item=><article className="card flat stack" key={item.id}>
     <b>{item.title}</b><span className="note">{item.category} · {item.system} · {bindings(item).length?'Тематические / проверенные привязки':'Общий материал'}</span>
     <button className="btn ghost small" type="button" onClick={()=>{setFocus(item.id);setPartCard(null);setZoom(null);}}>Открыть иллюстрацию</button>
    </article>)}
    {results.data?.total===0&&<p>Нет подходящих иллюстраций. Заводские схемы не подменяются похожими.</p>}
    {(page>0||results.data?.hasMore)&&<div className="between"><button className="btn ghost small" disabled={page===0} onClick={()=>setPaging({key:filterKey,page:page-1})}>Назад</button><button className="btn ghost small" disabled={!results.data?.hasMore} onClick={()=>setPaging({key:filterKey,page:page+1})}>Далее</button></div>}
  </>}
 </section>;
}
