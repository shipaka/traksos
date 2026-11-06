// Тестовые данные для стенда: админ, клиент с машинами, мастера (один — «первый в очереди»),
// эвакуаторщик — все проверены и на линии, по разным точкам СПб и ЛО. Черновики оферт.
// Повторный запуск ничего не дублирует. Запуск: npm -w server run seed

import { createDb } from './db/index.ts';
import { migrate } from './db/migrate.ts';
import { config } from './config.ts';

export const DEMO = {
  admin: '+79000000001',
  client: '+79000000002',
  company: '+79000000003',
  driver: '+79000000004',
  moderator: '+79000000005',
  masters: [
    { phone: '+79000000011', name: 'Дима (наш)', lat: 59.93, lng: 30.36, priority: true, brands: { Scania: 'excellent', DAF: 'excellent', Volvo: 'good' } },
    { phone: '+79000000012', name: 'Сергей', lat: 59.84, lng: 30.38, priority: false, brands: { Scania: 'good', MAN: 'excellent', КАМАЗ: 'excellent' } },
    { phone: '+79000000013', name: 'Олег', lat: 60.05, lng: 30.33, priority: false, brands: { Volvo: 'excellent', DAF: 'good', Renault: 'excellent' } },
    { phone: '+79000000014', name: 'Андрей (Тосно)', lat: 59.54, lng: 30.88, priority: false, brands: { Scania: 'good', DAF: 'good' } },
  ],
  tow: { phone: '+79000000021', name: 'Пётр, эвакуатор', lat: 59.88, lng: 30.45 },
  service: '+79000000031',
};

const DRAFT = (title: string) => `# ${title}

**ЧЕРНОВИК ДЛЯ ТЕСТОВОГО СТЕНДА — не юридический документ.** Итоговый текст готовит и проверяет юрист.

1. ТракSOS (ИП) — информационная площадка и агент исполнителя: принимает оплату за исполнителя и перечисляет её за вычетом вознаграждения.
2. Цена выезда и часа работы видна до вызова и не меняется. Время работы идёт с отметки исполнителя «на месте»: каждый начатый час считается полным (если площадка включила шаг 30 минут — каждые начатые полчаса). Ожидание запчасти — по ставке ожидания исполнителя, она видна до вызова.
3. Сверх выезда и времени исполнитель может выставить только расходные материалы и запчасти — каждой отдельной строкой. Клиент может оспорить только эти строки и только если работа выполнена.
4. Если работа выполнена, клиент оплачивает выезд и время по согласованной цене. Отказ от оплаты выполненной работы — нарушение договора: задолженность может быть взыскана в установленном законом порядке, аккаунт может быть заблокирован до оплаты. Если работа не выполнена — клиент указывает причину в приложении, спор разбирает поддержка.
5. Отмена: шкала по этапу (поиск — бесплатно; принял — 25% выезда; в пути — 50–100%; на месте — 100%).
6. Персональные данные обрабатываются в России, на серверах в РФ (152-ФЗ).
7. Изменения условий для исполнителей — с уведомлением не позже чем за 15 дней.
`;

