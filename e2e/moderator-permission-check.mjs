// Static guard against accidental moderator exposure of privileged API routes.
import { readFileSync } from 'node:fs';
const src = readFileSync('server/src/app.ts', 'utf8');
for (const endpoint of [
  '/api/admin/stats',
  '/api/admin/summary',
  '/api/admin/settings',
  '/api/admin/users',
  '/api/admin/orders',
  '/api/admin/service-payouts',
  '/api/admin/vehicle-service-requests',
]) {
  const marker = new RegExp("r\\.get\\('"+endpoint+"', \\['admin'\\]");
  if (!marker.test(src)) throw Error('Sensitive endpoint must be admin-only: '+endpoint);
}
for(const endpoint of ['/api/mod/cases', '/api/admin/verification', '/api/admin/support']) {
  if (!src.includes("'"+endpoint+"', staff,")) throw Error('Moderation endpoint inaccessible to staff: '+endpoint);
}
console.log('Moderator permission boundary static check OK');
