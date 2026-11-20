import { useEffect, useState } from 'react';
import { post, setToken, connectWs, ApiError } from '../api.ts';
import { useAction, useMe, useToast, Field, go } from '../ui.tsx';
import { PUBLIC_HOME_TILES, MASTER_SPECIALTIES, rememberGuestService } from '../guestCatalog.ts';
import { OwnerDesktopHome20261120 } from './ownerDesktopHome20261120.tsx';

const HERO_SLIDES = [
  { id: 'approved', label: 'Единая платформа TrakSOS', eyebrow: 'TRAKSOS · ПОМОЩЬ НА ДОРОГЕ И В ДЕЛЕ',
    description: 'Единая платформа для водителей, перевозчиков и всех, кто работает с грузовой техникой',
    caption: 'Зона запуска: Санкт-Петербург и Ленинградская область. В других регионах выездные услуги пока недоступны.' },
  { id: 'rescue', label: 'Эвакуация грузового транспорта', eyebrow: 'TRAKSOS · ПОМОЩЬ НА ДОРОГЕ',
    description: 'Нужен эвакуатор? Опишите технику и маршрут, ознакомьтесь с предложениями исполнителей в личном кабинете.',
    caption: 'Наличие исполнителя и условия выезда зависят от региона и выбранной заявки.' },
  { id: 'service', label: 'Грузовые СТО и запись на ремонт', eyebrow: 'TRAKSOS · РЕМОНТ И ТЕХНИЧЕСКОЕ ОБСЛУЖИВАНИЕ',
    description: 'Ищите грузовые СТО, планируйте ремонт и обслуживание, следите за обращениями и историей работ.',
    caption: 'Запись доступна после входа при наличии подключённых станций.' },
] as const;


/** Approved 19 November visual system: recognisable service icons, not font glyph boxes. */
function PublicTileIcon({ id }: { id: typeof PUBLIC_HOME_TILES[number]['id'] }) {
  const shared = { fill:'none', stroke:'currentColor', strokeWidth:2, strokeLinecap:'round' as const, strokeLinejoin:'round' as const };
  return <svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true" focusable="false" {...shared}>
    {id === 'sos' ? <><path d="M24 5 45 42H3Z"/><path d="M24 17v13m0 6v1"/></>
      : id === 'air' ? <><circle cx="24" cy="25" r="4" fill="currentColor" stroke="none"/><path d="M15 16a12 12 0 0 0 0 18m18-18a12 12 0 0 1 0 18M9 10a20 20 0 0 0 0 30m30-30a20 20 0 0 1 0 30"/></>
      : id === 'sto' ? <><path d="M29 5a13 13 0 0 0-11 18L5 36a5 5 0 0 0 7 7l13-13A13 13 0 0 0 43 14l-9 9-9-2-2-9Z"/></>
      : id === 'ecu' ? <><rect x="11" y="11" width="26" height="26" rx="3"/><rect x="18" y="18" width="12" height="12" rx="1"/><path d="M17 4v7m7-7v7m7-7v7M17 37v7m7-7v7m7-7v7M4 17h7m-7 7h7m-7 7h7m26-14h7m-7 7h7m-7 7h7"/></>
      : id === 'parts' ? <><path d="M19 5h10l2 6 5 2 6-2 5 9-5 4v6l5 4-5 9-6-2-5 2-2 6H19l-2-6-5-2-6 2-5-9 5-4v-6l-5-4 5-9 6 2 5-2Z" transform="translate(0,-3) scale(.96)"/><circle cx="24" cy="24" r="8"/></>
      : <><path d="M24 4 42 12v14c0 10-7 17-18 20C13 43 6 36 6 26V12Z"/><path d="m15 25 6 6 12-13"/></>}
  </svg>;
}

