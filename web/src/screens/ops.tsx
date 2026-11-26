// Operational control: historical unfilled orders, demand by Moscow hour,
// targeted notices and commission campaigns. No fake metrics.
import { useCallback, useEffect, useRef, useState } from 'react';
import { get, post, put } from '../api.ts';
import { SERVICES, STATUS } from '../dict.ts';
import { useAction, Loading, useMe } from '../ui.tsx';

const labels: Record<string,string> = {
  master:'Выездные мастера', tow:'Эвакуаторщики', service:'СТО', all_workers:'Все исполнители',
};
// Explicit Moscow time for promotions. The administrator's device can be abroad.
const dateInput = (ms:number) => new Date(ms+3*3_600_000).toISOString().slice(0,16);
const datetime = (x:string) => new Date(x+':00+03:00').toISOString();
const validMskWindow = (start:string,end:string,maxDays:number) => {
  // datetime-local can be cleared while editing. Avoid RangeError outside
  // useAction's catch path; never show an enabled Save button for invalid dates.
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(start) ||
     !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(end))return false;
  const a=Date.parse(start+':00+03:00'),b=Date.parse(end+':00+03:00');
  return Number.isFinite(a)&&Number.isFinite(b)&&b>a&&b-a<=maxDays*86_400_000;
};
// A published future announcement is scheduled, not deliverable. A past
// announcement remains in history; neither state may show a dead Send button.
const workerNoticeWindow = (x:{starts_at:string;ends_at:string;published:boolean},at=Date.now()) => {
  const starts=new Date(x.starts_at).getTime(),ends=new Date(x.ends_at).getTime();
  if(!Number.isFinite(starts)||!Number.isFinite(ends)||ends<=starts)return 'invalid';
  if(ends<=at)return 'expired';
  if(!x.published)return 'draft';
  return starts>at?'scheduled':'active';
};
// Show the campaign's real time interval without changing recorded order fees.
const campaignWindow = (x:{starts_at:string;ends_at:string},at=Date.now()) => {
  const start=new Date(x.starts_at).getTime();
  const end=new Date(x.ends_at).getTime();
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return 'invalid';
  if(end<=at)return 'expired';
  return start>at?'scheduled':'active';
};
const mskTime = (iso:string) => new Date(iso).toLocaleString('ru-RU', {
  timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'
})+' МСК';

/**
 * Account-scoped operational read: the generic useLoad retains a prior
 * response on failure and can commit old filter/account responses out of order.
 * Never show stale demand metrics, private notices or commission campaign data.
 */
function useOpsRead<T>(load:()=>Promise<T>,scope:string){
  const loader=useRef(load);
  loader.current=load;
  const sequence=useRef(0);
  const [snapshot,setSnapshot]=useState<{scope:string;data:T|null;error:string|null}>(
    {scope,data:null,error:null});
  const reload=useCallback(async()=>{
    const request=++sequence.current;
    setSnapshot({scope,data:null,error:null});
    try{
      const data=await loader.current();
      if(request===sequence.current)setSnapshot({scope,data,error:null});
    }catch(error){
      if(request===sequence.current)setSnapshot({
        scope,data:null,error:error instanceof Error?error.message:'Не удалось загрузить данные',
      });
    }
  },[scope]);
  useEffect(()=>{
    void reload();
    return ()=>{sequence.current++;};
  },[reload]);
  // Hide stale scope before the next effect, even during a fast role switch.
  const current=snapshot.scope===scope?snapshot:null;
  return {data:current?.data??null,error:current?.error??null,reload};
}

function Metric({name,value,hint}:{name:string;value:number|string;hint:string}) {
  return <div className="card tile"><span className="label">{name}</span>
    <b className="tile-value">{value}</b><span className="note">{hint}</span></div>;
}

