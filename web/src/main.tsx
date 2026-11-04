import './styles.css';
import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { get, post, getToken, connectWs, API_URL, onEvent } from './api.ts';
import { MeCtx, ToastProvider, useRoute, useToast, type Me } from './ui.tsx';
import { native } from './native.ts';
import { Login } from './screens/login.tsx';
import { Home, Sos, NewOrder, Orders, Garage, Profile } from './screens/client.tsx';
import { Order } from './screens/order.tsx';
import { Work, PerformerProfile, IncomingCall } from './screens/performer.tsx';
import { Admin } from './screens/admin.tsx';
import { Documents } from './screens/documents.tsx';
import { OfferGate, OfferPage } from './screens/offers.tsx';

type Mode = 'client' | 'performer' | 'admin';
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
      if (!localStorageGet('traksos.mode') && m.roles.some((r) => PERFORMER_ROLES.includes(r)) && !m.roles.includes('client')) setMode('performer');
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
    if (m === 'client' || m === 'performer' || m === 'admin') setMode(m);
    location.replace('#/' + (m === 'performer' ? 'work' : m === 'admin' ? 'admin' : ''));
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
    if (e.type === 'order' && e.status === 'accepted' && modeRef.current !== 'performer' && !location.hash.startsWith('#/work')) toast('Исполнитель найден');
  }), [reload, toast]);

  if (!ready) return null;
  if (!me) {
    return (
      <MeCtx.Provider value={{ me: null, reload, mode: 'client', setMode }}>
        <Shell mode="client" me={null}>{route[0] === 'offer' ? <OfferPage audience={route[1] ?? 'client'} /> : <Login />}</Shell>
      </MeCtx.Provider>
    );
  }

  const [a, b] = route;
  if (a === 'as') return null;
  const isPerformer = me.roles.some((r) => PERFORMER_ROLES.includes(r));
  const isStaff = me.roles.some((r) => r === 'admin' || r === 'moderator');
  const effMode: Mode = a === 'work' ? 'performer' : a === 'admin' ? 'admin' : mode === 'performer' && !isPerformer ? 'client' : mode;

  let screen;
  switch (a) {
    case undefined: screen = effMode === 'performer' ? <Work /> : effMode === 'admin' && isStaff ? <Admin /> : <Home />; break;
    case 'login': screen = <Home />; break;
    case 'sos': screen = <Sos />; break;
    case 'new': screen = <NewOrder service={b ?? 'electric'} />; break;
    case 'order': screen = <Order id={b} />; break;
    case 'orders': screen = <Orders as="client" />; break;
    case 'garage': screen = <Garage />; break;
    case 'profile': screen = <Profile />; break;
    case 'work':
      screen = b === 'profile' ? <PerformerProfile /> : b === 'jobs' ? <Orders as="performer" /> : b === 'docs' ? <Documents /> : <Work />;
      break;
    case 'admin': screen = isStaff ? <Admin /> : <Home />; break;
    case 'offer': screen = <OfferPage audience={b ?? 'client'} />; break;
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
    ? [['/work', '⚡', 'Линия'], ['/work/jobs', '☰', 'Выезды'], ['/work/profile', '⚙', 'Профиль'], ['/profile', '◉', 'Аккаунт']]
    : mode === 'admin'
      ? [['/admin', '▦', 'Админ'], ['/as/client', '⌂', 'Клиент'], ['/profile', '◉', 'Аккаунт']]
      : [['/', '⌂', 'Главная'], ['/orders', '☰', 'Заявки'], ['/sos', '!', 'SOS'], ['/garage', '▭', 'Гараж'], ['/profile', '◉', 'Профиль']];
  return (
    <div className="app">
      <header className="top">
        <span className="logo">Трак<b>SOS</b></span>
        {me && mode === 'performer' && <span className="pill accent">исполнитель</span>}
        {me && mode === 'admin' && <span className="pill accent">админ</span>}
      </header>
      {children}
      {tabs.length > 0 && (
        <nav className="tabbar">
          {tabs.map(([href, ic, name]) => (
            <a key={href} href={'#' + href} className={`${here === href || (href !== '/' && here.startsWith(href + '/') && href !== '/work') ? 'on' : ''} ${href === '/sos' ? 'sosTab' : ''}`}>
              <span className="ic">{ic}</span>{name}
            </a>
          ))}
        </nav>
      )}
    </div>
  );
}

function localStorageGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* */ } }

createRoot(document.getElementById('root')!).render(<ToastProvider><App /></ToastProvider>);
