// Все настройки окружения в одном месте. Значения по умолчанию — для локальной разработки.

const env = process.env;

export const config = {
  env: env.NODE_ENV ?? 'development',
  port: Number(env.PORT ?? 8080),
  databaseUrl: env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5432/traksos',
  /** Секрет для хэшей кодов и токенов. В production обязателен. */
  secret: env.APP_SECRET ?? 'dev-secret-change-me',
  /** Откуда разрешены запросы браузера (веб-приложение). */
  corsOrigins: (env.CORS_ORIGINS ?? '*').split(','),
  publicUrl: env.PUBLIC_URL ?? 'http://localhost:8080',
  /** Собранное веб-приложение */
  webRoot: env.WEB_ROOT ?? new URL('../../web/dist', import.meta.url).pathname,
  /** Номера, которые при входе сразу получают роль администратора */
  adminPhones: (env.ADMIN_PHONES ?? '').split(',').map((s) => s.trim()).filter(Boolean),

  sms: {
    /** log — код пишется в лог и возвращается в ответе (только не в production); smsru — SMS.ru */
    provider: (env.SMS_PROVIDER ?? 'log') as 'log' | 'smsru',
    smsruApiId: env.SMSRU_API_ID ?? '',
  },
  push: {
    /** log — только запись в базу; rustore — RuStore Push */
    provider: (env.PUSH_PROVIDER ?? 'log') as 'log' | 'rustore',
    rustoreProjectId: env.RUSTORE_PROJECT_ID ?? '',
    rustoreServiceToken: env.RUSTORE_SERVICE_TOKEN ?? '',
  },
  payments: {
    /** mock — тестовый сервис; yookassa — ЮKassa. Включение оплаты — в настройках площадки. */
    provider: (env.PAYMENT_PROVIDER ?? 'mock') as 'mock' | 'yookassa',
    yookassaShopId: env.YOOKASSA_SHOP_ID ?? '',
    yookassaSecretKey: env.YOOKASSA_SECRET_KEY ?? '',
    yookassaAgentId: env.YOOKASSA_AGENT_ID ?? '',
    yookassaPayoutKey: env.YOOKASSA_PAYOUT_KEY ?? '',
  },
};

export const isProd = config.env === 'production';

if (isProd && config.secret === 'dev-secret-change-me') {
  throw new Error('APP_SECRET не задан');
}
