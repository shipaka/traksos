import {useEffect,useRef,useState} from 'react';
import {get,post,put} from '../api.ts';
import './adminStoDirectory20261127.css';
type Category='sto'|'tyre'|'wash'|'refrigeration'|'trailer';
type Status='draft'|'published'|'hidden';
type Site={id:string;name:string;address:string;phone:string;category:Category;lat:number|null;lng:number|null;services:string[];hours:string|null;source:string};
type Item=Site&{state:Status;revision:number;source_reuse_checked:boolean;location_checked:boolean;working_reports:number;not_working_reports:number;geocode_source?:string|null;geocode_accuracy?:string|null;geocode_matched_address?:string|null};
const categories:Record<Category,string>={sto:'Грузовое СТО',tyre:'Шиномонтаж',wash:'Мойка',refrigeration:'Рефрижераторы',trailer:'Прицепы'};
const states:Record<Status,string>={draft:'Черновик',published:'На карте',hidden:'Скрыто'};
const root='/api/admin/sto-directory';
const field=(s:string)=>s.trim();
const message=(e:unknown)=>e instanceof Error?e.message:'Ошибка запроса';
function Editor({item,onSaved,onCancel}:{item:Item|null;onSaved:()=>void;onCancel:()=>void}){
 const [form,setForm]=useState({id:item?.id??'directory:',name:item?.name??'',address:item?.address??'',phone:item?.phone??'+7',category:item?.category??'sto',lat:item?.lat==null?'':String(item.lat),lng:item?.lng==null?'':String(item.lng),services:item?.services.join('\n')??'',hours:item?.hours??'',source:item?.source??''});
 const [error,setError]=useState('');const [busy,setBusy]=useState(false);const lock=useRef(false);
 const change=(key:keyof typeof form,value:string)=>setForm(f=>({...f,[key]:value}));
 async function save(e:React.FormEvent){e.preventDefault();if(lock.current)return;setError('');
  const lat=form.lat.trim()===''?null:Number(form.lat.replace(',','.')),lng=form.lng.trim()===''?null:Number(form.lng.replace(',','.'));
  if((lat===null)!==(lng===null)||lat!==null&&(!Number.isFinite(lat)||Math.abs(lat)>85)||lng!==null&&(!Number.isFinite(lng)||Math.abs(lng)>180)||lat===0&&lng===0){setError('Проверьте широту и долготу. Оба значения должны быть заполнены или пусты.');return;}
  const site={id:field(form.id),name:field(form.name),address:field(form.address),phone:field(form.phone),category:form.category,lat,lng,services:form.services.split('\n').map(field).filter(Boolean),hours:field(form.hours)||null,source:field(form.source)};
  lock.current=true;setBusy(true);try{if(item)await put(root+'/'+encodeURIComponent(item.id),{revision:item.revision,site});else await post(root+'/import',[site]);onSaved();}catch(e){setError(message(e));}finally{lock.current=false;setBusy(false);}
 }
 return <form className="card sto-admin-editor" onSubmit={save}>
  <h3>{item?'Редактирование':'Новая карточка'}</h3>
  <p className="note">Сохранение изменений переводит карточку в черновик. Нужна отдельная проверка перед публикацией.</p>
  <div className="sto-admin-fields">
  {([['id','Идентификатор'],['name','Название'],['address','Адрес (с регионом)'],['phone','Телефон +7…'],['lat','Широта'],['lng','Долгота'],['hours','График по источнику'],['source','Ссылка на источник']] as const).map(([k,label])=><label className="stack" key={k}>{label}<input className="field" required={['id','name','address','phone','source'].includes(k)} disabled={busy||k==='id'&&!!item} value={form[k]} onChange={e=>change(k,e.target.value)}/></label>)}
  <label className="stack">Категория<select className="field" disabled={busy} value={form.category} onChange={e=>change('category',e.target.value)}>{Object.entries(categories).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
  <label className="stack">Услуги (по одной на строку)<textarea className="field" required disabled={busy} rows={4} value={form.services} onChange={e=>change('services',e.target.value)}/></label>
  </div>
  {error&&<p role="alert" className="banner bad">{error}</p>}
  <div className="row"><button className="btn" disabled={busy}>Сохранить черновик</button><button className="btn ghost" type="button" disabled={busy} onClick={onCancel}>Отмена</button></div>
 </form>;
}
function ReviewCard({item,onSaved,onEdit}:{item:Item;onSaved:()=>void;onEdit:()=>void}){
 const [source,setSource]=useState(item.source_reuse_checked);
 const [coords,setCoords]=useState(item.location_checked);
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');const lock=useRef(false);
 async function review(state:Status){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await put(root+'/'+encodeURIComponent(item.id)+'/review',{revision:item.revision,state,sourceReuseChecked:source,locationChecked:coords});onSaved();}catch(e){setError(message(e));}finally{lock.current=false;setBusy(false);}}
 return <article className="card sto-admin-site">
 <div className="sto-admin-site-head"><div><b>{item.name}</b><small>{item.address}</small></div><span>{states[item.state]}</span></div>
 <p>{categories[item.category]} · {item.phone}</p><small>{item.services.join(' · ')}</small>
 <p>{item.lat===null||item.lng===null?'Координаты не определены':item.lat+', '+item.lng}</p>
 {item.geocode_source&&<small>Геокодер: {item.geocode_accuracy} · {item.geocode_matched_address} · {item.geocode_source}</small>}
 <a href={/^https?:\/\//i.test(item.source)?item.source:undefined} target="_blank" rel="noopener noreferrer">Источник сведений</a>
 <p>Отзывы: работает — {item.working_reports}; не работает — {item.not_working_reports}</p>
 <label><input type="checkbox" checked={source} disabled={busy} onChange={e=>setSource(e.target.checked)}/> Источник и право использования проверены</label>
 <label><input type="checkbox" checked={coords} disabled={busy||item.lat===null||item.lng===null} onChange={e=>setCoords(e.target.checked)}/> Координаты соответствуют адресу</label>
 {error&&<p role="alert" className="banner bad">{error}</p>}
 <div className="sto-admin-actions">
 <button className="btn small" disabled={busy||!source||!coords||item.lat===null||item.lng===null} onClick={()=>void review('published')}>На карту</button>
 <button className="btn ghost small" disabled={busy} onClick={()=>void review('hidden')}>Скрыть</button>
 <button className="btn ghost small" disabled={busy} onClick={onEdit}>Изменить</button>
 </div></article>;
}
function GeocodeTools({onSaved}:{onSaved:()=>void}){
 const [busy,setBusy]=useState(false),[note,setNote]=useState('');const lock=useRef(false);
 async function exportQueue(){if(lock.current)return;lock.current=true;setBusy(true);setNote('');
  try{const all:{id:string;address:string;revision:number}[]=[];let cursor='';
   for(let i=0;i<100;i++){const r=await get<{items:typeof all}>(root+'/geocode-queue?limit=100&after='+encodeURIComponent(cursor));all.push(...r.items);if(r.items.length<100)break;cursor=r.items[r.items.length-1].id;if(i===99)throw Error('Очередь больше 10 000 строк. Требуется пакетный экспорт.');}
   const url=URL.createObjectURL(new Blob([JSON.stringify(all,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='sto-geocode-queue.json';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);setNote('Выгружено адресов: '+all.length);
  }catch(e){setNote(message(e));}finally{lock.current=false;setBusy(false);}
 }
 async function importFile(file:File|undefined){if(!file||lock.current)return;lock.current=true;setBusy(true);setNote('');
  let saved=0,skipped=0;try{if(file.size>5_000_000)throw Error('Файл больше 5 МБ');const rows=JSON.parse(await file.text());if(!Array.isArray(rows)||rows.length<1||rows.length>10000)throw Error('Нужен JSON-массив до 10 000 строк');if(new Set(rows.map(p=>p?.id)).size!==rows.length)throw Error('Повтор ID в файле');
   for(let i=0;i<rows.length;i+=100){const r=await post<{saved:number;skipped:number}>(root+'/geocode-results',rows.slice(i,i+100));saved+=r.saved;skipped+=r.skipped;}
   setNote('Сохранено: '+saved+'. Пропущено (изменённые/неподходящие карточки): '+skipped+'. Публикации нет.');
  }catch(e){setNote('Сохранено до ошибки: '+saved+'. '+message(e));}finally{onSaved();lock.current=false;setBusy(false);}
 }
 return <details className="card stack"><summary>Массовое определение координат</summary><p className="note">Выгрузите адреса для разрешённого к коммерческому хранению геокодера. В JSON-результате сохраните id, revision, address и добавьте matchedAddress, lat, lng, accuracy (entrance, building или parcel), source (URL) и reuseAllowed: true. Не используйте центры городов. Импорт не публикует точки.</p><button className="btn ghost" disabled={busy} onClick={()=>void exportQueue()}>Выгрузить адреса JSON</button><label className="stack">Импорт результата JSON<input type="file" className="field" accept=".json,application/json" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';void importFile(file);}}/></label>{note&&<p role="status">{note}</p>}</details>;
}
function PilotPublication({onSaved}:{onSaved:()=>void}){
 type PilotItem={id:string;name:string;address:string;phone:string;lat:number;lng:number;evidence:string;status:string};
 const [batch,setBatch]=useState<{batch:string;items:PilotItem[]}|null>(null),[checked,setChecked]=useState(false),[busy,setBusy]=useState(false),[note,setNote]=useState('');
 const lock=useRef(false);
 async function preview(){if(lock.current)return;lock.current=true;setBusy(true);setNote('');setChecked(false);try{setBatch(await get<{batch:string;items:PilotItem[]}>(root+'/pilot'));}catch(e){setNote(message(e));}finally{lock.current=false;setBusy(false);}}
 async function publish(){if(!batch||!checked||lock.current)return;lock.current=true;setBusy(true);setNote('');try{const result=await post<{published:number;alreadyPublished:number;skipped:number}>(root+'/publish-pilot',{batch:batch.batch,confirmSourceReview:true});setNote('Опубликовано: '+result.published+'. Уже на карте: '+result.alreadyPublished+'. Пропущено: '+result.skipped+'.');setBatch(null);setChecked(false);onSaved();}catch(e){setNote(message(e));}finally{lock.current=false;setBusy(false);}}
 return <details className="card stack"><summary>Первая партия на карту — проверенные адреса из сайтов СТО</summary>
 <p className="note">Только сторонние организации, без статуса партнёра и без подтверждения фактической работы. Публикуются контактные факты; изменённые и скрытые карточки не затрагиваются.</p>
 <button type="button" className="btn ghost" disabled={busy} onClick={()=>void preview()}>Проверить готовность первой партии</button>
 {batch&&<><p>Готово к публикации: {batch.items.filter(p=>p.status==='ready').length} из {batch.items.length}</p>
 <div className="stack">{batch.items.map(p=><div key={p.id} className="card"><b>{p.name}</b><small>{p.address} · {p.phone}</small><small>{p.lat}, {p.lng} · {p.status==='ready'?'Готово':p.status==='published'?'На карте':'Пропустить — изменено или отсутствует'}</small><a href={p.evidence} target="_blank" rel="noopener noreferrer">Сайт организации</a></div>)}</div>
 <label><input type="checkbox" checked={checked} disabled={busy} onChange={e=>setChecked(e.target.checked)}/> Подтверждаю проверку источников и допустимость публикации контактных фактов.</label>
 <button className="btn" disabled={busy||!checked||!batch.items.some(p=>p.status==='ready')} onClick={()=>void publish()}>Опубликовать первую партию на карте</button></>}
 {note&&<p role="status">{note}</p>}</details>;
}
const initial={q:'',state:'',category:'',missingGps:false};
export function AdminStoDirectory(){
 const [draft,setDraft]=useState(initial);const [filters,setFilters]=useState(initial);const [cursors,setCursors]=useState(['']);const [items,setItems]=useState<Item[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [version,reload]=useState(0);
 const [edit,setEdit]=useState<Item|null|undefined>(undefined);
 const cursor=cursors[cursors.length-1];const limit=50;
 useEffect(()=>{let active=true;setLoading(true);setError('');setItems([]);const query=new URLSearchParams({after:cursor,limit:String(limit),q:filters.q,state:filters.state,category:filters.category,missingGps:filters.missingGps?'1':'0'});
  get<{items:Item[]}>(root+'?'+query).then(r=>{if(active)setItems(r.items);}).catch(e=>{if(active)setError(message(e));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};
 },[cursor,filters,version]);
 function saved(){setEdit(undefined);reload(v=>v+1);}
 return <div className="stack sto-admin-directory">
 <p className="note">Сторонние СТО не являются партнёрами TrakSOS. Карточка публикуется только после проверки адреса и источника; отзывы не меняют статус автоматически.</p>
 <form className="card sto-admin-fields" onSubmit={e=>{e.preventDefault();setCursors(['']);setFilters({...draft});setEdit(undefined);}}>
 <label className="stack">Поиск по названию, региону, адресу или телефону<input className="field" value={draft.q} maxLength={200} onChange={e=>setDraft(d=>({...d,q:e.target.value}))}/></label>
 <label className="stack">Статус<select className="field" value={draft.state} onChange={e=>setDraft(d=>({...d,state:e.target.value}))}><option value="">Все</option>{Object.entries(states).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
 <label className="stack">Специализация<select className="field" value={draft.category} onChange={e=>setDraft(d=>({...d,category:e.target.value}))}><option value="">Все</option>{Object.entries(categories).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
 <label><input type="checkbox" checked={draft.missingGps} onChange={e=>setDraft(d=>({...d,missingGps:e.target.checked}))}/> Только без GPS</label>
 <button className="btn" type="submit">Найти</button><button className="btn ghost" type="button" onClick={()=>setEdit(null)}>Добавить СТО</button></form>
 <PilotPublication onSaved={()=>reload(v=>v+1)}/>
 <GeocodeTools onSaved={()=>reload(v=>v+1)}/>
 {edit!==undefined&&<Editor key={edit?.id??'new'} item={edit} onSaved={saved} onCancel={()=>setEdit(undefined)}/>}
 {loading&&<p role="status">Загружаем справочник…</p>}{error&&<p className="banner bad" role="alert">{error} <button className="btn ghost small" onClick={()=>reload(v=>v+1)}>Повторить</button></p>}
 {!loading&&!error&&items.length===0&&<p>Карточек по этим условиям нет.</p>}
 <div className="sto-admin-list">{items.map(item=><ReviewCard key={item.id+':'+item.revision} item={item} onSaved={saved} onEdit={()=>setEdit(item)}/>)}</div>
 <div className="row"><button className="btn ghost small" disabled={loading||cursors.length===1} onClick={()=>setCursors(c=>c.slice(0,-1))}>Назад</button><span>Страница {cursors.length}</span><button className="btn ghost small" disabled={loading||items.length<limit} onClick={()=>setCursors(c=>[...c,items[items.length-1].id])}>Далее</button></div>
 </div>;
}
