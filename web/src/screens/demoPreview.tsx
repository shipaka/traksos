import { useEffect, useState, type FormEvent } from 'react';
import { API_URL } from '../api.ts';
import { AdminTestCenter } from './adminTestCenter.tsx';

const KEY = 'traksos.operatorDemoSession';

async function demoRequest(path: string, data: object) {
  const response = await fetch(API_URL + path, {
    method:'POST',cache:'no-store',
    headers:{'content-type':'application/json'},
    body:JSON.stringify(data),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(json?.message || 'Временный доступ не подтверждён');
  return json;
}

/** Isolated fake-data cabinet exercise: this is NOT an authenticated staff account. */
export function DemoPreviewGate({ roleId }: {roleId?:string}) {
  const [state,setState] = useState<'checking'|'locked'|'open'>('checking');
  const [code,setCode] = useState('');
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);

  useEffect(() => {
    let active=true;
    const token=(()=>{try{return sessionStorage.getItem(KEY);}catch{return null;}})();
    if (!token) { setState('locked');return; }
    setState('checking');
    void demoRequest('/api/public/demo/check',{token})
      .then(() => { if(active) setState('open'); })
      .catch(() => {
        try{sessionStorage.removeItem(KEY);}catch{ /* private browsing */ }
        if(active) setState('locked');
      });
    return () => {active=false;};
  },[roleId]);

  const unlock=async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault();
    if(busy || !/^\d{10}$/.test(code))return;
    setBusy(true);setError('');
    try {
      const result=await demoRequest('/api/public/demo/unlock',{code});
      try{sessionStorage.setItem(KEY,result.token);}catch{throw new Error('Разрешите временное хранилище браузера для работы тестовых кабинетов.');}
      setCode('');
      setState('open');
      if(location.hash==='#/preview')location.hash='#/admin/test-center';
    }catch(ex) {
      setError(ex instanceof Error ? ex.message : 'Невозможно открыть тренажёр');
      setCode('');
    }finally {setBusy(false);}
  };

  if(state==='checking')return <main className="sandbox-root stack" aria-label="Проверка демо-доступа">
    <section className="sandbox-intro"><h1>Проверяем временный доступ</h1>
      <p>Открывается только тестовый интерфейс без реальных данных.</p></section>
  </main>;
  if(state==='open')return <div className="operator-demo-screen">
    <div className="banner" role="note"><b>ТЕСТОВЫЙ ПРОСМОТР · НЕ РЕАЛЬНЫЙ АККАУНТ</b>
      <span>Здесь только вымышленные заявки, пользователи и финансы. Работа с настоящими данными, SMS и платежами недоступна.</span>
      <button type="button" className="btn ghost small" onClick={() => {
        try{sessionStorage.removeItem(KEY);}catch{}
        setState('locked');location.hash='#/preview';
      }}>Завершить просмотр</button>
    </div>
    <AdminTestCenter roleId={roleId}/>
  </div>;
  return <main className="sandbox-root stack operator-demo-unlock">
    <section className="sandbox-intro">
      <span className="sandbox-eyebrow">TRAKSOS · ВРЕМЕННЫЙ ПРОСМОТР</span>
      <h1>Проверка тестовых кабинетов</h1>
      <p>Введите одноразовый десятизначный код, созданный в SSH-консоли вашего сервера Timeweb. SMS не требуется.</p>
      <p>Это безопасный тренажёр ролей: он не открывает реальные аккаунты, заявки и административные операции.</p>
    </section>
    <form className="card stack" onSubmit={unlock}>
      <label htmlFor="operator-demo-code">Временный код доступа</label>
      <input id="operator-demo-code" className="field" type="password" inputMode="numeric"
        autoComplete="off" pattern="[0-9]{10}" maxLength={10}
        placeholder="10 цифр" required value={code}
        onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,10))} />
      {error&&<div className="banner bad" role="alert">{error}</div>}
      <button type="submit" className="btn" disabled={busy||code.length!==10}>{busy?'Проверяем…':'Открыть тестовые кабинеты'}</button>
      <a href="#/" className="btn ghost small">← На главную</a>
    </form>
  </main>;
}
