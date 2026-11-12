import http from 'node:http';
import { WebSocketServer } from 'ws';
import { config } from './config.ts';
import { createDb } from './db/index.ts';
import { migrate } from './db/migrate.ts';
import { createApp, bearer } from './app.ts';
import { createSms } from './providers/sms.ts';
import { createPush } from './providers/push.ts';
import { MockProvider } from './payments/provider.ts';
import { YooKassaProvider } from './payments/yookassa.ts';
import { staticHandler } from './http/static.ts';
import { sendInsuranceReminders } from './services/insuranceReminders.ts';

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
  wss.handleUpgrade(req, socket, head, (ws) => {
    app.hub.add(user.id, ws);
    ws.send(JSON.stringify({ type: 'hello', userId: user.id }));
    const ping = setInterval(() => ws.readyState === 1 && ws.ping(), 25_000);
    ws.on('close', () => {
      clearInterval(ping);
      app.hub.remove(user.id, ws);
    });
  });
});

// Очередь вызовов: истёкшие → следующему
const timer = setInterval(() => {
  app.orders.tick().catch((e) => console.error('[tick]', e));
  app.auction.tick().catch((e) => console.error('[auction]', e));
}, 2_000);
// Запросы на удаление данных — раз в час
const hourly = setInterval(() => { app.privacy.processDeletions().catch((e) => console.error('[privacy]', e)); }, 3_600_000);

const insuranceReminderJob = () => sendInsuranceReminders(db, app.notifier).catch((e) => console.error('[insurance reminders]', e));
const insuranceReminderTimer = setInterval(insuranceReminderJob, 3_600_000);
insuranceReminderJob();

server.listen(config.port, () => console.log(`ТракSOS API: http://localhost:${config.port} (БД: ${db.driver})`));

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    clearInterval(timer);
    clearInterval(hourly);
    clearInterval(insuranceReminderTimer);
    server.close();
    await db.close();
    process.exit(0);
  });
}
