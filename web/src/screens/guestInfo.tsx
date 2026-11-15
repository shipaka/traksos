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
    <section className="guest-info-section">
      <h2>Направления работы</h2>
      <div className="guest-info-grid">
        <a href="#/explore/tow"><b>Эвакуация</b><small>Заявки на транспортировку</small></a>
        <a href="#/explore/van"><b>Выездной мастер</b><small>Диагностика и ремонт на месте</small></a>
        <a href="#/explore/sto"><b>СТО и сервисы</b><small>Ремонт и запись</small></a>
        <a href="#/explore/parts"><b>Запчасти</b><small>Подбор оригиналов и аналогов</small></a>
        <a href="#/explore/insurance"><b>Страхование</b><small>Обращения и документы</small></a>
        <a href="#/explore/consult"><b>Консультации</b><small>Техническая помощь</small></a>
      </div>
    </section>
  </main>;
}

export function GuestOffers() {
  return <main className="guest-info-page">
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
