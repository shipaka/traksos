import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { setup, ok, type T } from './helpers.ts';

let t: T;
let admin: any, master: any, other: any, client: any;

/** «Фото»: случайные байты с заголовком JPEG — для сервера это картинка нужного размера */
const photo = (seed = randomBytes(20_000)) => 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), seed]).toString('base64');

before(async () => {
  t = await setup();
  await t.app.settings.set('verification', { requireDocs: true }, null);
  admin = await t.login('+79990000001');
  master = await t.login('+79995550001', 'master');
  other = await t.login('+79995550002', 'master');
  client = await t.login('+79995550003');
  for (const u of [master, other]) ok(await t.api('PUT', '/api/performer/profile', { kind: 'master', name: 'Мастер', specialties: ['electric', 'diag'] }, u.token));
});
after(() => t.close());

test('без фото одобрить нельзя; список нужного зависит от специальности', async () => {
  const st = ok(await t.api('GET', '/api/performer/documents', undefined, master.token));
  assert.deepEqual(st.required.map((r: any) => r.kind), ['passport', 'selfie', 'car_front', 'car_side', 'equipment'], 'диагносту — ещё оборудование');
  assert.equal(st.complete, false);
  assert.equal((await t.api('POST', '/api/performer/documents/submit', {}, master.token)).body.error, 'incomplete');
  assert.equal((await t.api('POST', `/api/admin/performers/${master.id}/verify`, { decision: 'approved' }, admin.token)).body.error, 'docs_missing');
});

test('загрузка, шифрование, доступ: владелец и модератор видят, остальные — нет; просмотр модератором в журнале', async () => {
  const shared = randomBytes(20_000);
  const ids: Record<string, string> = {};
  for (const kind of ['passport', 'selfie', 'car_front', 'car_side', 'equipment']) {
    ids[kind] = ok(await t.api('POST', '/api/performer/documents', { kind, dataUrl: photo(kind === 'car_front' ? shared : undefined), takenAt: t.clock.now().toISOString() }, master.token)).id;
  }
  // В базе — не исходное фото
  const raw = await t.db.one(`select data from documents where id=$1`, [ids.passport]);
  assert.ok(!String(raw!.data).includes('ffd8ff'), 'фото хранится зашифрованным');

  // доступ проверяем через сервис напрямую (тестовый api отдаёт только JSON)
  const ownerFile = await t.app.documents.file({ id: master.id, roles: ['master'] } as any, ids.passport);
  assert.equal(ownerFile.body.subarray(0, 3).toString('hex'), 'ffd8ff', 'владелец получает исходное фото');
  await assert.rejects(t.app.documents.file({ id: client.id, roles: ['client'] } as any, ids.passport), /Нет доступа/);
  await t.app.documents.file({ id: admin.id, roles: ['admin'] } as any, ids.passport);
  const log = await t.db.query(`select action from audit_log where action='document.view' and target=$1`, [ids.passport]);
  assert.equal(log.length, 1);

  // Другой мастер загрузил то же фото машины — модератор увидит отметку
  ok(await t.api('POST', '/api/performer/documents', { kind: 'car_front', dataUrl: photo(shared) }, other.token));
  ok(await t.api('POST', '/api/performer/documents/submit', {}, master.token));
  const queue = ok(await t.api('GET', '/api/admin/verification', undefined, admin.token));
  const me = queue.find((q: any) => q.id === master.id);
  assert.ok(me.flags.some((f: string) => f.includes('другом профиле')));
  assert.ok(me.flags.some((f: string) => f.includes('ИНН')));

  // «Переснимите» — с причиной; мастер видит её и может переснять
  assert.equal((await t.api('POST', `/api/admin/documents/${ids.car_front}`, { status: 'rejected' }, admin.token)).body.error, 'note_required');
  ok(await t.api('POST', `/api/admin/documents/${ids.car_front}`, { status: 'rejected', note: 'Номер не читается' }, admin.token));
  const st = ok(await t.api('GET', '/api/performer/documents', undefined, master.token));
  assert.equal(st.required.find((r: any) => r.kind === 'car_front').doc.note, 'Номер не читается');
  assert.equal(st.complete, false);
  const newId = ok(await t.api('POST', '/api/performer/documents', { kind: 'car_front', dataUrl: photo() }, master.token)).id;

  // Приняли всё — одобряем; исполнитель может выйти на линию
  for (const id of [ids.passport, ids.selfie, ids.car_side, ids.equipment, newId]) ok(await t.api('POST', `/api/admin/documents/${id}`, { status: 'approved' }, admin.token));
  ok(await t.api('POST', `/api/admin/performers/${master.id}/verify`, { decision: 'approved' }, admin.token));
  ok(await t.api('POST', '/api/performer/line', { lineStatus: 'online' }, master.token));

  // Сменил машину — снова на проверку и с линии не пропадает, но новые заявки ждут одобрения
  ok(await t.api('POST', '/api/performer/documents', { kind: 'car_side', dataUrl: photo() }, master.token));
  assert.equal(ok(await t.api('GET', '/api/performer/profile', undefined, master.token)).verification, 'pending');
});

test('плохие файлы отбиваются', async () => {
  assert.equal((await t.api('POST', '/api/performer/documents', { kind: 'passport', dataUrl: 'data:application/pdf;base64,AAAA' }, other.token)).body.error, 'bad_image');
  assert.equal((await t.api('POST', '/api/performer/documents', { kind: 'passport', dataUrl: 'data:image/jpeg;base64,' + Buffer.alloc(100).toString('base64') }, other.token)).body.error, 'too_small');
  assert.equal((await t.api('POST', '/api/performer/documents', { kind: 'diploma', dataUrl: photo() }, other.token)).body.error, 'bad_kind');
  assert.equal((await t.api('POST', '/api/performer/documents', { kind: 'passport', dataUrl: photo() }, client.token)).body.error, 'no_profile');
});
