// «Мой парк» владельца и вход водителя по QR-наклейке в кабине.
import { useEffect, useState } from 'react';
import { get, post, put, patch, rub, fmtTime, API_URL } from '../api.ts';
import { SERVICES } from '../dict.ts';
import { useLoad, useAction, useMe, go, Loading, Field, Back, RubInput } from '../ui.tsx';
import { qrSvg } from '../qr.ts';
import { Login } from './login.tsx';
import { VehicleModelPhoto, vehicleReferencePhoto } from '../vehicleVisual.tsx';

const ALLOW: [string, string, string][] = [
  ['repair', 'Вызов мастера', 'электрик, пневматика, автономка, шиномонтаж'],
  ['tow', 'Эвакуатор', 'вне SOS'],
  ['consult', 'Консультация по телефону', '700 ₽'],
  ['service', 'Запись в сервис', 'рембазы-партнёры'],
  ['shop', 'Магазин', 'покупки запчастей'],
  ['insurance', 'Страхование', 'подача заявок только с разрешения владельца'],
  ['inspection', 'Техосмотр', 'запись и подача заявок только с разрешения владельца'],
];
const esc = (x: unknown) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);
const stickerUrl = (code: string) => `${API_URL || location.origin}/#/qr/${code}`;

function InsuranceReminderSettings() {
  const settings = useLoad(() => get('/api/insurance-reminders/settings'), []);
  const { busy, run } = useAction();
  const enabled = settings.data?.enabled;
  return <div className="card stack">
    <b>Напоминания о страховке</b>
    <span className="note">За 30, 7 и 1 день до окончания полиса. Уведомления получает владелец.</span>
    {!settings.data ? <Loading error={settings.error} /> :
      <label className="row">
        <input type="checkbox" checked={!!enabled} disabled={busy} onChange={async (e) => {
          const result = await run(() => put('/api/insurance-reminders/settings', { enabled: e.target.checked }), 'Настройка сохранена');
          if (result) settings.setData(result);
        }} />
        <span>Получать напоминания</span>
      </label>}
  </div>;
}

