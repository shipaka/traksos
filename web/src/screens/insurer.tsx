// Кабинет партнёра-страховщика: только назначенные администратором страховые заявки.
import { useState } from 'react';
import { get, patch, fmtTime } from '../api.ts';
import { useLoad, useAction, useMe, useRoute } from '../ui.tsx';
import { insurancePresentation, insuranceQueueGroup } from '../insurancePresentation.ts';

const labels: Record<string, string> = {
  sent_to_partner: 'Ждёт оформления', completed: 'Полис оформлен', rejected: 'Отказ',
};
/** Chat entry always resolves to a real assigned insurance case, never a
 * generic or cross-partner inbox. The thread owns messages and permissions. */
export function InsurerChats() {
  const q=useLoad<any[]>(()=>get('/api/insurer/requests'),[],e=>e.type==='vehicle_service');
  return <main className="and19-chats and19-workspace and20-insurer-chats">
    <h1>Чаты по страховым делам</h1>
    <p>Уточнения и документы хранятся внутри соответствующей заявки.</p>
    {!q.data&&<div className="and19-panel">{q.error
      ? 'Не удалось открыть переписку: '+q.error : 'Загружаем назначенные дела…'}</div>}
    {q.data?.length===0&&<div className="and19-panel">Назначенных страховых дел пока нет.</div>}
    {q.data?.map(r=><a className="and19-row-link" key={r.id}
      href={'#/insurance/request/'+encodeURIComponent(r.id)}>
      <span>{[r.brand,r.model].filter(Boolean).join(' ') || 'Страховое дело'}
        <small>{insurancePresentation(r.insurance_stage,r.status,'partner').label}</small>
      </span>
      <span>Чат ›</span>
    </a>)}
  </main>;
}

