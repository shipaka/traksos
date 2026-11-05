// Мастер на заявке: «Опаздываю», отметки на месте, проверка подсказки с консультации,
// карточка клиента (метки других исполнителей), уточнение машины, «не брать заявки этого клиента».

import type { Db } from '../db/index.ts';
import type { Notifier } from './notify.ts';
import type { OrdersService } from './orders.ts';
import { bad, conflict, forbidden, notFound, type AuthUser } from '../http/router.ts';

export const SITE_FLAGS: Record<string, string> = {
  waited: 'Ждал клиента',
  client_left: 'Клиент отъехал',
  loading: 'Работал во время погрузки',
  gate: 'Долгий въезд, досмотр',
  price_dispute: 'Спор о цене',
};

export class OnsiteService {
  constructor(private db: Db, private notifier: Notifier, private orders: OrdersService) {}

  private async mine(user: AuthUser, orderId: string) {
    const o = await this.db.one('select * from orders where id=$1', [orderId]);
    if (!o) throw notFound('Заявка не найдена');
    if (o.performer_id !== user.id) throw forbidden('Это не ваша заявка');
    return o;
  }

  /** «Опаздываю»: клиент сразу видит новое время */
  async late(user: AuthUser, orderId: string, minutes: number) {
    const o = await this.mine(user, orderId);
    if (!['accepted', 'en_route'].includes(o.status)) throw conflict('bad_status', 'Опоздание отмечают до приезда');
    await this.db.query('update orders set late_minutes = late_minutes + $2 where id=$1', [orderId, minutes]);
    await this.orders.event(this.db, orderId, user.id, 'late', { minutes });
    const text = `Исполнитель предупредил: задерживается на ${minutes} мин.`;
    await this.orders.systemMessage(orderId, text + (minutes <= 40 ? ' До 40 минут для грузовых — в пределах нормы.' : ''));
    await this.notifier.notify([o.client_id, o.created_by], { type: 'order', orderId, status: o.status },
      { kind: 'normal', title: 'Мастер задерживается', body: `Заявка №${o.number}: +${minutes} мин`, data: { orderId } });
    return this.orders.view(user, orderId);
  }

  /** Отметки на месте: ожидание, погрузка, въезд — попадут в карточку клиента */
  async flags(user: AuthUser, orderId: string, flags: string[]) {
    const o = await this.mine(user, orderId);
    if (!['arrived', 'working', 'awaiting_confirmation', 'completed'].includes(o.status)) throw conflict('bad_status', 'Отметки ставят после приезда');
    const clean = [...new Set(flags.filter((f) => f in SITE_FLAGS))];
    await this.db.query('update orders set site_flags=$2 where id=$1', [orderId, clean]);
    await this.orders.event(this.db, orderId, user.id, 'site_flags', { flags: clean });
    return this.orders.view(user, orderId);
  }

  /** Совпала ли подсказка мастера по телефону — для его точности, без штрафов */
  async hintCheck(user: AuthUser, orderId: string, result: 'yes' | 'part' | 'no') {
    const o = await this.mine(user, orderId);
    if (!o.consult_of) throw bad('no_hint', 'В этой заявке не было консультации');
    await this.db.query('update orders set hint_check=$2 where id=$1', [orderId, result]);
    await this.orders.event(this.db, orderId, user.id, 'hint_checked', { result });
    return this.orders.view(user, orderId);
  }

