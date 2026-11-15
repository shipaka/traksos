// ONLY run on an isolated sandbox instance and database, never the primary site.
// The same real UI and backend logic use these fictitious accounts.
import type { Db } from './db/index.ts';
import { seed } from './seed.ts';
import { SANDBOX_USER_PHONE } from './services/sandboxTickets.ts';

export async function seedSandbox(db: Db) {
  await seed(db);
  const upsert = async (phone: string, roles: string[], name: string) => {
    const u = await db.one<{id:string}>(`insert into users(phone,roles,name) values ($1,$2::text[],$3)
      on conflict (phone) do update set roles=excluded.roles returning id`, [phone, roles, name]);
    if (!u) throw new Error('sandbox fixture account missing');
    return u.id;
  };
  const combined = await upsert(SANDBOX_USER_PHONE.master_service, ['master','service'], 'Демо · мастер и СТО');
  await db.query(`insert into performer_profiles(user_id,kind,verification,line_status,specialties,brands,car,cars,tax_status,inn,verified_at)
    values ($1,'master','approved','online',array['electric','diag'],'{}'::jsonb,
      '{"brand":"Lada Largus","plate":"А999АА78"}'::jsonb,
      '[{"brand":"Lada Largus","plate":"А999АА78"}]'::jsonb,
      'self_employed','780000000050',now())
    on conflict (user_id) do nothing`, [combined]);
  await db.query(`insert into service_centers(owner_id,name,address,hours,verification,brands,staff,conditions,accepts,accepts_confirmed_at)
    values ($1,'Учебная мастерская','Санкт-Петербург · учебный адрес','08:00–21:00','approved',
      array['Scania','DAF'],'{"electric":"own"}'::jsonb,
      array['parking'],array['quick'],now())
    on conflict (owner_id) do nothing`, [combined]);
  await upsert(SANDBOX_USER_PHONE.insurer, ['insurer'], 'Демо · страховой партнёр');
  await upsert(SANDBOX_USER_PHONE.inspection, ['inspection_operator'], 'Демо · техосмотр');
}
