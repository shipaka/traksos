import {useEffect,useMemo,useState} from 'react';
import {get,post,put,del} from '../api.ts';
import {VehicleFields,type VehicleValue} from '../ui.tsx';
import './ownerExperience.css';

type Topic={key:string;title:string};
type Photo={src:string;caption:string;sourcePage:string;author:string;license:string;licenseUrl:string};
type Article={
  id:string;vehicleId:string|null;category:string;brandKey:string;modelKey:string;
  brand:string;model:string;year:number|null;topic:string;title:string;body:string;
  reviewState:string;mine:boolean;saved:boolean;saveCount:number;createdAt:string;
  photo?:Photo|null;
};
type Vehicle={id:string;brand:string;model:string|null;year:number|null;catalog_category:string|null;
 catalog_brand_key:string|null;catalog_model_key:string|null};
const topics:Topic[]=[
 {key:'operations',title:'Особенности эксплуатации'},
 {key:'economy',title:'Экономичность'},
 {key:'daily-checks',title:'Ежедневные проверки'},
 {key:'ownership',title:'Владение'},
 {key:'road',title:'Рейсы и дороги'}
];
const topicName=(id:string)=>topics.find(x=>x.key===id)?.title??id;
function uid(){return crypto.randomUUID();}
const initialVehicle:VehicleValue={brand:'',model:'',year:''};

function ExperienceCard({item,onChanged}:{item:Article;onChanged:()=>void}){
 const [expanded,setExpanded]=useState(false);
 const [reportOpen,setReportOpen]=useState(false);
 const [reason,setReason]=useState('');
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const action=async(fn:()=>Promise<any>,label:string)=>{
   setBusy(true);setMessage('');
   try{await fn();setMessage(label);onChanged()}
   catch(e:any){setMessage(e.message||'Не удалось выполнить действие')}
   finally{setBusy(false)}
 };
 return <article className="experience-card">
   <div className="experience-card-media">
     {item.photo?<img loading="lazy" src={item.photo.src} alt={item.photo.caption}
       referrerPolicy="no-referrer" onError={e=>{e.currentTarget.hidden=true}}/>
       :<div className="experience-placeholder" aria-hidden="true">▤</div>}
     {item.photo&&<small><a href={item.photo.sourcePage} target="_blank" rel="noopener noreferrer">
       {item.photo.author}</a> · <a href={item.photo.licenseUrl} target="_blank"
       rel="noopener noreferrer">{item.photo.license}</a> · пример модели</small>}
   </div>
   <div className="experience-card-body">
     <div className="experience-tags"><span className="pill">{topicName(item.topic)}</span>
       <span className="note">{item.brand} {item.model}{item.year?' · '+item.year:''}</span>
       {item.mine&&item.reviewState!=='published'&&<span className="pill">{item.reviewState==='pending'?'Проверяется':'Скрыто или отклонено'}</span>}
     </div>
     <h3>{item.title}</h3>
     <p className={expanded?'experience-full':'experience-excerpt'}>{item.body}</p>
     <button className="btn ghost small" type="button" aria-expanded={expanded}
       onClick={()=>setExpanded(x=>!x)}>{expanded?'Свернуть':'Читать полностью'}</button>
     <div className="experience-actions">
       {item.reviewState==='published'&&<button className="btn ghost small" disabled={busy}
         type="button" aria-pressed={item.saved}
         onClick={()=>void action(()=>post('/api/owner-experience/'+item.id+'/save',
           {saved:!item.saved}),item.saved?'Убрано из сохранённого':'Сохранено')}>
         {item.saved?'В сохранённом':'Сохранить'} · {item.saveCount}</button>}
       {item.reviewState==='published'&&!item.mine&&<button className="btn ghost small"
         type="button" onClick={()=>setReportOpen(x=>!x)}>Сообщить об ошибке</button>}
       {item.mine&&<button className="btn bad small" type="button" disabled={busy}
         onClick={()=>{if(window.confirm('Убрать свою публикацию?'))void action(
           ()=>del('/api/owner-experience/'+item.id),'Публикация удалена')}}>Удалить</button>}
       <a className="btn ghost small" href="#/shop" title="Проверяйте применимость деталей к VIN и комплектации">
         Запчасти для этой марки</a>
     </div>
     {reportOpen&&<div className="experience-report stack">
       <label className="note">Что необходимо проверить в этой публикации?</label>
       <textarea className="field" rows={2} maxLength={500} value={reason}
         onChange={e=>setReason(e.target.value)} placeholder="Опишите конкретную ошибку или нарушение"/>
       <button className="btn small" type="button" disabled={busy||reason.trim().length<15}
         onClick={()=>void action(()=>post('/api/owner-experience/'+item.id+'/report',
           {reason:reason.trim()}),'Передано на проверку')}>Отправить замечание</button>
     </div>}
     {message&&<small role="status" className="note">{message}</small>}
   </div>
 </article>;
}

