import { useEffect, useState } from 'react';
import { post, setToken, connectWs, ApiError } from '../api.ts';
import { useAction, useMe, useToast, Field, go } from '../ui.tsx';
import { SERVICE_TILES, MASTER_SPECIALTIES, rememberGuestService } from '../guestCatalog.ts';

const HERO_SLIDES = [
  { id: 'approved', label: 'Единая платформа TrakSOS', eyebrow: 'ЕДИНАЯ ПЛАТФОРМА ДЛЯ ГРУЗОВОГО ТРАНСПОРТА',
    description: 'Эвакуация · Выездной мастер · Ремонт и ТО · Запчасти · Страхование · Техосмотры · Консультации',
    caption: 'TrakSOS объединяет сервисы по всей России. Реальная доступность выездных специалистов и СТО проверяется для выбранного города.' },
  { id: 'rescue', label: 'Эвакуация грузового транспорта', eyebrow: 'TRAKSOS · ПОМОЩЬ НА ДОРОГЕ',
    description: 'Нужен эвакуатор? Опишите технику и маршрут, ознакомьтесь с предложениями исполнителей в личном кабинете.',
    caption: 'Наличие исполнителя и условия выезда зависят от региона и выбранной заявки.' },
  { id: 'service', label: 'Грузовые СТО и запись на ремонт', eyebrow: 'TRAKSOS · РЕМОНТ И ТЕХНИЧЕСКОЕ ОБСЛУЖИВАНИЕ',
    description: 'Ищите грузовые СТО, планируйте ремонт и обслуживание, следите за обращениями и историей работ.',
    caption: 'Запись доступна после входа при наличии подключённых станций.' },
] as const;

function PublicDemoMapBackdrop() {
  // The public demonstration map is a bundled, immutable asset.
  // It is never replaced with text because of network quality.
  return <div className="public-map-static" role="img"
    aria-label="Демонстрационная карта с условными отметками услуг, не отражающая реальную доступность; доступна без интернета" />;
}

// Роль выбирают только те, кто подключается работать. Остальные входят по номеру — кабинет определяется по ролям.
const JOIN_ROLES = [
  { id: 'master', name: 'Мастер', hint: 'Выездные работы; далее выбор специализаций' },
  { id: 'tow', name: 'Эвакуаторщик', hint: 'Заявки на грузовую эвакуацию' },
  { id: 'service', name: 'СТО', hint: 'Записи на ремонт и кабинет станции' },
  { id: 'insurer', name: 'Страховой агент', hint: 'Оформление полисов и страховых заявок' },
] as const;
type JoinRole = (typeof JOIN_ROLES)[number]['id'];
const PARTNER_SHOWCASES: Record<JoinRole,{tag:string;title:string;description:string;imageLabel:string}> = {
  tow: {tag:'01 · ЭВАКУАТОРЩИК',title:'Эвакуация тяжёлой техники',
    description:'Принимайте заявки на эвакуацию грузовиков, планируйте выезды и контролируйте выполнение заказов.',
    imageLabel:'Утверждённая кинематографичная иллюстрация эвакуатора TrakSOS — вариант 1'},
  master: {tag:'04 · ВЫЕЗДНОЙ МАСТЕР',title:'Ваши навыки востребованы',
    description:'Заявки по специализациям, диагностика транспорта и удобный рабочий кабинет выездного мастера.',
    imageLabel:'Утверждённая иллюстрация мастера с цифровым кабинетом TrakSOS — вариант 4'},
  service: {tag:'05 · СТО И СЕРВИС',title:'Новые клиенты для вашей СТО',
    description:'Онлайн-запись, обращения клиентов и управление грузовым сервисом.',
    imageLabel:'Утверждённая иллюстрация сервисного центра TrakSOS — вариант 5'},
  insurer: {tag:'07 · СТРАХОВОЙ АГЕНТ',title:'Страхование грузового транспорта',
    description:'Оформление страховых обращений, документы и работа с заявками в одном месте.',
    imageLabel:'Утверждённая иллюстрация страхового агента TrakSOS — вариант 7'},
};
const DEFAULT_PARTNER_SHOWCASE = {tag:'TRAKSOS · ПАРТНЁРСКАЯ ПЛАТФОРМА',
  title:'Выберите направление и станьте партнёром',
  description:'Мастера, эвакуаторы, СТО и страховые специалисты работают в единой системе.',
  imageLabel:'Грузовой автомобиль Scania — общий баннер партнёрской регистрации TrakSOS'};

