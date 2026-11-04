import { useState } from 'react';
import { post, setToken, connectWs } from '../api.ts';
import { useAction, useMe, Field } from '../ui.tsx';

const ROLES = [
  { id: 'client', name: 'Мне нужна помощь', hint: 'Владелец, водитель, транспортная компания' },
  { id: 'master', name: 'Я мастер', hint: 'Электрик, диагност, воздушник, автономщик, шиномонтаж' },
  { id: 'tow', name: 'Я эвакуаторщик', hint: 'Заявки на эвакуацию приходят как звонок' },
] as const;

export function Login() {
  const { reload } = useMe();
  const { busy, run } = useAction();
  const [phone, setPhone] = useState('+7 ');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [role, setRole] = useState<(typeof ROLES)[number]['id']>('client');
  const [agree, setAgree] = useState(false);

  async function sendCode() {
    const r = await run(() => post('/api/auth/code', { phone }), 'Код отправлен');
    if (r) {
      setDevCode(r.devCode ?? null);
      setStep('code');
    }
  }
  async function verify() {
    const r = await run(() => post('/api/auth/verify', { phone, code, role, device: navigator.userAgent.slice(0, 200), acceptOffers: agree }), 'Вы вошли');
    if (r) {
      setToken(r.token);
      connectWs();
      await reload();
      location.hash = role === 'client' ? '#/' : '#/work/profile';
    }
  }

  return (
    <main>
      <div>
        <h1>Вход по номеру телефона</h1>
        <div className="sub">Пришлём код. Пароль не нужен.</div>
      </div>

      {step === 'phone' ? (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); sendCode(); }}>
          <div className="stack">
            {ROLES.map((r) => (
              <button key={r.id} type="button" className="opt" aria-pressed={role === r.id} onClick={() => setRole(r.id)}>
                <b>{r.name}</b><small>{r.hint}</small>
              </button>
            ))}
          </div>
          <Field label="Телефон">
            <input className="field" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <label className="row note" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 3 }} />
            <span>Согласен с <a href="#/offer/client" target="_blank" rel="noreferrer">офертой</a>{role !== 'client' ? <>, <a href="#/offer/performer" target="_blank" rel="noreferrer">агентским договором</a></> : null} и на <a href="#/offer/privacy" target="_blank" rel="noreferrer">обработку персональных данных</a></span>
          </label>
          <button className="btn" disabled={busy || !agree || phone.replace(/\D/g, '').length < 11}>Получить код</button>
        </form>
      ) : (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); verify(); }}>
          <Field label={`Код из SMS на ${phone}`} hint={devCode ? `Тестовый режим: код ${devCode}` : undefined}>
            <input className="field" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} style={{ fontSize: 24, letterSpacing: 8, textAlign: 'center' }} />
          </Field>
          <button className="btn" disabled={busy || code.length < 4}>Войти</button>
          <button type="button" className="btn ghost" onClick={() => { setStep('phone'); setCode(''); }}>Другой номер</button>
        </form>
      )}
    </main>
  );
}
