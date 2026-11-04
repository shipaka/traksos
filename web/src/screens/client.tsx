import { useEffect, useMemo, useState } from 'react';
import { get, post, del, rub, fmtTime, fmtPhone } from '../api.ts';
import { SERVICES, SOS_PROBLEMS, TIERS, STATUS, matchBrand } from '../dict.ts';
import { useLoad, useAction, useMe, go, Loading, Field, Chips, Back } from '../ui.tsx';

// Главная: SOS и услуги ------------------------------------------------------

export function Home() {
  const { me } = useMe();
  const active = useLoad(() => get('/api/orders'), [], (e) => e.type === 'order');
  const live = (active.data ?? []).filter((o: any) => !['completed', 'cancelled'].includes(o.status));
  return (
    <main>
      <div>
        <h1>{me?.name ? `${me.name}, что случилось?` : 'Что случилось?'}</h1>
        <div className="sub">Петербург и Ленобласть, круглосуточно</div>
      </div>

      {live.map((o: any) => (
        <a key={o.id} href={`#/order/${o.id}`} className="card hi" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="between">
            <b>Заявка №{o.number} · {SERVICES[o.service]?.name ?? o.service}</b>
            <span className={`pill ${STATUS[o.status]?.tone}`}>{STATUS[o.status]?.name}</span>
          </div>
          <span className="note">{o.address ?? o.estimate?.zoneName} · открыть →</span>
        </a>
      ))}

      <button className="sos" onClick={() => go('sos')}>
        <span className="label" style={{ color: 'inherit', opacity: .8 }}>Срочно</span>
        <span className="t">SOS</span>
        <p>Выберите поломку — заявка уйдёт свободным мастерам рядом. Первым ответит живой человек.</p>
      </button>

      <div className="stack">
        <span className="label">Услуги</span>
        {Object.entries(SERVICES).map(([id, s]) => (
          <button key={id} className="opt" onClick={() => go(`new/${id}`)}>
            <b>{s.name}</b><small>{s.hint}</small>
          </button>
        ))}
      </div>
    </main>
  );
}

export function Sos() {
  return (
    <main>
      <Back to="" />
      <div>
        <h1>Что случилось?</h1>
        <div className="sub">Подскажем, кого звать. Ошиблись — мастер перенаправит.</div>
      </div>
      <div className="stack">
        {SOS_PROBLEMS.map((p) => (
          <button key={p.id} className="opt" onClick={() => go(`new/${p.service}?sos=${p.id}`)}>
            <b>{p.name}</b><small>{p.hint}</small>
          </button>
        ))}
      </div>
    </main>
  );
}

// Новая заявка --------------------------------------------------------------

