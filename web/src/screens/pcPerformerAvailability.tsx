import {useRef, useState} from 'react';
import {post} from '../api.ts';
import {useAction, useMe} from '../ui.tsx';
import {LINE} from '../dict.ts';

const statuses = [['online','На линии'],['on_call','На звонке'],['offline','Не на линии']] as const;
const breaks = [[15,'15 мин'],[30,'30 мин'],[60,'1 час'],[120,'2 часа']] as const;

export function PcPerformerAvailability({onChanged}:{onChanged:()=>void}) {
  const {me,reload}=useMe();
  const {busy,run}=useAction();
  const [open,setOpen]=useState(false);
  const [saving,setSaving]=useState(false);
  const [breakOpen,setBreakOpen]=useState(false);
  const pending=useRef(false);
  const p=me?.performer;
  if (!p) return <p>Заполните профиль исполнителя, чтобы управлять доступностью.</p>;
  const known=Object.prototype.hasOwnProperty.call(LINE,p.line_status);
  const onJob=p.line_status==='on_job';
  const locked=busy||saving||onJob||!known;
  const label=p.line_status==='online'?'На линии':known?LINE[p.line_status]:'Статус уточняется';
  const until=p.line_status==='busy' && p.busy_until ? new Date(p.busy_until) : null;
  async function choose(lineStatus:string,minutes?:number) {
    if (pending.current||locked) return;
    pending.current=true;
    setSaving(true);
    try {
      const result=await run(()=>post('/api/performer/line',{
        lineStatus,...(minutes?{busyUntil:new Date(Date.now()+minutes*60000).toISOString()}:{}),
      }));
      // Even if the response was lost, re-read the authoritative state.
      await reload();
      onChanged();
      if(result){setOpen(false);setBreakOpen(false);}
    } finally {pending.current=false;setSaving(false);}
  }
  return <div className="stack" aria-label="Доступность исполнителя">
    <button className="opt" type="button" aria-expanded={open&&!onJob} disabled={locked}
      onClick={()=>{setOpen(v=>!v);setBreakOpen(false);}}>
      <b><span className={'dot '+(p.line_status==='online'&&!p.paused&&!p.extras?.vacation?'on':'')} aria-hidden="true"/> Статус · {label}</b>
      <small>{onJob?'На выезде — статус изменится после завершения':!known?'Обновите профиль':(busy||saving)?'Сохраняем…':'Изменить доступность ⌄'}</small>
    </button>
    {until && Number.isFinite(until.getTime()) && <p className="note">Перерыв до {until.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</p>}
    {p.paused===true&&<p className="note">Приём новых заявок приостановлен.</p>}
    {p.extras?.vacation===true&&<p className="note">В отпуске — новые заявки не приходят.</p>}
    {open&&!onJob&&known&&<div className="stack" aria-label="Выбор доступности">
      {statuses.map(([id,title])=><button key={id} className="opt" type="button" disabled={busy||saving}
        aria-pressed={p.line_status===id} onClick={()=>void choose(id)}>{title}</button>)}
      <button className="opt" type="button" disabled={busy||saving} aria-expanded={breakOpen}
        onClick={()=>setBreakOpen(v=>!v)}>Перерыв · выбрать время</button>
      {breakOpen&&<div className="grid2">{breaks.map(([minutes,title])=><button key={minutes} className="seg"
        type="button" disabled={busy||saving} onClick={()=>void choose('busy',minutes)}>{title}</button>)}</div>}
    </div>}
    <a className="approved-pc-small-link" href="#/work/me/schedule">График и отпуск →</a>
  </div>;
}
