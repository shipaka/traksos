import type { Db } from '../db/index.ts';
import type { AuthUser } from '../http/router.ts';
import { forbidden, notFound, bad } from '../http/router.ts';

export type VehicleServiceKind = 'insurance' | 'inspection';
export type VehicleServiceStatus = 'submitted' | 'in_review' | 'need_documents' | 'sent_to_partner' | 'completed' | 'rejected' | 'cancelled';

const transitions: Record<VehicleServiceStatus, VehicleServiceStatus[]> = {
  submitted: ['in_review', 'rejected', 'cancelled'],
  in_review: ['need_documents', 'sent_to_partner', 'rejected', 'cancelled'],
  need_documents: ['in_review', 'cancelled'],
  sent_to_partner: ['completed', 'rejected', 'cancelled'],
  completed: [], rejected: [], cancelled: [],
};

export class VehicleServiceRequests {
  constructor(private db: Db) {}

  async mine(user: AuthUser) {
    const owner = user.owner_id ?? user.id;
    const allow = user.owner_id ? (await this.db.one<any>('select fleet from users where id=$1', [owner]))?.fleet?.allow : null;
    const kinds = user.owner_id ? (['insurance', 'inspection'] as const).filter(k => allow?.[k] === true) : ['insurance', 'inspection'];
    return this.db.query(
      `select r.*, v.brand, v.model, v.plate from vehicle_service_requests r
       join vehicles v on v.id=r.vehicle_id
       where r.owner_id=$1 and ($2::uuid = r.owner_id or v.driver_id=$2)
         and r.kind = any($3::text[])
       order by r.created_at desc`, [owner, user.id, kinds]);
  }

  async history(user: AuthUser, vehicleId: string) {
    const owner = user.owner_id ?? user.id;
    const vehicle = await this.db.one<any>(
      'select id, driver_id from vehicles where id=$1 and owner_id=$2', [vehicleId, owner]);
    if (!vehicle || (user.owner_id && vehicle.driver_id !== user.id)) throw notFound('Машина не найдена');
    const allow = user.owner_id ? (await this.db.one<any>('select fleet from users where id=$1', [owner]))?.fleet?.allow : null;
    const kinds = user.owner_id ? (['insurance', 'inspection'] as const).filter(k => allow?.[k] === true) : ['insurance', 'inspection'];
    return this.db.query(
      `select id, kind, status, comment, staff_note, policy_expires_on, created_at, updated_at
       from vehicle_service_requests where vehicle_id=$1 and owner_id=$2 and kind=any($3::text[])
       order by created_at desc`, [vehicleId, owner, kinds]);
  }

  async create(user: AuthUser, vehicleId: string, kind: VehicleServiceKind, comment?: string) {
    const owner = user.owner_id ?? user.id;
    const v = await this.db.one<any>(
      'select id, driver_id from vehicles where id=$1 and owner_id=$2', [vehicleId, owner]);
    if (!v || (user.owner_id && v.driver_id !== user.id)) throw notFound('Машина не найдена');
    // Serialize creation with driver assignment and permissions changes.
    return this.db.tx(async (q) => {
      const locked = await q.one<any>(
        'select id, driver_id from vehicles where id=$1 and owner_id=$2 for update', [vehicleId, owner]);
      if (!locked || (user.owner_id && locked.driver_id !== user.id)) throw notFound('Машина не найдена');
      if (user.owner_id) {
        const settings = await q.one<any>('select fleet from users where id=$1', [owner]);
        if (settings?.fleet?.allow?.[kind] !== true) throw forbidden('Владелец не разрешил эту услугу');
      }
      const active = await q.one<{ id: string }>(
        `select id from vehicle_service_requests
         where owner_id=$1 and vehicle_id=$2 and kind=$3
           and status in ('submitted','in_review','need_documents','sent_to_partner')
         limit 1`, [owner, vehicleId, kind]);
      if (active) throw bad('duplicate_request', 'По этой машине уже есть активная заявка на эту услугу');
      return q.one(
        `insert into vehicle_service_requests(owner_id, requested_by, vehicle_id, kind, comment)
         values ($1,$2,$3,$4,$5) returning *`,
        [owner, user.id, vehicleId, kind, comment ?? null]);
    });
  }

