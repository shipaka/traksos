import {useEffect,useRef,useState} from 'react';
import { post, patch, fmtTime } from '../api.ts';
import {useAction,useMe} from '../ui.tsx';
import {useAdminScopedResource} from '../adminScopedResource20261124.ts';
import {parseAdminRubles,displayAdminRubles} from '../adminFinanceKopecks20261124.ts';

function validFutureDate(value:string):boolean {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+'T00:00:00Z');
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value
    &&value>new Date().toISOString().slice(0,10);
}

export function VehicleServicesQueue() {
  const {me}=useMe();
  const admin=!!me?.roles.includes('admin');
  const scope=(me?.id??'signed-out')+':vehicle-services-admin';
  const scopeRef=useRef(scope);
  scopeRef.current=scope;
  const [draftScope,setDraftScope]=useState('');
  const currentDraft=draftScope===scope;
  const list=useAdminScopedResource<any[]>('/api/admin/vehicle-service-requests',scope,admin);
  const insurers=useAdminScopedResource<any[]>('/api/admin/insurers',scope,admin);
  const inspectionPartners=useAdminScopedResource<any[]>('/api/admin/inspection-partners',scope,admin);
  const rows=Array.isArray(list.data)?list.data:null;
  const eligibleInsurers=Array.isArray(insurers.data)?insurers.data:[];
  const eligibleInspectors=Array.isArray(inspectionPartners.data)?inspectionPartners.data:[];
  const [selectedInsurers, setSelectedInsurers] = useState<Record<string, string>>({});
  const [direction,setDirection]=useState<'insurance'|'inspection'>('insurance');
  const { busy, run } = useAction();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [expiry, setExpiry] = useState<Record<string, string>>({});
  const [accrualAmounts,setAccrualAmounts]=useState<Record<string,string>>({});
  const [accrualReasons,setAccrualReasons]=useState<Record<string,string>>({});
  const [payoutAmounts,setPayoutAmounts]=useState<Record<string,string>>({});
  const [payoutReferences,setPayoutReferences]=useState<Record<string,string>>({});
  const [reversalAmounts,setReversalAmounts]=useState<Record<string,string>>({});
  const [reversalReasons,setReversalReasons]=useState<Record<string,string>>({});
  const [actionError,setActionError]=useState('');
  const ledgerLock=useRef(false);
  const [ledgerUnconfirmed,setLedgerUnconfirmed]=useState(false);
  useEffect(()=>{
    setDraftScope(scope);setSelectedInsurers({});setNotes({});setExpiry({});
    setAccrualAmounts({});setAccrualReasons({});setPayoutAmounts({});
    setPayoutReferences({});setReversalAmounts({});setReversalReasons({});
    setActionError('');setDirection('insurance');setLedgerUnconfirmed(false);
  },[scope]);
  const labels: Record<string, string> = {
    submitted: 'Подана', in_review: 'На рассмотрении', need_documents: 'Нужны документы',
    sent_to_partner: 'Передана партнёру', completed: 'Завершена',
    rejected: 'Отказ', cancelled: 'Отменена',
  };
  const next: Record<string, string[]> = {
    submitted: ['in_review', 'rejected', 'cancelled'],
    in_review: ['need_documents', 'sent_to_partner', 'rejected', 'cancelled'],
    need_documents: ['in_review', 'cancelled'],
    sent_to_partner: ['completed', 'rejected', 'cancelled'],
  };
  async function change(id:string,status:string,kind:string) {
    const startedAs=scope;
    const note=(currentDraft?(notes[id]??''):'').trim();
    const expiration=currentDraft?(expiry[id]??''):'';
    if(['rejected','need_documents'].includes(status)&&!note){
      setActionError('Укажите причину отказа или какие документы нужны клиенту.');
      return;
    }
    if(status==='completed'&&kind==='insurance'&&!validFutureDate(expiration)){
      setActionError('Для завершения страхования нужна корректная дата окончания полиса позже сегодняшнего дня.');
      return;
    }
    setActionError('');
    const result=await run(()=>patch(`/api/admin/vehicle-service-requests/${id}`,{
      status,note:note||undefined,
      policyExpiresOn:status==='completed'&&kind==='insurance'?expiration:undefined,
    }),'Статус обновлён');
    if(scopeRef.current!==startedAs)return;
    if(result){
      setNotes(old=>({...old,[id]:''}));setExpiry(old=>({...old,[id]:''}));
      list.reload();
    }else setActionError('Изменение статуса не подтверждено. Сверьте очередь перед повтором.');
  }
  async function saveLedger(id:string,action:'accrual'|'payout'|'reversal') {
    if(busy||!admin||!currentDraft||!rows||ledgerLock.current||ledgerUnconfirmed)return;
    const startedAs=scope;
    const raw=action==='accrual'?accrualAmounts[id]:action==='payout'?payoutAmounts[id]:reversalAmounts[id];
    const detail=(action==='accrual'?accrualReasons[id]:
      action==='payout'?payoutReferences[id]:reversalReasons[id])?.trim()??'';
    const amountKopecks=parseAdminRubles(raw??'');
    if(amountKopecks===null||detail.length<3){
      setActionError('Укажите сумму больше нуля строго до копейки и основание операции (не менее 3 символов).');
      return;
    }
    const labels={
      accrual:'Подтвердить начисление',
      payout:'Деньги уже переведены? Зарегистрировать выплату',
      reversal:'Уменьшить подтверждённый невыплаченный остаток на',
    };
    if(!window.confirm(labels[action]+' '+displayAdminRubles(amountKopecks)+'?'))return;
    const path='/api/admin/partner-finance/'+
      (action==='accrual'?'accruals':action==='payout'?'payouts':'reversals');
    const payload=action==='accrual'?{requestId:id,amountKopecks,note:detail}:
      action==='payout'?{requestId:id,amountKopecks,reference:detail}:
      {requestId:id,amountKopecks,reason:detail};
    setActionError('');
    ledgerLock.current=true;
    const result=await run(()=>post(path,payload),
      action==='accrual'?'Начисление зарегистрировано':
        action==='payout'?'Выплата учтена':'Корректировка учтена').finally(()=>{ledgerLock.current=false;});
    if(scopeRef.current!==startedAs)return;
    if(result){
      if(action==='accrual'){
        setAccrualAmounts(old=>({...old,[id]:''}));setAccrualReasons(old=>({...old,[id]:''}));
      }else if(action==='payout'){
        setPayoutAmounts(old=>({...old,[id]:''}));setPayoutReferences(old=>({...old,[id]:''}));
      }else {
        setReversalAmounts(old=>({...old,[id]:''}));setReversalReasons(old=>({...old,[id]:''}));
      }
      list.reload();
    }else {setLedgerUnconfirmed(true);setActionError('Финансовая запись не подтверждена. Перед повтором проверьте журнал и остаток по заявке.');}
  }
  if(!admin)return <div className="card stack">
    <h2>Страховые заявки и техосмотры</h2>
    <p role="alert">Управление назначениями и финансовыми начислениями доступно только администратору.</p>
  </div>;
  return <div className="stack">
    <h2>{direction==='insurance'?'Страховые заявки':'Заявки на техосмотр'}</h2>
    <nav className="partner-workspaces" aria-label="Направление заявок">
      <button type="button" className={'btn ghost'+(direction==='insurance'?' active':'')} aria-pressed={direction==='insurance'} onClick={()=>setDirection('insurance')}>Страхование</button>
      <button type="button" className={'btn ghost'+(direction==='inspection'?' active':'')} aria-pressed={direction==='inspection'} onClick={()=>setDirection('inspection')}>Техосмотры</button>
    </nav>
    {actionError&&<div className="banner warn" role="alert">{actionError}</div>}
    {ledgerUnconfirmed&&<div className="banner warn"><p>Повторная финансовая запись заблокирована до сверки.</p><button type="button" className="btn ghost small" onClick={list.reload}>Обновить реестр для сверки</button><button type="button" className="btn ghost small" disabled={!rows||list.loading} onClick={()=>setLedgerUnconfirmed(false)}>Журнал и остаток проверены</button></div>}
    {!rows ? <div className="card stack" role={list.error?'alert':'status'}>
      {list.error?'Не удалось загрузить заявки: '+list.error:
        list.data?'Получены некорректные данные. Обновите реестр.':'Загружаем заявки…'}
      <button type="button" className="btn ghost small" onClick={list.reload}>
        Повторить загрузку заявок
      </button>
    </div> : rows.filter((r:any)=>r.kind===direction).length === 0 ? <div className="empty">Заявок в этом направлении пока нет</div> : rows.filter((r:any)=>r.kind===direction).map((r: any) =>
      <div className="card" key={r.id}>
        <div className="between"><b>{r.kind === 'insurance' ? 'Страхование' : 'Техосмотр'} · {r.brand} {r.model ?? ''}</b><span className="pill">{labels[r.status] ?? r.status}</span></div>
        <span className="note">{r.plate ?? 'Без номера'} · {fmtTime(r.created_at)}</span>
        {r.comment && <span className="note">Клиент: {r.comment}</span>}
        {r.policy_expires_on && <span className="note">Срок полиса: {String(r.policy_expires_on).slice(0, 10)}</span>}
        {r.staff_note && <span className="note">Предыдущий комментарий: {r.staff_note}</span>}
        {r.kind === 'insurance' && r.status === 'sent_to_partner' && (
          <div className="stack">
            <span className="label">Назначить страховщика</span>
            <div className="row">
              <select className="field" aria-label="Страховщик" value={currentDraft?(selectedInsurers[r.id]??''):''}
                onChange={(e) => setSelectedInsurers((prev) => ({ ...prev, [r.id]: e.target.value }))}>
                <option value="">Выберите партнёра</option>
                {eligibleInsurers.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name || p.id}</option>
                ))}
              </select>
              <button type="button" className="btn ghost small"
                disabled={busy||!currentDraft||!eligibleInsurers.some(p=>String(p.id)===selectedInsurers[r.id])}
                onClick={async()=>{
                  const startedAs=scope;
                  const insurerId=selectedInsurers[r.id];
                  if(!eligibleInsurers.some(p=>String(p.id)===insurerId))return;
                  setActionError('');
                  const result=await run(()=>post(`/api/admin/vehicle-service-requests/${r.id}/assign-insurer`,
                    {insurerId}),'Страховщик назначен');
                  if(scopeRef.current!==startedAs)return;
                  if(result){
                    setSelectedInsurers(old=>({...old,[r.id]:''}));list.reload();
                  }else setActionError('Передача страховщику не подтверждена. Сверьте заявку перед повтором.');
                }}>Передать страховщику</button>
            </div>
            {insurers.error&&<div className="banner warn" role="alert">Не удалось загрузить страховщиков: {insurers.error}
              <button type="button" className="btn ghost small" onClick={insurers.reload}>Повторить загрузку страховщиков</button>
            </div>}
            {!insurers.error&&!eligibleInsurers.length&&<span className="note">Нет подключённых страховщиков. Назначьте роль insurer через администратора.</span>}
          </div>
        )}

        {r.kind === 'inspection' && ['submitted','in_review'].includes(r.status) && (
          <div className="stack">
            <span className="label">Назначить партнёра техосмотра</span>
            <div className="row">
              <select className="field" aria-label="Партнёр техосмотра"
                value={selectedInsurers[r.id] ?? ''}
                onChange={e=>setSelectedInsurers(prev=>({...prev,[r.id]:e.target.value}))}>
                <option value="">Выберите партнёра</option>
                {eligibleInspectors.map((p:any)=><option key={p.id} value={p.id}>{p.name||p.id}</option>)}
              </select>
              <button type="button" className="btn ghost small"
                disabled={busy||!currentDraft||!eligibleInspectors.some(p=>String(p.id)===selectedInsurers[r.id])}
                onClick={async()=>{
                  const startedAs=scope;
                  const partnerId=selectedInsurers[r.id];
                  if(!eligibleInspectors.some(p=>String(p.id)===partnerId))return;
                  setActionError('');
                  const result=await run(()=>post(`/api/admin/vehicle-service-requests/${r.id}/assign-inspection`,
                    {partnerId}),'Техосмотр передан партнёру');
                  if(scopeRef.current!==startedAs)return;
                  if(result){
                    setSelectedInsurers(old=>({...old,[r.id]:''}));list.reload();
                  }else setActionError('Назначение техосмотра не подтверждено. Сверьте заявку перед повтором.');
                }}>Передать техосмотр</button>
            </div>
            {inspectionPartners.error&&<div className="banner warn" role="alert">
              Не удалось загрузить партнёров техосмотра: {inspectionPartners.error}
              <button type="button" className="btn ghost small" onClick={inspectionPartners.reload}>
                Повторить загрузку операторов
              </button>
            </div>}
            <span className="note">Доступны операторы техосмотра и партнёры с разрешённой ролью страховщика.</span>
          </div>
        )}
        {r.status==='completed'&&r.assigned_to&& (r.has_partner_accrual ?
          <p className="note">Начисление партнёру по этой заявке уже зарегистрировано.</p> : <details className="stack">
          <summary><b>Подтвердить начисление партнёру</b></summary>
          <p className="note">Только после проверки основания и суммы. Повторное начисление по заявке сервер отклонит.</p>
          <label className="stack">Сумма начисления, ₽
            <input className="field" type="text" maxLength={30} inputMode="decimal"
              value={currentDraft?(accrualAmounts[r.id]??''):''}
              onChange={e=>setAccrualAmounts(v=>({...v,[r.id]:e.target.value}))}/>
          </label>
          <label className="stack">Основание начисления
            <textarea className="field" maxLength={1000} value={currentDraft?(accrualReasons[r.id]??''):''}
              onChange={e=>setAccrualReasons(v=>({...v,[r.id]:e.target.value}))}
              placeholder="Номер акта, подтверждённый расчёт комиссии или другое основание"/>
          </label>
          <button type="button" className="btn small" disabled={busy||!currentDraft||ledgerUnconfirmed}
            onClick={()=>void saveLedger(r.id,'accrual')}>Зарегистрировать начисление</button>
        </details>)}
        {r.status==='completed'&&r.assigned_to&&r.has_partner_accrual&&<details className="stack">
          <summary><b>Зарегистрировать фактическую выплату</b></summary>
          <p className="note">Только после перечисления денег партнёру. Эта форма не отправляет платёж — она фиксирует уже подтверждённую выплату.</p>
          <label className="stack">Выплаченная сумма, ₽
            <input className="field" type="text" maxLength={30} inputMode="decimal"
              value={currentDraft?(payoutAmounts[r.id]??''):''} onChange={e=>setPayoutAmounts(v=>({...v,[r.id]:e.target.value}))}/>
          </label>
          <label className="stack">Номер платёжного поручения / подтверждение перевода
            <input className="field" maxLength={1000} value={currentDraft?(payoutReferences[r.id]??''):''}
              onChange={e=>setPayoutReferences(v=>({...v,[r.id]:e.target.value}))}/>
          </label>
          <button type="button" className="btn small" disabled={busy||!currentDraft||ledgerUnconfirmed} onClick={()=>void saveLedger(r.id,'payout')}>Зафиксировать выплаченную сумму</button>
        </details>}
        {r.status==='completed'&&r.assigned_to&&r.has_partner_accrual&&<details className="stack">
          <summary><b>Корректировка начисления</b></summary>
          <p className="note">Уменьшает только невыплаченный остаток. Уже выплаченные деньги не изменяются задним числом.</p>
          <label className="stack">Сумма корректировки, ₽
            <input className="field" type="text" maxLength={30} inputMode="decimal"
              value={currentDraft?(reversalAmounts[r.id]??''):''} onChange={e=>setReversalAmounts(v=>({...v,[r.id]:e.target.value}))}/>
          </label>
          <label className="stack">Причина корректировки
            <textarea className="field" maxLength={1000} value={currentDraft?(reversalReasons[r.id]??''):''}
              onChange={e=>setReversalReasons(v=>({...v,[r.id]:e.target.value}))}/>
          </label>
          <button type="button" className="btn ghost small" disabled={busy||!currentDraft||ledgerUnconfirmed} onClick={()=>void saveLedger(r.id,'reversal')}>Подтвердить корректировку</button>
        </details>}
        {(next[r.status]?.length ?? 0) > 0 && <>
          <textarea className="field" aria-label="Комментарий сотрудника" placeholder="Комментарий для клиента" value={currentDraft?(notes[r.id]??''):''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} maxLength={2000} />
          {r.kind === 'insurance' && r.status === 'sent_to_partner' && !r.insurance_stage && <label className="stack">Дата окончания полиса
            <input className="field" type="date" min={new Date(Date.now()+86400000).toISOString().slice(0,10)}
              value={currentDraft?(expiry[r.id]??''):''} onChange={(e) => setExpiry({ ...expiry, [r.id]: e.target.value })} />
          </label>}
          {r.kind==='insurance'&&r.insurance_stage&&r.status==='sent_to_partner'&&
            <a className="btn ghost small" href={'#/insurance/request/'+encodeURIComponent(r.id)}>
              Открыть страховое дело и оформить PDF
            </a>}
          <div className="row">{next[r.status]
            .filter(status=>!(status==='completed'&&r.kind==='insurance'&&r.insurance_stage))
            .map(status=><button key={status} type="button" className="btn ghost small"
              disabled={busy||!currentDraft}
              onClick={()=>void change(r.id,status,r.kind)}>{labels[status]}</button>)}</div>
        </>}
      </div>)}
  </div>;
}

