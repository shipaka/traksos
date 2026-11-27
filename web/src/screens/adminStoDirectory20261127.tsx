import {useEffect,useRef,useState} from 'react';
import {get,post,put} from '../api.ts';
import './adminStoDirectory20261127.css';
type Category='sto'|'tyre'|'wash'|'refrigeration'|'trailer';
type Status='draft'|'published'|'hidden';
type Site={id:string;name:string;address:string;phone:string;category:Category;lat:number|null;lng:number|null;services:string[];hours:string|null;source:string};
type Item=Site&{state:Status;revision:number;source_reuse_checked:boolean;location_checked:boolean;working_reports:number;not_working_reports:number};
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
 {edit!==undefined&&<Editor key={edit?.id??'new'} item={edit} onSaved={saved} onCancel={()=>setEdit(undefined)}/>}
 {loading&&<p role="status">Загружаем справочник…</p>}{error&&<p className="banner bad" role="alert">{error} <button className="btn ghost small" onClick={()=>reload(v=>v+1)}>Повторить</button></p>}
 {!loading&&!error&&items.length===0&&<p>Карточек по этим условиям нет.</p>}
 <div className="sto-admin-list">{items.map(item=><ReviewCard key={item.id+':'+item.revision} item={item} onSaved={saved} onEdit={()=>setEdit(item)}/>)}</div>
 <div className="row"><button className="btn ghost small" disabled={loading||cursors.length===1} onClick={()=>setCursors(c=>c.slice(0,-1))}>Назад</button><span>Страница {cursors.length}</span><button className="btn ghost small" disabled={loading||items.length<limit} onClick={()=>setCursors(c=>[...c,items[items.length-1].id])}>Далее</button></div>
 </div>;
}