  /** Клиент и машина глазами исполнителя: без сумм, только то, что нужно для работы */
  async clientCard(user: AuthUser, orderId: string) {
    const o = await this.db.one('select * from orders where id=$1', [orderId]);
    if (!o) throw notFound();
    const allowed = o.performer_id === user.id
      || !!(await this.db.one(`select 1 from order_dispatch where order_id=$1 and performer_id=$2 and status in ('ringing','bidding')`, [orderId, user.id]));
    if (!allowed) throw forbidden();
    const client = await this.db.one(`select id, name, company_name, company_inn, rating::float as rating, rating_count, created_at from users where id=$1`, [o.client_id]);
    // Метки исполнителей: из отзывов о клиенте и отметок на месте
    const tags = await this.db.query<{ tag: string; n: number }>(
      `select tag, count(*)::int n from reviews r, unnest(r.tags) tag where r.target_id=$1 and not r.hidden group by tag order by n desc`, [o.client_id]);
    const site = await this.db.query<{ flag: string; n: number }>(
      `select flag, count(*)::int n from orders x, unnest(x.site_flags) flag where x.client_id=$1 group by flag order by n desc`, [o.client_id]);
    const stats = await this.db.one<{ done: number; performers: number }>(
      `select count(*) filter (where status='completed')::int done, count(distinct performer_id) filter (where status='completed')::int performers
         from orders where client_id=$1`, [o.client_id]);
    const vehicle = o.vehicle_id ? await this.db.one(
      `select v.id, v.brand, v.model, v.year, v.plate, v.trailer_plate, v.axles, v.fixed_at, u.name as fixed_by_name
         from vehicles v left join users u on u.id=v.fixed_by where v.id=$1`, [o.vehicle_id]) : null;
    const history = o.vehicle_id ? await this.db.query(
      `select x.id, x.number, x.service, x.status, x.created_at, x.result, x.result_note, x.consult_hint, x.performer_id = $2 as mine, u.name as performer_name
         from orders x left join users u on u.id=x.performer_id
        where x.vehicle_id=$1 and x.id<>$3 and x.status in ('completed','awaiting_confirmation') order by x.created_at desc limit 30`,
      [o.vehicle_id, user.id, orderId]) : [];
    const blocked = !!(await this.db.one('select 1 from performer_blocks where performer_id=$1 and client_id=$2', [user.id, o.client_id]));
    return {
      client, stats, blocked,
      marks: [...tags.map((t) => ({ label: t.tag, n: t.n, tone: /Задержал|Спорил|ждать|Без пропуска/.test(t.tag) ? 'warn' : 'good' })),
        ...site.map((s) => ({ label: SITE_FLAGS[s.flag] ?? s.flag, n: s.n, tone: 'warn' }))],
      vehicle: vehicle ?? { brand: o.brand, model: o.model, year: o.year, plate: null, from: 'order' },
      history,
    };
  }

  /** Мастер на месте уточняет машину: следующий приедет подготовленным */
  /** «Нужна запчасть»: мастер ждёт (оплачивается ожидание), уедет и вернётся, или эвакуатор. Выбирает клиент или мастер. */
  async part(user: AuthUser, orderId: string, mode: 'wait' | 'resume' | 'return' | 'tow') {
    const o = await this.db.one('select * from orders where id=$1', [orderId]);
    if (!o) throw notFound('Заявка не найдена');
    const isClient = o.client_id === (user.owner_id ?? user.id) || o.created_by === user.id;
    if (o.performer_id !== user.id && !isClient) throw forbidden();
    if (!['arrived', 'working'].includes(o.status)) throw conflict('bad_status', 'Это решают на месте, во время работы');
    const now = new Date();
    if (mode === 'resume') {
      if (!o.wait_started_at) throw conflict('not_waiting', 'Ожидание не идёт');
      const min = Math.max(1, Math.round((now.getTime() - new Date(o.wait_started_at).getTime()) / 60_000));
      await this.db.query('update orders set wait_minutes = wait_minutes + $2, wait_started_at=null where id=$1', [orderId, min]);
      await this.orders.systemMessage(orderId, `Запчасть на месте — работа продолжается. Ожидание: ${min} мин.`);
    } else {
      if (o.wait_started_at && mode !== 'wait') {
        const min = Math.max(1, Math.round((now.getTime() - new Date(o.wait_started_at).getTime()) / 60_000));
        await this.db.query('update orders set wait_minutes = wait_minutes + $2, wait_started_at=null where id=$1', [orderId, min]);
      }
      await this.db.query(`update orders set part_mode=$2, wait_started_at = case when $2='wait' then coalesce(wait_started_at, now()) else wait_started_at end where id=$1`, [orderId, mode]);
      const p = await this.db.one<{ extras: any }>('select extras from performer_profiles where user_id=$1', [o.performer_id]);
      const rate = p?.extras?.waitRate;
      await this.orders.systemMessage(orderId, mode === 'wait'
        ? `Нужна запчасть — мастер ждёт. Таймер на «ожидании»${rate ? ` по ставке ${(rate / 100).toLocaleString('ru-RU')} ₽/ч` : ''}. Привезли не ту деталь — ожидание продолжается.`
        : mode === 'return' ? 'Нужна запчасть — мастер закроет текущую работу и вернётся, когда деталь будет на месте. Возвращение — новый выезд.'
        : 'Нужна запчасть — мастер закроет работу с диагнозом, клиент вызывает эвакуатор.');
    }
    await this.orders.event(this.db, orderId, user.id, 'part', { mode });
    await this.notifier.notify([o.client_id, o.created_by, o.performer_id].filter((x: string) => x && x !== user.id), { type: 'order', orderId, status: o.status },
      { kind: 'normal', title: 'Нужна запчасть', body: { wait: 'Мастер ждёт, таймер на ожидании', resume: 'Работа продолжается', return: 'Мастер вернётся с запчастью', tow: 'Эвакуатор' }[mode], data: { orderId } });
    return this.orders.view(user, orderId);
  }

