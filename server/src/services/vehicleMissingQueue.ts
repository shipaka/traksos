import type { Db } from '../db/index.ts';
import { bad, conflict, forbidden, notFound, type AuthUser } from '../http/router.ts';
import { categoriesForActor, type CatalogPurpose } from './publicVehicleDirectory.ts';
import type { VehicleCategory } from '../domain/vehicleReference.ts';

type Status = 'new' | 'reviewing' | 'accepted' | 'rejected';
export interface MissingVehicleInput {
  category: VehicleCategory;
  purpose: CatalogPurpose;
  make: string;
  model: string;
  year?: number | null;
  note?: string;
}
function checkText(value: string, min: number, max: number) {
  const s = typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/g, ' ') : '';
  if (s.length < min || s.length > max || /[\u0000-\u001f\u007f]/.test(s))
    throw bad('missing_vehicle_text', 'Укажите название марки и модели для рассмотрения');
  return s;
}
export class VehicleMissingQueue {
  constructor(private db: Db) {}

  async submit(user: AuthUser, input: MissingVehicleInput) {
    // No user-generated free text leaks into the normalized makes/models tables.
    const allowed = categoriesForActor(user, input.purpose, true);
    const trailerProposal = input.category === 'trailer' && ['garage','master','tow','service'].includes(input.purpose);
    if (!allowed.includes(input.category as any) && !trailerProposal) throw forbidden('Категория не подходит для вашей роли');
    const make = checkText(input.make, 2, 100), model = checkText(input.model, 2, 120);
    const year = input.year ?? null;
    if (year != null && (!Number.isInteger(year) || year < 1900 || year > 2100))
      throw bad('missing_vehicle_year', 'Неверный год');
    const note = (input.note ?? '').trim().slice(0, 1200);
    return this.db.tx(async (q) => {
      const quota = await q.one<{ count: number }>(
        "select count(*)::int as count from vehicle_catalog_missing_requests " +
        "where requested_by=$1 and created_at >= now() - interval '1 day'", [user.id]);
      if ((quota?.count ?? 0) >= 5) throw conflict('missing_vehicle_daily_limit', 'Можно отправить не больше пяти предложений за сутки');
      const row = await q.one<any>(
        'insert into vehicle_catalog_missing_requests ' +
        '(requested_by,category,purpose,proposed_make,proposed_model,proposed_year,note) ' +
        'values ($1,$2,$3,$4,$5,$6,$7) ' +
        'on conflict do nothing returning id,status,created_at',
        [user.id, input.category, input.purpose, make, model, year, note]);
      if (!row) throw conflict('missing_vehicle_already_submitted', 'Такая заявка уже ожидает проверки');
      await q.query('insert into audit_log(actor_id,action,target,data) values ($1,$2,$3,$4)',
        [user.id,'vehicle_catalog.missing_requested',row.id,
          { category: input.category,purpose:input.purpose,year }]);
      return { ...row, message: 'Заявка направлена на модерацию. Пока машина не появится в каталоге, свободный ввод недоступен.' };
    });
  }

  async mine(user: AuthUser) {
    if (!user || user.status !== 'active') throw forbidden();
    return this.db.query<any>(
      'select id,category,proposed_make as make,proposed_model as model,proposed_year as year,' +
      'status,moderation_note as reviewer_note,created_at from vehicle_catalog_missing_requests ' +
      'where requested_by=$1 order by created_at desc limit 100', [user.id]);
  }

  async queue(admin: AuthUser, status: Status | 'all' = 'new') {
    if (!admin.roles?.includes('admin')) throw forbidden('Очередь каталога видит только администратор');
    return this.db.query<any>(
      'select r.id,r.category,r.purpose,r.proposed_make as make,r.proposed_model as model,' +
      'r.proposed_year as year,r.note,r.status,r.created_at,u.name as author ' +
      'from vehicle_catalog_missing_requests r join users u on u.id=r.requested_by ' +
      'where ($1::text = \'all\' or r.status=$1) order by r.created_at,id limit 250', [status]);
  }

  async review(admin: AuthUser, id: string, status: Exclude<Status, 'new'>, note: string) {
    if (!admin.roles?.includes('admin')) throw forbidden('Решение принимает администратор');
    const reason = checkText(note, 10, 1200);
    return this.db.tx(async (q) => {
      const request = await q.one<{ id:string;status:Status }>(
        'select id,status from vehicle_catalog_missing_requests where id=$1 for update', [id]);
      if (!request) throw notFound('Заявка не найдена');
      if (request.status === 'accepted' || request.status === 'rejected')
        throw conflict('missing_vehicle_closed','Закрытая заявка не может быть незаметно переписана');
      const changed = await q.one<any>(
        'update vehicle_catalog_missing_requests set status=$2,moderation_note=$3,' +
        'moderated_by=$4,moderated_at=now(),updated_at=now() where id=$1 ' +
        'returning id,status,moderated_at',
        [id,status,reason,admin.id]);
      await q.query('insert into audit_log(actor_id,action,target,data) values ($1,$2,$3,$4)',
        [admin.id,'vehicle_catalog.missing_reviewed',id,{status,reason}]);
      return { ...changed,
        catalogUpdated: false,
        message: status==='accepted'
          ? 'Предложение принято к обработке. Для появления в каталоге требуется отдельное подтверждение источника.'
          : 'Решение записано в журнал' };
    });
  }
}