export function InsurerCabinet({inspectionOnly=false}:{inspectionOnly?:boolean}={}) {
  const { me } = useMe();
  const dualPartnerRole = !!me?.roles.includes('insurer') && !!me?.roles.includes('inspection_operator');
  const [workspace,setWorkspace]=useState<'insurance'|'inspection'|'finance'|'common'>(inspectionOnly?'inspection':'insurance');
  const route = useRoute();
  const inspectionId = inspectionOnly && route[0]==='inspections' ? route[1] : undefined;
  const [checkedSteps,setCheckedSteps] = useState<Record<string,boolean>>({});
  const finance=useLoad(()=>get<{entries:{id:string;kind:string;entry_type:string;amount_kopecks:string;note:string|null;created_at:string}[];totals:{kind:string;accrued:string;paid:string;balance:string}[]}>('/api/insurer/finance'),[]);
  const money=(value:string|number)=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(Number(value)/100);
  const inspections=useLoad(()=>get<any[]>('/api/insurer/inspections'),[],
    event=>event.type==='vehicle_service');
  const requests = useLoad(() => inspectionOnly ? Promise.resolve([]) : get('/api/insurer/requests'), [],
    (event) => event.type === 'vehicle_service');
  const { busy, run } = useAction();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [inspectionNotes,setInspectionNotes]=useState<Record<string,string>>({});
  const [inspectionView,setInspectionView]=useState<'active'|'history'>('active');
  const [expires, setExpires] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<'action' | 'active' | 'all' | 'closed'>(
    route[1]==='requests' ? 'all' : 'action');
  const [search, setSearch] = useState('');
  async function update(id: string, status: 'completed' | 'rejected') {
    const note = (notes[id] ?? '').trim();
    const policyExpiresOn = expires[id];
    if (status === 'rejected' && !note) {
      alert('Укажите причину отказа — клиент должен её видеть.');
      return;
    }
    if (status === 'completed' && !policyExpiresOn) {
      alert('Укажите дату окончания полиса.');
      return;
    }
    if(inspectionOnly)return;
    const result = await run(() => patch(`/api/insurer/requests/${id}`, {
      status, note: note || undefined,
      policyExpiresOn: status === 'completed' ? policyExpiresOn : undefined,
    }), 'Заявка обновлена');
    if (result) {
      setNotes((old) => { const value = { ...old }; delete value[id]; return value; });
      requests.reload();
    }
  }
  async function decideInspection(id:string,status:'completed'|'rejected') {
    const note=(inspectionNotes[id]??'').trim();
    if(status==='rejected'&&!note){alert('Укажите причину отказа');return;}
    const result=await run(()=>patch('/api/insurer/inspections/'+id,{status,note:note||undefined}),
      status==='completed'?'Техосмотр отмечен выполненным':'Заявка отклонена');
    if(result) inspections.reload();
  }
  const rows: any[] | undefined = requests.data;
  const visible = (rows ?? []).filter((r) => {
    if (filter !== 'all' && insuranceQueueGroup(r.insurance_stage, r.status) !== filter) return false;
    return [r.brand, r.model, r.plate, r.comment].some((value) => String(value ?? '').toLocaleLowerCase('ru-RU').includes(search.trim().toLocaleLowerCase('ru-RU')));
  });
  // Separate approved inspection detail: available only to the assigned operator.
  // The existing /api/insurer/inspections endpoint enforces tenant access.
  if(inspectionId) {
    const item = inspections.data?.find(r=>String(r.id)===inspectionId);
    if(!inspections.data) return <main className="cabinet-page and20-inspection-detail">
      <a href="#/inspections" className="and20-return">← К техосмотрам</a>
      <div className="card">{inspections.error ? 'Не удалось загрузить техосмотр: '+inspections.error
        : 'Загрузка назначенного техосмотра…'}</div>
    </main>;
    if(!item) return <main className="cabinet-page and20-inspection-detail">
      <a href="#/inspections" className="and20-return">← К техосмотрам</a>
      <div className="card">Техосмотр не найден среди назначенных вам заявок.</div>
    </main>;
    const canRecord = item.status==='sent_to_partner';
    const verified = ['documents','vehicle','result'].every(k=>checkedSteps[inspectionId+':'+k]===true);
    const note=(inspectionNotes[inspectionId]??'').trim();
    return <main className="cabinet-page and20-inspection-detail">
      <a href="#/inspections" className="and20-return">← К техосмотрам</a>
      <section className="and20-role-header">
        <span className="and20-kicker">TRAKSOS · ТЕХОСМОТР</span>
        <h1>Техосмотр №{item.number||item.id}</h1>
        <span className="and20-state">{item.status==='completed'?'Завершён':
          item.status==='rejected'?'Отказ':'Назначен оператору'}</span>
      </section>
      <section className="card and20-inspection-vehicle">
        <strong>{[item.brand,item.model,item.year].filter(Boolean).join(' ') || 'Транспортное средство'}</strong>
        <span>{item.plate||'Госномер не указан'}</span>
        {item.vin&&<span>VIN: {item.vin}</span>}
        {item.customer_name&&<span>Клиент: {item.customer_name}</span>}
        {item.comment&&<p>{item.comment}</p>}
      </section>
      <div className="and20-inspection-stages" aria-label="Ход техосмотра">
        {['Получено','Назначено','Осмотр','Завершено'].map((step,index)=>
          <span key={step} className={item.status==='completed'?'passed':index===1?'current':''}>{step}</span>)}
      </div>
      {canRecord ? <section className="card and20-inspection-checks">
        <h2>Этапы работы</h2>
        <p className="note">Отметьте только реально выполненные действия. TrakSOS не выдаёт диагностическую карту.</p>
        {([
          ['documents','Проверка документов'],
          ['vehicle','Осмотр транспортного средства'],
          ['result','Результат проверки'],
        ] as const).map(([key,label])=><label key={key} className="and20-inspection-check">
          <input type="checkbox" checked={checkedSteps[inspectionId+':'+key]===true}
            onChange={e=>setCheckedSteps(old=>({...old,[inspectionId+':'+key]:e.target.checked}))}/>
          <span>{label}</span>
        </label>)}
        <label className="and20-inspection-note">Комментарий / результат осмотра
          <textarea className="field" maxLength={2000} value={inspectionNotes[inspectionId]||''}
            placeholder="Фактические результаты проверки"
            onChange={e=>setInspectionNotes(old=>({...old,[inspectionId]:e.target.value}))}/>
        </label>
        <button type="button" className="btn" disabled={busy||!verified||note.length<5}
          onClick={()=>decideInspection(inspectionId,'completed')}>Внести результат техосмотра</button>
        <button type="button" className="btn ghost" disabled={busy||note.length<5}
          onClick={()=>decideInspection(inspectionId,'rejected')}>Отказать с указанием причины</button>
        <p className="note">Завершение заявки в TrakSOS не означает выдачу диагностической карты. Её оформляют отдельно в уполномоченной системе.</p>
      </section> : <section className="card">
        <strong>{item.status==='completed'?'Заявка завершена':'Осмотр не активен'}</strong>
        {item.staff_note&&<p>{item.staff_note}</p>}
      </section>}
    </main>;
  }
  const insurerPriority = (rows??[]).find(r=>insuranceQueueGroup(r.insurance_stage,r.status)==='action')
    ??(rows??[]).find(r=>insuranceQueueGroup(r.insurance_stage,r.status)==='active');
  return (
    <main className="cabinet-page">
      <header className="cabinet-heading">
        <span className="label">TRAKSOS · Партнёрский кабинет</span>
        <h1>{workspace==='insurance'?'Страхование':workspace==='inspection'?'Техосмотры':workspace==='finance'?'Финансы':'Общие настройки'}</h1>
      </header>
      <nav className="partner-workspaces" aria-label="Разделы кабинета партнёра">
        {([['insurance','Страховки'],['inspection','Техосмотры'],['finance','Финансы'],['common','Общее']] as const)
          .filter(([key])=>(!inspectionOnly||key!=='insurance') && !(dualPartnerRole && (key==='insurance'||key==='inspection')))
          .map(([key,label])=><button type="button" key={key} className={'btn ghost'+(workspace===key?' active':'')}
            aria-pressed={workspace===key} onClick={()=>setWorkspace(key)}>{label}</button>)}
      </nav>
      {workspace==='insurance'&&!inspectionOnly&&<section className="and20-insurer-overview"
        aria-label="Оперативный страховой кабинет">
        <div className="and20-role-header">
          <span className="and20-kicker">TRAKSOS · СТРАХОВОЙ ПАРТНЁР</span>
          <h2>Рабочий стол</h2>
        </div>
        <div className="and20-partner-stats">
          {([
            ['Новые',rows?.filter(r=>r.insurance_stage==='received'||r.status==='sent_to_partner').length],
            ['В расчёте',rows?.filter(r=>r.insurance_stage==='preparing').length],
            ['Отправлены',rows?.filter(r=>r.insurance_stage==='offers_sent').length],
            ['Оформлены',rows?.filter(r=>r.insurance_stage==='policy_sent'||r.status==='completed').length],
          ] as [string,number|undefined][]).map(([label,value])=><div key={label} className="and20-partner-stat">
            <small>{label}</small><strong>{value??'—'}</strong>
          </div>)}
        </div>
        {insurerPriority&&<a className="and20-insurer-focus" href={'#/insurance/request/'+encodeURIComponent(insurerPriority.id)}>
          <span className="and20-card-heading">Заявка · {insurerPriority.brand||'Грузовой автомобиль'} {insurerPriority.model||''}</span>
          <span className="and20-state">{insurancePresentation(insurerPriority.insurance_stage,insurerPriority.status,'partner').label}</span>
          <span className="and20-small-text">{insurancePresentation(insurerPriority.insurance_stage,insurerPriority.status,'partner').next}</span>
          <b>Открыть страховое дело ›</b>
        </a>}
      </section>}
      {workspace==='inspection'&&<section className="stack">
        <p className="sub">Здесь отображаются исключительно назначенные вам заявки на техосмотр. Страховые полисы и предложения в этом разделе не показываются.</p>
        <div className="cabinet-metrics">
          <div className="card tile"><span className="label">Заявок на техосмотр</span><b className="tile-value">{inspections.data?.length??'—'}</b></div>
          <div className="card tile"><span className="label">В работе</span><b className="tile-value">{inspections.data?.filter(r=>!['completed','rejected','cancelled'].includes(r.status)).length??'—'}</b></div>
          <div className="card tile"><span className="label">История</span><b className="tile-value">{inspections.data?.filter(r=>['completed','rejected','cancelled'].includes(r.status)).length??'—'}</b></div>
        </div>
        <div className="row" role="group" aria-label="Показ техосмотров">
          <button type="button" className="chip" aria-pressed={inspectionView==='active'} onClick={()=>setInspectionView('active')}>В работе</button>
          <button type="button" className="chip" aria-pressed={inspectionView==='history'} onClick={()=>setInspectionView('history')}>История техосмотров</button>
          <button type="button" className="btn ghost small" onClick={inspections.reload}>Обновить</button>
        </div>
        {!inspections.data?<div className="empty">{inspections.error?'Не удалось загрузить техосмотры: '+inspections.error:'Загружаем техосмотры…'}</div>:
          inspections.data.length===0?<div className="card stack"><h2>Техосмотров пока нет</h2><p>Здесь появятся назначенные заявки и история. Оформление диагностической карты будет добавлено отдельно.</p><button type="button" className="btn ghost" onClick={inspections.reload}>Обновить</button></div>:
          inspections.data.filter(r=>inspectionView==='history' ? ['completed','rejected','cancelled'].includes(r.status) : !['completed','rejected','cancelled'].includes(r.status)).length===0 ?
          <div className="empty">{inspectionView==='history'?'История техосмотров пока пуста':'Активных техосмотров сейчас нет'}</div> :
          inspections.data.filter(r=>inspectionView==='history' ? ['completed','rejected','cancelled'].includes(r.status) : !['completed','rejected','cancelled'].includes(r.status)).map(r=><article className="card stack" key={r.id}>
            <b>{r.brand} {r.model}</b><span>{r.plate||'Номер не указан'} · {fmtTime(r.created_at)}</span>
            {inspectionOnly&&<a className="btn" href={'#/inspections/'+encodeURIComponent(r.id)}>Открыть техосмотр и этапы →</a>}
            <span className="pill">{r.status==='completed'?'Завершён':r.status==='rejected'?'Отклонён':'В обработке'}</span>
            {r.comment&&<p>{r.comment}</p>}{r.staff_note&&<p className="note">{r.staff_note}</p>}
            {r.status==='sent_to_partner'&&<>
              <label className="stack"><span className="label">Комментарий или причина отказа</span>
                <textarea className="field" maxLength={2000} value={inspectionNotes[r.id]??''}
                  onChange={e=>setInspectionNotes(v=>({...v,[r.id]:e.target.value}))}/></label>
              <div className="row">
                <button type="button" className="btn small" disabled={busy}
                  onClick={()=>decideInspection(r.id,'completed')}>Отметить выполненным</button>
                <button type="button" className="btn ghost small" disabled={busy}
                  onClick={()=>decideInspection(r.id,'rejected')}>Отказать</button>
              </div>
              <p className="note">Отметка выполнения не является выдачей диагностической карты.</p>
            </>}
          </article>)}
        <p className="note">Назначение выполняет администратор. Выполнение заявки фиксируется отдельно от выдачи диагностической карты.</p>
      </section>}
      {workspace==='finance'&&<section className="stack">
        <p className="sub">Подтверждённые финансовые проводки по двум направлениям. Заявки без начислений не считаются доходом.</p>
        {!finance.data?<div className="empty">{finance.error?'Не удалось загрузить финансы: '+finance.error:'Загружаем финансовый реестр…'}</div>:<>
          <div className="cabinet-metrics">
            {(['insurance','inspection'] as const).map(kind=>{
              const total=finance.data!.totals.find(t=>t.kind===kind);
              return <div className="card tile" key={kind}>
                <span className="label">{kind==='insurance'?'Страхование':'Техосмотры'}</span>
                <b className="tile-value">{money(total?.balance??0)}</b>
                <small>Начислено: {money(total?.accrued??0)} · Выплачено: {money(total?.paid??0)}</small>
              </div>;
            })}
            <div className="card tile"><span className="label">Общий остаток</span>
              <b className="tile-value">{money(finance.data.totals.reduce((sum,t)=>sum+Number(t.balance),0))}</b>
              <small>По всем подтверждённым проводкам</small>
            </div>
          </div>
          <h2>История операций</h2>
          {finance.data.entries.length===0?<div className="empty">Подтверждённых операций пока нет.</div>:
            finance.data.entries.map(entry=><article className="card between" key={entry.id}>
              <div className="stack"><b>{entry.kind==='insurance'?'Страхование':'Техосмотр'} · {entry.entry_type==='accrual'?'Начисление':entry.entry_type==='payout'?'Выплата':'Корректировка'}</b>
                <small>{fmtTime(entry.created_at)}</small>{entry.note&&<small>{entry.note}</small>}</div>
              <b>{entry.entry_type==='accrual'?'+':'−'}{money(entry.amount_kopecks)}</b>
            </article>)}
        </>}
      </section>}
      {workspace==='common'&&<section className="card stack">
        <h2>Общие разделы партнёра</h2>
        <a className="linkrow" href="#/profile">Профиль и настройки</a>
        <a className="linkrow" href="#/help">Помощь и инструкции</a>
        <a className="linkrow" href="#/offer/privacy">Обработка персональных данных</a>
      </section>}
      {workspace==='insurance'&&!inspectionOnly&&<>
      <div className="sub">Только страховые заявки, переданные вам TrakSOS. Остальные автомобили и сведения о клиентах недоступны.</div>
      {!rows ? <div className="empty">{requests.error ? `Не удалось загрузить: ${requests.error}` : 'Загружаем заявки…'}</div>
        : !rows.length ? <InsurerEmptyState onRefresh={requests.reload} />
        : <div className="stack">
          <div className="cabinet-metrics insurer-insurance-metrics">
            <div className="card tile"><span className="label">Всего назначено</span><b className="tile-value">{rows.length}</b></div>
            <div className="card tile"><span className="label">Требуют действий</span><b className="tile-value">{rows.filter((r) => insuranceQueueGroup(r.insurance_stage,r.status)==='action').length}</b></div>
            <div className="card tile"><span className="label">В работе</span><b className="tile-value">{rows.filter((r) => insuranceQueueGroup(r.insurance_stage,r.status)==='active').length}</b></div>
            <div className="card tile"><span className="label">Закрыто</span><b className="tile-value">{rows.filter((r) => insuranceQueueGroup(r.insurance_stage,r.status)==='closed').length}</b></div>
          </div>
          <div className="web-case-toolbar">
            <div className="row" role="group" aria-label="Фильтр страховых заявок">
              {([['action', 'Требуют действий'], ['active', 'В работе'], ['all', 'Все'], ['closed', 'Закрытые']] as const).map(([key, title]) => (
                <button key={key} type="button" className="chip" aria-pressed={filter === key} onClick={() => setFilter(key)}>{title}</button>
              ))}
            </div>
            <label className="stack">
              <span className="label">Найти автомобиль</span>
              <input className="field" type="search" placeholder="Марка, модель или госномер"
                value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
          </div>
          <span className="label">Показано заявок: {visible.length}</span>
          {!visible.length && <div className="empty">{filter==='action'?'Нет заявок, требующих действий. Новые обращения появятся здесь.':filter==='active'?'Нет заявок в работе.':'По выбранным фильтрам заявок нет.'}</div>}
          <div className="web-insurance-grid">
          {visible.map((r) => {
            const state=insurancePresentation(r.insurance_stage,r.status,'partner');
            return <details key={r.id} className={'card insurer-case-card tone-'+state.tone}>
              <summary className="insurer-case-summary">
                <span className="insurer-case-summary-main">
                  <span className="insurance-step-title">СТРАХОВОЕ ДЕЛО · {r.plate || 'БЕЗ НОМЕРА'}</span>
                  <strong>{r.brand} {r.model ?? ''}</strong>
                  <span className="insurer-case-next">{state.next}</span>
                  <small>Поступила {fmtTime(r.created_at)} · нажмите для подробностей</small>
                </span>
                <span className={'insurer-case-state tone-'+state.tone}>
                  <span className="insurer-case-state-dot" aria-hidden="true">●</span><span>{state.label}</span>
                </span>
              </summary>
              <div className="stack">
                <span className="note">{r.plate || 'Без номера'} · Подана {fmtTime(r.created_at)}</span>
                {r.comment && <span className="note">Комментарий клиента: {r.comment}</span>}
                {r.insurance_stage && <div className="insurance-agent-preview">
                  <b>Следующий шаг: {state.next}</b>
                  <p className="note">{state.detail} ФИО, сведения о грузовике, предложения и переписка открываются в рабочем деле.</p>
                  <a className="btn" href={`#/insurance/request/${r.id}`}>Открыть страховую заявку и чат →</a>
                </div>}
                {r.staff_note && <span className="note">Последний ответ: {r.staff_note}</span>}
                {r.policy_expires_on && <span className="note">Срок полиса: {String(r.policy_expires_on).slice(0, 10)}</span>}
                {r.status === 'sent_to_partner' && !r.insurance_stage && <>
                  <label className="stack">
                    <span className="label">Действует до</span>
                    <input className="field" type="date" value={expires[r.id] ?? ''}
                      onChange={(e) => setExpires((old) => ({ ...old, [r.id]: e.target.value }))} />
                  </label>
                  <textarea className="field" aria-label="Комментарий страховщика" maxLength={2000}
                    placeholder="Комментарий или причина отказа"
                    value={notes[r.id] ?? ''} onChange={(e) => setNotes((old) => ({ ...old, [r.id]: e.target.value }))} />
                  <div className="grid2">
                    <button type="button" className="btn small" disabled={busy} onClick={() => update(r.id, 'completed')}>Полис оформлен</button>
                    <button type="button" className="btn ghost small" disabled={busy} onClick={() => update(r.id, 'rejected')}>Отказать</button>
                  </div>
                </>}
              </div>
            </details>;
          })}
          </div>
        </div>}
      </>}

    </main>
  );
}


