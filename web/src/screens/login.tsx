import { useState } from 'react';
import { post, setToken, connectWs, ApiError } from '../api.ts';
import { useAction, useMe, useToast, Field } from '../ui.tsx';
import { native } from '../native.ts';
import { WebsiteShowcase } from './websiteShowcase.tsx';

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
  if (roles.includes('insurer')) return '#/as/insurer';
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
  const title = intent === 'help' ? 'Помощь на дороге' : intent === 'join' ? 'Работать с ТракSOS' : 'Вход по номеру телефона';
  const sub = intent === 'help' ? 'Подтвердите номер — и сразу к заявке. Мастер позвонит на него.'
    : intent === 'join' ? 'Выберите, кем подключаетесь. После входа заполните профиль — проверим и откроем заявки.'
    : 'Пришлём код. Пароль не нужен — кабинет откроется сам.';

  if (!intent && !native.isApp && window.innerWidth > 800) return (
    <main className="web-landing">
      <section className="web-hero web-hero-featured">
        <div className="web-hero-layout">
          <div className="web-hero-content">
            <span className="label" style={{ color: 'var(--accent)' }}>ТракSOS · Единая платформа для грузового транспорта</span>
            <h1>Техпомощь и ремонт грузовиков — быстро, рядом, надёжно.</h1>
            <p>Водителям — помощь в дороге. Автопаркам — контроль техники и расходов. Мастерам и рембазам — удобные рабочие кабинеты. Всё в одной системе.</p>
            <div className="hero-actions">
              <button className="btn" type="button" onClick={() => setIntent('help')}>Нужна помощь сейчас</button>
              <button className="btn ghost" type="button" onClick={() => setIntent('login')}>Войти в кабинет</button>
            </div>
            <a className="web-hero-discover" href="#/about">Посмотреть возможности платформы <span aria-hidden="true">↗</span></a>
          </div>
          <div className="web-hero-visual" aria-label="Примеры возможностей сервиса">
            <div className="web-hero-screen">
              <div className="web-hero-screen-top"><span>● ● ●</span><strong>ТракSOS / рабочий стол</strong></div>
              <div className="web-hero-screen-body">
                <div className="web-hero-screen-tag">ЕДИНОЕ ПРОСТРАНСТВО</div>
                <div className="web-hero-screen-title">Ваша техника под контролем</div>
                <div className="web-hero-mini-card"><span>▤</span><div><b>История машин</b><small>Обслуживание и документы</small></div><i>↗</i></div>
                <div className="web-hero-mini-card"><span>₽</span><div><b>Финансы автопарка</b><small>Расходы, оплаты, возвраты</small></div><i>↗</i></div>
                <div className="web-hero-mini-card"><span>◉</span><div><b>Заявки и статусы</b><small>От обращения до результата</small></div><i>↗</i></div>
              </div>
            </div>
            <div className="web-hero-float"><span aria-hidden="true">✓</span><div><b>Одна система</b><small>От заявки до истории работ</small></div></div>
          </div>
        </div>
      </section>
      <section>
        <h2>Всё для грузовика в одной системе</h2>
        <div className="web-feature-grid" style={{ marginTop: 16 }}>
          <div className="web-feature"><b>Помощь в дороге</b><p>Найдите специалиста или эвакуатор и отслеживайте работу по заявке.</p></div>
          <div className="web-feature"><b>История автомобилей</b><p>Гараж, ремонты, страхование и техосмотр по каждой машине.</p></div>
          <div className="web-feature"><b>Кабинет автопарка</b><p>Водители, разрешения, лимиты и финансовая история в одном месте.</p></div>
        </div>
      </section>
      <section className="web-desktop-audiences">
        <div className="web-landing-eyebrow">ТракSOS ДЛЯ КАЖДОГО УЧАСТНИКА</div>
        <h2>Одна платформа. Четыре возможности.</h2>
        <div className="web-desktop-audience-grid">
          <article className="web-audience-card"><span>🚛</span><h3>Владельцам грузовиков</h3><p>Помощь на дороге, гараж, история ремонтов и документы.</p></article>
          <article className="web-audience-card"><span>▦</span><h3>Автопаркам</h3><p>Техника, водители, заявки, доступы и контроль расходов.</p></article>
          <article className="web-audience-card"><span>🔧</span><h3>Мастерам</h3><p>Заявки по специализации, статусы работ и расчёты.</p></article>
          <article className="web-audience-card"><span>⚙</span><h3>Рембазам и сервисам</h3><p>Запись клиентов, карточка сервиса и финансовый кабинет.</p></article>
        </div>
      </section>
      <section className="web-desktop-process"><span className="web-landing-eyebrow">КАК ЭТО РАБОТАЕТ</span><h2>От проблемы до результата</h2><div className="web-process-grid"><div><strong>01</strong><b>Опишите ситуацию</b><p>Создайте заявку с данными грузовика.</p></div><div><strong>02</strong><b>Найдите помощь</b><p>Выберите подходящего исполнителя или сервис.</p></div><div><strong>03</strong><b>Следите за работой</b><p>Статусы, связь и детали в одной заявке.</p></div><div><strong>04</strong><b>Сохраните историю</b><p>Результат останется в истории техники.</p></div></div></section>
      <WebsiteShowcase />
      <section className="card web-join-card">
        <h2>Работаете с грузовой техникой?</h2>
        <p className="sub">Мастера, эвакуаторщики и рембазы могут подключиться к ТракSOS и принимать заявки.</p>
        <button className="btn ghost" type="button" onClick={() => setIntent('join')}>Стать партнёром ТракSOS</button>
      </section>
    </main>
  );

  if (!intent) return (
    <main className={native.isApp ? 'app-welcome' : 'web-landing web-landing-mobile'}>
      {!native.isApp && <section className="web-mobile-intro web-mobile-hero">
        <span className="label">ТракSOS · Помощь грузовому транспорту</span>
        <h1>Грузовик должен ехать. Мы помогаем решить проблему.</h1>
        <p>Выездные мастера, диагностика, эвакуаторы и рембазы. Заявки, история ремонтов, документы и расходы — в одной системе.</p>
        <div className="hero-actions">
          <button className="btn" type="button" onClick={() => setIntent('help')}>Нужна помощь на дороге</button>
          <button className="btn ghost" type="button" onClick={() => setIntent('login')}>Войти в кабинет</button>
        </div>
        <a href="#/about" className="web-hero-discover">Узнать о возможностях ТракSOS →</a>
      </section>}
      {native.isApp && <div className="helpWrap"><button type="button" className="helpBtn" onClick={() => setIntent('help')}><span className="t">Помогите</span><span className="s">мастер или эвакуатор</span></button></div>}
      {!native.isApp && <>
        <section className="web-mobile-proof"><span>Выездная помощь</span><span>Гараж и документы</span><span>Контроль автопарка</span></section>
        <section className="web-mobile-section"><span className="label">Для кого сервис</span><h2>Одна платформа — разные задачи</h2><div className="web-feature-grid">
          <div className="web-feature"><b>Водителям и владельцам</b><p>Найти помощь в дороге, следить за заявкой, хранить историю машины и ремонтов.</p></div>
          <div className="web-feature"><b>Транспортным компаниям</b><p>Автопарк, водители, доступы, расходы и история обслуживания техники.</p></div>
          <div className="web-feature"><b>Мастерам и эвакуаторам</b><p>Получать подходящие заявки, вести работу и видеть расчёты в своём кабинете.</p></div>
          <div className="web-feature"><b>Рембазам и сервисам</b><p>Записи, заказы, сведения о машинах и контроль взаиморасчётов.</p></div>
        </div></section>
        <section className="web-mobile-section"><span className="label">Как работает ТракSOS</span><h2>От поломки до истории ремонта</h2><div className="web-mobile-steps"><div><b>01 · Оставьте заявку</b><p>Выберите проблему и опишите ситуацию.</p></div><div><b>02 · Найдите исполнителя</b><p>Специалист или сервис принимает заявку, а вы следите за её статусом.</p></div><div><b>03 · Сохраните результат</b><p>Информация о работах и расходах остаётся в системе.</p></div></div></section>
        <WebsiteShowcase />
        <section className="web-mobile-section web-mobile-join"><h2>Работаете с грузовой техникой?</h2><p>Подключайте мастерскую, эвакуатор или рембазу и работайте с заявками в ТракSOS.</p><button type="button" className="btn" onClick={() => setIntent('join')}>Стать партнёром</button></section>
        <section className="web-mobile-section web-mobile-faq"><h2>Частые вопросы</h2><details><summary>Нужно ли регистрироваться, чтобы узнать о сервисе?</summary><p>Нет. Возможности и правила можно посмотреть до входа.</p></details><details><summary>Что есть в личном кабинете?</summary><p>Заявки, история работ, гараж и профиль. Для компаний и исполнителей предусмотрены отдельные разделы.</p></details><details><summary>Как рассчитывается стоимость?</summary><p>Условия работ и сервисные сборы отображаются в заявке и документах перед подтверждением.</p></details><a href="#/rules">Правила сервиса</a> · <a href="#/help">Помощь и поддержка</a></section>
      </>}
      <div className="stack" style={{ marginTop: 24 }}><button type="button" className="btn ghost" onClick={() => setIntent('login')}>Войти по номеру телефона</button><button type="button" className="link" onClick={() => setIntent('join')}>Хочу сотрудничать с ТракSOS →</button></div>
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
