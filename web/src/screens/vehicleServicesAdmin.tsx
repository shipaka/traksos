import { useState } from 'react';
import { get, post, patch, fmtTime } from '../api.ts';
import { useLoad, useAction, Loading } from '../ui.tsx';

export function VehicleServicesQueue() {
  const list = useLoad(() => get('/api/admin/vehicle-service-requests'), []);
  const insurers = useLoad(() => get('/api/admin/insurers'), []);
  const [selectedInsurers, setSelectedInsurers] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [expiry, setExpiry] = useState<Record<string, string>>({});
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
    <h2>Заявки на страхование и техосмотр</h2>
    {!list.data ? <Loading error={list.error} /> : list.data.length === 0 ? <div className="empty">Заявок пока нет</div> : list.data.map((r: any) =>
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

