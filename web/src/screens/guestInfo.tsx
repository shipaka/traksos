/** Read-only public pages; legal documents are served from the active server version. */
export function GuestCompany() {
  return <main className="guest-info-page">
    <div className="guest-info-top"><a href="#/">← Главная</a><span>О КОМПАНИИ</span></div>
    <section className="guest-info-hero">
      <span className="guest-info-overline">TRAKSOS · ГРУЗОВОЙ ТРАНСПОРТ</span>
      <h1>Компания TrakSOS</h1>
      <p>TrakSOS объединяет сервисы, связанные с грузовыми автомобилями и прицепами: помощь в дороге, ремонт, подбор запчастей и оформление страховых обращений.</p>
      <p>На этапе запуска выездные услуги ориентированы на Санкт-Петербург и Ленинградскую область. Доступность конкретных специалистов и сервисов определяется при оформлении заявки.</p>
      <div className="guest-info-actions">
        <a href="#/register">Зарегистрироваться</a><a href="#/join">Стать партнёром</a>
      </div>
    </section>
    <section className="guest-info-section guest-info-company-note">
      <h2>О платформе</h2>
      <p>TrakSOS помогает владельцам грузового транспорта, водителям и профессиональным исполнителям взаимодействовать в единой системе. Для просмотра условий заказа, комиссий и работы сервисов необходим вход в личный кабинет.</p>
      <p>Официальные реквизиты оператора платформы будут опубликованы здесь после окончательного согласования. Непроверенные данные не размещаем.</p>
    </section>
  </main>;
}

export function GuestOffers() {
  return <main className="guest-info-page guest-info-offers">
    <div className="guest-info-top"><a href="#/">← Главная</a><span>ЮРИДИЧЕСКАЯ ИНФОРМАЦИЯ</span></div>
    <section className="guest-info-hero">
      <span className="guest-info-overline">TRAKSOS · ДОКУМЕНТЫ</span>
      <h1>Оферты и документы</h1>
      <p>Ознакомьтесь с действующими редакциями документов до регистрации. Тексты оферт и их даты загружаются с сервера TrakSOS.</p>
      <div className="guest-info-grid">
        <a href="#/offer/client"><b>Оферта для клиентов</b><small>Пользование сервисом</small></a>
        <a href="#/offer/performer"><b>Условия для партнёров</b><small>Работа через TrakSOS</small></a>
        <a href="#/offer/privacy"><b>Обработка персональных данных</b><small>Политика конфиденциальности</small></a>
        <a href="#/rules"><b>Правила площадки</b><small>Порядок работы сервиса</small></a>
      </div>
    </section>
    <p className="guest-info-note">Если документ ещё не опубликован, страница документа сообщит об этом. Отсутствующие юридические тексты не подменяются примерными.</p>
  </main>;
}

/** Information only: never manufacture an APK or a RuStore listing. */
export function GuestAppInfo() {
  return <main className="guest-info-page">
    <div className="guest-info-top"><a href="#/">← Главная</a><span>МОБИЛЬНОЕ ПРИЛОЖЕНИЕ</span></div>
    <section className="guest-info-hero">
      <span className="guest-info-overline">TRAKSOS · В ТЕЛЕФОНЕ</span>
      <h1>Мобильное приложение TrakSOS</h1>
      <p>Заявки, связь с исполнителями, транспорт и история обращений — в личном кабинете.</p>
      <p>Ссылка на скачивание в RuStore появится после подтверждённой публикации. Пока можно пользоваться мобильной версией сайта.</p>
      <div className="guest-info-actions">
        <a href="#/login">Войти</a><a href="#/register">Зарегистрироваться</a>
      </div>
    </section>
    <section className="guest-info-section">
      <h2>Доступ к сервисам</h2>
      <p>Для оформления заявки используйте свой клиентский аккаунт. Мастера, СТО и другие исполнители подключаются отдельно.</p>
      <a href="#/join">Хотим работать с TrakSOS →</a>
    </section>
  </main>;
}
