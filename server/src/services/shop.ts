// Магазин: товары добавляет админ вручную; клиент — корзина и заказ; админ ведёт заказы и может закрыть магазин одной кнопкой.

import type { Db } from '../db/index.ts';
import type { Notifier } from './notify.ts';
import type { SettingsService } from './settings.ts';
import { bad, conflict, forbidden, notFound, type AuthUser } from '../http/router.ts';

export const SHOP_CATEGORIES: Record<string, string> = {
  kit: 'Наборы', socket: 'Розетки', plug: 'Разъёмы', cable: 'Провода', light: 'Свет', fuse: 'Предохранители', air: 'Пневматика', other: 'Разное',
};
export const SHOP_STATUS: Record<string, string> = {
  new: 'Новый', confirmed: 'Подтверждён', ready: 'Собран, ждёт', shipped: 'В пути', done: 'Получен', cancelled: 'Отменён',
};
const NEXT: Record<string, string[]> = { new: ['confirmed', 'cancelled'], confirmed: ['ready', 'shipped', 'cancelled'], ready: ['shipped', 'done', 'cancelled'], shipped: ['done', 'cancelled'] };
const MIMES = ['image/jpeg', 'image/png', 'image/webp'];

export interface ProductInput {
  category?: string; name?: string; spec?: string | null; description?: string | null; price?: number; stock?: number | null;
  leadDays?: number; isKit?: boolean; active?: boolean; sort?: number; photoDataUrl?: string | null;
}

const view = (p: any) => ({
  id: p.id, category: p.category, categoryName: SHOP_CATEGORIES[p.category] ?? p.category, name: p.name, spec: p.spec, description: p.description,
  price: p.price, stock: p.stock, inStock: p.stock != null && p.stock > 0, leadDays: p.lead_days, isKit: p.is_kit, active: p.active, sort: p.sort,
  hasPhoto: !!p.photo_mime, photoVersion: p.updated_at ? new Date(p.updated_at).getTime() : 0,
});

export class ShopService {
  constructor(private db: Db, private notifier: Notifier, private settings: SettingsService) {}

  private cols = 'id, category, name, spec, description, price, stock, lead_days, is_kit, active, sort, photo_mime, updated_at';

  /** Витрина: выключен — только табличка «скоро» */
  async catalog() {
    const s = await this.settings.get('shop');
    const base = { enabled: s.enabled, closedTitle: s.closedTitle, closedText: s.closedText, note: s.note, categories: SHOP_CATEGORIES,
      delivery: { pickup: s.pickup, pickupAddress: s.pickupAddress, delivery: s.delivery, deliveryPrice: s.deliveryPrice, deliveryNote: s.deliveryNote, withMaster: s.withMaster } };
    if (!s.enabled) return { ...base, products: [] };
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
    await this.db.query('insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4)', [actor.id, id ? 'shop.product_update' : 'shop.product_create', row.id, { name: row.name, price: row.price, stock: row.stock }]);
    return view(row);
  }

  async deleteProduct(actor: AuthUser, id: string) {
    // Товар из прошлых заказов не удаляем — скрываем
    await this.db.query('update shop_products set active=false, updated_at=now() where id=$1', [id]);
    await this.db.query('insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4)', [actor.id, 'shop.product_hide', id, {}]);
    return { ok: true };
  }

  // ——— Клиент: заказ ———
  async order(user: AuthUser, p: { items: { productId: string; qty: number }[]; delivery: 'pickup' | 'delivery' | 'master'; address?: string | null; orderId?: string | null; payment?: 'on_receipt' | 'invoice'; comment?: string | null }) {
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
      const rows = await q.query<any>(`select id, name, price, stock, active, lead_days from shop_products where id = any($1::uuid[]) for update`, [[...want.keys()]]);
      if (rows.length !== want.size || rows.some((r) => !r.active)) throw conflict('gone', 'Часть товаров уже недоступна — обновите корзину');
      const items = rows.map((r) => {
        const qty = want.get(r.id)!;
        if (qty < 1 || qty > 99) throw bad('bad_qty', 'Количество от 1 до 99');
        return { productId: r.id, name: r.name, price: r.price, qty, inStock: r.stock != null && r.stock >= qty, leadDays: r.lead_days };
      });
      // Что есть в наличии — резервируем сразу
      for (const it of items) if (it.inStock) await q.query('update shop_products set stock = stock - $2 where id=$1', [it.productId, it.qty]);
      const goods = items.reduce((a, it) => a + it.price * it.qty, 0);
      const dprice = p.delivery === 'delivery' ? s.deliveryPrice : 0;
      const [row] = await q.query<any>(
        `insert into shop_orders(client_id, created_by, items, goods_total, delivery, delivery_price, total, address, order_id, payment, comment)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
        [clientId, user.id, JSON.stringify(items), goods, p.delivery, dprice, goods + dprice, p.address?.trim() || null, linkOrder, p.payment ?? 'on_receipt', p.comment?.trim() || null]);
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
      adminNote: o.admin_note, cancelReason: o.cancel_reason, createdAt: o.created_at, updatedAt: o.updated_at,
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
