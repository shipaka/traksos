// Магазин: витрина, корзина, заказ; админ — выключатель, товары, заказы.
import { useEffect, useState } from 'react';
import { get, post, put, del, rub, fmtTime, API_URL } from '../api.ts';
import { useLoad, useAction, useMe, go, Loading, Field, Back, RubInput } from '../ui.tsx';
import { syncOfflineParts, searchOfflineParts } from '../shopOffline.ts';
import { syncOfflineReferences, searchOfflineReferences } from '../shopReferenceOffline.ts';
import { AdminShopCatalog } from './shopCatalogAdmin.tsx';

const CART_KEY = 'traksos.cart';
type Cart = Record<string, number>;
const readCart = (): Cart => { try { return JSON.parse(localStorage.getItem(CART_KEY) ?? '{}'); } catch { return {}; } };
const writeCart = (c: Cart) => { try { localStorage.setItem(CART_KEY, JSON.stringify(c)); } catch { /* */ } window.dispatchEvent(new Event('traksos-cart')); };
function useCart(): [Cart, (c: Cart) => void] {
  const [c, setC] = useState<Cart>(readCart);
  useEffect(() => { const f = () => setC(readCart()); window.addEventListener('traksos-cart', f); return () => window.removeEventListener('traksos-cart', f); }, []);
  return [c, (n) => { writeCart(n); setC(n); }];
}
const photoUrl = (p: any) => `${API_URL}/api/shop/products/${p.id}/photo?v=${p.photoVersion}`;
const STATUS_TONE: Record<string, string> = { new: 'accent', confirmed: 'accent', ready: 'good', shipped: 'accent', done: '', cancelled: 'bad' };
const DELIVERY: Record<string, string> = { pickup: 'Самовывоз', delivery: 'Доставка', master: 'С мастером на заявке' };

function Thumb({ p, size = 56 }: { p: any; size?: number }) {
  return p.hasPhoto
    ? <img src={photoUrl(p)} alt="" loading="lazy" decoding="async" width={size} height={size} style={{ borderRadius: 12, objectFit: 'cover', flex: 'none', background: 'var(--bg-2)' }} />
    : <div aria-hidden="true" style={{ width: size, height: size, borderRadius: 12, background: 'var(--bg-2)', display: 'grid', placeItems: 'center', flex: 'none', fontSize: 22 }}>🔧</div>;
}

