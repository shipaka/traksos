import { useEffect } from 'react';
import { CATALOGUE, SERVICE_TILES, rememberGuestService, type ServiceId } from '../guestCatalog.ts';

// Latest 19 November public tiles point to honest, accessible information,
// not to protected routes that silently bounce guests back to the homepage.
const FEATURE_PREVIEWS: Record<string,{title:string;icon:string;description:string;details:string[]}> = {
  app:{title:'Приложение TrakSOS',icon:'▯',description:'Мобильное приложение для работы с заявками, техникой и сообщениями. Публикация в RuStore готовится; прямую ссылку на скачивание покажем только после подтверждённого размещения.',details:['Заявки и история обращений в телефоне','Уведомления о статусах работы','Отдельные рабочие кабинеты для подключённых ролей']},
  club:{title:'Клуб TrakSOS',icon:'♧',description:'Профессиональное сообщество для водителей, мастеров, СТО и владельцев грузового транспорта. Доступ к обсуждениям зависит от регистрации и правил площадки.',details:['Профессиональное общение и разборы','Обмен опытом и полезными материалами','Рабочие группы и проекты сообщества']},
  sos:{title:'SOS — помощь в дороге',icon:'⚠',description:'Выберите помощь для грузовика: мастер, эвакуатор, СТО или консультация. Для создания заявки нужен клиентский аккаунт.',details:['Указание места поломки и автомобиля','Выбор подходящего типа помощи','История и статус обращения']},
  air:{title:'Эфир водителей',icon:'◉',description:'Сообщество водителей и специалистов. Общие сообщения и личные диалоги разделены; личные данные и технические вопросы доступны только по правилам доступа.',details:['Общение водителей','Помощь и обмен опытом','Подтверждённый личный чат TrakBot']},
  ecu:{title:'ЭБУ — диагностика и ремонт',icon:'▣',description:'Стационарная диагностика электронных блоков грузового транспорта. Не подменяется заявкой на выезд и требует отдельного согласования стоимости.',details:['Описание блока управления и неисправности','Согласование диагностики','Отдельная история работ']},
  tech:{title:'ТехБаза TrakSOS',icon:'▤',description:'Проверяемая техническая информация по грузовикам, прицепам и кодам неисправностей. Закрытые документы доступны только пользователям с соответствующими правами.',details:['Справочник проверенных технических источников','Диагностические коды с уровнем достоверности','Материалы для подтверждённых мастеров и СТО']},
  garage:{title:'Мой гараж',icon:'▣',description:'Транспорт и история обслуживания с разграничением прав владельца и водителя. Фотография открывает историю именно выбранного автомобиля.',details:['Марка, модель, год и при наличии VIN','История заявок и ремонтов','Подбор работ и запчастей по машине']},
  training:{title:'Обучение работе с TrakSOS',icon:'?',description:'Пошаговые подсказки и тренажёр по вашей роли, которые должны обновляться вместе с логикой каждого выпуска.',details:['Клиент, мастер, эвакуаторщик, СТО и страховщик','Интерактивные безопасные учебные сценарии','Контекстные подсказки в кабинетах']},
  trakbot:{title:'TrakBot — личный помощник',icon:'✦',description:'Приватный помощник для технических вопросов. Не пишет в общий Эфир и не предлагает платные консультации без явного согласия.',details:['Бесплатные справочные ответы в пилоте','Указание источника и достоверности','Без автоматических списаний']},
  pricing:{title:'Комиссии и тарифы TrakSOS',icon:'₽',description:'Для услуги базовой стоимостью 10 000 ₽ клиент платит 10 500 ₽, а исполнитель видит базовую цену 10 000 ₽ и свою комиссию 500 ₽ внутри неё.',details:['5% с клиента сверх стоимости услуги','5% с исполнителя внутри базовой цены','Не более 5 000 ₽ с каждой стороны для согласованных заказов']},
};

/** Read-only, public explanation of the selected service and its future cabinet.
 * All real workflows require authentication; no fake provider cards or live orders.
 */
