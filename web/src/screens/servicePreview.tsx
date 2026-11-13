import {BaseHome,BaseCar,BaseMoney,BaseSetup} from './base.tsx';
import {resetServicePreview,servicePreviewHref} from '../demo/servicePreviewApi.ts';

export function ServicePreviewBar(){
  return <div className="service-preview-admin-bar" role="banner" aria-label="Панель администратора в тестовом кабинете">
    <div className="service-preview-admin-identity"><strong>TRACKSOS · АДМИНИСТРАТОР</strong>
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
  return <main className="service-preview-unavailable">
    <div className="service-preview-unavailable-icon" aria-hidden="true">▣</div>
    <h1>Работаем в тестовом кабинете СТО</h1>
    <p>Внешние разделы (реальный магазин, звонки, поддержка, платежи) здесь намеренно отключены.
      Заявки, карточки машин, стадии ремонта, профиль рембазы и финансовый раздел работают в песочнице
      на тех же компонентах, что у зарегистрированного сервиса.</p>
    <a className="btn" href={servicePreviewHref('base')}>Вернуться в рабочий кабинет СТО</a>
  </main>;
}
