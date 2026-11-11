// «Мой парк»: машины и водители, что водителю можно, лимиты, подтверждение заказов, ЭДО, вход водителя по QR-наклейке.

import type { Db } from '../db/index.ts';
import type { Notifier } from './notify.ts';
import type { OrdersService } from './orders.ts';
import { bad, conflict, notFound, type AuthUser } from '../http/router.ts';

export interface FleetSettings {
  mode?: 'limit' | 'approve';
  perOrder?: number | null;
  perMonth?: number | null;
  allow?: { repair?: boolean; tow?: boolean; consult?: boolean; service?: boolean; shop?: boolean; insurance?: boolean; inspection?: boolean };
}

const maskPhone = (p: string) => p.replace(/^(\+7)(\d{3})\d{3}(\d{2})(\d{2})$/, '$1 $2 ***-$3-$4');

export class FleetService {
  constructor(private db: Db, private notifier: Notifier, private orders: OrdersService) {}

  async get(owner: AuthUser) {
    if (owner.owner_id) throw bad('driver', 'Парком управляет владелец');
    const u = await this.db.one<any>('select fleet, company_name, company_inn, edo_operator, edo_id, edo_pdf_only from users where id=$1', [owner.id]);
    const cars = await this.db.query(
      `select v.id, v.brand, v.model, v.year, v.plate, v.trailer_plate, v.qr_code, v.driver_id, v.driver_since,
              d.name as driver_name, d.phone as driver_phone
         from vehicles v left join users d on d.id=v.driver_id where v.owner_id=$1 order by v.created_at`, [owner.id]);
    const drivers = [...new Set(cars.map((c: any) => c.driver_id).filter(Boolean))] as string[];
    const spent: Record<string, number> = {};
    for (const d of drivers) spent[d] = await this.orders.monthSpent(d);
    const pending = await this.db.query(
      `select o.id, o.number, o.service, o.description, o.owner_note, o.created_at, (o.estimate->>'callOut')::int as amount,
              v.brand, v.model, v.plate, d.name as driver_name
         from orders o left join vehicles v on v.id=o.vehicle_id left join users d on d.id=o.created_by
        where o.client_id=$1 and o.status='awaiting_owner' order by o.created_at`, [owner.id]);
    return {
      settings: { mode: 'limit', perOrder: null, perMonth: null, ...u.fleet,
        allow: { repair: true, tow: true, consult: true, service: true, shop: true, insurance: false, inspection: false, ...(u.fleet?.allow ?? {}) } },
      company: { name: u.company_name, inn: u.company_inn, edoOperator: u.edo_operator, edoId: u.edo_id, pdfOnly: u.edo_pdf_only },
      cars: cars.map((c: any) => ({
        id: c.id, brand: c.brand, model: c.model, year: c.year, plate: c.plate, trailerPlate: c.trailer_plate, qrCode: c.qr_code,
        driver: c.driver_id ? { id: c.driver_id, name: c.driver_name, phone: maskPhone(c.driver_phone), since: c.driver_since, monthSpent: spent[c.driver_id] ?? 0 } : null,
      })),
      pending,
    };
  }