function PostExperience({vehicles,onCreated,prefilled}:{vehicles:Vehicle[];
 onCreated:()=>void;prefilled?:string}){
 const [vehicleId,setVehicleId]=useState(prefilled??'');
 const [choice,setChoice]=useState<VehicleValue>(initialVehicle);
 const [topic,setTopic]=useState('operations');
 const [title,setTitle]=useState('');
 const [body,setBody]=useState('');
 const [nonce,setNonce]=useState(uid);
 const [busy,setBusy]=useState(false);
 const [msg,setMsg]=useState('');
 const ready=title.trim().length>=8&&body.trim().length>=40&&
  (vehicleId||Boolean(choice.catalogBrandKey&&choice.catalogModelKey));
 const send=async()=>{
   if(!ready)return;
   setBusy(true);setMsg('');
   try{
     const b:any={clientNonce:nonce,topic,title:title.trim(),body:body.trim()};
     if(vehicleId)b.vehicleId=vehicleId;
     else Object.assign(b,{catalogCategory:choice.catalogCategory,brandKey:choice.catalogBrandKey,
       modelKey:choice.catalogModelKey,modelYear:choice.year?Number(choice.year):undefined});
     await post('/api/owner-experience',b);
     setNonce(uid());setTitle('');setBody('');setMsg('Материал отправлен на модерацию. Он появится для других после проверки.');
     onCreated();
   }catch(e:any){setMsg(e.message||'Не удалось сохранить. Попробуйте повторить отправку.')}
   finally{setBusy(false)}
 };
 return <details className="card experience-editor" open={false}>
   <summary className="experience-editor-summary"><b>Поделиться опытом эксплуатации</b>
     <small>Полезные наблюдения, экономичность и особенности конкретной машины</small></summary>
   <div className="stack">
     <label className="label">К какой технике относится публикация?</label>
     {vehicles.length>0&&<select className="field" aria-label="Машина из гаража" value={vehicleId}
       onChange={e=>setVehicleId(e.target.value)}>
       <option value="">Новая модель из общего каталога</option>
       {vehicles.map(v=><option key={v.id} value={v.id}>{v.brand} {v.model??''}{v.year?' · '+v.year:''}</option>)}
     </select>}
     {!vehicleId&&<VehicleFields value={choice} onChange={setChoice}/>}
     <label className="label">Раздел</label>
     <select className="field" aria-label="Тема опыта" value={topic} onChange={e=>setTopic(e.target.value)}>
       {topics.map(x=><option key={x.key} value={x.key}>{x.title}</option>)}
     </select>
     <label className="label">Название</label>
     <input className="field" maxLength={130} minLength={8} value={title}
       onChange={e=>setTitle(e.target.value)} placeholder="Например: особенности эксплуатации зимой"/>
     <label className="label">Ваш опыт</label>
     <textarea className="field" value={body} onChange={e=>setBody(e.target.value)}
       rows={6} maxLength={5000} placeholder="Что вы заметили, при каких условиях и что стоит знать другим владельцам?"/>
     <small className="note">Без телефонов, госномеров, VIN, адресов и чужих инструкций. Точные характеристики проверяйте по руководству своей комплектации. Публикация проходит модерацию.</small>
     <button className="btn" disabled={!ready||busy} type="button" onClick={()=>void send()}>
       {busy?'Отправляю…':'Отправить на проверку'}</button>
     {msg&&<p className="note" role="status">{msg}</p>}
   </div>
 </details>;
}

