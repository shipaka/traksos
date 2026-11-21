import { useEffect, useState } from 'react';
import { setToken } from '../api.ts';

/** Same real TrakSOS application, opened on another origin/database. */
export function SandboxEnter() {
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const query = location.hash.split('?')[1] ?? '';
    const ticket = new URLSearchParams(query).get('ticket') ?? '';
    // Never retain a usable single-use credential in the browser URL/history.
    history.replaceState(null, '', location.pathname + location.search + '#/sandbox-enter');
    if (!ticket) { setError('Отсутствует приглашение в тестовый кабинет.'); return; }
    void fetch('/api/sandbox/exchange', {
      method: 'POST', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ticket }),
    }).then(async response => {
      const json = await response.json().catch(() => null);
      if (!response.ok || json?.sandbox !== true ||
          typeof json?.token !== 'string' || typeof json?.landing !== 'string')
        throw new Error(json?.message || 'Не удалось открыть изолированный тестовый кабинет');
      if (!active) return;
      // Per-origin local/session storage cannot reach production on another host.
      sessionStorage.setItem('traksos.sandboxMode', '1');
      // Only a signed admin handoff grants switching authority. A regular
      // fictitious role ticket never creates or inherits a supervisor.
      if (json.role === 'admin') sessionStorage.setItem('traksos.sandboxSupervisorToken', json.token);
      else sessionStorage.removeItem('traksos.sandboxSupervisorToken');
      if (typeof json.returnUrl === 'string' && json.returnUrl.startsWith('https://'))
        sessionStorage.setItem('traksos.sandboxReturnUrl', json.returnUrl);
      setToken(json.token);
      location.replace(location.pathname + location.search + json.landing);
      location.reload();
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : 'Ошибка входа'); });
    return () => { active = false; };
  }, []);
  return <main className="stack" style={{maxWidth:650,margin:'36px auto',padding:20}}>
    <span className="pill accent">ИЗОЛИРОВАННЫЙ ТЕСТ</span>
    <h1>{error ? 'Не удалось открыть кабинет' : 'Открываем рабочий кабинет TrakSOS'}</h1>
    <p>{error || 'Используются настоящие экраны приложения и тестовая база. Настоящие клиенты и платежи не затрагиваются.'}</p>
  </main>;
}

const SANDBOX_ROLE_CHOICES = [
  ['client','Клиент'], ['owner','Владелец автопарка'],
  ['driver','Водитель'], ['master','Выездной мастер'],
  ['tow','Эвакуаторщик'], ['service','СТО / рембаза'],
  ['master_service','Мастер и СТО'], ['insurer','Страховой партнёр'],
  ['inspection','Техосмотр'], ['courier','Курьер'],
  ['moderator','Модератор'], ['admin','Администратор'],
] as const;

export function SandboxModeBar() {
  const [selectedRole, setSelectedRole] = useState<string>('client');
  const [switching,setSwitching] = useState(false);
  const [error,setError] = useState('');
  let active = false;
  let returnUrl = '';
  let supervisorToken = '';
  try {
    active = sessionStorage.getItem('traksos.sandboxMode') === '1';
    returnUrl = sessionStorage.getItem('traksos.sandboxReturnUrl') ?? '';
    supervisorToken = sessionStorage.getItem('traksos.sandboxSupervisorToken') ?? '';
  } catch { /* private mode */ }
  if (!active) return null;
  const changeRole = async () => {
    if (!supervisorToken || switching) return;
    setSwitching(true); setError('');
    try {
      const response = await fetch('/api/sandbox/switch-role',{
        method:'POST',cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',
        headers:{'content-type':'application/json',authorization:'Bearer '+supervisorToken},
        body:JSON.stringify({role:selectedRole}),
      });
      const data = await response.json().catch(()=>null);
      if (!response.ok || data?.sandbox !== true ||
          data?.role !== selectedRole || typeof data?.token !== 'string' ||
          typeof data?.landing !== 'string' || !data.landing.startsWith('#/'))
        throw new Error(data?.message || 'Не удалось переключить тестовую роль');
      setToken(data.token);
      location.replace(location.pathname + location.search + data.landing);
      location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка переключения');
      setSwitching(false);
    }
  };
  return <div className="banner sandbox-isolated-banner sandbox-supervisor-bar"
    role="note" style={{position:'sticky',top:0,zIndex:1200,margin:0}}>
    <b>ТЕСТОВЫЙ КАБИНЕТ · ДАННЫЕ ИЗОЛИРОВАНЫ</b>
    <span>Настоящие разделы, вымышленные участники и суммы. SMS и реальные платежи отключены.</span>
    {supervisorToken && <div className="sandbox-supervisor-switcher">
      <label htmlFor="sandbox-switch-role">Открыть кабинет</label>
      <select id="sandbox-switch-role" value={selectedRole}
        onChange={e=>setSelectedRole(e.target.value)} disabled={switching}>
        {SANDBOX_ROLE_CHOICES.map(([value,label])=><option key={value} value={value}>{label}</option>)}
      </select>
      <button type="button" className="btn small" disabled={switching}
        onClick={changeRole}>{switching?'Открываем…':'Перейти'}</button>
      {error && <span role="alert" className="sandbox-supervisor-error">{error}</span>}
    </div>}
    {returnUrl && <a className="btn ghost small" href={returnUrl}>← К выбору тестовых кабинетов</a>}
  </div>;
}
