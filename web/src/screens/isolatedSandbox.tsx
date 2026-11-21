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

export function SandboxModeBadge() {
  let active = false;
  let returnUrl = '';
  try {
    active = sessionStorage.getItem('traksos.sandboxMode') === '1';
    returnUrl = sessionStorage.getItem('traksos.sandboxReturnUrl') ?? '';
  } catch { /* private mode */ }
  if (!active) return null;
  return returnUrl
    ? <a className="pill accent sandbox-test-badge" href={returnUrl} aria-label="Тест. К выбору тестовых кабинетов" title="К выбору тестовых кабинетов">Тест</a>
    : <span className="pill accent sandbox-test-badge">Тест</span>;
}
