// Кабинет партнёра-страховщика: только назначенные администратором страховые заявки.
import { useState } from 'react';
import { get, patch, fmtTime } from '../api.ts';
import { useLoad, useAction } from '../ui.tsx';

const labels: Record<string, string> = {
  sent_to_partner: 'Ждёт оформления', completed: 'Полис оформлен', rejected: 'Отказ',
};
export function InsurerCabinet() {
  const requests = useLoad(() => get('/api/insurer/requests'), [],
    (event) => event.type === 'vehicle_service');
  const { busy, run } = useAction();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [expires, setExpires] = useState<Record<string, string>>({});
  async function update(id: string, status: 'completed' | 'rejected') {
    const note = (notes[id] ?? '').trim();
    const policyExpiresOn = expires[id];
    if (status === 'rejected' && !note) {
      alert('Укажите причину отказа — клиент должен её видеть.');
      return;
    }
    if (status === 'completed' && !policyExpiresOn) {
      alert('Укажите дату окончания полиса.');
      return;
    }
    const result = await run(() => patch(`/api/insurer/requests/${id}`, {
      status, note: note || undefined,
      policyExpiresOn: status === 'completed' ? policyExpiresOn : undefined,
    }), 'Заявка обновлена');
    if (result) {
      setNotes((old) => { const value = { ...old }; delete value[id]; return value; });
      requests.reload();
    }
  }
  const rows: any[] | undefined = requests.data;
  return (
    <main>
      <h1>Кабинет страховщика</h1>
      <div className="sub">Только заявки, переданные вам ТракSOS. Остальные автомобили и сведения о клиентах недоступны.</div>
      {!rows ? <div className="empty">{requests.error ? `Не удалось загрузить: ${requests.error}` : 'Загружаем заявки…'}</div>
        : !rows.length ? <div className="empty">Назначенных заявок пока нет. Администратор передаст их сюда после проверки.</div>
        : <div className="stack">
          <div className="grid2">
            <div className="card tile"><span className="label">Всего назначено</span><b className="tile-value">{rows.length}</b></div>
            <div className="card tile"><span className="label">Ожидают решения</span><b className="tile-value">{rows.filter((r) => r.status === 'sent_to_partner').length}</b></div>
          </div>
          <span className="label">Мои заявки</span>
          <div className="web-insurance-grid">
          {rows.map((r) => (
            <details key={r.id} className="card">
              <summary className="between">
                <b>{r.brand} {r.model ?? ''}</b>
                <span className="pill">{labels[r.status] ?? r.status}</span>
              </summary>
              <div className="stack">
                <span className="note">{r.plate || 'Без номера'} · Подана {fmtTime(r.created_at)}</span>
                {r.comment && <span className="note">Комментарий клиента: {r.comment}</span>}
                {r.staff_note && <span className="note">Последний ответ: {r.staff_note}</span>}
                {r.policy_expires_on && <span className="note">Срок полиса: {String(r.policy_expires_on).slice(0, 10)}</span>}
                {r.status === 'sent_to_partner' && <>
                  <label className="stack">
                    <span className="label">Действует до</span>
                    <input className="field" type="date" value={expires[r.id] ?? ''}
                      onChange={(e) => setExpires((old) => ({ ...old, [r.id]: e.target.value }))} />
                  </label>
                  <textarea className="field" aria-label="Комментарий страховщика" maxLength={2000}
                    placeholder="Комментарий или причина отказа"
                    value={notes[r.id] ?? ''} onChange={(e) => setNotes((old) => ({ ...old, [r.id]: e.target.value }))} />
                  <div className="grid2">
                    <button type="button" className="btn small" disabled={busy} onClick={() => update(r.id, 'completed')}>Полис оформлен</button>
                    <button type="button" className="btn ghost small" disabled={busy} onClick={() => update(r.id, 'rejected')}>Отказать</button>
                  </div>
                </>}
              </div>
            </details>
          ))}
          </div>
        </div>}
      <a className="linkrow" href="#/menu"><span><b>Помощь, условия и настройки</b><small>Единое меню ТракSOS</small></span><span aria-hidden="true">›</span></a>
    </main>
  );
}
