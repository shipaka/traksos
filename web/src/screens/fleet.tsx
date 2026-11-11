// «Мой парк» владельца и вход водителя по QR-наклейке в кабине.
import { useEffect, useState } from 'react';
import { get, post, put, patch, rub, fmtTime, API_URL } from '../api.ts';
import { SERVICES } from '../dict.ts';
import { useLoad, useAction, useMe, go, Loading, Field, Back, RubInput } from '../ui.tsx';
import { qrSvg } from '../qr.ts';
import { Login } from './login.tsx';

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

export function Fleet() {
  const f = useLoad(() => get('/api/fleet'), [], (e) => e.type === 'order' || e.type === 'fleet');
  const { me, reload } = useMe();
  const { busy, run } = useAction();
  const [s, setS] = useState<any>(null);
  const [edo, setEdo] = useState({ edoOperator: '', edoId: '' });
  const [qrFor, setQrFor] = useState<string | null>(null);
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
  return (
    <main>
      <Back to="garage" label="Гараж" />
      <div><h1>Мой парк</h1><div className="sub">Машины, водители и что им можно. Все заказы и чаты водителей видны вам.</div></div>

      {d.pending.map((o: any) => (
        <div key={o.id} className="card hi">
          <span className="label">Ждёт вашего подтверждения</span>
          <b>{o.driver_name ?? 'Водитель'} · {o.brand ?? ''} {o.plate ?? ''} просит: {SERVICES[o.service]?.name ?? o.service}</b>
          <span className="note">{rub(o.amount)} · {o.owner_note}{o.description ? ` · «${o.description}»` : ''} · {fmtTime(o.created_at)}</span>
          <div className="grid2">
            <button className="btn" disabled={busy} onClick={() => decide(o.id, true)}>Подтвердить</button>
            <button className="btn ghost" disabled={busy} onClick={() => decide(o.id, false)}>Отклонить</button>
          </div>
          <a className="note" href={`#/order/${o.id}`}>Открыть заявку →</a>
        </div>
      ))}

      <div className="stack">
        <span className="label">Машины</span>
        {!d.cars.length && <div className="empty">Машин пока нет — добавьте в гараже.</div>}
        {d.cars.map((c: any) => (
          <div key={c.id} className="card">
            <div className="between"><b>{c.brand} {c.model ?? ''}</b><span className="pill">{c.plate ?? 'без номера'}</span></div>
            {c.driver ? (
              <span className="note">Водитель {c.driver.name ?? c.driver.phone} · доступ с {c.driver.since ? fmtTime(c.driver.since) : '—'} · в этом месяце {rub(c.driver.monthSpent)} <span className="pill good">Активен</span></span>
            ) : <span className="note">Водитель не назначен — он войдёт сам по QR-наклейке.</span>}
            <div className="row">
              <button className="btn ghost small" onClick={() => setQrFor(qrFor === c.id ? null : c.id)}>{qrFor === c.id ? 'Скрыть наклейку' : 'QR-наклейка'}</button>
              <button className="btn ghost small" disabled={busy} onClick={async () => {
                if (!confirm('Выпустить новую наклейку? Старая перестанет пускать, текущий водитель потеряет доступ.')) return;
                const r = await run(() => post(`/api/fleet/vehicles/${c.id}/new-qr`), 'Новая наклейка: прежний водитель потерял доступ'); if (r) f.setData(r);
              }}>Новая наклейка</button>
            </div>
            {qrFor === c.id && <Sticker car={c} />}
          </div>
        ))}
      </div>

      <div className="card">
        <b>Как оплачивать</b>
        <div className="grid2">
          <button type="button" className="seg" aria-pressed={s.mode !== 'approve'} onClick={() => setS({ ...s, mode: 'limit' })}>Сам до лимита</button>
          <button type="button" className="seg" aria-pressed={s.mode === 'approve'} onClick={() => setS({ ...s, mode: 'approve' })}>Всё через меня</button>
        </div>
        {s.mode !== 'approve' ? (
          <div className="grid2">
            <Field label="За один заказ"><RubInput value={s.perOrder ?? null} onChange={(v) => setS({ ...s, perOrder: v })} placeholder="без лимита" /></Field>
            <Field label="В месяц"><RubInput value={s.perMonth ?? null} onChange={(v) => setS({ ...s, perMonth: v })} placeholder="без лимита" /></Field>
          </div>
        ) : <span className="note">Каждый заказ водителя ждёт вашего «Подтвердить» — придёт уведомление.</span>}
        <span className="note">Заказы до лимита идут сразу. Дороже — вы получаете уведомление и подтверждаете. Статус видно в «Заявках».</span>
      </div>

      <div className="card">
        <b>Что водителю можно</b>
        {ALLOW.map(([k, n, h]) => (
          <label key={k} className="agree"><input type="checkbox" checked={s.allow[k] !== false} onChange={(e) => setS({ ...s, allow: { ...s.allow, [k]: e.target.checked } })} /><span><b>{n}</b> — {h}</span></label>
        ))}
        <span className="note">Срочный вызов SOS водитель может сделать всегда — даже если вы не на связи.</span>
      </div>
      <button className="btn" disabled={busy} onClick={save}>Сохранить</button>

      <div className="card">
        <b>Документы через ЭДО</b>
        <div className="grid2">
          <Field label="Оператор"><input className="field" placeholder="СБИС, Диадок…" value={edo.edoOperator} onChange={(e) => setEdo({ ...edo, edoOperator: e.target.value })} /></Field>
          <Field label="Идентификатор ЭДО"><input className="field" placeholder="ID участника" value={edo.edoId} onChange={(e) => setEdo({ ...edo, edoId: e.target.value })} /></Field>
        </div>
        <label className="agree"><input type="checkbox" checked={d.company.pdfOnly} onChange={async (e) => { const r = await run(() => put('/api/fleet', { edoPdfOnly: e.target.checked }), 'Сохранено'); if (r) f.setData(r); }} /><span>Получать документы только в PDF</span></label>
        <span className="note">Счета и акты приходят в ЭДО, подписанные ТракSOS. По каждой поломке — один счёт: консультация, выезды, работа и эвакуатор вместе.</span>
        <button className="btn ghost small" disabled={busy} onClick={async () => { if (await run(() => patch('/api/me', { edoOperator: edo.edoOperator || null, edoId: edo.edoId || null }), 'ЭДО сохранено')) reload(); }}>Сохранить ЭДО</button>
        {!d.company.inn && <span className="note">Укажите компанию и ИНН в <a href="#/profile">профиле</a> — без них счёт по ЭДО не выставить.</span>}
      </div>

      <div className="card">
        <div className="between"><b>Работа с отсрочкой оплаты</b><span className="pill">скоро</span></div>
        <span className="note">Мастера будут приезжать без предоплаты, пока вы в пределах лимита. Лимит растёт, если вы давно с нами и платите вовремя.</span>
      </div>
    </main>
  );
}

function Sticker({ car }: { car: any }) {
  const url = stickerUrl(car.qrCode);
  const svg = qrSvg(url);
  function print() {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<!doctype html><meta charset="utf-8"><title>Наклейка ТракSOS</title><body style="font-family:sans-serif;text-align:center;padding:24px">
      <div style="max-width:320px;margin:auto;border:2px solid #000;border-radius:16px;padding:16px">
      <h2 style="margin:0 0 4px">ТракSOS — помощь на дороге</h2><div>${esc(car.brand)} ${esc(car.model)} · ${esc(car.plate)}</div>
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
