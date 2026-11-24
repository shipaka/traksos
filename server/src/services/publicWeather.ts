/**
 * Public, fixed-location weather for the Android launch scene. No API keys or user coordinates
 * are ever sent to clients. The official Yandex API is queried only by this server.
 * Location is the launch region's centre: Saint Petersburg (not the user's device).
 */
export type PublicWeather = {
  source: 'yandex';
  location: 'Санкт-Петербург';
  condition: 'clear' | 'cloudy' | 'rain' | 'snow' | 'storm';
  description: string;
  temperatureC: number;
  observedAt: string;
  observedEpochSeconds: number;
  fetchedAt: string;
  attribution: 'Яндекс Погода';
  attributionUrl: 'https://yandex.ru/pogoda/saint-petersburg';
};
type Fetcher = typeof fetch;
const SERVICE_URL = 'https://api.weather.yandex.ru/v2/informers?lat=59.9343&lon=30.3351&lang=ru_RU';
const TTL_MS = 20 * 60_000; // 3 API calls/hour maximum per instance
const FAILURE_TTL_MS = 5 * 60_000;
const OBSERVATION_MAX_AGE_MS = 3 * 60 * 60_000;

export function normalizeYandexCondition(value: unknown): Pick<PublicWeather, 'condition'|'description'> | null {
  if (typeof value !== 'string') return null;
  if (value === 'clear') return { condition: 'clear', description: 'Ясно' };
  if (value === 'partly-cloudy' || value === 'cloudy' || value === 'overcast') {
    return { condition: 'cloudy', description: value === 'overcast' ? 'Пасмурно' : 'Облачно' };
  }
  if (value === 'thunderstorm' || value === 'thunderstorm-with-rain' ||
      value === 'thunderstorm-with-hail') {
    return { condition: 'storm', description: 'Гроза' };
  }
  if (value === 'wet-snow' || value === 'light-snow' ||
      value === 'snow' || value === 'snow-showers') {
    return { condition: 'snow', description: value === 'wet-snow' ? 'Мокрый снег' : 'Снег' };
  }
  if (value === 'light-rain' || value === 'rain' || value === 'moderate-rain' ||
      value === 'heavy-rain' || value === 'continuous-heavy-rain' || value === 'showers' ||
      value === 'hail' || value === 'drizzle') {
    return { condition: 'rain', description: value === 'hail' ? 'Град' : 'Дождь' };
  }
  return null; // Never represent an unknown phenomenon as clear skies.
}

export function parseYandexWeather(data: unknown, fetchedMs: number): PublicWeather | null {
  if (!data || typeof data !== 'object') return null;
  const fact = (data as { fact?: Record<string, unknown> }).fact;
  if (!fact || typeof fact !== 'object') return null;
  const result = normalizeYandexCondition(fact.condition);
  if (!result || typeof fact.temp !== 'number' || !Number.isFinite(fact.temp) ||
      fact.temp < -80 || fact.temp > 65 ||
      !Number.isFinite(fetchedMs) || fetchedMs < 0 || fetchedMs > 8.64e15 ||
      typeof fact.obs_time !== 'number' || !Number.isSafeInteger(fact.obs_time) ||
      fact.obs_time < 0) return null;
  const observationMs = fact.obs_time * 1000;
  if (!Number.isFinite(observationMs) || observationMs > 8.64e15 || observationMs > fetchedMs + 60_000 ||
      fetchedMs - observationMs > OBSERVATION_MAX_AGE_MS) return null;
  return {
    source: 'yandex',
    location: 'Санкт-Петербург',
    ...result,
    temperatureC: Math.round(fact.temp),
    observedAt: new Date(observationMs).toISOString(),
    observedEpochSeconds: fact.obs_time,
    fetchedAt: new Date(fetchedMs).toISOString(),
    attribution: 'Яндекс Погода',
    attributionUrl: 'https://yandex.ru/pogoda/saint-petersburg'
  };
}

// The weather vendor endpoint is fixed, but malformed/unbounded upstream JSON
// must not force the public app server to allocate an unlimited response.
async function boundedWeatherJson(response: Response): Promise<unknown | null> {
  const maxBytes = 65_536;
  const declared = response.headers.get('content-length');
  if (declared !== null && /^\d+$/.test(declared) && Number(declared)>maxBytes) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const {done,value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const bytes of chunks) { out.set(bytes,offset); offset += bytes.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(out)); }
  catch { return null; }
}

export class PublicWeatherService {
  private cache: { expiresAt: number; value: PublicWeather | null } | null = null;
  private pending: Promise<PublicWeather | null> | null = null;
  constructor(
    private readonly apiKey: string | undefined = process.env.YANDEX_WEATHER_API_KEY,
    private readonly requester: Fetcher = fetch,
    private readonly clock: () => number = Date.now
  ) {}

  async current(): Promise<PublicWeather | null> {
    if (!this.apiKey?.trim()) return null;
    const at = this.clock();
    if (this.cache && this.cache.expiresAt > at) {
      const value = this.cache.value;
      // Keep the vendor call budget, but never display an observation that
      // aged past the accepted window while it was in the local cache.
      if (value && (at - value.observedEpochSeconds * 1000 > OBSERVATION_MAX_AGE_MS ||
          value.observedEpochSeconds * 1000 > at + 60_000)) return null;
      return value;
    }
    if (this.pending) return this.pending;
    this.pending = Promise.resolve().then(() => this.requester(SERVICE_URL, {
      headers: { 'X-Yandex-Weather-Key': this.apiKey },
      redirect: 'error',
      signal: AbortSignal.timeout(2500)
    }))
      .then(async r => {
        if (!r.ok) {
          await r.body?.cancel().catch(() => {});
          return null;
        }
        const parsed = await boundedWeatherJson(r);
        return parseYandexWeather(parsed, this.clock());
      })
      .catch(() => null)
      .then(value => {
        this.cache = { value, expiresAt: this.clock() + (value ? TTL_MS : FAILURE_TTL_MS) };
        return value;
      })
      .finally(() => { this.pending = null; });
    return this.pending;
  }
}
