import {BaseHome,BaseCar,BaseMoney,BaseSetup} from './base.tsx';
import {resetServicePreview,servicePreviewHref} from '../demo/servicePreviewApi.ts';

export function ServicePreviewBar(){
  return <div className="service-preview-admin-bar" role="banner" aria-label="Панель администратора в тестовом кабинете">
    <div className="service-preview-admin-identity"><strong>TRAKSOS · АДМИНИСТРАТОР</strong>
      <span>Тестовый режим СТО · данные вымышленные</span></div>
    <div className="service-preview-admin-actions">
      <a href="#/admin/test-center">← Назад к выбору кабинетов</a>
      <a href="#/admin">В админку</a>
      <button type="button" onClick={()=>{resetServicePreview();location.reload();}}>
        <span aria-hidden="true">↻</span> Сбросить тест
      </button>
    </div>
  </div>;
}

export function ServicePreviewPage({section,sub,id}:{section?:string;sub?:string;id?:string}){
  if(!section||section==='base'){
    if(sub==='car'&&id)return <BaseCar id={id}/>;
    if(sub==='money')return <BaseMoney/>;
    if(sub==='me')return <BaseSetup/>;
    return <BaseHome/>;
  }
  if(section==='menu'){
    const safeSections=[
      ['base','Рабочий стол СТО'],
      ['base/inbox','Заявки и заказы'],
      ['base/me','Карточка рембазы'],
      ['base/money','Финансы в песочнице']
    ];
    return <main className="tr-mobile-menu-page tr-service-preview-safe-menu" aria-label="Меню тестовой СТО">
      <div className="tr-mobile-menu-hero">
        <div><span className="tr-mobile-menu-eyebrow">TRAKSOS · ТЕСТОВЫЙ ЦЕНТР</span>
          <h1>Меню СТО</h1>
          <p>Только проверочные разделы · данные вымышленные</p></div>
        <span aria-hidden="true">▤</span>
      </div>
      <section className="tr-mobile-menu-section">
        <header className="tr-mobile-menu-section-head">
          <span className="tr-mobile-menu-section-icon" aria-hidden="true">▤</span>
          <span><h2>Рабочие разделы</h2><small>Каждый пункт остаётся внутри безопасной песочницы</small></span>
        </header>
        <nav className="tr-mobile-menu-links" aria-label="Тестовые разделы СТО">
          {safeSections.map(([key,label])=><a key={key} href={servicePreviewHref(key)}>
            <span>{label}</span><span className="tr-mobile-menu-chevron" aria-hidden="true">›</span>
          </a>)}
        </nav>
      </section>
      <a className="tr-mobile-menu-home" href="#/admin/test-center">← Вернуться в центр тестирования</a>
    </main>;
  }
  return <main className="service-preview-unavailable">
    <div className="service-preview-unavailable-icon" aria-hidden="true">▣</div>
    <h1>Работаем в тестовом кабинете СТО</h1>
    <p>Внешние разделы (реальный магазин, звонки, поддержка, платежи) здесь намеренно отключены.
      Заявки, карточки машин, стадии ремонта, профиль рембазы и финансовый раздел работают в песочнице
      на тех же компонентах, что у зарегистрированного сервиса.</p>
    <a className="btn" href={servicePreviewHref('base')}>Вернуться в рабочий кабинет СТО</a>
  </main>;
}
