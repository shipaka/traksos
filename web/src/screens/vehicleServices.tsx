import { useEffect, useRef, useState } from 'react';
import { get, post, patch, fmtTime, onEvent } from '../api.ts';
import { useAction, useMe } from '../ui.tsx';
import { insurancePresentation } from '../insurancePresentation.ts';

const validFutureDate=(value:string):boolean=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+'T00:00:00Z');
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value
    &&value>new Date().toISOString().slice(0,10);
};

/** Оформление заявки для владельца или водителя с разрешением владельца. */
export function VehicleServiceApplication({ vehicleId, onCreated }: { vehicleId: string; onCreated: () => void }) {
  const { busy, run } = useAction();
  const [kind, setKind] = useState<'insurance' | 'inspection'>('insurance');
  const [comment, setComment] = useState('');
  const [open, setOpen] = useState(false);
  const vehicleIdRef=useRef(vehicleId);
  vehicleIdRef.current=vehicleId;
  useEffect(()=>{
    // The vehicle selection can change without unmounting this form.
    // Never retain the previous truck's comment or open submit action.
    setKind('insurance');setComment('');setOpen(false);
  },[vehicleId]);
  return (
    <div className="stack">
      <button type="button" className="btn ghost small" onClick={() => setOpen(!open)}>
        {open ? 'Скрыть оформление' : 'Страхование / техосмотр'}
      </button>
      {open && <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        if (kind === 'insurance') return;
        const created = await run(() => post('/api/vehicle-service-requests', { vehicleId, kind, comment: comment || undefined }), 'Заявка отправлена');
        if (created && vehicleIdRef.current===vehicleId) {
          setOpen(false);setComment('');onCreated();
        }
      }}>
        <select className="field" aria-label="Услуга" value={kind} onChange={(e) => setKind(e.target.value as 'insurance' | 'inspection')}>
          <option value="insurance">Страхование</option>
          <option value="inspection">Техосмотр</option>
        </select>
        {kind === 'insurance' && <>
          <div className="banner">
            Страхование оформляется с выбранным агентом: ФИО, полные данные грузовика,
            предложения от 1 до 20 страховых компаний и готовый PDF в одной переписке.
          </div>
          <a className="btn" href={`#/insurance/request/new/${vehicleId}`}>Выбрать агента и заполнить анкету →</a>
        </>}
        {kind === 'inspection' && <>
        <textarea className="field" aria-label="Комментарий к заявке" placeholder="Комментарий (необязательно)" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} />
        <span className="note">Заявка передаётся на обработку. Оформление полиса или техосмотра выполняет уполномоченный партнёр.</span>
        <button className="btn small" disabled={busy}>Отправить заявку</button>
        </>}
      </form>}
    </div>
  );
}