  /** Owner-only register of work amounts agreed in orders; not a bank payment statement. */
  async finances(owner: AuthUser) {
    if (owner.owner_id) throw bad('driver', 'Финансы автопарка доступны только владельцу');
    const orders = await this.db.query<any>(
      `select o.id, o.number, o.service, o.status, o.description, o.created_at, o.completed_at,
              o.call_out_amount, o.work_amount, o.client_fee_pct, o.discount_amount, o.estimate,
              o.payment_method, o.vehicle_id,
              v.brand, v.model, v.plate,
              coalesce(d.name, d.phone) as driver_name,
              coalesce(p.name, p.phone) as performer_name,
              coalesce(pay.collected, 0)::int as collected,
              coalesce(pay.refunded, 0)::int as refunded,
              coalesce(pay.pending, 0)::int as pending_payment,
              coalesce(pay.entries, '[]'::json) as payment_entries
         from orders o
         left join vehicles v on v.id=o.vehicle_id and v.owner_id=$1
         left join users d on d.id=o.created_by
         left join users p on p.id=o.performer_id
         left join lateral (
           select
             coalesce(sum(greatest(total - coalesce(refunded_amount, 0), 0))
               filter (where status in ('captured', 'partially_refunded')), 0) as collected,
             coalesce(sum(coalesce(refunded_amount, 0)), 0) as refunded,
             coalesce(sum(total)
               filter (where status in ('created', 'pending', 'held')), 0) as pending,
             coalesce(json_agg(json_build_object(
               'id', id, 'kind', kind, 'method', method, 'status', status,
               'total', total, 'refunded', coalesce(refunded_amount, 0),
               'createdAt', created_at, 'updatedAt', updated_at
             ) order by created_at, id), '[]'::json) as entries
           from payments where order_id=o.id
         ) pay on true
        where o.client_id=$1
        order by o.created_at desc limit 200`,
      [owner.id],
    );
    const items = orders.map((o: any) => {
      const callOut = Number(o.call_out_amount ?? o.estimate?.callOut ?? 0);
      const work = Number(o.work_amount ?? 0);
      const amount = callOut + work;
      const fee = Math.round(amount * Number(o.client_fee_pct ?? 0) / 100);
      const discount = Math.min(Number(o.discount_amount ?? 0), amount + fee);
      return {
        id: o.id, number: o.number, service: o.service, status: o.status,
        description: o.description, createdAt: o.created_at, completedAt: o.completed_at,
        vehicleId: o.vehicle_id, brand: o.brand, model: o.model, plate: o.plate,
        driverName: o.driver_name, performerName: o.performer_name,
        paymentMethod: o.payment_method,
        confirmedCollected: Number(o.collected ?? 0),
        confirmedRefunded: Number(o.refunded ?? 0),
        pendingPayment: Number(o.pending_payment ?? 0),
        payments: o.payment_entries ?? [],
        agreedTotal: o.status === 'completed' ? amount + fee - discount : null,
      };
    });
    return {
      agreedTotal: items.reduce((sum, item) => sum + (item.agreedTotal ?? 0), 0),
      confirmedCollected: items.reduce((sum, item) => sum + item.confirmedCollected, 0),
      confirmedRefunded: items.reduce((sum, item) => sum + item.confirmedRefunded, 0),
      items,
    };
  }

  async set(owner: AuthUser, p: FleetSettings & { edoPdfOnly?: boolean }) {
    if (owner.owner_id) throw bad('driver', 'Парком управляет владелец');
    const cur = (await this.db.one<any>('select fleet from users where id=$1', [owner.id]))?.fleet ?? {};
    const next = { ...cur };
    if (p.mode) next.mode = p.mode;
    if (p.perOrder !== undefined) next.perOrder = p.perOrder;
    if (p.perMonth !== undefined) next.perMonth = p.perMonth;
    if (p.allow) next.allow = { ...(cur.allow ?? {}), ...p.allow };
    await this.db.query('update users set fleet=$2, edo_pdf_only=coalesce($3, edo_pdf_only) where id=$1', [owner.id, next, p.edoPdfOnly ?? null]);
    await this.db.query('insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4)', [owner.id, 'fleet.update', owner.id, p]);
    return this.get(owner);
  }

  /** Новая наклейка: старая перестаёт пускать, текущий водитель машины снимается */
  async newQr(owner: AuthUser, vehicleId: string) {
    const v = await this.db.one(`update vehicles set qr_code=encode(gen_random_bytes(9), 'hex'), driver_id=null, driver_since=null where id=$1 and owner_id=$2 returning id`, [vehicleId, owner.id]);
    if (!v) throw notFound('Машина не найдена');
    return this.get(owner);
  }

