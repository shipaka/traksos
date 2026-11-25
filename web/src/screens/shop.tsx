// Магазин: витрина, корзина, заказ; админ — выключатель, товары, заказы.
import { useEffect, useRef, useState } from 'react';
import { get, post, put, del, rub, fmtTime, API_URL, getToken, onEvent } from '../api.ts';
import { useLoad, useAction, useMe, go, Loading, Field, Back, RubInput } from '../ui.tsx';
import { syncOfflineParts, searchOfflineParts } from '../shopOffline.ts';
import { syncOfflineReferences, searchOfflineReferences } from '../shopReferenceOffline.ts';
import { AdminShopCatalog } from './shopCatalogAdmin.tsx';
import { cartStorageKey, normalizeCart, readCartFor, writeCartFor, type Cart } from '../shopCartStore.ts';

/**
 * The device can be shared by a fleet owner, drivers and masters.
 * Never share one localStorage cart across their authenticated accounts.
 */
function useCart(): [Cart, (c: Cart) => void] {
  const { me } = useMe();
  const owner = me?.id ?? null;
  const session = useRef<{owner:string|null; token:string|null}>({owner,token:getToken()});
  const [cart,setCart] = useState<Cart>(()=>readCartFor(owner));
  useEffect(()=>{
    session.current={owner,token:getToken()};
    setCart(readCartFor(owner));
    const refresh=()=>setCart(readCartFor(owner));
    const current=()=>!!owner&&session.current.owner===owner&&
      !!session.current.token&&session.current.token===getToken();
    const onStorage=(event:StorageEvent)=>{
      const key=cartStorageKey(owner);
      if(current()&&key&&(event.key===key||event.key===null))refresh();
    };
    const onLocal=(event:Event)=>{
      const detail=(event as CustomEvent<{owner:string;cart:Cart}>).detail;
      // Same-tab events carry the validated cart. Private mode may forbid
      // localStorage altogether; re-reading would erase its in-memory cart.
      if(current()&&detail?.owner===owner)setCart(normalizeCart(detail.cart));
    };
    const invalidate=()=>{
      session.current={owner:null,token:null};
      setCart({});
    };
    window.addEventListener('storage',onStorage);
    window.addEventListener('traksos-cart',onLocal);
    window.addEventListener('traksos-auth-external-change',invalidate);
    window.addEventListener('traksos-auth-expired',invalidate);
    return ()=>{
      window.removeEventListener('storage',onStorage);
      window.removeEventListener('traksos-cart',onLocal);
      window.removeEventListener('traksos-auth-external-change',invalidate);
      window.removeEventListener('traksos-auth-expired',invalidate);
    };
  },[owner]);
  const update=(next:Cart)=>{
    // An old mounted page must not write account A's cart after B logs in.
    if(!owner||!session.current.token||session.current.owner!==owner||
      session.current.token!==getToken()){
      setCart({});
      return;
    }
    const safe=writeCartFor(owner,next);
    setCart(safe);
    window.dispatchEvent(new CustomEvent('traksos-cart',{detail:{owner,cart:safe}}));
  };
  // Effects run after paint. Hide data from the previous account even
  // during the first render with a different MeCtx identity.
  const visibleCart=session.current.owner===owner&&session.current.token===getToken()
    ? cart : {};
  return [visibleCart,update];
}
/**
 * Private shop responses belong to the account, token AND exact query that
 * initiated them. General useLoad deliberately keeps old data on retry errors;
 * that is unsafe for fleet orders, prices, vehicles and purchase history.
 */
function useShopPrivateLoad<T>(load:(isCurrent:()=>boolean)=>Promise<T>, deps:unknown[],
  eventFilter?:(e:any)=>boolean) {
  const {me}=useMe();
  const actor=me?.id??null, token=getToken();
  const [refresh,setRefresh]=useState(0);
  const key=JSON.stringify([actor,token,...deps,refresh]);
  const activeIdentity=useRef({actor,token,key});
  activeIdentity.current={actor,token,key};
  const [result,setResult]=useState<{
    key:string;data:T|null;error:string|null
  }>({key:'',data:null,error:null});
  const fnRef=useRef(load);
  fnRef.current=load;
  useEffect(()=>{
    let alive=true;
    setResult({key,data:null,error:null});
    if (!actor||!token) {
      setResult({key,data:null,error:'Для доступа войдите в кабинет'});
      return ()=>{alive=false};
    }
    // Freeze the loader for this query. A queued microtask must not dispatch
    // the next render's loader with this render's identity or a new bearer.
    const request=fnRef.current;
    const isCurrent=()=>alive&&getToken()===token&&
      activeIdentity.current.actor===actor&&activeIdentity.current.token===token&&
      activeIdentity.current.key===key;
    void (async()=>{
      try{
        // Retain deferred dispatch, but recheck identity before network I/O.
        await Promise.resolve();
        if(!isCurrent())return;
        const data=await request(isCurrent);
        if(isCurrent())setResult({key,data,error:null});
      }catch(error){
        if(isCurrent())
          setResult({key,data:null,error:error instanceof Error?error.message:'Не удалось загрузить данные'});
      }
    })();
    return ()=>{alive=false};
  },[key]);
  useEffect(()=>{
    const invalidate=()=>setRefresh(n=>n+1);
    window.addEventListener('traksos-auth-external-change',invalidate);
    window.addEventListener('traksos-auth-expired',invalidate);
    return ()=>{
      window.removeEventListener('traksos-auth-external-change',invalidate);
      window.removeEventListener('traksos-auth-expired',invalidate);
    };
  },[]);
  useEffect(()=>onEvent((event:any)=>{
    if(event.type==='connection_restored'||eventFilter?.(event))setRefresh(n=>n+1);
  }),[actor,token,...deps]);
  return {
    data:result.key===key?result.data:null,
    error:result.key===key?result.error:null,
    reload:()=>setRefresh(n=>n+1),
  };
}

const photoUrl = (p: any) => `${API_URL}/api/shop/products/${p.id}/photo?v=${p.photoVersion}`;
const STATUS_TONE: Record<string, string> = { new: 'accent', confirmed: 'accent', ready: 'good', shipped: 'accent', done: '', cancelled: 'bad' };
const DELIVERY: Record<string, string> = { pickup: 'Самовывоз', delivery: 'Доставка', master: 'С мастером на заявке' };
// Navigation passes opaque IDs, never VIN, vehicle details or customer information.
const partsContext = () => new URLSearchParams(location.hash.split('?')[1] ?? '');
const partsContextSuffix = (params: URLSearchParams) => {
  const bookingId = params.get('bookingId'), vehicleId = params.get('vehicleId');
  return bookingId ? '?bookingId=' + encodeURIComponent(bookingId)
    : vehicleId ? '?vehicleId=' + encodeURIComponent(vehicleId) : '';
};

function Thumb({ p, size = 56 }: { p: any; size?: number }) {
  return p.hasPhoto
    ? <img src={photoUrl(p)} alt="" loading="lazy" decoding="async" width={size} height={size} style={{ borderRadius: 12, objectFit: 'cover', flex: 'none', background: 'var(--bg-2)' }} />
    : <div aria-hidden="true" style={{ width: size, height: size, borderRadius: 12, background: 'var(--bg-2)', display: 'grid', placeItems: 'center', flex: 'none', fontSize: 22 }}>🔧</div>;
}

