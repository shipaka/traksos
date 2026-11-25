// Все настройки окружения в одном месте. Значения по умолчанию — для локальной разработки.

const env = process.env;

export const config = {
  env: env.NODE_ENV ?? 'development',
  port: Number(env.PORT ?? 8080),
  buildRevision: env.TRAKSOS_BUILD_REV ?? 'unknown',
  /** Trust X-Forwarded-For only from our private reverse proxy, never from direct clients. */
  trustProxy: env.TRUST_PROXY === 'true',
  databaseUrl: env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5432/traksos',
  /** Секрет для хэшей кодов и токенов. В production обязателен. */
  secret: env.APP_SECRET ?? 'dev-secret-change-me',
  /** Откуда разрешены запросы браузера (веб-приложение). */
  corsOrigins: (env.CORS_ORIGINS ?? '*').split(','),
  publicUrl: env.PUBLIC_URL ?? 'http://localhost:8080',
  /** Full-fidelity role preview runs on another origin AND another PostgreSQL database. */
  sandboxInstance: env.SANDBOX_INSTANCE === 'true',
  sandboxUrl: (env.SANDBOX_URL ?? '').replace(/\/+$/, ''),
  sandboxSharedSecret: env.SANDBOX_SHARED_SECRET ?? '',

  /** Собранное веб-приложение */
  webRoot: env.WEB_ROOT ?? new URL('../../web/dist', import.meta.url).pathname,
  /** Номера, которые при входе сразу получают роль администратора */
  adminPhones: (env.ADMIN_PHONES ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  /** Dedicated, non-administrator moderator phone allowlist (private VPS .env only). */
  moderatorPhones: (env.MODERATOR_PHONES ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  /** Contact information only. This phone NEVER grants access or recovery by itself. */
  recoveryContactPhone: env.RECOVERY_CONTACT_PHONE ?? '',
  /** Exactly one initial insurance agent's phone. Stored only in VPS .env. */
  insurerPrimaryPhone: env.INSURER_PRIMARY_PHONE ?? '',

  // Optional private notification endpoint. Never send personal report text to this channel.
  developerReports: {
    webhookUrl: env.DEVELOPER_REPORT_WEBHOOK_URL ?? '',
    webhookSecret: env.DEVELOPER_REPORT_WEBHOOK_SECRET ?? '',
  },
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
  trakbot: {
    // Legal/privacy review and provider configuration required before production rollout.
    // Both switches are required: no network inference is enabled by accident.
    llmEnabled: env.TRAKBOT_LLM_ENABLED === 'true' &&
      (env.TRAKBOT_LLM_TRANSPORT === 'api' || env.TRAKBOT_LLM_TRANSPORT === 'local'),
    llmTransport: env.TRAKBOT_LLM_TRANSPORT === 'api' || env.TRAKBOT_LLM_TRANSPORT === 'local'
      ? env.TRAKBOT_LLM_TRANSPORT : 'off',
    llmApiKey: env.TRAKBOT_LLM_API_KEY ?? '',
    llmModel: env.TRAKBOT_LLM_MODEL ?? 'gpt-4.1-mini',
    // Loopback only; use an SSH tunnel or local proxy for an independent GPU node.
    llmLocalUrl: env.TRAKBOT_LLM_LOCAL_URL ?? 'http://127.0.0.1:8000/v1/chat/completions',
  },
  /** Tochka business invoice documents: entirely separate from live payment processing. */
  tochkaInvoices: {
    enabled: env.TOCHKA_INVOICE_ENABLED === 'true',
    token: env.TOCHKA_API_TOKEN ?? '',
    customerCode: env.TOCHKA_CUSTOMER_CODE ?? '',
    accountId: env.TOCHKA_ACCOUNT_ID ?? '',
  },
  payments: {
    /** Only a mock provider is valid until a NEW, separately tested Tochka settlement rail is approved. */
    provider: 'mock' as const,
  },
};

export const isProd = config.env === 'production';

if (isProd && config.secret === 'dev-secret-change-me') {
  throw new Error('APP_SECRET не задан');
}

// Refuse to start the sandbox unless it is physically separate from production.
// The sandbox never contacts SMS.ru, RuStore Push or a real payment provider.
if (config.sandboxInstance && config.tochkaInvoices.enabled)
  throw new Error('Real Tochka invoice API is forbidden in the isolated sandbox');
if (config.sandboxInstance) {
  const dbName = new URL(config.databaseUrl).pathname.replace(/^\//, '').toLowerCase();
  if (!dbName.includes('sandbox') || !env.DATABASE_URL)
    throw new Error('SANDBOX_INSTANCE requires its own explicit *sandbox* PostgreSQL database');
  if (config.sms.provider !== 'log' || config.push.provider !== 'log' ||
      config.payments.provider !== 'mock' || config.trakbot.llmEnabled)
    throw new Error('Sandbox external integrations and TrakBot AI must be disabled (log/log/mock/LLM off)');
  if (config.sandboxSharedSecret.length < 32)
    throw new Error('Sandbox shared secret is missing');
  if (!config.adminPhones.includes('+79000000001') ||
      !config.moderatorPhones.includes('+79000000005'))
    throw new Error('Sandbox must use ONLY the fixed fictitious admin/moderator allowlists');
}
if (config.sandboxUrl) {
  const target = new URL(config.sandboxUrl);
  const production = new URL(config.publicUrl);
  if (isProd && (target.protocol !== 'https:' || target.origin === production.origin))
    throw new Error('SANDBOX_URL must use a separate HTTPS origin');
  if (config.sandboxSharedSecret.length < 32)
    throw new Error('SANDBOX_SHARED_SECRET is required with SANDBOX_URL');
}

// Fail closed on an obsolete provider setting rather than silently connecting a bank
// or treating a formerly live merchant credential as approved after deployment.
if (env.PAYMENT_PROVIDER && env.PAYMENT_PROVIDER !== 'mock') {
  throw new Error('Устаревший PAYMENT_PROVIDER отключён. Реальные платежи через Точку ещё не подключены.');
}
