import http from 'node:http';
import { config } from './config.ts';
import { createDb } from './db/index.ts';
import { migrate } from './db/migrate.ts';
import { createApp } from './app.ts';
import { createSms } from './providers/sms.ts';
import { sendInsuranceReminders } from './services/insuranceReminders.ts';
import { createPush } from './providers/push.ts';
import { MockProvider } from './payments/provider.ts';
import { YooKassaProvider } from './payments/yookassa.ts';
import { staticHandler } from './http/static.ts';
import { PublicWeatherService } from './services/publicWeather.ts';
import { attachRealtimeGateway } from './realtime/gateway.ts';

const db = await createDb(config.databaseUrl);
const applied = await migrate(db);
if (applied.length) console.log('Миграции:', applied.join(', '));

const payments = config.payments.provider === 'yookassa'
  ? new YooKassaProvider(config.payments.yookassaShopId, config.payments.yookassaSecretKey, config.payments.yookassaAgentId, config.payments.yookassaPayoutKey)
  : new MockProvider(config.publicUrl);

const app = createApp({ db, sms: createSms(), push: createPush(), payments });

const serveWeb = staticHandler(config.webRoot);
const publicWeather = new PublicWeatherService();
const server = http.createServer((req, res) => {
  const p = (req.url ?? '/').split('?')[0];
  if (p === '/api/public/weather' && (req.method === 'GET' || req.method === 'HEAD')) {
    // Lightweight public endpoint: never expose the Yandex key, raw upstream response or device location.
    void publicWeather.current().then(observation => {
      if (res.destroyed) return;
      res.statusCode = observation ? 200 : 503;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'public, max-age=60');
      res.setHeader('x-content-type-options', 'nosniff');
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(observation ?? { available: false }));
    }).catch(() => {
      if (res.destroyed) return;
      res.statusCode = 503;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(req.method === 'HEAD' ? undefined : '{"available":false}');
    });
    return;
  }
  if (p.startsWith('/api/') || req.method !== 'GET' && req.method !== 'HEAD') return void app.handle(req, res);
  return void serveWeb(req, res);
});

// Both existing APKs and new one-use-ticket clients remain compatible.
// Legacy URL token support is a *temporary* release gate tracked by #115.
attachRealtimeGateway(server,app,db);

// Очередь вызовов: истёкшие → следующему
const timer = setInterval(() => {
  app.orders.tick().catch((e) => console.error('[tick]', e));
  app.auction.tick().catch((e) => console.error('[auction]', e));
}, 2_000);
// First human response deadline, one durable overdue notification at 60 min.
// Database row locks and event uniqueness protect multi-instance operation.
const supportSlaTimer = setInterval(() => {
  app.support.tickSla().catch((e) => console.error('[support-sla]', e));
}, 30_000);
void app.support.tickSla().catch((e) => console.error('[support-sla]', e));
// Durable emergency handoff SLA: reminder and manual review only, never financial completion.
const unilateralSlaTimer=setInterval(()=>{
  void app.unilateral.tickSla().catch(e=>console.error('[unilateral-sla]',e));
},60_000);
void app.unilateral.tickSla().catch(e=>console.error('[unilateral-sla]',e));

// Background delivery is durable across restarts. Missing webhook config keeps reports
// in the internal admin queue; it never silently sends personal data externally.
const developerDeliveryTimer = setInterval(() => {
  void app.developerReportDelivery.tick().catch(() => console.error('[developer-delivery] retry scheduled'));
}, 30_000);
void app.developerReportDelivery.tick().catch(() => console.error('[developer-delivery] retry scheduled'));
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
    db.query("delete from realtime_ws_tickets where expires_at < now() - interval '1 minute'")
      .catch((e) => console.error('[ws-ticket-cleanup]', e)),
    db.query("delete from diagnostic_events where occurred_at < now() - interval '30 days'")
      .catch((e) => console.error('[diagnostics-cleanup]', e)),
    // GPS coordinates are sensitive; retain the minimal route evidence for
    // 30 days, not indefinitely. Future legal holds need a separate policy.
    db.query("delete from performer_route_samples where received_at < now() - interval '30 days'")
      .catch((e) => console.error('[gps-history-cleanup]', e)),
  ]);
};
const hourly = setInterval(() => { void housekeeping(); }, 3_600_000);

// Recover durable capture-intents after restart or an ambiguous bank response.
// Never repeat a previously sent capture: reconciliation uses provider GET.
const captureReconcile = () => Promise.all([
  app.payments.reconcileCaptures(),
  app.payments.reconcileCancellations(),
  app.payments.reconcileWorkCreations(),
  app.payments.reconcileCancelledHolds(),
]).catch((e) => console.error('[payment-reconciliation]', e));
const captureTimer = setInterval(() => { void captureReconcile(); }, 30_000);
void captureReconcile();

server.listen(config.port, () => console.log(`TrakSOS API: http://localhost:${config.port} (БД: ${db.driver})`));

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    clearInterval(timer);
    clearInterval(hourly);
    clearInterval(captureTimer);
    clearInterval(supportSlaTimer);
    clearInterval(unilateralSlaTimer);
    clearInterval(developerDeliveryTimer);
    server.close();
    await db.close();
    process.exit(0);
  });
}
