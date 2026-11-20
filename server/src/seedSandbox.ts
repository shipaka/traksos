// ONLY run on an isolated sandbox instance and database, never the primary site.
// The same real UI and backend logic use these fictitious accounts.
import type { Db } from './db/index.ts';
import { seed } from './seed.ts';
import { SANDBOX_USER_PHONE } from './services/sandboxTickets.ts';
import { config } from './config.ts';
import { createDb } from './db/index.ts';
import { migrate } from './db/migrate.ts';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export async function seedSandbox(db: Db) {
  if (!config.sandboxInstance) throw new Error('Refusing to seed outside SANDBOX_INSTANCE');
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
  const courierId = await upsert(SANDBOX_USER_PHONE.courier, ['courier'], 'Демо · курьер запчастей');

  // Only the isolated sandbox receives a synthetic, preassigned delivery.
  // It is not a public shop purchase, never charges anyone, and enables
  // testing the real courier detail flow rather than a decorative placeholder.
  const [buyer,dispatcher]=await Promise.all([
    db.one<{id:string}>('select id from users where phone=$1',[SANDBOX_USER_PHONE.client]),
    db.one<{id:string}>('select id from users where phone=$1',[SANDBOX_USER_PHONE.admin]),
  ]);
  if(!buyer||!dispatcher)throw new Error('Sandbox synthetic courier buyer/admin are missing');
  const marker='TRAKSOS_SANDBOX_COURIER_SAMPLE_20261120';
  let sample=await db.one<{id:string}>('select id from shop_orders where comment=$1',[marker]);
  if(!sample){
    const product=await db.one<{id:string}>(`insert into shop_products
      (category,name,spec,price,stock,lead_days,active)
      values ('brakes','Учебный комплект тормозных колодок','Тестовый товар — не продаётся',0,0,0,false)
      returning id`);
    if(!product)throw new Error('Sandbox courier product seed missing');
    sample=await db.one<{id:string}>(`insert into shop_orders
      (client_id,created_by,status,items,goods_total,delivery,delivery_price,total,
       address,payment,comment)
      values ($1,$1,'ready',$2::jsonb,0,'delivery',0,0,$3,'on_receipt',$4)
      returning id`,[buyer.id,JSON.stringify([{productId:product.id,
        name:'Учебный комплект тормозных колодок',qty:1,price:0,inStock:false}]),
        'Санкт-Петербург, учебный адрес доставки, дом 1',marker]);
  }
  if(!sample)throw new Error('Sandbox courier order seed missing');
  await db.query(`insert into shop_courier_deliveries
    (shop_order_id,courier_id,assigned_by) values ($1,$2,$3)
    on conflict(shop_order_id) do nothing`,[sample.id,courierId,dispatcher.id]);
  await db.query(`insert into shop_courier_presence(courier_id,online)
    values ($1,true) on conflict(courier_id) do nothing`,[courierId]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (!config.sandboxInstance) throw new Error('Refusing to seed outside SANDBOX_INSTANCE');
  const db = await createDb(config.databaseUrl);
  try {
    await migrate(db);
    await seedSandbox(db);
    console.log('Отдельная тестовая база подготовлена');
  } finally {
    await db.close();
  }
}
