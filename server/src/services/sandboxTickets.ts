// Short-lived, one-time capability to enter a *separately deployed* TrakSOS
// sandbox with the same code/UI, but a separate database and mock providers.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db/index.ts';
import { HttpError } from '../http/router.ts';
import { newToken, sha256 } from '../util.ts';
import { DEMO } from '../seed.ts';

export const SANDBOX_ROLES = [
  'client', 'owner', 'driver', 'master', 'tow', 'service', 'master_service',
  'insurer', 'inspection', 'courier', 'moderator', 'admin',
] as const;
export type SandboxRole = (typeof SANDBOX_ROLES)[number];

export const SANDBOX_USER_PHONE: Record<SandboxRole, string> = {
  client: DEMO.client,
  owner: DEMO.company,
  driver: DEMO.driver,
  master: DEMO.masters[0].phone,
  tow: DEMO.tow.phone,
  service: DEMO.service,
  master_service: '+79000000051',
  insurer: '+79000000052',
  inspection: '+79000000053',
  courier: '+79000000054',
  moderator: DEMO.moderator,
  admin: DEMO.admin,
};

export const SANDBOX_LANDING: Record<SandboxRole, string> = {
  client: '#/',
  owner: '#/fleet',
  driver: '#/',
  master: '#/work',
  tow: '#/work',
  service: '#/base',
  master_service: '#/work',
  insurer: '#/insurance',
  inspection: '#/inspections',
  courier: '#/courier',
  moderator: '#/moderation',
  admin: '#/admin',
};

function signature(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update('traksos-sandbox-handoff-v1.').update(payload).digest();
}
const forbidden = () => new HttpError(403, 'sandbox_access_denied', 'Доступ к тестовому кабинету не подтверждён');

export function issueSandboxTicket(role: SandboxRole, secret: string, now = Date.now(), returnUrl = ''): string {
  if (!secret || secret.length < 32 || !SANDBOX_ROLES.includes(role)) throw forbidden();
  const payload = Buffer.from(JSON.stringify({
    v: 1, aud: 'traksos-isolated-sandbox', role,
    exp: now + 45_000, nonce: randomBytes(24).toString('hex'), returnUrl,
  })).toString('base64url');
  return payload + '.' + signature(payload, secret).toString('base64url');
}

export async function exchangeSandboxTicket(ticket: string, secret: string, db: Db, now = Date.now()) {
  if (!secret || secret.length < 32 || ticket.length > 1300) throw forbidden();
  const segments = ticket.split('.');
  if (segments.length !== 2 || !/^[a-zA-Z0-9_-]+$/.test(segments[0]) ||
      !/^[a-zA-Z0-9_-]{43}$/.test(segments[1])) throw forbidden();
  const expected = signature(segments[0], secret);
  const actual = Buffer.from(segments[1], 'base64url');
  // Reject non-canonical base64url encodings: different trailing characters can
  // decode to identical HMAC bytes when unused pad bits are ignored.
  if (actual.toString('base64url') !== segments[1] ||
      actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw forbidden();

  let p: any;
  try { p = JSON.parse(Buffer.from(segments[0], 'base64url').toString('utf8')); }
  catch { throw forbidden(); }
  if (p?.v !== 1 || p.aud !== 'traksos-isolated-sandbox' ||
      !SANDBOX_ROLES.includes(p.role) || !/^[a-f0-9]{48}$/.test(p.nonce) ||
      !Number.isSafeInteger(p.exp) || p.exp < now || p.exp > now + 45_000) throw forbidden();

  const role = p.role as SandboxRole;
  const phone = SANDBOX_USER_PHONE[role];
  const result = await db.tx(async q => {
    const user = await q.one<{id:string;phone:string;roles:string[];status:string}>(
      'select id,phone,roles,status from users where phone=$1 for update', [phone]);
    if (!user || user.status !== 'active') throw forbidden();
    const requiredRole = role === 'inspection' ? 'inspection_operator' :
      role === 'owner' || role === 'client' ? 'client' : role === 'driver' ? 'driver' :
      role === 'master_service' ? 'master' : role;
    if (!user.roles.includes(requiredRole) ||
        (role === 'master_service' && !user.roles.includes('service'))) throw forbidden();
    const used = await q.one('insert into sandbox_ticket_uses(nonce_hash,expires_at) values ($1,$2) on conflict do nothing returning nonce_hash',
      [sha256(p.nonce), new Date(p.exp)]);
    if (!used) throw forbidden(); // replayed handoff
    const token = newToken();
    await q.query('insert into sessions(token_hash,user_id,expires_at,device) values ($1,$2,$3,$4)', [
      sha256(token), user.id,
      new Date(now + (role === 'admin' ? 12 : 2)*60*60_000),
      role === 'admin' ? 'sandbox-supervisor' : 'sandbox-role-preview',
    ]);
    return token;
  });
  return { token: result, role, landing: SANDBOX_LANDING[role], sandbox: true,
    returnUrl: typeof p.returnUrl === 'string' && /^https:\/\//.test(p.returnUrl) ? p.returnUrl : undefined };
}

// The long-lived (12-hour) supervisor comes from a one-time signed *admin*
// handoff on the separate sandbox origin. Role sessions never become supervisors,
// even when the chosen fictitious role happens to be "admin".
export async function switchSandboxRole(
  db: Db, supervisorToken: string, role: SandboxRole, now = Date.now(),
) {
  if (typeof supervisorToken !== 'string' ||
      !/^[A-Za-z0-9_-]{20,512}$/.test(supervisorToken) ||
      !SANDBOX_ROLES.includes(role)) throw forbidden();
  return db.tx(async q => {
    const supervisor = await q.one<{expires_at:Date}>(
      `select s.expires_at from sessions s join users u on u.id=s.user_id
        where s.token_hash=$1 and s.device='sandbox-supervisor'
          and s.expires_at>now() and u.phone=$2
          and u.status='active' and 'admin'=any(u.roles)`,
      [sha256(supervisorToken), SANDBOX_USER_PHONE.admin],
    );
    if (!supervisor) throw forbidden();
    const target = await q.one<{id:string;roles:string[]}>(
      "select id,roles from users where phone=$1 and status='active'",
      [SANDBOX_USER_PHONE[role]],
    );
    const required = role==='owner'||role==='client'?'client':
      role==='inspection'?'inspection_operator':
      role==='master_service'?'master':role;
    if (!target?.roles.includes(required) ||
        (role==='master_service'&&!target.roles.includes('service')))
      throw forbidden();
    const token = newToken();
    const expiresAt = new Date(Math.min(now+2*60*60_000,
      new Date(supervisor.expires_at).getTime()));
    if(expiresAt.getTime()<=now)throw forbidden();
    await q.query(
      'insert into sessions(token_hash,user_id,expires_at,device) values ($1,$2,$3,$4)',
      [sha256(token),target.id,expiresAt,'sandbox-role-switched'],
    );
    return {token,role,landing:SANDBOX_LANDING[role],sandbox:true,expiresAt};
  });
}