type Intent = 'help' | 'login' | 'register' | 'join' | 'reset' | 'activate';

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
  const [heroSlide, setHeroSlide] = useState(0);
  const [phone, setPhone] = useState('+7 ');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [role, setRole] = useState<JoinRole | null>(null);
  const [customerType, setCustomerType] = useState<'owner' | 'driver'>('owner');
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [specialtiesOpen, setSpecialtiesOpen] = useState(true);
  const [insurerOnly, setInsurerOnly] = useState(false);
  const [agree, setAgree] = useState(false);
  const toast = useToast();
  // The desktop "Услуги" link also works when opened from the sign-in form.
  // The destination is a real section, never a second/legacy landing page.
  useEffect(() => {
    if (intent) return;
    let pending = false;
    try {
      pending = sessionStorage.getItem('traksos.scrollPublicServices') === '1';
      sessionStorage.removeItem('traksos.scrollPublicServices');
    } catch { /* private browsing */ }
    if (!pending) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById('public-services')?.scrollIntoView({ behavior: 'auto', block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [intent]);
  const [appealToken, setAppealToken] = useState<string | null>(null);
  const [appealText, setAppealText] = useState('');
  const [appealSent, setAppealSent] = useState(false);

  // A routed auth form must clear its URL as well as local state on Back.
  // Otherwise the guest header links to #/login, #/register or #/join
  // have no effect after a previous visit to the same unchanged hash.
  const backToPublic = () => {
    setIntent(null);
    if (entry) go('');
  };

  async function sendCode() {
    if (intent === 'join' && !role) return;
    setInsurerOnly(false);
    const r = await run(async () => {
      try {
        return await post('/api/auth/code', { phone, purpose: intent === 'reset' || intent === 'activate' ? 'reset' : 'register',
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
    if (intent === 'join' && !role) return;
    if (intent === 'login') {
      setLoginError('');
      if (!/^\+7[0-9]{10}$/.test('+7' + phone.replace(/\D/g, '').slice(-10)) || phone.replace(/\D/g, '').length !== 11) {
        setLoginError('Введите номер телефона полностью: +7 и 10 цифр.');
        return;
      }
      try {
        const login = await post('/api/auth/login', { phone, password, device: navigator.userAgent.slice(0, 200) });
        await signedIn(login);
      } catch (e) {
        setLoginError(e instanceof ApiError
          ? e.message + (e.data?.requestId ? ' · Код обращения: ' + e.data.requestId : '')
          : 'Не удалось завершить вход. Проверьте соединение и повторите попытку.');
      }
      return;
    }
    const r = await run(async () => {
      try {
        return await post('/api/auth/verify', { phone, code,
          role: intent === 'join' ? role : undefined,
          accountType: intent === 'join' ? role : intent === 'register' || intent === 'help' ? customerType : undefined,
          purpose: intent === 'reset' || intent === 'activate' ? 'reset' : 'register', password,
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
      if (intent === 'join' && role === 'master') {
        try { sessionStorage.setItem('traksos.masterSpecialties', JSON.stringify(specialties)); } catch { /* private browsing */ }
      }
      toast('Вы вошли');
      try { localStorage.removeItem('traksos.ref'); } catch { /* */ }
      setToken(r.token);
      connectWs();
      await reload();
      let qr: string | null = null;
      try { qr = sessionStorage.getItem('traksos.qr'); } catch { /* */ }
      const roles: string[] = r.user?.roles ?? [];
      const customer = roles.includes('client') || roles.includes('driver');
      let pending: string | null = null;
      try {
        pending = sessionStorage.getItem('traksos.pendingLandingAction');
        sessionStorage.removeItem('traksos.pendingLandingAction');
      } catch { /* private browsing */ }
      const selectedDestination: string | undefined = customer ? ({
        van: '#/sos/master', tow: '#/new/tow', sto: '#/services',
        consult: '#/new/consult', insurance: '#/insurance/request/new',
        parts: '#/shop', inspection: '#/garage'
      } as Record<string,string>)[pending ?? ''] : undefined;
      // Dual-role admins may choose a preferred workspace on their own device.
      // A new master registration still goes to the profile first.
      const preferredMode = (() => { try { return localStorage.getItem('traksos.mode'); } catch { return null; } })();
      const isAdminMaster = roles.includes('admin') && roles.includes('master');
      location.hash = qr ? '#/qr/' + qr
        : selectedDestination && intent !== 'join' ? selectedDestination
        : intent === 'join' && role === 'insurer' ? '#/insurance'
        : intent === 'join' && role === 'service' ? '#/as/service'
        : intent === 'join' ? '#/work/profile'
        : isAdminMaster && preferredMode === 'performer' ? '#/as/performer'
        : homeFor(roles, intent ?? 'login');
  }

  const partnerShowcase = intent === 'join' && role ? PARTNER_SHOWCASES[role] : DEFAULT_PARTNER_SHOWCASE;
  const partnerShowcaseKey = intent === 'join' ? (role ?? 'intro') : 'intro';
  const needAgree = !['login', 'reset'].includes(intent ?? '') || !!driver; // водитель по QR — обычно новый номер, согласие сразу
  const title = intent === 'activate' ? 'Активировать созданный администратором аккаунт' : intent === 'reset' ? 'Восстановить пароль' : intent === 'help' ? 'Помощь на дороге' : intent === 'join' ? 'Работать с TrakSOS' : intent === 'register' ? 'Регистрация в TrakSOS' : 'Вход по номеру телефона';
  const sub = intent === 'activate' ? 'Администратор уже назначил ваш кабинет. Подтвердите свой номер SMS-кодом и задайте личный пароль. Роли изменить при активации нельзя.' : intent === 'reset' ? 'Отправим один SMS-код для смены пароля.' : intent === 'help' ? 'Подтвердите номер — и сразу к заявке. Мастер позвонит на него.'
    : intent === 'join' ? 'Выберите, кем подключаетесь. После входа заполните профиль — проверим и откроем заявки.'
    : intent === 'register' ? 'Укажите номер телефона. Если аккаунта ещё нет, создадим его после подтверждения SMS-кодом.'  : 'Вход по паролю, без SMS. Если забыли пароль — восстановите доступ.'; // legacy description

  if (!intent) return (
    <main className="public-home public-landing" id="public-home">
      <div className="public-landing-head">
        <span className="public-landing-region">◉ Единая платформа для России</span>

      </div>

      <section className="public-hero public-brand-hero" aria-labelledby="public-main-title">
        <div className="public-hero-copy">
          <span className="public-eyebrow">{HERO_SLIDES[heroSlide].eyebrow}</span>
          <h1 id="public-main-title" key={'title-'+heroSlide}>
            {heroSlide === 0 ? <><em>Trak<b>SOS</b></em> — помощь<br/>в пути и полный сервис<br/>для грузовиков и прицепов</>
            : heroSlide === 1 ? <>Эвакуация грузовиков<br/>и помощь в пути<br/>с <em>Trak<b>SOS</b></em></>
            : <>Ремонт и запись в СТО<br/>для грузового транспорта<br/>с <em>Trak<b>SOS</b></em></>}
          </h1>
          <p key={'description-'+heroSlide}>{HERO_SLIDES[heroSlide].description}</p>
          <div className="public-track-benefits" aria-label="Преимущества TrakSOS">
            <span><i aria-hidden="true">ϟ</i>Быстрое обращение</span>
            <span><i aria-hidden="true">✓</i>Проверка исполнителей</span>
            <span><i aria-hidden="true">⌖</i>Для грузовиков по всей России</span>
            <span><i aria-hidden="true">▤</i>Работа с юрлицами</span>
          </div>
          <div className="public-actions">
            <button type="button" className="public-button public-button-sos"
              onClick={() => heroSlide === 0 ? go('login') : go(heroSlide === 1 ? 'explore/tow' : 'explore/sto')}>
              {heroSlide === 0 ? 'Войти' : heroSlide === 1 ? 'Узнать об эвакуации' : 'Узнать о СТО'}
            </button>
            <button type="button" className="public-button public-button-outline" onClick={() => go('register')}>Регистрация</button>
          </div>

          <div className="public-hero-caption" key={'caption-'+heroSlide}>{HERO_SLIDES[heroSlide].caption}</div>
        </div>
        <div key={'slide-art-'+HERO_SLIDES[heroSlide].id} className={'public-hero-visual public-hero-slide-' + HERO_SLIDES[heroSlide].id} aria-hidden="true" />
        <div className="public-hero-carousel" role="group" aria-label="Фотографии TrakSOS">
          <div className="public-hero-dots">
            {HERO_SLIDES.map((slide, index) => <button key={slide.id} type="button"
              className={'public-hero-dot' + (heroSlide === index ? ' active' : '')}
              aria-label={'Показать фото ' + (index + 1) + ': ' + slide.label}
              aria-pressed={heroSlide === index}
              onClick={() => setHeroSlide(index)} />)}
          </div>
          <button type="button" className="public-hero-prev" aria-label="Предыдущее фото"
            onClick={() => setHeroSlide((heroSlide + HERO_SLIDES.length - 1) % HERO_SLIDES.length)}>‹</button>
          <button type="button" className="public-hero-next" aria-label="Следующее фото"
            onClick={() => setHeroSlide((heroSlide + 1) % HERO_SLIDES.length)}>›</button>
          <span className="public-hero-slide-status" role="status">{HERO_SLIDES[heroSlide].label}</span>
        </div>
      </section>

      <div className="public-content-grid">
        <section className="public-real-services" id="public-services">
          <div className="public-section-head public-services-a11y-title"><span className="public-section-kicker">ПОМОЩЬ ГРУЗОВИКАМ</span><h2>Все услуги TrakSOS</h2></div>
          <div className="public-service-tiles">
            {SERVICE_TILES.map(({id,icon,title,hint}) => (
              <a href={'#/explore/' + id} className={'public-service-tile public-service-' + id}
                key={id} onClick={() => rememberGuestService(id)}>
                <span className="public-service-icon" aria-hidden="true">{icon}</span>
                <b>{title}</b><small>{hint}</small><span className="public-service-arrow">Далее <span aria-hidden="true">›</span></span>
              </a>
            ))}
          </div>
        </section>




        {!(window as any).TrakSOSNative && <aside className="public-app-card">
          <div className="public-section-kicker">TRAKSOS В ТЕЛЕФОНЕ</div>
          <h2>Мобильное приложение <em>TrakSOS</em></h2>
          <div className="public-app-phone" aria-hidden="true">
            <span className="public-app-logo">Trak<b>SOS</b></span>
            <img className="public-app-phone-truck" src="/tracksos-approved-scania-r520.webp" alt="" loading="lazy" />
            <span>Помощь грузовику<br/>в дороге</span>
          </div>
          <p>Заявки, специалисты, документы и связь с мастером — в одном приложении.</p>
          <span className="public-rustore-soon">Скоро в RuStore</span>
          <small>Ссылка на скачивание появится после публикации приложения.</small>
        </aside>}
      </div>

      <section className="public-why-strip" aria-label="Преимущества сервиса">
        <article className="public-benefit public-benefit-speed"><span className="public-benefit-icon">⚡</span><b>Быстрая помощь</b><small>Обращение можно оформить онлайн</small></article>
        <article className="public-benefit public-benefit-verified"><span className="public-benefit-icon">
          <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M24 4 39 10v12c0 10-6 17-15 22C15 39 9 32 9 22V10Z" />
            <path d="m17 24 5 5 10-11" />
          </svg></span><b>Проверенные партнёры</b><small>Проверка мастеров, СТО и эвакуаторов</small></article>
        <article className="public-benefit public-benefit-unified"><span className="public-benefit-icon">
          <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="24" cy="12" r="6" /><circle cx="11" cy="34" r="6" /><circle cx="37" cy="34" r="6" />
            <path d="m21 18-7 10m13-10 7 10M18 34h12" />
          </svg></span><b>Всё в одном месте</b><small>Помощь, запчасти и страхование</small></article>
        <article className="public-benefit public-benefit-value"><span className="public-benefit-icon">%</span><b>Выгодные условия</b><small>Для водителей и автопарков</small></article>
      </section>
      <div className="public-track-extras">
        <button type="button" className="public-track-insurance" onClick={() => { rememberGuestService('insurance'); go('register'); }}>
          <span className="public-track-insurance-art" aria-hidden="true" />
          <span><b>Страхование грузового транспорта</b>
          <small>ОСАГО, КАСКО, груз, ответственность — заявка через TrakSOS</small></span>
          <strong>Оформить заявку →</strong>
        </button>
        <div className="public-track-extras-grid">
          <a href="#/explore/parts" className="public-track-extra public-track-parts" onClick={() => rememberGuestService('parts')}>
            <span className="public-track-extra-art" aria-hidden="true"/><b>Запчасти</b><small>Оригиналы и проверенные аналоги</small><span aria-hidden="true">›</span>
          </a>
          <a href="#/explore/inspection" className="public-track-extra public-track-inspection" onClick={() => rememberGuestService('inspection')}>
            <span className="public-track-extra-art" aria-hidden="true"/><b>Техосмотр</b><small>Информация и доступные варианты</small><span aria-hidden="true">›</span>
          </a>
          <a href="#/explore/guide" className="public-track-extra public-track-guide">
            <span className="public-track-extra-art" aria-hidden="true"/><b>Полезное</b><small>Как работает сервис</small><span aria-hidden="true">›</span>
          </a>
        </div>
      </div>



      <div className="public-location-process-grid" id="public-how">
        <div className="public-how">
          <span className="public-section-kicker">ПОНЯТНЫЙ ПРОЦЕСС</span>
          <h2>Как получить помощь</h2>
          <div className="public-steps">
            <div><span>01</span><b>Опишите проблему</b><small>Поломка, автомобиль и место</small></div>
            <div><span>02</span><b>Выберите предложение</b><small>Когда появятся подходящие исполнители</small></div>
            <div><span>03</span><b>Следите за заявкой</b><small>Статус и связь с мастером</small></div>
          </div>
        </div>
        <section className="public-demo-map" id="public-map" aria-label="Как выглядит карта помощи">
          <div className="public-section-head"><span className="public-section-kicker">ЗОНА ОБСЛУЖИВАНИЯ</span><h2>Рядом с вами</h2></div>
          <div className="public-map-wrap">
            <a className="public-map-static-link" href="https://yandex.ru/maps/"
              target="_blank" rel="noopener noreferrer" aria-label="Открыть этот район в Яндекс Картах">
              <PublicDemoMapBackdrop />
            </a>
          </div>
          <a className="public-map-open-link" href="https://yandex.ru/maps/"
            target="_blank" rel="noopener noreferrer">Открыть в Яндекс Картах ↗</a>
          <div className="public-map-legend"><span><i className="service"/>СТО</span><span><i className="master"/>Мастер</span><span><i className="tow"/>Эвакуация</span></div>
          <p className="public-demo-warning"><strong>Пример расположения услуг.</strong> Значки условные: это не реальные исполнители и не их доступность. Вы можете открыть Яндекс Карты и посмотреть интересующий вас регион. Отметки на демонстрационной карте условные.</p>
        </section>
        <div className="public-partner">
          <span className="public-section-kicker">ДЛЯ МАСТЕРОВ И СТО</span>
          <h2>Станьте партнёром TrakSOS</h2>
          <p>Подключайте свой сервис и работайте с заявками через отдельный кабинет.</p>
          <button type="button" className="public-button public-button-partner" onClick={() => go('join')}>Подключиться →</button>
        </div>
      </div>

    </main>
  );

  return (
    <main className="auth-desktop-layout">
      <section className="auth-desktop-form">
      {intent === 'login' && step === 'phone' && <div className="auth-entry-options" aria-label="Варианты входа">
        <button type="button" onClick={() => setIntent('login')}>Войти по номеру</button>
        <button type="button" onClick={() => go('join')}>Хочу работать с TrakSOS</button>
      </div>}
      {intent === 'register' && step === 'phone' && <nav className="guest-signup-kind" aria-label="Тип регистрации">
        <a href="#/register" aria-current={intent === 'register' ? 'page' : undefined}>Клиент</a>
        <a href="#/join" aria-current={intent === 'join' ? 'page' : undefined}>Зарегистрироваться как партнёр</a>
      </nav>}
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
          <Field label="Телефон"><input className="field" type="tel" autoComplete="username" value={phone} onChange={(e) => { setPhone(e.target.value); setLoginError(''); }} /></Field>
          <Field label="Пароль"><input className="field" type="password" autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setLoginError(''); }} /></Field>
          {loginError && <div role="alert" className="card" style={{ borderColor: 'var(--danger, #e25b69)' }}>{loginError}</div>}
          <button className="btn" disabled={busy || password.length === 0}>Войти</button>
          <button type="button" className="btn ghost" onClick={() => { setIntent('reset'); setStep('phone'); }}>Забыли пароль?</button>
          <button type="button" className="btn ghost" onClick={backToPublic}>Назад</button>
        </form>
      ) : step === 'phone' ? (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); sendCode(); }}>
          {intent === 'register' && <div className="stack" role="group" aria-label="Выбор кабинета при регистрации">
            <span className="label">Как вы пользуетесь TrakSOS?</span>
            <span className="note">Выберите подходящий кабинет. Для клиента и исполнителя используются разные рабочие разделы.</span>
            <div className="grid2">
              <button type="button" className="seg" aria-pressed={customerType === 'owner'} onClick={() => setCustomerType('owner')}>Владелец / автопарк</button>
              <button type="button" className="seg" aria-pressed={customerType === 'driver'} onClick={() => setCustomerType('driver')}>Водитель автопарка</button>
            </div>
            {customerType === 'driver' && <span className="note">После входа владелец сможет привязать вас к своей машине по приглашению или QR-коду.</span>}
            <span className="note">Для регистрации мастера, эвакуаторщика, СТО или страхового агента откройте «Для партнёров».</span>
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
            <div className="guest-partner-roles">
            {JOIN_ROLES.map((r) => (
              <button key={r.id} type="button" className={'opt guest-partner-role guest-partner-role-' + r.id} aria-pressed={role === r.id}
                aria-label={r.name} aria-describedby={'join-role-hint-' + r.id}
                onClick={() => setRole(r.id)}>
                <b>{r.name}</b><small id={'join-role-hint-' + r.id}>{r.hint}</small>
              </button>
            ))}
            </div>
            <div className={'guest-partner-mobile-preview partner-art-'+partnerShowcaseKey}
              role="img" aria-label={partnerShowcase.imageLabel}>
              <div className="guest-partner-mobile-preview-copy">
                <b>{partnerShowcase.tag}</b><span>{partnerShowcase.title}</span>
              </div>
            </div>
            {role === 'master' && <details className="guest-master-specialties" open={specialtiesOpen}>
              <summary onClick={event => { event.preventDefault(); setSpecialtiesOpen(v => !v); }}>
                Специализации мастера · выбрано: {specialties.length} <span aria-hidden="true">⌄</span>
              </summary>
              <span className="label">Можно выбрать несколько вариантов</span>
              <div className="guest-master-specialties-grid">
                {MASTER_SPECIALTIES.map(item => <button key={item.id} type="button" className="seg"
                  aria-pressed={specialties.includes(item.id)}
                  onClick={() => setSpecialties(current => current.includes(item.id)
                    ? current.filter(id => id !== item.id) : item.id==='ecu' ? ['ecu'] : [...current.filter(id=>id!=='ecu'),item.id])}>{item.name}</button>)}
              </div>
            </details>}
          </div>}
          <Field label="Телефон">
            <input className="field" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => { setPhone(e.target.value); setInsurerOnly(false); }} />
          </Field>
          {insurerOnly && <div className="card stack" role="alert">
            <b>Для этого номера доступен только страховой кабинет</b>
            <span className="note">Выберите роль «Страховой агент» в разделе «Для партнёров». Другой тип аккаунта на этот номер создать нельзя.</span>
            <button className="btn" type="button" onClick={() => {
              setStep('phone'); setRole('insurer'); setIntent('join'); setInsurerOnly(false);
            }}>Перейти к регистрации страхового агента</button>
          </div>}
          {needAgree && <label className="row note" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 3 }} />
            <span>{intent === 'activate' ? 'Согласен на ' : <>Согласен с {intent === 'join' ? <a href="#/offer/performer" target="_blank" rel="noreferrer">агентским договором</a> : <a href="#/offer/client" target="_blank" rel="noreferrer">офертой</a>} и на </>}<a href="#/offer/privacy" target="_blank" rel="noreferrer">обработку персональных данных</a></span>
          </label>}
          <button className="btn" disabled={busy || (needAgree && !agree) || phone.replace(/\D/g, '').length < 11 || (intent === 'join' && (!role || (role === 'master' && specialties.length === 0)))}>Получить код</button>
          {intent !== 'login' && <button type="button" className="btn ghost" onClick={() => { setIntent('login'); setStep('phone'); setCode(''); }}>Уже есть аккаунт? Войти по паролю</button>}
          {!driver && <button type="button" className="btn ghost" onClick={backToPublic}>Назад</button>}
        </form>
      ) : (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); verify(); }}>
          <Field label={`Код из SMS на ${phone}`} hint={devCode ? `Тестовый режим: код ${devCode}` : undefined}>
            <input className="field" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} style={{ fontSize: 24, letterSpacing: 8, textAlign: 'center' }} />
          </Field>
          <Field label={intent === 'reset' || intent === 'activate' ? 'Новый пароль' : 'Придумайте пароль (минимум 10 символов)'}>
            <input className="field" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} />
          </Field>
          <button className="btn" disabled={busy || code.length < 4 || password.length < 10}>{intent === 'reset' ? 'Изменить пароль' : intent === 'activate' ? 'Активировать аккаунт' : 'Зарегистрироваться'}</button>
          {insurerOnly && <button type="button" className="btn" onClick={() => { setStep('phone'); setCode(''); setRole('insurer'); setIntent('join'); setInsurerOnly(false); }}>Перейти к страховому кабинету</button>}
          <button type="button" className="btn ghost" onClick={() => { setStep('phone'); setCode(''); setInsurerOnly(false); }}>Другой номер</button>
        </form>
      )}
      </section>
      <aside className={'auth-desktop-showcase partner-showcase partner-art-'+partnerShowcaseKey}
        aria-label="Иллюстрация выбранного направления партнёрства TrakSOS">
        <div key={'visual-'+partnerShowcaseKey} className="auth-desktop-showcase-photo"
          role="img" aria-label={partnerShowcase.imageLabel}/>
        <div className="auth-desktop-showcase-copy" aria-live="polite" aria-atomic="true">
          <span>{partnerShowcase.tag}</span>
          <h2>{partnerShowcase.title}</h2>
          <p>{partnerShowcase.description}</p>
        </div>
        <span className="partner-showcase-footnote">Кинематографичная иллюстрация возможностей TrakSOS</span>
      </aside>
    </main>
  );
}
