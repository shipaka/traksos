import { useState } from 'react';
import { PartProposal } from './partRecommendations.tsx';
type Binding={make:string;model:string;generation?:string;yearFrom?:number;yearTo?:number;variant?:string;manufacturer?:string;article?:string;revision?:string;source:string;status:'thematic'|'verified_component'};
export type IllustratedCard = {bindings?:readonly Binding[];id:string;title:string;system:string;kind:string;make:string|null;models:readonly string[];scope:string;body:string;source:string;url:string;sourceCheckedOn:string;rights:string;fitment:string;reviewStatus:string;image:string;details?:{capability:string;location:string;route:string;conditions:string;connectors:string;wiring:string;diagnostics:string};category:string;related:readonly string[];pins:readonly (readonly string[])[]};
export type IllustratedPayload = {version:string;families:readonly (readonly [string,readonly string[]])[];categories:readonly string[];cards:IllustratedCard[]};
const categoryFor=(s:string)=>({air:'Пневматика',electric:'Электрика и ЭБУ',diag:'Электрика и ЭБУ',ecu:'Электрика и ЭБУ',autonomy:'Автономное оборудование',tyre:'Шиномонтаж',hydraulics:'Ходовая и механика'} as Record<string,string>)[s];
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
 const bindings=(c:IllustratedCard):readonly Binding[]=>c.bindings??(c.make?c.models.map(model=>({make:c.make!,model,source:c.url,status:'thematic'})):[]);
 const compatible=(c:IllustratedCard)=>{
  if(!make&&!model&&!year)return true;
  const b=bindings(c),y=year?Number(year):null;
  return b.some(v=>(!make||v.make===make)&&(!model||v.model===model)&&(y===null||((v.yearFrom==null||y>=v.yearFrom)&&(v.yearTo==null||y<=v.yearTo))))||(!c.make&&!b.length&&general);
 };
 const cards=data.cards.filter(c=>(!focus||c.id===focus)&&(!category||c.category===category)&&compatible(c)&&(!system||c.system===system)&&(!q.trim()||[c.title,c.system,c.body,c.scope,c.make??'',...c.models,...bindings(c).flatMap(v=>[v.make,v.model,v.generation??'',v.article??'',v.manufacturer??'']),...c.pins.flat()].join(' ').toLowerCase().includes(q.trim().toLowerCase())));
 return <section className="card stack" aria-label="Иллюстрированная техническая база">
  <h2>Иллюстрации и распиновки</h2>
  <p className="note">Локальные материалы TrakSOS · {data.version}. Общие материалы не означают совместимость с выбранным автомобилем. Экспертная проверка ещё требуется.</p>
  <div className="grid2">
   <label className="stack"><b>Профильный раздел</b><select className="field" value={category} onChange={e=>{setCategory(e.target.value);setFocus(null);setSystem('');}}><option value="">Все разделы</option>{data.categories.map(c=><option key={c} value={c}>{c}{preferred.includes(c)?' · мой профиль':''}</option>)}</select></label>
   {preferred.length>1&&<div className="stack"><b>Мои специальности</b>{preferred.map(c=><button type="button" className="btn ghost small" key={c} onClick={()=>{setCategory(c);setFocus(null);setSystem('');setQ('');}}>{c}</button>)}</div>}
   <label className="stack"><b>Марка</b><select className="field" value={make} onChange={e=>{setMake(e.target.value);setModel('');setZoom(null);setFocus(null);}}><option value="">Все приоритетные марки</option>{data.families.map(([m])=><option key={m}>{m}</option>)}</select></label>
   <label className="stack"><b>Семейство (справочный фильтр)</b><select className="field" value={model} disabled={!family} onChange={e=>{setModel(e.target.value);setZoom(null);setFocus(null);}}><option value="">Все семейства</option>{family?.[1].map(m=><option key={m}>{m}</option>)}</select></label>
   <label className="stack"><b>Год выпуска (справочно)</b><select className="field" value={year} onChange={e=>{setYear(e.target.value);setFocus(null);}}><option value="">Все годы</option>{Array.from({length:37},(_,i)=>2026-i).map(y=><option key={y} value={y}>{y}</option>)}</select></label>
   <label className="stack"><span><input type="checkbox" checked={general} onChange={e=>{setGeneral(e.target.checked);setFocus(null);}}/> Показывать общие материалы без подтверждения установки</span></label>
   <label className="stack"><b>Система</b><select className="field" value={system} onChange={e=>{setSystem(e.target.value);setFocus(null);}}><option value="">Все системы</option>{[...new Set(data.cards.map(c=>c.system))].map(s=><option key={s}>{s}</option>)}</select></label>
   <label className="stack"><b>Поиск по материалам</b><input className="field" value={q} onChange={e=>{setQ(e.target.value);setFocus(null);}} placeholder="ISO 7638, CAN, EBS, АКБ"/></label>
  </div>
  {focus&&<button className="btn ghost small" type="button" onClick={()=>setFocus(null)}>Все карточки раздела</button>}
  <p role="status">{cards.length} материалов. {make&& !cards.some(c=>bindings(c).some(b=>b.make===make))?'Для выбранной марки модельных схем пока нет; ниже только общие материалы.':''}</p>
  {cards.map(c=><article key={c.id} className="card stack">
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
    {c.related.some(id=>data.cards.some(x=>x.id===id&&compatible(x)))&&<div className="stack"><b>Связанные узлы</b>{c.related.map(id=>data.cards.find(x=>x.id===id)).filter((x):x is IllustratedCard=>!!x&&compatible(x)).map(x=><button key={x.id} type="button" className="btn ghost small" onClick={()=>{setCategory(x.category);setSystem('');setQ('');setFocus(x.id);setZoom(null);}}>{x.category} → {x.title}</button>)}</div>}
    <button type="button" className="btn ghost small" aria-expanded={partCard===c.id} onClick={()=>setPartCard(v=>v===c.id?null:c.id)}>Артикулы и подбор запчасти</button>
    {partCard===c.id&&<PartProposal key={c.id} cardId={c.id} orderId={orderId}/>}
    <div className="note">Авторская иллюстрация TrakSOS · источник проверен {c.sourceCheckedOn} · техническая проверка ожидается. <a href={c.url} target="_blank" rel="noopener noreferrer">{c.source} ↗</a></div>
  </article>)}
  {!cards.length&&<p>Нет подходящих иллюстраций. Заводские схемы не подменяются похожими.</p>}
 </section>;
}