export function Shop() {
  const params = partsContext();
  const contextBookingId = params.get('bookingId');
  const contextVehicleId = params.get('vehicleId');
  const contextSuffix = partsContextSuffix(params);
  const contextualVehicle = useShopPrivateLoad<any>(() =>
    contextBookingId ? get('/api/bookings/' + encodeURIComponent(contextBookingId)).then((b:any) => b?.vehicle ?? null)
      : contextVehicleId ? get('/api/vehicles').then((fleet:any) =>
        Array.isArray(fleet) ? fleet.find((v:any) => v.id === contextVehicleId) ?? null : null)
      : Promise.resolve(null), [contextBookingId, contextVehicleId]);
  const vehicleLabel = [contextualVehicle.data?.brand, contextualVehicle.data?.model, contextualVehicle.data?.year].filter(Boolean).join(' ');
  const contextualBanner = (contextBookingId || contextVehicleId) && (
    <section className="card col" aria-label="Подбор запчастей для техники">
      <b>{contextBookingId ? 'Подбор для ремонтной заявки СТО' : 'Подбор для моей техники'}</b>
      <span className="note">{contextualVehicle.error
        ? 'Не удалось проверить данные машины. Уточните автомобиль в заявке перед подбором.'
        : !contextualVehicle.data ? 'Автомобиль не найден или данные ещё загружаются. Проверьте выбранную технику.'
        : vehicleLabel || 'Автомобиль из заявки'}</span>
      <span className="note">Поиск не подтверждает совместимость и не добавляет деталь автоматически в ремонт. Проверяйте применяемость по VIN и агрегату.</span>
    </section>
  );
  const c = useShopPrivateLoad<any>(() => get('/api/shop?light=1'), []);
  const [cart, setCart] = useCart();
  const [cat, setCat] = useState('all');
  const [term, setTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [page, setPage] = useState(0);
  const [offlineVersion, setOfflineVersion] = useState(0);
  const [offlineNote, setOfflineNote] = useState('');
  const [offline,setOffline]=useState(()=>!navigator.onLine);
  useEffect(()=>{
    const update=()=>setOffline(!navigator.onLine);
    window.addEventListener('online',update);window.addEventListener('offline',update);
    return ()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};
  },[]);
  const { busy: syncing, run: runSync } = useAction();
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedTerm(term); setPage(0); }, 280);
    return () => clearTimeout(t);
  }, [term]);
  const search = useShopPrivateLoad<any>(() => c.data?.enabled
    ? get(`/api/shop/search?q=${encodeURIComponent(debouncedTerm)}&category=${encodeURIComponent(cat)}&page=${page}`)
    : Promise.resolve({ items: [], total: 0, page: 0, limit: 24 }),
    [c.data?.enabled, cat, debouncedTerm, page], (e) => e.type === 'shop');
  const local = useLoad(() => searchOfflineParts(debouncedTerm, cat), [debouncedTerm, cat, offlineVersion]);
  const localRefs = useLoad(() => searchOfflineReferences(debouncedTerm, cat), [debouncedTerm, cat, offlineVersion]);
  // A separate small result set for reviewed reference entries without live pricing.
  // Do not fetch it before a search/category selection or while the shop is closed.
  const references = useShopPrivateLoad<any>(() =>
    c.data?.enabled && (debouncedTerm.trim() || cat !== 'all')
      ? get(`/api/shop/catalog/search?q=${encodeURIComponent(debouncedTerm)}&category=${encodeURIComponent(cat)}`)
      : Promise.resolve({ enabled: false, items: [], total: 0 }),
    [c.data?.enabled, debouncedTerm, cat]);
  const d = c.data;
  if (!d && offline && getToken()) return <main className="track-shop-home">
    <h1>Сохранённый справочник запчастей</h1>
    <p className="note" role="status">Нет подключения. Доступны только сохранённые названия и артикулы. Цена, наличие и возможность заказа не подтверждены.</p>
    <input className="field" type="search" aria-label="Поиск запчастей по названию или артикулу" value={term} onChange={e=>setTerm(e.target.value)} placeholder="Название, артикул или производитель"/>
    {(local.error||localRefs.error)&&<p role="alert" className="note">Не удалось прочитать часть локального справочника.</p>}
    {local.data&&localRefs.data&&!local.data.length&&!localRefs.data.length&&<p className="note">В сохранённом справочнике ничего не найдено. При подключении обновите каталог.</p>}
    {[...(local.data??[]),...(localRefs.data??[])].map((p,i)=><div key={p.id+':'+i} className="card"><b>{p.name}</b><span className="note">{[p.brand,p.article].filter(Boolean).join(' · ')}</span></div>)}
    <button className="btn ghost small" type="button" onClick={c.reload}>Повторить подключение</button>
    <a href="#/shop/history">История покупок · требуется подключение</a>
  </main>;
  if (!d) return <main><Loading error={c.error} />
    {c.error && <button className="btn ghost small" onClick={c.reload}>Повторить загрузку каталога</button>}
  </main>;
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  const add = (id: string) => setCart({ ...cart, [id]: Math.min(99, (cart[id] ?? 0) + 1) });
  if (!d.enabled) return (
    <main className="track-shop-home">
      <div className="track-shop-hero"><span className="track-shop-eyebrow">TRAKSOS · ЗАПЧАСТИ ДЛЯ ГРУЗОВИКОВ</span><h1>Каталог запчастей</h1><p>Оригиналы, проверенные аналоги и история заказов вашей техники.</p><span className="track-shop-gear" aria-hidden="true"/></div>
      {contextualBanner}
      <div className="card hi" style={{ alignItems: 'center', textAlign: 'center', padding: '32px 20px' }}>
        <span style={{ fontSize: 40 }} aria-hidden="true">🛒</span>
        <b style={{ fontSize: 20 }}>{d.closedTitle}</b>
        <span className="note">{d.closedText}</span>
      </div>
      <a className="linkrow" href={contextVehicleId?'#/shop/history/'+encodeURIComponent(contextVehicleId):'#/shop/history'}><span><b>История покупок</b><small>Просмотреть предыдущие заказы</small></span><span aria-hidden="true">›</span></a>
    </main>
  );
  const kits = d.products.filter((p: any) => p.isKit);
  const groups = (d.categoryGroups ?? []) as { id: string; title: string; categories: string[] }[];
  const items: any[] = search.data?.items ?? [];
  return (
    <main className="track-shop-home">
      <div className="track-shop-hero"><span className="track-shop-eyebrow">TRAKSOS · ЗАПЧАСТИ ДЛЯ ГРУЗОВИКОВ</span><h1>Найдём нужную деталь</h1><p>Удобный поиск по названию и артикулу, наличие, аналоги и история покупок.</p><span className="track-shop-gear" aria-hidden="true"/></div>
      {contextualBanner}
      <div className="between" style={{ alignItems: 'flex-start' }}>
        <div><h1>Магазин</h1><div className="sub">{d.note}</div></div>
        <button className="bell" aria-label={`Корзина, товаров: ${count}`} onClick={() => go('shop/cart' + contextSuffix)} style={{ position: 'relative' }}>
          🛒{count > 0 && <span className="badge">{count}</span>}
        </button>
      </div>
      <input className="field" type="search" aria-label="Поиск запчастей по названию или артикулу"
        placeholder="Название, артикул или производитель" value={term} onChange={(e) => setTerm(e.target.value)} />
      <span className="note">Поиск по названию и номеру детали. Можно выбрать категорию, не вводя артикул.</span>
      <div className="row" style={{ alignItems: 'center', gap: 8 }}>
        <button className="btn ghost small" disabled={syncing} onClick={async () => {
          setOfflineNote('');
          const result = await runSync(async () => {
            const products = await syncOfflineParts();
            const references = await syncOfflineReferences();
            return { products, references };
          }, null);
          // The first index may have committed pages before the second failed.
          setOfflineVersion(n=>n+1);
          if(!result)setOfflineNote('Обновление прервано. Уже сохранённые записи доступны; повторите синхронизацию при подключении.');
          if (result) {
            const { products, references } = result;
            setOfflineNote(products.unchanged && references.unchanged
              ? 'Локальный каталог уже актуален'
              : `Товары: обновлено ${products.added}, справочные номера: ${references.added}; удалено устаревших: ${products.removed + references.removed}.`
                + (!products.complete || !references.complete ? ' Нажмите ещё раз для продолжения.' : ''));
          }
        }}>{syncing ? 'Сохраняем…' : 'Сохранить справочник для слабого интернета'}</button>
      </div>
      {offlineNote && <span className="note" role="status">{offlineNote}</span>}
      {search.error&&<button type="button" className="btn ghost small" onClick={search.reload}>Повторить поиск товаров</button>}
      {references.error&&<div role="alert" className="note">Не удалось проверить справочные позиции. <button type="button" className="btn ghost small" onClick={references.reload}>Повторить поиск справочника</button></div>}
      {kits.map((p: any) => (
        <div key={p.id} className="card hi">
          <span className="label" style={{ color: 'var(--accent)' }}>Набор</span>
          <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
            {p.hasPhoto && <Thumb p={p} size={72} />}
            <div className="stack" style={{ gap: 4 }}><b style={{ fontSize: 17 }}>{p.name}</b>{(p.description || p.spec) && <span className="note">{p.description || p.spec}</span>}</div>
          </div>
          <div className="between"><b>{rub(p.price)}</b><button className="btn small" onClick={() => add(p.id)}>{cart[p.id] ? `В корзине · ${cart[p.id]}` : 'В корзину'}</button></div>
          <span className={`pill ${p.inStock ? 'good' : ''}`} style={{ alignSelf: 'flex-start' }}>{p.inStock ? 'в наличии' : `под заказ · от ${p.leadDays} дн.`}</span>
        </div>
      ))}
      <div className="card stack" style={{ gap: 10 }}>
        <div className="between">
          <b>Каталог запчастей</b>
          <button type="button" className="btn ghost small" onClick={() => { setCat('all'); setPage(0); }}>Все категории</button>
        </div>
        {cat !== 'all' && <span className="pill good" style={{ alignSelf: 'flex-start' }}>Раздел: {d.categories[cat] ?? cat}</span>}
        {groups.map((group) => (
          <details key={group.id} className="stack" style={{ gap: 8 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{group.id === 'truck' ? '🚚 ' : group.id === 'trailer' ? '🚛 ' : '🔧 '}{group.title}</summary>
            <div className="row" style={{ gap: 8, paddingTop: 8 }}>
              {group.categories.map((key) => (
                <button key={key} type="button" className="chip" aria-pressed={cat === key}
                  onClick={() => { setCat(key); setPage(0); }}>{d.categories[key]}</button>
              ))}
            </div>
          </details>
        ))}
      </div>
      {!search.data && search.error && ((local.data?.length ?? 0) + (localRefs.data?.length ?? 0)) > 0 ? (
        <div className="stack">
          <span className="note">Нет связи с каталогом. Показываем сохранённые названия и артикулы без цен и наличия. Для заказа нужен интернет.</span>
          {(local.data ?? []).map((p) => <div key={p.id} className="card" style={{ padding: 12 }}>
            <b>{p.name}</b>
            <span className="note">{[p.brand, p.article].filter(Boolean).join(' · ')}</span>
          </div>)}
          {(localRefs.data ?? []).map((p) => <div key={p.id} className="card" style={{ padding: 12 }}>
            <b>{p.name}</b>
            <span className="note">{[p.brand, p.article].filter(Boolean).join(' · ')}</span>
            <span className="pill" style={{ alignSelf: 'flex-start' }}>Справочник · цена уточняется</span>
          </div>)}
        </div>
      ) : !search.data ? <Loading error={search.error} /> : !items.length ? (
        <div className="empty">{references.data?.items?.length ? 'Товаров с подтверждённой ценой не найдено — ниже есть справочные позиции' : term || cat !== 'all' ? 'По вашему запросу пока ничего не найдено' : 'Товары скоро появятся'}</div>
      ) : (
        <div className="stack">
          {items.map((p: any) => (
            <div key={p.id} className="card" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }}>
              <Thumb p={p} />
              <div className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                <b>{p.name}</b>
                {(p.brand || p.article) && <span className="note">{[p.brand, p.article].filter(Boolean).join(' · ')}</span>}
                {p.spec && <span className="note">{p.spec}</span>}
                <span className="row" style={{ gap: 8 }}><b>{rub(p.price)}</b><span className={`pill ${p.inStock ? 'good' : ''}`}>{p.inStock ? 'в наличии' : `под заказ · от ${p.leadDays} дн.`}</span></span>
              </div>
              <button className="bell" aria-label={`Добавить: ${p.name}`} onClick={() => add(p.id)}>{cart[p.id] ? cart[p.id] : '+'}</button>
            </div>
          ))}
        </div>
      )}
      {(references.data?.items?.length ?? 0) > 0 && <div className="stack">
        <b>Ещё детали из справочника</b>
        <span className="note">Найдены по номеру или названию, но цена и наличие пока не подтверждены. Эти позиции нельзя заказать без проверки поставщика.</span>
        {references.data.items.map((p: any) => <div key={p.id} className="card" style={{ padding: 12 }}>
          <b>{p.name}</b>
          <span className="note">{p.brand} · {p.article} · {d.categories[p.category] ?? p.category}</span>
          <span className="pill" style={{ alignSelf: 'flex-start' }}>Стоимость уточняется</span>
        </div>)}
      </div>}
      {search.data && search.data.total > search.data.limit && (
        <div className="between">
          <button className="btn ghost small" disabled={page === 0} onClick={() => setPage((n) => Math.max(0, n - 1))}>Назад</button>
          <span className="note">Страница {page + 1} из {Math.ceil(search.data.total / search.data.limit)}</span>
          <button className="btn ghost small" disabled={(page + 1) * search.data.limit >= search.data.total}
            onClick={() => setPage((n) => n + 1)}>Дальше</button>
        </div>
      )}
      {count > 0 && <button className="btn" onClick={() => go('shop/cart' + contextSuffix)}>Корзина · {count} шт.</button>}
      <a className="linkrow" href={contextVehicleId?'#/shop/history/'+encodeURIComponent(contextVehicleId):'#/shop/history'}><span><b>Мои покупки</b><small>Повторить заказ или подобрать аналоги</small></span><span aria-hidden="true">›</span></a>
    </main>
  );
}

