import { useState } from 'react';
import { get, post, patch, fmtTime } from '../api.ts';
import { useLoad, useAction, useMe } from '../ui.tsx';

/** Оформление заявки для владельца или водителя с разрешением владельца. */
export function VehicleServiceApplication({ vehicleId, onCreated }: { vehicleId: string; onCreated: () => void }) {
  const { busy, run } = useAction();
  const [kind, setKind] = useState<'insurance' | 'inspection'>('insurance');
  const [comment, setComment] = useState('');
  const [open, setOpen] = useState(false);
  return (
    <div className="stack">
      <button type="button" className="btn ghost small" onClick={() => setOpen(!open)}>
        {open ? 'Скрыть оформление' : 'Страхование / техосмотр'}
      </button>
      {open && <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        if (kind === 'insurance') return;
        const created = await run(() => post('/api/vehicle-service-requests', { vehicleId, kind, comment: comment || undefined }), 'Заявка отправлена');
        if (created) { setOpen(false); setComment(''); onCreated(); }
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
        </>
      </form>}
    </div>
  );
}

/** История страхования и техосмотра доступна прямо в карточке машины. */
export function VehicleServiceHistory({ id, isDriver, refreshVersion }: { id: string; isDriver: boolean; refreshVersion: number }) {
  const { me } = useMe();
  const [open, setOpen] = useState(false);
  const history = useLoad(() => get(`/api/vehicles/${id}/service-history`), [id, refreshVersion],
    (event) => event.type === 'connection_restored' || (event.type === 'vehicle_service' && event.vehicleId === id));
  const items = history.data as any[] | undefined;
  const { busy, run } = useAction();
  const [renewing, setRenewing] = useState<string | null>(null);
  const [expiry, setExpiry] = useState('');
  if (!items) return history.error ? <div className="note">Не удалось загрузить историю услуг: {history.error}</div> : null;
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
        <span><b>Страхование и техосмотр · {items.length}</b><small>Заявки, статусы и сроки полисов</small></span>
        <span aria-hidden="true">{open ? '˄' : '˅'}</span>
      </button>
      {open && <div className="stack">
        {items.length === 0 && <span className="note">Пока нет заявок на страхование и техосмотр. После подачи они появятся здесь вместе с историей изменений.</span>}
        {items.map((r: any) => (
          <div key={r.id} className="note">
            <b>{r.kind === 'insurance' ? 'Страхование' : 'Техосмотр'}</b>
            {' · '}{labels[r.status] ?? r.status}
            {' · Подана '}{fmtTime(r.created_at)}
            {r.updated_at && <span> · Обновлена {fmtTime(r.updated_at)}</span>}
            {r.policy_expires_on && <span> · Действует до {String(r.policy_expires_on).slice(0, 10)}</span>}
            <div>{statusHelp[r.status] ?? 'Статус уточняется.'}</div>
            {r.staff_note && <div><b>Комментарий специалиста:</b> {r.staff_note}</div>}
            {r.kind === 'insurance' && r.insurance_stage && <a className="btn ghost small"
              href={`#/insurance/request/${r.id}`}>Открыть страховую переписку и предложения →</a>}
            {['submitted', 'in_review', 'need_documents'].includes(r.status) && (!isDriver || r.requested_by === me?.id) && (
              <button type="button" className="btn ghost small" disabled={busy}
                onClick={async () => {
                  if (!window.confirm('Отменить заявку? После отмены её нельзя будет возобновить.')) return;
                  const result = await run(() => post(`/api/vehicle-service-requests/${r.id}/cancel`), 'Заявка отменена');
                  if (result) history.reload();
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
                      <input type="date" value={expiry} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setExpiry(e.target.value)} />
                    </label>
                    <div className="row">
                      <button className="btn small" disabled={busy || !expiry} onClick={async () => {
                        const result = await run(() => patch(`/api/vehicle-service-requests/${r.id}/renewal`, { expiresOn: expiry }), 'Срок полиса обновлён');
                        if (result) { setRenewing(null); history.reload(); }
                      }}>Сохранить срок</button>
                      <button className="btn ghost small" disabled={busy} onClick={() => setRenewing(null)}>Отмена</button>
                    </div>
                  </div>
                ) : <button className="btn ghost small" onClick={() => { setExpiry(r.policy_expires_on?.slice(0, 10) ?? ''); setRenewing(r.id); }}>Указать новый срок полиса</button>}
              </div>
            )}
          </div>
        ))}
      </div>}
    </div>
  );
}

