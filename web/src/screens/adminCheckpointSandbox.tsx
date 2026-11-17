/**
 * Read-only preflight plus explicitly acknowledged validation of historical
 * checkpoint FKs, visible only on the separate sandbox origin.
 * No deletion of evidence, no GPS display, no server setting changes.
 */
import { useEffect, useState } from 'react';
import { get, post } from '../api.ts';
import { useAction } from '../ui.tsx';
import { checkpointSandboxViewEnabled } from './checkpointSandbox.tsx';

type Check = { name: string; table: string; exists: boolean; validated: boolean; violatingRows: number };
type Audit = {
  checkedAt: string; snapshotDigest: string; readyToValidate: boolean;
  allValidated: boolean; checks: Check[]; startBilling: false;
};
type Retention = {
  dueSnapshots: number; dueSamples: number; dryRun: true;
  cutoffAt: string; sampleCutoffAt: string; startBilling: false;
};
const displayNames: Record<string,string> = {
  checkpoint_supersedes_same_order_fk: 'Версии КПП одного заказа',
  checkpoint_consent_scope_fk: 'Согласие и назначенный исполнитель',
  checkpoint_attempt_scope_fk: 'Попытка и согласованный КПП',
  checkpoint_decision_scope_fk: 'Решения по своей заявке',
  checkpoint_route_consent_scope_fk: 'GPS и период разрешения',
  checkpoint_route_consent_order_scope_fk: 'GPS и тот же заказ',
  checkpoint_consent_requires_scope: 'Записи без подтверждённого объёма разрешения',
};
export function AdminCheckpointSandbox() {
  const [report,setReport] = useState<Audit | null>(null);
  const [retention,setRetention] = useState<Retention | null>(null);
  const [error,setError] = useState('');
  const [ack,setAck] = useState(false);
  const {busy,run} = useAction();
  const enabled=checkpointSandboxViewEnabled();
  async function preview() {
    const results = await run(async () => {
      const [audit,gps] = await Promise.all([
        get<Audit>('/api/admin/checkpoint-gps/integrity'),
        get<Retention>('/api/admin/checkpoint-gps/retention'),
      ]);
      return {audit,gps};
    },null);
    if (results) {
      setReport(results.audit); setRetention(results.gps);
      setError('');setAck(false);
    } else setError('Проверка не выполнена. Проверьте доступ к API тестовой песочницы.');
  }
  useEffect(() => { if (enabled) void preview(); }, [enabled]);
  if (!enabled) return <div className="card stack">
    <b>КПП: тестовый модуль</b>
    <p className="note">Доступен только в изолированной песочнице. На боевом сервере операции недоступны.</p>
  </div>;
  return <section className="stack" aria-label="Аудит доказательств КПП">
    <div className="card stack">
      <b>КПП · контроль исторических данных</b>
      <p className="note">Тестовая процедура без доступа к чужим GPS-маршрутам, без исправления истории, оплаты или изменения статусов заявок. В боевом режиме модуль отключён.</p>
      <div className="row">
        <button type="button" className="btn ghost" disabled={busy} onClick={() => void preview()}>Проверить ещё раз</button>
        <a className="btn ghost" href="#/admin/section/orders">К заявкам</a>
      </div>
      {error && <p className="err" role="alert">{error}</p>}
      {report && <>
        <div className="between"><b>Итог: {report.readyToValidate ? 'нарушений нет' : 'нужна ручная сверка'}</b>
          <span className="pill">{report.allValidated ? 'Ограничения подтверждены' : 'Не все ограничения подтверждены'}</span>
        </div>
        <p className="note">Отчёт от {new Date(report.checkedAt).toLocaleString('ru-RU')}. Хэш состояния: <code>{report.snapshotDigest}</code></p>
        {report.checks.map(c => <div className="between" key={c.name}>
          <span>{displayNames[c.name] ?? c.name}</span>
          <b>{!c.exists ? 'Нет ограничения' : c.violatingRows > 0 ? 'Ошибок: ' + c.violatingRows : c.validated ? 'Проверено' : 'Ожидает подтверждения'}</b>
        </div>)}
        {report.readyToValidate && !report.allValidated && <div className="stack">
          <label><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
            Подтверждаю проверку только в тестовой базе, без исправления записей</label>
          <button type="button" className="btn" disabled={busy || !ack} onClick={() => void run(
            () => post('/api/admin/checkpoint-gps/integrity/validate', {
              snapshotDigest:report.snapshotDigest, acknowledge:true,
            }), 'Ограничения подтверждены в тестовой базе').then(result => {
              if (result) void preview();
            })}>Подтвердить ограничения PostgreSQL</button>
        </div>}
        {!report.readyToValidate && <p className="note">
          Подтверждение заблокировано. Сначала проверьте и устраните исторические расхождения вне этой панели в рамках согласованной процедуры.
        </p>}
      </>}
    </div>
    <div className="card stack">
      <b>Истёкшие точные GPS-данные</b>
      <p className="note">Только предварительный просмотр. Не запускает удаление: юридические основания, спорные заявки и резервные копии требуют отдельного регламента.</p>
      {retention ? <>
        <div className="between"><span>Просроченные GPS-снимки</span><b>{retention.dueSnapshots}</b></div>
        <div className="between"><span>Просроченные GPS-точки с согласием КПП</span><b>{retention.dueSamples}</b></div>
      </> : <span className="note">Данные ещё не получены.</span>}
    </div>
  </section>;
}