export function OwnerExperience({vehicleId}:{vehicleId?:string}){
 const [vehicles,setVehicles]=useState<Vehicle[]>([]);
 const [items,setItems]=useState<Article[]>([]);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [revision,setRevision]=useState(0);
 const [topic,setTopic]=useState('');
 const [view,setView]=useState<'all'|'saved'|'mine'>('all');
 const [q,setQ]=useState('');
 const [query,setQuery]=useState('');
 const [page,setPage]=useState(0);
 const [more,setMore]=useState(false);
 const [model,setModel]=useState<VehicleValue>(initialVehicle);
 useEffect(()=>{
   get<Vehicle[]>('/api/vehicles').then(setVehicles).catch(()=>setVehicles([]));
 },[]);
 const garageVehicle=useMemo(()=>vehicles.find(v=>v.id===vehicleId),[vehicles,vehicleId]);
 useEffect(()=>{
   let alive=true;setLoading(true);setError('');
   const p=new URLSearchParams({page:String(page)});
   if(topic)p.set('topic',topic);
   if(query)p.set('q',query);
   if(view==='mine')p.set('mine','true');
   if(view==='saved')p.set('saved','true');
   const cat=garageVehicle?.catalog_category??model.catalogCategory;
   const brand=garageVehicle?.catalog_brand_key??model.catalogBrandKey;
   const mod=garageVehicle?.catalog_model_key??model.catalogModelKey;
   if(cat)p.set('category',cat);
   if(brand)p.set('brandKey',brand);
   if(mod)p.set('modelKey',mod);
   get<{items:Article[];hasMore:boolean}>('/api/owner-experience?'+p.toString())
     .then(r=>{if(alive){setItems(r.items);setMore(r.hasMore)}})
     .catch((e:Error)=>{if(alive)setError(e.message)})
     .finally(()=>{if(alive)setLoading(false)});
   return()=>{alive=false};
 },[revision,topic,view,query,page,model.catalogCategory,model.catalogBrandKey,
   model.catalogModelKey,garageVehicle?.catalog_category,garageVehicle?.catalog_brand_key,
   garageVehicle?.catalog_model_key]);
 const change=()=>{setPage(0);setRevision(x=>x+1)};
 return <main className="experience-page">
   <header className="experience-hero">
     <a className="note" href={vehicleId?'#/garage':'#/'}>← {vehicleId?'В гараж':'Главная'}</a>
     <span className="experience-eyebrow">ПОЛЕЗНОЕ О ТРАНСПОРТЕ</span>
     <h1>Опыт эксплуатации</h1>
     <p>{garageVehicle
       ? 'Практические заметки владельцев о '+garageVehicle.brand+' '+(garageVehicle.model??'')+'.'
       : 'Проверенные наблюдения владельцев и водителей о грузовиках, прицепах и полуприцепах.'}
     </p>
   </header>
   <PostExperience vehicles={vehicles} onCreated={change} prefilled={vehicleId}/>
   <section className="experience-tools card" aria-label="Поиск полезной информации">
     {!vehicleId&&<details><summary>Выбрать конкретную марку и модель</summary>
       <VehicleFields value={model} onChange={v=>{setModel(v);setPage(0)}}/>
       <button className="btn ghost small" onClick={()=>{setModel(initialVehicle);setPage(0)}} type="button">Все модели</button>
     </details>}
     <form className="experience-search" onSubmit={e=>{e.preventDefault();setQuery(q.trim());setPage(0)}}>
       <input className="field" placeholder="Поиск опыта, например «зима» или «расход»"
         value={q} onChange={e=>setQ(e.target.value)} maxLength={80} aria-label="Поиск публикаций"/>
       <button className="btn" type="submit">Найти</button>
     </form>
     <div className="experience-topics">
       <button className={topic===''?'btn small':'btn ghost small'} onClick={()=>{setTopic('');setPage(0)}}>Все темы</button>
       {topics.map(t=><button type="button" key={t.key}
         className={topic===t.key?'btn small':'btn ghost small'}
         onClick={()=>{setTopic(t.key);setPage(0)}}>{t.title}</button>)}
     </div>
     <div className="experience-views" role="group" aria-label="Подборка">
       {([['all','Все записи'],['saved','Сохранённое'],['mine','Мои публикации']] as const)
         .map(([key,label])=><button type="button" className={view===key?'btn small':'btn ghost small'}
         onClick={()=>{setView(key);setPage(0)}} key={key}>{label}</button>)}
     </div>
   </section>
   {error&&<p className="banner bad" role="alert">{error}</p>}
   {loading?<p role="status" className="note">Загружаю проверенные публикации…</p>
     :items.length===0?<div className="card experience-empty">По этим параметрам записей пока нет.
       Можно первым поделиться опытом о своей машине.</div>
     :<div className="experience-grid">{items.map(x=><ExperienceCard key={x.id} item={x} onChanged={change}/>)}</div>}
   <div className="experience-pages">
     <button className="btn ghost" disabled={page===0||loading} onClick={()=>setPage(x=>Math.max(0,x-1))}>Назад</button>
     <span className="note">Страница {page+1}</span>
     <button className="btn ghost" disabled={!more||loading} onClick={()=>setPage(x=>x+1)}>Далее</button>
   </div>
 </main>;
}
type ReviewRow={id:string;title:string;body:string;display_brand:string;display_model:string;
 model_year:number|null;topic:string;review_state:string;pending_reports:number};