/** Receipt code is shown only to the authenticated buyer, never to couriers.
 * Verification by the courier does NOT complete the shop order: buyer approval
 * is a separate action, with an explicit acknowledgement of actual receipt.
 */
function CustomerCourierReceipt({orderId,reload}:{orderId:string;reload:()=>void}){
  const [open,setOpen]=useState(false);
  const [code,setCode]=useState<any>(null);
  const [error,setError]=useState('');
  const [agree,setAgree]=useState(false);
  const {busy,run}=useAction();
  const refresh=async()=>{
    try{const x=await get('/api/shop/orders/'+encodeURIComponent(orderId)+'/receipt-code');setCode(x);setError('');}
    catch(e){setError(e instanceof Error?e.message:'Код пока недоступен');}
  };
  return <section className="courier-customer-proof" aria-label="Подтверждение вручения заказа">
    <button type="button" className="btn ghost small" aria-expanded={open} onClick={async()=>{
      if(open){setOpen(false);return;}setOpen(true);await refresh();
    }}>{open?'Скрыть код вручения':'Код вручения и подтверждение получения'}</button>
    {open&&<>
      <p className="note">Покажите код курьеру только после прибытия. Не подтверждайте получение заранее.</p>
      {error&&<p role="alert" className="note">{error}</p>}
      {code&&<div className="courier-customer-code">
        <small>Ваш код (6 цифр)</small><strong>{code.code}</strong>
        <span>Курьер проверяет его на своём устройстве.</span>
      </div>}
      {code?.verified ? <>
        <label className="agree"><input type="checkbox" checked={agree}
          onChange={e=>setAgree(e.target.checked)}/>
          <span>Я лично получил(а) все указанные в заказе запчасти.</span></label>
        <button type="button" className="btn" disabled={!agree||busy}
          onClick={async()=>{
            const result=await run(()=>post('/api/shop/orders/'+encodeURIComponent(orderId)+'/confirm-received'),
              'Получение заказа подтверждено');
            if(result){setOpen(false);reload();}
          }}>Подтвердить фактическое получение</button>
      </> : <button type="button" className="btn ghost small" disabled={busy}
        onClick={refresh}>Проверить статус вручения</button>}
      <p className="note">После проверки кода заказ не закрывается автоматически — последнее решение за получателем.</p>
    </>}
  </section>;
}

