// Кабинет партнёра-страховщика: только назначенные администратором страховые заявки.
import { useState } from 'react';
import { get, patch, fmtTime } from '../api.ts';
import { useLoad, useAction } from '../ui.tsx';

const labels: Record<string, string> = {
  sent_to_partner: 'Ждёт оформления', completed: 'Полис оформлен', rejected: 'Отказ',
};
export function InsurerCabinet() {
  const requests = useLoad(() => get('/api/insurer/requests'), [],
    (event) => event.type === 'vehicle_service');
  const { busy, run } = useAction();
  const [notes, setNotes] = useState<Record<string, string>>({});
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
    const result = await run(() => patch(`/api/insurer/requests/${id}`, {
      status, note: note || undefined,
      policyExpiresOn: status === 'completed' ? policyExpiresOn : undefined,
    }), 'Заявка обновлена');
    if (result) {
      setNotes((old) => { const value = { ...old }; delete value[id]; return value; });
      requests.reload();
    }
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
        <span className="label">Партнёрский кабинет · Страхование</span>
        <h1>Кабинет страховщика</h1>
      </header>
      <div className="sub">Только заявки, переданные вам ТракSOS. Остальные автомобили и сведения о клиентах недоступны.</div>
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
                  <b>Заявка через TrackSOS · {({
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
      <a className="linkrow" href="#/menu"><span><b>Помощь, условия и настройки</b><small>Единое меню ТракSOS</small></span><span aria-hidden="true">›</span></a>
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