export async function seed(db: Awaited<ReturnType<typeof createDb>>) {
  const user = async (phone: string, roles: string[], name: string, extra: Record<string, unknown> = {}) => {
    const u = await db.one<{ id: string }>(
      `insert into users(phone, roles, name, company_name, company_inn) values ($1,$2,$3,$4,$5)
       on conflict (phone) do update set roles=(select array(select distinct unnest(users.roles || excluded.roles))), name=excluded.name
       returning id`, [phone, roles, name, extra.company ?? null, extra.inn ?? null]);
    return u!.id;
  };
  await user(DEMO.admin, ['admin', 'client'], 'Администратор');
  const client = await user(DEMO.client, ['client'], 'Иван, дальнобойщик');
  const company = await user(DEMO.company, ['client'], 'Логист ООО «Северный путь»', { company: 'ООО «Северный путь»', inn: '7801234567' });
  for (const [owner, brand, model, year, plate] of [
    [client, 'Scania', 'R440', 2012, 'В777ОР178'], [company, 'DAF', 'XF105', 2015, 'А123ВС47'], [company, 'Volvo', 'FH', 2018, 'Е555КХ98'],
  ] as const) {
    await db.query(`insert into vehicles(owner_id, brand, model, year, plate) select $1,$2,$3,$4,$5
                    where not exists (select 1 from vehicles where plate=$5)`, [owner, brand, model, year, plate]);
  }
  // Водитель компании — закреплён за DAF А123ВС47 (как после входа по QR-наклейке)
  const driver = await user(DEMO.driver, ['client', 'driver'], 'Николай, водитель');
  await db.query('update users set owner_id=$2 where id=$1', [driver, company]);
  await db.query(`update vehicles set driver_id=$1, driver_since=coalesce(driver_since, now()) where plate='А123ВС47'`, [driver]);
  await user(DEMO.moderator, ['moderator'], 'Модератор');
  const performer = async (id: string, p: Record<string, unknown>) => {
    await db.query(
      `insert into performer_profiles(user_id, kind, specialties, brands, tier, is_priority, verification, line_status, lat, lng, location_at,
          tax_status, inn, car, prep_minutes, verified_at)
       values ($1,$2,$3,$4,'eco',$5,'approved','online',$6,$7,now(),'self_employed',$8,$9,$10,now())
       on conflict (user_id) do update set verification='approved', is_priority=excluded.is_priority, lat=excluded.lat, lng=excluded.lng`,
      [id, p.kind, p.specialties, p.brands ?? {}, p.priority ?? false, p.lat, p.lng, p.inn, p.car, p.prep ?? 0]);
  };
  for (const [i, m] of DEMO.masters.entries()) {
    const id = await user(m.phone, ['master'], m.name);
    await performer(id, { kind: 'master', specialties: ['electric', 'diag', 'air'], brands: m.brands, priority: m.priority, lat: m.lat, lng: m.lng,
      inn: `78000000001${i}`, car: { brand: 'Lada Largus', color: 'белый', plate: `А10${i}ВС78` } });
    await db.query('update users set rating=$2, rating_count=$3 where id=$1', [id, [4.9, 4.7, 4.5, 4.8][i], [42, 18, 7, 25][i]]);
  }
  const tow = await user(DEMO.tow.phone, ['tow'], DEMO.tow.name);
  await performer(tow, { kind: 'tow', specialties: [], lat: DEMO.tow.lat, lng: DEMO.tow.lng, inn: '780000000099', car: { brand: 'MAN TGS', plate: 'Т999ТТ78' }, prep: 15 });

  // Рембаза — проверена, видна клиентам
  const base = await user(DEMO.service, ['service'], 'Шушары-Трак');
  await db.query(
    `insert into service_centers(owner_id, name, address, lat, lng, hours, inn, brands, staff, conditions, accepts, verification, accepts_confirmed_at)
     values ($1, 'Шушары-Трак', 'Шушары, Московское ш., 50', 59.80, 30.38, '08:00–21:00', '7820000000', '{Scania,DAF,Volvo,MAN}',
       '{"electric":"own","air":"own","engine":"own","gearbox":"invite","brakes":"own","chassis":"own","tires":"none"}', '{parking,pit,night}', '{quick,day,long}', 'approved', now())
     on conflict (owner_id) do nothing`, [base]);

  // Ещё две рембазы для поиска по расстоянию: север и юг области
  for (const [phone, name, address, lat, lng, hours, brands, staff, cond, acc] of [
    ['+79000000032', 'Парнас-Дизель', 'Парнас, 4-й Верхний пер., 1', 60.07, 30.36, '00:00–23:59', '{Volvo,Renault,DAF}',
      '{"electric":"own","air":"own","engine":"invite","gearbox":"none","brakes":"own","chassis":"own","tires":"own"}', '{parking,lift,night}', '{quick,day}'],
    ['+79000000033', 'Гатчина-Трак', 'Гатчина, Промзона 2', 59.57, 30.12, '09:00–18:00', '{КАМАЗ,MAN,Scania}',
      '{"electric":"invite","air":"own","engine":"own","gearbox":"own","brakes":"own","chassis":"own","tires":"none"}', '{parking,pit}', '{day,long}'],
  ] as const) {
    const owner = await user(phone, ['service'], name);
    await db.query(
      `insert into service_centers(owner_id, name, address, lat, lng, hours, inn, brands, staff, conditions, accepts, verification, accepts_confirmed_at)
       values ($1,$2,$3,$4,$5,$6,null,$7,$8,$9,$10,'approved',now()) on conflict (owner_id) do nothing`,
      [owner, name, address, lat, lng, hours, brands, staff, cond, acc]);
  }

  // Магазин — товары для примера; сам магазин выключен, включается в админке
  for (const [cat, name, spec, price, stock, kit] of [
    ['kit', 'Тревожный чемоданчик', 'Розетка, перекидка, адаптер 7/15, предохранители, изолента', 450_000, 2, true],
    ['socket', 'Розетка 15-контактная', '24 В · ISO 12098', 120_000, 6, false],
    ['plug', 'Вилка 7-контактная', '24 В · металл', 65_000, 4, false],
    ['cable', 'Перекидка спиральная 15-конт.', '4,5 м', 210_000, null, false],
    ['fuse', 'Набор предохранителей', 'флажковые, 40 шт.', 35_000, 10, false],
  ] as const) {
    await db.query(`insert into shop_products(category, name, spec, price, stock, is_kit) select $1,$2,$3,$4,$5,$6
                    where not exists (select 1 from shop_products where name=$2)`, [cat, name, spec, price, stock, kit]);
  }

  for (const [audience, title] of [['client', 'Оферта для клиентов'], ['performer', 'Агентский договор для исполнителей и рембаз'], ['privacy', 'Согласие на обработку персональных данных']]) {
    // Новая редакция черновика — новой версией: на стенде её надо принять заново
    await db.query(`insert into offers(audience, version, body, summary, effective_at) select $1, '0.2-черновик', $2, 'Время работы — по таймеру с «на месте», сверху только расходники', now()
                    where not exists (select 1 from offers where audience=$1 and version='0.2-черновик')`, [audience, DRAFT(title)]);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = await createDb(config.databaseUrl);
  await migrate(db);
  await seed(db);
  console.log('Тестовые данные на месте. Входите по номерам:');
  console.log(`  админ ${DEMO.admin} · модератор ${DEMO.moderator} · клиент ${DEMO.client} · компания ${DEMO.company} · водитель компании ${DEMO.driver}`);
  console.log(`  мастера ${DEMO.masters.map((m) => m.phone).join(', ')} · эвакуатор ${DEMO.tow.phone} · рембазы ${DEMO.service}, +79000000032, +79000000033`);
  await db.close();
}
