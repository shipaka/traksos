import './styles.css';
import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { get, post, getToken, connectWs, API_URL, onEvent } from './api.ts';
import { MeCtx, ToastProvider, useRoute, useToast, type Me } from './ui.tsx';
import { native } from './native.ts';
import { Login } from './screens/login.tsx';
import { Invite } from './screens/invite.tsx';
import { PerformerHub, ScheduleSection, AboutSection, PhoneSection, CarsSection, TaxSection, MoneySection, FilterSection, LevelSection } from './screens/performerCabinet.tsx';
import { Consult, Home, Sos, NewOrder, Orders, Garage, Profile } from './screens/client.tsx';
import { Order } from './screens/order.tsx';
import { Work,  IncomingCall } from './screens/performer.tsx';
import { Admin } from './screens/admin.tsx';
import { Documents } from './screens/documents.tsx';
import { OfferGate, OfferPage } from './screens/offers.tsx';
import { AdminUser } from './screens/adminUser.tsx';
import { BaseHome, BaseCar, BaseSetup, BaseMoney, AdminServicePayouts, ServicesList, CenterPage, BookForm, BookingPage } from './screens/base.tsx';
import { Fleet, FleetFinances, QrJoin } from './screens/fleet.tsx';
import { Help } from './screens/help.tsx';
import { InsurerCabinet } from './screens/insurer.tsx';
import { CommonMenu } from './screens/menu.tsx';
import { Rules } from './screens/rules.tsx';
import { Shop, ShopCart } from './screens/shop.tsx';
import { Privacy } from './screens/privacy.tsx';
import { ModCase, Appeal, MyReviews } from './screens/moderation.tsx';
import { SupportList, SupportNew, SupportThread, Notifications, useUnread } from './screens/support.tsx';

type Mode = 'client' | 'performer' | 'admin' | 'service' | 'insurer';
const PERFORMER_ROLES = ['master', 'tow', 'service'];

