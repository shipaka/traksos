import { useState } from 'react';
import { get, post, patch, fmtTime } from '../api.ts';
import { useLoad, useAction, Loading } from '../ui.tsx';

export function VehicleServicesQueue() {
  const list = useLoad(() => get('/api/admin/vehicle-service-requests'), []);
  const insurers = useLoad(() => get('/api/admin/insurers'), []);
  const [selectedInsurers, setSelectedInsurers] = useState<Record<string, string>>({});
  const [direction,setDirection]=useState<'insurance'|'inspection'>('insurance');
  const { busy, run } = useAction();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [expiry, setExpiry] = useState<Record<string, string>>({});
  const [accrualAmounts,setAccrualAmounts]=useState<Record<string,string>>({});
  const [accrualReasons,setAccrualReasons]=useState<Record<string,string>>({});
  const [payoutAmounts,setPayoutAmounts]=useState<Record<string,string>>({});
  const [payoutReferences,setPayoutReferences]=useState<Record<string,string>>({});
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
  async function change(id: string, status: string) {
    const note = (notes[id] ?? '').trim();
    // Explain refusals and document requests before updating the client-visible status.
    if (['rejected', 'need_documents'].includes(status) && !note) {
      window.alert('Укажите причину отказа или какие документы нужны клиенту.');
      return;
    }
    const r = await run(() => patch(`/api/admin/vehicle-service-requests/${id}`, {
      status, note: note || undefined,
      policyExpiresOn: status === 'completed' && expiry[id] ? expiry[id] : undefined,
    }), 'Статус обновлён');
    if (r) { setNotes(previous => { const nextNotes = { ...previous }; delete nextNotes[id]; return nextNotes; }); list.reload(); }
  }
  return <div className="stack">
    <h2>{direction==='insurance'?'Страховые заявки':'Заявки на техосмотр'}</h2>
    <nav className="partner-workspaces" aria-label="Направление заявок">
      <button type="button" className={'btn ghost'+(direction==='insurance'?' active':'')} aria-pressed={direction==='insurance'} onClick={()=>setDirection('insurance')}>Страхование</button>
      <button type="button" className={'btn ghost'+(direction==='inspection'?' active':'')} aria-pressed={direction==='inspection'} onClick={()=>setDirection('inspection')}>Техосмотры</button>
    </nav>
    {!list.data ? <Loading error={list.error} /> : list.data.filter((r:any)=>r.kind===direction).length === 0 ? <div className="empty">Заявок в этом направлении пока нет</div> : list.data.filter((r:any)=>r.kind===direction).map((r: any) =>
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
              <select className="field" aria-label="Страховщик" value={selectedInsurers[r.id] ?? ''}
                onChange={(e) => setSelectedInsurers((prev) => ({ ...prev, [r.id]: e.target.value }))}>
                <option value="">Выберите партнёра</option>
                {(insurers.data ?? []).map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name || p.id}</option>
                ))}
              </select>
              <button type="button" className="btn ghost small"
                disabled={busy || !selectedInsurers[r.id]}
                onClick={async () => {
                  const result = await run(() => post(`/api/admin/vehicle-service-requests/${r.id}/assign-insurer`, {
                    insurerId: selectedInsurers[r.id],
                  }), 'Страховщик назначен');
                  if (result) list.reload();
                }}>Передать страховщику</button>
            </div>
            {!(insurers.data ?? []).length && <span className="note">Нет подключённых страховщиков. Назначьте роль insurer через администратора.</span>}
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
                {(insurers.data??[]).map((p:any)=><option key={p.id} value={p.id}>{p.name||p.id}</option>)}
              </select>
              <button type="button" className="btn ghost small"
                disabled={busy||!selectedInsurers[r.id]}
                onClick={async()=>{
                  const result=await run(()=>post(`/api/admin/vehicle-service-requests/${r.id}/assign-inspection`,
                    {partnerId:selectedInsurers[r.id]}),'Техосмотр передан партнёру');
                  if(result)list.reload();
                }}>Передать техосмотр</button>
            </div>
            <span className="note">Пока доступны партнёры с ролью insurer. Отдельные права оператора техосмотра будут добавлены позднее.</span>
          </div>
        )}
        {r.status==='completed'&&r.assigned_to&& (r.has_partner_accrual ?
          <p className="note">Начисление партнёру по этой заявке уже зарегистрировано.</p> : <details className="stack">
          <summary><b>Подтвердить начисление партнёру</b></summary>
          <p className="note">Только после проверки основания и суммы. Повторное начисление по заявке сервер отклонит.</p>
          <label className="stack">Сумма начисления, ₽
            <input className="field" type="number" min="0.01" step="0.01" inputMode="decimal"
              value={accrualAmounts[r.id]??''}
              onChange={e=>setAccrualAmounts(v=>({...v,[r.id]:e.target.value}))}/>
          </label>
          <label className="stack">Основание начисления
            <textarea className="field" maxLength={1000} value={accrualReasons[r.id]??''}
              onChange={e=>setAccrualReasons(v=>({...v,[r.id]:e.target.value}))}
              placeholder="Номер акта, подтверждённый расчёт комиссии или другое основание"/>
          </label>
          <button type="button" className="btn small" disabled={busy}
            onClick={async()=>{
              const raw=(accrualAmounts[r.id]??'').trim().replace(',','.');
              const amount=Number(raw);
              const amountKopecks=Math.round(amount*100);
              const reason=(accrualReasons[r.id]??'').trim();
              if(!raw||!Number.isFinite(amount)||amount<=0||Math.abs(amount*100-amountKopecks)>0.000001||!Number.isSafeInteger(amountKopecks)||reason.length<3){
                window.alert('Укажите корректную сумму с точностью до копейки и основание начисления.');return;
              }
              if(!window.confirm('Подтвердить начисление '+amount.toFixed(2)+' ₽ партнёру?'))return;
              const result=await run(()=>post('/api/admin/partner-finance/accruals',
                {requestId:r.id,amountKopecks,note:reason}),'Начисление зарегистрировано');
              if(result){setAccrualAmounts(v=>({...v,[r.id]:''}));setAccrualReasons(v=>({...v,[r.id]:''}));list.reload();}
            }}>Зарегистрировать начисление</button>
        </details>)}
        {r.status==='completed'&&r.assigned_to&&r.has_partner_accrual&&<details className="stack">
          <summary><b>Зарегистрировать фактическую выплату</b></summary>
          <p className="note">Только после перечисления денег партнёру. Эта форма не отправляет платёж — она фиксирует уже подтверждённую выплату.</p>
          <label className="stack">Выплаченная сумма, ₽
            <input className="field" type="number" min="0.01" step="0.01" inputMode="decimal"
              value={payoutAmounts[r.id]??''} onChange={e=>setPayoutAmounts(v=>({...v,[r.id]:e.target.value}))}/>
          </label>
          <label className="stack">Номер платёжного поручения / подтверждение перевода
            <input className="field" maxLength={1000} value={payoutReferences[r.id]??''}
              onChange={e=>setPayoutReferences(v=>({...v,[r.id]:e.target.value}))}/>
          </label>
          <button type="button" className="btn small" disabled={busy} onClick={async()=>{
            const raw=(payoutAmounts[r.id]??'').trim().replace(',','.');
            const amount=Number(raw),amountKopecks=Math.round(amount*100);
            const reference=(payoutReferences[r.id]??'').trim();
            if(!raw||!Number.isFinite(amount)||amount<=0||Math.abs(amount*100-amountKopecks)>0.000001||!Number.isSafeInteger(amountKopecks)||reference.length<3){
              window.alert('Укажите корректную сумму и подтверждение фактического перевода.');return;
            }
            if(!window.confirm('Деньги уже переведены? Зарегистрировать выплату '+amount.toFixed(2)+' ₽?'))return;
            const result=await run(()=>post('/api/admin/partner-finance/payouts',
              {requestId:r.id,amountKopecks,reference}),'Выплата учтена');
            if(result){setPayoutAmounts(v=>({...v,[r.id]:''}));setPayoutReferences(v=>({...v,[r.id]:''}));list.reload();}
          }}>Зафиксировать выплаченную сумму</button>
        </details>}
        {(next[r.status]?.length ?? 0) > 0 && <>
          <textarea className="field" aria-label="Комментарий сотрудника" placeholder="Комментарий для клиента" value={notes[r.id] ?? ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} maxLength={2000} />
          {r.kind === 'insurance' && r.status === 'sent_to_partner' && <label className="stack">Дата окончания полиса
            <input className="field" type="date" value={expiry[r.id] ?? ''} onChange={(e) => setExpiry({ ...expiry, [r.id]: e.target.value })} />
          </label>}
          <div className="row">{next[r.status].map((status) => <button key={status} type="button" className="btn ghost small" disabled={busy} onClick={() => change(r.id, status)}>{labels[status]}</button>)}</div>
        </>}
      </div>)}
  </div>;
}

