/**
 * Operational checkpoint evidence panel for the isolated TrakSOS sandbox.
 * Do not enable in public production or ask for device geolocation here.
 * A GPS location fix must have its own audited mobile permission integration.
 */
import { useEffect, useState } from 'react';
import { get, post, put, API_URL } from '../api.ts';
import { useAction } from '../ui.tsx';

type Plan = {
  id: string; version: number; checkpoint_lat: number; checkpoint_lng: number;
  radius_m: number; requires_pass: boolean; client_approved_at: string;
};
type Attempt = {
  id: string; planId: string; outcome: string; createdAt: string;
  evaluation: { reasons?: string[]; outcome?: string; startBilling?: boolean };
};
type Evidence = {
  plans: Plan[]; attempts: Attempt[];
  decisions: { attempt_id: string; decision: string; decided_at: string }[];
  gpsConsent: { planId: string | null; active: boolean; expiresAt: string | null };
  startBilling: false;
};
type Privacy = {
  samples: { receivedAt: string; orderId: string }[];
  consentEvents: { action: string; recordedAt: string; orderId: string }[];
  hasMore: { samples: boolean; consents: boolean };
};

export function checkpointSandboxViewEnabled(): boolean {
  try {
    return sessionStorage.getItem('traksos.sandboxMode') === '1' &&
      new URL(API_URL || location.origin, location.origin).origin === location.origin;
  } catch { return false; }
}
const time = (date?: string | null) => date ? new Date(date).toLocaleString('ru-RU') : '—';
const outcome = (x: string) => x === 'candidate' ? 'Кандидат для ручной проверки'
  : x === 'needs_review' ? 'Требуется проверка' : x;