export function Fleet() {
  const f = useLoad(() => get('/api/fleet'), [], (e) => e.type === 'order' || e.type === 'fleet');
  const { me, reload } = useMe();
  const { busy, run } = useAction();
  const [s, setS] = useState<any>(null);
  const [edo, setEdo] = useState({ edoOperator: '', edoId: '' });
  const [qrFor, setQrFor] = useState<string | null>(null);
  const [expandedCar, setExpandedCar] = useState<string | null>(null);
  useEffect(() => {
    if (!f.data || s) return;
    setS(f.data.settings);
    setEdo({ edoOperator: f.data.company.edoOperator ?? '', edoId: f.data.company.edoId ?? '' });
  }, [f.data]); // eslint-disable-line
  if (me?.owner_id) return <main><div className="empty">Парком управляет владелец машины.</div></main>;
  if (!f.data || !s) return <main><Back to="garage" label="Гараж" /><Loading error={f.error} /></main>;
  const d = f.data;
  const decide = async (id: string, approve: boolean) => { if (await run(() => post(`/api/orders/${id}/owner-decision`, { approve }), approve ? 'Подтверждено — ищем исполнителя' : 'Отклонено — водитель увидит в чате')) f.reload(); };
  async function save() {
    const r = await run(() => put('/api/fleet', { mode: s.mode, perOrder: s.perOrder ?? null, perMonth: s.perMonth ?? null, allow: s.allow, edoPdfOnly: d.company.pdfOnly }), 'Сохранено');
    if (r) f.setData(r);
  }

  // One approved fleet-management component for PC, Android and mobile web.
  // Old Fleet markup is retired. Same protected real APIs and action handlers.
  return <main className="fleet-mobile-approved and19-workspace and19-client">
    <nav className="fleet-mobile-back"><a href="#/">‹ Рабочий стол</a><span>TRAKSOS · АВТОПАРК</span></nav>
    <header className="fleet-mobile-heading">
      <span className="label">УПРАВЛЕНИЕ АВТОПАРКОМ</span>
      <h1>Мои машины</h1>
      <p>Автомобили, водители и заявки — все данные вашего автопарка.</p>
    </header>
    <div className="fleet-mobile-stats" aria-label="Состояние автопарка">
      <div><strong>{d.cars.length}</strong><small>Машин</small></div>
      <div><strong>{d.cars.filter((c:any)=>!!c.driver).length}</strong><small>С водителем</small></div>
      <div><strong>{d.pending.length}</strong><small>Ждут решения</small></div>
    </div>
    {d.pending.length>0&&<section className="fleet-mobile-block">
      <h2>Ожидают подтверждения</h2>
      {d.pending.map((o:any)=><article key={o.id} className="fleet-mobile-pending">
        <strong>{o.driver_name??'Водитель'} · {o.brand??''} {o.plate??''}</strong>
        <p>{SERVICES[o.service]?.name??o.service} · {rub(o.amount)}</p>
        {o.description&&<p>{o.description}</p>}
        <div className="fleet-mobile-actions">
          <button className="btn" disabled={busy} onClick={()=>decide(o.id,true)}>Подтвердить</button>
          <button className="btn ghost" disabled={busy} onClick={()=>decide(o.id,false)}>Отклонить</button>
        </div>
        <a href={`#/order/${o.id}`}>Открыть заявку ›</a>
      </article>)}
    </section>}
    <section className="fleet-mobile-block">
      <div className="fleet-mobile-block-title"><h2>Моя техника</h2><a href="#/garage">В гараж ›</a></div>
      {!d.cars.length&&<p>Автомобилей пока нет. <a href="#/garage">Добавьте машину</a>.</p>}
      {d.cars.map((c:any)=><article key={c.id} className="fleet-mobile-car">
        <a className="fleet-mobile-car-link" href={`#/garage/${c.id}`}
           aria-label={`История и документы автомобиля ${c.brand} ${c.model??''}`}>
          <div className="fleet-mobile-photo">
            <VehicleModelPhoto brand={c.brand} model={c.model} year={c.year}/>
          </div>
          <div className="fleet-mobile-car-info">
            <small>ТЕХНИКА АВТОПАРКА</small>
            <strong>{c.brand} {c.model??''}</strong>
            <span>{[c.year&&c.year+' г.',c.plate].filter(Boolean).join(' · ')||'Данные уточняются'}</span>
            <em>История и документы ›</em>
          </div>
        </a>
        {vehicleReferencePhoto(c.brand,c.model,c.year)&&<a className="fleet-mobile-credit"
          href="/vehicle-photo-credits.html" target="_blank" rel="noopener noreferrer">Источник фото модели</a>}
        <div className="fleet-mobile-driver">
          <strong>{c.driver?'Водитель: '+(c.driver.name??c.driver.phone):'Водитель не назначен'}</strong>
          <small>{c.driver?'За месяц '+rub(c.driver.monthSpent):'Выдайте доступ по QR-наклейке'}</small>
        </div>
        <button className="fleet-mobile-expand" type="button" aria-expanded={expandedCar===c.id}
          onClick={()=>setExpandedCar(expandedCar===c.id?null:c.id)}>
          {expandedCar===c.id?'Свернуть данные':'Характеристики, ремонты, запчасти'}
          <span aria-hidden="true">{expandedCar===c.id?'⌃':'›'}</span>
        </button>
        {expandedCar===c.id&&<FleetVehicleDetails car={c}/>}
        <div className="fleet-mobile-actions">
          <button className="btn ghost small" type="button"
            onClick={()=>setQrFor(qrFor===c.id?null:c.id)}>{qrFor===c.id?'Скрыть QR':'QR-наклейка'}</button>
          <button className="btn ghost small" type="button" disabled={busy} onClick={async()=>{
            if(!confirm('Выпустить новую наклейку? Старая перестанет пускать, текущий водитель потеряет доступ.'))return;
            const r=await run(()=>post(`/api/fleet/vehicles/${c.id}/new-qr`),
              'Новая наклейка: прежний водитель потерял доступ');
            if(r)f.setData(r);
          }}>Новая наклейка</button>
        </div>
        {qrFor===c.id&&<Sticker car={c}/>}
      </article>)}
    </section>
    <details className="fleet-mobile-settings">
      <summary>Оплата и разрешения водителей <span aria-hidden="true">⌄</span></summary>
      <div className="fleet-mobile-settings-body">
        <strong>Кто подтверждает заявки</strong>
        <div className="fleet-mobile-actions">
          <button type="button" className="seg" aria-pressed={s.mode!=='approve'}
            onClick={()=>setS({...s,mode:'limit'})}>Сам до лимита</button>
          <button type="button" className="seg" aria-pressed={s.mode==='approve'}
            onClick={()=>setS({...s,mode:'approve'})}>Всё через меня</button>
        </div>
        {s.mode!=='approve'?<div className="fleet-mobile-fields">
          <Field label="На заказ"><RubInput value={s.perOrder??null} onChange={v=>setS({...s,perOrder:v})} placeholder="без лимита"/></Field>
          <Field label="В месяц"><RubInput value={s.perMonth??null} onChange={v=>setS({...s,perMonth:v})} placeholder="без лимита"/></Field>
        </div>:<p>Заявки водителей поступают вам на подтверждение.</p>}
        <strong>Доступные услуги</strong>
        {ALLOW.map(([k,n,h])=><label className="fleet-mobile-permission" key={k}>
          <input type="checkbox" checked={k==='insurance'||k==='inspection'?s.allow[k]===true:s.allow[k]!==false}
            onChange={e=>setS({...s,allow:{...s.allow,[k]:e.target.checked}})}/>
          <span><strong>{n}</strong><small>{h}</small></span>
        </label>)}
        <p>Срочный SOS доступен водителю независимо от ограничений.</p>
        <button className="btn" disabled={busy} onClick={save}>Сохранить настройки</button>
      </div>
    </details>
    <details className="fleet-mobile-settings">
      <summary>Напоминания о страховке <span aria-hidden="true">⌄</span></summary>
      <div className="fleet-mobile-settings-body"><InsuranceReminderSettings/></div>
    </details>
    <details className="fleet-mobile-settings">
      <summary>Документы и ЭДО <span aria-hidden="true">⌄</span></summary>
      <div className="fleet-mobile-settings-body">
        <div className="fleet-mobile-fields">
          <Field label="Оператор"><input className="field" placeholder="СБИС, Диадок…"
            value={edo.edoOperator} onChange={e=>setEdo({...edo,edoOperator:e.target.value})}/></Field>
          <Field label="ID участника"><input className="field" placeholder="ID участника"
            value={edo.edoId} onChange={e=>setEdo({...edo,edoId:e.target.value})}/></Field>
        </div>
        <label className="fleet-mobile-permission">
          <input type="checkbox" checked={d.company.pdfOnly} onChange={async e=>{
            const r=await run(()=>put('/api/fleet',{edoPdfOnly:e.target.checked}),'Сохранено');
            if(r)f.setData(r);
          }}/><span><strong>Получать документы только в PDF</strong></span>
        </label>
        <button className="btn ghost" disabled={busy} onClick={async()=>{
          if(await run(()=>patch('/api/me',{edoOperator:edo.edoOperator||null,edoId:edo.edoId||null}),
            'ЭДО сохранено'))reload();
        }}>Сохранить ЭДО</button>
        {!d.company.inn&&<p>Укажите ИНН компании в <a href="#/profile">профиле</a>.</p>}
      </div>
    </details>
  </main>;

}