export function NewOrder({ service }: { service: string }) {
  const sosId = new URLSearchParams(location.hash.split('?')[1] ?? '').get('sos');
  const sos = SOS_PROBLEMS.find((p) => p.id === sosId);
  const { busy, run } = useAction();
  const pricing = useLoad(() => get('/api/pricing'), []);
  const vehicles = useLoad(() => get('/api/vehicles'), []);

  const [zoneId, setZoneId] = useState('spb');
  const [tier, setTier] = useState<'eco' | 'comfort' | 'pro'>(service === 'diag' ? 'pro' : 'eco');
  const [night, setNight] = useState<boolean | null>(null);
  const [group, setGroup] = useState(false);
  const [vehicleId, setVehicleId] = useState<string>('');
  const [brand, setBrand] = useState('');
  const [description, setDescription] = useState(sos ? sos.name : '');
  const [address, setAddress] = useState('');
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [geoState, setGeoState] = useState<'idle' | 'wait' | 'ok' | 'fail'>('idle');
  const [method, setMethod] = useState<'cash' | 'online' | 'invoice'>('cash');
  const [est, setEst] = useState<any>(null);
  const [destination, setDestination] = useState('');
  const [cargo, setCargo] = useState<'tractor' | 'semitrailer' | 'coupling' | 'truck12'>('tractor');
  const [loaded, setLoaded] = useState<'empty' | 'loaded' | 'adr'>('empty');
  const [driverOnSite, setDriverOnSite] = useState(true);
  const isTow = service === 'tow';

  useEffect(() => {
    if (pricing.data && night === null) setNight(pricing.data.nightNow);
  }, [pricing.data]); // eslint-disable-line
  useEffect(() => {
    if (vehicles.data?.length && !vehicleId) setVehicleId(vehicles.data[0].id);
  }, [vehicles.data]); // eslint-disable-line
  useEffect(() => {
    if (night === null) return;
    post('/api/pricing/estimate', { service, tier, zoneId, night, group }).then(setEst).catch(() => setEst(null));
  }, [service, tier, zoneId, night, group]);

  function locate() {
    if (!navigator.geolocation) return setGeoState('fail');
    setGeoState('wait');
    navigator.geolocation.getCurrentPosition(
      (p) => { setGeo({ lat: p.coords.latitude, lng: p.coords.longitude }); setGeoState('ok'); },
      () => setGeoState('fail'),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }
  useEffect(locate, []);

  const zone = pricing.data?.zones.find((z: any) => z.id === zoneId);
  const groupAllowed = service !== 'tow' && (zone?.km ?? 0) > 30;
  const brandSuggest = useMemo(() => (vehicleId ? [] : matchBrand(brand)), [brand, vehicleId]);
  const methods = pricing.data?.payments;

  async function submit() {
    const r = await run(() => post('/api/orders', {
      service, isSos: !!sos, problem: sos?.id, description: description || undefined, address: address || undefined,
      lat: geo?.lat, lng: geo?.lng, zoneId, tier: service === 'tow' ? undefined : tier, vehicleId: vehicleId || undefined,
      brand: vehicleId ? undefined : brand || undefined, groupTrip: groupAllowed && group, night: night ?? undefined, paymentMethod: method,
      ...(isTow ? { destination: destination || undefined, cargo, loaded, driverOnSite } : {}),
    }));
    if (!r) return;
    if (r.confirmationUrl) location.href = r.confirmationUrl;
    else go(`order/${r.order.id}`);
  }

  if (!pricing.data) return <main><Loading error={pricing.error} /></main>;
  const s = SERVICES[service];

  return (
    <main>
      <Back to={sos ? 'sos' : ''} />
      <div>
        <h1>{sos ? sos.name : s?.name ?? 'Заявка'}</h1>
        <div className="sub">{sos ? `${s?.name} · срочный вызов` : s?.hint}</div>
      </div>

      <Field group label="Машина">
        {vehicles.data?.length ? (
          <select className="field" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            {vehicles.data.map((v: any) => <option key={v.id} value={v.id}>{v.brand} {v.model ?? ''} {v.plate ?? ''}</option>)}
            <option value="">Другая машина</option>
          </select>
        ) : null}
        {!vehicleId && (
          <>
            <input className="field" placeholder="Марка: Scania, DAF, КАМАЗ…" value={brand} onChange={(e) => setBrand(e.target.value)} />
            {brandSuggest.length > 0 && brandSuggest[0] !== brand && (
              <div className="scroll-x">{brandSuggest.map((b) => <button key={b} type="button" className="chip" onClick={() => setBrand(b)}>{b}</button>)}</div>
            )}
          </>
        )}
      </Field>

      <Field group label="Где машина">
        <input className="field" placeholder="Адрес, стоянка или км трассы" value={address} onChange={(e) => setAddress(e.target.value)} />
        <span className="note">
          {geoState === 'ok' ? '✓ Точка на карте определена' : geoState === 'wait' ? 'Определяю место…' : geoState === 'fail'
            ? <>Не удалось определить место. <button type="button" className="chip" style={{ minHeight: 30 }} onClick={locate}>Ещё раз</button></> : null}
        </span>
      </Field>

      {isTow && (
        <div className="card">
          <b>Эвакуатор</b>
          <input className="field" placeholder="Куда везти: сервис, стоянка, адрес" value={destination} onChange={(e) => setDestination(e.target.value)} />
          <Field group label="Что везём">
            <Chips value={cargo} onChange={setCargo} options={[{ id: 'tractor', name: 'Тягач' }, { id: 'semitrailer', name: 'Полуприцеп' }, { id: 'coupling', name: 'Сцепка целиком' }, { id: 'truck12', name: 'Грузовик до 12 т' }]} />
          </Field>
          <Field group label="Груз в прицепе">
            <Chips value={loaded} onChange={setLoaded} options={[{ id: 'empty', name: 'Пустой' }, { id: 'loaded', name: 'Гружёный' }, { id: 'adr', name: 'Опасный ADR' }]} />
          </Field>
          <div className="grid2">
            <button type="button" className="seg" aria-pressed={driverOnSite} onClick={() => setDriverOnSite(true)}>Водитель на месте</button>
            <button type="button" className="seg" aria-pressed={!driverOnSite} onClick={() => setDriverOnSite(false)}>Водителя нет</button>
          </div>
        </div>
      )}

      <Field group label={isTow ? 'Откуда забрать' : 'Куда ехать мастеру'}>
        <Chips value={zoneId} onChange={setZoneId} options={pricing.data.zones.map((z: any) => ({ id: z.id, name: z.km > 30 ? `${z.name} · ${z.km} км` : z.name }))} />
      </Field>
      <div className="grid2">
        <button type="button" className="seg" aria-pressed={!night} onClick={() => setNight(false)}>Днём</button>
        <button type="button" className="seg" aria-pressed={!!night} onClick={() => setNight(true)}>Ночь 22–7</button>
      </div>
      {groupAllowed && (
        <button type="button" className="opt" aria-pressed={group} onClick={() => setGroup(!group)}>
          <b>{group ? '✓ ' : ''}Совместный выезд</b>
          <small>Мастер едет к нескольким машинам рядом — вы платите 70% выезда. Может быть дольше.</small>
        </button>
      )}

      {service !== 'tow' && (
        <div className="stack">
          <span className="label">Класс</span>
          {(Object.keys(TIERS) as (keyof typeof TIERS)[]).map((t) => (
            <button key={t} type="button" className="opt" aria-pressed={tier === t} onClick={() => setTier(t as any)}>
              <div className="between"><b>{TIERS[t].name}</b><span className="note">выезд {rub(pricing.data.tiers[t].callOut)}</span></div>
              <small>{TIERS[t].hint}</small>
            </button>
          ))}
        </div>
      )}

      <Field label="Что случилось · по желанию">
        <textarea className="field" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Например: не заводится, стартер щёлкает" />
      </Field>

      {est && (
        <div className="card">
          <b>Сколько это будет стоить</b>
          <div className="sum"><span>Выезд{est.km ? ` (${est.roadKm} км: туда и половина обратно)` : ''}</span><span>{rub(est.callOut)}</span></div>
          {est.hour != null && <div className="sum"><span>Час работы</span><span>{rub(est.hour)}</span></div>}
          {est.night && <span className="note">Ночной тариф уже учтён.</span>}
          {est.group && <span className="note">Совместный выезд: 70% от полной цены.</span>}
          <span className="note">{isTow
            ? 'Это обычная цена. Эвакуаторщики рядом предложат свою — от −15% до +30%, вы выберете по цене, подаче и рейтингу.'
            : 'Это обычная цена. Мастера рядом откликнутся — по ней или со своей ценой, вы выберете. Работу мастер назовёт на месте, сумму подтверждаете в приложении.'}</span>
        </div>
      )}

      <div className="stack">
        <span className="label">Оплата</span>
        <div className="grid2">
          <button type="button" className="seg" aria-pressed={method === 'cash'} onClick={() => setMethod('cash')}>Мастеру на месте</button>
          <button type="button" className="seg" aria-pressed={method === 'online'} disabled={!methods?.online} onClick={() => setMethod('online')}>СБП / карта</button>
        </div>
        {methods?.invoice && <button type="button" className="seg" aria-pressed={method === 'invoice'} onClick={() => setMethod('invoice')}>Счёт на компанию</button>}
        {!methods?.online && <span className="note">Оплата в приложении скоро появится. Пока — наличными или переводом мастеру, сумму подтверждаете здесь.</span>}
        {method === 'online' && <span className="note">Выезд оплачивается сейчас и замораживается. Мастеру деньги уйдут после того, как вы подтвердите работу.</span>}
      </div>

      <button className="btn" disabled={busy} onClick={submit}>{sos ? 'Вызвать сейчас' : 'Отправить заявку'}</button>
    </main>
  );
}

// Мои заявки ----------------------------------------------------------------

export function Orders({ as }: { as: 'client' | 'performer' }) {
  const list = useLoad(() => get(`/api/orders?as=${as}`), [as], (e) => e.type === 'order');
  return (
    <main>
      <h1>{as === 'performer' ? 'Мои выезды' : 'Заявки'}</h1>
      {!list.data ? <Loading error={list.error} /> : !list.data.length ? <div className="empty">Заявок пока нет</div> : (
        <div className="rows">
          {list.data.map((o: any) => (
            <a key={o.id} href={`#/order/${o.id}`} className="list-item">
              <div className="stack" style={{ gap: 2 }}>
                <b>№{o.number} · {SERVICES[o.service]?.name ?? o.service}{o.is_sos ? ' · SOS' : ''}</b>
                <span className="note">{fmtTime(o.created_at)} · {o.address ?? o.estimate?.zoneName}</span>
              </div>
              <span className={`pill ${STATUS[o.status]?.tone}`}>{STATUS[o.status]?.name}</span>
            </a>
          ))}
        </div>
      )}
    </main>
  );
}

// Гараж ---------------------------------------------------------------------

export function Garage() {
  const { me } = useMe();
  const list = useLoad(() => get('/api/vehicles'), []);
  const { busy, run } = useAction();
  const [form, setForm] = useState({ brand: '', model: '', year: '', plate: '', trailerPlate: '' });
  const [driverFor, setDriverFor] = useState<string | null>(null);
  const [driverPhone, setDriverPhone] = useState('+7 ');
  const isDriver = !!me?.owner_id;
  const suggest = matchBrand(form.brand);

  async function add() {
    const r = await run(() => post('/api/vehicles', {
      brand: form.brand, model: form.model || undefined, year: form.year ? Number(form.year) : undefined,
      plate: form.plate || undefined, trailerPlate: form.trailerPlate || undefined,
    }), 'Машина добавлена');
    if (r) { setForm({ brand: '', model: '', year: '', plate: '', trailerPlate: '' }); list.reload(); }
  }

  return (
    <main>
      <div>
        <h1>Мой гараж</h1>
        <div className="sub">Машина сохраняется один раз и выбирается одним нажатием во всех заявках.</div>
      </div>
      {!list.data ? <Loading error={list.error} /> : list.data.map((v: any) => (
        <div key={v.id} className="card">
          <div className="between"><b>{v.brand} {v.model ?? ''}{v.year ? `, ${v.year}` : ''}</b><span className="pill">{v.plate ?? 'без номера'}</span></div>
          {v.trailer_plate && <span className="note">Прицеп {v.trailer_plate}</span>}
          {!isDriver && (driverFor === v.id ? (
            <div className="stack">
              <input className="field" type="tel" value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} />
              <div className="grid2">
                <button className="btn small" disabled={busy} onClick={async () => {
                  if (await run(() => post(`/api/vehicles/${v.id}/driver`, { phone: driverPhone }), 'Водитель закреплён. Он входит по своему номеру.')) { setDriverFor(null); list.reload(); }
                }}>Закрепить</button>
                <button className="btn ghost small" onClick={() => setDriverFor(null)}>Отмена</button>
              </div>
              <span className="note">Водитель видит только эту машину и свои заявки. SOS ему доступен всегда.</span>
            </div>
          ) : (
            <div className="row">
              <button className="btn ghost small" onClick={() => setDriverFor(v.id)}>{v.driver_id ? 'Сменить водителя' : 'Назначить водителя'}</button>
              {v.driver_id && <button className="btn ghost small" onClick={async () => { if (await run(() => post(`/api/vehicles/${v.id}/driver`, { phone: null }), 'Доступ водителя закрыт')) list.reload(); }}>Убрать водителя</button>}
              <button className="btn bad small" onClick={async () => { if (confirmDelete() && await run(() => del(`/api/vehicles/${v.id}`))) list.reload(); }}>Удалить</button>
            </div>
          ))}
        </div>
      ))}

      {!isDriver && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <b>Добавить машину</b>
          <input className="field" placeholder="Марка (можно по-русски: скания, мерс…)" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
          {suggest.length > 0 && suggest[0] !== form.brand && (
            <div className="scroll-x">{suggest.map((b) => <button key={b} type="button" className="chip" onClick={() => setForm({ ...form, brand: b })}>{b}</button>)}</div>
          )}
          <div className="grid2">
            <input className="field" placeholder="Серия: R440, XF…" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            <input className="field" inputMode="numeric" placeholder="Год" maxLength={4} value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value.replace(/\D/g, '') })} />
          </div>
          <div className="grid2">
            <input className="field" placeholder="Госномер тягача" value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} />
            <input className="field" placeholder="Прицеп" value={form.trailerPlate} onChange={(e) => setForm({ ...form, trailerPlate: e.target.value })} />
          </div>
          <span className="note">Год влияет на подбор мастера: у разных поколений своя электрика.</span>
          <button className="btn" disabled={busy || !form.brand}>Сохранить</button>
        </form>
      )}
    </main>
  );
}