export function CheckpointSandboxOrder({ orderId, you, status, hasPerformer, lat, lng }: {
  orderId: string; you: string; status: string;
  hasPerformer: boolean; lat?: number | null; lng?: number | null;
}) {
  const [view, setView] = useState<Evidence | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [coords, setCoords] = useState(() => ({
    lat: lat == null ? '' : String(lat),
    lng: lng == null ? '' : String(lng),
  }));
  const [radius, setRadius] = useState(200);
  const [requiresPass, setRequiresPass] = useState(false);
  const [description, setDescription] = useState('');
  const [why, setWhy] = useState('');
  const [decision, setDecision] = useState<'corroborated' | 'insufficient'>('insufficient');
  const [privacy, setPrivacy] = useState<Privacy | null>(null);
  const { busy, run } = useAction();
  const refresh = async () => {
    try {
      const data = await get<Evidence>('/api/orders/' + orderId + '/checkpoint');
      setView(data); setError('');
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    setView(null); setError(''); setLoading(true); setPrivacy(null);
    setCoords({ lat: lat == null ? '' : String(lat), lng: lng == null ? '' : String(lng) });
    void refresh();
  }, [orderId]);
  const latest = view?.plans[0];
  const active = ['accepted', 'en_route'].includes(status);
  const canPlan = you === 'client' && hasPerformer && active;
  const canAttempt = you === 'performer' && active && !!latest && !!view?.gpsConsent.active;
  const action = async (fn: () => Promise<unknown>, message: string) => {
    const result = await run(fn, message);
    if (result) await refresh();
  };
  const grant = (kind: 'granted' | 'revoked') => action(() => post(
    '/api/orders/' + orderId + '/checkpoint/gps-consent', {
      planId: latest!.id, action: kind,
      eventKey: crypto.randomUUID(),
      ...(kind === 'granted' ? { durationMinutes: 30 } : {}),
    }), kind === 'granted' ? 'Согласие записано на 30 минут' : 'Согласие отозвано');
  const latestAttempt = view?.attempts[0];
  const alreadyDecided = view?.decisions.some(x => x.attempt_id === latestAttempt?.id);
  return <section className="card stack" aria-label="КПП: тестовое подтверждение прибытия">
    <div className="between">
      <b>КПП · проверка прибытия</b>
      <span className="pill">Только песочница</span>
    </div>
    <p className="note">Доказательная процедура без начала ожидания, изменения статуса, оплаты и санкций. Точные координаты GPS не передаются через этот экран.</p>
    {loading && <span className="note">Загружаю данные КПП…</span>}
    {error && <p className="err" role="alert">{error}</p>}
    {!loading && view && <>
      {!latest && <p className="note">Согласованной точки КПП пока нет.</p>}
      {latest && <div className="stack">
        <b>Согласованная точка · версия {latest.version}</b>
        <span className="note">{Number(latest.checkpoint_lat).toFixed(5)}, {Number(latest.checkpoint_lng).toFixed(5)} · радиус {latest.radius_m} м · {latest.requires_pass ? 'Требуется пропуск' : 'Пропуск не требуется'} · {time(latest.client_approved_at)}</span>
        <span className="note">Согласие на GPS: {view.gpsConsent.active ? 'действует до ' + time(view.gpsConsent.expiresAt) : 'не действует или отозвано'}</span>
      </div>}
      {canPlan && <form className="stack" onSubmit={e => {
        e.preventDefault();
        if (!Number.isFinite(Number(coords.lat)) || !Number.isFinite(Number(coords.lng)) ||
          !coords.lat.trim() || !coords.lng.trim() || Math.abs(Number(coords.lat)) > 90 ||
          Math.abs(Number(coords.lng)) > 180) { setError('Проверьте координаты КПП'); return; }
        void action(() => put('/api/orders/' + orderId + '/checkpoint-plan', {
          requestKey: crypto.randomUUID(), lat: Number(coords.lat), lng: Number(coords.lng),
          radiusM: radius, requiresPass, locationDescription: description,
        }), 'Новая версия КПП согласована');
      }}>
        <b>{latest ? 'Изменить точку (новая версия)' : 'Указать и согласовать КПП'}</b>
        <div className="grid2">
          <label>Широта<input className="field" type="number" step="any" min="-90" max="90" required value={coords.lat} onChange={e => setCoords({ ...coords,lat:e.target.value })} /></label>
          <label>Долгота<input className="field" type="number" step="any" min="-180" max="180" required value={coords.lng} onChange={e => setCoords({ ...coords,lng:e.target.value })} /></label>
          <label>Радиус КПП, м<input className="field" type="number" min="50" max="500" required value={radius} onChange={e => setRadius(Number(e.target.value))} /></label>
          <label>Описание КПП<input className="field" maxLength={500} value={description} onChange={e => setDescription(e.target.value)} /></label>
        </div>
        <label><input type="checkbox" checked={requiresPass} onChange={e => setRequiresPass(e.target.checked)} /> Требуется пропуск</label>
        <button className="btn" type="submit" disabled={busy}>Согласовать тестовый КПП</button>
      </form>}
      {you === 'performer' && latest && <div className="stack">
        <b>Моё разрешение на GPS для этой точки</b>
        <p className="note">Разрешение действует только для версии КПП. Этот экран сам не определяет координаты и не включает отслеживание устройства.</p>
        <div className="row">
          {!view.gpsConsent.active && active &&
            <button className="btn" type="button" disabled={busy} onClick={() => void grant('granted')}>Разрешить фиксацию на 30 минут</button>}
          <button className="btn ghost" type="button" disabled={busy}
            onClick={() => void grant('revoked')}>Отозвать разрешение</button>
        </div>
      </div>}
      {you === 'performer' && <div className="row">
        {canAttempt && <button type="button" className="btn" disabled={busy}
          onClick={() => void action(() => post('/api/orders/' + orderId + '/checkpoint/arrival', {
            requestKey: crypto.randomUUID(), planId: latest!.id, gpsConsent: true,
          }), 'Попытка сохранена, решение — отдельно')}>Записать попытку прибытия</button>}
        <button className="btn ghost" type="button" disabled={busy}
          onClick={() => void run(async () => {
            const p = await get<Privacy>('/api/me/checkpoint-privacy?limit=25');
            setPrivacy(p); return p;
          }, null)}>Мои GPS-согласия</button>
      </div>}
      {privacy && <div className="stack">
        <b>Моя история согласий</b>
        <span className="note">Последние 25 событий. Для полного доступа используйте персональную выгрузку. Чужие маршруты здесь не видны.</span>
        {privacy.consentEvents.map((e,i) => <span className="note" key={i}>
          {time(e.recordedAt)} · {e.action === 'granted' ? 'Разрешено' : 'Отозвано'} · заявка {e.orderId.slice(0,8)}
        </span>)}
        {privacy.hasMore.consents && <span className="note">Есть более ранние события.</span>}
      </div>}
      {!!view.attempts.length && <div className="stack">
        <b>Попытки и независимые решения</b>
        {view.attempts.slice(0,10).map(a => {
          const review = view.decisions.find(d => d.attempt_id === a.id);
          return <div className="between" key={a.id}>
            <span>{time(a.createdAt)} · {outcome(a.outcome)}{review ? ' · ' + (review.decision === 'corroborated' ? 'Подтверждено вручную' : 'Недостаточно доказательств') : ''}</span>
            <span className="note">{a.evaluation?.reasons?.join(', ') || 'Ожидает рассмотрения'}</span>
          </div>;
        })}
      </div>}
      {(you === 'client' || you === 'admin') && latestAttempt && !alreadyDecided && <form className="stack" onSubmit={e => {
        e.preventDefault();
        void action(() => post('/api/checkpoint-attempts/' + latestAttempt.id + '/decision', {
          decision, explanation: why.trim(),
        }), 'Решение записано без запуска оплаты');
      }}>
        <b>Ручная оценка последней попытки</b>
        <label>Решение<select className="field" value={decision} onChange={e => setDecision(e.target.value as typeof decision)}>
          <option value="insufficient">Недостаточно доказательств</option>
          <option value="corroborated">Подтвердить как доказательство</option>
        </select></label>
        <label>Основания решения<textarea className="field" required minLength={20} maxLength={2000}
          value={why} onChange={e => setWhy(e.target.value)} /></label>
        <button type="submit" className="btn" disabled={busy || why.trim().length < 20}>Записать решение</button>
      </form>}
    </>}
  </section>;
}
