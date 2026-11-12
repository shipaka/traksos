import type { Db } from '../db/index.ts';
import type { Hub } from '../realtime/hub.ts';
import type { PushProvider, PushMessage } from '../providers/push.ts';

export class Notifier {
  constructor(private db: Db, private hub: Hub, private push: PushProvider) {}

  /** Событие в открытые окна приложения (без пуша) */
  live(userIds: (string | null | undefined)[], event: Record<string, unknown>) {
    this.hub.send(userIds, event);
  }

  /** Событие + пуш + запись в уведомления */
  async notify(userIds: (string | null | undefined)[], event: Record<string, unknown>, msg: PushMessage) {
    const ids = [...new Set(userIds.filter(Boolean) as string[])];
    if (!ids.length) return;
    this.hub.send(ids, event);
    if (msg.kind !== 'call') {
      for (const id of ids) {
        await this.db.query('insert into notifications(user_id, kind, title, body, data) values ($1,$2,$3,$4,$5)', [
          id, String(event.type), msg.title, msg.body, msg.data,
        ]);
      }
    }
    const tokens = await this.db.query<{ provider: string; token: string }>(
      `select distinct p.provider, p.token from push_tokens p
         left join sessions s on s.token_hash=p.session_token_hash and s.expires_at > now()
         where p.user_id = any($1::uuid[])
           and (p.session_token_hash is null or s.token_hash is not null)`, [ids],
    );
    if (tokens.length) {
      await this.push.send(tokens, msg).catch((e) => console.warn('[push]', e.message));
    }
  }
}
