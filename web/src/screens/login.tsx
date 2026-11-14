import { useEffect, useState } from 'react';
import { post, setToken, connectWs, ApiError } from '../api.ts';
import { useAction, useMe, useToast, Field } from '../ui.tsx';

function PublicDemoMapBackdrop() {
  // The public demonstration map is a bundled, immutable asset.
  // It is never replaced with text because of network quality.
  return <div className="public-map-static" role="img"
    aria-label="Утверждённая демонстрационная карта Санкт-Петербурга и Ленинградской области с условными отметками услуг; доступна без интернета" />;
}

// Роль выбирают только те, кто подключается работать. Остальные входят по номеру — кабинет определяется по ролям.
const JOIN_ROLES = [
  { id: 'master', name: 'Я мастер', hint: 'Электрик, диагност, воздушник, автономщик, шиномонтаж — специализация в профиле' },
  { id: 'tow', name: 'Я эвакуаторщик', hint: 'Заявки на эвакуацию приходят как звонок' },
  { id: 'service', name: 'Я рембаза (сервис)', hint: 'Клиенты записываются к вам, мастера советуют вас' },
  { id: 'master_service', name: 'Мастер и своя СТО', hint: 'Два кабинета: выездные услуги отдельно, ремонт на своей рембазе отдельно' },
  { id: 'insurer', name: 'Я представитель страховой компании', hint: 'Отдельный тип аккаунта: не совмещается с клиентом или мастером' },
] as const;
type JoinRole = (typeof JOIN_ROLES)[number]['id'];
type Intent = 'help' | 'login' | 'register' | 'join' | 'reset';

/** Куда вести после входа: по ролям из ответа сервера */
export function homeFor(roles: string[], intent: Intent): string {
  if (intent === 'help') return '#/sos';
  const performer = roles.includes('master') || roles.includes('tow');
  if (intent === 'join') return roles.includes('insurer') ? '#/insurance' : performer ? '#/as/performer' : '#/as/service';
  if (roles.includes('admin')) return '#/as/admin';
  if (roles.includes('moderator')) return '#/as/moderator';
  if (roles.includes('insurer')) return '#/insurance';
  if (roles.includes('inspection_operator')) return '#/inspections';
  if (roles.includes('client') || roles.includes('driver')) return '#/as/client';
  if (performer) return '#/as/performer';
  if (roles.includes('service')) return '#/as/service';
  return '#/as/client';
}

