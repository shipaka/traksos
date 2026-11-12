import { useEffect, useState } from 'react';
import { post, setToken, connectWs, ApiError } from '../api.ts';
import { useAction, useMe, useToast, Field } from '../ui.tsx';

function PublicDemoMapBackdrop() {
  // The public demonstration map is a bundled, immutable asset.
  // It is never replaced with text because of network quality.
  return <div className="public-map-static" role="img"
    aria-label="Иллюстративная карта Санкт-Петербурга с условными точками помощи" />;
}

// Роль выбирают только те, кто подключается работать. Остальные входят по номеру — кабинет определяется по ролям.
const JOIN_ROLES = [
  { id: 'master', name: 'Я мастер', hint: 'Электрик, диагност, воздушник, автономщик, шиномонтаж — специализация в профиле' },
  { id: 'tow', name: 'Я эвакуаторщик', hint: 'Заявки на эвакуацию приходят как звонок' },
  { id: 'service', name: 'Я рембаза (сервис)', hint: 'Клиенты записываются к вам, мастера советуют вас' },
] as const;
type JoinRole = (typeof JOIN_ROLES)[number]['id'];
type Intent = 'help' | 'login' | 'register' | 'join';

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

export function Login({ driver, entry }: { driver?: boolean; entry?: Intent } = {}) {
  const { reload } = useMe();
  const { busy, run } = useAction();
  const [intent, setIntent] = useState<Intent | null>(driver ? 'login' : entry ?? null);
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
        return await post('/api/auth/verify', { phone, code, role: intent === 'join' ? role : undefined, ref: (() => { try { return localStorage.getItem('traksos.ref') ?? undefined; } catch { return undefined; } })(), device: navigator.userAgent.slice(0, 200), acceptOffers: agree });
      } catch (e) {
        // Заблокирован — показываем форму обжалования, номер уже подтверждён кодом
        if (e instanceof ApiError && e.code === 'blocked' && e.data?.appealToken) { setAppealToken(e.data.appealToken); return null; }
        throw e;
      }
    }, null);
    if (r) {
      toast('Вы вошли');
      try { localStorage.removeItem('traksos.ref'); } catch { /* */ }
      setToken(r.token);
      connectWs();
      await reload();
      let qr: string | null = null;
      try { qr = sessionStorage.getItem('traksos.qr'); } catch { /* */ }
      location.hash = qr ? '#/qr/' + qr : intent === 'join' && role !== 'service' ? '#/work/profile' : homeFor(r.user?.roles ?? [], intent ?? 'login');
    }
  }

  const needAgree = intent !== 'login' || !!driver; // водитель по QR — обычно новый номер, согласие сразу
  const title = intent === 'help' ? 'Помощь на дороге' : intent === 'join' ? 'Работать с ТракSOS' : intent === 'register' ? 'Регистрация в ТракSOS' : 'Вход по номеру телефона';
  const sub = intent === 'help' ? 'Подтвердите номер — и сразу к заявке. Мастер позвонит на него.'
    : intent === 'join' ? 'Выберите, кем подключаетесь. После входа заполните профиль — проверим и откроем заявки.'
    : intent === 'register' ? 'Укажите номер телефона. Если аккаунта ещё нет, создадим его после подтверждения SMS-кодом.' : 'Пришлём код. Пароль не нужен — кабинет откроется сам.';

  if (!intent) return (
    <main className="public-home public-landing" id="public-home">
      <div className="public-landing-head">
        <span className="public-landing-region">◉ Санкт-Петербург и Ленинградская область</span>

      </div>

      <section className="public-hero public-brand-hero" aria-labelledby="public-main-title">
        <div className="public-hero-copy">
          <span className="public-eyebrow">ТРАКSOS · ПОМОЩЬ ГРУЗОВОМУ ТРАНСПОРТУ</span>
          <h1 id="public-main-title">Помощь <em>грузовику</em> в дороге — рядом с вами</h1>
          <p>Выездные мастера, диагностика, шиномонтаж, эвакуация и проверенные СТО-партнёры. Услуги для грузового транспорта в Санкт-Петербурге и Ленинградской области.</p>
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
          <div className="public-section-head"><span className="public-section-kicker">НАША ПОМОЩЬ</span><h2>Что умеет ТракSOS</h2></div>
          <div className="public-service-tiles">
            {([
              ['⚡', 'Электрик', 'Проводка, свет, запуск'],
              ['▣', 'Диагностика', 'Ошибки и поиск неисправности'],
              ['◉', 'Пневматика и тормоза', 'Воздушная система, ABS/EBS'],
              ['≋', 'Автономные отопители', 'Диагностика и ремонт'],
              ['◎', 'Шиномонтаж', 'Колёса и проколы'],
              ['↗', 'Эвакуация', 'Помощь грузовику не на ходу'],
              ['☎', 'Консультация', 'Совет мастера по телефону'],
              ['⚙', 'СТО-партнёры', 'Сервис и ремонт на базе'],
            ] as const).map(([icon, name, hint]) => (
              <button type="button" className="public-service-tile" key={name} onClick={() => setIntent('help')}>
                <span className="public-service-icon" aria-hidden="true">{icon}</span>
                <b>{name}</b><small>{hint}</small>
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
            <img className="public-app-phone-truck" src="/tracksos-approved-truck.webp" alt="" loading="lazy" />
            <span>Помощь грузовику<br/>в дороге</span>
          </div>
          <p>Заявки, специалисты, документы и связь с мастером — в одном приложении.</p>
          <span className="public-rustore-soon">Скоро в RuStore</span>
          <small>Ссылка на скачивание появится после публикации приложения.</small>
        </aside>}
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
    <main>
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
            <span>Согласен с {intent === 'join' ? <a href="#/offer/performer" target="_blank" rel="noreferrer">агентским договором</a> : <a href="#/offer/client" target="_blank" rel="noreferrer">офертой</a>} и на <a href="#/offer/privacy" target="_blank" rel="noreferrer">обработку персональных данных</a></span>
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