function MyShopOrders({ orders, reload, canOrder }: { orders: any[]; reload: () => void; canOrder: boolean }) {
  const { busy, run } = useAction();
  const [cart, setCart] = useCart();
  const [openAnalog, setOpenAnalog] = useState<string | null>(null);
  const addItem = (id: string, qty = 1) => setCart({ ...cart, [id]: Math.min(99, (cart[id] ?? 0) + qty) });
  return (
    <div className="stack">
      <span className="label">Мои покупки</span>
      {orders.map((o) => (
        <div key={o.id} className="card">
          <div className="between"><b>Заказ №{o.number} · {rub(o.total)}</b><span className={`pill ${STATUS_TONE[o.status]}`}>{o.statusName}</span></div>
          <span className="note">{fmtTime(o.createdAt)} · {DELIVERY[o.delivery]}{o.address ? `: ${o.address}` : ''}</span>
          {o.vehicle && <span className="note">Для: {[o.vehicle.brand, o.vehicle.model, o.vehicle.plate].filter(Boolean).join(' ')}</span>}
          {o.items.map((i: any) => {const lineKey=o.id+':'+i.productId;const suffix=o.vehicleId?'?vehicleId='+encodeURIComponent(o.vehicleId):'';return <div key={lineKey} className="stack" style={{ gap: 6 }}>
            <span className="note">{i.name}{i.article ? ` · ${i.article}` : ''} × {i.qty}</span>
            {canOrder && o.status !== 'cancelled' && <div className="row" style={{ gap: 6 }}>
              <button className="btn ghost small" onClick={() => { addItem(i.productId, i.qty); go('shop/cart'+suffix); }}>Повторить</button>
              <button className="btn ghost small" aria-expanded={openAnalog === lineKey} onClick={() => setOpenAnalog(openAnalog === lineKey ? null : lineKey)}>Найти аналоги</button>
            </div>}
            {canOrder&&openAnalog === lineKey && <HistoryAnalogs productId={i.productId} add={id=>{addItem(id);go('shop/cart'+suffix);}} />}
          </div>})}
          {o.adminNote && <span>{o.adminNote}</span>}
          {o.delivery==='delivery' && o.canConfirmCourierReceipt &&
            ['arrived','code_verified'].includes(o.courierStatus) && o.status==='shipped' &&
            <CustomerCourierReceipt orderId={o.id} reload={reload}/>}
          {o.canConfirmCourierReceipt && !['arrived','code_verified','received','cancelled'].includes(o.courierStatus) &&
            <span className="note">Код вручения станет доступен, когда курьер отметит «На месте».</span>}
          {o.courierStatus && !o.canConfirmCourierReceipt && o.status!=='done' && o.status!=='cancelled' &&
            <span className="note">Код вручения доступен только пользователю, который оформил заказ.</span>}
          {o.cancelReason && <span className="note">Отменён: {o.cancelReason}</span>}
          {o.status === 'new' && <button className="btn ghost small" disabled={busy} onClick={async () => { if (await run(() => post(`/api/shop/orders/${o.id}/cancel`), 'Заказ отменён')) reload(); }}>Отменить</button>}
        </div>
      ))}
    </div>
  );
}

function HistoryAnalogs({ productId, add }: { productId: string; add: (id: string) => void }) {
  const a = useShopPrivateLoad<any>(() => get(`/api/shop/products/${productId}/analogs`), [productId]);
  if (!a.data) return <div className="stack">
    <Loading error={a.error} />
    {a.error && <button className="btn ghost small" onClick={a.reload}>Повторить проверку аналогов</button>}
  </div>;
  if (!a.data.enabled) return <span className="note">Каталог аналогов пока в разработке.</span>;
  if (!a.data.items.length) return <span className="note">Подтверждённых аналогов пока нет — нельзя рекомендовать замену наугад.</span>;
  return <div className="stack">
    <span className="note">Внимание: взаимозаменяемость артикула не гарантирует применяемость к конкретной машине. Проверьте VIN и агрегат.</span>
    {a.data.items.map((p: any) => <div key={p.id} className="card" style={{ padding: 10 }}>
      <b>{p.name}</b>
      <span className="note">{[p.brand, p.article, p.analogSource].filter(Boolean).join(' · ')}</span>
      <div className="between"><b>{rub(p.price)}</b><span className="note">{p.inStock?'В наличии':Number.isFinite(p.leadDays)?'Под заказ · от '+p.leadDays+' дн.':'Срок уточняется'}</span><button className="btn small" onClick={() => add(p.id)}>В корзину</button></div>
    </div>)}
  </div>;
}

/** Purchase history is loaded only when the customer opens this page, never for all fleet vehicles. */
export function ShopHistory({ vehicleId }: { vehicleId?: string }) {
  const {me}=useMe();
  return <ShopHistoryForAccount key={(me?.id??'guest')+':'+(vehicleId??'all')} vehicleId={vehicleId}/>;
}
function ShopHistoryForAccount({vehicleId}:{vehicleId?:string}){
  const [page, setPage] = useState(0);
  const c = useShopPrivateLoad(() => get('/api/shop?light=1'), []);
  const history = useShopPrivateLoad(() => get(`/api/shop/history?page=${page}${vehicleId ? '&vehicleId=' + encodeURIComponent(vehicleId) : ''}`),
    [page, vehicleId], (e) => e.type === 'shop');
  return <main>
    <Back to={vehicleId ? 'garage' : 'shop'} label={vehicleId ? 'Мой гараж' : 'Магазин'} />
    <h1>История покупок</h1>
    {vehicleId&&<a className="btn ghost small" href={'#/shop?vehicleId='+encodeURIComponent(vehicleId)}>Подобрать детали для этой техники</a>}
    {c.error&&<p className="note" role="alert">Не удалось проверить доступность магазина. <button type="button" className="btn ghost small" onClick={c.reload}>Повторить проверку</button></p>}
    {!history.data ? <div className="stack">
      <Loading error={history.error} />
      {history.error && <button className="btn ghost small" onClick={history.reload}>
        Повторить загрузку истории</button>}
    </div> : <>
      {history.data.items.length === 0 ? <div className="empty">{page>0?'На этой странице покупок нет':'Покупок пока нет'}</div> :
        <MyShopOrders orders={history.data.items} reload={history.reload} canOrder={!!c.data?.enabled} />}
      {(page > 0 || history.data.hasMore) && <div className="between">
        <button className="btn ghost small" disabled={page === 0} onClick={() => setPage((n) => Math.max(0, n - 1))}>Назад</button>
        <span className="note">Страница {page + 1}</span>
        <button className="btn ghost small" disabled={!history.data.hasMore} onClick={() => setPage((n) => n + 1)}>Дальше</button>
      </div>}
    </>}
  </main>;
}

