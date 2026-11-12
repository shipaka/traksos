// Operational control: historical unfilled orders, demand by Moscow hour,
// targeted notices and commission campaigns. No fake metrics.
import { useState } from 'react';
import { get, post, put, fmtTime } from '../api.ts';
import { SERVICES, STATUS } from '../dict.ts';
import { useLoad, useAction, Loading, useMe } from '../ui.tsx';

const labels: Record<string,string> = {
  master:'Выездные мастера', tow:'Эвакуаторщики', service:'СТО', all_workers:'Все исполнители',
};
const dateInput = (ms:number) => {
  const d = new Date(ms);
  const z = new Date(ms - d.getTimezoneOffset()*60_000);
  return z.toISOString().slice(0,16);
};
const datetime = (x:string) => new Date(x).toISOString();

function Metric({name,value,hint}:{name:string;value:number|string;hint:string}) {
  return <div className="card tile"><span className="label">{name}</span>
    <b className="tile-value">{value}</b><span className="note">{hint}</span></div>;
}

export function OpsDashboard() {
  const { me } = useMe();
  const admin = !!me?.roles.includes('admin');
  const [days,setDays]=useState(7);
  const [wait,setWait]=useState(15);
  const [filter,setFilter]=useState('all');
  const [onlyOpen,setOnlyOpen]=useState(false);
  const report = useLoad(() => get('/api/admin/demand?days='+days+'&wait='+wait),[days,wait]);
  const {busy,run}=useAction();
  const d=report.data;
  const incidents=(d?.incidents??[]).filter((x:any)=>
    (filter==='all'||x.service===filter) && (!onlyOpen||x.review_state!=='resolved'));
  return <div className="stack" style={{gap:14}}>
    <div className="card">
      <b>Контроль невыполненных заявок</b>
      <span className="note">История не удаляется: не нашёлся исполнитель, отмена до назначения, ожидание ответа и длительное принятие. Время по Москве; ожидание считается от создания заявки, а не от открытия экрана.</span>
      <div className="row" style={{flexWrap:'wrap'}}>
        <label className="stack" style={{gap:3}}>Период
          <select className="field" value={days} onChange={e=>setDays(+e.target.value)}>
            {[1,7,14,30,90,365].map(n=><option key={n} value={n}>{n} дней</option>)}
          </select>
        </label>
        <label className="stack" style={{gap:3}}>Долгое ожидание
          <select className="field" value={wait} onChange={e=>setWait(+e.target.value)}>
            {[5,10,15,30,60,120].map(n=><option key={n} value={n}>{n} минут</option>)}
          </select>
        </label>
        <button className="btn ghost small" onClick={()=>report.reload()}>Обновить данные</button>
      </div>
    </div>
    {!d ? <Loading error={report.error}/> : <>
      <div className="tiles">
        <Metric name="Всего заявок" value={d.summary.total} hint={'За '+days+' дней'}/>
        <Metric name="Не нашёлся мастер" value={d.summary.unfilled} hint="Сохранены в истории"/>
        <Metric name="Отменено до принятия" value={d.summary.cancelled_before_acceptance} hint="Отдельно от отсутствия мастера"/>
        <Metric name="Ждут слишком долго сейчас" value={d.summary.waiting_now} hint={'В поиске более '+wait+' мин'}/>
        <Metric name="Поздно приняты" value={d.summary.accepted_late} hint={'Ответ после '+wait+' мин'}/>
        <Metric name="Выполнены" value={d.summary.completed} hint="Без подмены невыполненных"/>
      </div>
      <div className="card stack">
        <b>Спрос по часам (Москва, МСК)</b>
        <span className="note">«Не нашёлся» — итоговый статус. «Ждёт сейчас» — активная заявка. Отмена до принятия показана отдельно; эти категории нельзя складывать без проверки.</span>
        <div className="scroll-x">
          <table><thead><tr><th>Час</th><th>Заявки</th><th>Никто не взял</th><th>Отмены до приёма</th><th>Ждут сейчас</th><th>Поздно взяли</th></tr></thead>
          <tbody>{Array.from({length:24},(_,h)=>{
            const r=(d.hourly??[]).find((x:any)=>x.hour===h)??{};
            return <tr key={h}><td>{String(h).padStart(2,'0')}:00–{String((h+1)%24).padStart(2,'0')}:00</td>
              <td>{r.total??0}</td><td>{r.unfilled??0}</td><td>{r.cancelled_before_acceptance??0}</td>
              <td>{r.waiting_now??0}</td><td>{r.accepted_late??0}</td></tr>;
          })}</tbody></table>
        </div>
      </div>
      <div className="card stack">
        <b>Где не хватает исполнителей</b>
        <div className="scroll-x"><table><thead><tr><th>Услуга</th><th>Всего</th><th>Никто не взял</th><th>Отмены до приёма</th><th>Ждут сейчас</th></tr></thead>
          <tbody>{(d.byService??[]).map((r:any)=><tr key={r.service}>
            <td>{SERVICES[r.service]?.name??r.service}</td><td>{r.total}</td><td>{r.unfilled}</td>
            <td>{r.cancelled_before_acceptance}</td><td>{r.waiting_now}</td></tr>)}</tbody></table></div>
      </div>
      <div className="card stack">
        <b>Реестр проблемных заявок</b>
        <span className="note">Показываются до 250 последних случаев за период. Отметка «Разобрано» не удаляет заявку и не изменяет её исходный статус.</span>
        <div className="row" style={{flexWrap:'wrap'}}>
          <select className="field" aria-label="Фильтр по услуге" value={filter} onChange={e=>setFilter(e.target.value)}>
            <option value="all">Все услуги</option>
            {Object.entries(SERVICES).map(([k,v])=><option key={k} value={k}>{v.name}</option>)}
          </select>
          <label className="row"><input type="checkbox" checked={onlyOpen} onChange={e=>setOnlyOpen(e.target.checked)}/> Только неразобранные</label>
        </div>
        {incidents.length===0 && <span className="note">За выбранный период случаев не найдено.</span>}
        {incidents.map((o:any)=><IncidentRow key={o.id} order={o} editable={admin}
          onSave={async (state,note)=>{const x=await run(()=>put('/api/admin/demand/'+o.id+'/review',{state,note}),'Разбор сохранён');if(x)report.reload();}} busy={busy}/>)}
      </div>
    </>}
  </div>;
}

