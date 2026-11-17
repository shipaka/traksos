import './styles.css';
import './reducedMotion.css';
if (localStorage.getItem('traksos.reduceMotion') === '1') document.documentElement.classList.add('traksos-reduced-motion');
import './cabinetPremium.css';
import './trackVisual.css';
import './trackPolish.css';
import './trackSearch.css';
import './trackReference.css';
import './trackPhotos.css';
import './trackMatch.css';
import './trackScenic.css';
import './clientDashboardLatest.css';
import './premiumVehiclePolish.css';
import './finalCanon.css';
// Insurance-only refinement follows the approved global visual canon.
import './insurancePremiumStates.css';
import { createRoot } from 'react-dom/client';
import { Component, useCallback, useEffect, useRef, useState } from 'react';
import { get, post, getToken, connectWs, API_URL, onEvent, ApiError } from './api.ts';
import { MeCtx, ToastProvider, useRoute, useToast, type Me } from './ui.tsx';
import { native } from './native.ts';
import { Login } from './screens/login.tsx';
import { GuestExplore } from './screens/guestExplore.tsx';
import { DemoPreviewGate } from './screens/demoPreview.tsx';
import { SandboxEnter, SandboxModeBar } from './screens/isolatedSandbox.tsx';
import { GuestCompany, GuestOffers } from './screens/guestInfo.tsx';
import { TOP_CATALOGUE, SERVICE_TILES, CATALOGUE, rememberGuestService } from './guestCatalog.ts';
import { SiteQuickSearch } from './screens/siteQuickSearch.tsx';
import { Invite } from './screens/invite.tsx';
import { PerformerHub, ScheduleSection, AboutSection, PhoneSection, CarsSection, TaxSection, MoneySection, FilterSection, LevelSection } from './screens/performerCabinet.tsx';
import { Consult, Home, Sos, NewOrder, Orders, Garage, Profile, logout } from './screens/client.tsx';
import { Order } from './screens/order.tsx';
import { Work,  IncomingCall } from './screens/performer.tsx';
import { EcuDesk } from './screens/ecuDesk.tsx';
import { Admin } from './screens/admin.tsx';
import { Documents } from './screens/documents.tsx';
import { OfferGate, OfferPage } from './screens/offers.tsx';
import { AdminUser } from './screens/adminUser.tsx';
import { BaseHome, BaseCar, BaseSetup, BaseMoney, AdminServicePayouts, ServicesList, CenterPage, BookForm, BookingPage } from './screens/base.tsx';
import { Fleet, QrJoin } from './screens/fleet.tsx';
import { Help } from './screens/help.tsx';
import { Rules } from './screens/rules.tsx';
import { Shop, ShopCart, ShopHistory } from './screens/shop.tsx';
import { DriverAir } from './screens/driverAir.tsx';
import { TechnicalBase } from './screens/technicalBase.tsx';
import { OrderTechBase } from './screens/orderTechBase.tsx';
import { PartnerLevelView, PartnerLevelAdmin } from './screens/partnerLevel.tsx';
import { CourierHome } from './screens/courier.tsx';
import { CourierAdmin } from './screens/courierAdmin.tsx';
import { Privacy } from './screens/privacy.tsx';
import { ModCase, Appeal, MyReviews } from './screens/moderation.tsx';
import { ModeratorDesk } from './screens/moderatorDesk.tsx';
import { AdminTestCenter } from './screens/adminTestCenter.tsx';
import { ServicePreviewBar,ServicePreviewPage } from './screens/servicePreview.tsx';
import { SupportList, SupportNew, SupportThread, Notifications, useUnread } from './screens/support.tsx';
import { InsurerCabinet } from './screens/insurer.tsx';
import { InsuranceApplication,InsuranceThread } from './screens/insuranceFlow.tsx';

/** Last-resort screen protection: a broken widget must not produce a blank website. */
class ScreenErrorBoundary extends Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) {
    console.error('[TrakSOS] Section failed to render:', error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="app">
      <main className="stack" style={{ padding: 24, maxWidth: 640, margin: '40px auto' }}>
        <h1>Не удалось открыть раздел</h1>
        <p className="sub">Возникла ошибка отображения. Ваши данные не удалены. Можно вернуться на главную или обновить страницу.</p>
        <div className="row">
          <a className="btn" href="#/" onClick={() => { this.setState({ failed: false }); }}>На главную</a>
          <button className="btn ghost" type="button" onClick={() => location.reload()}>Обновить страницу</button>
        </div>
      </main>
    </div>;
  }
}

type Mode = 'client' | 'performer' | 'admin' | 'moderator' | 'service' | 'insurer' | 'inspection' | 'courier';
const PERFORMER_ROLES = ['master', 'tow', 'service'];

