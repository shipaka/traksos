// Магазин: витрина, корзина, заказ; админ — выключатель, товары, заказы.
import { useEffect, useState } from 'react';
import { get, post, put, del, rub, fmtTime, API_URL } from '../api.ts';
import { useLoad, useAction, useMe, go, Loading, Field, Back, RubInput } from '../ui.tsx';

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
    ? <img src={photoUrl(p)} alt="" width={size} height={size} style={{ borderRadius: 12, objectFit: 'cover', flex: 'none', background: 'var(--bg-2)' }} />
    : <div aria-hidden="true" style={{ width: size, height: size, borderRadius: 12, background: 'var(--bg-2)', display: 'grid', placeItems: 'center', flex: 'none', fontSize: 22 }}>🔧</div>;
}

export function Shop() {
  const c = useLoad(() => get('/api/shop'), []);
  const [cart, setCart] = useCart();
  const [cat, setCat] = useState('all');
  const mine = useLoad(() => get('/api/shop/orders'), [], (e) => e.type === 'shop');
  const d = c.data;
  if (!d) return <main><Loading error={c.error} /></main>;
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  const add = (id: string) => setCart({ ...cart, [id]: (cart[id] ?? 0) + 1 });
  const myOrders = (mine.data ?? []) as any[];
  if (!d.enabled) return (
    <main>
      <div><h1>Магазин</h1></div>
      <div className="card hi" style={{ alignItems: 'center', textAlign: 'center', padding: '32px 20px' }}>
        <span style={{ fontSize: 40 }} aria-hidden="true">🛒</span>
        <b style={{ fontSize: 20 }}>{d.closedTitle}</b>
        <span className="note">{d.closedText}</span>
      </div>
      {myOrders.length > 0 && <MyShopOrders orders={myOrders} reload={mine.reload} />}
    </main>
  );
  const kits = d.products.filter((p: any) => p.isKit);
  const usedCats = Object.entries(d.categories as Record<string, string>).filter(([k]) => k !== 'kit' && d.products.some((p: any) => !p.isKit && p.category === k));
  const items = d.products.filter((p: any) => !p.isKit && (cat === 'all' || p.category === cat));
  return (
    <main>
      <div className="between" style={{ alignItems: 'flex-start' }}>
        <div><h1>Магазин</h1><div className="sub">{d.note}</div></div>
        <button className="bell" aria-label={`Корзина, товаров: ${count}`} onClick={() => go('shop/cart')} style={{ position: 'relative' }}>
          🛒{count > 0 && <span className="badge">{count}</span>}
        </button>
      </div>
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
      {usedCats.length > 1 && (
        <div className="scroll-x">
          <button className="chip" aria-pressed={cat === 'all'} onClick={() => setCat('all')}>Все</button>
          {usedCats.map(([k, n]) => <button key={k} className="chip" aria-pressed={cat === k} onClick={() => setCat(k)}>{n}</button>)}
        </div>
      )}
      {!d.products.length ? <div className="empty">Товары скоро появятся</div> : (
        <div className="stack">
          {items.map((p: any) => (
            <div key={p.id} className="card" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }}>
              <Thumb p={p} />
              <div className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                <b>{p.name}</b>
                {p.spec && <span className="note">{p.spec}</span>}
                <span className="row" style={{ gap: 8 }}><b>{rub(p.price)}</b><span className={`pill ${p.inStock ? 'good' : ''}`}>{p.inStock ? 'в наличии' : `под заказ · от ${p.leadDays} дн.`}</span></span>
              </div>
              <button className="bell" aria-label={`Добавить: ${p.name}`} onClick={() => add(p.id)}>{cart[p.id] ? cart[p.id] : '+'}</button>
            </div>
          ))}
        </div>
      )}
      {count > 0 && <button className="btn" onClick={() => go('shop/cart')}>Корзина · {count} шт.</button>}
      {myOrders.length > 0 && <MyShopOrders orders={myOrders} reload={mine.reload} />}
    </main>
  );
}

function MyShopOrders({ orders, reload }: { orders: any[]; reload: () => void }) {
  const { busy, run } = useAction();
  return (
    <div className="stack">
      <span className="label">Мои покупки</span>
      {orders.map((o) => (
        <div key={o.id} className="card">
          <div className="between"><b>Заказ №{o.number} · {rub(o.total)}</b><span className={`pill ${STATUS_TONE[o.status]}`}>{o.statusName}</span></div>
          <span className="note">{fmtTime(o.createdAt)} · {DELIVERY[o.delivery]}{o.address ? `: ${o.address}` : ''}</span>
          <span className="note">{o.items.map((i: any) => `${i.name} × ${i.qty}`).join(', ')}</span>
          {o.adminNote && <span>{o.adminNote}</span>}
          {o.cancelReason && <span className="note">Отменён: {o.cancelReason}</span>}
          {o.status === 'new' && <button className="btn ghost small" disabled={busy} onClick={async () => { if (await run(() => post(`/api/shop/orders/${o.id}/cancel`), 'Заказ отменён')) reload(); }}>Отменить</button>}
        </div>
      ))}
    </div>
  );
}

