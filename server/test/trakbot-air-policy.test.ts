import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestTrakBotAirReply, type AirContext } from '../src/services/trakbotAirPolicy.ts';

const nowMs = Date.parse('2026-11-19T12:00:00Z');
function ctx(override: Partial<AirContext> = {}): AirContext {
  return {
    adminEnabled: true,
    channelKind: 'public-air',
    nowMs,
    botMessagesToday: 0,
    lastBotAtMs: null,
    recentHumans: Array.from({ length: 24 }, (_, i) => ({
      senderId: 'person-' + i % 4,
      body: i === 23 ? 'Всем привет, кто на связи?' : 'Привет всем!',
      timestampMs: nowMs - (24 - i) * 60_000,
    })),
    ...override,
  };
}

test('TrakBot cannot post to private, order or support conversations', () => {
  for (const channelKind of ['order-chat', 'private-chat', 'support-chat'] as const)
    assert.equal(suggestTrakBotAirReply(ctx({channelKind})), null);
  assert.equal(suggestTrakBotAirReply(ctx({adminEnabled:false})), null);
});

test('mentions are answered only after a safe explicit request and cooldown', () => {
  const mention = ctx({recentHumans:[{
    senderId:'u1', body:'@TrakBot, расскажи шутку', timestampMs:nowMs,
  }]});
  const r = suggestTrakBotAirReply(mention);
  assert.equal(r?.displayName, 'TrakBot · бот');
  assert.equal(r?.reason, 'mentioned');
  assert.match(r?.body ?? '', /Ещё одну/);
  assert.equal(suggestTrakBotAirReply({...mention,lastBotAtMs:nowMs-60_000}), null);
  assert.equal(suggestTrakBotAirReply({...mention,botMessagesToday:2}), null);
  assert.equal(suggestTrakBotAirReply(ctx({recentHumans:[{
    senderId:'u1', body:'@TrakBot EBS как отключить тормоза?', timestampMs:nowMs,
  }]})),null);
  assert.equal(suggestTrakBotAirReply(ctx({recentHumans:[{
    senderId:'u1', body:'@TrakBot номер телефона клиента?', timestampMs:nowMs,
  }]})),null);
});

test('unprompted public appearances need four people, a live room and a natural moment', () => {
  const suggestion = suggestTrakBotAirReply(ctx());
  assert.equal(suggestion?.reason,'community-moment');
  assert.match(suggestion?.body ?? '', /дороги/);
  assert.equal(suggestTrakBotAirReply(ctx({lastBotAtMs:nowMs-60_000})),null);
  assert.equal(suggestTrakBotAirReply(ctx({botMessagesToday:1})),null);
  assert.equal(suggestTrakBotAirReply(ctx({recentHumans:ctx().recentHumans.slice(0,8)})),null);
  assert.equal(suggestTrakBotAirReply(ctx({recentHumans:ctx().recentHumans.map(m=>({...m,senderId:'same'}))})),null);
  const active = ctx().recentHumans;
  active[active.length-2]={...active[active.length-2],body:'Ошибка тормозов EBS'};
  assert.equal(suggestTrakBotAirReply(ctx({recentHumans:active})),null);
  const stale = ctx().recentHumans.map(m=>({...m,timestampMs:nowMs-2*60*60*1000}));
  assert.equal(suggestTrakBotAirReply(ctx({recentHumans:stale})),null);
});