/** Consistent vector icons for the same mobile navigation on web and Android WebView. */
function NavGlyph({ glyph }: { glyph: string }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {glyph === '⌂' ? <><path d="m3 10 9-7 9 7v10H3z" /><path d="M9 20v-7h6v7" /></>
    : glyph === '☷' || glyph === '☰' ? <><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h1M3 12h1M3 18h1" /></>
    : glyph === '✚' || glyph === '＋' ? <><circle cx="12" cy="12" r="9" /><path d="M12 7v10M7 12h10" /></>
    : glyph === '⚙' ? <><circle cx="12" cy="12" r="3.1" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9 7 7m10 10 2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" /></>
    : glyph === '◉' ? <><circle cx="12" cy="8" r="3.5" /><path d="M4.5 20c.8-3.6 3.4-5.4 7.5-5.4s6.7 1.8 7.5 5.4" /><circle cx="12" cy="12" r="10" opacity=".4" /></>
    : glyph === '▣' ? <><rect x="6" y="3" width="12" height="18" rx="2" /><path d="M9 8h6M9 12h6m-6 4h4" /></>
    : glyph === '▦' ? <><rect x="3" y="3" width="8" height="8" rx="1" /><rect x="13" y="3" width="8" height="8" rx="1" /><rect x="3" y="13" width="8" height="8" rx="1" /><rect x="13" y="13" width="8" height="8" rx="1" /></>
    : glyph === '▤' ? <><path d="M4 21V6l8-4 8 4v15M2 21h20" /><path d="M8 9h2m4 0h2M8 13h2m4 0h2M10 21v-4h4v4" /></>
    : glyph === '⚑' ? <><path d="M5 22V3m0 1c5-3 9 3 15 0v11c-6 3-10-3-15 0" /></>
    : glyph === '⚡' ? <path d="M13 2 4 13h7l-1 9 10-12h-7z" />
    : glyph === '🛍' ? <><path d="M4 8h16l-1.5 13h-13z" /><path d="M9 9V6a3 3 0 0 1 6 0v3" /></>
    : glyph === '?' ? <><circle cx="12" cy="12" r="10" /><path d="M9 9a3 3 0 0 1 6 1c0 2-3 2-3 4m0 3h.01" /></>
    : glyph === '◇' ? <><path d="m12 2 8 4v6c0 5-3.7 8-8 10-4.3-2-8-5-8-10V6z" /><path d="m8 12 2.5 2.5L16 9" /></>
    : glyph === '₽' ? <><path d="M7 21V3h6a5 5 0 0 1 0 10H7M4 17h12" /></>
    : <circle cx="12" cy="12" r="4" />}
  </svg>;
}