function IncidentRow({order:o,editable,onSave,busy}:{order:any;editable:boolean;onSave:(state:'open'|'investigating'|'resolved',note:string)=>Promise<void>;busy:boolean}) {
  const [state,setState]=useState<'open'|'investigating'|'resolved'>(o.review_state??'open');
  const [note,setNote]=useState(o.review_note??'');
  return <div className="card" style={{gap:7}}>
    <div className="between"><a href={'#/order/'+o.id}><b>№{o.number} · {SERVICES[o.service]?.name??o.service}{o.is_sos?' · SOS':''}</b></a>
      <span className={'pill '+(o.status==='no_performer'?'bad':'warn')}>{STATUS[o.status]?.name??o.status}</span></div>
    <span className="note">{fmtTime(o.created_at)} · {o.zone_id??''} · {o.address??'Адрес не указан'} · ожидание {Math.max(0,Math.round(o.elapsed_minutes))} мин</span>
    {o.cancel_reason&&<span className="note">Причина отмены: {o.cancel_reason}</span>}
    {editable ? <div className="stack" style={{gap:6}}>
      <select className="field" value={state} onChange={e=>setState(e.target.value as any)}>
        <option value="open">Не разобрано</option><option value="investigating">В работе</option><option value="resolved">Разобрано</option>
      </select>
      <input className="field" value={note} maxLength={1200} onChange={e=>setNote(e.target.value)} placeholder="Причина, решение и что улучшить"/>
      <button className="btn ghost small" disabled={busy} onClick={()=>onSave(state,note)}>Сохранить разбор</button>
    </div>:<span className="note">Разбор: {o.review_state??'не начат'} · {o.review_note??''}</span>}
  </div>;
}