export function ShopCart() {
  const contextParams = partsContext();
  const contextSuffix = partsContextSuffix(contextParams);
  const selectedVehicleFromLink = contextParams.get('vehicleId');
  const fromServiceBooking = !!contextParams.get('bookingId');
  const { me } = useMe();
  const c = useShopPrivateLoad<any>(() => get('/api/shop?light=1'), []);
  // A failure is NOT "zero active jobs": it must not silently invalidate
  // a user's master-delivery selection or let the UI use stale job IDs.
  const live = useShopPrivateLoad<any[]>(() => get('/api/orders'), []);
  const [cart, setCart] = useCart();
  const selectedIds = Object.keys(cart).sort().join(',');
  const selection = useShopPrivateLoad<{products:any[]}>(async(isCurrent)=>{
    if(!c.data?.enabled || !selectedIds) return {products:[]};
    // The API intentionally caps each read at 50 IDs. Never use its first
    // 50 results as if they described all lines in a larger saved cart.
    const ids=selectedIds.split(',').filter(Boolean);
    const pages=[];
    for(let i=0;i<ids.length;i+=50) {
      // A previous page may resolve after account/token/query invalidation.
      // Never send the remaining IDs using another session's bearer.
      if(!isCurrent())throw new Error('Запрос больше не актуален');
      const part=await get(`/api/shop/selection?ids=${encodeURIComponent(ids.slice(i,i+50).join(','))}`);
      if(!isCurrent())throw new Error('Запрос больше не актуален');
      pages.push(...(part.products??[]));
    }
    return {products:pages};
  },[c.data?.enabled,selectedIds]);
  const vehicles = useShopPrivateLoad<any[]>(() => c.data?.enabled && selectedIds
    ? get('/api/vehicles') : Promise.resolve([]), [c.data?.enabled, selectedIds]);
  const [vehicleId, setVehicleId] = useState('');
  useEffect(() => {
    if (selectedVehicleFromLink && ((vehicles.data ?? []) as any[]).some(v => v.id === selectedVehicleFromLink))
      setVehicleId(selectedVehicleFromLink);
  }, [selectedVehicleFromLink, vehicles.data]);
  const { busy, run } = useAction();
  const [delivery, setDelivery] = useState<'pickup' | 'delivery' | 'master' | ''>('');
  const [address, setAddress] = useState('');
  const [orderId, setOrderId] = useState('');
  const [payment, setPayment] = useState<'on_receipt' | 'invoice'>('on_receipt');
  const [comment, setComment] = useState('');
  const [outcomeUnknown,setOutcomeUnknown]=useState(false);
  const submitLock=useRef(false);
  const latestOwner=useRef(me?.id);
  latestOwner.current=me?.id;
  useEffect(()=>{
    // Form selections and free-text belong to one account and may not
    // leak into the next fleet owner's checkout in the same SPA session.
    setVehicleId('');setOrderId('');setDelivery('');
    setAddress('');setComment('');setPayment('on_receipt');
    setOutcomeUnknown(false);
  },[me?.id]);
  useEffect(()=>{
    if(!selectedIds)setOutcomeUnknown(false);
  },[selectedIds]);
  const d = c.data;
  if (!d) return <main><Back to="shop" label="Магазин" />
    <Loading error={c.error} />
    {c.error && <button className="btn ghost small" onClick={c.reload}>Повторить загрузку магазина</button>}
  </main>;
  if (!d.enabled) { go('shop'); return null; }
  const allIds=Object.keys(cart);
  const productsById=new Map<string,any>((selection.data?.products??[]).map((p:any)=>[p.id,p]));
  const lines=Object.entries(cart).map(([id,qty])=>({p:productsById.get(id),qty}))
    .filter((entry):entry is {p:any;qty:number}=>!!entry.p);
  const missing=selection.data?allIds.filter(id=>!productsById.has(id)):[];
  const fullyVerified=!!selectedIds&&!!selection.data&&!selection.error&&
    lines.length===allIds.length&&lines.length>0&&lines.length<=50;
  const goods=lines.reduce((sum,item)=>sum+item.p.price*item.qty,0);
  const dl=d.delivery;
  const open=(live.data??[]).filter((o:any)=>
    ['accepted','en_route','arrived','working'].includes(o.status));
  const opts=([['pickup','Самовывоз',dl.pickupAddress||'адрес пришлём'],
    ['delivery','Доставка',rub(dl.deliveryPrice)+' · '+dl.deliveryNote],
    ['master','С мастером на заявке','мастер привезёт на выезд']] as const)
    .filter(([k])=>k==='pickup'?dl.pickup:k==='delivery'?dl.delivery:
      dl.withMaster&&!!live.data&&open.length>0);
  const total=goods+(delivery==='delivery'?dl.deliveryPrice:0);
  const setQty=(id:string,q:number)=>{
    if(busy||submitLock.current)return;
    const next={...cart};
    if(q<=0)delete next[id];else next[id]=Math.min(99,q);
    setCart(next);
  };
  const orderValid=delivery==='master'?!!live.data&&open.some((o:any)=>o.id===orderId):
    delivery==='pickup'?!!dl.pickup:delivery==='delivery'?!!dl.delivery&&!!address.trim():false;
  const selectedVehicleValid=!vehicleId||
    (!!vehicles.data&&vehicles.data.some((v:any)=>v.id===vehicleId));
  const maySubmit=fullyVerified&&orderValid&&selectedVehicleValid&&
    !busy&&!submitLock.current&&!outcomeUnknown;
  async function submit(){
    if(!maySubmit||!me?.id||!getToken()||submitLock.current)return;
    const actor=me.id,token=getToken();
    const payload={
      items:lines.map((item)=>({productId:item.p.id,qty:item.qty})),
      delivery,address:address.trim()||null,orderId:orderId||null,
      payment,comment:comment.trim()||null,vehicleId:vehicleId||null,
    };
    submitLock.current=true;
    try{
      // Never automatically re-submit: an offline timeout can follow the
      // successful server insert and stock reservation.
      const created=await run(()=>post('/api/shop/orders',payload),null);
      if(latestOwner.current!==actor||getToken()!==token)return;
      if(created){
        setCart({});
        // Preserve the approved post-checkout navigation.
        go('shop');
      }else{
        setOutcomeUnknown(true);
      }
    }finally{
      submitLock.current=false;
    }
  }
  return (
    <main>
      <Back to={'shop' + contextSuffix} label="Магазин" />
      <div><h1>Корзина</h1><div className="sub">Доступные способы оплаты зависят от настроек магазина; компаниям — по счёту.</div></div>
      {fromServiceBooking && <div className="note">Подбор открыт из ремонта СТО. Заказ товаров не меняет стоимость ремонта и не добавляет детали в смету автоматически.</div>}
      {selection.error && <div className="banner warn" role="alert">
        Не удалось перепроверить цену и доступность выбранных деталей: {selection.error}
        <button className="btn ghost small" onClick={selection.reload}>Повторить проверку товаров</button>
      </div>}
      {allIds.length>50 && <div className="banner warn" role="alert">
        В заказе допускается не более 50 разных позиций. Уберите лишние товары перед оформлением.
      </div>}
      {missing.length>0 && <div className="banner warn" role="alert">
        {missing.length} позиций уже недоступны в магазине. Удалите их из корзины перед оформлением.
        <div className="row">
          {missing.map(id=><button key={id} className="btn ghost small"
            disabled={busy} onClick={()=>setQty(id,0)}>Убрать недоступную позицию</button>)}
        </div>
      </div>}
      {live.error && <div className="banner warn" role="alert">
        Не удалось проверить активные ремонтные заявки: {live.error}
        <button className="btn ghost small" onClick={live.reload}>Повторить проверку заявок</button>
      </div>}
      {vehicles.error && <div className="banner warn" role="alert">
        Не удалось проверить гараж: {vehicles.error}
        <button className="btn ghost small" onClick={vehicles.reload}>Повторить проверку гаража</button>
      </div>}
      {outcomeUnknown && <div className="banner warn" role="alert">
        Не получили подтверждение оформления. Сервер мог уже создать заказ и зарезервировать товары.
        Сначала проверьте историю покупок. Не отправляйте заказ повторно вслепую.
        <div className="row">
          <a href="#/shop/history" className="btn ghost small">Проверить историю покупок</a>
          <button className="btn ghost small" onClick={()=>setOutcomeUnknown(false)}>
            Я проверил историю — разрешить новую отправку
          </button>
        </div>
      </div>}
      {!lines.length ? <div className="empty">{selection.error ?? (selectedIds ? 'Проверяем актуальную цену и наличие…' : 'Корзина пуста')}</div> : <>
        <div className="stack">
          {lines.map(({ p, qty }) => (
            <div key={p.id} className="card" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }}>
              <Thumb p={p} size={48} />
              <div className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}><b>{p.name}</b><span className="note">{rub(p.price)} · {p.inStock ? 'в наличии' : `под заказ, от ${p.leadDays} дн.`}</span></div>
              <div className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
                <button className="bell" aria-label="Меньше" disabled={busy} onClick={() => setQty(p.id, qty - 1)}>−</button>
                <b style={{ minWidth: 20, textAlign: 'center' }}>{qty}</b>
                <button className="bell" aria-label="Больше" disabled={busy} onClick={() => setQty(p.id, qty + 1)}>+</button>
              </div>
            </div>
          ))}
        </div>
        <div className="card">
          <Field label="Для какой машины / прицепа (необязательно)">
            <select className="field" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">Без привязки к машине</option>
              {((vehicles.data ?? []) as any[]).map((v: any) =>
                <option key={v.id} value={v.id}>{[v.brand, v.model, v.plate || v.trailer_plate].filter(Boolean).join(' ')}</option>)}
            </select>
          </Field>
          <span className="note">Покупка появится в истории выбранной техники. Для проверки совместимости могут потребоваться VIN и данные агрегата.</span>
        </div>
        <div className="card">
          <b>Как получить</b>
          {opts.map(([k, n, h]) => <button key={k} className="opt" aria-pressed={delivery === k} onClick={() => setDelivery(k)}><b>{n}</b><small>{h}</small></button>)}
          {delivery === 'delivery' && <Field label="Куда привезти"><input className="field" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Адрес или стоянка" /></Field>}
          {delivery === 'master' && (
            <Field label="По какой заявке">
              <select className="field" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                <option value="">Выберите заявку</option>
                {open.map((o: any) => <option key={o.id} value={o.id}>№{o.number} · {o.address ?? o.service}</option>)}
              </select>
            </Field>
          )}
        </div>
        {me?.company_inn && (
          <div className="grid2">
            <button className="seg" aria-pressed={payment === 'on_receipt'} onClick={() => setPayment('on_receipt')}>При получении</button>
            <button className="seg" aria-pressed={payment === 'invoice'} onClick={() => setPayment('invoice')}>По счёту</button>
          </div>
        )}
        <Field label="Комментарий · по желанию"><input className="field" value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
        <dl className="kv card">
          <dt>Товары</dt><dd>{rub(goods)}</dd>
          {delivery === 'delivery' && <><dt>Доставка</dt><dd>{rub(dl.deliveryPrice)}</dd></>}
          <dt>Итого</dt><dd><b>{rub(total)}</b></dd>
        </dl>
        <button className="btn" disabled={!maySubmit} onClick={submit}>Оформить заказ</button>
        <span className="note">Что есть в наличии — отложим сразу. Под заказ — уточним срок и напишем.</span>
      </>}
    </main>
  );
}

