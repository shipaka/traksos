// TrakSOS release gate: prevent obsolete BUSINESS rules from returning in a new merge.
// Historical orders/ledger, SQL migrations, and legal retention are intentionally untouched.
import { readFileSync, existsSync } from 'node:fs';

const errors = [];
const file = (path) => readFileSync(path,'utf8');
const check=(pass,msg)=>{if(!pass){errors.push(msg);console.error('FAIL '+msg)}else console.log('OK '+msg)};
const defaults=file('server/src/domain/defaults.ts');
const config=file('server/src/config.ts');
const server=file('server/src/main.ts');
const settings=file('server/src/services/settings.ts');
const payments=file('server/src/payments/service.ts');
const orders=file('server/src/services/orders.ts');
const client=file('web/src/screens/client.tsx');
const guide=file('server/src/domain/economicsGuide.ts');
const shop=file('web/src/screens/shop.tsx');
const policy=file('server/src/domain/paymentPolicy.ts');
const approved=file('docs/ACTIVE_SOURCE_OF_TRUTH_2026-11-20.md');
const readme=file('README.md');
check(approved.includes('19 ноября')&&approved.includes('Точка')&&/наличн/i.test(approved),
  'single 19 Nov canon and current settlement policy are documented');
check(readme.includes('ACTIVE_SOURCE_OF_TRUTH_2026-11-20.md'),
  'README starts at current source, not a historical conversation');
for(const path of ['NEXT_CHAT_TRACKSOS.md','docs/CONTINUE_NEXT_CHAT.md','docs/NEXT.md','docs/WORKBOARD.md']){
  const s=file(path);
  check(s.includes('ACTIVE_SOURCE_OF_TRUTH_2026-11-20.md') && !s.includes('YOOKASSA_') && !s.includes('ЮKassa'),
    'historical starting point redirected: '+path);
}
check(!existsSync('server/src/payments/yookassa.ts'),
  'retired bank adapter is physically absent');
check(!server.includes('YooKassaProvider') && server.includes('new MockProvider('),
  'no obsolete payment provider can be loaded by main');
check(!config.includes('YOOKASSA_') && config.includes("env.PAYMENT_PROVIDER !== 'mock'"),
  'unsupported payment provider fails closed even if old environment survives');
check(!file('deploy/.env.example').includes('YOOKASSA_'),
  'new deployments do not request credentials for abandoned provider');
check(/cash:\s*false/.test(defaults) && /enabled:\s*false/.test(defaults),
  'cash checkout and public shop start disabled');
check(settings.includes('merged.payments.cash = legacyCashFixtureEnabled()') &&
      settings.includes('merged.shop.enabled = shopFixtureEnabled()'),
  'old saved database settings cannot re-enable cash or public store');
check(settings.includes("key === 'payments'") && settings.includes("key === 'shop'"),
  'old admin settings cannot re-open retired business flows');
check(payments.includes("'payment_method_retired'") && payments.includes('legacyCashFixtureEnabled()'),
  'new cash requests rejected at backend, not hidden only in CSS');
check(orders.includes("legacyCashFixtureEnabled() ? 'cash' : 'online'"),
  'old clients no longer default to cash in production');
check(client.includes('methods?.cash &&') && !client.includes('Мастеру на месте</button>') &&
      client.includes('!methods?.[method]'),
  'new order checkout does not offer retired cash or replay a disabled offline draft');
check(!shop.includes("'Магазин открыт'") && shop.includes('Магазин закрыт до приёмки'),
  'admin cannot claim to open an unreleased parts store');
check(guide.includes("title:'Безналичные выплаты'") &&
      !guide.includes("title:'Наличные и выплаты'"),
  'training financial guide no longer recommends cash');
check(/clientFeePct:\s*5/.test(defaults) && /performerCommissionPct:\s*5/.test(defaults) &&
      /clientSharePct:\s*10/.test(defaults) && /clientSpendCapPct:\s*10/.test(defaults) &&
      /days:\s*180/.test(defaults),
  'approved 5/5 fee and 10%-of-fee for 180 days are retained');
check(!existsSync('web/src/finalCanon.css') && file('web/src/main.tsx').includes("currentApproved20261119.css"),
  'old 14 Nov public stylesheet cannot become active');
if(errors.length){console.error('Current policy gate: '+errors.length+' failure(s)');process.exitCode=1;}
else console.log('Current policy gate: active business decisions preserved; full CI and visual acceptance still required.');
