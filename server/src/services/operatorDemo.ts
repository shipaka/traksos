// A separated, read-only preview capability for the local-only administrator
// training components. No AuthUser, role, or normal application session is issued.
import { timingSafeEqual } from 'node:crypto';
import type { Db } from '../db/index.ts';
import { HttpError } from '../http/router.ts';
import { hmac, newToken, sha256 } from '../util.ts';

const MAX_WRONG_PINS = 8;
const SESSION_MS = 2 * 60 * 60_000;

export function demoPinHash(pin: string) {
  return hmac('operator-demo-v1:' + pin);
}

export class OperatorDemoAccess {
  constructor(private db: Db, private now: () => Date = () => new Date()) {}

  async redeem(pin: string) {
    if (!/^\\d{10}$/.test(pin)) throw new HttpError(401, 'demo_bad_code', 'Неверный или устаревший код.');
    const now = this.now();
    const result = await this.db.tx(async q => {
      // A single row lock prevents concurrent guesses from bypassing the limit.
      const grant = await q.one<{pin_hash:string; expires_at:Date; attempts:number; redeemed_at:Date|null}>(
        'select pin_hash,expires_at,attempts,redeemed_at from operator_demo_grant where id=1 for update',
      );
      if (!grant || new Date(grant.expires_at).getTime() <= now.getTime() || grant.redeemed_at ||
          grant.attempts >= MAX_WRONG_PINS) return null;
      const submitted = Buffer.from(demoPinHash(pin), 'hex');
      const expected = /^[0-9a-f]{64}$/.test(grant.pin_hash) ? Buffer.from(grant.pin_hash,'hex') : Buffer.alloc(32);
      if (!timingSafeEqual(submitted,expected)) {
        await q.query('update operator_demo_grant set attempts=attempts+1 where id=1');
        return null;
      }
      const expiresAt = new Date(Math.min(new Date(grant.expires_at).getTime(), now.getTime()+SESSION_MS));
      const token = newToken();
      await q.query('update operator_demo_grant set redeemed_at=$1 where id=1',[now]);
      await q.query('insert into operator_demo_session(token_hash,expires_at) values ($1,$2)',[sha256(token),expiresAt]);
      return { token, expiresAt:expiresAt.toISOString() };
    });
    if (!result) throw new HttpError(401, 'demo_bad_code', 'Неверный или устаревший код. После восьми ошибок получите новый код в SSH.');
    return result;
  }

  async verify(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
    const session = await this.db.one<{ok:boolean}>(
      'select true as ok from operator_demo_session where token_hash=$1 and expires_at>now()',
      [sha256(token)],
    );
    return session?.ok === true;
  }
}