// ═══════════════ Админ: магазин ═══════════════

async function resizeImage(file: File): Promise<string> {
  // Browser decoding is not free. Never allocate huge canvases or accept
  // arbitrary image/* formats that the server will reject after upload.
  if (!['image/jpeg','image/png','image/webp'].includes(file.type))
    throw new Error('Выберите фотографию JPEG, PNG или WEBP');
  if (file.size > 10_000_000)
    throw new Error('Исходная фотография слишком большая (максимум 10 МБ)');
  const url=URL.createObjectURL(file);
  try {
    const img=await new Promise<HTMLImageElement>((resolve,reject)=>{
      const image=new Image();
      image.onload=()=>resolve(image);
      image.onerror=()=>reject(new Error('Не удалось открыть фотографию'));
      image.src=url;
    });
    if (!img.naturalWidth || !img.naturalHeight ||
        img.naturalWidth*img.naturalHeight>40_000_000)
      throw new Error('Слишком высокое разрешение фотографии');
    const factor=Math.min(1,800/Math.max(img.naturalWidth,img.naturalHeight));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(img.naturalWidth*factor));
    canvas.height=Math.max(1,Math.round(img.naturalHeight*factor));
    const ctx=canvas.getContext('2d');
    if(!ctx)throw new Error('Устройство не поддерживает обработку фотографии');
    ctx.drawImage(img,0,0,canvas.width,canvas.height);
    const encoded=canvas.toDataURL('image/jpeg',0.82);
    if(encoded.length>2_000_000)
      throw new Error('Фотография после обработки больше допустимых 1,5 МБ');
    return encoded;
  }finally{
    URL.revokeObjectURL(url);
  }
}

export function AdminShop() {
  const {me}=useMe();
  const [tab, setTab] = useState<'orders' | 'products' | 'catalog' | 'settings'>('orders');
  return (
    <div className="stack" key={(me?.id??'signed-out')+':'+(getToken()??'no-token')}>
      <ShopSwitch />
      <div className="scroll-x" role="tablist">
        {([['orders', 'Заказы'], ['products', 'Товары'], ['catalog', 'Справочник'], ['settings', 'Получение и тексты']] as const).map(([k, n]) => <button key={k} className="chip" role="tab" aria-pressed={tab === k} onClick={() => setTab(k)}>{n}</button>)}
      </div>
      {tab === 'orders' && <AdminShopOrders />}
      {tab === 'products' && <AdminProducts />}
      {tab === 'catalog' && <AdminShopCatalog />}
      {tab === 'settings' && <ShopSettings />}
    </div>
  );
}

function ShopSwitch() {
  const s = useShopPrivateLoad<any>(() => get('/api/admin/settings'), []);
  const { busy, run } = useAction();
  if (!s.data) return <div className="stack">
    <Loading error={s.error}/>
    {s.error&&<button className="btn ghost small" onClick={s.reload}>Повторить загрузку настроек магазина</button>}
  </div>;
  const on = s.data.shop.enabled;
  return (
    <div className={`banner col ${on ? '' : 'warn'}`}>
      <b>Магазин {on ? 'открыт для клиентов' : 'закрыт — клиенты видят «скоро»'}</b>
      <span className="note">{on ? 'Если что-то сбоит — закройте: новые заказы перестанут приниматься, уже оформленные останутся у вас и у клиентов.' : `Клиент видит: «${s.data.shop.closedTitle}». Товары можно готовить заранее.`}</span>
      <button className="btn ghost small" disabled={busy || !on} onClick={async () => { if (await run(() => put('/api/admin/settings/shop', { enabled: false }), 'Магазин закрыт')) s.reload(); }}>{on ? 'Закрыть магазин' : 'Магазин закрыт до приёмки'}</button>
      {!on && <small className="note">Открытие магазина для клиентов заблокировано до отдельной проверки и утверждённого выпуска. Администратор может готовить каталог без публикации.</small>}
    </div>
  );
}

function ShopSettings() {
  const s = useShopPrivateLoad<any>(() => get('/api/admin/settings'), []);
  const { busy, run } = useAction();
  const [f, setF] = useState<any>(null);
  useEffect(() => { if (s.data && !f) setF(s.data.shop); }, [s.data]); // eslint-disable-line
  if (!s.data||!f) return <div className="stack">
    <Loading error={s.error}/>
    {s.error&&<button className="btn ghost small" onClick={s.reload}>Повторить загрузку условий</button>}
  </div>;
  const set = (k: string, v: any) => setF({ ...f, [k]: v });
  return (
    <div className="card">
      <Field label="Заголовок, когда закрыт"><input className="field" value={f.closedTitle} onChange={(e) => set('closedTitle', e.target.value)} /></Field>
      <Field label="Текст, когда закрыт"><textarea className="field" value={f.closedText} onChange={(e) => set('closedText', e.target.value)} /></Field>
      <Field label="Подзаголовок витрины"><input className="field" value={f.note} onChange={(e) => set('note', e.target.value)} /></Field>
      <label className="agree"><input type="checkbox" checked={f.pickup} onChange={(e) => set('pickup', e.target.checked)} /><span>Самовывоз</span></label>
      {f.pickup && <Field label="Адрес самовывоза"><input className="field" value={f.pickupAddress} onChange={(e) => set('pickupAddress', e.target.value)} /></Field>}
      <label className="agree"><input type="checkbox" checked={f.delivery} onChange={(e) => set('delivery', e.target.checked)} /><span>Доставка</span></label>
      {f.delivery && <div className="grid2">
        <Field label="Цена доставки"><RubInput value={f.deliveryPrice} onChange={(v) => set('deliveryPrice', v ?? 0)} /></Field>
        <Field label="Условия"><input className="field" value={f.deliveryNote} onChange={(e) => set('deliveryNote', e.target.value)} /></Field>
      </div>}
      <label className="agree"><input type="checkbox" checked={f.withMaster} onChange={(e) => set('withMaster', e.target.checked)} /><span>Передать с мастером на открытой заявке</span></label>
      <button className="btn" disabled={busy} onClick={async () => { const { enabled, ...rest } = f; void enabled; if (await run(() => put('/api/admin/settings/shop', rest), 'Сохранено')) s.reload(); }}>Сохранить</button>
    </div>
  );
}

const EMPTY = { category: 'other', name: '', spec: '', description: '', brand: '', article: '', searchTerms: '', price: null as number | null, stock: null as number | null, leadDays: 2, isKit: false, active: true, sort: 100 };

function AdminProducts() {
  const l = useShopPrivateLoad<any[]>(() => get('/api/admin/shop/products'), []);
  const cats = useShopPrivateLoad<any>(() => get('/api/shop'), []);
  const [edit, setEdit] = useState<any>(null);
  if (!l.data||!cats.data) return <div className="stack">
    <Loading error={l.error??cats.error}/>
    {(l.error||cats.error)&&<button className="btn ghost small"
      onClick={()=>{l.reload();cats.reload()}}>Повторить загрузку товаров</button>}
  </div>;
  if (edit) return <ProductForm p={edit} products={l.data} categories={cats.data.categories} onDone={() => { setEdit(null); l.reload(); }} />;
  return (
    <div className="stack">
      <button className="btn" onClick={() => setEdit({ ...EMPTY })}>+ Добавить товар</button>
      {!l.data.length && <div className="empty">Товаров пока нет. Добавьте то, что есть в наличии.</div>}
      {l.data.map((p: any) => (
        <button key={p.id} className="card" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, textAlign: 'left', opacity: p.active ? 1 : 0.5 }} onClick={() => setEdit(p)}>
          <Thumb p={p} size={48} />
          <div className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
            <b>{p.isKit ? 'Набор · ' : ''}{p.name}</b>
            <span className="note">{rub(p.price)} · {p.stock == null ? 'под заказ' : `на складе ${p.stock} шт.`} · {p.categoryName}{p.active ? '' : ' · скрыт'}</span>
          </div>
          <span aria-hidden="true">›</span>
        </button>
      ))}
    </div>
  );
}