export function OpsDashboard() {
  const {me}=useMe();
  if(!me?.roles.includes('admin'))return null;
  return <AdminOpsDashboard key={me.id} userId={me.id}/>;
}
function AdminOpsDashboard({userId}:{userId:string}) {
  const admin=true;
  const [days,setDays]=useState(7);
  const [wait,setWait]=useState(15);
  const [filter,setFilter]=useState('all');
  const [onlyOpen,setOnlyOpen]=useState(false);
  const report = useOpsRead<any>(()=>get('/api/admin/demand?days='+days+'&wait='+wait),
    'demand:'+userId+':'+days+':'+wait);
  const sla = useOpsRead<any>(()=>get('/api/admin/order-sla?days='+days),
    'sla:'+userId+':'+days);
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
        <Metric name="Были без исполнителя" value={d.summary.unfilled} hint={'В том числе повторно найденных: '+(d.summary.recovered_after_retry??0)}/>
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
      {admin && <div className="card stack" aria-label="Спрос на партнёров по зонам">
        <b>Где подключать новых партнёров · услуга и зона</b>
        <span className="note">Только реальные заявки за выбранный период, сгруппированные по виду работы и зоне заявки. «Без исполнителя» включает случаи, впоследствии найденные при повторном поиске. Зона не определена — географию заявки достоверно установить нельзя. Здесь нет адресов, телефонов и GPS водителей.</span>
        {(d.byServiceZone??[]).length===0
          ? <span className="note">Подтверждённых случаев отсутствия исполнителя за период нет.</span>
          : <div className="scroll-x"><table>
              <thead><tr><th>Услуга</th><th>Зона</th><th>Были без исполнителя</th><th>Всего заявок</th></tr></thead>
              <tbody>{(d.byServiceZone??[]).map((r:any)=><tr key={r.service+':'+r.zone_id}>
                <td>{SERVICES[r.service]?.name??r.service}</td>
                <td>{r.zone_id==='unknown'?'Зона не определена':r.zone_id}</td>
                <td>{r.unfilled}</td><td>{r.total}</td>
              </tr>)}</tbody>
            </table></div>}
      </div>}
      {admin && <div className="card stack">
        <b>Контроль зависших этапов · третий табличный блок</b>
        <span className="note">Поиск, ожидание выезда, дорога, работа, подтверждение. Контрольный интервал — не доказательство вины. Выезд далеко за КАД требует отдельной проверки времени маршрута. Указанная причина остаётся в журнале.</span>
        <button className="btn ghost small" style={{alignSelf:'flex-start'}} onClick={()=>sla.reload()}>Обновить нарушения этапов</button>
        {!sla.data ? <Loading error={sla.error}/> : <>
          <div className="scroll-x"><table><thead><tr><th>Заявка / этап</th><th>Начало этапа</th><th>Контрольная дата</th><th>Текущий статус</th><th>Разбор</th></tr></thead>
            <tbody>{sla.data.incidents.length ? sla.data.incidents.map((i:any)=>
              <SlaIncidentRow key={i.id+':'+(i.reviewed_at??'')+':'+(i.review_state??'')} incident={i} onSaved={()=>sla.reload()}/>) :
              <tr><td colSpan={5}>Зависших этапов за период нет.</td></tr>}</tbody>
          </table></div>
          <b>Повторяющиеся случаи за 30 дней</b>
          <span className="note">Только подтверждённые администратором нарушения попадают в счётчик. Три и более — повод для индивидуальной проверки, а не автоматического штрафа.</span>
          <div className="scroll-x"><table><thead><tr><th>Исполнитель</th><th>Подтверждено</th><th>На проверке</th><th>Рекомендация</th></tr></thead>
            <tbody>{sla.data.repeat.length ? sla.data.repeat.map((p:any)=>
              <tr key={p.performer_id}><td>{p.performer_name||'Без имени'}</td>
                <td>{p.confirmed}</td><td>{p.pending}</td>
                <td>{p.confirmed>=3?'Индивидуальный разбор систематичности':p.confirmed>=1?'Предупреждение / анализ':'Проверить причины'}</td></tr>) :
              <tr><td colSpan={4}>Повторных инцидентов нет.</td></tr>}</tbody>
          </table></div>
        </>}
      </div>}
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
        {incidents.map((o:any)=><IncidentRow key={o.id+':'+(o.reviewed_at??'')+':'+(o.review_state??'')} order={o} editable={admin}
          onSave={async (state,note)=>{const x=await run(()=>put('/api/admin/demand/'+o.id+'/review',{state,note}),'Разбор сохранён');if(x)report.reload();}} busy={busy}/>)}
      </div>
    </>}
  </div>;
}

