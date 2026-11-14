import http from 'node:http';
import { WebSocketServer } from 'ws';
import { config } from './config.ts';
import { createDb } from './db/index.ts';
import { migrate } from './db/migrate.ts';
import { createApp, bearer } from './app.ts';
import { createSms } from './providers/sms.ts';
import { sendInsuranceReminders } from './services/insuranceReminders.ts';
import { createPush } from './providers/push.ts';
import { MockProvider } from './payments/provider.ts';
import { YooKassaProvider } from './payments/yookassa.ts';
import { staticHandler } from './http/static.ts';

const db = await createDb(config.databaseUrl);
const applied = await migrate(db);
if (applied.length) console.log('Миграции:', applied.join(', '));

const payments = config.payments.provider === 'yookassa'
  ? new YooKassaProvider(config.payments.yookassaShopId, config.payments.yookassaSecretKey, config.payments.yookassaAgentId, config.payments.yookassaPayoutKey)
  : new MockProvider(config.publicUrl);

const app = createApp({ db, sms: createSms(), push: createPush(), payments });

const serveWeb = staticHandler(config.webRoot);
const server = http.createServer((req, res) => {
  const p = (req.url ?? '/').split('?')[0];
  if (p.startsWith('/api/') || req.method !== 'GET' && req.method !== 'HEAD') return void app.handle(req, res);
  return void serveWeb(req, res);
});

// WebSocket: /ws?token=... — статусы, чат, входящие вызовы
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', async (req, socket, head) => {
  if (!req.url?.startsWith('/ws')) return socket.destroy();
  const user = await app.auth.authenticate(bearer(req));
  if (!user) return socket.destroy();
  const previewUntil = user.roles.includes('admin')
    ? (await db.one<{ admin_preview_until: Date | null }>('select admin_preview_until from users where id=$1', [user.id]))?.admin_preview_until ?? null
    : null;
  wss.handleUpgrade(req, socket, head, (ws) => {
    app.hub.add(user.id, ws);
    ws.send(JSON.stringify({ type: 'hello', userId: user.id }));
    const ping = setInterval(() => ws.readyState === 1 && ws.ping(), 25_000);
    // A preview login must not keep receiving staff notifications after expiry.
    const previewTimer = previewUntil
      ? setTimeout(() => ws.close(1008, 'Preview expired'), Math.max(0, new Date(previewUntil).getTime() - Date.now()))
      : null;
    ws.on('close', () => {
      clearInterval(ping);
      if (previewTimer) clearTimeout(previewTimer);
      app.hub.remove(user.id, ws);
    });
  });
});

// Очередь вызовов: истёкшие → следующему
const timer = setInterval(() => {
  app.orders.tick().catch((e) => console.error('[tick]', e));
  app.auction.tick().catch((e) => console.error('[auction]', e));
}, 2_000);
// Отложенное удаление личных данных и очистка истёкших IP/телефонных
// лимитов: хранить эти технические идентификаторы бессрочно не нужно.
const housekeeping = async () => {
  await Promise.allSettled([
    app.privacy.processDeletions().catch((e) => console.error('[privacy]', e)),
    sendInsuranceReminders(db, app.notifier).catch((e) => console.error('[insurance reminders]', e)),
    db.query("delete from auth_sms_limits where bucket < now() - interval '48 hours'")
      .catch((e) => console.error('[sms-quota-cleanup]', e)),
    db.query("delete from auth_login_attempts where window_start < now() - interval '24 hours'")
      .catch((e) => console.error('[login-quota-cleanup]', e)),
  ]);
};
const hourly = setInterval(() => { void housekeeping(); }, 3_600_000);

// Recover durable capture-intents after restart or an ambiguous bank response.
// Never repeat a previously sent capture: reconciliation uses provider GET.
const captureReconcile = () => app.payments.reconcileCaptures()
  .catch((e) => console.error('[capture-reconciliation]', e));
const captureTimer = setInterval(() => { void captureReconcile(); }, 30_000);
void captureReconcile();

server.listen(config.port, () => console.log(`ТракSOS API: http://localhost:${config.port} (БД: ${db.driver})`));

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    clearInterval(timer);
    clearInterval(hourly);
    server.close();
    await db.close();
    process.exit(0);
  });
}