function PublicDemoMapBackdrop() {
  // The public demonstration map is a bundled, immutable asset.
  // It is never replaced with text because of network quality.
  return <div className="public-map-static" role="img"
    aria-label="Утверждённая демонстрационная карта Санкт-Петербурга и Ленинградской области с условными отметками услуг; доступна без интернета" />;
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

// Do not lose the server's useful error when an SMS request is rejected.
// The request ID is diagnostic only: no phone, password or code is logged.
function authErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback;
  const requestId = error.data?.requestId;
  return error.message + (typeof requestId === 'string' && requestId ? ' · Код обращения: ' + requestId : '');
}

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
  const [desktopPublic, setDesktopPublic] = useState(() => window.matchMedia('(min-width: 900px)').matches);
  useEffect(() => { const q = window.matchMedia('(min-width: 900px)'); const update = () => setDesktopPublic(q.matches); q.addEventListener('change',update); return () => q.removeEventListener('change',update); }, []);
  const [phone, setPhone] = useState('+7 ');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [codeError, setCodeError] = useState('');
  const [codeStatus, setCodeStatus] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [role, setRole] = useState<JoinRole | null>(null);
  const [customerType, setCustomerType] = useState<'owner' | 'driver'>('owner');
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [hybridMasterService, setHybridMasterService] = useState(false);
  // A single vetted company may run both the mobile master and the fixed STO.
  // The two cabinets and their scopes stay separate; no extra public role card.
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

  const partnerAccountType = intent === 'join' && (role === 'master' || role === 'service') && hybridMasterService
    ? 'master_service' : role;
  async function sendCode() {
    if (busy) return;
    setCodeError('');
    const digits = phone.replace(/\D/g, '');
    if (digits.length !== 11 || !/^[78]/.test(digits)) {
      setCodeError('Введите номер полностью: +7 и 10 цифр.');
      return;
    }
    if (needAgree && !agree) {
      setCodeError('Для продолжения подтвердите согласие с условиями и обработкой данных.');
      return;
    }
    if (intent === 'join' && !role) {
      setCodeError('Выберите, кем хотите работать с TrakSOS.');
      return;
    }
    if (intent === 'join' && (role === 'master' || hybridMasterService) && specialties.length === 0) {
      setCodeError('Выберите хотя бы одну специализацию мастера.');
      return;
    }
    setInsurerOnly(false);
    setCodeStatus('Проверяем номер и отправляем SMS…');
    const r = await run(async () => {
      try {
        return await post('/api/auth/code', { phone, purpose: intent === 'reset' || intent === 'activate' ? 'reset' : 'register',
          accountType: intent === 'join' ? partnerAccountType : intent === 'register' || intent === 'help' ? customerType : undefined });
      } catch (e) {
        if (e instanceof ApiError && e.code === 'insurer_only') setInsurerOnly(true);
        setCodeError(authErrorMessage(e, 'Не удалось связаться с сервером. Проверьте интернет и повторите попытку.'));
        throw e;
      }
    }, null);
    setCodeStatus('');
    if (r?.sent === true) {
      setDevCode(r.devCode ?? null);
      setStep('code');
      setCodeError('');
    } else if (r) {
      setCodeError('Сервер не подтвердил отправку кода. Повторите попытку позже.');
    }
  }
  async function verify() {
    if (intent === 'join' && !role) return;
    if (intent === 'login') {
      if (loginBusy) return;
      setLoginError('');
      const digits = phone.replace(/\D/g, '');
      if (digits.length !== 11 || !/^[78]/.test(digits)) {
        setLoginError('Введите номер телефона полностью: +7 и 10 цифр.');
        return;
      }
      if (!password) {
        setLoginError('Введите пароль. Если забыли его, нажмите «Забыли пароль?».');
        return;
      }
      setLoginBusy(true);
      try {
        const login = await post('/api/auth/login', { phone, password, device: navigator.userAgent.slice(0, 200) });
        await signedIn(login);
      } catch (e) {
        setLoginError(authErrorMessage(e, 'Не удалось завершить вход. Проверьте соединение и повторите попытку.'));
      } finally {
        setLoginBusy(false);
      }
      return;
    }
    const r = await run(async () => {
      try {
        return await post('/api/auth/verify', { phone, code,
          role: intent === 'join' ? role : undefined,
          accountType: intent === 'join' ? partnerAccountType : intent === 'register' || intent === 'help' ? customerType : undefined,
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
      if (intent === 'join' && (role === 'master' || hybridMasterService)) {
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

  if (!intent && desktopPublic) return <OwnerDesktopHome20261120 />;

  if (!intent) return (
    <main className="public-home public-landing" id="public-home">
      <div className="public-landing-head">
        <span className="public-landing-region">◉ Санкт-Петербург и Ленинградская область</span>

      </div>

      <section className="public-hero public-brand-hero" aria-labelledby="public-main-title">
        <div className="public-hero-copy">
          <span className="public-eyebrow">{HERO_SLIDES[heroSlide].eyebrow}</span>
          <h1 id="public-main-title" key={'title-'+heroSlide}>
            {heroSlide === 0 ? <><em>Trak<b>SOS</b></em> —<br/>помощь в пути</>
            : heroSlide === 1 ? <>Эвакуация грузовиков<br/>и помощь в пути<br/>с <em>Trak<b>SOS</b></em></>
            : <>Ремонт и запись в СТО<br/>для грузового транспорта<br/>с <em>Trak<b>SOS</b></em></>}
          </h1>
          <p key={'description-'+heroSlide}>{HERO_SLIDES[heroSlide].description}</p>
          <div className="public-track-benefits" aria-label="Преимущества TrakSOS">
            <span><i aria-hidden="true">ϟ</i>Быстрое обращение</span>
            <span><i aria-hidden="true">✓</i>Проверка исполнителей</span>
            <span><i aria-hidden="true">⌖</i>Санкт-Петербург и Ленобласть</span>
            <span><i aria-hidden="true">▤</i>Работа с юрлицами</span>
          </div>
          <div className="public-actions">
            <button type="button" className="public-button public-button-sos"
              onClick={() => heroSlide === 0 ? go('register') : go(heroSlide === 1 ? 'explore/tow' : 'explore/sto')}>
              {heroSlide === 0 ? 'Зарегистрироваться' : heroSlide === 1 ? 'Узнать об эвакуации' : 'Узнать о СТО'}
            </button>
            <a className="public-button public-button-outline" href="#/explore/guide">Как это работает</a>
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
            {PUBLIC_HOME_TILES.map(({id,title,hint,href}) => (
              <a href={href} className={'public-service-tile public-service-' + id}
                key={id}>
                <span className="public-service-icon" aria-hidden="true"><PublicTileIcon id={id}/></span>
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
            <img className="public-app-phone-truck" src="/icon-192.png" alt="" loading="lazy" />
            <span>Помощь грузовику<br/>в дороге</span>
          </div>
          <p>Заявки, специалисты, документы и связь с мастером — в одном приложении.</p>
          <span className="public-rustore-soon">Скоро в RuStore</span>
          <small>Ссылка на скачивание появится после публикации приложения.</small>
        </aside>}
      </div>

      <section className="public-why-strip" aria-label="Преимущества сервиса">
        <article className="public-benefit public-benefit-community"><span className="public-benefit-icon">
          <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M24 4 41 11v12c0 12-7 18-17 22C14 41 7 35 7 23V11Z" />
            <path d="m15 24 6 6 12-13"/>
          </svg></span><b>Надёжное сообщество</b><small>Реальный опыт, поддержка коллег и проверенные решения</small></article>
        <article className="public-benefit public-benefit-speed"><span className="public-benefit-icon">
          <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M27 3 8 27h15l-3 18 20-25H25Z"/>
          </svg></span><b>Быстрая помощь</b><small>Оперативные ответы и конкретные действия в любой ситуации</small></article>
        <article className="public-benefit public-benefit-unified"><span className="public-benefit-icon">
          <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m24 4 19 11-19 11L5 15Z"/><path d="m5 23 19 11 19-11M5 32l19 11 19-11"/>
          </svg></span><b>Всё в одном месте</b><small>Сервисы, инструменты и контакты для работы с грузовой техникой</small></article>
      </section>
      <div className="public-track-extras">
        <button type="button" className="public-track-insurance" onClick={() => { rememberGuestService('insurance'); go('register'); }}>
          
          <span><b>Страхование грузового транспорта</b>
          <small>ОСАГО, КАСКО, груз, ответственность — заявка через TrakSOS</small></span>
          <strong>Оформить заявку →</strong>
        </button>
        <div className="public-track-extras-grid">
          <a href="#/explore/parts" className="public-track-extra public-track-parts" onClick={() => rememberGuestService('parts')}>
            <b>Запчасти</b><small>Оригиналы и проверенные аналоги</small><span aria-hidden="true">›</span>
          </a>
          <a href="#/explore/inspection" className="public-track-extra public-track-inspection" onClick={() => rememberGuestService('inspection')}>
            <b>Техосмотр</b><small>Информация и доступные варианты</small><span aria-hidden="true">›</span>
          </a>
          <a href="#/explore/tech" className="public-track-extra public-track-techbase">
            <b>ТехБаза</b><small>Коды ошибок, схемы и проверенные технические источники</small><span aria-hidden="true">›</span>
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
            <a className="public-map-static-link" href="https://yandex.ru/maps/2/saint-petersburg/?ll=30.314130%2C59.938630&z=10"
              target="_blank" rel="noopener noreferrer" aria-label="Открыть этот район в Яндекс Картах">
              <PublicDemoMapBackdrop />
            </a>
          </div>
          <a className="public-map-open-link" href="https://yandex.ru/maps/2/saint-petersburg/?ll=30.314130%2C59.938630&z=10"
            target="_blank" rel="noopener noreferrer">Открыть в Яндекс Картах ↗</a>
          <div className="public-map-legend"><span><i className="service"/>СТО</span><span><i className="master"/>Мастер</span><span><i className="tow"/>Эвакуация</span></div>
          <p className="public-demo-warning"><strong>Пример расположения услуг.</strong> Значки условные: это не реальные исполнители и не их доступность. Нажмите на карту, чтобы открыть Санкт-Петербург в Яндекс Картах.</p>
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
          <button className="btn" disabled={loginBusy}>{loginBusy ? 'Входим…' : 'Войти'}</button>
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
            {(role === 'master' || role === 'service') && <label className="agree guest-partner-hybrid">
              <input type="checkbox" checked={hybridMasterService} onChange={event=>setHybridMasterService(event.target.checked)}/>
              <span><b>Работаю и выездным мастером, и в своей СТО</b> — открыть оба кабинета, профиль работ и режим работы каждого отдельно</span>
            </label>}
            {(role === 'master' || (role === 'service' && hybridMasterService)) && <details className="guest-master-specialties" open={specialtiesOpen}>
              <summary onClick={event => { event.preventDefault(); setSpecialtiesOpen(v => !v); }}>
                Специализации выездного мастера · выбрано: {specialties.length} <span aria-hidden="true">⌄</span>
              </summary>
              <span className="label">Можно выбрать несколько вариантов</span>
              <div className="guest-master-specialties-grid">
                {MASTER_SPECIALTIES.map(item => <button key={item.id} type="button" className="seg"
                  aria-pressed={specialties.includes(item.id)}
                  onClick={() => setSpecialties(current => current.includes(item.id)
                    ? current.filter(id => id !== item.id) : [...current,item.id])}>{item.name}</button>)}
              </div>
            </details>}
          </div>}
          <Field label="Телефон">
            <input className="field" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => { setPhone(e.target.value); setInsurerOnly(false); setCodeError(''); }} />
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
          {codeError && <div className="card" role="alert" style={{ borderColor: 'var(--danger, #e25b69)' }}>{codeError}</div>}
          {codeStatus && <div className="note" role="status">{codeStatus}</div>}
          <button className="btn" disabled={busy}>{busy ? 'Отправляем…' : 'Получить код'}</button>
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
