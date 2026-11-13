// The ACTUAL partner cabinet, also used unchanged in an isolated admin preview.
// Preview never queries live applications or sends a real insurer/payout request.
import {useState} from 'react';
import {get,patch,fmtTime} from '../api.ts';
import {useLoad,useAction} from '../ui.tsx';
import {insurerPreviewActive,previewGet,previewPatch,insurerPreviewRequestHref,PREVIEW_CLIENT} from '../demo/insurerPreviewApi.ts';

const status:Record<string,string>={
 received:'Получено',preparing:'Принято · готовятся расчёты',
 offers_sent:'Предложения отправлены',awaiting_payment:'Ожидается оплата',
 paid:'Оплачено · ждёт оформления',selected:'Клиент выбрал вариант',
 processing:'Оформляется полис',policy_sent:'Полис отправлен',
 sent_to_partner:'Ждёт оформления',completed:'Полис оформлен',rejected:'Отказ'};
type View='pending'|'all'|'done';
export function InsurerCabinet({section}:{section?:string}={}){
  const preview=insurerPreviewActive();
  const data=useLoad<any[]>(()=>preview?previewGet('/api/insurer/requests'):get('/api/insurer/requests'),[preview],
    event=>!preview&&event.type==='vehicle_service');
  const {busy,run}=useAction();
  const [filter,setFilter]=useState<View>('all');
  const [stageFocus,setStageFocus]=useState(section??'');
  const [search,setSearch]=useState('');
  const [notes,setNotes]=useState<Record<string,string>>({});
  const [expires,setExpires]=useState<Record<string,string>>({});
  const rows=data.data??[];
  const active=rows.filter(x=>x.status==='sent_to_partner').length;
  const received=rows.filter(x=>x.insurance_stage==='received'||x.insurance_stage==='paid').length;
  const done=rows.filter(x=>x.status!=='sent_to_partner').length;
  const visible=rows.filter(r=>{
    if(stageFocus&&r.insurance_stage!==stageFocus)return false;
    if(filter==='pending'&&r.status!=='sent_to_partner')return false;
    if(filter==='done'&&r.status==='sent_to_partner')return false;
    const needle=search.trim().toLocaleLowerCase('ru-RU');
    return [r.brand,r.model,r.plate,r.comment].some(x=>String(x??'').toLocaleLowerCase('ru-RU').includes(needle));
  });
  const update=async(id:string,state:'completed'|'rejected')=>{
    const note=(notes[id]??'').trim(),expire=expires[id];
    if(state==='rejected'&&!note){alert('Укажите причину отказа.');return;}
    if(state==='completed'&&!expire){alert('Укажите дату окончания полиса.');return;}
    const response=await run(()=>preview?previewPatch('/api/insurer/requests/'+id,{status:state,note,policyExpiresOn:expire})
      :patch('/api/insurer/requests/'+id,{status:state,note,policyExpiresOn:expire}),
    'Статус заявки обновлён');
    if(response)data.reload();
  };
  return <main className="insurer-workspace stack">
    <section className="insurer-workspace-hero">
      <div className="insurer-workspace-hero-art" aria-hidden="true">◇</div>
      <span className="insurance-step-title">TRACKSOS · ПАРТНЁРСКИЙ КАБИНЕТ</span>
      <h1>Кабинет страховщика</h1>
      <p>Заявки на грузовой транспорт, расчёты страховых компаний, выбор клиента и готовые полисы — в одном рабочем месте.</p>
      <div className="row">
        <button type="button" className="btn" onClick={()=>{setStageFocus('');setFilter('pending');}}>Входящие заявки · {active}</button>
        <button type="button" className="btn ghost" onClick={()=>{setStageFocus('');setFilter('all');}}>Все страховые дела</button>
      </div>
    </section>
    {preview&&<div className="banner" role="note"><b>Песочница · настоящий интерфейс страховщика</b>
      <span>Для проверки всей цепочки создайте заявление в виде клиента. Все действия и суммы вымышленные — сервер не получает оплату и настоящие заявки.</span>
      <a className="btn small" href={PREVIEW_CLIENT}>Перейти в кабинет клиента и подать заявку</a>
    </div>}
    <div className="insurer-overview">
      <div className="insurer-stat"><span>Назначено</span><strong>{rows.length}</strong><small>Всего заявок</small></div>
      <div className="insurer-stat"><span>Нужно действие</span><strong>{received}</strong><small>Получены или оплачены</small></div>
      <div className="insurer-stat"><span>В работе</span><strong>{active}</strong><small>Текущие обращения</small></div>
      <div className="insurer-stat"><span>Завершено</span><strong>{done}</strong><small>Архив полисов</small></div>
    </div>
    <section className="card stack">
      <div className="between"><div><span className="insurance-step-title">РАБОЧАЯ ОЧЕРЕДЬ</span><h2>Страховые обращения</h2></div><span className="pill">{visible.length} заявок</span></div>
      <div className="insurer-toolbar">
        <div className="row" role="group" aria-label="Фильтр страховых заявок">
          {([['all','Все'],['pending','В работе'],['done','Завершены']] as const).map(([key,title])=>
            <button key={key} type="button" className="chip" aria-pressed={filter===key}
              onClick={()=>{setStageFocus('');setFilter(key);}}>{title}</button>)}
        </div>
        <label className="stack"><span className="label">Поиск по грузовику</span>
          <input className="field" type="search" placeholder="Марка, модель, госномер" value={search}
            onChange={e=>setSearch(e.target.value)}/></label>
      </div>
      {stageFocus&&<div className="banner" role="status">Раздел: <b>{status[stageFocus]??stageFocus}</b>. <button className="btn ghost small" type="button" onClick={()=>setStageFocus('')}>Все заявки</button></div>}
      {!data.data&&<div className="empty">{data.error??'Загружаем страховые заявки…'}</div>}
      {!!data.data&&!visible.length&&<div className="empty">{rows.length===0?'Назначенных заявок пока нет.':'Заявок по выбранному фильтру пока нет.'}
        {preview&&' Создайте первую заявку из тестового кабинета клиента.'}</div>}
      <div className="insurer-case-grid">
        {visible.map(r=><article className="insurer-case-card" key={r.id}>
          <div className="between"><span className="insurer-case-no">СТРАХОВОЕ ДЕЛО · {String(r.id).slice(-8)}</span>
            <span className="pill">{status[r.insurance_stage]??status[r.status]??r.status}</span></div>
          <h3>{r.brand} {r.model}</h3>
          <p>{r.plate||'Номер не указан'} · {r.created_at?fmtTime(r.created_at):'Тестовый запрос'}</p>
          {r.comment&&<p>{r.comment}</p>}
          {r.insurance_stage&&<div className="insurer-case-meta"><span>Данные ТС и страхователя</span><b>Предложения · чат · полис</b></div>}
          {r.insurance_stage&&<a className="btn" href={preview?insurerPreviewRequestHref(r.id):'#/insurance/request/'+r.id}>
            Открыть страховое дело →</a>}
          {!r.insurance_stage&&r.status==='sent_to_partner'&&<div className="stack">
            <label className="stack">Срок действия полиса<input className="field" type="date" value={expires[r.id]??''}
              onChange={e=>setExpires(old=>({...old,[r.id]:e.target.value}))}/></label>
            <textarea className="field" aria-label="Комментарий страховщика" maxLength={2000}
              placeholder="Комментарий / причина отказа" value={notes[r.id]??''}
              onChange={e=>setNotes(old=>({...old,[r.id]:e.target.value}))}/>
            <div className="row"><button type="button" className="btn small" disabled={busy}
              onClick={()=>update(r.id,'completed')}>Полис оформлен</button>
              <button type="button" className="btn ghost small" disabled={busy}
                onClick={()=>update(r.id,'rejected')}>Отказать</button></div>
          </div>}
          {r.status==='completed'&&<span className="note">Готовый полис уже передан клиенту.</span>}
        </article>)}
      </div>
    </section>
    <section className="card stack">
      <span className="insurance-step-title">СПРАВКА ПАРТНЁРА</span>
      <b>Помощь и условия работы</b>
      <p className="note">Оформление полисов выполняется агентом вручную. Контакты, документы и история согласования доступны в рамках соответствующей страховой заявки.</p>
      <a className="btn ghost small" href="#/help">Помощь, условия и настройки</a>
    </section>
  </main>;
}
