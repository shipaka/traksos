/**
 * Policy for an eventual shared "Эфир" channel. There is NO live/public
 * feed transport in this branch: this pure decision function deliberately
 * has no database, network or sending side-effects.
 *
 * A real broadcaster must persist per-channel lastBotAt, postsToday,
 * and the rolling human messages atomically; and require admin enablement.
 * Do not call this from order chats, support, private TrakBot or payments.
 */
import { isOfflineCasual, offlineSmallTalk } from './trakbotOfflineTalk.ts';

export interface AirHumanMessage {
  senderId: string;
  body: string;
  timestampMs: number;
}
export interface AirContext {
  adminEnabled: boolean;
  channelKind: 'public-air' | 'order-chat' | 'support-chat' | 'private-chat';
  nowMs: number;
  botMessagesToday: number;
  lastBotAtMs: number | null;
  recentHumans: AirHumanMessage[];
}
export interface AirBotSuggestion {
  displayName: 'TrakBot · бот';
  body: string;
  reason: 'mentioned' | 'community-moment';
}

// Conservative: one autonomous appearance per day max, never in a dispute,
// repair discussion or a quiet channel. The caller must enforce daily counters
// and cooldown in DB before actually posting.
export function suggestTrakBotAirReply(input: AirContext): AirBotSuggestion | null {
  if (!input.adminEnabled || input.channelKind !== 'public-air' ||
      !Number.isFinite(input.nowMs) || input.botMessagesToday >= 2) return null;
  const recent = input.recentHumans.filter((x) =>
    Number.isFinite(x.timestampMs) &&
    x.timestampMs >= input.nowMs - 60 * 60 * 1000 &&
    x.timestampMs <= input.nowMs &&
    x.body.trim().length > 0 && x.body.length <= 400,
  );
  if (!recent.length) return null;
  const last = recent[recent.length - 1];
  const addressed = /(?:^|\s)@trakbot\b/i.test(last.body);
  if (addressed) {
    // Explicit mention: no passive reading of private data and no model.
    if (input.lastBotAtMs !== null && input.nowMs - input.lastBotAtMs < 15 * 60 * 1000)
      return null;
    const clean = last.body.replace(/(?:^|\s)@trakbot\b/ig, ' ').trim();
    if (!clean || !isOfflineCasual(clean)) return null;
    // Human should explicitly ask for light conversation.
    if (!/шутк|анекдот|пошути|истори|байк|поболта|как дела|привет|скучно/i.test(clean))
      return null;
    const reply = offlineSmallTalk(clean);
    return reply ? { displayName: 'TrakBot · бот', body: reply.slice(0, 330), reason: 'mentioned' } : null;
  }

  if (input.botMessagesToday >= 1 ||
      (input.lastBotAtMs !== null && input.nowMs - input.lastBotAtMs < 2 * 60 * 60 * 1000))
    return null;
  // Must be a genuinely active conversation, not the bot talking to itself.
  if (recent.length < 20 || new Set(recent.map((x) => x.senderId)).size < 4)
    return null;
  const tail = recent.slice(-6);
  if (tail.some((x) => !isOfflineCasual(x.body) || /@/.test(x.body)))
    return null;
  if (!/(?:что-то тихо|как настроение|всем привет|кто на связи|перекур|привал|скучно)/i.test(last.body))
    return null;
  return {
    displayName: 'TrakBot · бот',
    body: 'Я тут тихонько на связи. Раз уж минутка передышки — всем хорошей дороги и приятного общения!',
    reason: 'community-moment',
  };
}