  /** Водитель: что ему можно — чтобы не предлагать лишнего и честно сказать про лимит */
  async rules(user: AuthUser) {
    if (!user.owner_id) return null;
    const o = await this.db.one<any>('select fleet, coalesce(company_name, name) as owner from users where id=$1', [user.owner_id]);
    const f = o?.fleet ?? {};
    return {
      owner: o?.owner ?? 'Владелец', mode: f.mode ?? 'limit', perOrder: f.perOrder ?? null, perMonth: f.perMonth ?? null,
      allow: { repair: true, tow: true, consult: true, service: true, shop: true, insurance: false, inspection: false, ...(f.allow ?? {}) }, monthSpent: await this.orders.monthSpent(user.id),
    };
  }

  /** Публично: что за машина на наклейке — водитель видит перед входом */
  async qrInfo(code: string) {
    const v = await this.db.one<any>(
      `select v.brand, v.model, v.plate, coalesce(u.company_name, u.name) as owner from vehicles v join users u on u.id=v.owner_id where v.qr_code=$1`, [code]);
    if (!v) throw notFound('Наклейка не действует — попросите у владельца новую');
    return { brand: v.brand, model: v.model, plate: v.plate ? v.plate.replace(/^(.)(\d{3})(..)(.*)$/, '$1***$3$4') : null, owner: v.owner ?? 'Владелец' };
  }

  /** Водитель отсканировал наклейку и вошёл по SMS — сразу работает с этой машиной; прежний водитель теряет доступ */
  async qrJoin(user: AuthUser, code: string) {
    const v = await this.db.one<any>('select * from vehicles where qr_code=$1', [code]);
    if (!v) throw notFound('Наклейка не действует — попросите у владельца новую');
    if (v.owner_id === user.id) throw bad('owner', 'Это ваша машина — вы владелец');
    if (user.owner_id && user.owner_id !== v.owner_id) throw conflict('driver_taken', 'Вы водитель другого владельца — попросите его снять вас с машины');
    const own = await this.db.one<{ n: number }>('select count(*)::int as n from vehicles where owner_id=$1', [user.id]);
    if (!user.owner_id && (own?.n ?? 0) > 0) throw conflict('has_garage', 'У вас свой гараж — водителем чужой машины по наклейке стать нельзя');
    const prev = v.driver_id && v.driver_id !== user.id ? v.driver_id : null;
    await this.db.tx(async (q) => {
      await q.query(`update users set owner_id=$2, roles = (select array(select distinct unnest(roles || '{driver}'::text[]))) where id=$1`, [user.id, v.owner_id]);
      await q.query('update vehicles set driver_id=null, driver_since=null where driver_id=$1 and id<>$2', [user.id, v.id]);
      await q.query('update vehicles set driver_id=$2, driver_since=now() where id=$1', [v.id, user.id]);
      // Отозвать связь прежнего водителя с компанией, если за ним не осталось машин.
      // Иначе owner_id продолжит давать доступ к данным прежнего автопарка.
      if (prev) await q.query(`update users set owner_id=null, roles=array_remove(roles,'driver')
        where id=$1 and owner_id=$2 and not exists
        (select 1 from vehicles where driver_id=$1 and owner_id=$2)`, [prev, v.owner_id]);
    });
    await this.notifier.notify([v.owner_id], { type: 'fleet' },
      { kind: 'normal', title: 'Новый водитель вошёл по QR', body: `${v.brand} ${v.plate ?? ''}`.trim() + (prev ? ' · прежний водитель потерял доступ' : ''), data: {} });
    if (prev) await this.notifier.notify([prev], { type: 'fleet' }, { kind: 'normal', title: 'Доступ к машине закрыт', body: `${v.brand} ${v.plate ?? ''}: вошёл новый водитель`, data: {} });
    return { vehicleId: v.id, brand: v.brand, model: v.model, plate: v.plate };
  }
}
