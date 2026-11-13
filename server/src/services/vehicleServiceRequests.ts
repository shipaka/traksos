import type { Db, Row } from '../db/index.ts';
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
      `select r.id, r.kind, r.status, r.requested_by, r.comment, r.staff_note, r.policy_expires_on, r.insurance_stage, r.created_at, r.updated_at,
              coalesce((
                select json_agg(json_build_object(
                  'status', e.status, 'policy_expires_on', e.policy_expires_on,
                  'note', e.note, 'changed_at', e.changed_at
                ) order by e.changed_at, e.id)
                from vehicle_service_request_events e where e.request_id=r.id
              ), '[]'::json) as events
       from vehicle_service_requests r
       where r.vehicle_id=$1 and r.owner_id=$2 and r.kind=any($3::text[])
       order by r.created_at desc`, [vehicleId, owner, kinds]);
  }

  async create(user: AuthUser, vehicleId: string | undefined, kind: VehicleServiceKind, comment?: string,
    insurance?: {agentId:string; details:{ applicant:{firstName:string;lastName:string;middleName?:string}; vehicle:Record<string,string>; consentAt?:string}}) {
    const owner = user.owner_id ?? user.id;
    if (!vehicleId && (!insurance || kind !== 'insurance')) throw bad('bad_vehicle', 'Выберите автомобиль');
    // Lock the owner before duplicate lookup: simultaneous insurance submissions cannot create two identical cars.
    return this.db.tx(async (q) => {
      let resolvedId = vehicleId;
      if (!resolvedId) {
        if (user.owner_id) throw forbidden('Добавить автомобиль в парк может только владелец');
        await q.one('select id from users where id=$1 for update', [owner]);
        const v = insurance!.details.vehicle;
        const plate = v.plate.trim().toUpperCase().replace(/\s+/g, '');
        const vin = v.vin.trim().toUpperCase().replace(/\s+/g, '');
        const matches = await q.query<{id:string;brand:string;model:string;year:number;plate:string|null;vin:string|null}>(
          `select id,brand,model,year,plate,vin from vehicles where owner_id=$1
           and (upper(regexp_replace(coalesce(plate,''),'[[:space:]]+','','g'))=$2
             or upper(regexp_replace(coalesce(vin,''),'[[:space:]]+','','g'))=$3)`,
          [owner,plate,vin]);
        // VIN and plate are independent identifiers. Never silently merge records if they disagree.
        if (matches.length > 1 || (matches.length === 1 && (
          matches[0].brand.trim().toLowerCase() !== v.brand.trim().toLowerCase() ||
          (matches[0].model ?? '').trim().toLowerCase() !== v.model.trim().toLowerCase() ||
          Number(matches[0].year) !== Number(v.year) ||
          (!!matches[0].vin && matches[0].vin.trim().toUpperCase() !== vin) ||
          (!!matches[0].plate && matches[0].plate.trim().toUpperCase().replace(/\s+/g,'') !== plate)
        ))) throw bad('vehicle_conflict', 'VIN или госномер уже зарегистрирован с другими данными. Проверьте автомобиль.');
        if (matches.length === 1) {
          resolvedId = matches[0].id;
          // Legacy garage entries can lack VIN. Fill it only when no other value exists.
          if (!matches[0].vin) await q.query('update vehicles set vin=$2 where id=$1 and vin is null', [resolvedId,vin]);
        } else {
          const created = await q.one<{id:string}>(
            `insert into vehicles(owner_id,brand,model,year,plate,trailer_plate,vin)
             values ($1,$2,$3,$4,$5,$6,$7) returning id`,
            [owner,v.brand.trim(),v.model.trim(),Number(v.year),v.plate.trim(),v.trailerPlate?.trim() || null,vin]);
          resolvedId = created!.id;
        }
      }
      const locked = await q.one<any>(
        'select id, driver_id, brand, model, year, plate, vin from vehicles where id=$1 and owner_id=$2 for update', [resolvedId, owner]);
      if (!locked || (user.owner_id && locked.driver_id !== user.id)) throw notFound('Машина не найдена');
      if (insurance && vehicleId) {
        // A selected garage record must not be paired with an unrelated VIN or registration.
        const supplied = insurance.details.vehicle;
        const norm = (value: unknown) => String(value ?? '').trim().toUpperCase().replace(/\\s+/g, '');
        if (norm(locked.brand) !== norm(supplied.brand) ||
            (locked.model && norm(locked.model) !== norm(supplied.model)) ||
            (locked.year && Number(locked.year) !== Number(supplied.year)) ||
            (locked.plate && norm(locked.plate) !== norm(supplied.plate)) ||
            (locked.vin && norm(locked.vin) !== norm(supplied.vin))) {
          throw bad('vehicle_conflict', 'Данные заявки не совпадают с выбранным автомобилем. Проверьте VIN, номер и характеристики.');
        }
        // Do not overwrite missing VIN from unverified client text: insurer must verify documents.
      }
      if (user.owner_id) {
        const settings = await q.one<any>('select fleet from users where id=$1', [owner]);
        if (settings?.fleet?.allow?.[kind] !== true) throw forbidden('Владелец не разрешил эту услугу');
      }
      const active = await q.one<{ id: string }>(
        `select id from vehicle_service_requests
         where owner_id=$1 and vehicle_id=$2 and kind=$3
           and status in ('submitted','in_review','need_documents','sent_to_partner')
         limit 1`, [owner, resolvedId, kind]);
      if (active) throw bad('duplicate_request', 'По этой машине уже есть активная заявка на эту услугу');
      if (insurance) {
        if (kind !== 'insurance') throw bad('invalid_kind', 'Агент выбирается только для страхования');
        const partner=await q.one<{id:string}>(`select id from users
          where id=$1 and 'insurer'=any(roles) and status='active'`,[insurance.agentId]);
        if(!partner)throw notFound('Страховой агент недоступен');
      }
      const created = insurance
        ? await q.one<any>(
          `insert into vehicle_service_requests(owner_id, requested_by, vehicle_id, kind, comment,
             assigned_to,status,insurance_stage,insurance_details)
           values ($1,$2,$3,$4,$5,$6::uuid,'sent_to_partner','received',$7::jsonb) returning *`,
          [owner,user.id,resolvedId,kind,comment??null,insurance.agentId,JSON.stringify(insurance.details)])
        : await q.one<any>(
          `insert into vehicle_service_requests(owner_id, requested_by, vehicle_id, kind, comment)
           values ($1,$2,$3,$4,$5) returning *`,
          [owner,user.id,resolvedId,kind,comment??null]);
      if (!created) throw notFound('Не удалось создать заявку');
      if(insurance)await q.query(`insert into insurance_thread_messages(request_id,sender_id,kind,body)
         values ($1,$2,'status','Заявка получена страховым агентом')`,[created.id,user.id]);
      return created;
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
    const isStaff = staff.roles?.some((role: string) => ['admin', 'moderator'].includes(role));
    const isInsurer = staff.roles?.includes('insurer');
    if (!isStaff && !isInsurer) throw forbidden('Нет доступа к обработке заявок');
    return this.db.tx(async (q) => {
      const current = await q.one<any>('select * from vehicle_service_requests where id=$1 for update', [id]);
      if (isInsurer && !isStaff && (current?.kind !== 'insurance' || current?.assigned_to !== staff.id ||
        current?.status !== 'sent_to_partner' || !['completed', 'rejected'].includes(status))) {
        throw forbidden('Можно изменять только назначенные вам страховые заявки');
      }
      if (!current) throw notFound('Заявка не найдена');
      // New manual quote workflow only completes after selected offer + encrypted PDF.
      if (current.insurance_stage && status === 'completed')
        throw bad('quote_workflow_required', 'Готовый полис отправляется через страховую переписку');
      if (!transitions[current.status as VehicleServiceStatus]?.includes(status)) throw bad('invalid_status', 'Недопустимый переход статуса');
      if (['rejected', 'need_documents'].includes(status) && !note?.trim()) {
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
        // A newly completed policy must still be valid on the completion date.
        const today = new Date().toISOString().slice(0, 10);
        if (String(expiry) <= today) {
          throw bad('expired_policy', 'Дата окончания нового полиса должна быть позже сегодняшнего дня');
        }
      }
      const updated = await q.one(
        `update vehicle_service_requests set status=$2, staff_note=$3, assigned_to=$4, policy_expires_on=coalesce($5::date, policy_expires_on), updated_at=now()
         where id=$1 returning *`, [id, status, note?.trim() || null, isStaff ? staff.id : current.assigned_to, policyExpiresOn ?? null]);
      if (!updated) throw notFound('Заявка не найдена');
      return updated;
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

  /** Notify a driver only while they remain assigned to this vehicle and the owner permits the service. */
  async recipients(request: Row) {
    const drivers = await this.db.query<{ id: string }>(
      `select v.driver_id as id from vehicles v join users u on u.id=v.owner_id
       where v.id=$1 and v.owner_id=$2 and v.driver_id=$3
         and (u.fleet->'allow'->>$4)::boolean is true`,
      [request.vehicle_id, request.owner_id, request.requested_by, request.kind],
    );
    return [request.owner_id, ...drivers.map((row) => row.id)];
  }

  /** Admin assigns a submitted insurance request after forwarding it to a verified partner role. */
  async assignInsurer(staff: AuthUser, requestId: string, insurerId: string) {
    if (!staff.roles?.some((role: string) => ['admin', 'moderator'].includes(role))) throw forbidden('Нет доступа');
    return this.db.tx(async (q) => {
      const partner = await q.one<{ id: string }>(
        `select id from users where id=$1 and 'insurer'=any(roles) and status='active'`, [insurerId]);
      if (!partner) throw notFound('Страховщик не найден');
      const request = await q.one(
        `update vehicle_service_requests set assigned_to=$3, updated_at=now()
         where id=$1 and kind='insurance' and status='sent_to_partner'
           and exists (select 1 from users where id=$2 and roles && '{admin,moderator}'::text[])
         returning *`, [requestId, staff.id, insurerId]);
      if (!request) throw notFound('Заявка не передана партнёру');
      await q.query(
        `insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4)`,
        [staff.id, 'insurance.assign', requestId, { insurerId }],
      );
      return request;
    });
  }

  async insurers(staff: AuthUser) {
    if (!staff.roles?.some((role: string) => ['admin', 'moderator'].includes(role))) throw forbidden('Нет доступа');
    return this.db.query<{ id: string; name: string | null }>(
      `select id, name from users where 'insurer'=any(roles) and status='active' order by name, id`);
  }

  async insurerQueue(user: AuthUser) {
    if (!user.roles?.includes('insurer')) throw forbidden('Нет доступа');
    return this.db.query(
      `select r.id, r.kind, r.status, r.comment, r.staff_note, r.created_at, r.updated_at,
              r.policy_expires_on, r.insurance_stage, v.brand, v.model, v.plate
       from vehicle_service_requests r join vehicles v on v.id=r.vehicle_id
       where r.kind='insurance' and r.assigned_to=$1
       order by r.created_at desc limit 100`, [user.id]);
  }

  async queue(staff: AuthUser, kind?: VehicleServiceKind) {
    if (!staff.roles?.some((role: string) => ['admin', 'moderator'].includes(role))) throw forbidden('Нет доступа');
    return this.db.query(
      `select r.*, v.brand, v.model, v.plate from vehicle_service_requests r
       join vehicles v on v.id=r.vehicle_id
       where ($1::text is null or r.kind=$1) order by r.created_at desc limit 200`, [kind ?? null]);
  }
}
