// Магазин: товары добавляет админ вручную; клиент — корзина и заказ; админ ведёт заказы и может закрыть магазин одной кнопкой.

import type { Db } from '../db/index.ts';
import type { Notifier } from './notify.ts';
import type { SettingsService } from './settings.ts';
import { bad, conflict, forbidden, notFound, type AuthUser } from '../http/router.ts';

export const SHOP_CATEGORIES: Record<string, string> = {
  kit: 'Наборы', socket: 'Розетки', plug: 'Разъёмы', cable: 'Провода', light: 'Свет', fuse: 'Предохранители', air: 'Пневматика', other: 'Разное',
  engine: 'Двигатель', fuel: 'Топливная система', cooling: 'Охлаждение', filtration: 'Фильтры и расходники',
  transmission: 'КПП и сцепление', drivetrain: 'Кардан и редуктор', brakes: 'Тормозная система',
  steer: 'Рулевое управление', suspension: 'Подвеска', electric: 'Электрика',
  sensors: 'Датчики и управление', exhaust: 'Выпускная система',
  hydraulic: 'Гидравлика', cabin: 'Кабина и кузов', wheels: 'Колёса и ступицы',
  trailer_axles: 'Оси прицепов', trailer_brakes: 'Тормоза прицепов',
  trailer_ebs: 'ABS / EBS прицепов', trailer_suspension: 'Подвеска прицепов',
  trailer_coupling: 'Сцепные устройства', trailer_body: 'Кузов и фурнитура',
  trailer_lights: 'Фонари прицепов', trailer_air: 'Пневматика прицепов',
  trailer_wheels: 'Колёса и ступицы прицепов',
  seals: 'Прокладки и уплотнения', tools: 'Инструменты и дорожные товары',
};
/** Grouped navigation for heavy trucks and trailers; legacy categories remain valid. */
export const SHOP_CATEGORY_GROUPS = [
  { id: 'truck', title: 'Грузовые автомобили', categories: [
    'engine', 'fuel', 'cooling', 'filtration', 'transmission', 'drivetrain', 'brakes', 'steer',
    'suspension', 'electric', 'sensors', 'exhaust', 'hydraulic', 'cabin', 'wheels',
  ] },
  { id: 'trailer', title: 'Прицепы и полуприцепы', categories: [
    'trailer_axles', 'trailer_brakes', 'trailer_ebs', 'trailer_suspension',
    'trailer_coupling', 'trailer_body', 'trailer_lights', 'trailer_air', 'trailer_wheels',
  ] },
  { id: 'universal', title: 'Универсальные запчасти и помощь в дороге', categories: [
    'socket', 'plug', 'cable', 'light', 'fuse', 'air', 'seals', 'tools', 'kit', 'other',
  ] },
];

export const SHOP_STATUS: Record<string, string> = {
  new: 'Новый', confirmed: 'Подтверждён', ready: 'Собран, ждёт', shipped: 'В пути', done: 'Получен', cancelled: 'Отменён',
};
const NEXT: Record<string, string[]> = { new: ['confirmed', 'cancelled'], confirmed: ['ready', 'shipped', 'cancelled'], ready: ['shipped', 'done', 'cancelled'], shipped: ['done', 'cancelled'] };
const MIMES = ['image/jpeg', 'image/png', 'image/webp'];

export interface ProductInput {
  category?: string; name?: string; spec?: string | null; description?: string | null; price?: number; stock?: number | null;
  leadDays?: number; isKit?: boolean; active?: boolean; sort?: number; photoDataUrl?: string | null;
  brand?: string | null; article?: string | null; searchTerms?: string | null;
}

const view = (p: any) => ({
  id: p.id, category: p.category, categoryName: SHOP_CATEGORIES[p.category] ?? p.category, name: p.name, spec: p.spec, description: p.description,
  price: p.price, stock: p.stock, inStock: p.stock != null && p.stock > 0, leadDays: p.lead_days, isKit: p.is_kit, active: p.active, sort: p.sort,
  hasPhoto: !!p.photo_mime, photoVersion: p.updated_at ? new Date(p.updated_at).getTime() : 0,
  brand: p.brand ?? null, article: p.article ?? null, searchTerms: p.search_terms ?? null,
});

