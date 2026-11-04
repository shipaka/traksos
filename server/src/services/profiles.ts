import type { Db } from '../db/index.ts';
import type { SettingsService } from './settings.ts';
import { bad, forbidden, notFound, type AuthUser } from '../http/router.ts';
import { normalizePhone } from '../util.ts';

export interface PerformerInput {
  kind: 'master' | 'tow' | 'service' | 'ecu';
  name?: string;
  specialties?: string[];
  brands?: Record<string, 'excellent' | 'good' | 'last_resort' | 'refuse'>;
  tier?: 'eco' | 'comfort' | 'pro';
  callOutPrice?: number | null;
  hourPrice?: number | null;
  kmRate?: number | null;
  prepMinutes?: number;
  acceptsGroup?: boolean;
  taxStatus?: 'self_employed' | 'ip' | null;
  inn?: string | null;
  car?: { brand: string; color?: string; plate: string } | null;
}

export class ProfilesService {
  constructor(private db: Db, private settings: SettingsService) {}

  async me(user: AuthUser) {
    const u = await this.db.one(
      `select id, phone, name, roles, status, owner_id, company_name, company_inn, edo_operator, edo_id,
              rating::float as rating, rating_count, created_at from users where id=$1`, [user.id]);
    const performer = await this.performer(user.id);
    const ownerId = user.owner_id ?? user.id;
    const pr = await this.db.one<{ bonus: number; fee: string | null }>(
      `select (select coalesce(sum(amount),0)::int from bonus_entries where user_id=$1) as bonus,
              (select fee_pct_override from users where id=$1) as fee`, [ownerId]);
    const fees = await this.settings.get('fees');
    return { ...u, performer, bonus: pr?.bonus ?? 0, feePct: pr?.fee != null ? Number(pr.fee) : fees.clientFeePct, personalFee: pr?.fee != null };
  }

  async updateMe(userId: string, p: { name?: string; companyName?: string | null; companyInn?: string | null; edoOperator?: string | null; edoId?: string | null }) {
    if (p.companyInn && !/^\d{10}(\d{2})?$/.test(p.companyInn)) throw bad('bad_inn', 'ИНН — 10 или 12 цифр');
    await this.db.query(
      `update users set name = coalesce($2, name), company_name = coalesce($3, company_name),
         company_inn = coalesce($4, company_inn), edo_operator = coalesce($5, edo_operator), edo_id = coalesce($6, edo_id)
       where id=$1`,
      [userId, p.name ?? null, p.companyName ?? null, p.companyInn ?? null, p.edoOperator ?? null, p.edoId ?? null],
    );
  }

  async performer(userId: string) {
    const p = await this.db.one(
      `select p.*, (select coalesce(-sum(amount),0)::int from ledger_entries l
                     where l.performer_id = p.user_id and l.kind in ('cash_commission','cash_commission_paid')) as cash_debt
         from performer_profiles p where p.user_id=$1`, [userId]);
    return p;
  }

  async upsertPerformer(user: AuthUser, p: PerformerInput) {
    const corridor = (await this.settings.get('pricing')).corridor;
    const inRange = (v: number | null | undefined, min: number, max: number, label: string) => {
      if (v != null && (v < min || v > max)) throw bad('price_out_of_corridor', `${label}: от ${min / 100} до ${max / 100} ₽`);
    };
    inRange(p.callOutPrice, corridor.callOutMin, corridor.callOutMax, 'Выезд');
    inRange(p.hourPrice, corridor.hourMin, corridor.hourMax, 'Час работы');
    if (p.inn && !/^\d{12}$/.test(p.inn)) throw bad('bad_inn', 'ИНН физлица или ИП — 12 цифр');

    const role = p.kind === 'ecu' ? 'master' : p.kind;
    await this.db.tx(async (q) => {
      await q.query(
        `update users set roles = (select array(select distinct unnest(roles || $2::text[]))), name = coalesce($3, name) where id=$1`,
        [user.id, [role], p.name ?? null],
      );
      await q.query(
        `insert into performer_profiles(user_id, kind, specialties, brands, tier, call_out_price, hour_price, km_rate,
            prep_minutes, accepts_group, tax_status, inn, car)
         values ($1,$2,coalesce($3::text[],'{electric}'),coalesce($4::jsonb,'{}'),coalesce($5::text,'eco'),$6::int,$7::int,$8::int,
                 coalesce($9::int,0),coalesce($10::boolean,true),$11::text,$12::text,$13::jsonb)
         on conflict (user_id) do update set
           kind=excluded.kind,
           specialties=coalesce($3::text[], performer_profiles.specialties),
           brands=coalesce($4::jsonb, performer_profiles.brands),
           tier=coalesce($5::text, performer_profiles.tier),
           call_out_price=coalesce($6::int, performer_profiles.call_out_price),
           hour_price=coalesce($7::int, performer_profiles.hour_price),
           km_rate=coalesce($8::int, performer_profiles.km_rate),
           prep_minutes=coalesce($9::int, performer_profiles.prep_minutes),
           accepts_group=coalesce($10::boolean, performer_profiles.accepts_group),
           tax_status=coalesce($11::text, performer_profiles.tax_status),
           inn=coalesce($12::text, performer_profiles.inn),
           car=coalesce($13::jsonb, performer_profiles.car),
           updated_at=now()`,
        [user.id, p.kind, p.specialties ?? null, p.brands ?? null, p.tier ?? null, p.callOutPrice ?? null, p.hourPrice ?? null,
          p.kmRate ?? null, p.prepMinutes ?? null, p.acceptsGroup ?? null, p.taxStatus ?? null, p.inn ?? null, p.car ?? null],
      );
    });
    return this.performer(user.id);
  }

