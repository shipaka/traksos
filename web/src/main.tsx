import './styles.css';
import { createRoot } from 'react-dom/client';
import { Component, useCallback, useEffect, useRef, useState } from 'react';
import { get, post, getToken, connectWs, API_URL, onEvent, ApiError } from './api.ts';
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
import { Fleet, QrJoin } from './screens/fleet.tsx';
import { Help } from './screens/help.tsx';
import { Rules } from './screens/rules.tsx';
import { Shop, ShopCart, ShopHistory } from './screens/shop.tsx';
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
    console.error('[TrackSOS] Section failed to render:', error);
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

type Mode = 'client' | 'performer' | 'admin' | 'moderator' | 'service' | 'insurer';
const PERFORMER_ROLES = ['master', 'tow', 'service'];

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
    if (m === 'client' || m === 'performer' || m === 'admin' || m === 'moderator' || m === 'service' || m === 'insurer') setMode(m);
    location.replace('#/' + (m === 'performer' ? 'work' : m === 'admin' ? 'admin' : m === 'moderator' ? 'moderation' : m === 'service' ? 'base' : m === 'insurer' ? 'insurance' : ''));
  }, [route.join('/')]); // eslint-disable-line
  useEffect(() => {
    if (!ready) return; // Keep the native token until the initial auth check finishes.
    if (!me) {
      // Logout/revoked session must also clear the token held by the Android native bridge.
      native.setSession(API_URL || location.origin, null);
      return;
    }
    connectWs();
    native.setSession(API_URL || location.origin, getToken());
    native.registerPush((token) => post('/api/me/push-token', { provider: 'rustore', token }));
  }, [ready, me?.id]); // eslint-disable-line
  const modeRef = useRef(mode);
  modeRef.current = mode;
  useEffect(() => onEvent((e) => {
    if (e.type === 'verification') { toast(e.decision === 'approved' ? 'Проверка пройдена — выходите на линию' : 'Проверка не пройдена'); reload(); }
    // Админ поменял цену, бонусы или баланс — профиль обновляется сам, без перезагрузки
    if (e.type === 'pricing' || e.type === 'balance' || e.type === 'line_status') reload();
    if (e.type === 'order' && e.status === 'accepted' && modeRef.current !== 'performer' && !location.hash.startsWith('#/work')) toast('Исполнитель найден');
  }), [reload, toast]);

  if (!ready) return <div className="traksos-start-loading" role="status">Загружаем TrackSOS…</div>;
  // Ссылка-приглашение: запоминаем код, вход — как обычно
  if (route[0] === 'r' && route[1]) { try { localStorage.setItem('traksos.ref', route[1].toUpperCase()); } catch { /* */ } }
  if (!me) {
    return (
      <MeCtx.Provider value={{ me: null, reload, mode: 'client', setMode }}>
        <Shell mode="client" me={null}>{route[0] === 'offer' ? <OfferPage audience={route[1] ?? 'client'} /> : route[0] === 'qr' && route[1] ? <QrJoin code={route[1]} /> : route[0] === 'rules' ? <Rules /> : route[0] === 'help' ? <Help /> : <>{route[0] === 'r' && <div className="banner good" style={{ margin: '12px 16px 0' }}><span>Вас пригласили в ТракSOS — после входа на счёт придут подарочные баллы.</span></div>}<Login key={route[0] ?? 'public'} entry={route[0] === 'login' ? 'login' : route[0] === 'register' ? 'register' : route[0] === 'join' ? 'join' : undefined} /></>}</Shell>
      </MeCtx.Provider>
    );
  }

  const [a, b] = route;
  if (a === 'as') return null;
  const isPerformer = me.roles.some((r) => r === 'master' || r === 'tow');
  const isCustomer = me.roles.some((r) => r === 'client' || r === 'driver');
  const isAdmin = me.roles.includes('admin');
  const serviceSandbox = isAdmin && a === 'admin' && b === 'test-center' && route[2] === 'service';
  const isModerator = me.roles.includes('moderator') || isAdmin;
  const isStaff = isModerator;
  const isService = me.roles.includes('service');
  const isInsurer = me.roles.includes('insurer');
  // A saved/forced mode must never expose navigation for a role the account lacks.
  const fallback: Mode = isInsurer ? 'insurer'
    : isCustomer ? 'client' : isPerformer ? 'performer'
    : isService ? 'service' : isAdmin ? 'admin' : isModerator ? 'moderator' : 'client';
  const permitted = mode === 'insurer' ? isInsurer : mode === 'admin' ? isAdmin : mode === 'moderator' ? isModerator
    : mode === 'performer' ? isPerformer : mode === 'service' ? isService
    : isCustomer || isStaff;
  const allowedMode: Mode = isInsurer ? 'insurer' : permitted ? mode : fallback;
  const effMode: Mode = serviceSandbox ? 'service' : a === 'work' && isPerformer ? 'performer'
    : a === 'admin' && isAdmin ? 'admin' : a === 'moderation' && isModerator ? 'moderator'
    : a === 'base' && isService ? 'service' : a === 'insurance' && isInsurer ? 'insurer' : allowedMode;

  let screen;
  switch (a) {
    case undefined: screen = effMode === 'insurer' ? <InsurerCabinet /> : effMode === 'service' ? <BaseHome /> : effMode === 'performer' ? <Work /> : effMode === 'admin' && isAdmin ? <Admin /> : effMode === 'moderator' && isModerator ? <ModeratorDesk /> : <Home />; break;
    case 'login': screen = <Home />; break;
    case 'sos': screen = isCustomer ? <Sos /> : <main><div className="empty">Для вызова SOS нужен клиентский аккаунт</div></main>; break;
    case 'new': screen = !isCustomer ? <main><div className="empty">Для заказа нужен клиентский аккаунт</div></main> : b === 'consult' ? <Consult /> : <NewOrder service={b ?? 'electric'} />; break;
    case 'order': screen = <Order id={b} />; break;
    case 'orders': screen = isCustomer ? <Orders as="client" /> : <main><div className="empty">Нет доступа к клиентским заявкам</div></main>; break;
    case 'garage': screen = isCustomer ? <Garage /> : <main><div className="empty">Нет доступа к гаражу</div></main>; break;
    case 'profile': screen = <Profile />; break;
    case 'invite': screen = <Invite />; break;
    case 'r': screen = <Invite />; break;
    case 'work':
      if (!isPerformer) { screen = <Home />; break; }
      screen = !me.performer || b === 'profile' || (b === 'me' && !route[2]) ? <PerformerHub />
        : b === 'me' ? ({ about: <AboutSection />, phone: <PhoneSection />, schedule: <ScheduleSection />, cars: <CarsSection />, tax: <TaxSection />, money: <MoneySection />, level: <LevelSection /> } as Record<string, JSX.Element>)[route[2]] ?? <PerformerHub />
        : b === 'filter' ? <FilterSection /> : b === 'jobs' ? <Orders as="performer" /> : b === 'docs' ? <Documents /> : <Work />;
      break;
    case 'base': screen = !isService ? <Home /> : b === 'car' && route[2] ? <BaseCar id={route[2]} /> : b === 'me' ? <BaseSetup /> : b === 'money' ? <BaseMoney /> : <BaseHome />; break;
    case 'services': screen = b && route[2] === 'book' ? <BookForm id={b} /> : b ? <CenterPage id={b} /> : <ServicesList />; break;
    case 'booking': screen = <BookingPage id={b} />; break;
    case 'fleet': screen = isCustomer && !me.owner_id && !me.roles.includes('driver') ? <Fleet /> : <main><div className="empty">Парком управляет владелец</div></main>; break;
    case 'insurance': screen = b === 'request' ? (route[2] === 'new' ? <InsuranceApplication vehicleId={route[3]??''} /> : <InsuranceThread requestId={route[2]??''} />) : isInsurer ? <InsurerCabinet /> : <main><div className="empty">Нет доступа к кабинету страховщика</div></main>; break;
    case 'help': screen = <Help />; break;
    case 'rules': screen = <Rules />; break;
    case 'shop': screen = b === 'cart' ? <ShopCart /> : b === 'history' ? <ShopHistory vehicleId={route[2]} /> : <Shop />; break;
    case 'privacy': screen = <Privacy />; break;
    case 'qr': screen = <QrJoin code={b} />; break;
    case 'appeal': screen = <Appeal />; break;
    case 'reviews': screen = <MyReviews />; break;
    case 'admin': screen = !isStaff ? <Home /> : b === 'case' && route[2] ? <ModCase id={route[2]} /> : !isAdmin ? <ModeratorDesk /> : b === 'test-center' ? (serviceSandbox ? <ServicePreviewPage section={route[3]} sub={route[4]} id={route[5]} /> : <AdminTestCenter roleId={route[2]} />) : b === 'user' && route[2] ? <AdminUser id={route[2]} /> : <Admin key={b === 'section' ? route[2] : 'summary'} initialSection={b === 'section' ? route[2] : undefined} />; break;
    case 'moderation': screen = isModerator ? <ModeratorDesk /> : <Home />; break;
    case 'offer': screen = <OfferPage audience={b ?? 'client'} />; break;
    case 'support': screen = b === 'new' ? <SupportNew /> : b ? <SupportThread id={b} /> : <SupportList />; break;
    case 'notifications': screen = <Notifications />; break;
    default: screen = <main><div className="empty">Такой страницы нет</div></main>;
  }

  return (
    <MeCtx.Provider value={{ me, reload, mode: effMode, setMode }}>
      <ScreenErrorBoundary key={route.join('/')}>
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
  const serviceSandbox = route[0]==='admin'&&route[1]==='test-center'&&route[2]==='service';
  const here = serviceSandbox ? '/'+(route.slice(3).join('/')||'base') : '/'+route.join('/');
  const sandboxHref=(href:string)=>serviceSandbox?'#/admin/test-center/service'+(href==='/base'||href.startsWith('/base/')?href:'/unavailable'):'#'+href;
  // На телефоне оставляем только рабочие действия. Все прежние маршруты
  // сохраняются через меню; компьютерная боковая навигация остаётся полной.
  const tabs: [string, string, string][] = !me ? [] : mode === 'performer'
    ? [['/work', '⚡', 'Линия'], ['/work/jobs', '☰', 'Заявки'], ['/shop', '🛍', 'Магазин']]
    : mode === 'service'
      ? [['/base', '▤', 'Рембаза'], ['/support', '?', 'Связь'], ['/shop', '🛍', 'Магазин']]
    : mode === 'insurer'
      ? [['/insurance', '▣', 'Рабочий стол'], ['/insurance', '☰', 'Полисы'], ['/profile', '◉', 'Аккаунт']]
    : mode === 'moderator'
      ? [['/moderation', '▦', 'Рабочий стол'], ['/admin/section/queue', '⚑', 'Проверки'], ['/support', '?', 'Обращения']]
    : mode === 'admin'
      ? [['/admin', '▦', 'Рабочий стол'], ['/admin/section/orders', '☰', 'Заявки'], ['/admin/section/support', '?', 'Обращения']]
      : [['/', '🔧', 'Услуги'], ['/sos', '!', 'SOS'], ['/orders', '☰', 'Заявки'], ['/shop', '🛍', 'Магазин']];
  // Все дополнительные функции доступны в шапке, даже когда они не в нижних вкладках.
  // Не показываем чужие роли и не создаём несуществующие страницы.
  const accountLinks: [string, string][] = mode === 'performer'
    ? [...(me?.roles.includes('service') ? [['/base', 'Моя СТО — стационарный ремонт']] as [string, string][] : []),
       ['/work/me', 'Профиль исполнителя'], ['/work/me/about', 'Личные сведения'],
       ['/work/me/phone', 'Телефон и вход'], ['/work/me/cars', 'Автомобили'],
       ['/work/me/schedule', 'График работы'], ['/work/filter', 'Фильтры заявок'],
       ['/work/me/money', 'Финансы и выплаты'], ['/work/me/tax', 'Налоговый статус'],
       ['/work/me/level', 'Рейтинг и уровень'], ['/work/docs', 'Проверка и документы'],
       ['/reviews', 'Отзывы'], ['/invite', 'Пригласить партнёра'],
       ['/work/jobs', 'История заявок'], ['/profile', 'Аккаунт']]
    : mode === 'service'
      ? [...(me?.roles.some(r => r === 'master' || r === 'tow') ? [['/work', 'Выездной мастер — заявки']] as [string, string][] : []),
         ['/base', 'Заявки и история ремонтов'], ['/base/me', 'Карточка СТО'],
         ['/base/money', 'Финансы'], ['/profile', 'Аккаунт'],
         ['/invite', 'Пригласить партнёра']]
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
         ['/admin/section/verify', 'Проверка исполнителей'],
         ['/admin/section/bases', 'СТО и рембазы'],
         ['/admin/section/shop', 'Управление магазином'],
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
        <span className="logo">Трак<b>SOS</b></span>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          {!me && <div className="guest-header-actions"><a href="#/login">Войти</a><a href="#/register" className="register">Зарегистрироваться</a></div>}
          {me && mode === 'performer' && <span className="pill accent">исполнитель</span>}
          {me && mode === 'admin' && <span className="pill accent">админ</span>}
          {me && mode === 'moderator' && <span className="pill accent">модерация</span>}
          {me && mode === 'insurer' && <span className="pill accent">страхование</span>}
          {me && mode === 'service' && <span className="pill accent">рембаза</span>}
          {me && !serviceSandbox && <a href="#/help" className="bell" aria-label="Справка">?</a>}
          {me && !serviceSandbox && <Bell />}
          {me && <details className="account-menu" key={here}>
            <summary aria-label="Открыть меню кабинета">☰ <span>Меню</span></summary>
            <nav aria-label="Все разделы кабинета">
              {me && me.roles.some(r => r === 'master' || r === 'tow') && me.roles.some(r => r === 'admin' || r === 'moderator') && <>
                <span className="account-menu-heading">Переключить кабинет</span>
                {me.roles.includes('admin') && <a href="#/as/admin" aria-current={mode === 'admin' ? 'page' : undefined}>Администратор</a>}
                {!me.roles.includes('admin') && me.roles.includes('moderator') && <a href="#/as/moderator" aria-current={mode === 'moderator' ? 'page' : undefined}>Модератор</a>}
                <a href={me.roles.includes('admin') ? '#/admin/section/queue' : '#/moderation'}>Модерация — очередь</a>
                <a href="#/as/performer" aria-current={mode === 'performer' ? 'page' : undefined}>Выездной мастер</a>
              </>}
              <span className="account-menu-heading">Мой кабинет</span>
              {accountLinks.map(([href, label]) => <a key={href} href={sandboxHref(href)}>{label}</a>)}
              <span className="account-menu-heading">Помощь и документы</span>
              {helpLinks.map(([href, label]) => <a key={href} href={sandboxHref(href)}>{label}</a>)}
            </nav>
          </details>}
        </div>
      </header>
      <NetworkStatus />
      <div className="desktop-layout">
        <aside className="desktop-sidebar" aria-label="Навигация по сайту">
          <div className="desktop-sidebar-title">{me ? 'Рабочий кабинет' : 'ТракSOS · помощь в дороге'}</div>
          <nav className="desktop-nav">
            {me ? <>
              {(mode === 'client'
                ? [...tabs, ['/garage', '▭', 'Гараж']]
                : mode === 'performer'
                  ? [...tabs, ['/work/me', '◉', 'Профиль'], ...(me.roles.includes('service') ? [['/base', '▤', 'Моя СТО']] : [])]
                  : mode === 'service'
                    ? [...tabs, ['/base/money', '₽', 'Финансы'], ['/base/me', '⚙', 'Карточка'], ...(me.roles.some(r => r === 'master' || r === 'tow') ? [['/work', '⚡', 'Выездной мастер']] : []), ['/profile', '◉', 'Аккаунт']]
                    : mode === 'insurer'
                      ? [...tabs, ['/profile', '◉', 'Аккаунт']]
                      : mode === 'moderator' ? [...tabs, ['/profile', '◉', 'Аккаунт']]
                      : [...tabs, ['/as/client', '⌂', 'Клиент'], ['/profile', '◉', 'Аккаунт']]).map(([href, ic, name]) => (
                <a key={href} href={sandboxHref(href)} className={`desktop-nav-link ${here === href || (href !== '/' && here.startsWith(href + '/')) ? 'active' : ''} ${href === '/sos' ? 'desktop-nav-sos' : ''}`}>
                  <span aria-hidden="true">{ic}</span><span>{name}</span>
                </a>
              ))}
              {mode === 'client' && <>
                <div className="desktop-sidebar-title desktop-nav-section">Дополнительно</div>
                {([...(me && !me.owner_id && !me.roles.includes('driver') ? [['/fleet','▣','Мой парк']] as [string,string,string][] : []),['/support','?','Поддержка'],['/profile','◉','Профиль']] as [string,string,string][]).map(([href, ic, name]) => (
                  <a key={href} href={sandboxHref(href)} className={`desktop-nav-link ${here === href || here.startsWith(href + '/') ? 'active' : ''}`}>
                    <span aria-hidden="true">{ic}</span><span>{name}</span>
                  </a>
                ))}
              </>}
            </> : <>
              <a className="desktop-nav-link active" href="#/"><span>⌂</span><span>Главная</span></a>
              <a className="desktop-nav-link" href="#/help"><span>?</span><span>Как это работает</span></a>
              <a className="desktop-nav-link" href="#/rules"><span>▤</span><span>Правила площадки</span></a>
              <a className="desktop-nav-link" href="#/offer/privacy"><span>▣</span><span>Персональные данные</span></a>
            </>}
          </nav>
          <div className="desktop-sidebar-bottom">Помощь грузовому транспорту<br />Санкт-Петербург и Ленинградская область</div>
        </aside>
        <div className="desktop-content">
          {children}
          <SiteFooter />
        </div>
      </div>
      {tabs.length > 0 && !(route[0] === 'work' && ['profile', 'docs'].includes(route[1] ?? '')) && !(route[0] === 'base' && route[1] === 'me') && (
        <nav className="tabbar">
          {tabs.map(([href, ic, name]) => (
            <a key={href} href={sandboxHref(href)} className={`${here === href || (href !== '/' && here.startsWith(href + '/') && href !== '/work' && href !== '/base') ? 'on' : ''} ${href === '/sos' ? 'sosTab' : ''}`}>
              {href === '/sos' ? <span className="sosDot">SOS</span> : <><span className="ic">{ic}</span>{name}</>}
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
