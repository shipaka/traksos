import {useEffect,useState} from 'react';
import {get,put} from '../api.ts';
import {useAction,useLoad} from '../ui.tsx';

type Options={
  dmInvites:boolean;dmMessages:boolean;caseReplies:boolean;quietEnabled:boolean;
  quietStartMinute:number;quietEndMinute:number;quietTimezone:string;
  mutedRoomIds:string[];mutedThreadIds:string[];
  appliesOnlyToCommunity:boolean;normalOrderAndSecurityNotificationsUnaffected:boolean
};
const zones=['Europe/Moscow','Europe/Kaliningrad','Europe/Samara',
  'Asia/Yekaterinburg','Asia/Omsk','Asia/Novosibirsk','Asia/Krasnoyarsk',
  'Asia/Irkutsk','Asia/Yakutsk','Asia/Vladivostok','Asia/Magadan','Asia/Kamchatka'];
const toTime=(m:number)=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
const toMinutes=(time:string)=>{const [h,m]=time.split(':').map(Number);return h*60+m};
const initial={
  dmInvites:true,dmMessages:false,caseReplies:false,quietEnabled:false,
  quietStartMinute:1320,quietEndMinute:480,quietTimezone:'Europe/Moscow'
};
export function CommunityNotificationSettings({professional=false}:{professional?:boolean}){
 const data=useLoad<Options>(()=>get('/api/community/notification-preferences'),[]);
 const [prefs,setPrefs]=useState(initial);
 const {busy,run}=useAction();
 useEffect(()=>{if(data.data)setPrefs({
   dmInvites:data.data.dmInvites,dmMessages:data.data.dmMessages,
   caseReplies:data.data.caseReplies,quietEnabled:data.data.quietEnabled,
   quietStartMinute:data.data.quietStartMinute,quietEndMinute:data.data.quietEndMinute,
   quietTimezone:data.data.quietTimezone
 })},[data.data]);
 const save=async()=>{
   const updated=await run(()=>put('/api/community/notification-preferences',prefs),
     'Настройки уведомлений сообщества сохранены');
   if(updated)await data.reload();
 };
 const field=(key:'dmInvites'|'dmMessages'|'caseReplies'|'quietEnabled',name:string)=>(
   <label className="air-checkbox" key={key}>
     <input type="checkbox" checked={prefs[key]}
       onChange={e=>setPrefs(s=>({...s,[key]:e.target.checked}))}/>
     {name}
   </label>
 );
 return <section className="card stack" aria-label="Уведомления водительского сообщества и ТехБазы">
   <h2>Уведомления сообщества</h2>
   <p className="note">Обычные заявки, SOS, безопасность аккаунта, платежи
     и рабочие уведомления TrakSOS этими настройками не отключаются.
     Чат продолжает получать сообщения при открытом экране.</p>
   {data.error&&<p role="alert">{data.error}
     <button className="btn ghost" type="button" onClick={data.reload}>Повторить</button>
   </p>}
   {data.data&&<>
     {field('dmInvites','Приглашения в личные водительские чаты')}
     {field('dmMessages','Новые личные сообщения — выключены по умолчанию')}
     {field('caseReplies','Ответы на мои технические вопросы — выключены по умолчанию')}
     {field('quietEnabled','Тихие часы для уведомлений сообщества')}
     {prefs.quietEnabled&&<div className="tech-filters">
       <label>Без уведомлений с
         <input type="time" className="field" required value={toTime(prefs.quietStartMinute)}
           onChange={e=>setPrefs(s=>({...s,quietStartMinute:toMinutes(e.target.value)}))}/>
       </label>
       <label>До
         <input type="time" className="field" required value={toTime(prefs.quietEndMinute)}
           onChange={e=>setPrefs(s=>({...s,quietEndMinute:toMinutes(e.target.value)}))}/>
       </label>
       <label>Часовой пояс для тихих часов
         <input className="field" list="tracksos-timezones" maxLength={80}
           value={prefs.quietTimezone} onChange={e=>setPrefs(s=>({...s,quietTimezone:e.target.value}))}/>
         <datalist id="tracksos-timezones">
           {zones.map(z=><option value={z} key={z}/>)}
         </datalist>
       </label>
     </div>}
     <p className="note">Настройки действуют только для уведомлений сообщества.
       Если временно выключить уведомления, прочитать историю можно в самом чате.
       Отдельный звук или содержание сообщения в пуш не передаются.</p>
     <button className="btn" type="button" disabled={busy||
       prefs.quietEnabled&&prefs.quietStartMinute===prefs.quietEndMinute}
       onClick={()=>void save()}>Сохранить уведомления</button>
   </>}
 </section>;
}

/** A single visible conversation can be muted independently, no per-row polling. */
export function CommunityMuteToggle({id,kind}:{
  id:string;kind:'room'|'thread'
}){
 const data=useLoad<Options>(()=>get('/api/community/notification-preferences'),[id,kind]);
 const {busy,run}=useAction();
 if(!data.data)return null;
 const list=kind==='room'?data.data.mutedRoomIds:data.data.mutedThreadIds;
 const muted=list.includes(id);
 const toggle=async()=>{
   const result=await run(()=>put('/api/community/notification-preferences/'+
     (kind==='room'?'rooms':'threads')+'/'+id,{muted:!muted}),
     muted?'Уведомления этого чата включены':'Уведомления этого чата отключены');
   if(result)await data.reload();
 };
 return <button type="button" className="btn ghost small" disabled={busy}
   aria-pressed={muted} onClick={()=>void toggle()}>
   {muted?'Включить уведомления':'Без уведомлений'}
 </button>;
}