function App() {
  const route = useRoute();
  const toast = useToast();
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setModeState] = useState<Mode>(() => (localStorageGet('traksos.mode') as Mode) || 'client');
  const setMode = (m: Mode) => { setModeState(m); localStorageSet('traksos.mode', m); };

  const reload = useCallback(async () => {
    if (!getToken()) { setMe(null); setReady(true); return; }
    try {
      const m = await get<Me>('/api/me');
      setMe(m);
      // Первый вход исполнителя — сразу его кабинет
      if (m.roles.includes('insurer') && !m.roles.some((r) => r === 'admin' || r === 'moderator') && !m.roles.includes('client')) setMode('insurer');
      else if (!localStorageGet('traksos.mode') && m.roles.some((r) => PERFORMER_ROLES.includes(r)) && !m.roles.includes('client')) setMode(m.roles.includes('service') && !m.roles.some((r) => r === 'master' || r === 'tow') ? 'service' : 'performer');
    } catch {
      setMe(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);
  // #/as/client, #/as/performer, #/as/admin — переключить кабинет и открыть его главную
  useEffect(() => {
    const [x, m] = route;
    if (x !== 'as') return;
    if (m === 'client' || m === 'performer' || m === 'admin' || m === 'service' || m === 'insurer') setMode(m);
    location.replace('#/' + (m === 'performer' ? 'work' : m === 'admin' ? 'admin' : m === 'service' ? 'base' : m === 'insurer' ? 'insurer' : ''));
  }, [route.join('/')]); // eslint-disable-line
  useEffect(() => {
    if (!me) return;
    connectWs();
    native.setSession(API_URL || location.origin, getToken());
    native.registerPush((token) => post('/api/me/push-token', { provider: 'rustore', token }));
  }, [me?.id]); // eslint-disable-line
  const modeRef = useRef(mode);
  modeRef.current = mode;
  useEffect(() => onEvent((e) => {
    if (e.type === 'verification') { toast(e.decision === 'approved' ? 'Проверка пройдена — выходите на линию' : 'Проверка не пройдена'); reload(); }
    // Админ поменял цену, бонусы или баланс — профиль обновляется сам, без перезагрузки
    if (e.type === 'pricing' || e.type === 'balance' || e.type === 'line_status') reload();
    if (e.type === 'order' && e.status === 'accepted' && modeRef.current !== 'performer' && !location.hash.startsWith('#/work')) toast('Исполнитель найден');
  }), [reload, toast]);

  if (!ready) return null;
  // Ссылка-приглашение: запоминаем код, вход — как обычно
  if (route[0] === 'r' && route[1]) { try { localStorage.setItem('traksos.ref', route[1].toUpperCase()); } catch { /* */ } }
  if (!me) {
    return (
      <MeCtx.Provider value={{ me: null, reload, mode: 'client', setMode }}>
        <Shell mode="client" me={null}>{route[0] === 'offer' ? <OfferPage audience={route[1] ?? 'client'} /> : route[0] === 'qr' && route[1] ? <QrJoin code={route[1]} /> : route[0] === 'rules' ? <Rules /> : route[0] === 'help' ? <Help /> : <>{route[0] === 'r' && <div className="banner good" style={{ margin: '12px 16px 0' }}><span>Вас пригласили в ТракSOS — после входа на счёт придут подарочные баллы.</span></div>}<Login /></>}</Shell>
      </MeCtx.Provider>
    );
  }

  const [a, b] = route;
  if (a === 'as') return null;
  const isPerformer = me.roles.some((r) => PERFORMER_ROLES.includes(r));
  const isStaff = me.roles.some((r) => r === 'admin' || r === 'moderator');
  const isService = me.roles.includes('service');
  const isInsurer = me.roles.includes('insurer');
  const effMode: Mode = a === 'work' ? 'performer' : a === 'admin' ? 'admin' : a === 'base' ? 'service' : a === 'insurer' ? 'insurer' : (mode === 'performer' && !isPerformer) || (mode === 'service' && !isService) || (mode === 'insurer' && !isInsurer) ? 'client' : mode;

  let screen;
  switch (a) {
    case undefined: screen = effMode === 'service' ? <BaseHome /> : effMode === 'performer' ? <Work /> : effMode === 'admin' && isStaff ? <Admin /> : effMode === 'insurer' && isInsurer ? <InsurerCabinet /> : <Home />; break;
    case 'login': screen = <Home />; break;
    case 'sos': screen = <Sos />; break;
    case 'new': screen = b === 'consult' ? <Consult /> : <NewOrder service={b ?? 'electric'} />; break;
    case 'order': screen = <Order id={b} />; break;
    case 'orders': screen = <Orders as="client" />; break;
    case 'garage': screen = <Garage />; break;
    case 'profile': screen = <Profile />; break;
    case 'invite': screen = <Invite />; break;
    case 'r': screen = <Invite />; break;
    case 'work':
      screen = b === 'profile' || (b === 'me' && !route[2]) ? <PerformerHub />
        : b === 'me' ? ({ about: <AboutSection />, phone: <PhoneSection />, schedule: <ScheduleSection />, cars: <CarsSection />, tax: <TaxSection />, money: <MoneySection />, level: <LevelSection /> } as Record<string, JSX.Element>)[route[2]] ?? <PerformerHub />
        : b === 'filter' ? <FilterSection /> : b === 'jobs' ? <Orders as="performer" /> : b === 'docs' ? <Documents /> : <Work />;
      break;
    case 'base': screen = b === 'car' && route[2] ? <BaseCar id={route[2]} /> : b === 'me' ? <BaseSetup /> : b === 'money' ? <BaseMoney /> : <BaseHome />; break;
    case 'services': screen = b && route[2] === 'book' ? <BookForm id={b} /> : b ? <CenterPage id={b} /> : <ServicesList />; break;
    case 'booking': screen = <BookingPage id={b} />; break;
    case 'fleet': screen = b === 'finances' ? <FleetFinances /> : <Fleet />; break;
    case 'insurer': screen = isInsurer ? <InsurerCabinet /> : <main><div className="empty">Нет доступа к кабинету страховщика</div></main>; break;
    case 'help': screen = <Help />; break;
    case 'menu': screen = <CommonMenu />; break;
    case 'rules': screen = <Rules />; break;
    case 'shop': screen = b === 'cart' ? <ShopCart /> : <Shop />; break;
    case 'privacy': screen = <Privacy />; break;
    case 'qr': screen = <QrJoin code={b} />; break;
    case 'appeal': screen = <Appeal />; break;
    case 'reviews': screen = <MyReviews />; break;
    case 'admin': screen = !isStaff ? <Home /> : b === 'case' && route[2] ? <ModCase id={route[2]} /> : b === 'user' && route[2] ? <AdminUser id={route[2]} /> : <Admin />; break;
    case 'offer': screen = <OfferPage audience={b ?? 'client'} />; break;
    case 'support': screen = b === 'new' ? <SupportNew /> : b ? <SupportThread id={b} /> : <SupportList />; break;
    case 'notifications': screen = <Notifications />; break;
    default: screen = <main><div className="empty">Такой страницы нет</div></main>;
  }

  return (
    <MeCtx.Provider value={{ me, reload, mode: effMode, setMode }}>
      <Shell mode={effMode} me={me}>{screen}</Shell>
      <IncomingCall />
      <OfferGate />
    </MeCtx.Provider>
  );
}

function Shell({ mode, me, children }: { mode: Mode; me: Me | null; children: React.ReactNode }) {
  const route = useRoute();
  const here = '/' + route.join('/');
  const tabs: [string, string, string][] = !me ? [] : mode === 'performer'
    ? [['/work', '⚡', 'Линия'], ['/work/jobs', '☰', 'История'], ['/work/me', '◉', 'Профиль'], ['/menu', '☷', 'Меню']]
    : mode === 'service'
      ? [['/base', '▤', 'Рембаза'], ['/base/money', '₽', 'Финансы'], ['/base/me', '⚙', 'Карточка'], ['/support', '?', 'Поддержка'], ['/menu', '☷', 'Меню']]
    : mode === 'admin'
      ? [['/admin', '▦', 'Админ'], ['/as/client', '⌂', 'Клиент'], ['/menu', '☷', 'Меню']]
    : mode === 'insurer'
      ? [['/insurer', '▤', 'Заявки'], ['/support', '?', 'Помощь'], ['/menu', '☷', 'Меню']]
      : [['/', '🔧', 'Услуги'], ['/sos', '!', 'SOS'], ['/orders', '☰', 'Заявки'], ['/garage', '▭', 'Гараж'], ['/menu', '☷', 'Меню']];
  return (
    <div className="app">
      <header className="top">
        <span className="logo">Трак<b>SOS</b></span>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          {me && mode === 'performer' && <span className="pill accent">исполнитель</span>}
          {me && mode === 'admin' && <span className="pill accent">админ</span>}
          {me && mode === 'insurer' && <span className="pill accent">страховщик</span>}
          {me && mode === 'service' && <span className="pill accent">рембаза</span>}
          {me && mode === 'client' && !me.owner_id && <a href="#/fleet" className="pill" style={{ textDecoration: 'none' }}>Мой парк</a>}
          {me && <a href="#/help" className="bell" aria-label="Справка">?</a>}
          {me && <Bell />}
          {me && mode === 'client' && <a href="#/profile" className="bell" aria-label="Профиль">◉</a>}
        </div>
      </header>
      {children}
      <SiteFooter />
      {tabs.length > 0 && (
        <nav className="tabbar">
          {tabs.map(([href, ic, name]) => (
            <a key={href} href={'#' + href} className={`${here === href || (href !== '/' && here.startsWith(href + '/') && href !== '/work' && href !== '/base') ? 'on' : ''} ${href === '/sos' ? 'sosTab' : ''}`}>
              {href === '/sos' ? <span className="sosDot">SOS</span> : <><span className="ic">{ic}</span>{name}</>}
            </a>
          ))}
        </nav>
      )}
    </div>
  );
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
      <span className="logo">Трак<b>SOS</b></span>
      <span className="note">{l?.tagline}</span>
      {req && <span className="note">{req}</span>}
      {l?.address && <span className="note">{l.address}</span>}
      {contacts && <span className="note">Поддержка: {contacts}</span>}
      <span className="row note" style={{ gap: 12 }}>
        <a href="#/offer/client">Оферта</a><a href="#/offer/privacy">Персональные данные</a><a href="#/rules">Правила площадки</a>
      </span>
      <span className="note">© {new Date().getFullYear()} {l?.brand ?? 'ТракSOS'}</span>
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

createRoot(document.getElementById('root')!).render(<ToastProvider><App /></ToastProvider>);
