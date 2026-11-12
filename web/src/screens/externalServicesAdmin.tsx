import { useState } from 'react';
import { get, post, put } from '../api.ts';
import { useAction, useLoad, Loading } from '../ui.tsx';

type Entry = {id:string;name:string;address:string;lat:number|null;lng:number|null;hours:string|null;public_notes:string|null;private_phone:string|null;visibility:'draft'|'published'|'hidden';outreach_status:'not_contacted'|'contacted'|'interested'|'declined'};
const outreach = {not_contacted:'Не связывались',contacted:'Связались',interested:'Заинтересованы',declined:'Отказались'};
const visibility = {draft:'Черновик',published:'На карте',hidden:'Скрыто'};
export function ExternalServicesAdmin() {
 const entries = useLoad<Entry[]>(()=>get('/api/admin/external-services'),[]);
 const {busy,run}=useAction();
 const [form,setForm]=useState({name:'',address:'',lat:'',lng:'',hours:'',publicNotes:'',privatePhone:''});
 const [expanded,setExpanded]=useState(false);
 const [editing,setEditing]=useState<string|null>(null);
 const [edit,setEdit]=useState({name:'',address:'',lat:'',lng:'',hours:'',publicNotes:'',privatePhone:''});
 const beginEdit=(e:Entry)=>{setEditing(e.id);setEdit({name:e.name,address:e.address,lat:e.lat==null?'':String(e.lat),lng:e.lng==null?'':String(e.lng),hours:e.hours??'',publicNotes:e.public_notes??'',privatePhone:e.private_phone??''});};
 const saveEdit=async()=>{if(!editing)return;const lat=edit.lat.trim()?Number(edit.lat.replace(',','.')):null,lng=edit.lng.trim()?Number(edit.lng.replace(',','.')):null;if((lat===null)!==(lng===null))return;const result=await run(()=>put(`/api/admin/external-services/${editing}`,{...edit,lat,lng,hours:edit.hours||null,publicNotes:edit.publicNotes||null,privatePhone:edit.privatePhone||null}),'Карточка сохранена');if(result!==undefined){setEditing(null);entries.reload();}};
 const save=async()=>{
   const lat=form.lat.trim()?Number(form.lat.replace(',','.')):undefined;
   const lng=form.lng.trim()?Number(form.lng.replace(',','.')):undefined;
   if((lat===undefined)!==(lng===undefined)) return;
   const result=await run(()=>post('/api/admin/external-services',{...form,lat,lng,visibility:'draft'}),'Рембаза добавлена в черновики');
   if(result!==undefined){setForm({name:'',address:'',lat:'',lng:'',hours:'',publicNotes:'',privatePhone:''});setExpanded(false);entries.reload();}
 };
 const change=async(e:Entry,visibilityValue:Entry['visibility'],outreachStatus?:Entry['outreach_status'])=>{
   const result=await run(()=>post(`/api/admin/external-services/${e.id}/status`,{visibility:visibilityValue,outreachStatus}),'Карточка обновлена');
   if(result!==undefined) entries.reload();
 };
 return <div className="stack" style={{gap:14}}>
   <div className="between"><div><h2>Справочник сторонних рембаз</h2><p className="note">Серые точки карты. Не партнёры, пока не зарегистрируются и не примут оферту. Телефон виден только сотрудникам.</p></div><button className="btn small" onClick={()=>setExpanded(v=>!v)}>{expanded?'Закрыть':'Добавить рембазу'}</button></div>
   {expanded && <div className="card stack" style={{gap:8}}>
     <b>Новая справочная рембаза</b>
     {([['name','Название *'],['address','Адрес *'],['lat','Широта'],['lng','Долгота'],['hours','Часы работы'],['publicNotes','Примечание для клиента'],['privatePhone','Телефон для переговоров (не публикуется)']] as const).map(([key,label])=><label key={key} className="stack" style={{gap:4}}><span className="label">{label}</span><input className="field" value={form[key]} onChange={e=>setForm(v=>({...v,[key]:e.target.value}))}/></label>)}
     {Boolean(form.lat.trim())!==Boolean(form.lng.trim()) && <span className="note">Укажите обе координаты или оставьте обе пустыми.</span>}
     <button className="btn" disabled={busy||form.name.trim().length<2||form.address.trim().length<4||Boolean(form.lat.trim())!==Boolean(form.lng.trim())} onClick={save}>Сохранить черновик</button>
   </div>}
   {entries.error && <Loading error={entries.error}/>}
   {entries.data?.length===0 && <div className="empty">Пока нет справочных рембаз. Добавьте первую запись.</div>}
   {(entries.data??[]).map(e=><div className="card stack" key={e.id} style={{gap:8}}>
     <div className="between"><b>{e.name}</b><span className="pill">{visibility[e.visibility]}</span></div>
     <span className="note">{e.address}{e.hours?' · '+e.hours:''}</span>
     {e.public_notes && <span className="note">{e.public_notes}</span>}
     {e.private_phone && <span className="note">Контакт для переговоров: {e.private_phone}</span>}
     <button className="btn ghost small" onClick={()=>editing===e.id?setEditing(null):beginEdit(e)}>{editing===e.id?'Отменить редактирование':'Изменить данные'}</button>
     {editing===e.id && <div className="stack" style={{gap:6}}>{([['name','Название'],['address','Адрес'],['lat','Широта'],['lng','Долгота'],['hours','Часы работы'],['publicNotes','Примечание'],['privatePhone','Внутренний телефон']] as const).map(([key,label])=><label className="stack" key={key}><span className="label">{label}</span><input className="field" value={edit[key]} onChange={ev=>setEdit(v=>({...v,[key]:ev.target.value}))}/></label>)}<button className="btn small" disabled={busy||edit.name.trim().length<2||edit.address.trim().length<4} onClick={saveEdit}>Сохранить изменения</button></div>}
     <label className="stack" style={{gap:4}}><span className="label">Результат переговоров</span><select className="field" value={e.outreach_status} disabled={busy} onChange={ev=>change(e,e.visibility,ev.target.value as Entry['outreach_status'])}>{Object.entries(outreach).map(([v,n])=><option key={v} value={v}>{n}</option>)}</select></label>
     <div className="row" style={{gap:8}}>{e.visibility!=='published'?<button className="btn small" disabled={busy||e.lat==null||e.lng==null} onClick={()=>change(e,'published')}>Показать на карте</button>:<button className="btn ghost small" disabled={busy} onClick={()=>change(e,'hidden')}>Скрыть с карты</button>}{e.visibility!=='draft'&&<button className="btn ghost small" disabled={busy} onClick={()=>change(e,'draft')}>В черновик</button>}</div>
     {e.lat==null&&<span className="note">Для отметки на карте нужны координаты.</span>}
   </div>)}
 </div>;
}
