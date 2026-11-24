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
    if (msg.kind !== 'call') {
      // The inbox is the durable part of the notification. A failure writing
      // recipient N must roll back the entire fan-out, not leave half of the
      // recipient list with an unread message and the rest without one.
      await this.db.tx(async q => {
        for (const id of ids) {
          await q.query('insert into notifications(user_id, kind, title, body, data) values ($1,$2,$3,$4,$5)', [
            id, String(event.type), msg.title, msg.body, msg.data,
          ]);
        }
      });
    }
    await this.deliverStored(ids, event, msg);
  }

  /** Delivery of an alert already persisted atomically in the database. */
  async deliverStored(userIds: (string | null | undefined)[], event: Record<string, unknown>, msg: PushMessage) {
    const ids = [...new Set(userIds.filter(Boolean) as string[])];
    if (!ids.length) return;
    this.hub.send(ids, event);
    // Browser/WebSocket delivery and the persisted inbox are already usable.
    // Failure to read device tokens or reach an optional push provider must
    // not turn a successful business operation into an HTTP error that invites
    // a duplicate retry. It is still logged for operational investigation.
    try {
      const tokens = await this.db.query<{ provider: string; token: string }>(
        `select distinct p.provider, p.token from push_tokens p
           join sessions s on s.token_hash=p.session_token_hash
             and s.user_id=p.user_id and s.expires_at > now()
           join users u on u.id=p.user_id and u.status='active'
             and (u.admin_preview_until is null or u.admin_preview_until>now())
           where p.user_id = any($1::uuid[])`, [ids],
      );
      if (tokens.length) await this.push.send(tokens, msg);
    } catch (error) {
      console.warn('[push]', error instanceof Error ? error.message : String(error));
    }
  }
}