  async setLine(userId: string, s: { lineStatus?: 'online' | 'on_call' | 'busy' | 'offline'; busyUntil?: string | null; paused?: boolean }) {
    const p = await this.performer(userId);
    if (!p) throw notFound('Сначала заполните профиль исполнителя');
    if (s.lineStatus === 'online' && p.verification !== 'approved') {
      throw bad('not_verified', 'Заявки начнут приходить после проверки профиля');
    }
    if (s.lineStatus && p.line_status === 'on_job' && s.lineStatus !== 'offline') {
      throw bad('on_job', 'Вы на выезде — статус сменится сам, когда клиент подтвердит сумму');
    }
    await this.db.query(
      `update performer_profiles set line_status = coalesce($2::text, line_status), busy_until = $3::timestamptz,
         paused = coalesce($4::boolean, paused), missed_in_row = case when $2::text = 'online' then 0 else missed_in_row end, updated_at = now()
       where user_id=$1`,
      [userId, s.lineStatus ?? null, s.busyUntil ?? null, s.paused ?? null],
    );
    // Ушёл с линии или на паузу — убираем из звонков и торгов
    if (s.lineStatus === 'offline' || s.lineStatus === 'busy' || s.paused === true) await this.onUnavailable?.(userId);
    return this.performer(userId);
  }

  /** Подключается из app.ts: снять исполнителя со всех торгов и звонков */
  onUnavailable?: (userId: string) => Promise<void>;

  async setLocation(userId: string, lat: number, lng: number) {
    await this.db.query('update performer_profiles set lat=$2, lng=$3, location_at=now() where user_id=$1', [userId, lat, lng]);
  }

  // Машины -------------------------------------------------------------------

  async vehicles(user: AuthUser) {
    const ownerId = user.owner_id ?? user.id;
    const own = user.owner_id ? 'driver_id = $2' : 'true';
    return this.db.query(`select * from vehicles where owner_id=$1 and ${own} order by created_at`, user.owner_id ? [ownerId, user.id] : [ownerId]);
  }

  async addVehicle(user: AuthUser, v: { brand: string; model?: string; year?: number; plate?: string; trailerPlate?: string }) {
    if (user.owner_id) throw forbidden('Машины добавляет владелец');
    return this.db.one(
      `insert into vehicles(owner_id, brand, model, year, plate, trailer_plate) values ($1,$2,$3,$4,$5,$6) returning *`,
      [user.id, v.brand, v.model ?? null, v.year ?? null, v.plate?.toUpperCase() ?? null, v.trailerPlate?.toUpperCase() ?? null],
    );
  }

  async removeVehicle(user: AuthUser, id: string) {
    const r = await this.db.query('delete from vehicles where id=$1 and owner_id=$2 returning id', [id, user.id]);
    if (!r.length) throw notFound();
  }

  /** «Сменить водителя»: новый водитель входит по своему номеру и видит только эту машину */
  async assignDriver(owner: AuthUser, vehicleId: string, rawPhone: string | null) {
    const v = await this.db.one('select * from vehicles where id=$1 and owner_id=$2', [vehicleId, owner.id]);
    if (!v) throw notFound('Машина не найдена');
    if (!rawPhone) {
      await this.db.query('update vehicles set driver_id=null where id=$1', [vehicleId]);
      return { driverId: null };
    }
    const phone = normalizePhone(rawPhone);
    if (!phone) throw bad('bad_phone', 'Неверный номер');
    const driver = await this.db.one<{ id: string; owner_id: string | null }>(
      `insert into users(phone, roles, owner_id) values ($1, '{driver}', $2)
       on conflict (phone) do update set roles = (select array(select distinct unnest(users.roles || '{driver}'::text[])))
       returning id, owner_id`,
      [phone, owner.id],
    );
    if (driver!.owner_id && driver!.owner_id !== owner.id) throw bad('driver_taken', 'Этот номер уже водитель другого владельца');
    await this.db.query('update users set owner_id=$2 where id=$1', [driver!.id, owner.id]);
    await this.db.query('update vehicles set driver_id=$2 where id=$1', [vehicleId, driver!.id]);
    return { driverId: driver!.id };
  }
}