function InsurerEmptyState({onRefresh}:{onRefresh:()=>void}){
  const stages=[
    ['◇','Получение обращения','Клиент выбирает страхового агента и передаёт сведения о грузовике.'],
    ['▤','Подготовка расчётов','Вы проверяете документы и вручную готовите до 20 предложений.'],
    ['◈','Выбор клиентом','Клиент сравнивает стоимость и подтверждает нужный вариант.'],
    ['✓','Выдача полиса','Вы оформляете документ у страховщика и прикрепляете PDF в переписке.'],
  ];
  return <div className="insurer-empty-workspace stack">
    <div className="insurer-overview">
      <div className="insurer-stat"><span>Назначено</span><strong>0</strong><small>Пока нет заявок</small></div>
      <div className="insurer-stat"><span>Входящие</span><strong>0</strong><small>Ожидают приёма</small></div>
      <div className="insurer-stat"><span>На оформлении</span><strong>0</strong><small>Дела в работе</small></div>
      <div className="insurer-stat"><span>Завершены</span><strong>0</strong><small>Переданные полисы</small></div>
    </div>
    <section className="card insurer-empty-intro">
      <div className="insurer-empty-symbol" aria-hidden="true">◇</div>
      <div className="stack"><span className="insurance-step-title">РАБОЧАЯ ОЧЕРЕДЬ</span>
        <h2>Назначенных заявок пока нет</h2>
        <p>Когда клиент выберет вас страховым партнёром, здесь появится его обращение, анкета автомобиля и переписка.
        Заявки от других агентств недоступны.</p>
        <div className="row"><button className="btn small" type="button" onClick={onRefresh}>↻ Проверить новые заявки</button>
          <a className="btn ghost small" href="#/profile">Профиль партнёра</a></div>
      </div>
    </section>
    <section className="card insurer-workflow-guide">
      <div><span className="insurance-step-title">РАБОЧИЙ ПРОЦЕСС</span><h2>Как обрабатывается страхование</h2>
        <p className="note">Оформление у страховой компании проходит вручную, без API-интеграции.</p></div>
      <div className="insurer-workflow-steps">{stages.map(([symbol,title,description],i)=>
        <div className="insurer-workflow-step" key={title}>
          <span className="insurer-workflow-icon" aria-hidden="true">{symbol}</span>
          <small>Этап {i+1}</small><b>{title}</b><p>{description}</p>
        </div>)}
      </div>
    </section>
  </div>;
}