function App() {
  const route = useRoute();
  const toast = useToast();
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setModeState] = useState<Mode>(() => (localStorageGet('traksos.mode') as Mode) || 'client');
  const setMode = (m: Mode) => { setModeState(m); localStorageSet('traksos.mode', m); };

  const reload = useCallback(async () => {
    if (!getToken()) {
      try { localStorage.removeItem('traksos.offlineIdentity'); } catch { /* */ }
      setMe(null); setReady(true); return;
    }
    try {
      const m = await get<Me>('/api/me');
      setMe(m);
      // Store only a minimal identity for read-only UI navigation without a network;
      // NEVER persist orders, chat, document images or the user's personal profile.
      try {
        localStorage.setItem('traksos.offlineIdentity', JSON.stringify({
          id: m.id, roles: m.roles, owner_id: m.owner_id, at: Date.now()
        }));
      } catch { /* private mode */ }
      // Первый вход исполнителя — сразу его кабинет
      if (!localStorageGet('traksos.mode') && m.roles.some((r) => PERFORMER_ROLES.includes(r)) && !m.roles.includes('client')) setMode(m.roles.includes('service') && !m.roles.some((r) => r === 'master' || r === 'tow') ? 'service' : 'performer');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'network' && getToken()) {
        try {
          const identity = JSON.parse(localStorage.getItem('traksos.offlineIdentity') ?? 'null');
          if (identity && typeof identity.id === 'string' &&
              Array.isArray(identity.roles) && Date.now() - identity.at < 24 * 60 * 60 * 1000) {
            setMe({ id: identity.id, roles: identity.roles, owner_id: identity.owner_id ?? null,
              phone: '', name: null, company_name: null, company_inn: null,
              rating: null, rating_count: 0, performer: null });
          } else setMe(null);
        } catch { setMe(null); }
      } else {
        // 401/403: an expired or forbidden session must not use an old identity.
        try { localStorage.removeItem('traksos.offlineIdentity'); } catch { /* */ }
        setMe(null);
      }
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    // Refresh the role/profile when the device reconnects or returns to foreground.
    // Live orders are always re-read from the API; no mutation is queued offline.
    const refresh = () => { if (getToken()) reload(); };
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [reload]);
  // #/as/client, #/as/performer, #/as/admin — переключить кабинет и открыть его главную
  useEffect(() => {
    const [x, m] = route;
    if (x !== 'as') return;
    if (m === 'client' || m === 'performer' || m === 'admin' || m === 'moderator' || m === 'service' || m === 'insurer' || m === 'inspection' || m === 'courier') setMode(m);
    location.replace('#/' + (m === 'performer' ? 'work' : m === 'admin' ? 'admin' : m === 'moderator' ? 'moderation' : m === 'service' ? 'base' : m === 'insurer' ? 'insurance' : m === 'inspection' ? 'inspections' : m === 'courier' ? 'courier' : ''));
  }, [route.join('/')]); // eslint-disable-line
  const activeSessionToken = getToken();
  useEffect(() => {
    if (!ready) return; // Keep the native token until the initial auth check finishes.
    if (!me) {
      // Logout/revoked session must also clear the token held by the Android native bridge.
      native.setSession(API_URL || location.origin, null);
      return;
    }
    connectWs();
    // A sandbox role must never be linked to the device's production push token.
    if (sessionStorage.getItem('traksos.sandboxMode') === '1') return;
    native.setSession(API_URL || location.origin, getToken());
    native.registerPush((token) => post('/api/me/push-token', { provider: 'rustore', token }));
  }, [ready, me?.id, activeSessionToken]); // eslint-disable-line
  const modeRef = useRef(mode);
  modeRef.current = mode;
  useEffect(() => onEvent((e) => {
    if (e.type === 'verification') { toast(e.decision === 'approved' ? 'Проверка пройдена — выходите на линию' : 'Проверка не пройдена'); reload(); }
    // Админ поменял цену, бонусы или баланс — профиль обновляется сам, без перезагрузки
    if (e.type === 'pricing' || e.type === 'balance' || e.type === 'line_status') reload();
    if (e.type === 'order' && e.status === 'accepted' && modeRef.current !== 'performer' && !location.hash.startsWith('#/work')) toast('Исполнитель найден');
  }), [reload, toast]);

  if (!ready) return <div className="traksos-start-loading" role="status" aria-label="Загрузка"><span className="traksos-start-loading-line" aria-hidden="true" /></div>;
  // Handoff takes place on the separate sandbox origin. The ticket is not a
  // production login and never reaches normal application API endpoints.
  if (route[0] === 'sandbox-enter') return <SandboxEnter />;

  // Ссылка-приглашение: запоминаем код, вход — как обычно
  if (route[0] === 'r' && route[1]) { try { localStorage.setItem('traksos.ref', route[1].toUpperCase()); } catch { /* */ } }
  if (!me) {
    return (
      <MeCtx.Provider value={{ me: null, reload, mode: 'client', setMode }}>
        <Shell mode="client" me={null}>{(route[0] === 'admin' && route[1] === 'test-center') || route[0] === 'preview' ? <DemoPreviewGate roleId={route[0]==='admin' ? route[2] : undefined} /> : route[0] === 'offer' ? <OfferPage audience={route[1] ?? 'client'} /> : route[0] === 'qr' && route[1] ? <QrJoin code={route[1]} /> : route[0] === 'rules' ? <Rules /> : route[0] === 'help' ? <Help /> : route[0] === 'explore' ? <GuestExplore id={route[1] || ''} itemKey={route[2]} /> : route[0] === 'company' ? <GuestCompany /> : route[0] === 'offers' ? <GuestOffers /> : <>{route[0] === 'r' && <div className="banner good" style={{ margin: '12px 16px 0' }}><span>Вас пригласили в TrakSOS — после входа на счёт придут подарочные баллы.</span></div>}<Login key={route[0] ?? 'public'} entry={route[0] === 'login' ? 'login' : route[0] === 'register' ? 'register' : route[0] === 'join' ? 'join' : route[0] === 'activate' ? 'activate' : undefined} /></>}</Shell>
      </MeCtx.Provider>
    );
  }

  const [a, b] = route;
  if (a === 'as') return null;
  const isPerformer = me.roles.some((r) => r === 'master' || r === 'tow');
  const isCustomer = me.roles.some((r) => r === 'client' || r === 'driver');
  const isCourier = me.roles.includes('courier');
  const isAdmin = me.roles.includes('admin');
  const serviceSandbox = isAdmin && a === 'admin' && b === 'test-center' && route[2] === 'service' && route.length > 3;
  const isModerator = me.roles.includes('moderator') || isAdmin;
  const isStaff = isModerator;
  const isService = me.roles.includes('service');
  const isInsurer = me.roles.includes('insurer');
  const isInspection = me.roles.includes('inspection_operator');
  // A saved/forced mode must never expose navigation for a role the account lacks.
  const fallback: Mode = isCourier ? 'courier' : isInsurer ? 'insurer' : isInspection ? 'inspection'
    : isCustomer ? 'client' : isPerformer ? 'performer'
    : isService ? 'service' : isAdmin ? 'admin' : isModerator ? 'moderator' : 'client';
  const permitted = mode === 'courier' ? isCourier : mode === 'insurer' ? isInsurer : mode === 'inspection' ? isInspection : mode === 'admin' ? isAdmin : mode === 'moderator' ? isModerator
    : mode === 'performer' ? isPerformer : mode === 'service' ? isService
    : isCustomer || isStaff;
  const allowedMode: Mode = permitted ? mode : fallback;
  const effMode: Mode = serviceSandbox ? 'service' : a === 'courier' && isCourier ? 'courier' : a === 'work' && isPerformer ? 'performer'
    : a === 'admin' && isAdmin ? 'admin' : a === 'moderation' && isModerator ? 'moderator'
    : a === 'base' && isService ? 'service' : a === 'insurance' && isInsurer ? 'insurer' : a === 'inspections' && (isInspection||isInsurer) ? 'inspection' : allowedMode;

  let screen;
  switch (a) {
    case undefined: screen = effMode === 'courier' ? <CourierHome /> : effMode === 'insurer' ? <InsurerCabinet /> : effMode === 'inspection' ? <InsurerCabinet inspectionOnly /> : effMode === 'service' ? <BaseHome /> : effMode === 'performer' ? (me.performer?.kind === 'ecu' ? <EcuDesk /> : <Work />) : effMode === 'admin' && isAdmin ? <Admin /> : effMode === 'moderator' && isModerator ? <ModeratorDesk /> : <Home />; break;
    case 'login': screen = <Home />; break;
    case 'sos': screen = isCustomer ? <Sos /> : <main><div className="empty">Для вызова SOS нужен клиентский аккаунт</div></main>; break;
    case 'new': screen = !isCustomer ? <main><div className="empty">Для заказа нужен клиентский аккаунт</div></main> : b === 'consult' ? <Consult /> : <NewOrder service={b ?? 'electric'} />; break;
    case 'order': screen = <Order id={b} />; break;
    case 'orders': screen = isCustomer ? <Orders as="client" /> : <main><div className="empty">Нет доступа к клиентским заявкам</div></main>; break;
    case 'garage': screen = isCustomer ? <Garage /> : <main><div className="empty">Нет доступа к гаражу</div></main>; break;
    case 'courier': screen = b==='admin' && isAdmin ? <CourierAdmin /> : isCourier ? <CourierHome /> : <main><div className="empty">Кабинет доступен только курьерам, которых назначил администратор.</div></main>; break;
    case 'air': screen = me.roles.some(r=>r==='driver'||r==='client') ? <DriverAir /> : <main><div className="empty">Водительский Эфир доступен водителям и владельцам транспорта.</div></main>; break;
    case 'partner': screen = b==='admin' && isAdmin ? <PartnerLevelAdmin /> : (isPerformer||isService) ? <PartnerLevelView /> : <main><div className="empty">Партнёрская программа только для специалистов.</div></main>; break;
    case 'techbase': screen = me.roles.some(r => ['master','tow','service','admin'].includes(r))
      ? b==='order' && route[2] ? <OrderTechBase orderId={route[2]}/> : <TechnicalBase />
      : <main><div className="empty">ТехБаза доступна только подтверждённым специалистам.</div></main>; break;
    case 'profile': screen = <Profile />; break;
    case 'invite': screen = <Invite />; break;
    case 'r': screen = <Invite />; break;
    case 'work':
      if (!isPerformer) { screen = <Home />; break; }
      screen = !me.performer || b === 'profile' || (b === 'me' && !route[2]) ? <PerformerHub />
        : b === 'me' ? ({ about: <AboutSection />, phone: <PhoneSection />, schedule: <ScheduleSection />, cars: <CarsSection />, tax: <TaxSection />, money: <MoneySection />, level: <LevelSection /> } as Record<string, JSX.Element>)[route[2]] ?? <PerformerHub />
        : b === 'filter' ? <FilterSection /> : b === 'jobs' ? <Orders as="performer" /> : b === 'docs' ? <Documents /> : me.performer?.kind === 'ecu' ? <EcuDesk /> : <Work />;
      break;
    case 'base': screen = !isService ? <Home /> : b === 'car' && route[2] ? <BaseCar id={route[2]} /> : b === 'me' ? <BaseSetup /> : b === 'money' ? <BaseMoney /> : <BaseHome />; break;
    case 'services': screen = b && route[2] === 'book' ? <BookForm id={b} /> : b ? <CenterPage id={b} /> : <ServicesList />; break;
    case 'booking': screen = <BookingPage id={b} />; break;
    case 'fleet': screen = isCustomer && !me.owner_id && !me.roles.includes('driver') ? <Fleet /> : <main><div className="empty">Парком управляет владелец</div></main>; break;
    case 'inspections': screen = isInspection || isInsurer ? <InsurerCabinet inspectionOnly /> : <Home />; break;
    case 'insurance': screen = b === 'request' ? (route[2] === 'new' ? <InsuranceApplication vehicleId={route[3]??''} /> : <InsuranceThread requestId={route[2]??''} />) : isInsurer ? <InsurerCabinet /> : <main><div className="empty">Нет доступа к кабинету страховщика</div></main>; break;
    case 'help': screen = <Help />; break;
    case 'rules': screen = <Rules />; break;
    case 'shop': screen = ((effMode === 'client' && isCustomer) || (effMode === 'performer' && isPerformer) || (effMode === 'service' && isService))
      ? (b === 'cart' ? <ShopCart /> : b === 'history' ? <ShopHistory vehicleId={route[2]} /> : <Shop />)
      : <main><div className="empty">Магазин доступен в клиентском кабинете или кабинете исполнителя.</div></main>; break;
    case 'privacy': screen = <Privacy />; break;
    case 'qr': screen = <QrJoin code={b} />; break;
    case 'appeal': screen = <Appeal />; break;
    case 'reviews': screen = <MyReviews />; break;
    case 'admin': screen = !isStaff ? <Home /> : b === 'case' && route[2] ? <ModCase id={route[2]} /> : !isAdmin ? <ModeratorDesk /> : b === 'test-center' ? (serviceSandbox ? <ServicePreviewPage section={route[3]} sub={route[4]} id={route[5]} /> : <AdminTestCenter roleId={route[2]} fullFidelity />) : b === 'user' && route[2] ? <AdminUser id={route[2]} /> : <Admin key={b === 'section' ? route[2] : 'summary'} initialSection={b === 'section' ? route[2] : undefined} />; break;
    case 'moderation': screen = isModerator ? <ModeratorDesk /> : <Home />; break;
    case 'offer': screen = <OfferPage audience={b ?? 'client'} />; break;
    case 'support': screen = b === 'new' ? <SupportNew /> : b ? <SupportThread id={b} /> : <SupportList />; break;
    case 'notifications': screen = <Notifications />; break;
    default: screen = <main><div className="empty">Такой страницы нет</div></main>;
  }

  return (
    <MeCtx.Provider value={{ me, reload, mode: effMode, setMode }}>
      <ScreenErrorBoundary key={route.join('/')}>
        <SandboxModeBar />
        {serviceSandbox && <ServicePreviewBar />}
        <Shell mode={effMode} me={serviceSandbox ? {...me,roles:['service'],name:'Тестовый сервис'} : me}>{screen}</Shell>
        {!(a === 'admin' && b === 'test-center' && isAdmin) && <IncomingCall />}
        {!(a === 'admin' && b === 'test-center' && isAdmin) && <OfferGate />}
      </ScreenErrorBoundary>
    </MeCtx.Provider>
  );
}