export class ShopService {
  constructor(private db: Db, private notifier: Notifier, private settings: SettingsService) {}

  private cols = 'id, category, name, spec, description, price, stock, lead_days, is_kit, active, sort, photo_mime, updated_at, brand, article, search_terms';

  /** Витрина: выключен — только табличка «скоро» */
  async catalog(light = false) {
    const s = await this.settings.get('shop');
    const base = { enabled: s.enabled, closedTitle: s.closedTitle, closedText: s.closedText, note: s.note, categories: SHOP_CATEGORIES, categoryGroups: SHOP_CATEGORY_GROUPS,
      delivery: { pickup: s.pickup, pickupAddress: s.pickupAddress, delivery: s.delivery, deliveryPrice: s.deliveryPrice, deliveryNote: s.deliveryNote, withMaster: s.withMaster } };
    if (!s.enabled) return { ...base, products: [] };
    if (light) {
      const kits = await this.db.query(`select ${this.cols} from shop_products where active and is_kit order by sort, name limit 8`);
      return { ...base, products: kits.map(view) };
    }
    const rows = await this.db.query(`select ${this.cols} from shop_products where active order by is_kit desc, sort, name`);
    return { ...base, products: rows.map(view) };
  }

  async photo(id: string) {
    const p = await this.db.one<{ photo_mime: string | null; photo: Buffer | null }>('select photo_mime, photo from shop_products where id=$1', [id]);
    if (!p?.photo_mime || !p.photo) throw notFound();
    const v: unknown = p.photo;
    return { mime: p.photo_mime, body: Buffer.isBuffer(v) ? v : Buffer.from(String(v).replace(/^\\x/, ''), 'hex') };
  }

  // ——— Админ: товары ———
  async adminProducts() {
    return (await this.db.query(`select ${this.cols} from shop_products order by active desc, is_kit desc, sort, name`)).map(view);
  }