export function ShopCart() {
  const c = useLoad(() => get('/api/shop'), []);
  const live = useLoad(() => get('/api/orders').catch(() => []), []);
  const { me } = useMe();
  const [cart, setCart] = useCart();
  const { busy, run } = useAction();
  const [delivery, setDelivery] = useState<'pickup' | 'delivery' | 'master' | ''>('');
  const [address, setAddress] = useState('');
  const [orderId, setOrderId] = useState('');
  const [payment, setPayment] = useState<'on_receipt' | 'invoice'>('on_receipt');
  const [comment, setComment] = useState('');
  const d = c.data;
  if (!d) return <main><Back to="shop" label="Магазин" /><Loading error={c.error} /></main>;
  if (!d.enabled) { go('shop'); return null; }
  const lines = Object.entries(cart).map(([id, qty]) => ({ p: d.products.find((x: any) => x.id === id), qty })).filter((l) => l.p);
  const goods = lines.reduce((a, l) => a + l.p.price * l.qty, 0);
  const dl = d.delivery;
  const open = ((live.data ?? []) as any[]).filter((o) => ['accepted', 'en_route', 'arrived', 'working'].includes(o.status));
  const opts = ([['pickup', 'Самовывоз', dl.pickupAddress || 'адрес пришлём'], ['delivery', 'Доставка', `${rub(dl.deliveryPrice)} · ${dl.deliveryNote}`], ['master', 'С мастером на заявке', 'мастер привезёт на выезд']] as const)
    .filter(([k]) => (k === 'pickup' ? dl.pickup : k === 'delivery' ? dl.delivery : dl.withMaster && open.length > 0));
  const total = goods + (delivery === 'delivery' ? dl.deliveryPrice : 0);
  const setQty = (id: string, q: number) => { const n = { ...cart }; if (q <= 0) delete n[id]; else n[id] = Math.min(99, q); setCart(n); };
  async function submit() {
    const r = await run(() => post('/api/shop/orders', { items: lines.map((l) => ({ productId: l.p.id, qty: l.qty })), delivery, address: address || null, orderId: orderId || null, payment, comment: comment || null }), 'Заказ оформлен — подтвердим и напишем');
    if (r) { setCart({}); go('shop'); }
  }
  return (
    <main>
      <Back to="shop" label="Магазин" />
      <div><h1>Корзина</h1><div className="sub">Оплата при получении — наличными, картой или СБП. Компаниям — по счёту.</div></div>
      {!lines.length ? <div className="empty">Корзина пуста</div> : <>
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
  const [tab, setTab] = useState<'orders' | 'products' | 'settings'>('orders');
  return (
    <div className="stack">
      <ShopSwitch />
      <div className="scroll-x" role="tablist">
        {([['orders', 'Заказы'], ['products', 'Товары'], ['settings', 'Получение и тексты']] as const).map(([k, n]) => <button key={k} className="chip" role="tab" aria-pressed={tab === k} onClick={() => setTab(k)}>{n}</button>)}
      </div>
      {tab === 'orders' && <AdminShopOrders />}
      {tab === 'products' && <AdminProducts />}
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

const EMPTY = { category: 'other', name: '', spec: '', description: '', price: null as number | null, stock: null as number | null, leadDays: 2, isKit: false, active: true, sort: 100 };

function AdminProducts() {
  const l = useLoad(() => get('/api/admin/shop/products'), []);
  const cats = useLoad(() => get('/api/shop'), []);
  const [edit, setEdit] = useState<any>(null);
  if (!l.data || !cats.data) return <Loading error={l.error ?? cats.error} />;
  if (edit) return <ProductForm p={edit} categories={cats.data.categories} onDone={() => { setEdit(null); l.reload(); }} />;
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

function ProductForm({ p, categories, onDone }: { p: any; categories: Record<string, string>; onDone: () => void }) {
  const { busy, run } = useAction();
  const [f, setF] = useState<any>({ ...p, spec: p.spec ?? '', description: p.description ?? '' });
  const [photo, setPhoto] = useState<string | null | undefined>(undefined);
  const set = (k: string, v: any) => setF({ ...f, [k]: v });
  async function save() {
    const body: any = { category: f.category, name: f.name, spec: f.spec || null, description: f.description || null, price: f.price, stock: f.stock, leadDays: f.leadDays, isKit: f.isKit, active: f.active, sort: f.sort };
    if (photo !== undefined) body.photoDataUrl = photo;
    if (await run(() => (p.id ? put(`/api/admin/shop/products/${p.id}`, body) : post('/api/admin/shop/products', body)), 'Товар сохранён')) onDone();
  }
  return (
    <div className="card">
      <b>{p.id ? 'Товар' : 'Новый товар'}</b>
      <Field label="Название"><input className="field" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Розетка 15-контактная" /></Field>
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
      {p.id && <button className="btn ghost small" disabled={busy} onClick={async () => { if (await run(() => del(`/api/admin/shop/products/${p.id}`), 'Товар скрыт')) onDone(); }}>Скрыть из магазина</button>}
    </div>
  );
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
