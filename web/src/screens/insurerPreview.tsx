import {InsurerCabinet} from './insurer.tsx';
import {InsuranceApplication,InsuranceThread} from './insuranceFlow.tsx';
import {PREVIEW_AGENT,PREVIEW_CLIENT,PREVIEW_NEW,PREVIEW_FEE_PCT,previewGet,insurerPreviewRequestHref,resetInsurerPreview} from '../demo/insurerPreviewApi.ts';
import {useLoad} from '../ui.tsx';
import {fmtTime} from '../api.ts';

export function InsurerPreviewBar(){
  const isClient=location.hash.startsWith(PREVIEW_CLIENT);
  return <div className="service-preview-admin-bar insurance-preview-admin" role="banner" aria-label="Панель администратора в тестовом страховании">
    <div className="service-preview-admin-identity"><strong>TRACKSOS · АДМИНИСТРАТОР</strong>
      <span>Страхование · реальный интерфейс, локальные тестовые данные</span></div>
    <nav className="service-preview-admin-actions" aria-label="Переключить роль в страховой песочнице">
      <a className={!isClient?'insurance-preview-active':''} href={PREVIEW_AGENT}>◇ Вид страховщика</a>
      <a className={isClient?'insurance-preview-active':''} href={PREVIEW_CLIENT}>◉ Вид клиента</a>
      <a href="#/admin/test-center">← Все кабинеты</a>
      <a href="#/admin">Админка</a>
      <button type="button" onClick={()=>{resetInsurerPreview();location.hash=PREVIEW_AGENT;location.reload();}}>↻ Сбросить тест</button>
    </nav>
  </div>;
}

function ClientInsuranceDesk(){
  const data=useLoad<any[]>(()=>previewGet('/api/insurer/requests/client'),[]);
  const rows=data.data??[];
  const received=rows.filter(x=>['received','preparing'].includes(x.insurance_stage)).length;
  const negotiating=rows.filter(x=>['offers_sent','awaiting_payment','paid','processing'].includes(x.insurance_stage)).length;
  const ready=rows.filter(x=>x.insurance_stage==='policy_sent').length;
  return <main className="insurer-workspace stack">
    <section className="insurer-workspace-hero insurance-client-hero">
      <span className="insurance-step-title">TRACKSOS · КАБИНЕТ КЛИЕНТА</span>
      <h1>Страхование вашего автопарка</h1>
      <p>Заявки, предложения компаний и готовые документы — весь процесс в одном личном кабинете.</p>
      <div className="row"><a className="btn" href={PREVIEW_NEW}>+ Подать заявку на страхование</a>
        <a className="btn ghost" href={PREVIEW_AGENT}>Посмотреть очередь агента</a></div>
    </section>
    <div className="banner" role="note">Тестовое оформление без денег и передачи данных страховщикам. Комиссия TrackSOS {PREVIEW_FEE_PCT}% — пример для демонстрации расчёта.</div>
    <div className="insurer-overview">
      <div className="insurer-stat"><span>Всего заявок</span><strong>{rows.length}</strong><small>Мои обращения</small></div>
      <div className="insurer-stat"><span>В обработке</span><strong>{received}</strong><small>У страхового агента</small></div>
      <div className="insurer-stat"><span>Предложения</span><strong>{negotiating}</strong><small>Выбор и оформление</small></div>
      <div className="insurer-stat"><span>Готово</span><strong>{ready}</strong><small>PDF-полисы</small></div>
    </div>
    <section className="card stack">
      <div className="between"><div><span className="insurance-step-title">СТРАХОВЫЕ ОБРАЩЕНИЯ</span><h2>Мои заявки</h2></div>
        <a className="btn small" href={PREVIEW_NEW}>Новая заявка</a></div>
      {!data.data&&<div className="empty">{data.error??'Загружаем обращения…'}</div>}
      {data.data&&!rows.length&&<div className="empty">Пока нет заявок. Начните с заполнения анкеты грузовика.</div>}
      <div className="insurer-case-grid">{rows.map(x=><article key={x.id} className="insurer-case-card">
        <div className="between"><span className="insurer-case-no">ЗАЯВКА · {x.id.slice(-8)}</span>
          <span className="pill">{x.stageLabel}</span></div>
        <h3>{x.brand} {x.model}</h3><p>{x.plate} · {fmtTime(x.created_at)}</p>
        <p>{x.comment||'Обращение по страхованию грузового транспорта'}</p>
        <a className="btn" href={insurerPreviewRequestHref(x.id,true)}>Открыть заявку и предложения →</a>
      </article>)}</div>
    </section>
  </main>;
}

export function InsurerPreviewPage({section,sub,id}:{section?:string;sub?:string;id?:string}){
  if(section==='client'){
    if(sub==='new')return <InsuranceApplication vehicleId="demo-insurance-truck"/>;
    if(sub==='request'&&id)return <InsuranceThread requestId={id}/>;
    return <ClientInsuranceDesk/>;
  }
  if(section==='inspections')return <InsurerCabinet inspectionOnly/>;
  if(section==='insurance'){
    if(sub==='request'&&id)return <InsuranceThread requestId={id}/>;
    if(sub==='queue')return <InsurerCabinet section={id}/>;
    return <InsurerCabinet/>;
  }
  if(!section||section==='queue')return <InsurerCabinet section={sub}/>;
  return <main className="service-preview-unavailable"><h1>Страховая песочница</h1>
    <p>Настоящие расчёты, выплаты, поддержка и магазин здесь отключены. Для полного прогона используйте заявки, предложения, оплату и отправку PDF внутри тестового страхового кабинета.</p>
    <a className="btn" href={PREVIEW_AGENT}>Вернуться в страховой кабинет</a></main>;
}