export function Shop() {
  const c = useLoad(() => get('/api/shop?light=1'), []);
  const [cart, setCart] = useCart();
  const [cat, setCat] = useState('all');
  const [term, setTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [page, setPage] = useState(0);
  const [offlineVersion, setOfflineVersion] = useState(0);
  const [offlineNote, setOfflineNote] = useState('');
  const { busy: syncing, run: runSync } = useAction();
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedTerm(term); setPage(0); }, 280);
    return () => clearTimeout(t);
  }, [term]);
  const search = useLoad(() => c.data?.enabled
    ? get(`/api/shop/search?q=${encodeURIComponent(debouncedTerm)}&category=${encodeURIComponent(cat)}&page=${page}`)
    : Promise.resolve({ items: [], total: 0, page: 0, limit: 24 }),
    [c.data?.enabled, cat, debouncedTerm, page], (e) => e.type === 'shop');
  const local = useLoad(() => searchOfflineParts(debouncedTerm, cat), [debouncedTerm, cat, offlineVersion]);
  const localRefs = useLoad(() => searchOfflineReferences(debouncedTerm, cat), [debouncedTerm, cat, offlineVersion]);
  // A separate small result set for reviewed reference entries without live pricing.
  // Do not fetch it before a search/category selection or while the shop is closed.
  const references = useLoad(() =>
    c.data?.enabled && (debouncedTerm.trim() || cat !== 'all')
      ? get(`/api/shop/catalog/search?q=${encodeURIComponent(debouncedTerm)}&category=${encodeURIComponent(cat)}`)
      : Promise.resolve({ enabled: false, items: [], total: 0 }),
    [c.data?.enabled, debouncedTerm, cat]);
  const d = c.data;
  if (!d) return <main><Loading error={c.error} /></main>;
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  const add = (id: string) => setCart({ ...cart, [id]: (cart[id] ?? 0) + 1 });
  if (!d.enabled) return (
    <main className="track-shop-home">
      <div className="track-shop-hero"><span className="track-shop-eyebrow">TRACKSOS · ЗАПЧАСТИ ДЛЯ ГРУЗОВИКОВ</span><h1>Каталог запчастей</h1><p>Оригиналы, проверенные аналоги и история заказов вашей техники.</p><span className="track-shop-gear" aria-hidden="true"/></div>
      <div className="card hi" style={{ alignItems: 'center', textAlign: 'center', padding: '32px 20px' }}>
        <span style={{ fontSize: 40 }} aria-hidden="true">🛒</span>
        <b style={{ fontSize: 20 }}>{d.closedTitle}</b>
        <span className="note">{d.closedText}</span>
      </div>
      <a className="linkrow" href="#/shop/history"><span><b>История покупок</b><small>Просмотреть предыдущие заказы</small></span><span aria-hidden="true">›</span></a>
    </main>
  );
  const kits = d.products.filter((p: any) => p.isKit);
  const groups = (d.categoryGroups ?? []) as { id: string; title: string; categories: string[] }[];
  const items: any[] = search.data?.items ?? [];
  return (
    <main className="track-shop-home">
      <div className="track-shop-hero"><span className="track-shop-eyebrow">TRACKSOS · ЗАПЧАСТИ ДЛЯ ГРУЗОВИКОВ</span><h1>Найдём нужную деталь</h1><p>Удобный поиск по названию и артикулу, наличие, аналоги и история покупок.</p><span className="track-shop-gear" aria-hidden="true"/></div>
      <div className="between" style={{ alignItems: 'flex-start' }}>
        <div><h1>Магазин</h1><div className="sub">{d.note}</div></div>
        <button className="bell" aria-label={`Корзина, товаров: ${count}`} onClick={() => go('shop/cart')} style={{ position: 'relative' }}>
          🛒{count > 0 && <span className="badge">{count}</span>}
        </button>
      </div>
      <input className="field" type="search" aria-label="Поиск запчастей по названию или артикулу"
        placeholder="Название, артикул или производитель" value={term} onChange={(e) => setTerm(e.target.value)} />
      <span className="note">Поиск по названию и номеру детали. Можно выбрать категорию, не вводя артикул.</span>
      <div className="row" style={{ alignItems: 'center', gap: 8 }}>
        <button className="btn ghost small" disabled={syncing} onClick={async () => {
          const result = await runSync(async () => {
            const products = await syncOfflineParts();
            const references = await syncOfflineReferences();
            return { products, references };
          }, null);
          if (result) {
            setOfflineVersion((n) => n + 1);
            const { products, references } = result;
            setOfflineNote(products.unchanged && references.unchanged
              ? 'Локальный каталог уже актуален'
              : `Товары: обновлено ${products.added}, справочные номера: ${references.added}; удалено устаревших: ${products.removed + references.removed}.`
                + (!products.complete || !references.complete ? ' Нажмите ещё раз для продолжения.' : ''));
          }
        }}>{syncing ? 'Сохраняем…' : 'Сохранить справочник для слабого интернета'}</button>
      </div>
      {offlineNote && <span className="note">{offlineNote}</span>}
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
      {count > 0 && <button className="btn" onClick={() => go('shop/cart')}>Корзина · {count} шт.</button>}
      <a className="linkrow" href="#/shop/history"><span><b>Мои покупки</b><small>Повторить заказ или подобрать аналоги</small></span><span aria-hidden="true">›</span></a>
    </main>
  );
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
          {o.items.map((i: any) => <div key={i.productId} className="stack" style={{ gap: 6 }}>
            <span className="note">{i.name}{i.article ? ` · ${i.article}` : ''} × {i.qty}</span>
            {canOrder && o.status !== 'cancelled' && <div className="row" style={{ gap: 6 }}>
              <button className="btn ghost small" onClick={() => { addItem(i.productId, i.qty); go('shop/cart'); }}>Повторить</button>
              <button className="btn ghost small" aria-expanded={openAnalog === i.productId} onClick={() => setOpenAnalog(openAnalog === i.productId ? null : i.productId)}>Найти аналоги</button>
            </div>}
            {openAnalog === i.productId && <HistoryAnalogs productId={i.productId} add={addItem} />}
          </div>)}
          {o.adminNote && <span>{o.adminNote}</span>}
          {o.cancelReason && <span className="note">Отменён: {o.cancelReason}</span>}
          {o.status === 'new' && <button className="btn ghost small" disabled={busy} onClick={async () => { if (await run(() => post(`/api/shop/orders/${o.id}/cancel`), 'Заказ отменён')) reload(); }}>Отменить</button>}
        </div>
      ))}
    </div>
  );
}

