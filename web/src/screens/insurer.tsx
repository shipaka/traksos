// Кабинет партнёра-страховщика: только назначенные администратором страховые заявки.
import { useState } from 'react';
import { get, patch, fmtTime } from '../api.ts';
import { useLoad, useAction } from '../ui.tsx';

const labels: Record<string, string> = {
  sent_to_partner: 'Ждёт оформления', completed: 'Полис оформлен', rejected: 'Отказ',
};
export function InsurerCabinet({inspectionOnly=false}:{inspectionOnly?:boolean}={}) {
  const [workspace,setWorkspace]=useState<'insurance'|'inspection'|'finance'|'common'>(inspectionOnly?'inspection':'insurance');
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
  const [filter, setFilter] = useState<'pending' | 'all' | 'done'>('pending');
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
    if (filter === 'pending' && r.status !== 'sent_to_partner') return false;
    if (filter === 'done' && r.status === 'sent_to_partner') return false;
    return [r.brand, r.model, r.plate, r.comment].some((value) => String(value ?? '').toLocaleLowerCase('ru-RU').includes(search.trim().toLocaleLowerCase('ru-RU')));
  });
  return (
    <main className="cabinet-page">
      <header className="cabinet-heading">
        <span className="label">TRAKSOS · Партнёрский кабинет</span>
        <h1>{workspace==='insurance'?'Страхование':workspace==='inspection'?'Техосмотры':workspace==='finance'?'Финансы':'Общие настройки'}</h1>
      </header>
      <nav className="partner-workspaces" aria-label="Разделы кабинета партнёра">
        {([['insurance','Страховки'],['inspection','Техосмотры'],['finance','Финансы'],['common','Общее']] as const)
          .filter(([key])=>!inspectionOnly||key!=='insurance')
          .map(([key,label])=><button type="button" key={key} className={'btn ghost'+(workspace===key?' active':'')}
            aria-pressed={workspace===key} onClick={()=>setWorkspace(key)}>{label}</button>)}
      </nav>
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
          <div className="cabinet-metrics">
            <div className="card tile"><span className="label">Всего назначено</span><b className="tile-value">{rows.length}</b></div>
            <div className="card tile"><span className="label">Ожидают решения</span><b className="tile-value">{rows.filter((r) => r.status === 'sent_to_partner').length}</b></div>
            <div className="card tile"><span className="label">Завершено</span><b className="tile-value">{rows.filter((r) => r.status !== 'sent_to_partner').length}</b></div>
          </div>
          <div className="web-case-toolbar">
            <div className="row" role="group" aria-label="Фильтр страховых заявок">
              {([['pending', 'Ожидают решения'], ['all', 'Все'], ['done', 'Завершённые']] as const).map(([key, title]) => (
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
          {!visible.length && <div className="empty">По выбранным фильтрам заявок нет.</div>}
          <div className="web-insurance-grid">
          {visible.map((r) => (
            <details key={r.id} className="card">
              <summary className="between">
                <b>{r.brand} {r.model ?? ''}</b>
                <span className="pill">{labels[r.status] ?? r.status}</span>
              </summary>
              <div className="stack">
                <span className="note">{r.plate || 'Без номера'} · Подана {fmtTime(r.created_at)}</span>
                {r.comment && <span className="note">Комментарий клиента: {r.comment}</span>}
                {r.insurance_stage && <div className="insurance-agent-preview">
                  <b>Заявка через TrakSOS · {({
                    received:'Получено',preparing:'Готовятся варианты',
                    offers_sent:'Клиент выбирает предложение',
                    selected:'Клиент выбрал полис',processing:'Оформляется вручную',
                    policy_sent:'PDF-полис отправлен'
                  } as Record<string,string>)[r.insurance_stage] ?? 'В обработке'}</b>
                  <p className="note">ФИО, сведения о грузовике, предложения и переписка открываются в рабочем деле.</p>
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
            </details>
          ))}
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
