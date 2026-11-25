import {useEffect,useRef,useState} from 'react';
import {get,getToken,put} from '../api.ts';
import {useMe} from '../ui.tsx';
import {usePrivateRead} from './privateRead20261124.ts';

/** Courier availability has its own two-state API, not the master shift model. */
export function CourierAvailability({desktop=false}:{desktop?:boolean}){
  const {me}=useMe();
  const token=getToken();
  return <CourierAvailabilityForSession key={JSON.stringify([me?.id,token])} desktop={desktop} token={token}/>;
}
function CourierAvailabilityForSession({desktop,token}:{desktop:boolean;token:string|null}){
  const p=usePrivateRead<{online:boolean}>(async()=>{
    const value=await get('/api/courier/presence');
    if(typeof value?.online!=='boolean')throw Error('Статус не подтверждён');
    return value;
  },'courier-presence',e=>e.type==='connection_restored'||e.type==='courier_presence_changed');
  const [open,setOpen]=useState(false);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const pending=useRef(false);
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const current=()=>mounted.current&&getToken()===token;
  useEffect(()=>{
    const refresh=()=>{if(current()&&!pending.current)void p.reload();};
    const visible=()=>{if(document.visibilityState==='visible')refresh();};
    window.addEventListener('online',refresh);
    document.addEventListener('visibilitychange',visible);
    return()=>{window.removeEventListener('online',refresh);document.removeEventListener('visibilitychange',visible);};
  },[p.reload,token]);
  async function choose(online:boolean){
    if(pending.current||p.loading||p.error||!p.data||!current())return;
    if(p.data.online===online){setOpen(false);return;}
    pending.current=true;setSaving(true);setError(null);
    let failed=false;
    try{await put('/api/courier/presence',{online});}
    catch{failed=true;if(current())setError('Не удалось подтвердить изменение статуса. Проверяем состояние на сервере.');}
    finally{
      if(current()){
        await p.reload();
        if(current()){setSaving(false);if(!failed)setOpen(false);}
      }
      pending.current=false;
    }
  }
  const confirmed=!p.loading&&!p.error&&p.data!==null;
  const buttonClass=desktop?'courier-pc-presence':'courier-switch';
  return <div className="courier-availability-menu" aria-label="Доступность курьера для новых доставок">
    <button type="button" className={buttonClass+(confirmed&&p.data?.online?(desktop?' on':' is-on'):'')}
      disabled={!confirmed||saving} aria-expanded={open&&confirmed}
      onClick={()=>{setOpen(v=>!v);setError(null);}}>
      <span aria-hidden="true" className={desktop?'courier-pc-light':'courier-presence-dot'}/>
      Статус · {confirmed?(p.data!.online?'На линии':'Не на линии'):'Уточняется'}
      <span aria-hidden="true">⌄</span>
    </button>
    {p.error&&<div role="alert" className="courier-presence-error">Не удалось проверить статус линии.
      <button type="button" className={buttonClass} disabled={saving||p.loading}
        onClick={()=>void p.reload()}>Повторить проверку статуса</button></div>}
    {saving&&<small role="status">Проверяем сохранённый статус…</small>}
    {error&&<small role="alert">{error}</small>}
    {open&&confirmed&&<div className="stack courier-availability-options" aria-label="Выбор доступности курьера">
      <button type="button" className="opt" aria-pressed={p.data!.online} disabled={saving}
        onClick={()=>void choose(true)}>На линии</button>
      <button type="button" className="opt" aria-pressed={!p.data!.online} disabled={saving}
        onClick={()=>void choose(false)}>Не на линии</button>
      <small>Статус относится к новым назначениям. Текущие доставки сохраняются.</small>
    </div>}
  </div>;
}