function ProductForm({ p, products, categories, onDone }: { p: any; products: any[]; categories: Record<string, string>; onDone: () => void }) {
  const { busy, run } = useAction();
  const [f, setF] = useState<any>({ ...p, spec: p.spec ?? '', description: p.description ?? '', brand: p.brand ?? '', article: p.article ?? '', searchTerms: p.searchTerms ?? '' });
  const [analogId, setAnalogId] = useState('');
  const [analogSource, setAnalogSource] = useState('');
  const [verified, setVerified] = useState(false);
  const [photo, setPhoto] = useState<string | null | undefined>(undefined);
  const [photoBusy,setPhotoBusy]=useState(false);
  const [photoError,setPhotoError]=useState('');
  const set = (k: string, v: any) => setF({ ...f, [k]: v });
  async function save() {
    const body: any = { category: f.category, name: f.name, spec: f.spec || null, description: f.description || null, brand: f.brand || null, article: f.article || null, searchTerms: f.searchTerms || null, price: f.price, stock: f.stock, leadDays: f.leadDays, isKit: f.isKit, active: f.active, sort: f.sort };
    if (photo !== undefined) body.photoDataUrl = photo;
    if (await run(() => (p.id ? put(`/api/admin/shop/products/${p.id}`, body) : post('/api/admin/shop/products', body)), 'Товар сохранён')) onDone();
  }
  return (
    <div className="card">
      <b>{p.id ? 'Товар' : 'Новый товар'}</b>
      <Field label="Название"><input className="field" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Розетка 15-контактная" /></Field>
      <div className="grid2">
        <Field label="Производитель детали"><input className="field" value={f.brand} maxLength={80} onChange={(e) => set('brand', e.target.value)} placeholder="VDO, WABCO, BPW…" /></Field>
        <Field label="Артикул"><input className="field" value={f.article} maxLength={100} onChange={(e) => set('article', e.target.value)} placeholder="Каталожный номер" /></Field>
      </div>
      <Field label="Синонимы для поиска"><input className="field" value={f.searchTerms} maxLength={400}
        onChange={(e) => set('searchTerms', e.target.value)} placeholder="Например: датчик скорости, импульсный…" /></Field>
      <Field label="Кратко — характеристики"><input className="field" value={f.spec} onChange={(e) => set('spec', e.target.value)} placeholder="24 В · ISO 12098" /></Field>
      <Field label="Описание · по желанию"><textarea className="field" value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
      <Field label="Категория" group>
        <div className="row">{Object.entries(categories).map(([k, n]) => <button key={k} type="button" className="chip" aria-pressed={f.category === k} onClick={() => setF({ ...f, category: k, isKit: k === 'kit' ? true : f.isKit })}>{n}</button>)}</div>
      </Field>
      <div className="grid2">
        <Field label="Цена"><RubInput value={f.price} onChange={(v) => set('price', v)} /></Field>
        <Field label="На складе, шт." hint="Пусто — под заказ"><input className="field" inputMode="numeric" value={f.stock ?? ''} onChange={(e) => set('stock', e.target.value === '' ? null : Math.max(0, parseInt(e.target.value.replace(/\D/g, '') || '0', 10)))} /></Field>
      </div>
      <div className="grid2">
        <Field label="Срок под заказ, дн."><input className="field" inputMode="numeric" value={f.leadDays} onChange={(e) => set('leadDays', parseInt(e.target.value.replace(/\D/g, '') || '0', 10))} /></Field>
        <Field label="Порядок" hint="Меньше — выше"><input className="field" inputMode="numeric" value={f.sort} onChange={(e) => set('sort', parseInt(e.target.value.replace(/\D/g, '') || '0', 10))} /></Field>
      </div>
      <label className="agree"><input type="checkbox" checked={f.isKit} onChange={(e) => set('isKit', e.target.checked)} /><span>Набор — показывать крупно сверху</span></label>
      <label className="agree"><input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} /><span>Показывать в магазине</span></label>
      <div className="row">
        {photo ? <img src={photo} alt="" width={64} height={64} style={{ borderRadius: 12, objectFit: 'cover' }} /> : p.hasPhoto && photo !== null ? <Thumb p={p} size={64} /> : null}
        <label className="btn ghost small">Фото
          <input type="file" accept="image/jpeg,image/png,image/webp" hidden
            disabled={busy||photoBusy} onChange={async(e)=>{
              const input=e.currentTarget,file=input.files?.[0];
              if(!file)return;
              setPhotoError('');setPhotoBusy(true);
              try{setPhoto(await resizeImage(file));}
              catch(error){setPhotoError(error instanceof Error?error.message:'Не удалось обработать фото');}
              finally{input.value='';setPhotoBusy(false);}
            }}/>
        </label>
        {(p.hasPhoto || photo) && <button type="button" className="btn ghost small"
          disabled={busy||photoBusy} onClick={() => {setPhoto(null);setPhotoError('');}}>Убрать фото</button>}
        {photoBusy && <span className="note" role="status">Подготавливаем фотографию…</span>}
        {photoError && <span className="banner warn" role="alert">{photoError}</span>}
      </div>
      <div className="grid2">
        <button className="btn" disabled={busy || photoBusy || f.name.trim().length < 2 || f.price == null} onClick={save}>Сохранить</button>
        <button className="btn ghost" onClick={onDone}>Назад</button>
      </div>
      {p.id && <SupplierMapping productId={p.id} />}
      {p.id && <div className="stack" style={{ gap: 8 }}>
        <b>Связать с аналогом из каталога</b>
        <select className="field" aria-label="Выберите аналог" value={analogId} onChange={(e) => setAnalogId(e.target.value)}>
          <option value="">Выберите другую деталь</option>
          {products.filter((x: any) => x.id !== p.id).map((x: any) =>
            <option key={x.id} value={x.id}>{x.brand ?? ''} {x.article ?? ''} — {x.name}</option>)}
        </select>
        <input className="field" aria-label="Источник кросс-номера" value={analogSource}
          onChange={(e) => setAnalogSource(e.target.value)} placeholder="Источник: каталог производителя, документ…" />
        <label className="agree"><input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
          <span>Подтверждаю кросс-артикул по указанному источнику (применяемость к VIN проверяется отдельно)</span></label>
        <button className="btn ghost small" disabled={busy || !analogId || analogSource.trim().length < 3}
          onClick={async () => { if (await run(() => post(`/api/admin/shop/products/${p.id}/analogs`,
            { analogId, source: analogSource, verified }), 'Связь сохранена')) { setAnalogId(''); setAnalogSource(''); setVerified(false); } }}>
          Сохранить связь с аналогом
        </button>
      </div>}
      {p.id && <button className="btn ghost small" disabled={busy} onClick={async () => { if (await run(() => del(`/api/admin/shop/products/${p.id}`), 'Товар скрыт')) onDone(); }}>Скрыть из магазина</button>}
    </div>
  );
}

/** Internal procurement mapping: supplier SKUs never appear in public product cards. */
function SupplierMapping({ productId }: { productId: string }) {
  const ref = useShopPrivateLoad<any>(() => get(`/api/admin/shop/products/${productId}/supplier`), [productId]);
  const { busy, run } = useAction();
  const [form, setForm] = useState({
    article: '', brand: '', sourceNote: '', verified: false,
  });
  useEffect(() => {
    if (!ref.data) return;
    setForm({
      article: ref.data.article ?? '', brand: ref.data.brand ?? '',
      sourceNote: ref.data.sourceNote ?? '', verified: !!ref.data.verified,
    });
  }, [ref.data?.updatedAt, productId]); // eslint-disable-line
  const set = (key: keyof typeof form, value: string | boolean) => setForm((v) => ({ ...v, [key]: value }));
  if (!ref.data) return <div className="stack">
    <Loading error={ref.error}/>
    {ref.error&&<button className="btn ghost small" onClick={ref.reload}>Повторить получение артикула поставщика</button>}
  </div>;
  return <div className="card stack" style={{ gap: 8 }}>
    <b>Артикул поставщика · Автоконтинент</b>
    <span className="note">Внутренняя закупка. Покупатель эти поля не видит. API поставщика ещё не подключён.</span>
    <div className="grid2">
      <Field label="Артикул Автоконтинента"><input className="field" value={form.article} maxLength={100}
        onChange={(e) => set('article', e.target.value)} placeholder="Номер по прайсу поставщика" /></Field>
      <Field label="Марка по каталогу поставщика"><input className="field" value={form.brand} maxLength={80}
        onChange={(e) => set('brand', e.target.value)} placeholder="Производитель" /></Field>
    </div>
    <Field label="Источник сверки"><input className="field" value={form.sourceNote} maxLength={500}
      onChange={(e) => set('sourceNote', e.target.value)} placeholder="Ссылка/название каталога или документа" /></Field>
    <label className="agree"><input type="checkbox" checked={form.verified}
      onChange={(e) => set('verified', e.target.checked)} />
      <span>Артикул проверен по указанному источнику. Применяемость по VIN проверяется отдельно.</span>
    </label>
    <div className="row">
      <button type="button" className="btn ghost small"
        disabled={busy || form.article.trim().length < 2 || (form.verified && form.sourceNote.trim().length < 3)}
        onClick={async () => {
          const saved = await run(() => put(`/api/admin/shop/products/${productId}/supplier`, {
            article: form.article, brand: form.brand || null, sourceNote: form.sourceNote || null,
            verified: form.verified,
          }), 'Внутренний артикул сохранён');
          if (saved) ref.reload();
        }}>Сохранить артикул поставщика</button>
      {ref.data.article && <button type="button" className="btn ghost small" disabled={busy}
        onClick={async () => {
          if (!confirm('Удалить привязку артикула Автоконтинента?')) return;
          if (await run(() => del(`/api/admin/shop/products/${productId}/supplier`), 'Привязка удалена')) ref.reload();
        }}>Удалить привязку</button>}
    </div>
  </div>;
}