  private decodePhoto(dataUrl: string) {
    const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(dataUrl);
    if (!m || !MIMES.includes(m[1])) throw bad('bad_image', 'Нужна картинка JPEG, PNG или WEBP');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 1_500_000) throw bad('too_large', 'Картинка больше 1,5 МБ');
    return { mime: m[1], buf };
  }

  async saveProduct(actor: AuthUser, id: string | null, p: ProductInput) {
    if (p.category && !SHOP_CATEGORIES[p.category]) throw bad('bad_category', 'Нет такой категории');
    const photo = p.photoDataUrl ? this.decodePhoto(p.photoDataUrl) : null;
    let row: any;
    if (!id) {
      if (!p.name?.trim() || p.price == null) throw bad('need_name', 'Укажите название и цену');
      row = await this.db.one(
        `insert into shop_products(category, name, spec, description, price, stock, lead_days, is_kit, active, sort, photo_mime, photo)
         values ($1,$2,$3,$4,$5,$6,coalesce($7,2),coalesce($8,false),coalesce($9,true),coalesce($10,100),$11,$12) returning ${this.cols}`,
        [p.category ?? 'other', p.name.trim(), p.spec?.trim() || null, p.description?.trim() || null, p.price, p.stock ?? null,
          p.leadDays ?? null, p.isKit ?? null, p.active ?? null, p.sort ?? null, photo?.mime ?? null, photo ? '\\x' + photo.buf.toString('hex') : null]);
    } else {
      const has = (k: keyof ProductInput) => Object.prototype.hasOwnProperty.call(p, k);
      row = await this.db.one(
        `update shop_products set category=coalesce($2,category), name=coalesce($3,name),
           spec=case when $4::boolean then $5 else spec end, description=case when $6::boolean then $7 else description end,
           price=coalesce($8,price), stock=case when $9::boolean then $10::int else stock end, lead_days=coalesce($11,lead_days),
           is_kit=coalesce($12,is_kit), active=coalesce($13,active), sort=coalesce($14,sort),
           photo_mime=case when $15::boolean then $16 else photo_mime end, photo=case when $15::boolean then $17::bytea else photo end,
           updated_at=now()
         where id=$1 returning ${this.cols}`,
        [id, p.category ?? null, p.name?.trim() || null, has('spec'), p.spec?.trim() || null, has('description'), p.description?.trim() || null,
          p.price ?? null, has('stock'), p.stock ?? null, p.leadDays ?? null, p.isKit ?? null, p.active ?? null, p.sort ?? null,
          has('photoDataUrl'), photo?.mime ?? null, photo ? '\\x' + photo.buf.toString('hex') : null]);
      if (!row) throw notFound('Товар не найден');
    }
    // Optional metadata is independent of the legacy manual product form.
    // Explicit null clears it; omitted fields preserve the existing value.
    if (['brand', 'article', 'searchTerms'].some((k) => Object.prototype.hasOwnProperty.call(p, k))) {
      const has = (k: keyof ProductInput) => Object.prototype.hasOwnProperty.call(p, k);
      await this.db.query(
        `update shop_products set brand=case when $2::boolean then $3 else brand end,
           article=case when $4::boolean then $5 else article end,
           search_terms=case when $6::boolean then $7 else search_terms end, updated_at=now() where id=$1`,
        [row.id, has('brand'), p.brand?.trim() || null, has('article'), p.article?.trim() || null, has('searchTerms'), p.searchTerms?.trim() || null]);
      row = await this.db.one(`select ${this.cols} from shop_products where id=$1`, [row.id]);
    }
    await this.db.query('insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4)', [actor.id, id ? 'shop.product_update' : 'shop.product_create', row.id, { name: row.name, price: row.price, stock: row.stock }]);
    return view(row);
  }

  async deleteProduct(actor: AuthUser, id: string) {
    // Товар из прошлых заказов не удаляем — скрываем
    await this.db.query('update shop_products set active=false, updated_at=now() where id=$1', [id]);
    await this.db.query('insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4)', [actor.id, 'shop.product_hide', id, {}]);
    return { ok: true };
  }

  // ——— Internal supplier identifiers (admin only, never in client catalog) ———
  async supplierRef(productId: string) {
    const product = await this.db.one<{ id: string }>('select id from shop_products where id=$1', [productId]);
    if (!product) throw notFound('Товар не найден');
    const row = await this.db.one<any>(
      'select supplier_article, supplier_brand, source_note, verified, updated_at from shop_supplier_refs where product_id=$1', [productId]);
    return {
      supplier: 'autokontinent', article: row?.supplier_article ?? null,
      brand: row?.supplier_brand ?? null, sourceNote: row?.source_note ?? null,
      verified: !!row?.verified, updatedAt: row?.updated_at ?? null,
      connected: false, // No live supplier API calls until licensing/credentials.
    };
  }

  async setSupplierRef(actor: AuthUser, productId: string, input: {
    article: string; brand?: string | null; sourceNote?: string | null; verified?: boolean;
  }) {
    const product = await this.db.one<{ id: string }>('select id from shop_products where id=$1', [productId]);
    if (!product) throw notFound('Товар не найден');
    const source = input.sourceNote?.trim() || null;
    if (input.verified && (!source || source.length < 3))
      throw bad('need_source', 'Для подтверждения артикула укажите источник сверки');
    await this.db.query(
      `insert into shop_supplier_refs(product_id, supplier_article, supplier_brand, source_note, verified, updated_by)
       values ($1,$2,$3,$4,$5,$6)
       on conflict(product_id) do update set
         supplier_article=excluded.supplier_article, supplier_brand=excluded.supplier_brand,
         source_note=excluded.source_note, verified=excluded.verified,
         updated_by=excluded.updated_by, updated_at=now()`,
      [productId, input.article.trim(), input.brand?.trim() || null, source, !!input.verified, actor.id]);
    await this.db.query(
      'insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4)',
      [actor.id, 'shop.supplier_ref_set', productId, { supplier: 'autokontinent', verified: !!input.verified }]);
    return this.supplierRef(productId);
  }

  async clearSupplierRef(actor: AuthUser, productId: string) {
    await this.db.query('delete from shop_supplier_refs where product_id=$1', [productId]);
    await this.db.query('insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4)',
      [actor.id, 'shop.supplier_ref_clear', productId, { supplier: 'autokontinent' }]);
    return { ok: true };
  }

  async supplierStatus() {
    const counts = await this.db.one<{ mapped: number; verified: number }>(
      `select count(*)::int as mapped, count(*) filter (where verified)::int as verified from shop_supplier_refs`);
    return {
      supplier: 'autokontinent', connected: false, liveOffers: false, automaticOrders: false,
      mapped: counts?.mapped ?? 0, verified: counts?.verified ?? 0,
      message: 'Артикулы готовятся внутри TrakSOS. API поставщика не подключён.',
    };
  }

  /** Paginated live stock/price results. Never download the entire shop for a search. */
  async search(q = '', category = '', page = 0, limit = 24) {
    const setting = await this.settings.get('shop');
    if (!setting.enabled) return { items: [], total: 0, page: 0, limit: 24 };
    const safePage = Number.isFinite(page) ? Math.max(0, Math.min(1000, Math.floor(page))) : 0;
    const take = Number.isFinite(limit) ? Math.max(1, Math.min(48, Math.floor(limit))) : 24;
    const params: unknown[] = [];
    const filters = ['active=true', 'is_kit=false'];
    if (category && category !== 'all') {
      if (!SHOP_CATEGORIES[category]) throw bad('bad_category', 'Неизвестный раздел каталога');
      params.push(category); filters.push(`category=$${params.length}`);
    }
    // Words can appear in any order across the part name, article, brand and synonyms.
    // Deliberately bound each term: no user supplied SQL wildcards or expressions.
    const terms = q.trim().slice(0, 100).split(/\s+/).filter(Boolean).slice(0, 8);
    for (const term of terms) {
      params.push(term);
      const p = '$' + params.length;
      filters.push(`(position(lower(${p}) in lower(name))>0
        or position(lower(${p}) in lower(coalesce(article,'')))>0
        or position(lower(${p}) in lower(coalesce(brand,'')))>0
        or position(lower(${p}) in lower(coalesce(search_terms,'')))>0
        or position(lower(${p}) in lower(coalesce(spec,'')))>0)`);
    }
    const where = filters.join(' and ');
    const total = await this.db.one<{ n: number }>(`select count(*)::int as n from shop_products where ${where}`, params);
    const rows = await this.db.query(`select ${this.cols} from shop_products where ${where}
      order by sort, name, id limit $${params.length + 1} offset $${params.length + 2}`, [...params, take, safePage * take]);
    return { items: rows.map(view), total: total?.n ?? 0, page: safePage, limit: take };
  }

  /** A small selection lookup keeps checkout lightweight and refreshes live prices. */
  async selection(ids: string[]) {
    const setting = await this.settings.get('shop');
    if (!setting.enabled) return { products: [] };
    const rows = await this.db.query(`select ${this.cols} from shop_products where active=true and id=any($1::uuid[])`, [ids.slice(0, 50)]);
    return { products: rows.map(view) };
  }

  /** Compact article/name index, without prices, private data or stock levels.
   * Clients can store pages in IndexedDB and replace them by manifest revision. */
  async indexManifest() {
    const setting = await this.settings.get('shop');
    if (!setting.enabled) return { enabled: false, revision: null, count: 0 };
    const count = await this.db.one<{ count: number }>('select count(*)::int as count from shop_products where active');
    const version = await this.db.one<{ revision: string }>(
      'select coalesce(max(seq),0)::text as revision from shop_catalog_changes');
    return { enabled: true, revision: version?.revision ?? '0', count: count?.count ?? 0 };
  }

  async indexPage(after: string | null, limit = 750) {
    const setting = await this.settings.get('shop');
    if (!setting.enabled) return { enabled: false, rows: [], next: null };
    const take = Number.isFinite(limit) ? Math.max(1, Math.min(1000, Math.floor(limit))) : 750;
    const rows = await this.db.query<any>(
      `select id, category, brand, article, name, search_terms from shop_products
       where active=true and ($1::uuid is null or id>$1::uuid) order by id limit $2`, [after, take + 1]);
    const hasMore = rows.length > take;
    const chunk = rows.slice(0, take);
    return { enabled: true, rows: chunk.map((p: any) =>
      [p.id, p.category, p.brand, p.article, p.name, p.search_terms]),
      next: hasMore ? chunk[chunk.length - 1].id : null };
  }

  /** Incremental catalog changes. Tombstones remove obsolete/inactive articles.
   * No price, stock, VIN, order, or personal information leaves this endpoint. */
  async indexChanges(after: string, limit = 750) {
    const setting = await this.settings.get('shop');
    if (!setting.enabled) return { enabled: false, rows: [], next: null, revision: null };
    if (!/^\d{1,19}$/.test(after)) throw bad('bad_cursor', 'Неверный курсор справочника');
    const take = Number.isFinite(limit) ? Math.max(1, Math.min(1000, Math.floor(limit))) : 750;
    // A stable upper bound ensures updates arriving during this request can be
    // safely fetched next time rather than silently skipped.
    const latest = await this.db.one<{ revision: string }>(
      'select coalesce(max(seq),0)::text as revision from shop_catalog_changes');
    const revision = latest?.revision ?? '0';
    const events = await this.db.query<any>(
      `select c.seq::text as seq, c.product_id, c.removed, p.id, p.active,
              p.category, p.brand, p.article, p.name, p.search_terms
         from shop_catalog_changes c
         left join shop_products p on p.id=c.product_id
        where c.seq>$1::bigint and c.seq<=$2::bigint
        order by c.seq limit $3`, [after, revision, take + 1]);
    const hasMore = events.length > take;
    const page = events.slice(0, take);
    return {
      enabled: true,
      rows: page.map((e: any) =>
        e.removed || !e.id || !e.active
          ? [e.seq, e.product_id]
          : [e.seq, e.product_id, e.category, e.brand, e.article, e.name, e.search_terms]),
      next: hasMore ? page[page.length - 1].seq : null,
      revision,
    };
  }

  /** Only curated, verified substitutions are offered as guaranteed catalog links.
   * VIN/assembly compatibility remains a separate check, not inferred here. */
  async alternatives(id: string) {
    const setting = await this.settings.get('shop');
    if (!setting.enabled) return { enabled: false, items: [] };
    const rows = await this.db.query<any>(
      `select p.*, a.source from shop_product_analogs a
       join shop_products p on p.id=case when a.product_id=$1 then a.analog_id else a.product_id end
       where (a.product_id=$1 or a.analog_id=$1) and a.verified=true and p.active=true
       order by p.price, p.name limit 30`, [id]);
    return { enabled: true, items: rows.map((p: any) => ({ ...view(p), analogSource: p.source ?? null })),
      compatibilityConfirmed: false };
  }

  async linkAnalog(actor: AuthUser, productId: string, analogId: string, source: string, verified = false) {
    if (productId === analogId) throw bad('same_part', 'Одна и та же деталь не является аналогом самой себя');
    const parts = await this.db.query<{ id: string }>(
      'select id from shop_products where id=any($1::uuid[])', [[productId, analogId]]);
    if (parts.length !== 2) throw notFound('Одна из деталей не найдена');
    const [first, second] = [productId, analogId].sort();
    await this.db.query(
      `insert into shop_product_analogs(product_id, analog_id, source, verified)
       values ($1,$2,$3,$4)
       on conflict (product_id, analog_id) do update set source=excluded.source, verified=excluded.verified`,
      [first, second, source.trim(), verified]);
    await this.db.query('insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4)',
      [actor.id, 'shop.analog_link', first, { second, source, verified }]);
    return { ok: true };
  }

  /** Vehicle binding is optional, but always checked against the buyer's fleet. */
  private async allowedVehicle(user: AuthUser, vehicleId: string | null | undefined) {
    if (!vehicleId) return null;
    const ownerId = user.owner_id ?? user.id;
    const r = await this.db.one<any>(
      `select id, brand, model, plate, trailer_plate from vehicles
       where id=$1 and owner_id=$2 ${user.owner_id ? 'and driver_id=$3' : ''}`,
      user.owner_id ? [vehicleId, ownerId, user.id] : [vehicleId, ownerId]);
    if (!r) throw forbidden('Эта машина не привязана к вашему кабинету');
    return r;
  }

  async history(user: AuthUser, vehicleId: string | null, page = 0) {
    await this.allowedVehicle(user, vehicleId);
    const ownerId = user.owner_id ?? user.id;
    const safePage = Math.max(0, Math.min(1000, Math.floor(page)));
    const params: unknown[] = [ownerId];
    const filters = ['client_id=$1'];
    if (user.owner_id) { params.push(user.id); filters.push(`created_by=$${params.length}`); }
    if (vehicleId) { params.push(vehicleId); filters.push(`vehicle_id=$${params.length}`); }
    const where = filters.join(' and ');
    const take = 20;
    const rows = await this.db.query<any>(
      `select * from shop_orders where ${where} order by created_at desc, id desc
       limit $${params.length + 1} offset $${params.length + 2}`, [...params, take + 1, safePage * take]);
    return { items: rows.slice(0, take).map((o: any) => this.orderView(o)), hasMore: rows.length > take, page: safePage };
  }

  // ——— Клиент: заказ ———
  async order(user: AuthUser, p: { items: { productId: string; qty: number }[]; delivery: 'pickup' | 'delivery' | 'master'; address?: string | null; orderId?: string | null; payment?: 'on_receipt' | 'invoice'; comment?: string | null; vehicleId?: string | null }) {
    if (user.roles.includes('insurer')) throw forbidden('Покупки доступны через отдельный клиентский или партнёрский аккаунт');
    const s = await this.settings.get('shop');
    if (!s.enabled) throw conflict('shop_closed', s.closedTitle);
    if (user.owner_id) {
      const f = (await this.db.one<any>('select fleet from users where id=$1', [user.owner_id]))?.fleet;
      if (f?.allow?.shop === false) throw forbidden('Владелец не разрешил покупки в магазине');
    }
    const want = new Map<string, number>();
    for (const it of p.items) want.set(it.productId, (want.get(it.productId) ?? 0) + it.qty);
    if (!want.size) throw bad('empty', 'Корзина пуста');
    if ((p.delivery === 'pickup' && !s.pickup) || (p.delivery === 'delivery' && !s.delivery) || (p.delivery === 'master' && !s.withMaster)) throw bad('bad_delivery', 'Такой способ получения сейчас недоступен');
    if (p.delivery === 'delivery' && !p.address?.trim()) throw bad('need_address', 'Куда привезти?');
    const clientId = user.owner_id ?? user.id;
    const vehicle = await this.allowedVehicle(user, p.vehicleId);
    if (p.payment === 'invoice') {
      const u = await this.db.one<{ company_inn: string | null }>('select company_inn from users where id=$1', [clientId]);
      if (!u?.company_inn) throw bad('need_inn', 'Счёт выставляем компаниям — укажите ИНН в профиле');
    }
    let linkOrder: string | null = null;
    if (p.delivery === 'master') {
      const o = await this.db.one<{ id: string }>(
        `select id from orders where id=$1 and (client_id=$2 or created_by=$3) and status in ('accepted','en_route','arrived','working')`, [p.orderId ?? null, clientId, user.id]);
      if (!o) throw bad('need_order', 'Передать с мастером можно только по открытой заявке, пока мастер не приехал или работает');
      linkOrder = o.id;
    }
    return this.db.tx(async (q) => {
      const rows = await q.query<any>(`select id, name, brand, article, price, stock, active, lead_days from shop_products where id = any($1::uuid[]) for update`, [[...want.keys()]]);
      if (rows.length !== want.size || rows.some((r) => !r.active)) throw conflict('gone', 'Часть товаров уже недоступна — обновите корзину');
      const items = rows.map((r) => {
        const qty = want.get(r.id)!;
        if (qty < 1 || qty > 99) throw bad('bad_qty', 'Количество от 1 до 99');
        return { productId: r.id, name: r.name, brand: r.brand ?? null, article: r.article ?? null, price: r.price, qty, inStock: r.stock != null && r.stock >= qty, leadDays: r.lead_days };
      });
      // Что есть в наличии — резервируем сразу
      for (const it of items) if (it.inStock) await q.query('update shop_products set stock = stock - $2 where id=$1', [it.productId, it.qty]);
      const goods = items.reduce((a, it) => a + it.price * it.qty, 0);
      const dprice = p.delivery === 'delivery' ? s.deliveryPrice : 0;
      const [row] = await q.query<any>(
        `insert into shop_orders(client_id, created_by, items, goods_total, delivery, delivery_price, total, address, order_id, payment, comment, vehicle_id, vehicle_snapshot)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
        [clientId, user.id, JSON.stringify(items), goods, p.delivery, dprice, goods + dprice, p.address?.trim() || null, linkOrder, p.payment ?? 'on_receipt', p.comment?.trim() || null, vehicle?.id ?? null, vehicle ? JSON.stringify({ brand: vehicle.brand, model: vehicle.model, plate: vehicle.plate, trailerPlate: vehicle.trailer_plate }) : null]);
      return row;
    }).then(async (row: any) => {
      const staff = (await this.db.query<{ id: string }>(`select id from users where roles && '{admin}'::text[]`)).map((r) => r.id);
      await this.notifier.notify(staff, { type: 'shop', shopOrderId: row.id },
        { kind: 'normal', title: `Магазин: заказ №${row.number}`, body: `${(row.total / 100).toLocaleString('ru-RU')} ₽ · ${row.items.length} поз.`, data: { shopOrderId: row.id } });
      return this.orderView(row);
    });
  }

  private orderView(o: any) {
    return {
      id: o.id, number: o.number, status: o.status, statusName: SHOP_STATUS[o.status], items: o.items, goodsTotal: o.goods_total, delivery: o.delivery,
      deliveryPrice: o.delivery_price, total: o.total, address: o.address, orderId: o.order_id, payment: o.payment, comment: o.comment,
      adminNote: o.admin_note, cancelReason: o.cancel_reason, vehicleId: o.vehicle_id ?? null, vehicle: o.vehicle_snapshot ?? null, createdAt: o.created_at, updatedAt: o.updated_at,
    };
  }

  async myOrders(user: AuthUser) {
    const rows = await this.db.query(
      `select * from shop_orders where client_id=$1 ${user.owner_id ? 'and created_by=$2' : ''} order by created_at desc limit 50`,
      user.owner_id ? [user.owner_id, user.id] : [user.id]);
    return rows.map((o) => this.orderView(o));
  }

  async cancelMine(user: AuthUser, id: string) {
    const o = await this.db.one<any>('select * from shop_orders where id=$1 and (client_id=$2 or created_by=$3)', [id, user.owner_id ?? user.id, user.id]);
    if (!o) throw notFound('Заказ не найден');
    if (o.status !== 'new') throw conflict('bad_status', 'Заказ уже собирают — напишите в поддержку');
    return this.setStatus(null, id, 'cancelled', 'Отменил клиент');
  }

  // ——— Админ: заказы ———
  async adminOrders(status?: string) {
    const rows = await this.db.query(
      `select s.*, u.name as client_name, u.phone as client_phone, u.company_name from shop_orders s join users u on u.id=s.client_id
        ${status === 'open' ? `where s.status in ('new','confirmed','ready','shipped')` : ''} order by s.created_at desc limit 200`);
    return rows.map((o: any) => ({ ...this.orderView(o), client: { name: o.company_name || o.client_name, phone: o.client_phone } }));
  }

  async setStatus(actor: AuthUser | null, id: string, status: string, note?: string) {
    const o = await this.db.one<any>('select * from shop_orders where id=$1', [id]);
    if (!o) throw notFound('Заказ не найден');
    if (!(NEXT[o.status] ?? []).includes(status)) throw conflict('bad_status', `Из «${SHOP_STATUS[o.status]}» в «${SHOP_STATUS[status] ?? status}» нельзя`);
    await this.db.tx(async (q) => {
      if (status === 'cancelled') {
        // Вернуть зарезервированное на склад
        for (const it of o.items) if (it.inStock) await q.query('update shop_products set stock = coalesce(stock, 0) + $2 where id=$1', [it.productId, it.qty]);
      }
      await q.query(`update shop_orders set status=$2, cancel_reason = case when $2='cancelled' then $3 else cancel_reason end,
                       admin_note = case when $2<>'cancelled' and $3::text is not null then $3 else admin_note end, updated_at=now() where id=$1`, [id, status, note?.trim() || null]);
      await q.query('insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4)', [actor?.id ?? o.created_by, 'shop.status', id, { status, note }]);
    });
    if (actor) await this.notifier.notify([o.client_id, o.created_by], { type: 'shop', shopOrderId: id },
      { kind: 'normal', title: `Заказ в магазине №${o.number}: ${SHOP_STATUS[status].toLowerCase()}`, body: note?.trim() || (status === 'ready' ? 'Можно забирать' : ''), data: { shopOrderId: id } });
    const r = await this.db.one('select * from shop_orders where id=$1', [id]);
    return this.orderView(r);
  }
}