/** История страхования и техосмотра доступна прямо в карточке машины. */
export function VehicleServiceHistory({ id, isDriver, refreshVersion }: { id: string; isDriver: boolean; refreshVersion: number }) {
  const { me } = useMe();
  const [open, setOpen] = useState(false);
  const identity=(me?.id??'')+':'+id;
  const identityRef=useRef(identity);
  identityRef.current=identity;
  const serialRef=useRef(0);
  const [reloadVersion,setReloadVersion]=useState(0);
  const [history,setHistory]=useState<{
    identity:string;items:any[]|null;error:string;loading:boolean;
  }>({identity:'',items:null,error:'',loading:true});
  const [renewing,setRenewing]=useState<string|null>(null);
  const [expiry,setExpiry]=useState('');
  const [savingError,setSavingError]=useState('');
  const { busy, run } = useAction();
  const reloadHistory=()=>setReloadVersion(version=>version+1);
  useEffect(()=>{
    // Every GET belongs to exactly one account and vehicle; old requests
    // can never publish old plates or histories into the next workspace.
    const serial=++serialRef.current;
    const requestedBy=identity;
    setHistory({identity,items:null,error:'',loading:true});
    get<any[]>(`/api/vehicles/${id}/service-history`).then(result=>{
      if(serial!==serialRef.current||identityRef.current!==requestedBy)return;
      if(!Array.isArray(result))throw new Error('Некорректный ответ истории');
      setHistory({identity:requestedBy,items:result,error:'',loading:false});
    }).catch(e=>{
      if(serial!==serialRef.current||identityRef.current!==requestedBy)return;
      setHistory({identity:requestedBy,items:null,
        error:e instanceof Error?e.message:'Не удалось получить историю',loading:false});
    });
    return ()=>{serialRef.current++;};
  },[identity,refreshVersion,reloadVersion,id]);
  useEffect(()=>onEvent(event=>{
    if(event.type==='connection_restored'||(event.type==='vehicle_service'&&event.vehicleId===id))
      reloadHistory();
  }),[id]);
  useEffect(()=>{
    setOpen(false);setRenewing(null);setExpiry('');setSavingError('');
  },[identity]);
  const current=history.identity===identity?history:null;
  const items=current&&!current.error?current.items:null;
  const activeInsurance=(items??[]).filter(r=>r.kind==='insurance'&&
    !['completed','cancelled','rejected'].includes(r.status));
  if (!items) return <div className="stack" role="status">
    {current?.error ? <div className="banner warn" role="alert">
      Не удалось загрузить историю услуг: {current.error}
      <button type="button" className="btn ghost small" onClick={reloadHistory}>
        Повторить загрузку истории
      </button>
    </div> : <div className="note">Загружаем историю страхования и техосмотра…</div>}
  </div>;
  const labels: Record<string, string> = {
    submitted: 'Подана', in_review: 'На рассмотрении', need_documents: 'Нужны документы',
    sent_to_partner: 'Передана партнёру', completed: 'Завершена',
    rejected: 'Отказ', cancelled: 'Отменена',
  };
  const statusHelp: Record<string, string> = {
    submitted: 'Заявка получена и ожидает рассмотрения.',
    in_review: 'Специалист проверяет вашу заявку.',
    need_documents: 'Для продолжения нужны дополнительные документы. Проверьте комментарий специалиста.',
    sent_to_partner: 'Заявка передана партнёру для выполнения услуги.',
    completed: 'Услуга выполнена. Информация сохранена в истории автомобиля.',
    rejected: 'Заявка отклонена. Причина указана в комментарии специалиста, если он добавлен.',
    cancelled: 'Заявка отменена и больше не обрабатывается.',
  };
  return (
    <div className="stack">
      <button type="button" className="linkrow" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span><b>Страхование и техосмотр · {items.length}</b>
          <small>{activeInsurance.length>0
            ? 'Активных страховых заявок: '+activeInsurance.length+' · отслеживайте этапы ниже'
            : 'Заявки, статусы и сроки полисов'}</small></span>
        <span aria-hidden="true">{open ? '˄' : '˅'}</span>
      </button>
      {!open&&activeInsurance.length>0&&<section className="insurance-garage-active stack" aria-label="Активные страховые заявки">
        {activeInsurance.slice(0,2).map(r=>{
          const state=insurancePresentation(r.insurance_stage,r.status);
          return <article className={'insurance-garage-live tone-'+state.tone} key={r.id}>
            <div className="insurance-garage-live-head">
              <span className="insurance-step-title">МОЯ СТРАХОВКА · АКТИВНАЯ ЗАЯВКА</span>
              <span className="insurance-garage-pulse" aria-hidden="true">●</span>
            </div>
            <strong>{state.label}</strong>
            <p>{state.detail}</p>
            <span className="insurance-live-next">{state.next}</span>
            <div className="insurance-garage-live-foot">
              <small>Отправлена {fmtTime(r.created_at)}</small>
              {r.insurance_stage&&<a className="btn small" href={`#/insurance/request/${r.id}`}>
                Открыть заявку и предложения →</a>}
            </div>
          </article>;
        })}
        {activeInsurance.length>2&&<span className="note">
          Ещё {activeInsurance.length-2} активных страховых заявок · откройте всю историю выше
        </span>}
      </section>}
      {open && <div className="stack">
        {items.length === 0 && <span className="note">Пока нет заявок на страхование и техосмотр. После подачи они появятся здесь вместе с историей изменений.</span>}
        {items.map((r: any) => (
          <div key={r.id} className={'insurance-garage-history-item'+(r.kind==='insurance'?' insurance-garage-history-policy':'')}>
            <div className="insurance-garage-history-head">
              <b>{r.kind === 'insurance' ? 'Страхование' : 'Техосмотр'}</b>
              <span className={'pill '+(['completed'].includes(r.status)?'good':
                ['rejected','cancelled'].includes(r.status)?'bad':'accent')}>
                {r.kind==='insurance'?insurancePresentation(r.insurance_stage,r.status).label:(labels[r.status]??r.status)}
              </span>
            </div>
            {' · Подана '}{fmtTime(r.created_at)}
            {r.updated_at && <span> · Обновлена {fmtTime(r.updated_at)}</span>}
            {r.policy_expires_on && <span> · Действует до {String(r.policy_expires_on).slice(0, 10)}</span>}
            <div>{r.kind==='insurance'?insurancePresentation(r.insurance_stage,r.status).detail:(statusHelp[r.status]??'Статус уточняется.')}</div>
            {r.staff_note && <div><b>Комментарий специалиста:</b> {r.staff_note}</div>}
            {r.kind === 'insurance' && r.insurance_stage && <a className="btn ghost small"
              href={`#/insurance/request/${r.id}`}>Открыть страховую переписку и предложения →</a>}
            {['submitted', 'in_review', 'need_documents'].includes(r.status) && (!isDriver || r.requested_by === me?.id) && (
              <button type="button" className="btn ghost small" disabled={busy}
                onClick={async () => {
                  if (!window.confirm('Отменить заявку? После отмены её нельзя будет возобновить.')) return;
                  const result = await run(() => post(`/api/vehicle-service-requests/${r.id}/cancel`), 'Заявка отменена');
                  if (result && identityRef.current === identity) reloadHistory();
                }}>
                Отменить заявку
              </button>
            )}
            {Array.isArray(r.events) && r.events.length > 0 && (
              <details>
                <summary>История изменений · {r.events.length}</summary>
                <div className="stack">
                  {r.events.map((event: any, index: number) => (
                    <div className="note" key={index}>
                      <b>{labels[event.status] ?? event.status}</b>
                      {' · '}{fmtTime(event.changed_at)}
                      {event.policy_expires_on && <span> · Срок полиса: {String(event.policy_expires_on).slice(0, 10)}</span>}
                      {event.note && <div>{event.note}</div>}
                    </div>
                  ))}
                </div>
              </details>
            )}
            {!isDriver && r.kind === 'insurance' && r.status === 'completed' && (
              <div className="stack">
                {renewing === r.id ? (
                  <div className="stack">
                    <label>Новая дата окончания полиса
                      <input type="date" value={expiry} min={new Date(Date.now()+86400000).toISOString().slice(0, 10)}
                        aria-invalid={!!expiry&&!validFutureDate(expiry)||undefined}
                        onChange={(e) => {setExpiry(e.target.value);setSavingError('');}} />
                    </label>
                    {expiry&&!validFutureDate(expiry)&&
                      <p className="note" role="alert">Новая дата должна быть корректной и позже сегодняшнего дня.</p>}
                    {savingError&&<div className="banner warn" role="alert">{savingError}</div>}
                    <div className="row">
                      <button className="btn small" disabled={busy||!validFutureDate(expiry)} onClick={async () => {
                        const result=await run(()=>patch(`/api/vehicle-service-requests/${r.id}/renewal`,
                          {expiresOn:expiry}),'Срок полиса обновлён');
                        if(identityRef.current!==identity)return;
                        if(result){setRenewing(null);setSavingError('');reloadHistory();}
                        else setSavingError('Срок не подтверждён. Проверьте историю заявки перед повторной отправкой.');
                      }}>Сохранить срок</button>
                      <button className="btn ghost small" disabled={busy}
                        onClick={()=>{setRenewing(null);setSavingError('');}}>Отмена</button>
                    </div>
                  </div>
                ) : <button className="btn ghost small" onClick={() => { setExpiry(r.policy_expires_on?.slice(0, 10) ?? '');setSavingError('');setRenewing(r.id); }}>Указать новый срок полиса</button>}
              </div>
            )}
          </div>
        ))}
      </div>}
    </div>
  );
}

