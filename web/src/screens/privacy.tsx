// Персональные данные: что собираем и зачем, скачать, исправить, удалить аккаунт.
import { Fragment } from 'react';
import { get, post, del, fmtTime } from '../api.ts';
import { useLoad, useAction, useMe, Back } from '../ui.tsx';

const WHAT: [string, string][] = [
  ['Телефон', 'вход по коду из SMS и связь по заявке; исполнителям номер не показываем'],
  ['Имя, компания, ИНН, ЭДО', 'чтобы оформлять документы на компанию — если вы их указали'],
  ['Машины', 'марка, модель, год и госномер — чтобы подобрать мастера и узнать машину на месте'],
  ['Место', 'адрес или GPS только в заявке — чтобы мастер приехал; постоянно не отслеживаем'],
  ['Заявки, чат, отзывы', 'история работ, споры и оплаты — для расчётов и разбора споров'],
  ['Исполнителям: паспорт, ИНН, фото', 'проверка перед выходом на линию и налоговые документы'],
];

export function Privacy() {
  const { me } = useMe();
  const st = useLoad(() => get('/api/me/privacy'), []);
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
  const s = st.data;
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
        {s?.deleteRequestedAt ? (
          <>
            <span className="note" style={{ color: 'var(--warn)' }}>Запрос принят {fmtTime(s.deleteRequestedAt)}. Удалим {fmtTime(s.deleteAt)} — до этого можно передумать.</span>
            <button className="btn ghost" disabled={busy} onClick={async () => { const r = await run(() => del('/api/me/delete'), 'Запрос на удаление отменён'); if (r) st.setData(r); }}>Не удалять</button>
          </>
        ) : (
          <>
            <span className="note">Через {s?.graceDays ?? 30} дней удалим номер, имя, компанию, машины и вход. Заявки и платежи останутся обезличенными — их требует бухгалтерия по закону. Согласие на обработку отзывается вместе с аккаунтом.</span>
            {me?.owner_id && <span className="note">Вы водитель: машины и заказы принадлежат владельцу и останутся у него.</span>}
            <button className="btn bad" disabled={busy} onClick={async () => {
              if (!confirm('Удалить аккаунт? Через 30 дней данные будут удалены.')) return;
              const r = await run(() => post('/api/me/delete'), 'Запрос на удаление принят — данные удалим в течение 30 дней'); if (r) st.setData(r);
            }}>Удалить аккаунт</button>
          </>
        )}
      </div>
    </main>
  );
}