// В браузере confirm() есть всегда; в Android WebView — тоже (Capacitor показывает системный диалог)
function confirmDelete() {
  return window.confirm('Удалить машину из гаража?');
}

// Профиль -------------------------------------------------------------------

export function Profile() {
  const { me, reload, mode } = useMe();
  const { busy, run } = useAction();
  const [name, setName] = useState(me?.name ?? '');
  const [company, setCompany] = useState(me?.company_name ?? '');
  const [inn, setInn] = useState(me?.company_inn ?? '');
  if (!me) return null;
  const isPerformer = me.roles.some((r) => ['master', 'tow', 'service'].includes(r));
  return (
    <main>
      <h1>Профиль</h1>
      <div className="card">
        <dl className="kv">
          <dt>Телефон</dt><dd>{fmtPhone(me.phone)}</dd>
          <dt>Рейтинг</dt><dd>{me.rating ? `${me.rating.toFixed(2)} · ${me.rating_count} оценок` : 'пока нет оценок'}</dd>
          {(me as any).bonus > 0 && <><dt>Бонусы</dt><dd style={{ color: 'var(--good-fg)' }}>{rub((me as any).bonus)} — спишутся сами со следующей заявки</dd></>}
          {(me as any).personalFee && <><dt>Ваш сбор</dt><dd>{(me as any).feePct}% — персональные условия</dd></>}
        </dl>
      </div>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => (patchMe({ name, companyName: company || null, companyInn: inn || null })), 'Сохранено')) reload();
      }}>
        <Field label="Имя"><input className="field" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        {!me.owner_id && (
          <>
            <Field label="Компания · если работаете от юрлица"><input className="field" value={company} onChange={(e) => setCompany(e.target.value)} /></Field>
            <Field label="ИНН компании" hint="Для счетов и закрывающих документов по ЭДО"><input className="field" inputMode="numeric" value={inn} onChange={(e) => setInn(e.target.value.replace(/\D/g, ''))} /></Field>
          </>
        )}
        <button className="btn" disabled={busy}>Сохранить</button>
      </form>
      <div className="stack">
        {mode !== 'client' && <button className="btn ghost" onClick={() => go('as/client')}>Кабинет клиента</button>}
        {isPerformer && mode !== 'performer' && <button className="btn ghost" onClick={() => go('as/performer')}>Кабинет исполнителя</button>}
        {!isPerformer && <button className="btn ghost" onClick={() => go('work/profile')}>Стать исполнителем на ТракSOS</button>}
        {me.roles.some((r) => r === 'admin' || r === 'moderator') && mode !== 'admin' && <button className="btn ghost" onClick={() => go('as/admin')}>Кабинет администратора</button>}
        <button className="btn bad" onClick={logout}>Выйти</button>
      </div>
    </main>
  );
}

async function patchMe(body: unknown) {
  const { patch } = await import('../api.ts');
  return patch('/api/me', body);
}

async function logout() {
  const { post, setToken, disconnectWs } = await import('../api.ts');
  await post('/api/auth/logout').catch(() => {});
  setToken(null);
  disconnectWs();
  location.hash = '#/login';
  location.reload();
}
