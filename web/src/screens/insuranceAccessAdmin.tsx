import { get, put } from '../api.ts';
import { useAction, useLoad, Loading } from '../ui.tsx';

/** Admin-only switch; private partner phone is never sent to the web UI. */
export function InsuranceAccessAdmin() {
  const state = useLoad(() => get('/api/admin/insurance-access'), []);
  const { busy, run } = useAction();
  if (!state.data) return <Loading error={state.error} />;
  const value = state.data;
  const next = !value.registrationOpen;
  return <section className="card stack" aria-label="Допуск страховых агентов">
    <b>Страховые партнёры</b>
    <span className="note">Первый агент закрепляется за одним номером в закрытых настройках сервера.
      Этот номер не может использоваться для регистрации клиента, мастера или другого кабинета.</span>
    <span className="note">Основной агент: {value.primaryConfigured ? 'номер закреплён' : 'номер ещё не задан'}.
      Активных страховых партнёров: {value.registeredCount}.</span>
    <button type="button" className="opt" aria-pressed={value.registrationOpen}
      disabled={busy || (next && !value.primaryConfigured)}
      onClick={async () => {
        if (await run(() => put('/api/admin/settings/insurancePartners',
          { registrationOpen: next }),
          next ? 'Регистрация страховых партнёров разрешена' : 'Регистрация новых страховых партнёров закрыта')) {
          state.reload();
        }
      }}>
      <b>{value.registrationOpen ? '✓ Регистрация новых партнёров разрешена' : 'Регистрация новых партнёров закрыта'}</b>
      <small>Нажмите, чтобы {next ? 'разрешить новые регистрации' : 'запретить новые регистрации'}.
        Существующие страховые кабинеты продолжат работать.</small>
    </button>
    {!value.primaryConfigured && <span className="note">Сначала укажите номер первого агента через защищённую команду на VPS. До этого регистрация страховщиков закрыта.</span>}
  </section>;
}
