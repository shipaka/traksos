import {useEffect,useRef,useState} from 'react';
import {put} from '../api.ts';
import {useAction,useMe} from '../ui.tsx';
import {useAdminScopedResource} from '../adminScopedResource20261124.ts';

type InsuranceAccess={registrationOpen:boolean;primaryConfigured:boolean;registeredCount:number};

/** Admin-only switch; private partner phone is never sent to the web UI. */
export function InsuranceAccessAdmin() {
  const {me}=useMe();
  const admin=!!me?.roles.includes('admin');
  const scope=(me?.id??'signed-out')+':insurance-access';
  const latestScope=useRef(scope);
  latestScope.current=scope;
  const state=useAdminScopedResource<InsuranceAccess>('/api/admin/insurance-access',scope,admin);
  const {busy,run}=useAction();
  const [toggleError,setToggleError]=useState('');
  useEffect(()=>setToggleError(''),[scope]);

  const value=state.data;
  const valid=!!value&&typeof value.registrationOpen==='boolean'&&
    typeof value.primaryConfigured==='boolean'&&Number.isSafeInteger(value.registeredCount);
  if(!admin)return <section className="card stack">
    <b>Страховые партнёры</b><p role="alert">Управление допуском страховых агентов доступно только администратору.</p>
  </section>;
  if(!valid)return <section className="card stack" aria-label="Допуск страховых агентов">
    <b>Страховые партнёры</b>
    <div className="note" role={state.error||value?'alert':'status'}>
      {state.error?'Не удалось загрузить настройки: '+state.error:
        value?'Сервер вернул неполные настройки допуска. Не меняем регистрацию до проверки.':
        'Загружаем действующие настройки допуска…'}
    </div>
    {(state.error||value)&&<button type="button" className="btn ghost small"
      onClick={state.reload}>Повторить загрузку настроек</button>}
  </section>;
  const next=!value.registrationOpen;
  return <section className="card stack" aria-label="Допуск страховых агентов">
    <b>Страховые партнёры</b>
    <span className="note">Первый агент закрепляется за одним номером в закрытых настройках сервера.
      Этот номер не может использоваться для регистрации клиента, мастера или другого кабинета.</span>
    <span className="note">Основной агент: {value.primaryConfigured?'номер закреплён':'номер ещё не задан'}.
      Активных страховых партнёров: {value.registeredCount}.</span>
    {toggleError&&<div className="banner warn" role="alert">{toggleError}</div>}
    <button type="button" className="opt" aria-pressed={value.registrationOpen}
      disabled={busy||(next&&!value.primaryConfigured)}
      onClick={async()=>{
        const startedAs=scope;
        setToggleError('');
        const result=await run(()=>put('/api/admin/settings/insurancePartners',
          {registrationOpen:next}),
          next?'Регистрация страховых партнёров разрешена':'Регистрация новых страховых партнёров закрыта');
        if(latestScope.current!==startedAs)return;
        if(result)state.reload();
        else setToggleError('Изменение допуска не подтверждено. Проверьте действующую настройку перед повтором.');
      }}>
      <b>{value.registrationOpen?'✓ Регистрация новых партнёров разрешена':'Регистрация новых партнёров закрыта'}</b>
      <small>Нажмите, чтобы {next?'разрешить новые регистрации':'запретить новые регистрации'}.
        Существующие страховые кабинеты продолжат работать.</small>
    </button>
    <button type="button" className="btn ghost small" disabled={busy} onClick={state.reload}>
      Сверить текущий допуск
    </button>
    {!value.primaryConfigured&&<span className="note">Сначала укажите номер первого агента через защищённую команду на VPS. До этого регистрация страховщиков закрыта.</span>}
  </section>;
}
