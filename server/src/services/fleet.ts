// «Мой парк»: машины и водители, что водителю можно, лимиты, подтверждение заказов, ЭДО, вход водителя по QR-наклейке.

import type { Db, Queryable } from '../db/index.ts';
import type { Notifier } from './notify.ts';
import type { OrdersService } from './orders.ts';
import { bad, conflict, forbidden, notFound, type AuthUser } from '../http/router.ts';
import { validateRoles } from '../domain/roles.ts';

export interface FleetSettings {
  mode?: 'limit' | 'approve';
  perOrder?: number | null;
  perMonth?: number | null;
  allow?: { repair?: boolean; tow?: boolean; consult?: boolean; service?: boolean; shop?: boolean };
}

const maskPhone = (p: string) => p.replace(/^(\+7)(\d{3})\d{3}(\d{2})(\d{2})$/, '$1 $2 ***-$3-$4');

export class FleetService {
  constructor(private db: Db, private notifier: Notifier, private orders: OrdersService) {}

  /** Same owner lock as the order-budget transaction, before any vehicle lock. */
  private async lockOwner(q: Queryable, ownerId: string) {
    return q.one(`select id from users where id=$1 and status='active' and deleted_at is null
      and owner_id is null and 'client'=any(roles) and not ('driver'=any(roles))
      for no key update`, [ownerId]);
  }