export function OwnerExperienceModeration(){
 const [items,setItems]=useState<ReviewRow[]>([]);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState<string|null>(null);
 const [notes,setNotes]=useState<Record<string,string>>({});
 const reload=()=>{setLoading(true);get<{items:ReviewRow[]}>('/api/admin/owner-experience/queue')
   .then(x=>{setItems(x.items);setError('')}).catch((e:Error)=>setError(e.message))
   .finally(()=>setLoading(false))};
 useEffect(reload,[]);
 const review=async(id:string,decision:'publish'|'hide'|'reject')=>{
   setBusy(id);
   try{await post('/api/admin/owner-experience/'+id+'/review',
     {decision,note:notes[id]?.trim()||'Проверено модератором: решение по содержанию и правилам раздела.'});
     reload();
   }catch(e:any){setError(e.message??'Ошибка модерации')}
   finally{setBusy(null)}
 };
 return <main className="experience-page">
   <header className="experience-hero"><a href="#/admin" className="note">← Админка</a>
     <h1>Проверка опыта эксплуатации</h1>
     <p>Только проверенные публикации попадут в общий справочник. Жалобы рассматриваются здесь, а не в закрытых технических разделах.</p>
   </header>
   {error&&<p role="alert" className="banner bad">{error}</p>}
   {loading?<p className="note">Загружаю очередь…</p>:items.length===0
     ?<div className="card">Очередь публикаций пуста.</div>
     :items.map(x=><article className="card stack" key={x.id}>
       <div className="between"><b>{x.title}</b><span className="pill">{x.pending_reports} жалоб</span></div>
       <small className="note">{x.display_brand} {x.display_model} · {topicName(x.topic)}</small>
       <p className="experience-full">{x.body}</p>
       <textarea className="field" rows={2} value={notes[x.id]??''}
         placeholder="Основание редакционного решения" maxLength={600}
         onChange={e=>setNotes(v=>({...v,[x.id]:e.target.value}))}/>
       <div className="row" style={{flexWrap:'wrap'}}>
         <button className="btn small" disabled={busy===x.id} onClick={()=>void review(x.id,'publish')}>Одобрить</button>
         <button className="btn ghost small" disabled={busy===x.id} onClick={()=>void review(x.id,'hide')}>Скрыть</button>
         <button className="btn bad small" disabled={busy===x.id} onClick={()=>void review(x.id,'reject')}>Отклонить</button>
       </div>
     </article>)}
 </main>;
}