function HistoryAnalogs({ productId, add }: { productId: string; add: (id: string) => void }) {
  const a = useLoad(() => get(`/api/shop/products/${productId}/analogs`), [productId]);
  if (!a.data) return <Loading error={a.error} />;
  if (!a.data.enabled) return <span className="note">Каталог аналогов пока в разработке.</span>;
  if (!a.data.items.length) return <span className="note">Подтверждённых аналогов пока нет — нельзя рекомендовать замену наугад.</span>;
  return <div className="stack">
    <span className="note">Внимание: взаимозаменяемость артикула не гарантирует применяемость к конкретной машине. Проверьте VIN и агрегат.</span>
    {a.data.items.map((p: any) => <div key={p.id} className="card" style={{ padding: 10 }}>
      <b>{p.name}</b>
      <span className="note">{[p.brand, p.article, p.analogSource].filter(Boolean).join(' · ')}</span>
      <div className="between"><b>{rub(p.price)}</b><button className="btn small" onClick={() => add(p.id)}>В корзину</button></div>
    </div>)}
  </div>;
}

/** Purchase history is loaded only when the customer opens this page, never for all fleet vehicles. */
export function ShopHistory({ vehicleId }: { vehicleId?: string }) {
  const [page, setPage] = useState(0);
  const c = useLoad(() => get('/api/shop?light=1'), []);
  const history = useLoad(() => get(`/api/shop/history?page=${page}${vehicleId ? '&vehicleId=' + encodeURIComponent(vehicleId) : ''}`),
    [page, vehicleId], (e) => e.type === 'shop');
  return <main>
    <Back to={vehicleId ? 'garage' : 'shop'} label={vehicleId ? 'Мой гараж' : 'Магазин'} />
    <h1>История покупок</h1>
    {!history.data ? <Loading error={history.error} /> : <>
      {history.data.items.length === 0 ? <div className="empty">Покупок пока нет</div> :
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
  const c = useLoad(() => get('/api/shop?light=1'), []);
  const live = useLoad(() => get('/api/orders').catch(() => []), []);
  const { me } = useMe();
  const [cart, setCart] = useCart();
  const selectedIds = Object.keys(cart).sort().join(',');
  const selection = useLoad(() => c.data?.enabled && selectedIds
    ? get(`/api/shop/selection?ids=${encodeURIComponent(selectedIds)}`)
    : Promise.resolve({ products: [] }), [c.data?.enabled, selectedIds]);
  const vehicles = useLoad(() => c.data?.enabled && selectedIds
    ? get('/api/vehicles') : Promise.resolve([]), [c.data?.enabled, !!selectedIds]);
  const [vehicleId, setVehicleId] = useState('');
  const { busy, run } = useAction();
  const [delivery, setDelivery] = useState<'pickup' | 'delivery' | 'master' | ''>('');
  const [address, setAddress] = useState('');
  const [orderId, setOrderId] = useState('');
  const [payment, setPayment] = useState<'on_receipt' | 'invoice'>('on_receipt');
  const [comment, setComment] = useState('');
  const d = c.data;
  if (!d) return <main><Back to="shop" label="Магазин" /><Loading error={c.error} /></main>;
  if (!d.enabled) { go('shop'); return null; }
  const lines = Object.entries(cart).map(([id, qty]) => ({ p: selection.data?.products?.find((x: any) => x.id === id), qty })).filter((l) => l.p);
  const goods = lines.reduce((a, l) => a + l.p.price * l.qty, 0);
  const dl = d.delivery;
  const open = ((live.data ?? []) as any[]).filter((o) => ['accepted', 'en_route', 'arrived', 'working'].includes(o.status));
  const opts = ([['pickup', 'Самовывоз', dl.pickupAddress || 'адрес пришлём'], ['delivery', 'Доставка', `${rub(dl.deliveryPrice)} · ${dl.deliveryNote}`], ['master', 'С мастером на заявке', 'мастер привезёт на выезд']] as const)
    .filter(([k]) => (k === 'pickup' ? dl.pickup : k === 'delivery' ? dl.delivery : dl.withMaster && open.length > 0));
  const total = goods + (delivery === 'delivery' ? dl.deliveryPrice : 0);
  const setQty = (id: string, q: number) => { const n = { ...cart }; if (q <= 0) delete n[id]; else n[id] = Math.min(99, q); setCart(n); };
  async function submit() {
    const r = await run(() => post('/api/shop/orders', { items: lines.map((l) => ({ productId: l.p.id, qty: l.qty })), delivery, address: address || null, orderId: orderId || null, payment, comment: comment || null, vehicleId: vehicleId || null }), 'Заказ оформлен — подтвердим и напишем');
    if (r) { setCart({}); go('shop'); }
  }
  return (
    <main>
      <Back to="shop" label="Магазин" />
      <div><h1>Корзина</h1><div className="sub">Оплата при получении — наличными, картой или СБП. Компаниям — по счёту.</div></div>
      {!lines.length ? <div className="empty">{selection.error ?? (selectedIds ? 'Проверяем актуальную цену и наличие…' : 'Корзина пуста')}</div> : <>
        <div className="stack">
          {lines.map(({ p, qty }) => (
            <div key={p.id} className="card" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }}>
              <Thumb p={p} size={48} />
              <div className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}><b>{p.name}</b><span className="note">{rub(p.price)} · {p.inStock ? 'в наличии' : `под заказ, от ${p.leadDays} дн.`}</span></div>
              <div className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
                <button className="bell" aria-label="Меньше" onClick={() => setQty(p.id, qty - 1)}>−</button>
                <b style={{ minWidth: 20, textAlign: 'center' }}>{qty}</b>
                <button className="bell" aria-label="Больше" onClick={() => setQty(p.id, qty + 1)}>+</button>
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
        <button className="btn" disabled={busy || !delivery || (delivery === 'delivery' && !address.trim()) || (delivery === 'master' && !orderId)} onClick={submit}>Оформить заказ</button>
        <span className="note">Что есть в наличии — отложим сразу. Под заказ — уточним срок и напишем.</span>
      </>}
    </main>
  );
}

// ═══════════════ Админ: магазин ═══════════════

async function resizeImage(file: File): Promise<string> {
  const img = await new Promise<HTMLImageElement>((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = URL.createObjectURL(file); });
  const k = Math.min(1, 800 / Math.max(img.width, img.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
  cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', 0.82);
}

export function AdminShop() {
  const [tab, setTab] = useState<'orders' | 'products' | 'catalog' | 'settings'>('orders');
  return (
    <div className="stack">
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
  const s = useLoad(() => get('/api/admin/settings'), []);
  const { busy, run } = useAction();
  if (!s.data) return <Loading error={s.error} />;
  const on = s.data.shop.enabled;
  return (
    <div className={`banner col ${on ? '' : 'warn'}`}>
      <b>Магазин {on ? 'открыт для клиентов' : 'закрыт — клиенты видят «скоро»'}</b>
      <span className="note">{on ? 'Если что-то сбоит — закройте: новые заказы перестанут приниматься, уже оформленные останутся у вас и у клиентов.' : `Клиент видит: «${s.data.shop.closedTitle}». Товары можно готовить заранее.`}</span>
      <button className={`btn small ${on ? 'ghost' : ''}`} disabled={busy} onClick={async () => { if (await run(() => put('/api/admin/settings/shop', { enabled: !on }), on ? 'Магазин закрыт' : 'Магазин открыт')) s.reload(); }}>{on ? 'Закрыть магазин' : 'Открыть магазин'}</button>
    </div>
  );
}

function ShopSettings() {
  const s = useLoad(() => get('/api/admin/settings'), []);
  const { busy, run } = useAction();
  const [f, setF] = useState<any>(null);
  useEffect(() => { if (s.data && !f) setF(s.data.shop); }, [s.data]); // eslint-disable-line
  if (!f) return <Loading error={s.error} />;
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
  const l = useLoad(() => get('/api/admin/shop/products'), []);
  const cats = useLoad(() => get('/api/shop'), []);
  const [edit, setEdit] = useState<any>(null);
  if (!l.data || !cats.data) return <Loading error={l.error ?? cats.error} />;
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
        <label className="btn ghost small">Фото<input type="file" accept="image/*" hidden onChange={async (e) => { const file = e.target.files?.[0]; if (file) setPhoto(await resizeImage(file)); }} /></label>
        {(p.hasPhoto || photo) && <button type="button" className="btn ghost small" onClick={() => setPhoto(null)}>Убрать фото</button>}
      </div>
      <div className="grid2">
        <button className="btn" disabled={busy || f.name.trim().length < 2 || f.price == null} onClick={save}>Сохранить</button>
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
  const ref = useLoad(() => get(`/api/admin/shop/products/${productId}/supplier`), [productId]);
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
  if (!ref.data) return <Loading error={ref.error} />;
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

function AdminShopOrders() {
  const [all, setAll] = useState(false);
  const l = useLoad(() => get(`/api/admin/shop/orders${all ? '' : '?status=open'}`), [all], (e) => e.type === 'shop');
  const { busy, run } = useAction();
  const [note, setNote] = useState<Record<string, string>>({});
  if (!l.data) return <Loading error={l.error} />;
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
          {NEXT[o.status] && <>
            <input className="field" placeholder="Сообщение клиенту · по желанию" value={note[o.id] ?? ''} onChange={(e) => setNote({ ...note, [o.id]: e.target.value })} />
            <div className="row">
              {NEXT[o.status].map(([s, n]) => <button key={s} className="btn small" disabled={busy} onClick={() => act(o.id, s, n)}>{n}</button>)}
              <button className="btn ghost small" disabled={busy} onClick={() => act(o.id, 'cancelled', 'Заказ отменён, товар вернулся на склад')}>Отменить</button>
            </div>
          </>}
        </div>
      ))}
    </div>
  );
}