// Detailed vehicle workspace reuses the same real history endpoint as the
// client's garage. No invented repairs, prices or fictional model photos.
function FleetVehicleDetails({ car }: { car:any }) {
  const [tab,setTab]=useState<'spec'|'history'|'parts'>('spec');
  const history=useLoad(()=>get(`/api/vehicles/${car.id}/history`),[car.id],
    e=>e.type==='order'||e.type==='fleet');
  const tabs: Array<['spec'|'history'|'parts',string]>=[
    ['spec','Характеристики'],['history','История ремонтов'],['parts','Запчасти'],
  ];
  return <section className="fleet-vehicle-detail" aria-label={'Карточка '+car.brand+' '+(car.model||'')}>
    <nav className="fleet-detail-tabs" aria-label="Разделы машины">
      {tabs.map(([id,name])=><button key={id} type="button" className="chip"
        aria-pressed={tab===id} onClick={()=>setTab(id)}>{name}</button>)}
    </nav>
    {tab==='spec'&&<div className="fleet-vehicle-spec">
      <div><span>Марка</span><b>{car.brand}</b></div>
      <div><span>Модель</span><b>{car.model||'Не заполнена'}</b></div>
      <div><span>Год выпуска</span><b>{car.year||'Не указан'}</b></div>
      <div><span>Госномер</span><b>{car.plate||'Не указан'}</b></div>
      <div><span>Водитель</span><b>{car.driver?.name||'Не назначен'}</b></div>
      <div><span>Полуприцеп</span><b>{car.trailerPlate||'Не указан'}</b></div>
      <p className="note">Марку, модель и год выбирают в «Моём гараже». Важные технические сведения должны подтверждаться по документам автомобиля.</p>
      <a className="btn ghost small" href="#/garage">Мой гараж · изменить транспорт</a>
    </div>}
    {tab==='history'&&<div className="fleet-repair-history stack">
      {!history.data?<Loading error={history.error}/>:history.data.items.length===0
        ?<div className="empty">По этой машине пока нет обращений.</div>
        :history.data.items.map((o:any)=><a key={o.id} className="fleet-history-entry" href={o.kind==='service'?`#/booking/${o.id}`:`#/order/${o.id}`}>
          <span className="fleet-history-date">{fmtTime(o.created_at)}</span>
          <b>{o.kind==='service'?'Ремонт на СТО':SERVICES[o.service]?.name||'Помощь на дороге'} · {o.status}</b>
          {o.description&&<span>{o.description}</span>}
          {o.result_note&&<small>Комментарий мастера: {o.result_note}</small>}
          <small>Открыть запись →</small>
        </a>)}
    </div>}
    {tab==='parts'&&<div className="fleet-vehicle-spec">
      <b>История покупок и запчастей</b>
      <p className="note">Покупки из TrakSOS привязываются к этой машине. Для полной истории переходите в журнал — реальные записи без придуманных товаров.</p>
      <a className="btn" href={`#/shop/history/${car.id}`}>Открыть историю запчастей →</a>
    </div>}
  </section>;
}