function SlaIncidentRow({incident:i,onSaved}:{incident:any;onSaved:()=>void}) {
  const [state,setState]=useState<'investigating'|'confirmed'|'excused'>(
    i.review_state==='confirmed'||i.review_state==='excused'?i.review_state:'investigating');
  const [note,setNote]=useState(i.review_note??'');
  const {busy,run}=useAction();
  const names:Record<string,string>={
    searching:'Поиск исполнителя',awaiting_owner:'Ждёт владельца',accepted:'Не выехал',
    en_route:'В пути',arrived:'На месте',working:'Работает',awaiting_confirmation:'Ждёт клиента',
  };
  return <tr>
    <td><a href={'#/order/'+i.order_id}>№{i.number}</a>{i.is_sos?' · SOS':''}<div className="note">{names[i.stage]??i.stage}</div></td>
    <td>{mskTime(i.stage_started_at)}</td>
    <td>{mskTime(i.due_at)}</td>
    <td>{STATUS[i.current_status]?.name??i.current_status}</td>
    <td><div className="stack" style={{minWidth:210,gap:5}}>
      <span className="note">{i.review_state==='confirmed'?'Подтверждено':i.review_state==='excused'?'Без вины':i.review_state==='investigating'?'Разбирается':'Ожидает разбора'}</span>
      <select className="field" aria-label="Решение по инциденту" value={state}
        disabled={busy} onChange={e=>setState(e.target.value as typeof state)}>
        <option value="investigating">В работе</option><option value="confirmed">Подтверждено</option>
        <option value="excused">Обоснованная задержка</option>
      </select>
      <input className="field" value={note} maxLength={1200} placeholder="Причина и доказательства"
        aria-label="Объяснение и доказательства" onChange={e=>setNote(e.target.value)}/>
      <button className="btn ghost small" disabled={busy||note.trim().length<10}
        onClick={async()=>{if(await run(()=>put('/api/admin/order-sla/'+i.id+'/review',{state,note}),'Разбор сохранён'))onSaved();}}>Сохранить</button>
    </div></td>
  </tr>;
}

