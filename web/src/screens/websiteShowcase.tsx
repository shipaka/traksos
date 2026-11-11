import { useState } from 'react';

const scenes = [
  {
    id: 'customer', eyebrow: '01 / Клиент', title: 'Всё начинается с одного обращения',
    detail: 'Выберите проблему, оформите заявку и следите за её выполнением. Детали и переписка остаются в истории.',
    steps: ['Выбор услуги', 'Подтверждение цены', 'Поиск мастера', 'История работ'],
    panelTitle: 'Помощь на дороге', metric: 'Заявка под контролем', icon: '↗',
    cards: [['Электрика и диагностика', 'Найти специалиста'], ['Пневмосистема', 'Помощь на выезде'], ['Эвакуатор', 'Перевозка техники']],
  },
  {
    id: 'fleet', eyebrow: '02 / Автопарк', title: 'Каждая машина — под вашим контролем',
    detail: 'Карточки автомобилей, водители, обслуживание, страховка и история затрат в едином пространстве.',
    steps: ['Карточка грузовика', 'Назначенный водитель', 'История заявок', 'Финансовый отчёт'],
    panelTitle: 'Мой автопарк', metric: 'История по автомобилям', icon: '▤',
    cards: [['Scania R440', 'Техника и обслуживание'], ['Volvo FH', 'История работ'], ['DAF XF', 'Заявки и расходы']],
  },
  {
    id: 'partner', eyebrow: '03 / Партнёры', title: 'Рабочий кабинет, а не переписка в мессенджере',
    detail: 'Заявки, статусы работ, начисления и обращения в поддержку находятся рядом, но не мешают друг другу.',
    steps: ['Доступные заказы', 'Рабочие статусы', 'Доходы и выплаты', 'Поддержка'],
    panelTitle: 'Рабочее пространство', metric: 'Заявки и финансы', icon: '◉',
    cards: [['Новые обращения', 'Очередь задач'], ['Мои работы', 'Активные и завершённые'], ['Финансы', 'Расчёты и история']],
  },
  {
    id: 'support', eyebrow: '04 / Сервис', title: 'Прозрачность на каждом этапе',
    detail: 'Уведомления, финансовая история, заявки на страхование и техосмотр и связь с модератором — в одном месте.',
    steps: ['Страхование и ТО', 'История событий', 'Финансы', 'Обращения'],
    panelTitle: 'Сервис и поддержка', metric: 'Информация в одном месте', icon: '✓',
    cards: [['Страхование', 'История и сроки'], ['Финансовый обзор', 'Согласованные и оплаченные суммы'], ['Помощь', 'Написать модератору']],
  },
] as const;

export function WebsiteShowcase() {
  const [active, setActive] = useState(0);
  const scene = scenes[active];
  return (
    <section className="showcase" aria-labelledby="showcase-heading">
      <div className="showcase-heading">
        <div><span className="label">Посмотрите, что внутри</span><h2 id="showcase-heading">ТракSOS — больше, чем вызов мастера</h2>
          <p>Выберите роль и посмотрите, как устроена работа. Это демонстрация возможностей, а не настоящие заказы.</p>
        </div>
        <div className="showcase-stepper">
          <button type="button" aria-label="Предыдущая возможность" onClick={() => setActive((active + scenes.length - 1) % scenes.length)}>←</button>
          <span>{active + 1} / {scenes.length}</span>
          <button type="button" aria-label="Следующая возможность" onClick={() => setActive((active + 1) % scenes.length)}>→</button>
        </div>
      </div>
      <div className="showcase-tabs" role="tablist" aria-label="Возможности ТракSOS">
        {scenes.map((item, index) => <button key={item.id} type="button" role="tab"
          aria-selected={active === index} aria-controls="showcase-content" id={'showcase-tab-' + index}
          onClick={() => setActive(index)}>{item.eyebrow.slice(5)}</button>)}
      </div>
      <div className="showcase-body" id="showcase-content" role="tabpanel" aria-labelledby={'showcase-tab-' + active}>
        <div className="showcase-copy">
          <span className="showcase-eyebrow">{scene.eyebrow}</span>
          <h3>{scene.title}</h3>
          <p>{scene.detail}</p>
          <ul>{scene.steps.map((step) => <li key={step}><span aria-hidden="true">✓</span>{step}</li>)}</ul>
          <a href="#/help">Подробнее о возможностях <span aria-hidden="true">→</span></a>
        </div>
        <div className="showcase-window" aria-label={'Пример экрана: ' + scene.panelTitle}>
          <div className="showcase-window-top"><div><i/><i/><i/></div><span>trakSOS / личный кабинет</span></div>
          <div className="showcase-window-main">
            <aside><strong>Трак<span>SOS</span></strong><em>Обзор</em><em>Заявки</em><em>Финансы</em><em>Помощь</em></aside>
            <div className="showcase-window-content">
              <div className="showcase-kicker">Рабочее пространство</div>
              <strong>{scene.panelTitle}</strong>
              <div className="showcase-metric"><span>{scene.icon}</span><b>{scene.metric}</b></div>
              {scene.cards.map(([name, note]) => <div className="showcase-item" key={name}><span className="showcase-item-icon">▧</span><span><b>{name}</b><small>{note}</small></span><span>↗</span></div>)}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}


/** Public product tour. No account or personal data is needed. */
export function WebsiteAbout() {
  return (
    <main className="web-about">
      <div className="web-about-intro">
        <span className="label">ТракSOS · Возможности</span>
        <h1>Не просто вызвать помощь. Управлять всей историей обслуживания.</h1>
        <p>Сервис объединяет клиента, водителя, исполнителя и владельца автопарка. Посмотрите основные сценарии работы до регистрации.</p>
        <div className="row">
          <a className="btn" href="#/login">Войти или начать работу</a>
          <a className="btn ghost" href="#/help">Вопросы и инструкции</a>
        </div>
      </div>
      <WebsiteShowcase />
      <section className="web-about-actions">
        <h2>С чего начать?</h2>
        <div className="web-feature-grid">
          <div className="web-feature"><b>Я водитель</b><p>Оформите помощь на дороге и отслеживайте заявку.</p><a href="#/login">Открыть вход →</a></div>
          <div className="web-feature"><b>У меня автопарк</b><p>Добавьте машины, управляйте водителями и контролируйте расходы.</p><a href="#/login">Открыть вход →</a></div>
          <div className="web-feature"><b>Я исполнитель</b><p>Заполните профиль, пройдите проверку и получайте доступные заявки.</p><a href="#/login">Как подключиться →</a></div>
        </div>
      </section>
    </main>
  );
}
