// Персональные данные: что собираем и зачем, скачать, исправить, удалить аккаунт.
import { Fragment, useEffect, useState } from 'react';
import { get, post, del, fmtTime } from '../api.ts';
import { useAction, useMe, Back } from '../ui.tsx';

const WHAT: [string, string][] = [
  ['Телефон', 'SMS только при регистрации и восстановлении доступа; обычный вход по паролю и связь по заявке; исполнителям номер не показываем'],
  ['Имя, компания, ИНН, ЭДО', 'чтобы оформлять документы на компанию — если вы их указали'],
  ['Машины', 'марка, модель, год и госномер — чтобы подобрать мастера и узнать машину на месте'],
  ['Место', 'адрес или GPS только в заявке — чтобы мастер приехал; постоянно не отслеживаем'],
  ['Заявки, чат, отзывы', 'история работ, споры и оплаты — для расчётов и разбора споров'],
  ['Исполнителям: паспорт, ИНН, фото', 'добровольная проверка личности для отметки подтверждённого профиля; налоговые сведения — по отдельным основаниям'],
];

export function Privacy() {
  const { me } = useMe();
  // Deletion status is sensitive account-specific data; never show a previous
  // account's result while the next session is loading.
  const [status, setStatus] = useState<{owner:string; value:any}|null>(null);
  const [loadError, setLoadError] = useState<{owner:string; message:string}|null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const owner = me?.id;
    let active = true;
    setStatus(null);
    setLoadError(null);
    if (owner) {
      get('/api/me/privacy').then((value:any) => {
        if (!active) return;
        if (!value || !Number.isInteger(value.graceDays) || value.graceDays <= 0)
          throw Error('Invalid privacy status');
        setStatus({owner, value});
      }).catch(() => {
        if (active) setLoadError({owner, message:'Не удалось получить статус удаления аккаунта'});
      });
    }
    return () => { active = false; };
  }, [me?.id, retry]);
  const { busy, run } = useAction();
  async function download() {
    const data = await run(() => get('/api/me/export'), 'Файл готов');
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `traksos-moi-dannye-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  const s = status?.owner === me?.id ? status.value : null;
  const statusError = loadError?.owner === me?.id ? loadError.message : null;
  const applyStatus = (value:any) => {
    if (me?.id) {
      setStatus({owner:me.id, value});
      setLoadError(null);
    }
  };
  return (
    <main>
      <Back to="profile" label="Профиль" />
      <div><h1>Персональные данные</h1><div className="sub">Что мы храним, зачем, и как это скачать, исправить или удалить.</div></div>
      <div className="card">
        <b>Что собираем и зачем</b>
        <dl className="kv">{WHAT.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
        <span className="note">Рекламных рассылок не делаем. Данные не продаём и не передаём третьим лицам, кроме случаев, нужных для заявки (исполнитель видит машину и место) и по закону.</span>
        <a className="note" href="#/offer/privacy">Политика обработки персональных данных →</a>
      </div>
      <button className="btn ghost" disabled={busy} onClick={download}>Скачать мои данные</button>
      <button className="btn ghost" onClick={() => { location.hash = '#/profile'; }}>Исправить данные — в профиле</button>
      <div className="card">
        <b>Удалить аккаунт и данные</b>
        {!s ? (
          <div className="empty" role={statusError ? 'alert' : 'status'}>
            {statusError ?? 'Загружаем статус удаления аккаунта…'}
            {statusError && <button type="button" className="btn ghost" onClick={() => setRetry(value => value + 1)}>Попробовать снова</button>}
          </div>
        ) : s.deleteRequestedAt ? (
          <>
            <span className="note" style={{ color: 'var(--warn)' }}>Запрос принят {fmtTime(s.deleteRequestedAt)}. Удалим {fmtTime(s.deleteAt)} — до этого можно передумать.</span>
            <button className="btn ghost" disabled={busy} onClick={async () => { const r = await run(() => del('/api/me/delete'), 'Запрос на удаление отменён'); if (r) applyStatus(r); }}>Не удалять</button>
          </>
        ) : (
          <>
            <span className="note">Через {s.graceDays} дней аккаунт будет закрыт, а персональные поля профиля обезличены. Часть данных о выполненных заявках и расчётах может сохраняться в установленных законом пределах; сведения о технике и истории заказов могут быть связаны с другими участниками.</span>
            {me?.owner_id && <span className="note">Вы водитель: машины и заказы принадлежат владельцу и останутся у него.</span>}
            <button className="btn bad" disabled={busy} onClick={async () => {
              if (!confirm('Первое подтверждение: вы хотите закрыть аккаунт TrakSOS и отправить запрос на удаление данных?')) return;
              if (!confirm('Второе подтверждение: вы действительно уверены? Действующие заявки необходимо завершить; после подтверждения начнётся установленная законом процедура удаления.')) return;
              const r = await run(() => post('/api/me/delete'), 'Запрос на удаление принят — срок указан в разделе'); if (r) applyStatus(r);
            }}>Удалить аккаунт</button>
          </>
        )}
      </div>
    </main>
  );
}