const DEFAULT_AUDIENCE='master';
export function WorkerCommunications() {
  const [audience,setAudience]=useState(DEFAULT_AUDIENCE);
  const [service,setService]=useState('');
  const [title,setTitle]=useState('');
  const [body,setBody]=useState('');
  const [from,setFrom]=useState(dateInput(Date.now()+60_000));
  const [to,setTo]=useState(dateInput(Date.now()+7*86_400_000));
  const [published,setPublished]=useState(true);
  const notices=useLoad(()=>get('/api/admin/announcements'),[]);
  const campaigns=useLoad(()=>get('/api/admin/commission-campaigns'),[]);
  const [promoService,setPromoService]=useState('');
  const [promoPct,setPromoPct]=useState(0);
  const [promoFrom,setPromoFrom]=useState(dateInput(Date.now()+60_000));
  const [promoTo,setPromoTo]=useState(dateInput(Date.now()+3_600_000));
  const [reason,setReason]=useState('');
  const {busy,run}=useAction();
  const a=async()=>{const r=await run(()=>post('/api/admin/announcements',{
    audience,service:service||null,title,body,startsAt:datetime(from),endsAt:datetime(to),published
  }),'Объявление создано');if(r){notices.reload();setTitle('');setBody('');}};
  const c=async()=>{if(!window.confirm('Комиссия по новым заявкам в этот интервал изменится. Это финансовое действие. Подтвердить?'))return;
    const r=await run(()=>post('/api/admin/commission-campaigns',{
      service:promoService||null,commissionPct:promoPct,startsAt:datetime(promoFrom),
      endsAt:datetime(promoTo),enabled:true,reason
    }),'Акция комиссии сохранена');if(r){campaigns.reload();setReason('');}};
  return <div className="stack" style={{gap:14}}>
    <div className="card stack">
      <b>Объявления для исполнителей</b>
      <span className="note">Публикации по отдельным кабинетам и услугам. Подходят для просьбы выходить ночью, объявлений о загрузке и изменениях. В объявлении нельзя заменять официальные правила расчётов.</span>
      <label className="stack">Кому
        <select className="field" value={audience} onChange={e=>setAudience(e.target.value)}>
          {Object.entries(labels).map(([k,v])=><option key={k} value={k}>{v}</option>)}
        </select></label>
      <label className="stack">Услуга (необязательно)
        <select className="field" value={service} onChange={e=>setService(e.target.value)}>
          <option value="">Все услуги</option>{Object.entries(SERVICES).map(([k,v])=><option key={k} value={k}>{v.name}</option>)}
        </select></label>
      <label className="stack">Заголовок
        <input className="field" value={title} maxLength={140} onChange={e=>setTitle(e.target.value)}/></label>
      <label className="stack">Сообщение
        <textarea className="field" rows={4} maxLength={3000} value={body} onChange={e=>setBody(e.target.value)} placeholder="Например: за неделю в 01:00–02:00 осталось 15 заявок без исполнителя. Укажите проверенные цифры по таблице." /></label>
      <div className="grid2">
        <label className="stack">Начало<input type="datetime-local" className="field" value={from} onChange={e=>setFrom(e.target.value)}/></label>
        <label className="stack">Конец<input type="datetime-local" className="field" value={to} onChange={e=>setTo(e.target.value)}/></label>
      </div>
      <label className="row"><input type="checkbox" checked={published} onChange={e=>setPublished(e.target.checked)}/> Опубликовать после наступления даты</label>
      <button className="btn" disabled={busy||title.trim().length<3||body.trim().length<3} onClick={a}>Сохранить объявление</button>
    </div>
    <div className="card stack">
      <b>Временная комиссия площадки</b>
      <span className="note">Ставка применяется только к новым заявкам в интервале, фиксируется в заявке и сохраняется до расчёта. Клиентский сервисный сбор, цены мастеров и старые заявки не изменяются. Наложение акций запрещено.</span>
      <label className="stack">Услуга
        <select className="field" value={promoService} onChange={e=>setPromoService(e.target.value)}>
          <option value="">Все виды выезда</option>{Object.entries(SERVICES).filter(([k])=>k!=='consult').map(([k,v])=><option key={k} value={k}>{v.name}</option>)}
        </select></label>
      <label className="stack">Комиссия платформы, % (0 — без комиссии)
        <input className="field" type="number" min={0} max={100} step={0.5} value={promoPct} onChange={e=>setPromoPct(Number(e.target.value))}/></label>
      <div className="grid2">
        <label className="stack">С<input type="datetime-local" className="field" value={promoFrom} onChange={e=>setPromoFrom(e.target.value)}/></label>
        <label className="stack">До<input type="datetime-local" className="field" value={promoTo} onChange={e=>setPromoTo(e.target.value)}/></label>
      </div>
      <label className="stack">Причина изменения
        <textarea className="field" rows={2} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label>
      <button className="btn" disabled={busy||reason.trim().length<3} onClick={c}>Назначить комиссию</button>
    </div>
    <div className="card stack">
      <b>Объявления (история)</b>
      {!notices.data?<Loading error={notices.error}/>:notices.data.length===0?<span className="note">Пока пусто</span>:notices.data.map((x:any)=>
        <div key={x.id} className="list-item stack">
          <b>{x.title} · {labels[x.audience]??x.audience}</b>
          <span className="note">{x.body}</span>
          <span className="note">{fmtTime(x.starts_at)} — {fmtTime(x.ends_at)} · {x.published?'опубликовано':'черновик'}</span>
        </div>)}
    </div>
    <div className="card stack">
      <b>Акции комиссии (история)</b>
      {!campaigns.data?<Loading error={campaigns.error}/>:campaigns.data.length===0?<span className="note">Акций пока нет</span>:campaigns.data.map((x:any)=>
        <div key={x.id} className="list-item stack">
          <b>{x.commission_pct}% · {x.service?(SERVICES[x.service]?.name??x.service):'Все выездные услуги'}</b>
          <span className="note">{fmtTime(x.starts_at)} — {fmtTime(x.ends_at)} · {x.enabled?'включена':'выключена'}</span>
          <span className="note">{x.reason}</span>
        </div>)}
    </div>
  </div>;
}

export function WorkerNotices({audience}:{audience?:'service'}) {
  const {me}=useMe();
  const mode=audience==='service'?'service':me?.roles.includes('tow')?'tow':'master';
  const list=useLoad(()=>get('/api/worker/announcements?audience='+mode),[mode]);
  if(!list.data?.length)return null;
  return <div className="stack" style={{gap:8}}>
    {list.data.map((x:any)=><div key={x.id} className="card hi">
      <b>{x.title}</b>
      <span className="note">{x.body}</span>
      <span className="note">До {fmtTime(x.ends_at)}{x.service?' · '+(SERVICES[x.service]?.name??x.service):''}</span>
    </div>)}
  </div>;
}
