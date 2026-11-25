import http from 'node:http';
import type { AddressInfo } from 'node:net';

process.env.ADMIN_PHONES = '+79990000001';
// Temporary historical-cash fixtures on disposable DB only; never enable on a VPS.
process.env.TRAKSOS_LEGACY_CASH_FIXTURES = '1';
process.env.TRAKSOS_SHOP_FIXTURES = '1';
process.env.TRAKSOS_PAYMENT_FIXTURES = '1';

const { createDb } = await import('../src/db/index.ts');
const { migrate } = await import('../src/db/migrate.ts');
const { createApp } = await import('../src/app.ts');
const { LogSms } = await import('../src/providers/sms.ts');
const { LogPush } = await import('../src/providers/push.ts');
const { MockProvider } = await import('../src/payments/provider.ts');

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5432/traksos_test';

export async function setup(opts?: { verifiedRoadEta?: import('../src/domain/progressiveSos.ts').VerifiedRoadEta }) {
  const db = await createDb(TEST_DB);
  await db.exec('drop schema public cascade; create schema public;');
  await migrate(db);
  let t = new Date('2026-12-01T09:00:00Z').getTime(); // 12:00 МСК, день
  const clock = { now: () => new Date(t), advance: (sec: number) => (t += sec * 1000), set: (iso: string) => (t = new Date(iso).getTime()) };
  const sms = new LogSms();
  const push = new LogPush();
  const payments = new MockProvider('http://test');
  const app = createApp({ db, sms, push, payments, now: clock.now, verifiedRoadEta: opts?.verifiedRoadEta });
  app.hub.keepLog = true;
  // В тестах исполнителей одобряем без фото; проверка с фото — в documents.test.ts
  await app.settings.set('verification', { requireDocs: false }, null);
  const server = http.createServer((req, res) => void app.handle(req, res));
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // Legacy integration fixtures are explicitly located in the pilot region.
  // This enrichment exists ONLY in the test helper, never in production API.
  // Raw fetch tests prove that omitting regionId from the real API is rejected.
  function withPilotSiteFixture(method: string, path: string, body: unknown) {
    if (method !== 'POST' || !['/api/orders', '/api/pricing/estimate'].includes(path) ||
        !body || typeof body !== 'object' || Array.isArray(body)) return body;
    const data = body as Record<string, any>;
    if (data.service === 'consult') return data;
    const zoneId = data.zoneId ?? 'spb';
    const named: Record<string, string> = {
      spb: 'Санкт-Петербург, тестовый адрес 1',
      kad30: 'Ленинградская область, тестовая стоянка за КАД',
      gat: 'Гатчина, улица Ленина',
      tos: 'Тосно, улица Ленина',
      vyb: 'Выборг, улица Ленина',
      lug: 'Луга, улица Ленина',
      kir: 'Кириши, улица Ленина',
      ust: 'Усть-Луга, тестовый адрес',
    };
    return {
      ...data,
      zoneId,
      regionId: data.regionId ?? (zoneId === 'spb' ? 'spb' : 'lo'),
      ...(path === '/api/orders' && data.lat == null && data.lng == null && !data.address
        ? { address: named[zoneId] ?? 'Санкт-Петербург, тестовый адрес 1' } : {}),
    };
  }

  async function api(method: string, path: string, body?: unknown, token?: string) {
    const fixtureBody = withPilotSiteFixture(method, path, body);
    const r = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: fixtureBody === undefined ? undefined : JSON.stringify(fixtureBody),
    });
    const j: any = await r.json().catch(() => null);
    return { status: r.status, body: j };
  }

  async function login(phone: string, role?: string) {
    const c = await api('POST', '/api/auth/code', { phone });
    if (c.status !== 200) throw new Error(JSON.stringify(c.body));
    const v = await api('POST', '/api/auth/verify', { phone, code: c.body.devCode, role });
    if (v.status !== 200) throw new Error(JSON.stringify(v.body));
    clock.advance(61); // следующий код — через минуту
    return { token: v.body.token as string, id: v.body.user.id as string };
  }

  async function close() {
    server.close();
    await db.close();
  }

  return { db, app, api, login, clock, sms, push, payments, close, base };
}

export type T = Awaited<ReturnType<typeof setup>>;

/** Ok-ответ или исключение с телом ошибки */
export function ok<R extends { status: number; body: any }>(r: R): any {
  if (r.status !== 200) throw new Error(`HTTP ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body;
}