export function GuestExplore({ id, itemKey }: {id: string; itemKey?: string}) {
  const tile = SERVICE_TILES.find(s => s.id === id);
  const isService = !!tile;
  const service = isService ? CATALOGUE[tile.id] : null;
  const serviceId = (tile?.id || 'van') as ServiceId;
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'auto' }); }, [id, itemKey]);
  if (id === 'inspection') {
    return <main className="guest-explore guest-explore-inspection">
      <a className="guest-explore-back" href="#/">← На главную</a>
      <section className="guest-explore-hero">
        <span className="guest-explore-eyebrow">TRAKSOS · ИНФОРМАЦИЯ ДЛЯ ВЛАДЕЛЬЦЕВ ГРУЗОВОГО ТРАНСПОРТА</span>
        <span className="guest-explore-glyph" aria-hidden="true">✓</span>
        <h1>Техосмотр грузового транспорта</h1>
        <p>Информация о техническом осмотре грузовиков и прицепов. Узнайте, что потребуется для обращения, и войдите в TrakSOS для работы с данными своего транспорта.</p>
        <div className="guest-explore-actions">
          <a className="guest-explore-cta" href="#/login" onClick={() => rememberGuestService('inspection')}>Войти в кабинет</a>
          <a className="guest-explore-secondary" href="#/register" onClick={() => rememberGuestService('inspection')}>Зарегистрироваться</a>
        </div>
      </section>
      <section className="guest-explore-section">
        <h2>Что нужно подготовить</h2>
        <div className="guest-explore-service-grid">
          <div className="guest-explore-item"><span aria-hidden="true">✓</span><strong>Данные грузовика или прицепа</strong></div>
          <div className="guest-explore-item"><span aria-hidden="true">✓</span><strong>Документы на транспорт</strong></div>
          <div className="guest-explore-item"><span aria-hidden="true">✓</span><strong>Контакты и удобный регион</strong></div>
        </div>
        <p className="guest-explore-note">Это информационная страница. Наличие станции, запись и оформление диагностической карты не подтверждаются до проверки доступности услуги — здесь нет фиктивной записи или готового документа.</p>
      </section>
    </main>;
  }
  if (id === 'guide') {
    return <main className="guest-explore guest-explore-guide">
      <a className="guest-explore-back" href="#/">← На главную</a>
      <section className="guest-explore-hero">
        <span className="guest-explore-eyebrow">TRAKSOS · ПОЛЕЗНОЕ</span>
        <span className="guest-explore-glyph" aria-hidden="true">?</span>
        <h1>Как работает TrakSOS</h1>
        <p>Выберите нужную помощь грузовику, узнайте порядок обращения и откройте соответствующий раздел. Для оформления реальной заявки нужен личный кабинет.</p>
        <div className="guest-explore-actions">
          <a className="guest-explore-cta" href="#/explore/van">Выбрать услугу</a>
          <a className="guest-explore-secondary" href="#/login">Войти</a>
        </div>
      </section>
      <section className="guest-explore-section">
        <h2>Три шага к помощи</h2>
        <div className="guest-explore-service-grid">
          <div className="guest-explore-item"><span>01</span><strong>Опишите проблему, транспорт и место</strong></div>
          <div className="guest-explore-item"><span>02</span><strong>Ознакомьтесь с доступными предложениями</strong></div>
          <div className="guest-explore-item"><span>03</span><strong>Следите за статусом заявки в кабинете</strong></div>
        </div>
      </section>
      <section className="guest-explore-section">
        <h2>Разделы сервиса</h2>
        <div className="guest-explore-service-grid">
          {SERVICE_TILES.map(item => <a href={'#/explore/' + item.id} className="guest-explore-item" key={item.id} onClick={() => rememberGuestService(item.id)}>
            <span aria-hidden="true">{item.icon}</span><strong>{item.title}</strong><span aria-hidden="true">›</span>
          </a>)}
        </div>
        <p className="guest-explore-note">Доступность исполнителей, запчастей и страховых предложений зависит от региона и состояния подключённых услуг.</p>
      </section>
    </main>;
  }
  const preview = FEATURE_PREVIEWS[id];
  if (preview) return <main className={'guest-explore guest-explore-'+id}>
    <a className="guest-explore-back" href="#/">← На главную</a>
    <section className="guest-explore-hero">
      <span className="guest-explore-eyebrow">TRAKSOS · ВОЗМОЖНОСТИ ПЛАТФОРМЫ</span>
      <span className="guest-explore-glyph" aria-hidden="true">{preview.icon}</span>
      <h1>{preview.title}</h1><p>{preview.description}</p>
      <div className="guest-explore-actions">
        <a className="guest-explore-cta" href="#/register">Зарегистрироваться</a>
        <a className="guest-explore-secondary" href="#/login">Уже есть аккаунт? Войти</a>
      </div>
    </section>
    <section className="guest-explore-section">
      <h2>Возможности раздела</h2>
      <div className="guest-explore-service-grid">
        {preview.details.map((detail,index)=><div className="guest-explore-item" key={detail}>
          <span aria-hidden="true">{index+1}</span><strong>{detail}</strong>
        </div>)}
      </div>
      <p className="guest-explore-note">Это ознакомление, а не подтверждение доступности исполнителей или работающего банковского сценария. Доступ и статусы определяются сервером после входа.</p>
    </section>
  </main>;
  if (!tile || !service) {
    return <main className="guest-explore"><section className="guest-explore-hero">
      <h1>Раздел не найден</h1><p>Вернитесь к каталогу услуг TrakSOS.</p><a className="guest-explore-cta" href="#/">На главную</a>
    </section></main>;
  }
  const selected = service.services.find(x => x.key === itemKey);
  const next = '#/register';
  return <main className={'guest-explore guest-explore-' + serviceId}>
    <a className="guest-explore-back" href="#/">← Все услуги TrakSOS</a>
    <section className="guest-explore-hero">
      <span className="guest-explore-eyebrow">TRAKSOS · ВОЗМОЖНОСТИ СЕРВИСА</span>
      <span className="guest-explore-glyph" aria-hidden="true">{tile.icon}</span>
      <h1>{selected ? selected.label : tile.title}</h1>
      <p>{service.description}</p>
      <div className="guest-explore-actions">
        <a className="guest-explore-cta" href={next} onClick={() => rememberGuestService(serviceId, selected?.key)}>
          Зарегистрироваться
        </a>
        <a className="guest-explore-secondary" href="#/login"
          onClick={() => rememberGuestService(serviceId, selected?.key)}>
          Уже есть аккаунт? Войти
        </a>
      </div>
    </section>
    <section className="guest-explore-section">
      <h2>Что можно выбрать</h2>
      <div className="guest-explore-service-grid">
        {service.services.map(item => <a
          key={item.key}
          href={'#/explore/' + serviceId + '/' + item.key}
          className={'guest-explore-item' + (selected?.key === item.key ? ' selected' : '')}
          onClick={() => rememberGuestService(serviceId, item.key)}>
          <span aria-hidden="true">✦</span><strong>{item.label}</strong><span aria-hidden="true">›</span>
        </a>)}
      </div>
      {serviceId === 'parts' && <p className="guest-explore-note">Выберите категорию, узнайте о возможностях магазина, затем войдите или зарегистрируйтесь для работы с заказами.</p>}
    </section>
    <section className="guest-explore-section">
      <h2>Что внутри личного кабинета</h2>
      <div className="guest-explore-workspaces">
        <article>
          <span>ДЛЯ КЛИЕНТА</span><h3>Личный кабинет</h3>
          {service.client.map(f => <p key={f}><span aria-hidden="true">✓</span> {f}</p>)}
        </article>
        <article>
          <span>ДЛЯ ПАРТНЁРА</span><h3>Рабочий кабинет</h3>
          {service.provider.map(f => <p key={f}><span aria-hidden="true">✓</span> {f}</p>)}
          <a href="#/join" className="guest-explore-partner">Хочу работать с TrakSOS →</a>
        </article>
      </div>
      <p className="guest-explore-note">Это обзор возможностей. Наличие конкретных исполнителей, страховых продуктов и деталей проверяется после входа; демонстрационные данные не являются реальными заявками.</p>
    </section>
  </main>;
}
