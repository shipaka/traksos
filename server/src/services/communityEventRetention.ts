import type { Db } from '../db/index.ts';

// Event history is a delivery log, not a permanent archive of conversations.
// The actual messages retain their own moderation/erasure policy. A stale
// client must resnapshot after we truncate any event it might have missed.
export const COMMUNITY_EVENT_RETENTION_DAYS = 30;
const PER_SCOPE_BATCH = 1000;
const SCOPES_PER_RUN = 24;

type Scope = { id: string };
type EventId = { id: string };

/**
 * Bounded hourly maintenance. Each transaction takes the SAME parent-row lock
 * as message publication/moderation, bumps its epoch and then deletes old
 * events. The client sees the new epoch and discards a stale in-memory tail.
 *
 * The batch limits protect shared DB capacity; the next hourly run resumes
 * the remaining expired events. A failed transaction preserves both history
 * and epoch so clients never silently miss a deletion.
 */
export async function pruneCommunityEvents(db: Db, now = new Date()) {
  const cutoff = new Date(now.getTime() - COMMUNITY_EVENT_RETENTION_DAYS * 86400_000);
  let rooms = 0, directThreads = 0, removed = 0;
  const kinds = [
    {
      table: 'community_room_moderation_events',
      scope: 'room_id', parent: 'community_rooms',
      counter: 'room',
    },
    {
      table: 'community_dm_moderation_events',
      scope: 'thread_id', parent: 'community_dm_threads',
      counter: 'dm',
    },
  ] as const;

  for (const kind of kinds) {
    // Identifiers below are from fixed literals, never user-supplied SQL.
    const candidates = await db.query<Scope>(
      `select distinct ${kind.scope} as id from ${kind.table}
        where changed_at < $1 order by id limit $2`,
      [cutoff,SCOPES_PER_RUN]);
    for (const item of candidates) {
      const count = await db.tx(async q => {
        const parent = await q.one<{id:string}>(
          `select id from ${kind.parent} where id=$1 for update`,[item.id]);
        if (!parent) return 0;
        const deleted = await q.query<EventId>(
          `delete from ${kind.table} where id in
            (select id from ${kind.table} where ${kind.scope}=$1 and changed_at<$2
              order by changed_at,id limit $3)
            returning id::text as id`,
          [item.id,cutoff,PER_SCOPE_BATCH]);
        if (deleted.length) await q.query(
          `update ${kind.parent} set event_epoch=event_epoch+1 where id=$1`,[item.id]);
        return deleted.length;
      });
      if (count) {
        removed += count;
        if (kind.counter === 'room') rooms++;
        else directThreads++;
      }
    }
  }
  return {rooms,directThreads,removed};
}