function IncidentRow({order:o,editable,onSave,busy}:{order:any;editable:boolean;onSave:(state:'open'|'investigating'|'resolved',note:string)=>Promise<void>;busy:boolean}) {
  const [state,setState]=useState<'open'|'investigating'|'resolved'>(o.review_state??'open');
  const [note,setNote]=useState(o.review_note??'');
  return <div className="card" style={{gap:7}}>
    <div className="between"><a href={'#/order/'+o.id}><b>№{o.number} · {SERVICES[o.service]?.name??o.service}{o.is_sos?' · SOS':''}</b></a>
      <span className={'pill '+(o.status==='no_performer'?'bad':'warn')}>{STATUS[o.status]?.name??o.status}</span></div>
    <span className="note">{mskTime(o.created_at)} · {o.zone_id??''} · {o.address??'Адрес не указан'} · ожидание {Math.max(0,Math.round(o.elapsed_minutes))} мин</span>
    {o.had_no_performer && o.status!=='no_performer' && <span className="note">Ранее исполнитель не нашёлся; затем заявку запустили повторно. Это остаётся в аналитике.</span>}
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
  const {me}=useMe();
  if(!me?.roles.includes('admin'))return null;
  return <AdminWorkerCommunications key={me.id} userId={me.id}/>;
}
function AdminWorkerCommunications({userId}:{userId:string}){
  const [audience,setAudience]=useState(DEFAULT_AUDIENCE);
  const [service,setService]=useState('');
  const [title,setTitle]=useState('');
  const [body,setBody]=useState('');
  const [from,setFrom]=useState(dateInput(Date.now()-60_000));
  const [to,setTo]=useState(dateInput(Date.now()+7*86_400_000));
  const [published,setPublished]=useState(true);
  const notices=useOpsRead<any[]>(()=>get('/api/admin/announcements'),'admin-notices:'+userId);
  const campaigns=useOpsRead<any[]>(()=>get('/api/admin/commission-campaigns'),'admin-campaigns:'+userId);
  const [promoService,setPromoService]=useState('');
  const [promoPct,setPromoPct]=useState('0');
  const [promoFrom,setPromoFrom]=useState(dateInput(Date.now()+60_000));
  const [promoTo,setPromoTo]=useState(dateInput(Date.now()+3_600_000));
  const [reason,setReason]=useState('');
  const {busy,run}=useAction();
  const announcementDatesOk=validMskWindow(from,to,90) &&
    // Saved drafts can have old dates for historical audit, but a new
    // publication with an expired end time would always fail server validation.
    (!published || Date.parse(to+':00+03:00')>Date.now());
  const commissionRate=promoPct.trim()===''?NaN:Number(promoPct);
  const campaignStart=Date.parse(promoFrom+':00+03:00');
  const campaignDatesOk=validMskWindow(promoFrom,promoTo,31) &&
    Number.isFinite(campaignStart) && campaignStart>=Date.now()-60_000;
  const a=async()=>{
    if(!announcementDatesOk||title.trim().length<3||body.trim().length<3)return;
    const r=await run(()=>post('/api/admin/announcements',{
    audience,service:service||null,title,body,startsAt:datetime(from),endsAt:datetime(to),published
  }),'Объявление создано');if(r){notices.reload();setTitle('');setBody('');}};
  const c=async()=>{
    if(!campaignDatesOk||reason.trim().length<3||promoPct.trim()===''||
       !Number.isFinite(commissionRate)||commissionRate<0||commissionRate>5)return;
    if(!window.confirm('Комиссия по новым заявкам в этот интервал изменится. Это финансовое действие. Подтвердить?'))return;
    const r=await run(()=>post('/api/admin/commission-campaigns',{
      service:promoService||null,commissionPct:commissionRate,startsAt:datetime(promoFrom),
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
        <label className="stack">Начало (МСК)<input type="datetime-local" className="field" value={from} onChange={e=>setFrom(e.target.value)}/></label>
        <label className="stack">Конец (МСК)<input type="datetime-local" className="field" value={to} onChange={e=>setTo(e.target.value)}/></label>
      </div>
      {!announcementDatesOk && <span className="note" role="status">Укажите начало и конец объявления по Москве: конец позже начала, срок не более 90 дней; для публикации окончание должно быть в будущем.</span>}
      <label className="row"><input type="checkbox" checked={published} onChange={e=>setPublished(e.target.checked)}/> Опубликовать после наступления даты</label>
      <button className="btn" disabled={busy||title.trim().length<3||body.trim().length<3||!announcementDatesOk} onClick={a}>Сохранить объявление</button>
    </div>
    <div className="card stack">
      <b>Временная комиссия площадки</b>
      <span className="note">Ставка применяется только к новым заявкам в интервале, фиксируется в заявке и сохраняется до расчёта. Клиентский сервисный сбор, цены мастеров и старые заявки не изменяются. Наложение акций запрещено.</span>
      <label className="stack">Услуга
        <select className="field" value={promoService} onChange={e=>setPromoService(e.target.value)}>
          <option value="">Все виды выезда</option>{Object.entries(SERVICES).filter(([k])=>k!=='consult'&&k!=='ecu').map(([k,v])=><option key={k} value={k}>{v.name}</option>)}
        </select></label>
      <label className="stack">Комиссия платформы, % (0 — без комиссии)
        <input className="field" type="number" min={0} max={5} step={0.5} value={promoPct} onChange={e=>setPromoPct(e.target.value)}/></label>
      <div className="grid2">
        <label className="stack">С (МСК)<input type="datetime-local" className="field" value={promoFrom} onChange={e=>setPromoFrom(e.target.value)}/></label>
        <label className="stack">До (МСК)<input type="datetime-local" className="field" value={promoTo} onChange={e=>setPromoTo(e.target.value)}/></label>
      </div>
      <label className="stack">Причина изменения
        <textarea className="field" rows={2} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label>
      {!campaignDatesOk && <span className="note" role="status">Укажите будущие начало и конец акции по Москве; срок не более 31 дня.</span>}
      {(promoPct.trim()==='' || !Number.isFinite(commissionRate) || commissionRate<0 || commissionRate>5) &&
        <span className="note" role="status">Укажите комиссию от 0 до 5%. Акции уменьшают утверждённую ставку; пустое поле не означает 0%.</span>}
      <button className="btn" disabled={busy||reason.trim().length<3||promoPct.trim()===''||!campaignDatesOk||
           !Number.isFinite(commissionRate)||commissionRate<0||commissionRate>5} onClick={c}>Назначить комиссию</button>
    </div>
    <div className="card stack">
      <b>Объявления (история)</b>
      {!notices.data?<div className="stack"><Loading error={notices.error}/>{notices.error&&
        <button type="button" className="btn ghost small" onClick={()=>{void notices.reload();}}>Повторить загрузку объявлений</button>}</div>:notices.data.length===0?<span className="note">Пока пусто</span>:notices.data.map((x:any)=>
        <div key={x.id} className="list-item stack">
          <b>{x.title} · {labels[x.audience]??x.audience}</b>
          <span className="note">{x.body}</span>
          <span className="note">{mskTime(x.starts_at)} — {mskTime(x.ends_at)} · {({
             draft:'черновик',scheduled:'запланировано',active:'действует',
             expired:'срок истёк',invalid:'неверные даты',
           } as Record<string,string>)[workerNoticeWindow(x)]}</span>
          <span className="note">{x.notified_at?'Уведомление отправлено '+mskTime(x.notified_at)+' · получателей '+x.notified_count:'Push-рассылка ещё не отправлялась'}</span>
          {workerNoticeWindow(x)==='scheduled' && !x.notified_at && <span className="note">Рассылка будет доступна с начала объявления. Обновите раздел после наступления даты.</span>}
          {workerNoticeWindow(x)==='expired' && <span className="note">Срок закончился. Для нового периода создайте отдельное объявление.</span>}
          {workerNoticeWindow(x)==='active' && !x.notified_at && <button className="btn small" disabled={busy} onClick={async()=>{
            if(!window.confirm('Отправить одно уведомление всем исполнителям выбранной группы? Повторная рассылка этого объявления будет заблокирована.'))return;
            const r=await run(()=>post('/api/admin/announcements/'+x.id+'/notify',{}),'Уведомления отправлены');
            if(r)notices.reload();
          }}>Разослать уведомление</button>}
          <button className="btn ghost small" disabled={busy||(!x.published && ['expired','invalid'].includes(workerNoticeWindow(x)))} onClick={async()=>{
            const r=await run(()=>put('/api/admin/announcements/'+x.id+'/status',{published:!x.published}),
              x.published?'Объявление снято':'Объявление опубликовано');
            if(r)notices.reload();
          }}>{x.published?'Снять с публикации':'Опубликовать'}</button>
        </div>)}
    </div>
    <div className="card stack">
      <b>Акции комиссии (история)</b>
      {!campaigns.data?<div className="stack"><Loading error={campaigns.error}/>{campaigns.error&&
        <button type="button" className="btn ghost small" onClick={()=>{void campaigns.reload();}}>Повторить загрузку акций</button>}</div>:campaigns.data.length===0?<span className="note">Акций пока нет</span>:campaigns.data.map((x:any)=>
        <div key={x.id} className="list-item stack">
          <b>{x.commission_pct}% · {x.service?(SERVICES[x.service]?.name??x.service):'Все выездные услуги'}</b>
          <span className="note">{mskTime(x.starts_at)} — {mskTime(x.ends_at)} · {x.enabled?'включена':'выключена'} · {({
             invalid:'некорректный срок',expired:'срок истёк',
             scheduled:'начало впереди',active:'текущий период'
           } as Record<string,string>)[campaignWindow(x)]}</span>
           {!x.enabled && campaignWindow(x)==='expired' &&
             <span className="note">Истёкшую акцию нельзя включить. Для нового периода создайте новую.</span>}
          <span className="note">{x.reason}</span>
          <button className="btn ghost small" disabled={busy||(!x.enabled&&['expired','invalid'].includes(campaignWindow(x)))} onClick={async()=>{
            if(!window.confirm(x.enabled?'Отключить акцию для новых заявок? Уже созданные заявки сохранят свою ставку.':'Включить акцию для новых заявок?'))return;
            const r=await run(()=>put('/api/admin/commission-campaigns/'+x.id+'/status',{enabled:!x.enabled}),
              x.enabled?'Акция выключена':'Акция включена');
            if(r)campaigns.reload();
          }}>{x.enabled?'Остановить акцию':'Включить акцию'}</button>
        </div>)}
    </div>
  </div>;
}

export function WorkerNotices({audience}:{audience?:'service'}) {
  const {me}=useMe();
  if(!me?.roles.some(r=>r==='master'||r==='tow'||r==='service'))return null;
  // A station-only account must never fall through to the roadside master feed.
  const stationOnly=me.roles.includes('service')&&!me.roles.some(r=>r==='master'||r==='tow');
  const mode=audience==='service'||stationOnly?'service':me.roles.includes('tow')?'tow':'master';
  return <WorkerNoticesScoped key={me.id+':'+mode}
    userId={me.id} mode={mode} specialties={me.performer?.specialties??[]}/>;
}
function WorkerNoticesScoped({userId,mode,specialties}:{
  userId:string;mode:'service'|'tow'|'master';specialties:string[];
}) {
  const list=useOpsRead<any[]>(()=>get('/api/worker/announcements?audience='+mode),
    'worker-notices:'+userId+':'+mode);
  // Dispatch campaigns change only the mobile worker fee. Station (СТО)
  // bookings use a separate contract; never advertise roadside 0% there.
  const promos=useOpsRead<any[]>(()=>mode==='service'
      ?Promise.resolve([]):get('/api/worker/commission-campaigns'),
    'worker-campaigns:'+userId+':'+mode);
  const matching = (service?:string|null) => !service ||
    (mode==='service' ? true : mode==='tow' ? service==='tow' :
      specialties.includes(service) || (service==='ecu' && specialties.includes('electric')));
  const [clock,setClock]=useState(()=>Date.now());
  const [online,setOnline]=useState(()=>navigator.onLine);
  useEffect(()=>{
    let lastRefresh=-Infinity;
    const tick=()=>setClock(Date.now());
    const refresh=()=>{
      tick();setOnline(navigator.onLine);
      if(document.visibilityState==='hidden'||!navigator.onLine)return;
      const now=performance.now();
      // Focus and visibility can arrive together. Avoid duplicate GETs,
      // including after a user changes the device clock.
      if(now-lastRefresh<1000)return;
      lastRefresh=now;
      void list.reload();void promos.reload();
    };
    const disconnected=()=>{tick();setOnline(false);};
    const expiryTimer=window.setInterval(tick,1000);
    const refreshTimer=window.setInterval(refresh,60000);
    window.addEventListener('focus',refresh);
    window.addEventListener('online',refresh);
    window.addEventListener('offline',disconnected);
    document.addEventListener('visibilitychange',refresh);
    return ()=>{
      window.clearInterval(expiryTimer);window.clearInterval(refreshTimer);
      window.removeEventListener('focus',refresh);
      window.removeEventListener('online',refresh);
      window.removeEventListener('offline',disconnected);
      document.removeEventListener('visibilitychange',refresh);
    };
  },[list.reload,promos.reload]);
  // Even a successful old snapshot stops being applicable at the exact end
  // of its interval. The local clock only hides data; it never grants a rate.
  const announcements=(list.data??[]).filter((x:any)=>
    matching(x.service)&&workerNoticeWindow(x,clock)==='active');
  const offers=(promos.data??[]).filter((x:any)=>
    matching(x.service)&&campaignWindow(x,clock)==='active');
  // A failed private GET cannot mean there are "no campaigns" and must not
  // keep a previous account's discount or announcement visible.
  if(!online||list.error||promos.error)return <div className="card stack" role="alert">
    <b>Не удалось проверить объявления и действующие акции</b>
    <span className="note">Проверьте соединение. Актуальная ставка подтверждается в конкретной заявке.</span>
    <button type="button" className="btn ghost small" disabled={!online} onClick={()=>{
      if(list.error||!list.data)void list.reload();
      if(promos.error||!promos.data)void promos.reload();
    }}>Повторить загрузку</button>
  </div>;
  if(!announcements.length&&!offers.length)return null;
  return <div className="stack" style={{gap:8}}>
    {offers.map((x:any)=><div key={'campaign-'+x.id} className="card hi">
      <b>Комиссия платформы {x.commission_pct}%{x.service?' · '+(SERVICES[x.service]?.name??x.service):''}</b>
      <span className="note">{x.reason}</span>
      <span className="note">До {mskTime(x.ends_at)}. Ставка закрепляется за новыми заявками, созданными во время акции.</span>
    </div>)}
    {announcements.map((x:any)=><div key={x.id} className="card hi">
      <b>{x.title}</b>
      <span className="note">{x.body}</span>
      <span className="note">До {mskTime(x.ends_at)}{x.service?' · '+(SERVICES[x.service]?.name??x.service):''}</span>
    </div>)}
  </div>;
}