function Shell({ mode, me, children }: { mode: Mode; me: Me | null; children: React.ReactNode }) {
  const route = useRoute();
  const [openGuestGroup, setOpenGuestGroup] = useState<string | null>(null);
  const [mobileCatalogOpen, setMobileCatalogOpen] = useState(false);
  const [mobileGroupOpen, setMobileGroupOpen] = useState<string | null>(null);
  const isAuthEntry = !me && ['login', 'register', 'join', 'reset', 'activate'].includes(route[0] ?? '');
  useEffect(() => {
    setOpenGuestGroup(null);
    setMobileCatalogOpen(false);
    setMobileGroupOpen(null);
  }, [route.join('/')]);
  useEffect(() => {
    if (!openGuestGroup) return;
    const outside = (event: PointerEvent) => {
      if (!(event.target as Element | null)?.closest?.('.guest-site-nav .guest-nav-group'))
        setOpenGuestGroup(null);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [openGuestGroup]);
  // Guest demo is deliberately isolated from the public registration shell.
  // This preserves the one-time PIN flow and never grants an admin session.
  const isOperatorDemo = !me && (route[0] === 'preview' ||
    (route[0] === 'admin' && route[1] === 'test-center'));
  if (isOperatorDemo) return (
    <div className="app operator-demo-app">
      <header className="top">
        <span className="logo">Trak<b>SOS</b></span>
        <span className="operator-demo-badge">ТЕСТОВЫЙ РЕЖИМ</span>
      </header>
      <div className="operator-demo-content" style={{width:'100%', maxWidth:1440, margin:'0 auto'}}>
        {children}
      </div>
    </div>
  );
  const serviceSandbox = route[0]==='admin'&&route[1]==='test-center'&&route[2]==='service'&&route.length>3;
  const here = serviceSandbox ? '/'+(route.slice(3).join('/')||'base') : '/'+route.join('/');
  const sandboxHref=(href:string)=>serviceSandbox?'#/admin/test-center/service'+(href==='/base'||href.startsWith('/base/')?href:'/unavailable'):'#'+href;
  // На телефоне оставляем только рабочие действия. Все прежние маршруты
  // сохраняются через меню; компьютерная боковая навигация остаётся полной.
  const tabs: [string, string, string][] = !me ? [] : mode === 'courier'
    ? [['/courier','▣','Мои рейсы'],['/profile','◉','Аккаунт']]
    : mode === 'performer'
    ? [['/work', '⚡', 'Линия'], ['/work/jobs', '☰', 'Заявки'], ['/shop', '🛍', 'Магазин']]
    : mode === 'service'
      ? [['/base', '▤', 'Рембаза'], ['/support', '?', 'Связь'], ['/shop', '🛍', 'Магазин']]
    : mode === 'inspection'
      ? [['/inspections', '▣', 'Техосмотры'], ['/profile', '◉', 'Аккаунт']]
    : mode === 'insurer'
      ? [['/insurance', '▣', 'Рабочий стол'], ['/profile', '◉', 'Аккаунт']]
    : mode === 'moderator'
      ? [['/moderation', '▦', 'Рабочий стол'], ['/admin/section/queue', '⚑', 'Проверки'], ['/support', '?', 'Обращения']]
    : mode === 'admin'
      ? [['/admin', '▦', 'Рабочий стол'], ['/admin/section/orders', '☰', 'Заявки'], ['/admin/section/support', '?', 'Обращения']]
      : me.roles.includes('driver')
        ? [['/', '⌂', 'Главная'], ['/orders', '☷', 'Заявки'], ['/sos', '✚', 'Помощь'], ['/air', '◉', 'Эфир'], ['/profile', '◉', 'Профиль']]
        : [['/', '⌂', 'Главная'], ['/orders', '☷', 'Заявки'], ['/sos', '✚', 'Помощь'], ['/shop', '⚙', 'Запчасти'], ['/profile', '◉', 'Профиль']];
  // Все дополнительные функции доступны в шапке, даже когда они не в нижних вкладках.
  // Не показываем чужие роли и не создаём несуществующие страницы.
  const accountLinks: [string, string][] = mode === 'courier'
    ? [['/courier','Маршруты и посылки'],['/profile','Аккаунт']]
    : mode === 'performer'
    ? [...(me?.roles.includes('service') ? [['/base', 'Моя СТО — стационарный ремонт']] as [string, string][] : []),
       ['/work/me', 'Профиль исполнителя'], ['/work/me/about', 'Личные сведения'],
       ['/work/me/phone', 'Телефон и вход'], ['/work/me/cars', 'Автомобили'],
       ['/work/me/schedule', 'График работы'], ['/work/filter', 'Фильтры заявок'],
       ['/work/me/money', 'Финансы и выплаты'], ['/work/me/tax', 'Налоговый статус'],
       ['/work/me/level', 'Рейтинг и уровень'], ['/work/docs', 'Проверка и документы'],
       ['/reviews', 'Отзывы'], ['/invite', 'Пригласить партнёра'],
       ['/work/jobs', 'История заявок'], ['/partner', 'TrakSOS Партнёр · привилегии и обжалование'], ['/techbase', 'Профессиональная ТехБаза'], ['/profile', 'Аккаунт']]
    : mode === 'service'
      ? [...(me?.roles.some(r => r === 'master' || r === 'tow') ? [['/work', 'Выездной мастер — заявки']] as [string, string][] : []),
         ['/base', 'Заявки и история ремонтов'], ['/base/me', 'Карточка СТО'],
         ['/base/money', 'Финансы'], ['/partner', 'TrakSOS Партнёр'], ['/techbase', 'Профессиональная ТехБаза'], ['/profile', 'Аккаунт'],
         ['/invite', 'Пригласить партнёра']]
    : mode === 'inspection'
      ? [['/inspections', 'Кабинет техосмотра'], ['/profile', 'Аккаунт']]
    : mode === 'insurer'
      ? [['/insurance', 'Кабинет страхового партнёра'], ['/profile', 'Аккаунт']]
    : mode === 'moderator'
      ? [['/moderation', 'Очередь модерации'], ['/support', 'Поддержка'], ['/profile', 'Аккаунт']]
    : mode === 'admin'
      ? [['/admin/test-center', 'Тестирование всех кабинетов'],
         ['/admin/section/queue', 'Модерация — очередь'],
         ['/admin', 'Административная сводка'],
         ['/admin/section/orders', 'Все заявки'],
         ['/admin/section/search', 'Поиск людей и заявок'],
         ['/admin/section/people', 'Пользователи'],
         ['/admin/section/access', 'Регистрация и доступы'],
         ['/admin/section/verify', 'Проверка исполнителей'],
         ['/techbase', 'Проверка материалов ТехБазы'],
         ['/partner/admin', 'TrakSOS Партнёр · уровни и обращения'],
         ['/courier/admin', 'Курьерская доставка · маршруты и склад'],
         ['/admin/section/bases', 'СТО и рембазы'],
         ['/admin/section/payments', 'Деньги и выплаты'],
         ['/admin/section/stats', 'Статистика'],
         ['/admin/section/demand', 'Проблемные и невыполненные заявки'],
         ['/admin/section/announcements', 'Объявления и акции комиссии'],
         ['/admin/section/support', 'Обращения'],
         ['/admin/section/dispatch', 'Распределение заявок'],
         ['/admin/section/offers', 'Оферты площадки'],
         ['/admin/section/flagged', 'Подозрительные действия'],
         ['/admin/section/settings', 'Настройки площадки'],
         ['/profile', 'Аккаунт'], ['/as/client', 'Кабинет клиента']]
    : [['/orders', 'История заявок'], ['/garage', 'Мой гараж'],
       ...(!me?.owner_id && !me?.roles.includes('driver') ? [['/fleet', 'Мой автопарк']] as [string,string][] : []),
       ['/services', 'СТО и запись'],
       ...(me?.roles.some(r=>r==='driver'||r==='client') ? [['/air', 'Водительский Эфир и личные чаты']] as [string,string][] : []),
       ...(me?.roles.includes('driver') ? [['/shop', 'Магазин запчастей']] as [string,string][] : []),
       ['/reviews', 'Мои отзывы'], ['/invite', 'Пригласить друга'],
       ['/profile', 'Профиль и настройки']];
  const helpLinks: [string, string][] = [
    ['/support', 'Поддержка'], ['/notifications', 'Уведомления'],
    ['/help', 'Помощь и подсказки'], ['/rules', 'Правила площадки'],
    ['/offer/' + (mode === 'performer' || mode === 'service' ? 'performer' : mode === 'insurer' ? 'privacy' : 'client'), mode === 'insurer' ? 'Документы и условия' : 'Оферта'],
    ['/offer/privacy', 'Политика персональных данных'],
    ['/privacy', 'Мои персональные данные']];
  return (
    <div className={`app ${me ? "role-"+mode : "guest-app"}`}>
      <header className="top">
        <span className="logo">Trak<b>SOS</b></span>
        {me && mode === 'client' && <nav className="track-top-shortcuts" aria-label="Быстрый доступ">
          <a href="#/">Главная</a><a href="#/orders">Заявки</a><a href="#/sos">Помощь в дороге</a><a href="#/air">Эфир</a><a href="#/shop">Запчасти</a>
        </nav>}
        {!me && !isAuthEntry && <nav className="guest-site-nav" aria-label="Разделы TrakSOS">
          {TOP_CATALOGUE.map(group => <details key={group.title} className="guest-nav-group"
            open={openGuestGroup === group.title}
            onMouseEnter={() => { if (window.matchMedia('(hover: hover)').matches && openGuestGroup && openGuestGroup !== group.title) setOpenGuestGroup(group.title); }}
            onMouseLeave={() => setOpenGuestGroup(current => current === group.title ? null : current)}
            onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpenGuestGroup(null); }}
            onKeyDown={event => { if (event.key === 'Escape') { setOpenGuestGroup(null); (event.currentTarget.querySelector('summary') as HTMLElement | null)?.focus(); event.preventDefault(); } }}>
            <summary aria-expanded={openGuestGroup === group.title}
              onClick={event => { event.preventDefault(); setOpenGuestGroup(current => current === group.title ? null : group.title); }}>
              {group.title}<span aria-hidden="true">⌄</span></summary>
            <div className="guest-nav-dropdown">
              {group.serviceIds.flatMap(id => (group.serviceIds.length > 1
                ? [{label: SERVICE_TILES.find(tile => tile.id === id)?.title || id, key: ''}]
                : CATALOGUE[id].services).map(item => (
                <a key={id + ':' + item.key}
                  href={'#/explore/' + id + (item.key ? '/' + item.key : '')}
                  onClick={() => { rememberGuestService(id, item.key || undefined); setOpenGuestGroup(null); }}>
                  {item.label}
                </a>
              )))}
              <span className="guest-nav-hint">{group.title === 'Запчасти' ? 'Магазин доступен после входа' : 'Описание и регистрация'}</span>
            </div>
          </details>)}
          <a href="#/join" className="guest-business-link">Для партнёров</a>
          <a href="#/login" className="guest-business-link">Сообщество</a>
          <a href="#/company" className="guest-business-link">Компания</a>
          <a href="#/offers" className="guest-business-link">Оферты</a>
        </nav>}
        {!me && isAuthEntry && <nav className="guest-auth-links" aria-label="О компании и документах">
          <a href="#/">Главная</a><a href="#/company">Компания</a>
          <a href="#/offers">Оферты</a><a href="#/offer/privacy">Документы</a>
        </nav>}
        {!me && !isAuthEntry && <details className="guest-mobile-catalog" open={mobileCatalogOpen}>
          <summary onClick={event => { event.preventDefault(); setMobileCatalogOpen(v => !v); setMobileGroupOpen(null); }}>
            Каталог услуг <span aria-hidden="true">⌄</span></summary>
          <nav aria-label="Каталог услуг TrakSOS">
            {TOP_CATALOGUE.map(group => <details key={group.title} open={mobileGroupOpen === group.title}>
              <summary onClick={event => { event.preventDefault(); setMobileGroupOpen(current => current === group.title ? null : group.title); }}>{group.title}</summary>
              <div>
                {group.serviceIds.flatMap(id => (group.serviceIds.length > 1
                  ? [{label: SERVICE_TILES.find(tile => tile.id === id)?.title || id, key: ''}]
                  : CATALOGUE[id].services).map(item => <a key={id + ':' + item.key}
                    href={'#/explore/' + id + (item.key ? '/' + item.key : '')}
                    onClick={() => { rememberGuestService(id, item.key || undefined); setMobileCatalogOpen(false); setMobileGroupOpen(null); }}>{item.label}</a>))}
              </div>
            </details>)}
            <a href="#/join" className="guest-mobile-business">Для партнёров · регистрация</a>
            <a href="#/company" className="guest-mobile-business">Компания</a>
            <a href="#/offers" className="guest-mobile-business">Оферты</a>
          </nav>
        </details>}
        {!isAuthEntry && <SiteQuickSearch authenticated={!!me} />}
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          {!me && !isAuthEntry && <div className="guest-header-actions"><a href="#/login">Войти</a><a href="#/register" className="register">Зарегистрироваться</a></div>}
          {me && mode === 'performer' && <span className="pill accent">исполнитель</span>}
          {me && mode === 'admin' && <span className="pill accent">админ</span>}
          {me && mode === 'moderator' && <span className="pill accent">модерация</span>}
          {me && mode === 'insurer' && <span className="pill accent">страхование</span>}
          {me && mode === 'service' && <span className="pill accent">рембаза</span>}
          {me && !serviceSandbox && me.roles.some(r => r === 'master' || r === 'tow') && me.roles.some(r => r === 'admin' || r === 'moderator') &&
            <nav className="cabinet-role-switch" aria-label="Режим кабинета">
              <a href="#/as/performer" aria-label="Выездной мастер" aria-current={mode === 'performer' ? 'page' : undefined}>Мастер</a>
              {me.roles.includes('admin')
                ? <a href="#/as/admin" aria-label="Администратор" aria-current={mode === 'admin' ? 'page' : undefined}>Админ</a>
                : <a href="#/as/moderator" aria-label="Модератор" aria-current={mode === 'moderator' ? 'page' : undefined}>Модер.</a>}
            </nav>}
          {me && !serviceSandbox && <a href="#/help" className="bell" aria-label="Справка">?</a>}
          {me && !serviceSandbox && <Bell />}
          {me && <details className="account-menu" key={here}>
            <summary aria-label="Открыть меню кабинета">☰ <span>Меню</span></summary>
            <nav aria-label="Все разделы кабинета">
              <span className="account-menu-heading">Мой кабинет</span>
              {accountLinks.map(([href, label]) => <a key={href} href={sandboxHref(href)}>{label}</a>)}
              <span className="account-menu-heading">Помощь и документы</span>
              {helpLinks.map(([href, label]) => <a key={href} href={sandboxHref(href)}>{label}</a>)}
              {!serviceSandbox && <button type="button" className="account-menu-logout" onClick={() => {
                if (me.roles.some(r => r === 'master' || r === 'tow') &&
                  !window.confirm('При выходе из аккаунта статус «На линии» отключится. Просто сверните приложение, если хотите продолжать получать заявки. Выйти?')) return;
                void logout();
              }}>Выйти из аккаунта</button>}
            </nav>
          </details>}
        </div>
      </header>
      <NetworkStatus />
      <div className="desktop-layout">
        <aside className="desktop-sidebar" aria-label="Навигация по сайту">
          <div className="desktop-sidebar-title">{me ? 'Рабочий кабинет' : isAuthEntry ? 'TrakSOS · вход и документы' : 'TrakSOS · помощь в дороге'}</div>
          <nav className="desktop-nav">
            {me ? <>
              {(mode === 'client'
                ? [['/', '⌂', 'Главная'], ['/orders', '☷', 'Заявки'], ['/sos', '✚', 'Помощь в дороге'], ['/shop', '⚙', 'Запчасти'], ['/garage', '▣', 'Мой транспорт'], ['/insurance/request/new', '◇', 'Страхование'], ['/services', '▤', 'Грузовые СТО']]
                : mode === 'performer'
                  ? [...tabs, ['/work/me', '◉', 'Профиль'], ...(me.roles.includes('service') ? [['/base', '▤', 'Моя СТО']] : [])]
                  : mode === 'service'
                    ? [...tabs, ['/base/money', '₽', 'Финансы'], ['/base/me', '⚙', 'Карточка'], ...(me.roles.some(r => r === 'master' || r === 'tow') ? [['/work', '⚡', 'Выездной мастер']] : []), ['/profile', '◉', 'Аккаунт']]
                    : mode === 'insurer' || mode === 'inspection'
                      ? tabs
                      : mode === 'moderator' ? [...tabs, ['/profile', '◉', 'Аккаунт']]
                      : [...tabs, ['/as/client', '⌂', 'Клиент'], ['/profile', '◉', 'Аккаунт']]).map(([href, ic, name]) => (
                <a key={href} href={sandboxHref(href)} className={`desktop-nav-link ${here === href || (href !== '/' && here.startsWith(href + '/')) ? 'active' : ''} ${href === '/sos' ? 'desktop-nav-sos' : ''}`}>
                  <span aria-hidden="true">{ic}</span><span>{name}</span>
                </a>
              ))}
              {mode === 'client' && <>
                <div className="desktop-sidebar-title desktop-nav-section">Мой кабинет</div>
                {([...(me && !me.owner_id && !me.roles.includes('driver') ? [['/fleet','▣','Мой парк']] as [string,string,string][] : []),['/support','?','Поддержка'],['/profile','◉','Профиль']] as [string,string,string][]).map(([href, ic, name]) => (
                  <a key={href} href={sandboxHref(href)} className={`desktop-nav-link ${here === href || here.startsWith(href + '/') ? 'active' : ''}`}>
                    <span aria-hidden="true">{ic}</span><span>{name}</span>
                  </a>
                ))}
              </>}
            </> : isAuthEntry ? <>
              <a className="desktop-nav-link" href="#/"><span>⌂</span><span>Главная</span></a>
              <a className="desktop-nav-link" href="#/company"><span>ⓘ</span><span>Компания</span></a>
              <a className="desktop-nav-link" href="#/offers"><span>▤</span><span>Оферты</span></a>
              <a className="desktop-nav-link" href="#/offer/privacy"><span>▣</span><span>Документы</span></a>
            </> : <>
              <a className="desktop-nav-link active" href="#/"><span>⌂</span><span>Главная</span></a>
              <a className="desktop-nav-link" href="#/explore/van"><span>⚒</span><span>Все услуги</span></a>
              <a className="desktop-nav-link" href="#/login"><span>◉</span><span>Войти</span></a>
              <a className="desktop-nav-link" href="#/register"><span>＋</span><span>Регистрация клиента</span></a>
              <a className="desktop-nav-link" href="#/join"><span>▣</span><span>Для партнёров</span></a>
              <a className="desktop-nav-link" href="#/company"><span>ⓘ</span><span>Компания</span></a>
              <a className="desktop-nav-link" href="#/offers"><span>▤</span><span>Оферты</span></a>
              <a className="desktop-nav-link" href="#/offer/privacy"><span>▣</span><span>Документы</span></a>
                        </>}
          </nav>
          {!me && <aside className="track-sidebar-app" aria-label="Мобильное приложение TrakSOS">
            <span className="track-sidebar-app-glow" aria-hidden="true" />
            <span className="track-sidebar-app-phone" aria-hidden="true">
              <img src="/tracksos-approved-scania-r520.webp" alt="" loading="lazy" />
              <small>TrakSOS</small>
            </span>
            <span className="track-sidebar-app-copy">
              <b>TrakSOS в телефоне</b>
              <small>Заявки и связь с мастером в одном месте</small>
              <span className="track-sidebar-app-soon">Скоро в RuStore</span>
            </span>
          </aside>}
          <div className="desktop-sidebar-bottom"><strong>TRAKSOS 24/7</strong><span>Помощь грузовикам</span><small>Единая платформа для всей России</small></div>
        </aside>
        <div className="desktop-content">
          {children}
          <SiteFooter />
        </div>
      </div>
      {!me && !route[0] && (
        <nav className="track-guest-tabbar" aria-label="Гостевая навигация TrakSOS">
          <a href="#/" className="active" aria-current="page"><span aria-hidden="true"><NavGlyph glyph="⌂" /></span>Главная</a>
          <a href="#/" onClick={e => { e.preventDefault(); document.getElementById('public-services')?.scrollIntoView({behavior:'smooth',block:'start'}); }}>
            <span aria-hidden="true"><NavGlyph glyph="▤" /></span>Услуги</a>
          <a href="#/login"><span aria-hidden="true"><NavGlyph glyph="◉" /></span>Войти</a>
          <a href="#/register"><span aria-hidden="true"><NavGlyph glyph="＋" /></span>Регистрация</a>
        </nav>
      )}
      {tabs.length > 0 && !(route[0] === 'work' && ['profile', 'docs'].includes(route[1] ?? '')) && !(route[0] === 'base' && route[1] === 'me') && (
        <nav className="tabbar">
          {tabs.map(([href, ic, name]) => (
            <a key={href} href={sandboxHref(href)} className={`${here === href || (href !== '/' && here.startsWith(href + '/') && href !== '/work' && href !== '/base') ? 'on' : ''} ${href === '/sos' ? 'sosTab' : ''}`}>
              {href === '/sos' ? <><span className="ic"><NavGlyph glyph="✚" /></span>{name}</> : <><span className="ic"><NavGlyph glyph={ic} /></span>{name}</>}
            </a>
          ))}
        </nav>
      )}
    </div>
  );
}

