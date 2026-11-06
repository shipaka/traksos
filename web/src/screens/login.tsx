import { useState } from 'react';
import { post, setToken, connectWs, ApiError } from '../api.ts';
import { useAction, useMe, useToast, Field } from '../ui.tsx';

// Роль выбирают только те, кто подключается работать. Остальные входят по номеру — кабинет определяется по ролям.
const JOIN_ROLES = [
  { id: 'master', name: 'Я мастер', hint: 'Электрик, диагност, воздушник, автономщик, шиномонтаж — специализация в профиле' },
  { id: 'tow', name: 'Я эвакуаторщик', hint: 'Заявки на эвакуацию приходят как звонок' },
  { id: 'service', name: 'Я рембаза (сервис)', hint: 'Клиенты записываются к вам, мастера советуют вас' },
] as const;
type JoinRole = (typeof JOIN_ROLES)[number]['id'];
type Intent = 'help' | 'login' | 'join';

/** Куда вести после входа: по ролям из ответа сервера */
export function homeFor(roles: string[], intent: Intent): string {
  if (intent === 'help') return '#/sos';
  const performer = roles.includes('master') || roles.includes('tow');
  if (intent === 'join') return performer ? '#/as/performer' : '#/as/service';
  if (roles.includes('admin') || roles.includes('moderator')) return '#/as/admin';
  if (roles.includes('client') || roles.includes('driver')) return '#/as/client';
  if (performer) return '#/as/performer';
  if (roles.includes('service')) return '#/as/service';
  return '#/as/client';
}

export function Login({ driver }: { driver?: boolean } = {}) {
  const { reload } = useMe();
  const { busy, run } = useAction();
  const [intent, setIntent] = useState<Intent | null>(driver ? 'login' : null);
  const [phone, setPhone] = useState('+7 ');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [role, setRole] = useState<JoinRole>('master');
  const [agree, setAgree] = useState(false);
  const toast = useToast();
  const [appealToken, setAppealToken] = useState<string | null>(null);
  const [appealText, setAppealText] = useState('');
  const [appealSent, setAppealSent] = useState(false);

  async function sendCode() {
    const r = await run(() => post('/api/auth/code', { phone }), 'Код отправлен');
    if (r) {
      setDevCode(r.devCode ?? null);
      setStep('code');
    }
  }
  async function verify() {
    const r = await run(async () => {
      try {
        return await post('/api/auth/verify', { phone, code, role: intent === 'join' ? role : undefined, device: navigator.userAgent.slice(0, 200), acceptOffers: agree });
      } catch (e) {
        // Заблокирован — показываем форму обжалования, номер уже подтверждён кодом
        if (e instanceof ApiError && e.code === 'blocked' && e.data?.appealToken) { setAppealToken(e.data.appealToken); return null; }
        throw e;
      }
    }, null);
    if (r) {
      toast('Вы вошли');
      setToken(r.token);
      connectWs();
      await reload();
      let qr: string | null = null;
      try { qr = sessionStorage.getItem('traksos.qr'); } catch { /* */ }
      location.hash = qr ? '#/qr/' + qr : intent === 'join' && role !== 'service' ? '#/work/profile' : homeFor(r.user?.roles ?? [], intent ?? 'login');
    }
  }

  const needAgree = intent !== 'login' || !!driver; // водитель по QR — обычно новый номер, согласие сразу
  const title = intent === 'help' ? 'Помощь на дороге' : intent === 'join' ? 'Работать с ТракSOS' : 'Вход по номеру телефона';
  const sub = intent === 'help' ? 'Подтвердите номер — и сразу к заявке. Мастер позвонит на него.'
    : intent === 'join' ? 'Выберите, кем подключаетесь. После входа заполните профиль — проверим и откроем заявки.'
    : 'Пришлём код. Пароль не нужен — кабинет откроется сам.';

  if (!intent) return (
    <main>
      <div className="helpWrap">
        <button type="button" className="helpBtn" onClick={() => setIntent('help')} aria-label="Помогите — вызвать мастера или эвакуатор">
          <span className="i">🆘</span>
          <span className="t">Помогите</span>
          <span className="s">нажмите</span>
        </button>
        <div className="helpHint">👆 Сломались в дороге? Нажмите на кнопку<small>Мастер или эвакуатор приедут на место</small></div>
      </div>
      <button type="button" className="btn ghost" onClick={() => setIntent('login')}>Войти по номеру</button>
      <div className="sub" style={{ textAlign: 'center' }}>Владельцы, водители, мастера, рембазы — один вход, кабинет откроется сам</div>
      <button type="button" className="link" onClick={() => setIntent('join')} style={{ background: 'none', border: 0, color: 'var(--accent)', fontWeight: 600, padding: 8 }}>Хочу работать с ТракSOS →</button>
    </main>
  );

  return (
    <main>
      <div>
        <h1>{title}</h1>
        <div className="sub">{sub}</div>
      </div>

      {appealToken ? (
        <div className="card">
          <b>Аккаунт заблокирован</b>
          {appealSent ? <span className="note">Обжалование отправлено модератору. Ответ придёт по SMS в течение суток.</span> : <>
            <span className="note">Не согласны — опишите, что произошло. Модератор разберётся; если блокировка ошибочная, снимем её.</span>
            <textarea className="field" value={appealText} onChange={(e) => setAppealText(e.target.value)} placeholder="Что произошло, номер заявки, почему вы не согласны" />
            <button className="btn" disabled={busy || appealText.trim().length < 10} onClick={async () => { if (await run(() => post('/api/appeals/blocked', { phone, appealToken, text: appealText }), 'Отправлено модератору')) setAppealSent(true); }}>Оспорить блокировку</button>
          </>}
        </div>
      ) : step === 'phone' ? (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); sendCode(); }}>
          {intent === 'join' && <div className="stack">
            {JOIN_ROLES.map((r) => (
              <button key={r.id} type="button" className="opt" aria-pressed={role === r.id} onClick={() => setRole(r.id)}>
                <b>{r.name}</b><small>{r.hint}</small>
              </button>
            ))}
          </div>}
          <Field label="Телефон">
            <input className="field" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          {needAgree && <label className="row note" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 3 }} />
            <span>Согласен с <a href="#/offer/client" target="_blank" rel="noreferrer">офертой</a>{intent === 'join' ? <>, <a href="#/offer/performer" target="_blank" rel="noreferrer">агентским договором</a></> : null} и на <a href="#/offer/privacy" target="_blank" rel="noreferrer">обработку персональных данных</a></span>
          </label>}
          <button className="btn" disabled={busy || (needAgree && !agree) || phone.replace(/\D/g, '').length < 11}>Получить код</button>
          {!driver && <button type="button" className="btn ghost" onClick={() => setIntent(null)}>Назад</button>}
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