  /** «Причина найдена, на месте не исправить» — мастер советует сервис-партнёр; клиенту там скидка */
  async recommend(user: AuthUser, orderId: string, centerId: string | null) {
    const o = await this.mine(user, orderId);
    if (!['arrived', 'working', 'awaiting_confirmation', 'completed'].includes(o.status)) throw conflict('bad_status', 'Советовать сервис можно после приезда');
    if (centerId) {
      const c = await this.db.one(`select id, name from service_centers where id=$1 and verification='approved'`, [centerId]);
      if (!c) throw notFound('Сервис не найден');
      await this.db.query('update orders set recommended_center_id=$2 where id=$1', [orderId, centerId]);
      await this.orders.event(this.db, orderId, user.id, 'service_recommended', { centerId });
      await this.orders.systemMessage(orderId, `Мастер советует сервис «${c.name}» — запишитесь из заявки, будет скидка.`);
      await this.notifier.notify([o.client_id, o.created_by], { type: 'order', orderId, status: o.status },
        { kind: 'normal', title: 'Мастер советует сервис', body: `«${c.name}» — со скидкой по совету мастера`, data: { orderId } });
    } else {
      await this.db.query('update orders set recommended_center_id=null where id=$1', [orderId]);
    }
    return this.orders.view(user, orderId);
  }

  async fixVehicle(user: AuthUser, orderId: string, v: { brand?: string; model?: string | null; year?: number | null; axles?: number | null }) {
    const o = await this.mine(user, orderId);
    if (o.vehicle_id) {
      await this.db.query(
        `update vehicles set brand=coalesce($2,brand), model=coalesce($3,model), year=coalesce($4,year), axles=coalesce($5,axles), fixed_by=$6, fixed_at=now() where id=$1`,
        [o.vehicle_id, v.brand ?? null, v.model ?? null, v.year ?? null, v.axles ?? null, user.id]);
    }
    await this.db.query('update orders set brand=coalesce($2,brand), model=coalesce($3,model), year=coalesce($4,year) where id=$1',
      [orderId, v.brand ?? null, v.model ?? null, v.year ?? null]);
    await this.orders.event(this.db, orderId, user.id, 'vehicle_fixed', v);
    return this.clientCard(user, orderId);
  }

  /** «Не брать заявки этого клиента» — личный чёрный список исполнителя */
  async block(user: AuthUser, orderId: string, on: boolean, reason?: string) {
    const o = await this.db.one('select client_id from orders where id=$1', [orderId]);
    if (!o) throw notFound();
    if (on) await this.db.query(`insert into performer_blocks(performer_id, client_id, reason) values ($1,$2,$3) on conflict do nothing`, [user.id, o.client_id, reason ?? null]);
    else await this.db.query('delete from performer_blocks where performer_id=$1 and client_id=$2', [user.id, o.client_id]);
    return { blocked: on };
  }

  async blacklist(user: AuthUser) {
    return this.db.query(
      `select b.client_id, b.reason, b.created_at, u.name, u.company_name from performer_blocks b join users u on u.id=b.client_id
        where b.performer_id=$1 order by b.created_at desc`, [user.id]);
  }

  async unblock(user: AuthUser, clientId: string) {
    await this.db.query('delete from performer_blocks where performer_id=$1 and client_id=$2', [user.id, clientId]);
    return { ok: true };
  }
}