function NetworkStatus() {
  const [offline, setOffline] = useState(!navigator.onLine);
  useEffect(() => {
    const yes = () => setOffline(false);
    const no = () => setOffline(true);
    const fromApi = (e: Event) => setOffline(!(e as CustomEvent<{online: boolean}>).detail.online);
    window.addEventListener('online', yes);
    window.addEventListener('offline', no);
    window.addEventListener('traksos-connection', fromApi);
    return () => {
      window.removeEventListener('online', yes);
      window.removeEventListener('offline', no);
      window.removeEventListener('traksos-connection', fromApi);
    };
  }, []);
  if (!offline) return null;
  return <div className="traksos-connection-banner" role="status">
    Нет подключения. Интерфейс доступен, но новые заявки, сообщения и изменения требуют интернета.
  </div>;
}

/** Подвал: реквизиты площадки (их заполняет админ в «Настройках»), ссылки на документы; плашка про cookie — один раз */
let legalCache: Promise<any> | null = null;
function SiteFooter() {
  const [l, setL] = useState<any>(null);
  const [cookieOk, setCookieOk] = useState(() => { try { return localStorage.getItem('traksos.cookie') === '1'; } catch { return true; } });
  useEffect(() => { (legalCache ??= get('/api/legal').catch(() => null)).then(setL); }, []);
  const req = l ? [l.entity, l.inn && `ИНН ${l.inn}`, l.ogrn && `ОГРН ${l.ogrn}`].filter(Boolean).join(' · ') : '';
  const contacts = l ? [l.phone, l.email].filter(Boolean).join(' · ') : '';
  return (
    <footer className="site-footer">
      {!cookieOk && (
        <div className="banner col" role="note">
          <span className="note">Используем только необходимые cookie — чтобы вы оставались в аккаунте. Рекламных нет.</span>
          <button className="btn ghost small" onClick={() => { try { localStorage.setItem('traksos.cookie', '1'); } catch { /* */ } setCookieOk(true); }}>Понятно</button>
        </div>
      )}
      <span className="logo">Trak<b>SOS</b></span>
      <span className="note">{l?.tagline}</span>
      {req && <span className="note">{req}</span>}
      {l?.address && <span className="note">{l.address}</span>}
      {contacts && <span className="note">Поддержка: {contacts}</span>}
      <span className="row note" style={{ gap: 12 }}>
        <a href="#/company">Компания</a><a href="#/offers">Оферты</a><a href="#/offer/privacy">Персональные данные</a><a href="#/rules">Правила площадки</a>
      </span>
      <span className="note">© {new Date().getFullYear()} {l?.brand ?? 'TrakSOS'}</span>
    </footer>
  );
}

function Bell() {
  const n = useUnread();
  return (
    <a href="#/notifications" className="bell" aria-label={n ? `Уведомления: ${n} новых` : 'Уведомления'}>
      🔔{n > 0 && <span className="badge">{n > 99 ? '99+' : n}</span>}
    </a>
  );
}

function localStorageGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* */ } }

// PWA: cache only the public UI shell. Inside the Android APK the same assets
// are already bundled, and the browser service worker must not be installed.
if (!(window as any).TrakSOSNative && 'serviceWorker' in navigator &&
    (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // The site remains usable online if offline-cache initialization fails.
    });
  }, { once: true });
}

createRoot(document.getElementById('root')!).render(
  <ToastProvider><ScreenErrorBoundary><App /></ScreenErrorBoundary></ToastProvider>
);