  async cancel(user: AuthUser, id: string) {
    const owner = user.owner_id ?? user.id;
    const r = await this.db.one<any>(
      `update vehicle_service_requests set status='cancelled', updated_at=now()
       where id=$1 and owner_id=$2 and status in ('submitted','in_review','need_documents')
       and ($3::uuid = owner_id or (requested_by=$3 and exists (
         select 1 from vehicles v join users u on u.id=v.owner_id
         where v.id=vehicle_service_requests.vehicle_id and v.driver_id=$3
           and (u.fleet->'allow'->>vehicle_service_requests.kind)::boolean is true
       ))) returning *`, [id, owner, user.id]);
    if (!r) throw notFound('Заявка не найдена или её уже нельзя отменить');
    return r;
  }

  async setStatus(staff: AuthUser, id: string, status: VehicleServiceStatus, note?: string, policyExpiresOn?: string) {
    // Staff role is enforced at the route as well as here.
    if (!staff.roles?.some((role: string) => ['admin', 'moderator'].includes(role))) throw forbidden('Нет доступа к обработке заявок');
    return this.db.tx(async (q) => {
      const current = await q.one<any>('select * from vehicle_service_requests where id=$1 for update', [id]);
      if (!current) throw notFound('Заявка не найдена');
      if (!transitions[current.status as VehicleServiceStatus]?.includes(status)) throw bad('invalid_status', 'Недопустимый переход статуса');
      if (['rejected', 'need_documents'].includes(status) && !(note ?? current.staff_note ?? '').trim()) {
        throw bad('missing_status_reason', 'Укажите причину отказа или список необходимых документов');
      }
      if (policyExpiresOn && (current.kind !== 'insurance' || status !== 'completed')) throw bad('invalid_expiry', 'Срок полиса указывается при завершении страхования');
      if (status === 'completed' && current.kind === 'insurance') {
        const expiry = policyExpiresOn ?? (current.policy_expires_on instanceof Date ? current.policy_expires_on.toISOString().slice(0, 10) : current.policy_expires_on);
        if (!expiry || !/^\d{4}-\d{2}-\d{2}$/.test(String(expiry))) {
          throw bad('invalid_expiry', 'Для завершения страхования укажите дату окончания полиса');
        }
        const parsed = new Date(String(expiry) + 'T00:00:00Z');
        if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== String(expiry)) {
          throw bad('invalid_expiry', 'Некорректная дата окончания полиса');
        }
      }
      return q.one(
        `update vehicle_service_requests set status=$2, staff_note=$3, assigned_to=$4, policy_expires_on=coalesce($5::date, policy_expires_on), updated_at=now()
         where id=$1 returning *`, [id, status, note ?? current.staff_note, staff.id, policyExpiresOn ?? null]);
    });
  }

  /** Renew the expiry date and re-arm reminders for the new policy term. */
  async renewPolicy(user: AuthUser, id: string, expiresOn: string) {
    if (user.owner_id) throw forbidden('Продлить дату полиса может только владелец');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) throw bad('invalid_expiry', 'Некорректная дата окончания полиса');
    const parsed = new Date(expiresOn + 'T00:00:00Z');
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== expiresOn) {
      throw bad('invalid_expiry', 'Некорректная дата окончания полиса');
    }
    const updated = await this.db.one(
      `update vehicle_service_requests
          set policy_expires_on=$3::date,
              reminder_30_sent_at=null, reminder_7_sent_at=null, reminder_1_sent_at=null,
              updated_at=now()
        where id=$1 and owner_id=$2 and kind='insurance' and status='completed'
          and $3::date > current_date
          and (policy_expires_on is distinct from $3::date)
        returning *`, [id, user.id, expiresOn]);
    if (!updated) throw notFound('Завершённый полис не найден или дата не изменилась');
    return updated;
  }

  async queue(staff: AuthUser, kind?: VehicleServiceKind) {
    if (!staff.roles?.some((role: string) => ['admin', 'moderator'].includes(role))) throw forbidden('Нет доступа');
    return this.db.query(
      `select r.*, v.brand, v.model, v.plate from vehicle_service_requests r
       join vehicles v on v.id=r.vehicle_id
       where ($1::text is null or r.kind=$1) order by r.created_at desc limit 200`, [kind ?? null]);
  }
}