  async get(owner: AuthUser) {
    if (owner.owner_id || !owner.roles.includes('client') || owner.roles.includes('driver')) throw bad('driver', 'Парком управляет владелец');
    const u = await this.db.one<any>(`select fleet, company_name, company_inn, edo_operator, edo_id, edo_pdf_only from users
      where id=$1 and status='active' and deleted_at is null and owner_id is null
        and 'client'=any(roles) and not ('driver'=any(roles))`, [owner.id]);
    if (!u) throw forbidden('Парком управляет только действующий владелец автопарка');
    const cars = await this.db.query(
      `select v.id, v.brand, v.model, v.year, v.plate, v.trailer_plate, v.qr_code, v.driver_id, v.driver_since,
              d.name as driver_name, d.phone as driver_phone
         from vehicles v left join users d on d.id=v.driver_id where v.owner_id=$1 order by v.created_at`, [owner.id]);
    const drivers = [...new Set(cars.map((c: any) => c.driver_id).filter(Boolean))] as string[];
    const spent: Record<string, number> = {};
    for (const d of drivers) spent[d] = await this.orders.monthSpent(d, owner.id);
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

  async set(owner: AuthUser, p: FleetSettings & { edoPdfOnly?: boolean }) {
    // The GET and PUT gates must match. A rejected PUT must not mutate the
    // user's settings or produce an audit entry before returning an error.
    if (owner.owner_id || !owner.roles.includes('client') || owner.roles.includes('driver'))
      throw forbidden('Парком управляет только владелец автопарка');
    await this.db.tx(async (q) => {
      if (!await this.lockOwner(q, owner.id)) throw forbidden('Парком управляет только действующий владелец автопарка');
      const record = await q.one<any>('select fleet from users where id=$1', [owner.id]);
      const cur = record.fleet ?? {};
      const next = { ...cur };
      if (p.mode) next.mode = p.mode;
      if (p.perOrder !== undefined) next.perOrder = p.perOrder;
      if (p.perMonth !== undefined) next.perMonth = p.perMonth;
      if (p.allow) next.allow = { ...(cur.allow ?? {}), ...p.allow };
      await q.query('update users set fleet=$2, edo_pdf_only=coalesce($3, edo_pdf_only) where id=$1', [owner.id, next, p.edoPdfOnly ?? null]);
      await q.query('insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4)', [owner.id, 'fleet.update', owner.id, p]);
    });
    return this.get(owner);
  }

  /** A new sticker revokes the previous driver and their last fleet link atomically. */
  async newQr(owner: AuthUser, vehicleId: string) {
    if (owner.owner_id || !owner.roles.includes('client') || owner.roles.includes('driver'))
      throw forbidden('Парком управляет только владелец автопарка');
    const removed = await this.db.tx(async (q) => {
      if (!await this.lockOwner(q, owner.id)) throw forbidden('Парком управляет только действующий владелец автопарка');
      // Owner, then vehicle, matching qrJoin and order creation.
      const vehicle = await q.one<{ id: string; driver_id: string | null }>(
        'select id, driver_id from vehicles where id=$1 and owner_id=$2 for update', [vehicleId, owner.id]);
      if (!vehicle) throw notFound('Машина не найдена');
      await q.query(`update vehicles set qr_code=encode(gen_random_bytes(9), 'hex'),
        driver_id=null, driver_since=null where id=$1`, [vehicleId]);
      if (vehicle.driver_id) {
        await q.query(`update users set owner_id=null
          where id=$1 and owner_id=$2
          and not exists (select 1 from vehicles where driver_id=$1)`,
          [vehicle.driver_id, owner.id]);
      }
      await q.query('insert into audit_log(actor_id,action,target,data) values ($1,$2,$3,$4)',
        [owner.id, 'fleet.qr_rotate', vehicle.id, { removedDriverId: vehicle.driver_id }]);
      return vehicle.driver_id;
    });
    // Generic invalidation only; no new sticker or vehicle metadata sent to a former driver.
    if (removed) this.notifier.live([removed], { type: 'fleet' });
    return this.get(owner);
  }

  /** Водитель: что ему можно — чтобы не предлагать лишнего и честно сказать про лимит */
  async rules(user: AuthUser) {
    if (!user.owner_id || !user.roles.includes('driver')) return null;
    // Check live owner and driver assignment, then read the scoped total
    // while QR rotation, transfer and budget settings are serialized.
    return this.db.tx(async q => {
      if (!await this.lockOwner(q, user.owner_id!)) return null;
      const o = await q.one<any>(`select u.fleet, coalesce(u.company_name,u.name) as owner
        from users u join vehicles v on v.owner_id=u.id
        join users d on d.id=v.driver_id and d.owner_id=u.id
        where u.id=$1 and d.id=$2 and d.status='active' and d.deleted_at is null
          and 'driver'=any(d.roles) limit 1 for share of v,d`, [user.owner_id, user.id]);
      if (!o) return null;
      const f = o.fleet ?? {};
      return {
        owner: o.owner ?? 'Владелец', mode: f.mode ?? 'limit', perOrder: f.perOrder ?? null, perMonth: f.perMonth ?? null,
        allow: { repair: true, tow: true, consult: true, service: true, shop: true, insurance: false, inspection: false, ...(f.allow ?? {}) },
        monthSpent: await this.orders.monthSpent(user.id, user.owner_id!, q),
      };
    });
  }

  /** Публично: что за машина на наклейке — водитель видит перед входом */
  async qrInfo(code: string) {
    const v = await this.db.one<any>(
      `select v.brand, v.model, v.plate, coalesce(u.company_name, u.name) as owner from vehicles v join users u on u.id=v.owner_id where v.qr_code=$1
        and u.status='active' and u.deleted_at is null and u.owner_id is null
        and 'client'=any(u.roles) and not ('driver'=any(u.roles))`, [code]);
    if (!v) throw notFound('Наклейка не действует — попросите у владельца новую');
    return { brand: v.brand, model: v.model, plate: v.plate ? v.plate.replace(/^(.)(\d{3})(..)(.*)$/, '$1***$3$4') : null, owner: v.owner ?? 'Владелец' };
  }

  /** Join requires an actual customer account and an unrevoked QR, not just a signed-in user. */
  async qrJoin(user: AuthUser, code: string) {
    const result = await this.db.tx(async (q) => {
      // Discover the owner without trusting this initial QR lookup; lock the
      // owner first, then re-read the exact sticker under the vehicle lock.
      // This serializes opposing moves within one fleet and QR rotation.
      const target = await q.one<{ owner_id: string }>('select owner_id from vehicles where qr_code=$1', [code]);
      if (!target || !await this.lockOwner(q, target.owner_id))
        throw notFound('Наклейка не действует — попросите у владельца новую');
      const v = await q.one<any>('select * from vehicles where qr_code=$1 and owner_id=$2 for update', [code, target.owner_id]);
      if (!v) throw notFound('Наклейка не действует — попросите у владельца новую');
      const current = await q.one<{ id: string; roles: string[]; owner_id: string | null }>(
        "select id, roles, owner_id from users where id=$1 and status='active' and deleted_at is null for update", [user.id]);
      if (!current) throw notFound('Аккаунт не найден');
      if (v.owner_id === current.id) throw bad('owner', 'Это ваша машина — вы владелец');
      // Staff and non-customer accounts must never gain a driver role via QR.
      // An owner-client with no vehicles may convert to a driver explicitly.
      if (current.roles.some(r => ['admin','moderator','master','tow','service','insurer',
        'inspection_operator','courier'].includes(r)) ||
        !current.roles.some(r => (r === 'client' || r === 'driver') && user.roles.includes(r)))
        throw forbidden('Привязка по QR доступна только клиенту или водителю');
      validateRoles(current.roles.filter(r => r !== 'client'), ['driver']);
      const own = await q.one<{ n: number }>('select count(*)::int as n from vehicles where owner_id=$1', [current.id]);
      if ((own?.n ?? 0) > 0)
        throw conflict('has_garage', 'У вас свой гараж — водителем чужой машины по наклейке стать нельзя');
      if (current.owner_id && current.owner_id !== v.owner_id) {
        // Older releases could leave a stale owner_id after revocation. Only
        // an actual assignment prevents moving to a different fleet.
        const assigned = await q.one<{ n: number }>(
          'select count(*)::int as n from vehicles where driver_id=$1', [current.id]);
        if ((assigned?.n ?? 0) > 0)
          throw conflict('driver_taken', 'Вы водитель другого владельца — попросите его снять вас с машины');
      }
      const prev: string | null = v.driver_id && v.driver_id !== current.id ? v.driver_id : null;
      await q.query(`update users set owner_id=$2,
        roles = array(select distinct unnest(array_remove(roles, 'client') || '{driver}'::text[])),
        registration_kind='driver' where id=$1`, [current.id, v.owner_id]);
      await q.query('update vehicles set driver_id=null, driver_since=null where driver_id=$1 and id<>$2',
        [current.id, v.id]);
      await q.query('update vehicles set driver_id=$2, driver_since=now() where id=$1', [v.id, current.id]);
      if (prev) await q.query(`update users set owner_id=null
        where id=$1 and owner_id=$2
        and not exists (select 1 from vehicles where driver_id=$1)`, [prev, v.owner_id]);
      await q.query('insert into audit_log(actor_id,action,target,data) values ($1,$2,$3,$4)',
        [current.id, 'fleet.qr_join', v.id, { ownerId: v.owner_id, removedDriverId: prev }]);
      return { v, prev };
    });
    const { v, prev } = result;
    await this.notifier.notify([v.owner_id], { type: 'fleet' },
      { kind: 'normal', title: 'Новый водитель вошёл по QR', body: `${v.brand} ${v.plate ?? ''}`.trim() + (prev ? ' · прежний водитель потерял доступ' : ''), data: {} });
    if (prev) await this.notifier.notify([prev], { type: 'fleet' }, { kind: 'normal', title: 'Доступ к машине закрыт', body: `${v.brand} ${v.plate ?? ''}: вошёл новый водитель`, data: {} });
    return { vehicleId: v.id, brand: v.brand, model: v.model, plate: v.plate };
  }
}