function Sticker({ car }: { car: any }) {
  const url = stickerUrl(car.qrCode);
  const svg = qrSvg(url);
  function print() {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<!doctype html><meta charset="utf-8"><title>Наклейка TrakSOS</title><body style="font-family:sans-serif;text-align:center;padding:24px">
      <div style="max-width:320px;margin:auto;border:2px solid #000;border-radius:16px;padding:16px">
      <h2 style="margin:0 0 4px">TrakSOS — помощь на дороге</h2><div>${esc(car.brand)} ${esc(car.model)} · ${esc(car.plate)}</div>
      <div style="width:240px;margin:12px auto">${svg}</div>
      <div>Наведите камеру → телефон → код из SMS.<br>Сломались — жмите SOS.</div></div><script>setTimeout(()=>print(),300)</script>`);
    w.document.close();
  }
  return (
    <div className="stack" style={{ alignItems: 'center' }}>
      <div style={{ width: 200, background: '#fff', borderRadius: 12, padding: 8 }} dangerouslySetInnerHTML={{ __html: svg }} role="img" aria-label={`QR-код для входа водителя ${car.brand} ${car.plate ?? ''}`} />
      <span className="note" style={{ textAlign: 'center' }}>Новый водитель сканирует наклейку, вводит телефон и код из SMS — и сразу работает с этой машиной. Без регистрации и анкет.</span>
      <div className="grid2" style={{ width: '100%' }}>
        <button className="btn ghost small" onClick={print}>Распечатать</button>
        <button className="btn ghost small" onClick={() => { navigator.clipboard?.writeText(url).catch(() => {}); }}>Скопировать ссылку</button>
      </div>
    </div>
  );
}

/** Страница наклейки: водитель видит машину, входит по SMS — и он водитель этой машины */
export function QrJoin({ code }: { code: string }) {
  const { me, reload } = useMe();
  const info = useLoad(() => get(`/api/qr/${code}`), [code]);
  const { busy, run } = useAction();
  useEffect(() => { try { sessionStorage.setItem('traksos.qr', code); } catch { /* */ } }, [code]);
  if (!info.data) return <main><Loading error={info.error} /></main>;
  const v = info.data;
  const join = async () => {
    const r = await run(() => post(`/api/qr/${code}/join`), 'Готово — вы водитель этой машины');
    try { sessionStorage.removeItem('traksos.qr'); } catch { /* */ }
    if (r) { await reload(); go(''); }
  };
  return (
    <main>
      <div>
        <h1>{v.brand} {v.model ?? ''}</h1>
        <div className="sub">{v.plate ?? ''} · парк «{v.owner}». Войдите — и сразу работаете с этой машиной: SOS, мастер, эвакуатор.</div>
      </div>
      {me ? (
        <div className="card">
          <b>Вы вошли как {me.name ?? me.phone}</b>
          <span className="note">Прежний водитель этой машины потеряет доступ. Все ваши заказы и чаты по ней видит владелец.</span>
          <button className="btn" disabled={busy} onClick={join}>Я водитель этой машины</button>
        </div>
      ) : <Login driver />}
    </main>
  );
}

/** Водителю в форме заявки: что разрешено и до какой суммы */
export function DriverRules() {
  const { me } = useMe();
  const r = useLoad(() => (me?.owner_id ? get('/api/fleet/rules') : Promise.resolve(null)), [me?.owner_id]);
  if (!r.data) return null;
  const d = r.data;
  return (
    <div className="banner col">
      <b>Вы водитель парка «{d.owner}»</b>
      <span className="note">{d.mode === 'approve' ? 'Каждый заказ подтверждает владелец — ему придёт уведомление.'
        : d.perOrder != null || d.perMonth != null ? `Сами — до ${d.perOrder != null ? rub(d.perOrder) + ' за заказ' : ''}${d.perOrder != null && d.perMonth != null ? ' и ' : ''}${d.perMonth != null ? rub(d.perMonth) + ` в месяц (потрачено ${rub(d.monthSpent)})` : ''}. Дороже — подтвердит владелец.`
        : 'Без лимита — заказы идут сразу.'} SOS — всегда.</span>
    </div>
  );
}