export function Login({ driver, entry }: { driver?: boolean; entry?: Intent } = {}) {
  const { reload } = useMe();
  const { busy, run } = useAction();
  const [intent, setIntent] = useState<Intent | null>(driver ? 'login' : entry ?? null);
  const [phone, setPhone] = useState('+7 ');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [role, setRole] = useState<JoinRole>('master');
  const [customerType, setCustomerType] = useState<'owner' | 'driver'>('owner');
  const [cameFromRegister, setCameFromRegister] = useState(false);
  const [insurerOnly, setInsurerOnly] = useState(false);
  const [agree, setAgree] = useState(false);
  const toast = useToast();
  const [appealToken, setAppealToken] = useState<string | null>(null);
  const [appealText, setAppealText] = useState('');
  const [appealSent, setAppealSent] = useState(false);

  async function sendCode() {
    setInsurerOnly(false);
    const r = await run(async () => {
      try {
        return await post('/api/auth/code', { phone, purpose: intent === 'reset' ? 'reset' : 'register',
          accountType: intent === 'join' ? role : intent === 'register' || intent === 'help' ? customerType : undefined });
      } catch (e) {
        if (e instanceof ApiError && e.code === 'insurer_only') setInsurerOnly(true);
        throw e;
      }
    }, 'Код отправлен');
    if (r) {
      setDevCode(r.devCode ?? null);
      setStep('code');
    }
  }
  async function verify() {
    if (intent === 'login') {
      const login = await run(() => post('/api/auth/login', { phone, password, device: navigator.userAgent.slice(0, 200) }), null);
      if (login) await signedIn(login);
      return;
    }
    const r = await run(async () => {
      try {
        return await post('/api/auth/verify', { phone, code,
          role: intent === 'join' ? (role === 'master_service' ? 'master' : role) : undefined,
          accountType: intent === 'join' ? role : intent === 'register' || intent === 'help' ? customerType : undefined,
          purpose: intent === 'reset' ? 'reset' : 'register', password,
          ref: (() => { try { return localStorage.getItem('traksos.ref') ?? undefined; } catch { return undefined; } })(), device: navigator.userAgent.slice(0, 200), acceptOffers: agree });
      } catch (e) {
        // Заблокирован — показываем форму обжалования, номер уже подтверждён кодом
        if (e instanceof ApiError && e.code === 'blocked' && e.data?.appealToken) { setAppealToken(e.data.appealToken); return null; }
        if (e instanceof ApiError && e.code === 'insurer_only') setInsurerOnly(true);
        throw e;
      }
    }, null);
    if (r) await signedIn(r);
  }
  async function signedIn(r: any) {
      toast('Вы вошли');
      try { localStorage.removeItem('traksos.ref'); } catch { /* */ }
      setToken(r.token);
      connectWs();
      await reload();
      let qr: string | null = null;
      try { qr = sessionStorage.getItem('traksos.qr'); } catch { /* */ }
      const roles: string[] = r.user?.roles ?? [];
      // Dual-role admins may choose a preferred workspace on their own device.
      // A new master registration still goes to the profile first.
      const preferredMode = (() => { try { return localStorage.getItem('traksos.mode'); } catch { return null; } })();
      const isAdminMaster = roles.includes('admin') && roles.includes('master');
      location.hash = qr ? '#/qr/' + qr
        : intent === 'join' && role === 'insurer' ? '#/insurance'
        : intent === 'join' && role === 'service' ? '#/as/service'
        : intent === 'join' ? '#/work/profile'
        : isAdminMaster && preferredMode === 'performer' ? '#/as/performer'
        : homeFor(roles, intent ?? 'login');
  }

  const needAgree = !['login', 'reset'].includes(intent ?? '') || !!driver; // водитель по QR — обычно новый номер, согласие сразу
  const title = intent === 'reset' ? 'Восстановить пароль' : intent === 'help' ? 'Помощь на дороге' : intent === 'join' ? 'Работать с ТракSOS' : intent === 'register' ? 'Регистрация в ТракSOS' : 'Вход по номеру телефона';
  const sub = intent === 'reset' ? 'Отправим один SMS-код для смены пароля.' : intent === 'help' ? 'Подтвердите номер — и сразу к заявке. Мастер позвонит на него.'
    : intent === 'join' ? 'Выберите, кем подключаетесь. После входа заполните профиль — проверим и откроем заявки.'
    : intent === 'register' ? 'Укажите номер телефона. Если аккаунта ещё нет, создадим его после подтверждения SMS-кодом.'  : 'Вход по паролю, без SMS. Если забыли пароль — восстановите доступ.'; // legacy description

  if (!intent) return (
    <main className="public-home public-landing" id="public-home">
      <div className="public-landing-head">
        <span className="public-landing-region">◉ Санкт-Петербург и Ленинградская область</span>

      </div>

      <section className="public-hero public-brand-hero" aria-labelledby="public-main-title">
        <div className="public-hero-copy">
          <span className="public-eyebrow">ТРАКSOS · ПОМОЩЬ ГРУЗОВОМУ ТРАНСПОРТУ</span>
          <h1 id="public-main-title">Помощь грузовикам <em>в любой ситуации 24/7</em></h1>
          <p>Выездные специалисты, эвакуаторы, грузовые СТО и консультации. Все направления помощи — на одном экране.</p>
          <div className="public-track-benefits" aria-label="Преимущества TrackSOS">
            <span><i aria-hidden="true">ϟ</i>Быстрое обращение</span>
            <span><i aria-hidden="true">✓</i>Проверка исполнителей</span>
            <span><i aria-hidden="true">⌖</i>Санкт-Петербург и Ленобласть</span>
            <span><i aria-hidden="true">▤</i>Работа с юрлицами</span>
          </div>
          <div className="public-actions">
            <button type="button" className="public-button public-button-sos" onClick={() => setIntent('help')}>SOS · Нужна помощь</button>
            <button type="button" className="public-button public-button-outline" onClick={() => document.getElementById('public-how')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Как это работает?</button>
          </div>

          <div className="public-hero-caption">Зона запуска: Санкт-Петербург и Ленинградская область. В других регионах выездные услуги пока недоступны.</div>
        </div>
        <div className="public-hero-visual" aria-hidden="true" />
      </section>

      <div className="public-content-grid">
        <section className="public-real-services" id="public-services">
          <div className="public-section-head"><span className="public-section-kicker">ПОМОЩЬ ГРУЗОВИКАМ</span><h2>Чем вам помочь?</h2></div>
          <div className="public-service-tiles">
            {([
              ['van', '⚒', 'Выездной мастер', 'Ремонт и диагностика на месте'],
              ['tow', '↗', 'Эвакуатор', 'Перевозка грузовика и прицепа'],
              ['sto', '▣', 'СТО грузовых автомобилей', 'Ремонт, обслуживание и запись'],
              ['consult', '☏', 'Консультация специалиста', 'Помощь по телефону'],
            ] as const).map(([id,icon,name,hint]) => (
              <button type="button" className={`public-service-tile public-service-${id}`}
                key={name} onClick={() => setIntent('help')}>
                <span className="public-service-icon" aria-hidden="true">{icon}</span>
                <b>{name}</b><small>{hint}</small><span className="public-service-arrow" aria-hidden="true">›</span>
              </button>
            ))}
          </div>
        </section>

        <section className="public-demo-map" id="public-map" aria-label="Как выглядит карта помощи">
          <div className="public-section-head"><span className="public-section-kicker">ЗОНА ОБСЛУЖИВАНИЯ</span><h2>Рядом с вами</h2></div>
          <div className="public-map-wrap">
            <PublicDemoMapBackdrop />

          </div>
          <div className="public-map-legend"><span><i className="service"/>СТО</span><span><i className="master"/>Мастер</span><span><i className="tow"/>Эвакуация</span></div>
          <p className="public-demo-warning">Демонстрационная карта: точки условные и не означают доступность исполнителей. Реальные данные доступны пользователю после входа.</p>
        </section>

        {!(window as any).TrakSOSNative && <aside className="public-app-card">
          <div className="public-section-kicker">ТРАКSOS В ТЕЛЕФОНЕ</div>
          <h2>Мобильное приложение <em>ТракSOS</em></h2>
          <div className="public-app-phone" aria-hidden="true">
            <span className="public-app-logo">Трак<b>SOS</b></span>
            <img className="public-app-phone-truck" src="/tracksos-approved-scania-r520.webp" alt="" loading="lazy" />
            <span>Помощь грузовику<br/>в дороге</span>
          </div>
          <p>Заявки, специалисты, документы и связь с мастером — в одном приложении.</p>
          <span className="public-rustore-soon">Скоро в RuStore</span>
          <small>Ссылка на скачивание появится после публикации приложения.</small>
        </aside>}
      </div>

      <div className="public-track-extras">
        <button type="button" className="public-track-insurance" onClick={() => setIntent('register')}>
          <span className="public-track-insurance-art" aria-hidden="true" />
          <span><b>Страхование грузового транспорта</b>
          <small>ОСАГО, КАСКО, груз, ответственность — заявка через TrackSOS</small></span>
          <strong>Оформить заявку →</strong>
        </button>
        <div className="public-track-extras-grid">
          <button type="button" className="public-track-extra public-track-parts" onClick={() => setIntent('register')}>
            <span className="public-track-extra-art" aria-hidden="true"/><b>Запчасти</b><small>Оригиналы и проверенные аналоги</small><span aria-hidden="true">›</span>
          </button>
          <button type="button" className="public-track-extra public-track-inspection" onClick={() => setIntent('register')}>
            <span className="public-track-extra-art" aria-hidden="true"/><b>Техосмотр</b><small>Заявка на осмотр транспорта</small><span aria-hidden="true">›</span>
          </button>
          <button type="button" className="public-track-extra public-track-guide" onClick={() => document.getElementById('public-how')?.scrollIntoView({behavior:'smooth'})}>
            <span className="public-track-extra-art" aria-hidden="true"/><b>Полезное</b><small>Как работает сервис</small><span aria-hidden="true">›</span>
          </button>
        </div>
      </div>
      <section className="public-why-strip" aria-label="Преимущества сервиса">
        <div><span>◎</span><b>Наш регион</b><small>Санкт-Петербург и Ленобласть</small></div>
        <div><span>◈</span><b>Подключение партнёров</b><small>Проверка мастеров и СТО</small></div>
        <div><span>⚡</span><b>Дорожная помощь</b><small>Заявка через единый сервис</small></div>
        <div><span>☏</span><b>Связь и консультации</b><small>Помощь в выборе специалиста</small></div>
      </section>
      <section className="public-bottom-row public-information-row" id="public-how">
        <div className="public-how">
          <span className="public-section-kicker">ПОНЯТНЫЙ ПРОЦЕСС</span>
          <h2>Как получить помощь</h2>
          <div className="public-steps">
            <div><span>01</span><b>Опишите проблему</b><small>Поломка, автомобиль и место</small></div>
            <div><span>02</span><b>Выберите предложение</b><small>Когда появятся подходящие исполнители</small></div>
            <div><span>03</span><b>Следите за заявкой</b><small>Статус и связь с мастером</small></div>
          </div>
        </div>
        <div className="public-partner">
          <span className="public-section-kicker">ДЛЯ МАСТЕРОВ И СТО</span>
          <h2>Станьте партнёром ТракSOS</h2>
          <p>Подключайте свой сервис и работайте с заявками через отдельный кабинет.</p>
          <button type="button" className="public-button public-button-partner" onClick={() => setIntent('join')}>Подключиться →</button>
        </div>
      </section>

    </main>
  );

  return (
    <main className="auth-desktop-layout">
      <section className="auth-desktop-form">
      {intent === 'login' && step === 'phone' && <div className="auth-entry-options" aria-label="Варианты входа">
        <button type="button" onClick={() => setIntent('help')}>Помогите — нужна помощь</button>
        <button type="button" onClick={() => setIntent('login')}>Войти по номеру</button>
        <button type="button" onClick={() => setIntent('join')}>Хочу работать с ТракSOS</button>
      </div>}
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
      ) : intent === 'login' ? (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); verify(); }}>
          <Field label="Телефон"><input className="field" type="tel" autoComplete="username" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          <Field label="Пароль"><input className="field" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <button className="btn" disabled={busy || password.length === 0}>Войти</button>
          <button type="button" className="btn ghost" onClick={() => { setIntent('reset'); setStep('phone'); }}>Забыли пароль?</button>
          <button type="button" className="btn ghost" onClick={() => setIntent(null)}>Назад</button>
        </form>
      ) : step === 'phone' ? (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); sendCode(); }}>
          {intent === 'register' && <div className="stack" role="group" aria-label="Выбор кабинета при регистрации">
            <span className="label">Как вы пользуетесь ТракSOS?</span>
            <span className="note">Выберите подходящий кабинет. Для клиента и исполнителя используются разные рабочие разделы.</span>
            <div className="grid2">
              <button type="button" className="seg" aria-pressed={customerType === 'owner'} onClick={() => setCustomerType('owner')}>Владелец / автопарк</button>
              <button type="button" className="seg" aria-pressed={customerType === 'driver'} onClick={() => setCustomerType('driver')}>Водитель автопарка</button>
            </div>
            {customerType === 'driver' && <span className="note">После входа владелец сможет привязать вас к своей машине по приглашению или QR-коду.</span>}
            <span className="label">Или подключитесь как партнёр</span>
            <div className="stack">
              {JOIN_ROLES.map(r => (
                <button key={r.id} type="button" className="opt" onClick={() => {
                  setRole(r.id); setCameFromRegister(true); setIntent('join'); setStep('phone');
                }}>
                  <b>{r.name}</b><small>{r.hint}</small>
                </button>
              ))}
            </div>
          </div>}
          {intent === 'help' && <div className="stack" role="group" aria-label="Тип клиента">
            <span className="label">Как вы пользуетесь транспортом?</span>
            <div className="grid2">
              <button type="button" className="seg" aria-pressed={customerType === 'owner'} onClick={() => setCustomerType('owner')}>Владелец / автопарк</button>
              <button type="button" className="seg" aria-pressed={customerType === 'driver'} onClick={() => setCustomerType('driver')}>Водитель автопарка</button>
            </div>
            {customerType === 'driver' && <span className="note">После входа владелец сможет привязать вас к своей машине по приглашению или QR-коду.</span>}
          </div>}
          {intent === 'join' && <div className="stack">
            {JOIN_ROLES.map((r) => (
              <button key={r.id} type="button" className="opt" aria-pressed={role === r.id} onClick={() => setRole(r.id)}>
                <b>{r.name}</b><small>{r.hint}</small>
              </button>
            ))}
          </div>}
          <Field label="Телефон">
            <input className="field" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => { setPhone(e.target.value); setInsurerOnly(false); }} />
          </Field>
          {insurerOnly && <div className="card stack" role="alert">
            <b>Для этого номера доступен только страховой кабинет</b>
            <span className="note">Выберите регистрацию «Я представитель страховой компании». Другой тип аккаунта на этот номер создать нельзя.</span>
            <button className="btn" type="button" onClick={() => {
              setStep('phone'); setRole('insurer'); setIntent('join'); setInsurerOnly(false);
            }}>Перейти к регистрации страхового агента</button>
          </div>}
          {needAgree && <label className="row note" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 3 }} />
            <span>Согласен с {intent === 'join' ? <a href="#/offer/performer" target="_blank" rel="noreferrer">агентским договором</a> : <a href="#/offer/client" target="_blank" rel="noreferrer">офертой</a>} и на <a href="#/offer/privacy" target="_blank" rel="noreferrer">обработку персональных данных</a></span>
          </label>}
          <button className="btn" disabled={busy || (needAgree && !agree) || phone.replace(/\D/g, '').length < 11}>Получить код</button>
          {intent !== 'login' && <button type="button" className="btn ghost" onClick={() => { setIntent('login'); setStep('phone'); setCode(''); }}>Уже есть аккаунт? Войти по паролю</button>}
          {!driver && <button type="button" className="btn ghost"
            onClick={() => {
              if (intent === 'join' && cameFromRegister) {
                setStep('phone'); setIntent('register'); setCameFromRegister(false);
              } else setIntent(null);
            }}>{intent === 'join' && cameFromRegister ? 'Назад к выбору кабинета' : 'Назад'}</button>}
        </form>
      ) : (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); verify(); }}>
          <Field label={`Код из SMS на ${phone}`} hint={devCode ? `Тестовый режим: код ${devCode}` : undefined}>
            <input className="field" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} style={{ fontSize: 24, letterSpacing: 8, textAlign: 'center' }} />
          </Field>
          <Field label={intent === 'reset' ? 'Новый пароль' : 'Придумайте пароль (минимум 10 символов)'}>
            <input className="field" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} />
          </Field>
          <button className="btn" disabled={busy || code.length < 4 || password.length < 10}>{intent === 'reset' ? 'Изменить пароль' : 'Зарегистрироваться'}</button>
          {insurerOnly && <button type="button" className="btn" onClick={() => { setStep('phone'); setCode(''); setRole('insurer'); setIntent('join'); setInsurerOnly(false); }}>Перейти к страховому кабинету</button>}
          <button type="button" className="btn ghost" onClick={() => { setStep('phone'); setCode(''); setInsurerOnly(false); }}>Другой номер</button>
        </form>
      )}
      </section>
      <aside className="auth-desktop-showcase" aria-label="О сервисе ТракSOS">
        <div className="auth-desktop-showcase-photo" aria-hidden="true" />
        <div className="auth-desktop-showcase-copy">
          <span>ТРАКSOS · ПОМОЩЬ ГРУЗОВОМУ ТРАНСПОРТУ</span>
          <h2>Помощь на дороге, когда она нужна</h2>
          <p>Выездные мастера, эвакуация и СТО грузовых автомобилей — в одном сервисе.</p>
        </div>
      </aside>
    </main>
  );
}
