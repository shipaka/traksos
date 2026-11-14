import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicWeatherService, parseYandexWeather, normalizeYandexCondition } from '../src/services/publicWeather.ts';

const ts = Date.UTC(2026, 10, 14, 15, 0, 0);
const sample = (condition: string, temp = -3, obs = ts / 1000) =>
  ({ fact: { condition, temp, obs_time: obs }, now: obs });

test('Yandex conditions are mapped correctly and unknown observations never fake sunshine', () => {
  assert.equal(normalizeYandexCondition('clear')?.condition, 'clear');
  assert.equal(normalizeYandexCondition('overcast')?.condition, 'cloudy');
  assert.equal(normalizeYandexCondition('heavy-rain')?.condition, 'rain');
  assert.equal(normalizeYandexCondition('wet-snow')?.condition, 'snow');
  assert.equal(normalizeYandexCondition('thunderstorm-with-rain')?.condition, 'storm');
  assert.equal(normalizeYandexCondition('nothing-known'), null);
});
test('actual observation timestamp and temperature must be valid and recent', () => {
  assert.equal(parseYandexWeather(sample('snow'), ts)?.temperatureC, -3);
  assert.equal(parseYandexWeather(sample('snow'), ts)?.source, 'yandex');
  assert.equal(parseYandexWeather(sample('snow'), ts)?.location, 'Санкт-Петербург');
  assert.equal(parseYandexWeather(sample('clear', 100), ts), null);
  assert.equal(parseYandexWeather(sample('rain', 5, ts / 1000 - 10801), ts), null);
  assert.equal(parseYandexWeather(sample('snow', -5, ts / 1000 + 100), ts), null);
  assert.equal(parseYandexWeather({}, ts), null);
});
test('cache collapses simultaneous requests and never exposes the key in the response', async () => {
  let calls = 0;
  const fakeFetch = async (_url: unknown, init: any) => {
    calls++;
    assert.equal(init.headers['X-Yandex-Weather-Key'], 'server-only-secret');
    return { ok: true, json: async () => sample('light-snow') } as any;
  };
  const service = new PublicWeatherService('server-only-secret', fakeFetch as any, () => ts);
  const results = await Promise.all(Array.from({ length: 40 }, () => service.current()));
  assert.equal(calls, 1);
  assert.equal(results[0]?.condition, 'snow');
  assert.equal(JSON.stringify(results[0]).includes('server-only-secret'), false);
  await service.current();
  assert.equal(calls, 1);
});
test('without a server key or with a failing provider returns unavailable, not mock weather', async () => {
  const missing = new PublicWeatherService('', (async () => { throw new Error('should not call'); }) as any, () => ts);
  assert.equal(await missing.current(), null);
  const down = new PublicWeatherService('demo', (async () => { throw new Error('offline'); }) as any, () => ts);
  assert.equal(await down.current(), null);
  assert.equal(await down.current(), null);
});