const NEXT: Record<string, [string, string][]> = {
  new: [['confirmed', 'Подтвердить']], confirmed: [['ready', 'Собран — ждёт'], ['shipped', 'Отправлен']],
  ready: [['shipped', 'Отправлен'], ['done', 'Получен']], shipped: [['done', 'Получен']],
};

function CourierAssign({order,onDone}:{order:any;onDone:()=>void}){
  const [opened,setOpened]=useState(false);
  const [selected,setSelected]=useState('');
  const couriers=useLoad<any[]>(()=>opened?get('/api/admin/couriers'):Promise.resolve([]),[opened]);
  const {busy,run}=useAction();
  if(order.delivery!=='delivery')return null;
  if(order.courierStatus&&order.courierStatus!=='assigned')return <p className="note">
    Доставка курьером · {order.courierStatus==='received'?'Подтверждена получателем':
      order.courierStatus==='code_verified'?'Код проверен — ожидаем подтверждение':
      'В процессе'} · закрытие покупателем отдельно
  </p>;
  return <section className="courier-admin-assign">
    {order.courierStatus==='assigned'&&<p className="note">Курьер назначен. Код доступен только покупателю.</p>}
    {order.status==='ready'&&<button type="button" className="btn ghost small"
      onClick={()=>setOpened(v=>!v)} aria-expanded={opened}>
      {opened?'Скрыть выбор':'Назначить курьера'}
    </button>}
    {opened&&<div className="stack">
      <p className="note">Назначать можно только подготовленные заказы с адресом.
        Сменить назначение можно до начала рейса.</p>
      {!couriers.data?<span className="note">{couriers.error||'Загружаем доступных курьеров…'}</span>
        :couriers.data.length===0?<span className="note">Курьеров пока нет. Создайте отдельный аккаунт с ролью «Курьер» через раздел регистрации администратора.</span>
        :<>
          <label className="stack"><span className="label">Курьер для этой доставки</span>
            <select className="field" value={selected} onChange={e=>setSelected(e.target.value)}>
              <option value="">Выберите курьера</option>
              {couriers.data.map((x:any)=><option key={x.id} value={x.id}>{x.name||'Курьер'} · {x.id.slice(0,8)}</option>)}
            </select>
          </label>
          <button type="button" className="btn small" disabled={busy||!selected}
            onClick={async()=>{
              const saved=await run(()=>post('/api/admin/shop/orders/'+encodeURIComponent(order.id)+'/courier',
                {courierId:selected}),'Курьер назначен');
              if(saved){setOpened(false);onDone();}
            }}>Сохранить назначение</button>
        </>}
    </div>}
  </section>;
}
/** An administrator may rotate a locked or expired code, but cannot view it.
 * A written reason and audit event are mandatory; the buyer sees it privately.
 */
function CourierReceiptRecovery({order,onDone}:{order:any;onDone:()=>void}){
  const [reason,setReason]=useState('');
  const {busy,run}=useAction();
  const expires=order.courierCodeExpiresAt?new Date(order.courierCodeExpiresAt).getTime():NaN;
  const expired=Number.isFinite(expires)&&expires<Date.now();
  if(order.courierStatus!=='arrived'||order.status!=='shipped')return null;
  if((order.courierCodeAttempts??0)<5&&!expired)return null;
  return <section className="card stack" aria-label="Восстановление кода вручения">
    <b>Код вручения {expired?'истёк':'заблокирован'}</b>
    <p className="note">Администратор может выдать новый код после проверки ситуации.
      Сам код показывается только покупателю в истории заказа.</p>
    {(order.courierCodeResets??0)>=3
      ? <p className="note">Лимит восстановления исчерпан — требуется разбирательство.</p>
      : <>
        <label className="stack"><span className="label">Причина восстановления</span>
          <textarea className="field" value={reason} maxLength={500}
            placeholder="Например: код истёк, согласовано с получателем"
            onChange={e=>setReason(e.target.value)}/></label>
        <button type="button" className="btn ghost small" disabled={busy||reason.trim().length<10}
          onClick={async()=>{
            const saved=await run(()=>post('/api/admin/shop/orders/'+encodeURIComponent(order.id)+
              '/courier/reset-receipt',{reason:reason.trim()}),'Код обновлён для получателя');
            if(saved){setReason('');onDone();}
          }}>Выдать новый код получателю</button>
      </>}
  </section>;
}

function AdminShopOrders() {
  const [all, setAll] = useState(false);
  const l = useShopPrivateLoad<any[]>(() => get(`/api/admin/shop/orders${all ? '' : '?status=open'}`), [all], (e) => e.type === 'shop');
  const { busy, run } = useAction();
  const [note, setNote] = useState<Record<string, string>>({});
  if (!l.data) return <div className="stack">
    <Loading error={l.error}/>
    {l.error&&<button className="btn ghost small" onClick={l.reload}>Повторить загрузку заказов</button>}
  </div>;
  const act = async (id: string, status: string, ok: string) => { if (await run(() => post(`/api/admin/shop/orders/${id}/status`, { status, note: note[id] || undefined }), ok)) { setNote({ ...note, [id]: '' }); l.reload(); } };
  return (
    <div className="stack">
      <div className="scroll-x">
        <button className="chip" aria-pressed={!all} onClick={() => setAll(false)}>В работе</button>
        <button className="chip" aria-pressed={all} onClick={() => setAll(true)}>Все</button>
      </div>
      {!l.data.length && <div className="empty">{all ? 'Заказов пока нет' : 'Открытых заказов нет'}</div>}
      {l.data.map((o: any) => (
        <div key={o.id} className={`card ${o.status === 'new' ? 'hi' : ''}`}>
          <div className="between"><b>№{o.number} · {rub(o.total)}</b><span className={`pill ${STATUS_TONE[o.status]}`}>{o.statusName}</span></div>
          <span className="note">{fmtTime(o.createdAt)} · {o.client.name ?? 'Клиент'} · {o.client.phone}</span>
          <span>{o.items.map((i: any) => `${i.name} × ${i.qty}${i.inStock ? '' : ' (под заказ)'}`).join(', ')}</span>
          <span className="note">{DELIVERY[o.delivery]}{o.address ? `: ${o.address}` : ''}{o.orderId ? ' · ' : ''}{o.orderId && <a href={`#/order/${o.orderId}`}>заявка</a>} · {o.payment === 'invoice' ? 'по счёту' : 'оплата при получении'}</span>
          {o.comment && <span className="note">«{o.comment}»</span>}
          {o.adminNote && <span className="note">Клиенту: {o.adminNote}</span>}
          <CourierAssign order={o} onDone={l.reload}/>
          <CourierReceiptRecovery order={o} onDone={l.reload}/>
          {NEXT[o.status] && <>
            <input className="field" placeholder="Сообщение клиенту · по желанию" value={note[o.id] ?? ''} onChange={(e) => setNote({ ...note, [o.id]: e.target.value })} />
            <div className="row">
              {NEXT[o.status].filter(([s])=>!o.courierStatus||!['done','shipped'].includes(s))
                .map(([s, n]) => <button key={s} className="btn small" disabled={busy}
                  onClick={() => act(o.id, s, n)}>{n}</button>)}
              {(!o.courierStatus||o.courierStatus==='assigned')&&
                <button className="btn ghost small" disabled={busy}
                  onClick={() => act(o.id, 'cancelled', 'Заказ отменён, товар вернулся на склад')}>Отменить</button>}
            </div>
          </>}
        </div>
      ))}
    </div>
  );
}
